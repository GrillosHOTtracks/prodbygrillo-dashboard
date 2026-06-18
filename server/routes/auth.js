const express    = require('express')
const fs         = require('fs')
const path       = require('path')
const os         = require('os')
const jwt        = require('jsonwebtoken')
const rateLimit  = require('express-rate-limit')
const accountManager = require('../accountManager')
const { JWT_SECRET, dashboardAuth } = require('../middleware/dashboardAuth')
const channelRoute   = require('./channel')

const CACHE_FILES = [
  path.join(os.tmpdir(), 'channel_info.json'),
  path.join(os.tmpdir(), 'videos_cache.json'),
  path.join(os.tmpdir(), 'trending_cache.json'),
]

function clearAllCaches() {
  for (const f of CACHE_FILES) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch {}
  }
  try { channelRoute.clearMemCache() } catch {}
  console.log('[AUTH] All data caches cleared for new login')
}

const router = express.Router()

const ALLOWED_CALLBACK_ORIGINS = [
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  process.env.FRONTEND_URL,
  process.env.RAILWAY_PUBLIC_DOMAIN
    ? new RegExp('^https://' + process.env.RAILWAY_PUBLIC_DOMAIN.replace(/\./g, '\\.'))
    : null,
].filter(Boolean)

function isAllowedOrigin(origin) {
  return ALLOWED_CALLBACK_ORIGINS.some(p =>
    typeof p === 'string' ? origin === p : p.test(origin)
  )
}

// ─── FIX (correction 4): rate-limit login endpoint ───────────────────────────
// 5 attempts per 15 minutes per IP — prevents brute-force attacks
const loginLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              5,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Demasiadas tentativas. Tente novamente em 15 minutos.', code: 'TOO_MANY_ATTEMPTS' },
  skip:             () => !process.env.DASHBOARD_PASSWORD, // no rate-limit when no password set (dev)
})

// ─── Dashboard login (username/password) ─────────────────────────────────────
// FIX (correction 8): sets httpOnly cookie so the JWT never touches JS / localStorage
router.post('/dashboard-login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {}
  const expectedUser = process.env.DASHBOARD_USERNAME || 'admin'
  const expectedPass = process.env.DASHBOARD_PASSWORD

  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https'

  if (!expectedPass) {
    // Dev mode — no password configured; issue long-lived token
    const token = jwt.sign({ sub: 'dev' }, JWT_SECRET, { expiresIn: '365d' })
    res.cookie('dashboard_token', token, {
      httpOnly: true,
      secure:   isSecure,
      sameSite: 'strict',
      maxAge:   365 * 24 * 60 * 60 * 1000,
      path:     '/',
    })
    return res.json({ ok: true })
  }

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' })
  }

  if (username !== expectedUser || password !== expectedPass) {
    return res.status(401).json({ error: 'Credenciais inválidas' })
  }

  const token = jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: '30d' })
  res.cookie('dashboard_token', token, {
    httpOnly: true,
    secure:   isSecure,
    sameSite: 'strict',
    maxAge:   30 * 24 * 60 * 60 * 1000,
    path:     '/',
  })
  res.json({ ok: true })
})

// FIX (correction 8): dashboard logout — clears the httpOnly cookie server-side
router.post('/dashboard-logout', (_req, res) => {
  res.clearCookie('dashboard_token', { path: '/' })
  res.json({ ok: true })
})

router.get('/dashboard-verify', (_req, res) => {
  // Middleware already validated the token — just confirm
  res.json({ ok: true })
})

// ─── YouTube OAuth status ─────────────────────────────────────────────────────
router.get('/status', (_req, res) => {
  res.json({ authenticated: accountManager.isAuthenticated() })
})

// FIX (correction 5): encode origin inside a signed state token so there is no
// global mutable variable and no race condition when two logins happen concurrently.
router.get('/url', (req, res) => {
  const rawOrigin = req.query.origin || 'http://localhost:5173'
  const origin    = isAllowedOrigin(rawOrigin) ? rawOrigin : 'http://localhost:5173'
  try {
    const url = accountManager.getAuthUrlWithState(origin, JWT_SECRET)
    if (!url) return res.status(400).json({ error: 'No OAuth credentials found' })
    res.json({ url })
  } catch (err) {
    console.error('[AUTH URL ERROR]', err.stack || err.message)
    res.status(500).json({ error: err.message })
  }
})

// FIX (correction 5): recover origin from the signed state parameter — no global variable
router.get('/callback', async (req, res) => {
  const { code, error, state } = req.query
  console.log('[AUTH] callback — code:', code ? code.slice(0, 20) + '...' : 'MISSING', '| error:', error || 'none')

  // Decode the origin from the signed state (default to localhost if invalid/expired)
  let base = 'http://localhost:5173'
  if (state) {
    try {
      const decoded = jwt.verify(String(state), JWT_SECRET)
      if (decoded.origin && isAllowedOrigin(decoded.origin)) base = decoded.origin
    } catch (stateErr) {
      console.warn('[AUTH] state token invalid or expired:', stateErr.message)
    }
  }

  if (error) return res.redirect(`${base}?auth=error&reason=${encodeURIComponent(error)}`)
  if (!code) return res.status(400).json({ error: 'No code provided' })

  try {
    const tokens = await accountManager.exchangeCode(code)
    clearAllCaches()
    try {
      if (tokens.id_token) {
        const payload = tokens.id_token.split('.')[1]
        const padded  = payload + '='.repeat((4 - payload.length % 4) % 4)
        const claims  = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
        console.log(`[AUTH] Google Account authenticated: email=${claims.email} sub=${claims.sub}`)
      } else {
        console.log('[AUTH] No id_token in response — cannot verify which Google Account')
      }
    } catch {}
    console.log('[AUTH] Token saved')
    res.redirect(`${base}?auth=success`)
  } catch (err) {
    console.error('[AUTH] Token exchange failed:', err.message)
    res.redirect(`${base}?auth=error&reason=token_exchange`)
  }
})

router.post('/logout', (_req, res) => {
  accountManager.logout()
  clearAllCaches()
  res.json({ ok: true })
})

// FIX (correction 3): token export now requires dashboard authentication
// so it cannot be accessed by anyone who doesn't have the dashboard password.
router.get('/token-export', dashboardAuth, (_req, res) => {
  try {
    const a = accountManager.oauthAccounts[0]
    if (!a || !fs.existsSync(a.tokenPath)) {
      return res.status(404).json({ error: 'No token file found. Authenticate first.' })
    }
    const raw = fs.readFileSync(a.tokenPath, 'utf8')
    const b64 = Buffer.from(raw).toString('base64')
    res.json({ base64: b64, hint: 'Set GOOGLE_TOKEN=<base64> in Railway Variables' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

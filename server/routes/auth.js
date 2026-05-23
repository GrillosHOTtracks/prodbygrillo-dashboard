const express = require('express')
const fs   = require('fs')
const path = require('path')
const os   = require('os')
const jwt  = require('jsonwebtoken')
const accountManager = require('../accountManager')
const { JWT_SECRET } = require('../middleware/dashboardAuth')

const CACHE_FILES = [
  path.join(os.tmpdir(), 'channel_info.json'),
  path.join(os.tmpdir(), 'videos_cache.json'),
  path.join(os.tmpdir(), 'trending_cache.json'),
]

function clearAllCaches() {
  for (const f of CACHE_FILES) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch {}
  }
  console.log('[AUTH] All data caches cleared for new login')
}

const router = express.Router()
let pendingFrontendOrigin = 'http://localhost:5173'

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

// ─── Dashboard login (username/password) ──────────────────────────────────────
router.post('/dashboard-login', (req, res) => {
  const { username, password } = req.body || {}
  const expectedUser = process.env.DASHBOARD_USERNAME || 'admin'
  const expectedPass = process.env.DASHBOARD_PASSWORD

  if (!expectedPass) {
    // No password configured — issue a token with no expiry for dev mode
    const token = jwt.sign({ sub: 'dev' }, JWT_SECRET, { expiresIn: '365d' })
    return res.json({ token })
  }

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' })
  }

  if (username !== expectedUser || password !== expectedPass) {
    return res.status(401).json({ error: 'Credenciais inválidas' })
  }

  const token = jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: '30d' })
  res.json({ token })
})

router.get('/dashboard-verify', (_req, res) => {
  // Middleware already validated the token — just confirm
  res.json({ ok: true })
})

// ─── YouTube OAuth status ──────────────────────────────────────────────────────
router.get('/status', (_req, res) => {
  res.json({ authenticated: accountManager.isAuthenticated() })
})

router.get('/url', (req, res) => {
  if (req.query.origin && isAllowedOrigin(req.query.origin)) {
    pendingFrontendOrigin = req.query.origin
  }
  try {
    const url = accountManager.getAuthUrl()
    if (!url) return res.status(400).json({ error: 'No OAuth credentials found' })
    res.json({ url })
  } catch (err) {
    console.error('[AUTH URL ERROR]', err.stack || err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/callback', async (req, res) => {
  const { code, error } = req.query
  const base = pendingFrontendOrigin
  if (error) return res.redirect(`${base}?auth=error&reason=${error}`)
  if (!code) return res.status(400).json({ error: 'No code provided' })
  try {
    await accountManager.exchangeCode(code)
    clearAllCaches()
    res.redirect(`${base}?auth=success`)
  } catch (err) {
    console.error('Token exchange failed:', err.message)
    res.redirect(`${base}?auth=error&reason=token_exchange`)
  }
})

router.post('/logout', (_req, res) => {
  accountManager.logout()
  clearAllCaches()
  res.json({ ok: true })
})

// Returns current token as base64 — copy this into GOOGLE_TOKEN Railway env var
router.get('/token-export', (_req, res) => {
  try {
    const tokenPath = accountManager.oauth?.tokenPath
    if (!tokenPath || !fs.existsSync(tokenPath)) {
      return res.status(404).json({ error: 'No token file found. Authenticate first.' })
    }
    const raw    = fs.readFileSync(tokenPath, 'utf8')
    const b64    = Buffer.from(raw).toString('base64')
    res.json({ base64: b64, hint: 'Set GOOGLE_TOKEN=<base64> in Railway Variables' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

const express = require('express')
const cors    = require('cors')
const path    = require('path')
const fs      = require('fs')

console.log('[SERVER] Node:', process.version, '| PORT env:', process.env.PORT)

let authRoutes, accountsRoutes, channelRoutes, analyticsRoutes,
    videosRoutes, audienceRoutes, trendingRoutes, aiRoutes, uploadRoutes, accountManager

try {
  authRoutes      = require('./routes/auth')
  accountsRoutes  = require('./routes/accounts')
  channelRoutes   = require('./routes/channel')
  analyticsRoutes = require('./routes/analytics')
  videosRoutes    = require('./routes/videos')
  audienceRoutes  = require('./routes/audience')
  trendingRoutes  = require('./routes/trending')
  aiRoutes        = require('./routes/ai')
  uploadRoutes    = require('./routes/upload')
  accountManager  = require('./accountManager')
  console.log('[SERVER] All modules loaded OK')
} catch (err) {
  console.error('[SERVER] Module load error:', err.message)
  console.error(err.stack)
  process.exit(1)
}

const app  = express()
const PORT = process.env.PORT || 3010

const ALLOWED_ORIGINS = [
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  process.env.FRONTEND_URL,
  process.env.RAILWAY_PUBLIC_DOMAIN
    ? new RegExp(process.env.RAILWAY_PUBLIC_DOMAIN.replace(/\./g, '\\.'))
    : null,
].filter(Boolean)

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)
    const ok = ALLOWED_ORIGINS.some(p =>
      typeof p === 'string' ? origin === p : p.test(origin)
    )
    cb(ok ? null : new Error('Not allowed by CORS'), ok)
  },
  credentials: true,
}))
app.use(express.json())

function requireAuth(req, res, next) {
  if (!accountManager.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
  }
  next()
}

app.use('/api/auth',      authRoutes)
app.use('/api/accounts',  accountsRoutes)
app.use('/api/channel',   requireAuth, channelRoutes)
app.use('/api/analytics', requireAuth, analyticsRoutes)
app.use('/api/videos',    requireAuth, videosRoutes)
app.use('/api/audience',  requireAuth, audienceRoutes)
app.use('/api/trending',  requireAuth, trendingRoutes)
app.use('/api/ai',        requireAuth, aiRoutes)
app.use('/api/upload',    requireAuth, uploadRoutes)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, authenticated: accountManager.isAuthenticated(), ts: new Date().toISOString() })
})

// Serve built frontend in production
const distPath = path.join(__dirname, '..', 'dist')
if (fs.existsSync(distPath)) {
  console.log('[SERVER] Serving static frontend from', distPath)
  app.use(express.static(distPath))
  app.get('*path', (_req, res) => res.sendFile(path.join(distPath, 'index.html')))
} else {
  console.log('[SERVER] No dist/ folder found — API-only mode')
}

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Listening on 0.0.0.0:${PORT}`)
  try {
    const { oauth, keys } = accountManager.getStatus()
    const oaFlag = !oauth.hasCredFile ? '✗ no creds' : oauth.authenticated ? '✓' : '✗ not connected'
    console.log(`[SERVER] OAuth: ${oaFlag} | API keys: ${keys.length}`)
  } catch (e) {
    console.warn('[SERVER] getStatus error:', e.message)
  }
})

server.on('error', (err) => {
  console.error(`[SERVER ERROR] ${err.code}: ${err.message}`)
  process.exit(1)
})

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err.stack)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason)
})

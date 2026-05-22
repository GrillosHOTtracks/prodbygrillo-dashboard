const express = require('express')
const cors    = require('cors')
const path    = require('path')
const fs      = require('fs')

const authRoutes      = require('./routes/auth')
const accountsRoutes  = require('./routes/accounts')
const channelRoutes   = require('./routes/channel')
const analyticsRoutes = require('./routes/analytics')
const videosRoutes    = require('./routes/videos')
const audienceRoutes  = require('./routes/audience')
const trendingRoutes  = require('./routes/trending')
const aiRoutes        = require('./routes/ai')
const uploadRoutes    = require('./routes/upload')
const accountManager  = require('./accountManager')

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
app.use('/api/accounts',  accountsRoutes)           // no requireAuth — needed before login
app.use('/api/channel',   requireAuth, channelRoutes)
app.use('/api/analytics', requireAuth, analyticsRoutes)
app.use('/api/videos',    requireAuth, videosRoutes)
app.use('/api/audience',  requireAuth, audienceRoutes)
app.use('/api/trending',  requireAuth, trendingRoutes)
app.use('/api/ai',        requireAuth, aiRoutes)
app.use('/api/upload',    requireAuth, uploadRoutes)

app.get('/api/health', (req, res) => {
  res.json({ ok: true, authenticated: accountManager.isAuthenticated(), ts: new Date().toISOString() })
})

// Serve built frontend in production
const distPath = path.join(__dirname, '..', 'dist')
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')))
}

const server = app.listen(PORT, '0.0.0.0', () => {
  const { oauth, keys } = accountManager.getStatus()
  console.log(`\n  [SERVER] http://localhost:${PORT}`)
  if (!oauth.hasCredFile) {
    console.log(`  [AUTH  ] ✗ client_secret_1.json não encontrado`)
  } else {
    const oaFlag = oauth.authenticated ? (oauth.quotaExceeded ? '⚠ quota' : '✓') : '✗ not connected'
    console.log(`  [OAUTH ] ${oaFlag}`)
    for (const k of keys) {
      const kFlag = k.quotaExceeded ? '⚠ quota' : k.active ? '✓ active' : '✓'
      console.log(`  [KEY ${k.n} ] ${kFlag}`)
    }
    if (keys.length === 0) console.log(`  [KEYS  ] none — add YT_API_KEY_2=... to .env`)
  }
  console.log()
})

server.on('error', (err) => {
  console.error(`[SERVER ERROR] ${err.code}: ${err.message}`)
  process.exit(1)
})

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT]', err.message)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason)
})

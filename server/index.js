const express = require('express')
const cors    = require('cors')
const path    = require('path')
const fs      = require('fs')

console.log('[SERVER] Node:', process.version, '| PORT env:', process.env.PORT)

let authRoutes, accountsRoutes, channelRoutes, analyticsRoutes,
    videosRoutes, audienceRoutes, trendingRoutes, aiRoutes, uploadRoutes,
    instagramRoutes, beatstarsRoutes, accountManager, dashboardAuth

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
  instagramRoutes  = require('./routes/instagram')
  beatstarsRoutes  = require('./routes/beatstars')
  marketRoutes     = require('./routes/market')
  accountManager   = require('./accountManager');
  ({ dashboardAuth } = require('./middleware/dashboardAuth'))
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
app.use(dashboardAuth)

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
app.use('/api/ai',        aiRoutes)
app.use('/api/upload',    requireAuth, uploadRoutes)
app.use('/api/instagram',  instagramRoutes)
app.use('/api/beatstars', beatstarsRoutes)
app.use('/api/market',   marketRoutes)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, authenticated: accountManager.isAuthenticated(), ts: new Date().toISOString() })
})

// Seed uploadsPlaylist from CHANNEL_ID env var — only if no real cache exists yet
// This avoids the OAuth channels.list call on cold start (saves 1 quota unit)
{
  const os   = require('os')
  const cid  = process.env.CHANNEL_ID
  const upid = process.env.UPLOADS_PLAYLIST_ID
  if (cid) {
    const cacheFile = path.join(os.tmpdir(), 'channel_info.json')
    const existing  = fs.existsSync(cacheFile)
      ? (() => { try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')) } catch { return null } })()
      : null
    // Only seed if no cache at all — never overwrite real API data
    if (!existing) {
      const seed = {
        id:              cid,
        uploadsPlaylist: upid || ('UU' + cid.slice(2)),
        name:        process.env.CHANNEL_NAME   || '',
        handle:      process.env.CHANNEL_HANDLE || '',
        description: '', thumbnail: '',
        country:     'BR', publishedAt: '',
        subscribers: parseInt(process.env.CHANNEL_SUBS   || '0'),
        totalViews:  parseInt(process.env.CHANNEL_VIEWS  || '0'),
        totalVideos: parseInt(process.env.CHANNEL_VIDEOS || '0'),
        _seeded: true,
      }
      try { fs.writeFileSync(cacheFile, JSON.stringify(seed)); console.log('[SERVER] Channel cache seeded from env vars') } catch {}
    }
  }
}

// Serve built frontend in production
const distPath = path.join(process.cwd(), 'dist')
console.log('[SERVER] cwd:', process.cwd())
console.log('[SERVER] distPath:', distPath)
console.log('[SERVER] dist exists:', fs.existsSync(distPath))
if (fs.existsSync(distPath)) {
  console.log('[SERVER] dist contents:', fs.readdirSync(distPath))
  app.use(express.static(distPath, { index: 'index.html' }))
  app.use((_req, res) => res.sendFile(path.join(distPath, 'index.html')))
} else {
  console.log('[SERVER] No dist/ folder — API-only mode')
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

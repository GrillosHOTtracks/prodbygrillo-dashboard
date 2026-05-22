require('dotenv').config()
const express = require('express')
const fs      = require('fs')
const path    = require('path')
const os      = require('os')
const https   = require('https')
const multer  = require('multer')

const router  = express.Router()
const TMP_DIR = path.join(__dirname, '../tmp')
fs.mkdirSync(TMP_DIR, { recursive: true })

// ─── Config ───────────────────────────────────────────────────────────────────
const APP_ID       = process.env.META_APP_ID      || ''
const APP_SECRET   = process.env.META_APP_SECRET  || ''
const REDIRECT_URI = process.env.META_REDIRECT_URI || 'http://localhost:3010/api/instagram/auth/callback'
const GRAPH        = 'https://graph.facebook.com/v19.0'
const SCOPES       = 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement'
const TOKEN_FILE   = path.join(os.tmpdir(), 'instagram_token.json')

// ─── Token helpers ────────────────────────────────────────────────────────────
function readToken() {
  // Env vars take priority (Railway production)
  if (process.env.META_ACCESS_TOKEN && process.env.INSTAGRAM_ACCOUNT_ID) {
    return {
      accessToken: process.env.META_ACCESS_TOKEN,
      igUserId:    process.env.INSTAGRAM_ACCOUNT_ID,
      expiresAt:   null, // managed manually in Railway
    }
  }
  try {
    if (fs.existsSync(TOKEN_FILE)) return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
  } catch {}
  return null
}

function writeToken(data) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2))
  const b64 = Buffer.from(data.accessToken).toString('base64')
  console.log('[INSTAGRAM] Token saved — update META_ACCESS_TOKEN in Railway:')
  console.log('[INSTAGRAM] igUserId:', data.igUserId)
  console.log('[INSTAGRAM] expiresAt:', data.expiresAt ? new Date(data.expiresAt).toISOString() : 'unknown')
  console.log('[INSTAGRAM] token preview:', b64.slice(0, 20) + '...')
}

function clearToken() {
  try { if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE) } catch {}
}

// ─── Graph API helpers ────────────────────────────────────────────────────────
function graphGet(endpoint, params = {}) {
  return new Promise((resolve, reject) => {
    const qs  = new URLSearchParams(params).toString()
    const url = `${GRAPH}${endpoint}?${qs}`
    https.get(url, (res) => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => {
        try {
          const json = JSON.parse(body)
          if (json.error) return reject(new Error(`[Graph] ${json.error.message} (code ${json.error.code})`))
          resolve(json)
        } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

function graphPost(endpoint, params = {}) {
  return new Promise((resolve, reject) => {
    const body    = new URLSearchParams(params).toString()
    const options = {
      hostname: 'graph.facebook.com',
      path:     `/v19.0${endpoint}`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.error) return reject(new Error(`[Graph] ${json.error.message} (code ${json.error.code})`))
          resolve(json)
        } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function publicBase() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '')
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  return 'http://localhost:3010'
}

// ─── Auth routes ──────────────────────────────────────────────────────────────

// GET /api/instagram/auth/url
router.get('/auth/url', (req, res) => {
  if (!APP_ID) return res.status(503).json({ error: 'META_APP_ID não configurado', code: 'NO_CONFIG' })
  const url = new URL('https://www.facebook.com/v19.0/dialog/oauth')
  url.searchParams.set('client_id',     APP_ID)
  url.searchParams.set('redirect_uri',  REDIRECT_URI)
  url.searchParams.set('scope',         SCOPES)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state',         req.query.origin || 'http://localhost:5173')
  res.json({ url: url.toString() })
})

// GET /api/instagram/auth/callback
router.get('/auth/callback', async (req, res) => {
  const { code, error, state } = req.query
  const base = state || 'http://localhost:5173'
  if (error) return res.redirect(`${base}?instagram_auth=error&reason=${error}`)
  if (!code) return res.status(400).json({ error: 'No code provided' })

  try {
    // 1. Short-lived token
    const shortRes = await graphGet('/oauth/access_token', {
      client_id:     APP_ID,
      client_secret: APP_SECRET,
      redirect_uri:  REDIRECT_URI,
      code,
    })

    // 2. Long-lived token (60 days)
    const longRes = await graphGet('/oauth/access_token', {
      grant_type:       'fb_exchange_token',
      client_id:        APP_ID,
      client_secret:    APP_SECRET,
      fb_exchange_token: shortRes.access_token,
    })
    const accessToken = longRes.access_token
    const expiresAt   = Date.now() + ((longRes.expires_in || 5184000) * 1000)

    // 3. Get Facebook Pages
    const pagesRes = await graphGet('/me/accounts', { access_token: accessToken })
    const page     = pagesRes.data?.[0]
    if (!page) throw new Error('Nenhuma Facebook Page encontrada. Liga a tua Instagram Business account a uma Page.')

    // 4. Get Instagram Business Account linked to the Page
    const pageRes  = await graphGet(`/${page.id}`, {
      fields:       'instagram_business_account',
      access_token: accessToken,
    })
    const igUserId = pageRes.instagram_business_account?.id
    if (!igUserId) throw new Error('Nenhuma conta Instagram Business encontrada ligada à Page.')

    // 5. Get Instagram username for confirmation
    let username = ''
    try {
      const igInfo = await graphGet(`/${igUserId}`, { fields: 'username', access_token: accessToken })
      username = igInfo.username || ''
    } catch {}

    writeToken({ accessToken, igUserId, pageId: page.id, pageName: page.name, username, expiresAt })
    res.redirect(`${base}?instagram_auth=success&username=${encodeURIComponent(username)}`)
  } catch (err) {
    console.error('[INSTAGRAM] auth error:', err.message)
    res.redirect(`${base}?instagram_auth=error&reason=${encodeURIComponent(err.message)}`)
  }
})

// GET /api/instagram/auth/status
router.get('/auth/status', (_req, res) => {
  const token = readToken()
  if (!token) return res.json({ authenticated: false })
  const daysLeft = token.expiresAt
    ? Math.max(0, Math.round((token.expiresAt - Date.now()) / 86_400_000))
    : null
  res.json({
    authenticated: true,
    igUserId:  token.igUserId,
    username:  token.username  || null,
    pageName:  token.pageName  || null,
    expiresAt: token.expiresAt || null,
    daysLeft,
    warning: daysLeft !== null && daysLeft < 10
      ? `Token expira em ${daysLeft} dias — renova via POST /api/instagram/auth/refresh`
      : null,
  })
})

// POST /api/instagram/auth/refresh — renew long-lived token (call every ~50 days)
router.post('/auth/refresh', async (req, res) => {
  const token = readToken()
  if (!token) return res.status(401).json({ error: 'Não autenticado' })
  try {
    const refreshed = await graphGet('/oauth/access_token', {
      grant_type:       'fb_exchange_token',
      client_id:        APP_ID,
      client_secret:    APP_SECRET,
      fb_exchange_token: token.accessToken,
    })
    const updated = {
      ...token,
      accessToken: refreshed.access_token,
      expiresAt:   Date.now() + ((refreshed.expires_in || 5184000) * 1000),
    }
    writeToken(updated)
    res.json({ ok: true, expiresAt: updated.expiresAt, daysLeft: Math.round(refreshed.expires_in / 86400) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/instagram/auth/logout
router.post('/auth/logout', (_req, res) => {
  clearToken()
  res.json({ ok: true })
})

// ─── Upload ───────────────────────────────────────────────────────────────────

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB
  fileFilter: (_req, file, cb) =>
    file.mimetype.startsWith('video/') ? cb(null, true) : cb(new Error('Apenas vídeos aceitos')),
})

// POST /api/instagram/upload  (SSE)
// Body: multipart — field 'video' + field 'meta' (JSON)
// meta: { caption, coverTimeMs?, hashtags? }
router.post('/upload', upload.single('video'), async (req, res) => {
  const token = readToken()
  if (!token) return res.status(401).json({ error: 'Instagram não autenticado', code: 'UNAUTHENTICATED' })
  if (!req.file) return res.status(400).json({ error: 'Nenhum vídeo enviado' })

  let meta = {}
  try { meta = JSON.parse(req.body.meta || '{}') } catch {}

  res.setHeader('Content-Type',      'text/event-stream')
  res.setHeader('Cache-Control',     'no-cache')
  res.setHeader('Connection',        'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const send    = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch {} }
  const cleanup = () => { try { if (req.file?.path) fs.unlinkSync(req.file.path) } catch {} }

  try {
    const { accessToken, igUserId } = token

    // Build caption — append hashtags if provided
    const hashtags = (meta.hashtags || []).join(' ')
    const caption  = [meta.caption || '', hashtags].filter(Boolean).join('\n\n')

    // Public URL for Instagram to fetch the video
    const videoUrl = `${publicBase()}/api/upload/tmp/${req.file.filename}`
    console.log('[INSTAGRAM] video public URL:', videoUrl)

    send({ status: 'CREATING_CONTAINER', progress: 10 })

    // 1. Create Reels container
    const containerParams = {
      media_type:    'REELS',
      video_url:     videoUrl,
      caption,
      share_to_feed: 'true',
      access_token:  accessToken,
    }
    if (meta.coverTimeMs) containerParams.video_cover_timestamp_ms = String(meta.coverTimeMs)

    const containerRes = await graphPost(`/${igUserId}/media`, containerParams)
    const containerId  = containerRes.id
    if (!containerId) throw new Error('Instagram não retornou container ID')

    send({ status: 'PROCESSING', progress: 20, containerId })

    // 2. Poll container status (max 5 min)
    const POLL_MS  = 5000
    const DEADLINE = Date.now() + 5 * 60 * 1000
    let progress   = 20

    while (true) {
      if (Date.now() > DEADLINE) throw new Error('Timeout: Instagram demorou mais de 5 minutos a processar o vídeo')
      await sleep(POLL_MS)

      const statusRes  = await graphGet(`/${containerId}`, { fields: 'status_code,status', access_token: accessToken })
      const statusCode = statusRes.status_code

      if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
        throw new Error(`Instagram rejeitou o vídeo (${statusCode}): ${statusRes.status || 'sem detalhe'}`)
      }
      if (statusCode === 'FINISHED') break

      progress = Math.min(85, progress + 8)
      send({ status: 'PROCESSING', progress, statusCode })
    }

    send({ status: 'PUBLISHING', progress: 90 })

    // 3. Publish
    const publishRes = await graphPost(`/${igUserId}/media_publish`, {
      creation_id:  containerId,
      access_token: accessToken,
    })
    const mediaId = publishRes.id
    if (!mediaId) throw new Error('Publicação falhou — sem media ID na resposta')

    // 4. Get permalink
    let permalink = 'https://www.instagram.com/'
    try {
      const info = await graphGet(`/${mediaId}`, { fields: 'permalink', access_token: accessToken })
      if (info.permalink) permalink = info.permalink
    } catch {}

    cleanup()
    send({ status: 'DONE', progress: 100, mediaId, permalink })
    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    console.error('[INSTAGRAM] upload error:', err.message)
    cleanup()
    send({ status: 'ERROR', error: err.message })
    res.write('data: [DONE]\n\n')
    res.end()
  }
})

module.exports = router

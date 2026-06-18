const express           = require('express')
const fs                = require('fs')
const path              = require('path')
const multer            = require('multer')
const tiktok            = require('../tiktokAuth')
const tiktokUpload      = require('../tiktokUpload')
const autoTikTok        = require('../autoTikTok')
const autoTikTokReplies = require('../autoTikTokReplies')

const router  = express.Router()
const TMP_DIR = path.join(__dirname, '../tmp')
fs.mkdirSync(TMP_DIR, { recursive: true })

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 1 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true)
    else cb(new Error('Apenas arquivos de vídeo são aceitos'))
  },
})

// GET /api/tiktok/status
router.get('/status', async (_req, res) => {
  const status = tiktok.getStatus()
  if (status.authenticated) {
    try {
      status.user = await tiktok.getUserInfo()
    } catch (err) {
      console.warn('[TIKTOK] getUserInfo failed:', err.message)
      status.user = null
    }
  }
  res.json(status)
})

// GET /api/tiktok/auth — returns OAuth URL
router.get('/auth', (_req, res) => {
  if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET) {
    return res.status(503).json({ error: 'TikTok credentials not configured in .env' })
  }
  try {
    const url = tiktok.getAuthUrl()
    res.json({ url })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

const POPUP_OK = `<!DOCTYPE html><html><head><style>
  *{margin:0;padding:0}
  body{background:#0c0c0c;color:#c0c0c0;font-family:'Courier New',monospace;
       display:flex;align-items:center;justify-content:center;height:100vh;}
  div{text-align:center}
  .ok{color:#00ff00;font-size:22px;letter-spacing:3px;margin-bottom:12px}
  .sub{color:#444;font-size:11px;letter-spacing:1px}
</style></head><body><div>
  <p class="ok">✓ TIKTOK CONECTADO</p>
  <p class="sub">a fechar esta janela...</p>
</div><script>setTimeout(()=>window.close(),1500)</script></body></html>`

const POPUP_ERR = (msg) => `<!DOCTYPE html><html><head><style>
  *{margin:0;padding:0}body{background:#0c0c0c;color:#c0c0c0;font-family:'Courier New',monospace;
  display:flex;align-items:center;justify-content:center;height:100vh;}
  div{text-align:center}.err{color:#ff4400;font-size:16px;letter-spacing:1px;margin-bottom:12px}
  .sub{color:#444;font-size:11px;letter-spacing:1px}
</style></head><body><div>
  <p class="err">⚠ ERRO: ${msg}</p>
  <p class="sub">Fecha esta janela e tenta novamente</p>
</div></body></html>`

// GET /api/tiktok/callback — OAuth callback (comes from GitHub Pages relay)
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query
  if (error) {
    console.error('[TIKTOK CALLBACK] OAuth error:', error, error_description)
    return res.send(POPUP_ERR(error_description || error))
  }
  try {
    await tiktok.handleCallback(code, state)
    console.log('[TIKTOK CALLBACK] Auth successful')
    res.send(POPUP_OK)
  } catch (err) {
    console.error('[TIKTOK CALLBACK]', err.message)
    res.send(POPUP_ERR(err.message))
  }
})

// POST /api/tiktok/logout
router.post('/logout', (_req, res) => {
  tiktok.logout()
  res.json({ ok: true })
})

// POST /api/tiktok/upload — SSE-streamed direct post (no inbox draft)
// Body: multipart/form-data — field "video" + optional field "description"
router.post('/upload', upload.single('video'), async (req, res) => {
  if (!tiktok.isAuthenticated()) {
    return res.status(401).json({ error: 'TikTok não conectado' })
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo de vídeo enviado' })
  }

  res.setHeader('Content-Type',      'text/event-stream')
  res.setHeader('Cache-Control',     'no-cache')
  res.setHeader('Connection',        'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const send    = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch {} }
  const cleanup = () => { if (req.file?.path) fs.unlink(req.file.path, () => {}) }

  try {
    const description   = req.body?.description   || ''
    const isDraft       = req.body?.isDraft === 'true' || req.body?.isDraft === true
    const scheduledTime = req.body?.scheduledTime ? parseInt(req.body.scheduledTime, 10) : null
    send({ status: 'UPLOADING', progress: 0 })

    const publishId = await tiktokUpload.uploadVideo(
      req.file.path,
      (p) => send({ status: 'UPLOADING', progress: p }),
      { description, privacyLevel: 'SELF_ONLY', isDraft, scheduledTime },
    )

    send({ status: 'DONE', publishId })
    console.log('[TIKTOK UPLOAD] Done, publish_id:', publishId)
    cleanup()
    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    console.error('[TIKTOK UPLOAD]', err.message)
    cleanup()
    send({ status: 'ERROR', error: err.message })
    res.write('data: [DONE]\n\n')
    res.end()
  }
})

// GET /api/tiktok/videos — list user's TikTok videos
router.get('/videos', async (_req, res) => {
  if (!tiktok.isAuthenticated()) return res.status(401).json({ error: 'Não conectado' })
  try {
    const token = await tiktok.getAccessToken()
    const r = await fetch(
      'https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,share_url,cover_image_url',
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ max_count: 20 }),
      }
    )
    const data = await r.json()
    if (data.error?.code !== 'ok') throw new Error(data.error?.message || JSON.stringify(data.error))
    res.json(data.data?.videos || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/tiktok/videos/:videoId
router.delete('/videos/:videoId', async (req, res) => {
  if (!tiktok.isAuthenticated()) return res.status(401).json({ error: 'Não conectado' })
  try {
    const token  = await tiktok.getAccessToken()
    const openId = tiktok.getOpenId()
    const r = await fetch('https://open.tiktokapis.com/v2/video/delete/', {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ video_id: req.params.videoId, open_id: openId }),
    })
    const data = await r.json()
    if (data.error?.code !== 'ok') throw new Error(data.error?.message || JSON.stringify(data.error))
    console.log('[TIKTOK] Video deleted:', req.params.videoId)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/tiktok/auto-status
router.get('/auto-status', (_req, res) => {
  res.json(autoTikTok.getStatus())
})

// POST /api/tiktok/auto-run — manual trigger
// Body (JSON, optional): { isDraft?: boolean, scheduledTime?: number }
router.post('/auto-run', (req, res) => {
  const isDraft       = req.body?.isDraft === true
  const scheduledTime = req.body?.scheduledTime ? parseInt(req.body.scheduledTime, 10) : null
  autoTikTok.runNow({ isDraft, scheduledTime })
    .then(result => res.json({ ok: true, result }))
    .catch(err  => res.status(500).json({ ok: false, error: err.message }))
})

// POST /api/tiktok/auto-reset-failed
router.post('/auto-reset-failed', (_req, res) => {
  autoTikTok.resetFailed()
  res.json({ ok: true })
})

// POST /api/tiktok/auto-reset-posted
router.post('/auto-reset-posted', (_req, res) => {
  autoTikTok.resetPosted()
  res.json({ ok: true })
})

// POST /api/tiktok/auto-reset-all
router.post('/auto-reset-all', (_req, res) => {
  autoTikTok.resetAll()
  res.json({ ok: true })
})

// GET /api/tiktok/replies-status
router.get('/replies-status', (_req, res) => {
  res.json(autoTikTokReplies.getStatus())
})

// POST /api/tiktok/run-replies
router.post('/run-replies', (_req, res) => {
  autoTikTokReplies.runNow()
    .then(()  => res.json({ ok: true }))
    .catch(err => res.status(500).json({ ok: false, error: err.message }))
})

module.exports = router

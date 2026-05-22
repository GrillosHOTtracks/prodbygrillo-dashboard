require('dotenv').config()
const express = require('express')
const multer  = require('multer')
const fs      = require('fs')
const path    = require('path')
const https   = require('https')
const http    = require('http')
const { Readable } = require('stream')
const { google }        = require('googleapis')
const accountManager    = require('../accountManager')
const { isQuotaError }  = require('../apiError')

const router   = express.Router()
const TMP_DIR  = path.join(__dirname, '../tmp')
const DATA_FILE = path.join(__dirname, '../data/uploads.json')

fs.mkdirSync(TMP_DIR,  { recursive: true })
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]')

const upload = multer({
  dest: TMP_DIR,
  limits: {
    fileSize:  2 * 1024 * 1024 * 1024, // 2 GB
    fieldSize: 20 * 1024 * 1024,        // 20 MB — AI descriptions + base64 thumbnail
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true)
    else cb(new Error('Apenas arquivos de vídeo são aceitos'))
  },
})

function readHistory()     { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) } catch { return [] } }
function writeHistory(arr) { fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2)) }

// ─── GET /api/upload/artist-photo?name= ─────────────────────────────────────
// Uses Deezer API — no key, no quota, picture_xl = 1000×1000px
router.get('/artist-photo', (req, res) => {
  const { name } = req.query
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' })

  const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=8`

  https.get(url, (apiRes) => {
    let body = ''
    apiRes.on('data', chunk => body += chunk)
    apiRes.on('end', () => {
      try {
        const json  = JSON.parse(body)
        const items = (json.data || [])
          .filter(a => a.picture_xl && !a.picture_xl.includes('//1000x1000'))
          .sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0))
          .map(a => ({ url: a.picture_xl, title: a.name, fans: a.nb_fan || 0 }))

        res.json({ results: items, current: items[0] || null })
      } catch (e) {
        res.status(500).json({ error: 'Deezer parse error: ' + e.message })
      }
    })
  }).on('error', (e) => res.status(502).json({ error: 'Deezer unreachable: ' + e.message }))
})

// ─── GET /api/upload/proxy-image?url= ───────────────────────────────────────
// Proxies external images so the frontend canvas can draw them cross-origin
router.get('/proxy-image', (req, res) => {
  const { url } = req.query
  if (!url || typeof url !== 'string') return res.status(400).end()
  let parsed
  try { parsed = new URL(url) } catch { return res.status(400).end() }
  if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).end()

  const client = url.startsWith('https') ? https : http
  const proxyReq = client.get(url, (imgRes) => {
    res.set('Content-Type',  imgRes.headers['content-type'] || 'image/jpeg')
    res.set('Cache-Control', 'public, max-age=3600')
    res.set('Access-Control-Allow-Origin', '*')
    imgRes.pipe(res)
  })
  proxyReq.on('error', () => res.status(502).end())
})

// ─── POST /api/upload/video ──────────────────────────────────────────────────
// Receives video file (multipart), then SSE-streams YouTube upload progress
router.post('/video', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo de vídeo enviado' })

  let meta = {}
  try { meta = JSON.parse(req.body.meta || '{}') } catch {}

  res.setHeader('Content-Type',     'text/event-stream')
  res.setHeader('Cache-Control',    'no-cache')
  res.setHeader('Connection',       'keep-alive')
  res.setHeader('X-Accel-Buffering','no')
  res.flushHeaders()

  const send    = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch {} }
  const cleanup = () => { if (req.file) fs.unlink(req.file.path, () => {}) }

  try {
    const auth     = accountManager.getAuthClient()
    const yt       = google.youtube({ version: 'v3', auth })
    const fileSize = req.file.size

    send({ status: 'UPLOADING', progress: 0 })

    const statusBody = {
      privacyStatus:          meta.scheduledAt ? 'private' : 'public',
      selfDeclaredMadeForKids: false,
    }
    if (meta.scheduledAt) statusBody.publishAt = new Date(meta.scheduledAt).toISOString()

    const insertRes = await yt.videos.insert(
      {
        part:        ['snippet', 'status'],
        requestBody: {
          snippet: {
            title:                meta.title        || 'Type Beat',
            description:          meta.description  || '',
            tags:                 meta.tags         || [],
            categoryId:           '10',
            defaultLanguage:      'pt',
            defaultAudioLanguage: 'pt',
          },
          status: statusBody,
        },
        media: {
          mimeType: req.file.mimetype || 'video/mp4',
          body:     fs.createReadStream(req.file.path),
        },
      },
      {
        onUploadProgress: (evt) => {
          const pct = fileSize > 0 ? Math.min(99, Math.round((evt.bytesRead / fileSize) * 100)) : 0
          send({ status: 'UPLOADING', progress: pct })
        },
      }
    )

    const videoId = insertRes.data.id
    send({ status: 'PROCESSING', progress: 100, videoId })

    // Upload custom thumbnail
    if (meta.thumbnailDataUrl && videoId) {
      try {
        const base64 = meta.thumbnailDataUrl.replace(/^data:image\/\w+;base64,/, '')
        const buf    = Buffer.from(base64, 'base64')
        await yt.thumbnails.set({
          videoId,
          media: { mimeType: 'image/jpeg', body: Readable.from(buf) },
        })
      } catch (thumbErr) {
        console.warn('[UPLOAD] thumbnail.set failed:', thumbErr.message)
      }
    }

    // Persist to history
    const history = readHistory()
    history.unshift({
      id:           videoId,
      title:        meta.title || 'Type Beat',
      publishedAt:  meta.scheduledAt || new Date().toISOString(),
      status:       meta.scheduledAt ? 'scheduled' : 'live',
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      videoUrl:     `https://youtu.be/${videoId}`,
      views:        0,
      uploadedAt:   new Date().toISOString(),
    })
    writeHistory(history)

    cleanup()
    const finalStatus = meta.scheduledAt ? 'SCHEDULED' : 'LIVE'
    send({ status: finalStatus, progress: 100, videoId, videoUrl: `https://youtu.be/${videoId}` })
    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    console.error('[UPLOAD] video error:', err.message)
    cleanup()
    const isScopeErr = /insufficient authentication scopes/i.test(err.message)
    send({
      status: 'ERROR',
      error:  isScopeErr
        ? 'Permissão de upload negada. Faça logout e conecte novamente para conceder acesso de upload.'
        : err.message,
      code: isScopeErr ? 'SCOPE_ERROR' : undefined,
    })
    res.write('data: [DONE]\n\n')
    res.end()
  }
})

// ─── GET /api/upload/history ─────────────────────────────────────────────────
router.get('/history', (_req, res) => {
  res.json(readHistory())
})

// ─── POST /api/upload/history/refresh — atualiza views via YouTube API ───────
router.post('/history/refresh', async (req, res) => {
  const history = readHistory()
  if (!history.length) return res.json([])

  try {
    const ids    = history.slice(0, 50).map(h => h.id)
    const result = await accountManager.withYouTube(async (auth) => {
      const yt = google.youtube({ version: 'v3', auth })
      return yt.videos.list({ part: ['statistics', 'status'], id: ids })
    })

    const stats = Object.fromEntries(
      (result.data.items || []).map(item => [
        item.id,
        {
          views:         parseInt(item.statistics?.viewCount || '0', 10),
          privacyStatus: item.status?.privacyStatus,
        },
      ])
    )

    const updated = history.map(h => ({
      ...h,
      views:  stats[h.id]?.views         ?? h.views,
      status: stats[h.id]?.privacyStatus === 'public'  ? 'live'
            : stats[h.id]?.privacyStatus === 'private' && h.status === 'scheduled' ? 'scheduled'
            : h.status,
    }))
    writeHistory(updated)
    res.json(updated)
  } catch (err) {
    if (isQuotaError(err)) return res.status(429).json({ error: 'Quota exceeded', code: 'quotaExceeded' })
    res.json(readHistory())
  }
})

// ─── GET /api/upload/tmp/:filename ───────────────────────────────────────────
// Serves temp video files via public URL so external APIs (Instagram, TikTok) can fetch them
router.get('/tmp/:filename', (req, res) => {
  const filename = path.basename(req.params.filename) // prevent path traversal
  const filepath = path.join(TMP_DIR, filename)
  if (!fs.existsSync(filepath)) return res.status(404).end()
  res.setHeader('Content-Type',  'video/mp4')
  res.setHeader('Cache-Control', 'no-store')
  fs.createReadStream(filepath).pipe(res)
})

// ─── DELETE /api/upload/history/:id ─────────────────────────────────────────
router.delete('/history/:id', (req, res) => {
  const history = readHistory().filter(e => e.id !== req.params.id)
  writeHistory(history)
  res.json({ ok: true })
})

module.exports = router

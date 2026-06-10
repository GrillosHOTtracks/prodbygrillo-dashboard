require('dotenv').config()
const express    = require('express')
const multer     = require('multer')
const fs         = require('fs')
const path       = require('path')
const https      = require('https')
const http       = require('http')
const { Readable }  = require('stream')
const { execFile }  = require('child_process')
const { google }        = require('googleapis')
const Groq              = require('groq-sdk')
const accountManager    = require('../accountManager')
const { isQuotaError }  = require('../apiError')
const autoPlaylists     = require('../autoPlaylists')
const autoReplies       = require('../autoReplies')
const autoComments      = require('../autoComments')

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

// YouTube tag budget: each tag + 2 if multi-word (quotes) + 1 comma separator; total ≤ 500
function sanitizeTags(raw) {
  const arr = Array.isArray(raw) ? raw : String(raw || '').split(',')
  const clean = arr
    .map(t => String(t).replace(/[<>"#&/\\]/g, '').replace(/\s+/g, ' ').trim())
    .filter(t => t.length > 0 && t.length <= 100)
  const result = []
  let total = 0
  for (const tag of clean) {
    const cost = tag.length + (tag.includes(' ') ? 2 : 0) + (result.length > 0 ? 1 : 0)
    if (total + cost > 496) break
    result.push(tag)
    total += cost
  }
  console.log('[UPLOAD] tags sent:', result.length, 'tags |', total, 'chars |', JSON.stringify(result))
  return result
}

// Cut a 59-second vertical Short (9:16 center-crop) starting at 15s
// <60s + portrait is required for YouTube to classify as a Short
function cutShort(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-i', inputPath, '-ss', '15', '-t', '59',
      // center-crop 16:9 → 9:16 portrait, then scale to 1080x1920 (standard Short res)
      '-vf', 'crop=ih*9/16:ih,scale=1080:1920',
      '-c:v', 'libx264', '-c:a', 'aac', '-preset', 'fast', '-crf', '23',
      '-y', outputPath,
    ], { timeout: 300000 }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

// ─── Artist photo helpers — no API key required ──────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, apiRes => {
      let body = ''
      apiRes.on('data', c => body += c)
      apiRes.on('end', () => { try { resolve(JSON.parse(body)) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function photosDeezer(name) {
  try {
    const d = await fetchJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=8`)
    return (d.data || [])
      .filter(a => a.picture_xl && !a.picture_xl.includes('//1000x1000'))
      .sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0))
      .slice(0, 5)
      .map(a => ({ url: a.picture_xl, title: a.name, source: 'deezer' }))
  } catch { return [] }
}

async function photosItunes(name) {
  try {
    const d = await fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=5`)
    return (d.results || [])
      .filter(a => a.artworkUrl100)
      .slice(0, 4)
      .map(a => ({ url: a.artworkUrl100.replace('100x100bb', '600x600bb'), title: a.artistName, source: 'itunes' }))
  } catch { return [] }
}

// ─── GET /api/upload/artist-photo?name= ─────────────────────────────────────
// Deezer (picture_xl 1000px) + iTunes (artwork 600px) — no API key required
router.get('/artist-photo', async (req, res) => {
  const { name } = req.query
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' })

  const [deezer, itunes] = await Promise.all([photosDeezer(name), photosItunes(name)])

  const seen = new Set()
  const items = [...deezer, ...itunes].filter(item => {
    if (!item.url || seen.has(item.url)) return false
    seen.add(item.url); return true
  })

  res.json({ results: items, current: items[0] || null })
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

    // scheduledAt must be a valid future ISO string; if it's in the past, ignore it
    const schedDate   = meta.scheduledAt ? new Date(meta.scheduledAt) : null
    const isScheduled = schedDate && !isNaN(schedDate) && schedDate > new Date()

    const statusBody = {
      privacyStatus:           isScheduled ? 'private' : 'public',
      selfDeclaredMadeForKids: false,
    }
    if (isScheduled) statusBody.publishAt = schedDate.toISOString()

    const finalTags = sanitizeTags(meta.tags)

    const insertRes = await yt.videos.insert(
      {
        part:        ['snippet', 'status'],
        requestBody: {
          snippet: {
            title:       meta.title || 'Type Beat',
            description: meta.description || '',
            tags:        finalTags,
            categoryId:  '10',
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
      publishedAt:  isScheduled ? schedDate.toISOString() : new Date().toISOString(),
      status:       isScheduled ? 'scheduled' : 'live',
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      videoUrl:     `https://youtu.be/${videoId}`,
      views:        0,
      uploadedAt:   new Date().toISOString(),
    })
    writeHistory(history)

    const finalStatus = isScheduled ? 'SCHEDULED' : 'LIVE'
    send({ status: finalStatus, progress: 100, videoId, videoUrl: `https://youtu.be/${videoId}` })

    // ── Engagement comment (AI-generated, specific to this video) ────────────
    try {
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
      const videoTitle = meta.title || 'Type Beat'
      const groqRes = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 120,
        messages: [{
          role: 'user',
          content: `You are prodbygrillo, a music producer. You just uploaded a YouTube beat video titled: "${videoTitle}"

Write ONE short comment (1-2 lines) to post on your own video that:
- Asks a question or calls for engagement specific to this beat's style/vibe
- Invites rappers/singers to drop their name or tag someone who'd sound fire on it
- Ends with the BeatStars link: https://www.beatstars.com/prodbygrillo
- Feels natural, not promotional — like a producer hyping their own track
- Use emojis sparingly (1-2 max)
- 20-35 words total

Reply with ONLY the comment text, nothing else.`,
        }],
      })
      const commentText = groqRes.choices[0]?.message?.content?.trim()
      if (commentText) {
        await yt.commentThreads.insert({
          part: ['snippet'],
          requestBody: {
            snippet: {
              videoId,
              topLevelComment: { snippet: { textOriginal: commentText } },
            },
          },
        })
        console.log('[UPLOAD] Engagement comment posted:', commentText.slice(0, 60))
      }
    } catch (engErr) {
      console.warn('[UPLOAD] Engagement comment failed:', engErr.message)
    }

    // ── Auto-playlist — add to correct style playlist ─────────────────────
    autoPlaylists.organiseVideo(videoId, meta.title || 'Type Beat').catch(() => {})

    // ── First-hour burst — trigger replies + comments immediately ──────────
    setTimeout(() => {
      console.log('[UPLOAD] First-hour burst triggered for', videoId)
      autoReplies.runNow().catch(() => {})
      autoComments.runNow().catch(() => {})
    }, 5 * 60 * 1000) // 5 min after upload completes

    // ── Short upload (optional) ────────────────────────────────────────────
    console.log('[UPLOAD] publishShort:', meta.publishShort)
    if (meta.publishShort) {
      const shortPath = req.file.path + '_short.mp4'
      try {
        console.log('[UPLOAD] cutting short from:', req.file.path)
        send({ status: 'SHORT_CUTTING' })
        await cutShort(req.file.path, shortPath)
        console.log('[UPLOAD] cutShort done, shortPath:', shortPath)

        send({ status: 'SHORT_UPLOADING' })
        const shortTitle = (meta.title || 'Type Beat').replace(/#shorts/gi, '').trim() + ' #shorts'
        const shortDesc  = `${meta.title || 'Type Beat'}\n\n💰 https://www.beatstars.com/prodbygrillo\n\nprod. prodbygrillo\n\n#shorts`

        // Short always goes live immediately — even when the main video is scheduled
        const shortStatus_ = { privacyStatus: 'public', selfDeclaredMadeForKids: false }

        const shortRes = await yt.videos.insert({
          part: ['snippet', 'status'],
          requestBody: {
            snippet: {
              title:       shortTitle,
              description: shortDesc,
              tags:        sanitizeTags(['shorts', 'type beat', 'free type beat', ...(meta.tags || []).slice(0, 4)]),
              categoryId:  '10',
            },
            status: shortStatus_,
          },
          media: { mimeType: 'video/mp4', body: fs.createReadStream(shortPath) },
        })

        const shortVideoId = shortRes.data.id
        console.log('[UPLOAD] SHORT_DONE shortVideoId:', shortVideoId)
        // Save short to history
        const hist2 = readHistory()
        hist2.unshift({
          id: shortVideoId, title: shortTitle,
          publishedAt: new Date().toISOString(),
          status: 'live',
          thumbnailUrl: `https://i.ytimg.com/vi/${shortVideoId}/hqdefault.jpg`,
          videoUrl: `https://youtu.be/${shortVideoId}`, views: 0,
          uploadedAt: new Date().toISOString(),
          isShort: true,
        })
        writeHistory(hist2)

        send({ status: 'SHORT_DONE', shortVideoId, shortUrl: `https://youtu.be/${shortVideoId}` })
      } catch (shortErr) {
        console.error('[UPLOAD] Short error:', shortErr.message)
        if (shortErr.response?.data) console.error('[UPLOAD] Short API error:', JSON.stringify(shortErr.response.data))
        send({ status: 'SHORT_ERROR', error: shortErr.message })
      } finally {
        fs.unlink(shortPath, () => {})
      }
    }

    cleanup()
    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    console.error('[UPLOAD] video error:', err.message)
    if (err.response?.data) console.error('[UPLOAD] API response:', JSON.stringify(err.response.data))
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
  const history = readHistory()
  const now = new Date()

  // Auto-promote scheduled entries whose publish date has passed
  let changed = false
  const updated = history.map(e => {
    if (e.status === 'scheduled' && new Date(e.publishedAt) <= now) {
      changed = true
      return { ...e, status: 'live' }
    }
    return e
  })

  if (changed) writeHistory(updated)
  res.json(updated)
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

// ─── POST /api/upload/create-short — download + cut + upload short ───────────
const YTDLP = 'C:\\Users\\Prodbygrillo\\AppData\\Local\\Microsoft\\WinGet\\Packages\\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\\yt-dlp.exe'

router.post('/create-short', async (req, res) => {
  const { videoId, title } = req.body
  if (!videoId) return res.status(400).json({ error: 'videoId required' })

  res.setHeader('Content-Type',     'text/event-stream')
  res.setHeader('Cache-Control',    'no-cache')
  res.setHeader('Connection',       'keep-alive')
  res.setHeader('X-Accel-Buffering','no')
  res.flushHeaders()

  const send    = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch {} }
  const tmpVideo = path.join(TMP_DIR, `${videoId}_dl.mp4`)
  const shortPath = path.join(TMP_DIR, `${videoId}_short.mp4`)
  const cleanup = () => { fs.unlink(tmpVideo, () => {}); fs.unlink(shortPath, () => {}) }

  try {
    // 1. Download original video
    send({ status: 'DOWNLOADING' })
    console.log('[CREATE-SHORT] downloading:', videoId)
    await new Promise((resolve, reject) => {
      execFile(YTDLP, [
        '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '-o', tmpVideo,
        '--no-playlist',
        `https://youtu.be/${videoId}`,
      ], { timeout: 300000 }, (err) => {
        if (err) { console.error('[CREATE-SHORT] download error:', err.message); reject(err) }
        else { console.log('[CREATE-SHORT] download done'); resolve() }
      })
    })

    // 2. Cut 59s vertical short
    send({ status: 'CUTTING' })
    await cutShort(tmpVideo, shortPath)
    console.log('[CREATE-SHORT] cut done')

    // 3. Upload to YouTube
    send({ status: 'UPLOADING' })
    const auth = accountManager.getAuthClient()
    const yt   = google.youtube({ version: 'v3', auth })
    const shortTitle = (title || 'Type Beat').replace(/#shorts/gi, '').trim() + ' #shorts'
    const shortDesc  = `${title || 'Type Beat'}\n\n💰 https://www.beatstars.com/prodbygrillo\n\nprod. prodbygrillo\n\n#shorts`

    const shortRes = await yt.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title:       shortTitle,
          description: shortDesc,
          tags:        sanitizeTags(['shorts', 'type beat', 'free type beat']),
          categoryId:  '10',
        },
        status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      },
      media: { mimeType: 'video/mp4', body: fs.createReadStream(shortPath) },
    })

    const shortVideoId = shortRes.data.id
    console.log('[CREATE-SHORT] done:', shortVideoId)
    const hist = readHistory()
    hist.unshift({
      id: shortVideoId, title: shortTitle,
      publishedAt: new Date().toISOString(), status: 'live',
      thumbnailUrl: `https://i.ytimg.com/vi/${shortVideoId}/hqdefault.jpg`,
      videoUrl: `https://youtu.be/${shortVideoId}`,
      views: 0, uploadedAt: new Date().toISOString(), isShort: true,
    })
    writeHistory(hist)

    send({ status: 'DONE', shortVideoId, shortUrl: `https://youtu.be/${shortVideoId}` })
    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    console.error('[CREATE-SHORT] error:', err.message)
    send({ status: 'ERROR', error: err.message })
    res.write('data: [DONE]\n\n')
    res.end()
  } finally {
    cleanup()
  }
})

// ─── GET /api/upload/auto-shorts/status ──────────────────────────────────────
router.get('/auto-shorts/status', (_req, res) => {
  const autoShorts = require('../autoShorts')
  res.json(autoShorts.getStatus())
})

// ─── POST /api/upload/auto-shorts/run-now ────────────────────────────────────
router.post('/auto-shorts/run-now', (_req, res) => {
  const autoShorts = require('../autoShorts')
  autoShorts.runNow()
  res.json({ ok: true, message: 'Processando próximo vídeo...' })
})

// ─── POST /api/upload/test-engagement-comment ────────────────────────────────
// Test the AI engagement comment on an existing video without uploading
router.post('/test-engagement-comment', async (req, res) => {
  const { videoId, title } = req.body
  if (!videoId || !title) return res.status(400).json({ error: 'videoId e title obrigatórios' })

  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
    const groqRes = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: `You are prodbygrillo, a music producer. You just uploaded a YouTube beat video titled: "${title}"

Write ONE short comment (1-2 lines) to post on your own video that:
- Asks a question or calls for engagement specific to this beat's style/vibe
- Invites rappers/singers to drop their name or tag someone who'd sound fire on it
- Ends with the BeatStars link: https://www.beatstars.com/prodbygrillo
- Feels natural, not promotional — like a producer hyping their own track
- Use emojis sparingly (1-2 max)
- 20-35 words total

Reply with ONLY the comment text, nothing else.`,
      }],
    })
    const commentText = groqRes.choices[0]?.message?.content?.trim()
    if (!commentText) return res.status(500).json({ error: 'Groq não gerou comentário' })

    const auth = accountManager.getAuthClient()
    const yt   = google.youtube({ version: 'v3', auth })
    await yt.commentThreads.insert({
      part: ['snippet'],
      requestBody: {
        snippet: {
          videoId,
          topLevelComment: { snippet: { textOriginal: commentText } },
        },
      },
    })

    console.log('[TEST-ENG-COMMENT] Posted on', videoId, ':', commentText.slice(0, 60))
    res.json({ ok: true, videoId, comment: commentText })
  } catch (err) {
    console.error('[TEST-ENG-COMMENT] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

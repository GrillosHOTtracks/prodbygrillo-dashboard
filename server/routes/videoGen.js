require('dotenv').config()
const express    = require('express')
const fs         = require('fs')
const path       = require('path')
const os         = require('os')
const { execFile, execFileSync, spawn } = require('child_process')
const multer     = require('multer')
const { search: innertubeSearch } = require('../lib/innertube')

const router  = express.Router()
const TMP_DIR = path.join(os.tmpdir(), 'prodbygrillo_vidgen')
fs.mkdirSync(TMP_DIR, { recursive: true })

const YTDLP = 'C:\\Users\\Prodbygrillo\\AppData\\Local\\Microsoft\\WinGet\\Packages\\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\\yt-dlp.exe'

const upload = multer({ dest: TMP_DIR, limits: { fileSize: 300 * 1024 * 1024 } })

const SKIP = /type[\s-]?beat|cover|reaction|remix|tutorial|karaoke|lyric|vevo\s+official|trailer|teaser|behind|making of/i

// Tracks which video IDs have already been downloaded this session — resets on server restart
const usedVideoIds = new Set()

const GENRE_QUERIES = {
  rnb:     (a, y) => [`${a} rnb music video ${y}`, `${a} r&b video ${y}`, `${a} official video ${y}`, `${a} vibe ${y}`, `${a} new video ${y}`],
  trap:    (a, y) => [`${a} music video ${y}`, `${a} official video ${y}`, `${a} official music video ${y}`, `${a} new video ${y}`, `${a} clip ${y}`],
  drill:   (a, y) => [`${a} drill music video ${y}`, `${a} official video ${y}`, `${a} music video ${y}`, `${a} new video ${y}`, `${a} clip ${y}`],
  pluggnb: (a, y) => [`${a} music video ${y}`, `${a} pluggnb ${y}`, `${a} aesthetic video ${y}`, `${a} official video ${y}`, `${a} new video ${y}`],
}

function getQueries(artist, genre) {
  const y = new Date().getFullYear()
  const g = (genre || '').toLowerCase().replace(/[\s-]/g, '')
  if (g.includes('rnb') || g.includes('r&b')) return GENRE_QUERIES.rnb(artist, y)
  if (g.includes('drill'))                     return GENRE_QUERIES.drill(artist, y)
  if (g.includes('pluggnb'))                   return GENRE_QUERIES.pluggnb(artist, y)
  return GENRE_QUERIES.trap(artist, y)
}

// Find a YouTube video URL for an artist, never repeating the same video
// Collects a pool from multiple search queries, shuffles, then picks the first unused one
async function findArtistVideo(artist, genre) {
  const firstWord = artist.toLowerCase().split(' ')[0]
  const queries = getQueries(artist, genre)

  const pool = []
  const seen = new Set()

  for (const q of queries) {
    try {
      const results = await innertubeSearch(q)
      for (const v of results) {
        if (seen.has(v.videoId)) continue
        seen.add(v.videoId)
        if (v.views < 5000) continue
        if (SKIP.test(v.title)) continue
        // Prefer videos that mention the artist name
        const nameMatch = v.title.toLowerCase().includes(firstWord)
        pool.push({ ...v, nameMatch })
      }
    } catch {}
  }

  if (pool.length === 0) return null

  // Sort: name-match first, then shuffle within each group for variety
  const withName    = pool.filter(v => v.nameMatch).sort(() => Math.random() - 0.5)
  const withoutName = pool.filter(v => !v.nameMatch).sort(() => Math.random() - 0.5)
  const ordered = [...withName, ...withoutName]

  // Pick the first video that hasn't been used in this session — never reuse
  const pick = ordered.find(v => !usedVideoIds.has(v.videoId))
  if (!pick) return null

  usedVideoIds.add(pick.videoId)
  console.log(`[VIDGEN] ${artist} → "${pick.title}" (${pick.videoId}) views=${pick.views}`)
  return `https://www.youtube.com/watch?v=${pick.videoId}`
}

// Download video-only clip with real-time progress via onProgress(0-100)
// Uses spawn to stream yt-dlp stdout and parse "[download] X%" lines
function downloadClip(url, outPath, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, [
      '-f', 'bestvideo[height<=720][vcodec^=avc][ext=mp4]/bestvideo[height<=720][vcodec!*=av01][ext=mp4]/bestvideo[height<=720][ext=mp4]/best[height<=720]',
      '--no-audio',
      '--newline',      // one progress line per stdout write
      '-o', outPath,
      '--no-playlist',
      url,
    ])

    let stderr = ''
    const parseYtdlpProgress = chunk => {
      const txt = chunk.toString()
      // yt-dlp writes "[download]  42.3% of ..." to stderr (not stdout)
      const m = txt.match(/\[download\]\s+(\d+(?:\.\d+)?)%/)
      if (m && onProgress) onProgress(parseFloat(m[1]))
    }
    proc.stdout.on('data', parseYtdlpProgress)
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); parseYtdlpProgress(chunk) })

    proc.on('close', code => {
      if (code !== 0) {
        console.error('[VIDGEN] yt-dlp stderr:', stderr.slice(-800))
        const errLine = stderr.split('\n').find(l => /ERROR:/i.test(l))
        return reject(new Error(errLine?.trim() || `Download falhou (código ${code})`))
      }
      resolve()
    })
  })
}

// Trim + scale a 7.5s segment from seekSecs, output at 1920x1080 h264
function trimClip(inputPath, outputPath, seekSecs = 30, durationSecs = 7.5) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-y',
      '-ss', String(seekSecs),
      '-i', inputPath,
      '-t', String(durationSecs),
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30',
      '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      outputPath,
    ], { timeout: 90000 }, (err, _stdout, stderr) => {
      if (err) return reject(new Error(`ffmpeg trim: ${stderr?.slice(-300) || err.message}`))
      resolve()
    })
  })
}

// Build final video: rotates through clips[] (each 7.5s) over audio
function buildVideo(clips, audioPath, outputPath, duration, onProgress) {
  const SEG = 7.5
  const segCount = Math.ceil(duration / SEG)
  const listLines = []
  for (let i = 0; i < segCount; i++) {
    listLines.push(`file '${clips[i % clips.length].replace(/\\/g, '/')}'`)
  }
  const listFile = path.join(TMP_DIR, `concat_${Date.now()}.txt`)
  fs.writeFileSync(listFile, listLines.join('\n'))

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-f', 'concat', '-safe', '0', '-i', listFile,
      '-i', audioPath,
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '192k',
      '-t', String(duration),
      outputPath,
    ])

    let stderr = ''
    proc.stderr.on('data', chunk => {
      const txt = chunk.toString()
      stderr += txt
      // Parse "time=HH:MM:SS.ms" from ffmpeg progress output
      const m = txt.match(/time=(\d+):(\d+):(\d+\.\d+)/)
      if (m && onProgress) {
        const secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3])
        const pct  = Math.min(99, Math.round((secs / duration) * 100))
        onProgress(pct)
      }
    })

    proc.on('close', code => {
      try { fs.unlinkSync(listFile) } catch {}
      if (code !== 0) return reject(new Error(`ffmpeg build: ${stderr.slice(-400)}`))
      resolve()
    })
  })
}

function cleanup(...files) {
  for (const f of files) { try { if (f && fs.existsSync(f)) fs.unlinkSync(f) } catch {} }
}

const pendingVideos = {}

// POST /api/video-gen/generate
router.post('/generate', upload.single('audio'), async (req, res) => {
  const audioFile       = req.file
  const anchorArtist    = (req.body.anchorArtist    || '').trim()
  const secondaryArtist = (req.body.secondaryArtist || '').trim()
  const genre           = (req.body.genre           || '').trim()

  if (!audioFile)       return res.status(400).json({ error: 'Nenhum arquivo de áudio enviado' })
  if (!anchorArtist)    return res.status(400).json({ error: 'anchorArtist obrigatório' })
  if (!secondaryArtist) return res.status(400).json({ error: 'secondaryArtist obrigatório' })

  const id        = Date.now()
  // 10 raw downloads — 5 different videos per artist
  const raw1a = path.join(TMP_DIR, `raw1a_${id}.mp4`)
  const raw1b = path.join(TMP_DIR, `raw1b_${id}.mp4`)
  const raw1c = path.join(TMP_DIR, `raw1c_${id}.mp4`)
  const raw1d = path.join(TMP_DIR, `raw1d_${id}.mp4`)
  const raw1e = path.join(TMP_DIR, `raw1e_${id}.mp4`)
  const raw2a = path.join(TMP_DIR, `raw2a_${id}.mp4`)
  const raw2b = path.join(TMP_DIR, `raw2b_${id}.mp4`)
  const raw2c = path.join(TMP_DIR, `raw2c_${id}.mp4`)
  const raw2d = path.join(TMP_DIR, `raw2d_${id}.mp4`)
  const raw2e = path.join(TMP_DIR, `raw2e_${id}.mp4`)
  // 10 trimmed 7.5s clips
  const clip1a = path.join(TMP_DIR, `clip1a_${id}.mp4`)
  const clip1b = path.join(TMP_DIR, `clip1b_${id}.mp4`)
  const clip1c = path.join(TMP_DIR, `clip1c_${id}.mp4`)
  const clip1d = path.join(TMP_DIR, `clip1d_${id}.mp4`)
  const clip1e = path.join(TMP_DIR, `clip1e_${id}.mp4`)
  const clip2a = path.join(TMP_DIR, `clip2a_${id}.mp4`)
  const clip2b = path.join(TMP_DIR, `clip2b_${id}.mp4`)
  const clip2c = path.join(TMP_DIR, `clip2c_${id}.mp4`)
  const clip2d = path.join(TMP_DIR, `clip2d_${id}.mp4`)
  const clip2e = path.join(TMP_DIR, `clip2e_${id}.mp4`)
  const audioPath = audioFile.path

  // Use the planned beat filename if provided, otherwise fall back to a generic name
  const rawFilename = (req.body.filename || '').trim()
  const safeFilename = rawFilename
    ? rawFilename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)
    : `type_beat_video_${id}`
  const output = path.join(TMP_DIR, `${safeFilename}.mp4`)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()  // send headers immediately so browser starts reading SSE

  // progress: 0-100 overall; msg: status text
  const send = (progress, msg, extra = {}) =>
    res.write(`data: ${JSON.stringify({ progress, msg, ...extra })}\n\n`)

  // Split compound names like "Summrs X Goyxrd X Pluggnb", "A & B", "A feat. B"
  // Returns individual artist names in order
  function splitArtists(name) {
    return name
      .split(/\s+[Xx&]\s+|\s+feat\.?\s+|\s+ft\.?\s+/i)
      .map(s => s.trim())
      .filter(s => s.length > 1)
  }

  // Try each candidate in order; fall back to fallbackArtist if all fail
  async function resolveVideo(name, fallbackArtist) {
    const candidates = splitArtists(name)
    for (const candidate of candidates) {
      const url = await findArtistVideo(candidate, genre)
      if (url) return { url, resolved: candidate }
    }
    // All candidates failed — use the anchor artist as fallback
    const url = await findArtistVideo(fallbackArtist, genre)
    return url ? { url, resolved: fallbackArtist } : null
  }

  // Seek points for 5 clips — spread across the video for variety
  const SEEKS = [20, 50, 80, 110, 140]

  try {
    // ── Search: 10 different videos (5 per artist) ────────────────────────
    send(1, `A procurar vídeos de ${anchorArtist}...`)
    const r1a = await resolveVideo(anchorArtist, anchorArtist); if (!r1a) throw new Error(`Sem vídeo para "${anchorArtist}"`)
    const r1b = await resolveVideo(anchorArtist, anchorArtist); if (!r1b) throw new Error(`Sem 2º vídeo para "${anchorArtist}"`)
    const r1c = await resolveVideo(anchorArtist, anchorArtist); if (!r1c) throw new Error(`Sem 3º vídeo para "${anchorArtist}"`)
    const r1d = await resolveVideo(anchorArtist, anchorArtist); if (!r1d) throw new Error(`Sem 4º vídeo para "${anchorArtist}"`)
    const r1e = await resolveVideo(anchorArtist, anchorArtist); if (!r1e) throw new Error(`Sem 5º vídeo para "${anchorArtist}"`)

    send(5, `A procurar vídeos de ${secondaryArtist}...`)
    const r2a = await resolveVideo(secondaryArtist, anchorArtist); if (!r2a) throw new Error(`Sem vídeo para "${secondaryArtist}"`)
    const resolvedSecondary = r2a.resolved
    if (resolvedSecondary !== secondaryArtist) send(6, `"${secondaryArtist}" → footage de ${resolvedSecondary}`)
    const r2b = await resolveVideo(secondaryArtist, anchorArtist); if (!r2b) throw new Error(`Sem 2º vídeo para "${resolvedSecondary}"`)
    const r2c = await resolveVideo(secondaryArtist, anchorArtist); if (!r2c) throw new Error(`Sem 3º vídeo para "${resolvedSecondary}"`)
    const r2d = await resolveVideo(secondaryArtist, anchorArtist); if (!r2d) throw new Error(`Sem 4º vídeo para "${resolvedSecondary}"`)
    const r2e = await resolveVideo(secondaryArtist, anchorArtist); if (!r2e) throw new Error(`Sem 5º vídeo para "${resolvedSecondary}"`)

    // ── Downloads: 10 clips ────────────────────────────────────────────────
    const dlStep = 5
    const downloads = [
      [r1a.url, raw1a, anchorArtist, 1], [r1b.url, raw1b, anchorArtist, 2],
      [r1c.url, raw1c, anchorArtist, 3], [r1d.url, raw1d, anchorArtist, 4],
      [r1e.url, raw1e, anchorArtist, 5],
      [r2a.url, raw2a, resolvedSecondary, 1], [r2b.url, raw2b, resolvedSecondary, 2],
      [r2c.url, raw2c, resolvedSecondary, 3], [r2d.url, raw2d, resolvedSecondary, 4],
      [r2e.url, raw2e, resolvedSecondary, 5],
    ]
    for (let i = 0; i < downloads.length; i++) {
      const [url, out, name, num] = downloads[i]
      const base = 8 + i * dlStep
      send(base, `A descarregar ${name} vídeo ${num}... 0%`)
      await downloadClip(url, out, pct => {
        send(base + Math.round(pct * dlStep / 100), `A descarregar ${name} vídeo ${num}... ${Math.round(pct)}%`)
      })
    }

    // ── Trim: 7.5s at staggered seek points ───────────────────────────────
    send(60, `A cortar clips...`)
    const trims = [
      [raw1a, clip1a], [raw1b, clip1b], [raw1c, clip1c], [raw1d, clip1d], [raw1e, clip1e],
      [raw2a, clip2a], [raw2b, clip2b], [raw2c, clip2c], [raw2d, clip2d], [raw2e, clip2e],
    ]
    for (let i = 0; i < trims.length; i++) {
      await trimClip(trims[i][0], trims[i][1], SEEKS[i % 5], 7.5)
    }

    // ── Build: alternate 10 clips over audio ──────────────────────────────
    const TARGET = 95
    send(70, 'A montar vídeo final (1:35)...')
    await buildVideo(
      [clip1a, clip2a, clip1b, clip2b, clip1c, clip2c, clip1d, clip2d, clip1e, clip2e],
      audioPath, output, TARGET, pct => {
        send(70 + Math.round(pct * 0.29), `A montar vídeo... ${pct}%`)
      }
    )

    const allRaw  = [raw1a, raw1b, raw1c, raw1d, raw1e, raw2a, raw2b, raw2c, raw2d, raw2e]
    const allClip = [clip1a, clip1b, clip1c, clip1d, clip1e, clip2a, clip2b, clip2c, clip2d, clip2e]
    cleanup(...allRaw, ...allClip, audioPath)

    const token = `vidgen_${id}`
    pendingVideos[token] = { path: output, filename: `${safeFilename}.mp4` }
    setTimeout(() => { cleanup(output); delete pendingVideos[token] }, 30 * 60 * 1000)

    send(100, 'Vídeo gerado!', { step: 'done', token })
    res.end()
  } catch (err) {
    const allRawE  = [raw1a, raw1b, raw1c, raw1d, raw1e, raw2a, raw2b, raw2c, raw2d, raw2e]
    const allClipE = [clip1a, clip1b, clip1c, clip1d, clip1e, clip2a, clip2b, clip2c, clip2d, clip2e]
    cleanup(...allRawE, ...allClipE, audioPath)
    res.write(`data: ${JSON.stringify({ step: 'error', progress: 0, msg: err.message })}\n\n`)
    res.end()
  }
})

// GET /api/video-gen/download/:token
router.get('/download/:token', (req, res) => {
  const entry = pendingVideos[req.params.token]
  if (!entry || !fs.existsSync(entry.path)) {
    return res.status(404).json({ error: 'Vídeo não encontrado ou expirado' })
  }
  // Keep the file alive — do NOT delete here so the user can still click "usar para upload"
  // The 30-min setTimeout in /generate handles cleanup
  res.download(entry.path, entry.filename)
})

module.exports = router

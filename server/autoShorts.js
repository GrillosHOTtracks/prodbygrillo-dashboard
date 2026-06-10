const fs        = require('fs')
const path      = require('path')
const { execFile } = require('child_process')
const { google }   = require('googleapis')

const DATA_FILE  = path.join(__dirname, 'data/uploads.json')
const TMP_DIR    = path.join(__dirname, 'tmp')
const YTDLP      = 'C:\\Users\\Prodbygrillo\\AppData\\Local\\Microsoft\\WinGet\\Packages\\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\\yt-dlp.exe'
const INTERVAL_MS = 2 * 60 * 60 * 1000  // 2 hours

fs.mkdirSync(TMP_DIR, { recursive: true })

function readHistory()     { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) } catch { return [] } }
function writeHistory(arr) { fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2)) }

function sanitizeTags(raw) {
  const arr = Array.isArray(raw) ? raw : String(raw || '').split(',')
  const clean = arr.map(t => String(t).replace(/[<>"#&/\\]/g, '').replace(/\s+/g, ' ').trim()).filter(t => t.length > 0 && t.length <= 100)
  const result = []; let total = 0
  for (const tag of clean) {
    const cost = tag.length + (tag.includes(' ') ? 2 : 0) + (result.length > 0 ? 1 : 0)
    if (total + cost > 496) break
    result.push(tag); total += cost
  }
  return result
}

function cutShort(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-i', inputPath, '-ss', '15', '-t', '59',
      '-vf', 'crop=ih*9/16:ih,scale=1080:1920',
      '-c:v', 'libx264', '-c:a', 'aac', '-preset', 'fast', '-crf', '23',
      '-y', outputPath,
    ], { timeout: 300000 }, (err) => err ? reject(err) : resolve())
  })
}

// Find next video that needs a short (not itself a short, no matching short in history)
function findPending() {
  const history = readHistory()
  const shortTitles = new Set(
    history.filter(e => e.isShort).map(e => e.title.replace(/\s*#shorts\s*$/i, '').trim())
  )
  return history.filter(e => !e.isShort && e.status === 'live' && !shortTitles.has(e.title.trim()))
}

// State
let nextRunAt   = Date.now() + INTERVAL_MS
let lastResult  = null
let running     = false
let accountMgr  = null

async function processNext() {
  if (running || !accountMgr || !accountMgr.isAuthenticated()) return
  const pending = findPending()
  if (!pending.length) {
    console.log('[AUTO-SHORT] No pending videos')
    return
  }

  const entry = pending[0]
  running = true
  console.log('[AUTO-SHORT] Processing:', entry.id, entry.title)
  lastResult = { id: entry.id, title: entry.title, status: 'running', startedAt: new Date().toISOString() }

  const tmpVideo  = path.join(TMP_DIR, `${entry.id}_dl.mp4`)
  const shortPath = path.join(TMP_DIR, `${entry.id}_short.mp4`)
  const cleanup   = () => { fs.unlink(tmpVideo, () => {}); fs.unlink(shortPath, () => {}) }

  try {
    // 1. Download
    console.log('[AUTO-SHORT] Downloading:', entry.id)
    await new Promise((resolve, reject) => {
      execFile(YTDLP, [
        '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '-o', tmpVideo, '--no-playlist',
        `https://youtu.be/${entry.id}`,
      ], { timeout: 300000 }, (err) => err ? reject(err) : resolve())
    })

    // 2. Cut
    console.log('[AUTO-SHORT] Cutting short for:', entry.id)
    await cutShort(tmpVideo, shortPath)

    // 3. Upload
    console.log('[AUTO-SHORT] Uploading short for:', entry.id)
    const auth = accountMgr.getAuthClient()
    const yt   = google.youtube({ version: 'v3', auth })
    const shortTitle = entry.title.replace(/#shorts/gi, '').trim() + ' #shorts'
    const shortDesc  = `${entry.title}\n\n💰 https://www.beatstars.com/prodbygrillo\n\nprod. prodbygrillo\n\n#shorts`

    const shortRes = await yt.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: { title: shortTitle, description: shortDesc, tags: sanitizeTags(['shorts', 'type beat', 'free type beat']), categoryId: '10' },
        status:  { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      },
      media: { mimeType: 'video/mp4', body: fs.createReadStream(shortPath) },
    })

    const shortVideoId = shortRes.data.id
    console.log('[AUTO-SHORT] Done:', shortVideoId)

    const hist = readHistory()
    hist.unshift({
      id: shortVideoId, title: shortTitle,
      publishedAt: new Date().toISOString(), status: 'live',
      thumbnailUrl: `https://i.ytimg.com/vi/${shortVideoId}/hqdefault.jpg`,
      videoUrl: `https://youtu.be/${shortVideoId}`,
      views: 0, uploadedAt: new Date().toISOString(), isShort: true,
    })
    writeHistory(hist)

    lastResult = { id: entry.id, shortId: shortVideoId, title: shortTitle, status: 'done', finishedAt: new Date().toISOString() }
  } catch (err) {
    console.error('[AUTO-SHORT] Error:', err.message)
    lastResult = { id: entry.id, title: entry.title, status: 'error', error: err.message, finishedAt: new Date().toISOString() }
  } finally {
    cleanup()
    running = false
  }
}

function start(mgr) {
  accountMgr = mgr
  console.log('[AUTO-SHORT] Scheduler started — interval: 2h | pending:', findPending().length)
  setInterval(async () => {
    nextRunAt = Date.now() + INTERVAL_MS
    await processNext()
  }, INTERVAL_MS)
}

function getStatus() {
  const pending = findPending()
  return {
    running,
    pending:   pending.length,
    nextRunAt: new Date(nextRunAt).toISOString(),
    msUntilNext: Math.max(0, nextRunAt - Date.now()),
    lastResult,
    queue: pending.slice(0, 5).map(e => ({ id: e.id, title: e.title })),
  }
}

function runNow() {
  nextRunAt = Date.now() + INTERVAL_MS
  return processNext()
}

module.exports = { start, getStatus, runNow }

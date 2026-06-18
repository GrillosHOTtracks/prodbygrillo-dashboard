require('dotenv').config()
const fs           = require('fs')
const path         = require('path')
const { execFile } = require('child_process')
const Groq         = require('groq-sdk')
const tiktok       = require('./tiktokAuth')
const tiktokUpload = require('./tiktokUpload')

const DATA_FILE    = path.join(__dirname, 'data/uploads.json')
const STATE_FILE   = path.join(__dirname, 'data/tiktok-auto-state.json')
const TMP_DIR      = path.join(__dirname, 'tmp')
const YTDLP        = 'C:\\Users\\Prodbygrillo\\AppData\\Local\\Microsoft\\WinGet\\Packages\\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\\yt-dlp.exe'

const INTERVAL_MS    = 6 * 60 * 60 * 1000  // 6h between posts → ~4 posts/day
const CLIPS_PER_VIDEO = 4                   // 30s clips extracted per video
const CLIP_DURATION   = 30                  // seconds

fs.mkdirSync(TMP_DIR, { recursive: true })

function readHistory() { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) } catch { return [] } }
function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
    if (!Array.isArray(s.clips))           s.clips = []
    if (!Array.isArray(s.extractedVideos)) s.extractedVideos = []
    if (!Array.isArray(s.posted))          s.posted = []
    if (!Array.isArray(s.failed))          s.failed = []
    return s
  } catch {
    return { posted: [], failed: [], clips: [], extractedVideos: [], inProgress: null, lastRunAt: null, lastDescription: null }
  }
}
function writeState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)) }

// Remove orphan working files on startup (not clip files — those are queued)
function cleanupTmp() {
  try {
    fs.readdirSync(TMP_DIR)
      .filter(f => f.startsWith('tiktok_raw_') || f.startsWith('tiktok_full_'))
      .forEach(f => { try { fs.unlinkSync(path.join(TMP_DIR, f)) } catch {} })
  } catch {}
}

// Find videos not yet extracted (not in extractedVideos, not failed)
function findPendingVideos() {
  const state   = readState()
  const history = readHistory()
  const extracted = new Set(state.extractedVideos)
  return history.filter(e =>
    !e.isShort &&
    e.status === 'live' &&
    !state.failed.includes(e.id) &&
    !extracted.has(e.id) &&
    state.inProgress !== e.id
  )
}

// Get video duration in seconds via ffprobe
function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', [
      '-v', 'quiet', '-print_format', 'json',
      '-show_format', '-show_streams', filePath,
    ], { timeout: 30000 }, (err, stdout) => {
      if (err) return reject(err)
      try {
        const data     = JSON.parse(stdout)
        const duration = parseFloat(data.format?.duration || data.streams?.[0]?.duration || '0')
        resolve(duration)
      } catch (e) { reject(e) }
    })
  })
}

// Extract a 30s clip: center-crop to 9:16, scale to 4K portrait
function encodeClip(inputPath, outputPath, startTime) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-ss', String(startTime),
      '-i', inputPath,
      '-t', String(CLIP_DURATION),
      '-vf', 'crop=ih*9/16:ih,scale=-2:3840:flags=lanczos',
      '-c:v', 'libx264', '-c:a', 'aac',
      '-preset', 'fast', '-crf', '18',
      '-movflags', '+faststart',
      '-y', outputPath,
    ], { timeout: 300000 }, (err) => err ? reject(err) : resolve())
  })
}

// AI TikTok caption with YT link + viral hashtags
async function generateDescription(title, videoId) {
  try {
    if (!process.env.GROQ_API_KEY) return null
    const groq       = new Groq({ apiKey: process.env.GROQ_API_KEY })
    const cleanTitle = title.replace(/#shorts\s*$/i, '').replace(/\[FREE\]\s*/i, '').trim()
    const ytLink     = `https://youtu.be/${videoId}`
    const res = await Promise.race([
      groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 180,
        messages: [{ role: 'user', content: `You are prodbygrillo, a music producer. Write a TikTok caption for a beat video titled: "${cleanTitle}"

Rules:
- 2-3 short lines only
- Ask 1 question to drive comments (who sounds fire on this? drop your name etc)
- Last content line: 🔗 ${ytLink}
- Final line: 6-8 hashtags — must include 2-3 viral TikTok tags (#fyp #foryou #foryoupage #viral #trending) plus genre tags (#typebeat #freebeat #hiphop #trapmusic etc)
- Max 3 emojis total
- Sound natural, like a real producer

Reply with ONLY the caption. No intro, no explanation.` }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Groq timeout')), 25000)),
    ])
    return res.choices[0]?.message?.content?.trim() || null
  } catch (err) {
    console.warn('[AUTO-TIKTOK] Caption failed:', err.message)
    return null
  }
}

let running    = false
let lastResult = null
let nextRunAt  = Date.now() + INTERVAL_MS

async function processNext(opts = {}) {
  if (running) return { skipped: true, reason: 'already running' }
  if (!tiktok.isAuthenticated()) return { skipped: true, reason: 'not authenticated' }
  const { isDraft = false, scheduledTime = null } = opts

  running = true
  const state = readState()

  // ── Phase A: post next queued clip ────────────────────────────────────────
  if (state.clips.length > 0) {
    const clip     = state.clips[0]
    const clipPath = path.join(TMP_DIR, `tiktok_clip_${clip.videoId}_${clip.startTime}.mp4`)

    // If pre-encoded file was deleted (server restart / manual cleanup), re-queue the video
    if (!fs.existsSync(clipPath)) {
      console.warn('[AUTO-TIKTOK] Clip file missing, re-queuing video:', clip.videoId)
      state.clips = state.clips.filter(c => c.videoId !== clip.videoId)
      state.extractedVideos = (state.extractedVideos || []).filter(id => id !== clip.videoId)
      writeState(state)
      running = false
      return processNext(opts)
    }

    lastResult = { id: clip.videoId, title: clip.title, clipIdx: clip.clipIdx, status: 'running', startedAt: new Date().toISOString() }
    console.log(`[AUTO-TIKTOK] Posting clip ${clip.clipIdx + 1} of ${clip.totalClips} from "${clip.title}"`)

    try {
      const description = await generateDescription(clip.title, clip.videoId)
      if (description) console.log('[AUTO-TIKTOK] Caption:', description.slice(0, 80), '...')

      const modeLabel = isDraft ? 'DRAFT' : scheduledTime ? `SCHEDULED` : 'DIRECT'
      console.log(`[AUTO-TIKTOK] Uploading [${modeLabel}]...`)
      const publishId = await tiktokUpload.uploadVideo(clipPath, (p) => {
        if (p % 25 === 0) console.log(`[AUTO-TIKTOK] ${p}%`)
      }, { description, privacyLevel: 'SELF_ONLY', isDraft, scheduledTime })

      // Remove clip from queue and mark posted
      state.clips = state.clips.slice(1)
      state.posted.push(`${clip.videoId}:${clip.startTime}`)
      state.lastRunAt       = new Date().toISOString()
      state.lastDescription = description
      state.inProgress      = null
      writeState(state)

      try { fs.unlinkSync(clipPath) } catch {}

      lastResult = { id: clip.videoId, title: clip.title, clipIdx: clip.clipIdx, totalClips: clip.totalClips, publishId, description, status: 'done', finishedAt: new Date().toISOString() }
      console.log(`[AUTO-TIKTOK] Clip posted. Queue remaining: ${state.clips.length}`)
      return { posted: `${clip.videoId}:${clip.startTime}`, remaining: state.clips.length }

    } catch (err) {
      console.error('[AUTO-TIKTOK] Upload error:', err.message)
      state.inProgress = null
      writeState(state)
      lastResult = { id: clip.videoId, title: clip.title, status: 'error', error: err.message, finishedAt: new Date().toISOString() }
      return { error: err.message }
    } finally {
      running = false
    }
  }

  // ── Phase B: no clips queued — download next video and extract clips ──────
  const pendingVideos = findPendingVideos()
  if (!pendingVideos.length) {
    console.log('[AUTO-TIKTOK] No pending videos')
    running = false
    return { done: true, remaining: 0 }
  }

  const entry   = pendingVideos[0]
  const rawPath = path.join(TMP_DIR, `tiktok_raw_${entry.id}.mp4`)
  lastResult    = { id: entry.id, title: entry.title, status: 'extracting', startedAt: new Date().toISOString() }
  console.log('[AUTO-TIKTOK] Extracting clips from:', entry.id, '|', entry.title)

  state.inProgress = entry.id
  writeState(state)

  try {
    // 1. Download (limit to 1080p — upscale to 4K in ffmpeg)
    console.log('[AUTO-TIKTOK] Downloading...')
    await new Promise((resolve, reject) => {
      execFile(YTDLP, [
        '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '-o', rawPath, '--no-playlist',
        `https://youtu.be/${entry.id}`,
      ], { timeout: 600000 }, (err) => err ? reject(err) : resolve())
    })

    // 2. Get duration and compute clip start times
    const duration = await getVideoDuration(rawPath)
    console.log(`[AUTO-TIKTOK] Duration: ${Math.round(duration)}s`)

    if (duration < CLIP_DURATION) throw new Error(`Vídeo demasiado curto: ${Math.round(duration)}s`)

    // Space clips evenly, avoiding the last few seconds
    const maxStart    = duration - CLIP_DURATION
    const numClips    = Math.min(CLIPS_PER_VIDEO, Math.floor(maxStart / 10) + 1)
    const startTimes  = Array.from({ length: numClips }, (_, i) =>
      Math.floor((maxStart / Math.max(numClips - 1, 1)) * i)
    )
    console.log(`[AUTO-TIKTOK] Extracting ${numClips} clips at: ${startTimes.map(t => t + 's').join(', ')}`)

    // 3. Encode each clip (crop 9:16, scale 4K)
    const newClips = []
    for (let i = 0; i < startTimes.length; i++) {
      const t        = startTimes[i]
      const clipPath = path.join(TMP_DIR, `tiktok_clip_${entry.id}_${t}.mp4`)
      console.log(`[AUTO-TIKTOK] Encoding clip ${i + 1}/${numClips} (t=${t}s)...`)
      await encodeClip(rawPath, clipPath, t)
      newClips.push({ videoId: entry.id, title: entry.title, startTime: t, clipIdx: i, totalClips: numClips })
    }

    // 4. Update state
    const s = readState()
    s.clips.push(...newClips)
    s.extractedVideos = [...(s.extractedVideos || []), entry.id]
    s.inProgress = null
    writeState(s)

    console.log(`[AUTO-TIKTOK] ${numClips} clips queued for "${entry.title}"`)
    lastResult = { id: entry.id, title: entry.title, status: 'queued', clips: numClips, finishedAt: new Date().toISOString() }
    return { queued: numClips, videoId: entry.id }

  } catch (err) {
    console.error('[AUTO-TIKTOK] Extraction error:', err.message)
    const s = readState()
    s.failed.push(entry.id)
    s.inProgress = null
    writeState(s)
    lastResult = { id: entry.id, title: entry.title, status: 'error', error: err.message, finishedAt: new Date().toISOString() }
    return { error: err.message }
  } finally {
    running = false
    try { fs.unlinkSync(rawPath) } catch {}
  }
}

function start() {
  cleanupTmp()

  const state = readState()
  if (state.inProgress) {
    console.log('[AUTO-TIKTOK] Clearing stale inProgress:', state.inProgress)
    state.inProgress = null
    writeState(state)
  }

  const pendingClips   = state.clips?.length || 0
  const pendingVideos  = findPendingVideos().length
  const lastRun        = state.lastRunAt ? new Date(state.lastRunAt).getTime() : 0
  const delay          = Math.max(60 * 1000, lastRun + INTERVAL_MS - Date.now())
  nextRunAt            = Date.now() + delay

  console.log(`[AUTO-TIKTOK] Started — clips queued: ${pendingClips} | videos pending: ${pendingVideos} | next in: ${Math.round(delay / 60000)}min`)

  ;(function tick() {
    const wait = Math.max(60 * 1000, nextRunAt - Date.now())
    setTimeout(async () => {
      nextRunAt = Date.now() + INTERVAL_MS
      try { await processNext({ isDraft: true }) }
      catch (err) { console.error('[AUTO-TIKTOK] Tick error:', err.message) }
      finally { tick() }
    }, wait)
  })()
}

function getStatus() {
  const state         = readState()
  const pendingVideos = findPendingVideos()
  return {
    running,
    posted:         state.posted.length,
    failed:         state.failed.length,
    clipsQueued:    state.clips.length,
    pendingVideos:  pendingVideos.length,
    lastRunAt:      state.lastRunAt,
    nextRunAt:      new Date(nextRunAt).toISOString(),
    msUntilNext:    Math.max(0, nextRunAt - Date.now()),
    lastResult,
    lastDescription: state.lastDescription || null,
    clips: state.clips.slice(0, 5).map(c => ({
      id: c.videoId, title: c.title,
      clip: `${c.clipIdx + 1}/${c.totalClips}`, startTime: c.startTime,
    })),
    queue: pendingVideos.slice(0, 5).map(e => ({ id: e.id, title: e.title, url: `https://youtu.be/${e.id}` })),
  }
}

function runNow(opts = {})  { nextRunAt = Date.now() + INTERVAL_MS; return processNext(opts) }
function resetFailed()      { const s = readState(); s.failed = []; writeState(s) }
function resetPosted()      { const s = readState(); s.posted = []; s.extractedVideos = []; writeState(s) }
function resetAll()         {
  // Also delete pre-encoded clip files
  try {
    fs.readdirSync(TMP_DIR)
      .filter(f => f.startsWith('tiktok_clip_'))
      .forEach(f => { try { fs.unlinkSync(path.join(TMP_DIR, f)) } catch {} })
  } catch {}
  writeState({ posted: [], failed: [], clips: [], extractedVideos: [], inProgress: null, lastRunAt: null, lastDescription: null })
}

module.exports = { start, getStatus, runNow, resetFailed, resetPosted, resetAll }

const fs        = require('fs')
const path      = require('path')
const { execFile } = require('child_process')
const { google }   = require('googleapis')

const DATA_FILE   = path.join(__dirname, 'data/uploads.json')
const STATE_FILE  = path.join(__dirname, 'data/shorts-state.json')
const TMP_DIR     = path.join(__dirname, 'tmp')
const YTDLP      = 'C:\\Users\\Prodbygrillo\\AppData\\Local\\Microsoft\\WinGet\\Packages\\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\\yt-dlp.exe'
const TICK_MS = 10 * 60 * 1000  // check every 10 minutes

fs.mkdirSync(TMP_DIR, { recursive: true })

function readHistory()      { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) } catch { return [] } }
function writeHistory(arr) { fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2)) }
function readState()       { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) } catch { return {} } }
function writeState(s)     { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)) }

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

// Extract artist names from a type beat title
// e.g. '[FREE] Gunna Type Beat - "Dark Nights" | Hurricane Wisdom Type Beat'
//   → ['Gunna', 'Hurricane Wisdom']
function extractArtists(title) {
  return title
    .split('|')
    .map(seg =>
      seg
        .replace(/\[.*?\]/g, '')          // remove [FREE], [FREE USE], etc.
        .replace(/"[^"]*"/g, '')           // remove "Song Name"
        .replace(/\btype\s*beat\b/gi, '')  // remove "type beat"
        .replace(/[-–—]+/g, ' ')           // dashes → space
        .replace(/[^a-zA-Z0-9\s']/g, ' ') // strip punctuation except apostrophes
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(name => name.length > 0)
}

// Build description and tags for a Short based on its title
function buildShortsDescription(title) {
  const artists = extractArtists(title)

  // Artist-specific hashtags come first (shown above title in Shorts UI)
  const artistHashtags = artists.flatMap(a => {
    const slug = a.toLowerCase().replace(/\s+/g, '')
    return [`#${slug}typebeat`, `#${slug}`]
  })

  const evergreenHashtags = ['#typebeat', '#freebeat', '#trap', '#shorts', '#prodbygrillo', `#freebeat${new Date().getFullYear()}`]

  const allHashtags = [...new Set([...artistHashtags, ...evergreenHashtags])]

  const desc = [
    title,
    '',
    '💰 https://www.beatstars.com/prodbygrillo',
    '',
    'prod. prodbygrillo',
    '',
    allHashtags.join(' '),
  ].join('\n')

  const tags = sanitizeTags([
    'shorts',
    'type beat',
    'free type beat',
    ...artists.map(a => `${a.toLowerCase()} type beat`),
    ...artists.map(a => a.toLowerCase()),
    'trap',
    'prod by prodbygrillo',
  ])

  return { desc, tags }
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

const FIXED_HOURS  = [0, 3, 6, 10, 12, 13, 16, 18, 19, 21, 23]  // fixed posting times (local time)
const DAILY_LIMIT  = FIXED_HOURS.length

// All eligible source videos (live, not a short themselves)
function allEligible() {
  return readHistory().filter(e => !e.isShort && e.status === 'live')
}

// Pick a random video using cycle rotation:
// cycles through all eligible videos in random order, resets when all have been used
function pickRandom() {
  const eligible = allEligible()
  if (!eligible.length) return null

  const state    = readState()
  let usedCycle  = Array.isArray(state.usedCycle) ? state.usedCycle : []

  // Filter to videos not yet used in this cycle
  let pool = eligible.filter(e => !usedCycle.includes(e.id))

  if (!pool.length) {
    // All videos used — reset cycle
    console.log('[AUTO-SHORT] Cycle complete — resetting rotation')
    usedCycle = []
    pool = eligible
  }

  // Pick one at random from the pool
  return pool[Math.floor(Math.random() * pool.length)]
}

// State
let nextRunAt   = Date.now() + TICK_MS
let lastResult  = null
let running     = false
let accountMgr  = null

function shortsUploadedToday() {
  const today = new Date().toISOString().slice(0, 10)
  return readHistory().filter(e => e.isShort && e.uploadedAt?.startsWith(today)).length
}

async function processNext() {
  if (running || !accountMgr || !accountMgr.isAuthenticated()) return

  const todayCount = shortsUploadedToday()
  if (todayCount >= DAILY_LIMIT) {
    console.log(`[AUTO-SHORT] Daily limit reached (${DAILY_LIMIT}/day) — skipping`)
    return
  }

  const entry = pickRandom()
  if (!entry) {
    console.log('[AUTO-SHORT] No eligible videos')
    return
  }
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
    const shortTitle             = entry.title.replace(/#shorts/gi, '').trim() + ' #shorts'
    const { desc: shortDesc, tags: shortTags } = buildShortsDescription(entry.title)

    const shortRes = await yt.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: { title: shortTitle, description: shortDesc, tags: shortTags, categoryId: '10' },
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

    // Mark video as used in the current cycle
    const st = readState()
    const used = Array.isArray(st.usedCycle) ? st.usedCycle : []
    if (!used.includes(entry.id)) used.push(entry.id)
    writeState({ lastRunAt: new Date().toISOString(), usedCycle: used })
  } catch (err) {
    console.error('[AUTO-SHORT] Error:', err.message)
    lastResult = { id: entry.id, title: entry.title, status: 'error', error: err.message, finishedAt: new Date().toISOString() }
    writeState({ ...readState(), lastRunAt: new Date().toISOString() })
  } finally {
    cleanup()
    running = false
  }
}

// Build today's schedule from fixed hours (local time).
// Persisted in state so server restarts don't rebuild mid-day.
function buildTodaySchedule() {
  const today = new Date().toISOString().slice(0, 10)
  const state = readState()
  if (state.scheduleDate === today && Array.isArray(state.todaySchedule) && state.todaySchedule.length === DAILY_LIMIT) {
    return state.todaySchedule
  }
  const times = FIXED_HOURS.map(h => {
    const d = new Date()
    d.setHours(h, 0, 0, 0)
    return d.getTime()
  })
  writeState({ ...state, scheduleDate: today, todaySchedule: times })
  console.log('[AUTO-SHORT] Daily schedule:', times.map(t => new Date(t).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })).join(' · '))
  return times
}

function nextScheduledSlot() {
  const schedule = buildTodaySchedule()
  return schedule.find(t => t > Date.now()) ?? null
}

function start(mgr) {
  accountMgr = mgr
  const eligible  = allEligible()
  const state     = readState()
  const usedCycle = Array.isArray(state.usedCycle) ? state.usedCycle : []
  const schedule  = buildTodaySchedule()
  console.log(`[AUTO-SHORT] Started — ${DAILY_LIMIT}/day random hours | eligible: ${eligible.length} | cycle: ${usedCycle.length}/${eligible.length} | today: ${schedule.map(t => new Date(t).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })).join(', ')}`)

  const SLOT_WINDOW_MS = 30 * 60 * 1000  // só publica se o slot foi há menos de 30 min

  async function tick() {
    const schedule   = buildTodaySchedule()
    const now        = Date.now()
    const todayCount = shortsUploadedToday()

    // Slot "devido agora" = passou há menos de 30 minutos e ainda não foi coberto
    const dueSlotsCount = schedule.filter(t => t <= now && t >= now - SLOT_WINDOW_MS).length
    const alreadyDone   = schedule.filter(t => t <= now && t < now - SLOT_WINDOW_MS).length

    if (todayCount < alreadyDone + dueSlotsCount && dueSlotsCount > 0) {
      await processNext()
    }

    // Wake up right after the next slot
    const next  = schedule.find(t => t > now)
    const delay = next ? Math.max(60000, next - now + 5000) : TICK_MS
    nextRunAt   = Date.now() + delay
    setTimeout(tick, delay)
  }

  // First tick: 1 minuto após arranque
  nextRunAt = Date.now() + 60000
  setTimeout(tick, 60000)
}

function getStatus() {
  const eligible  = allEligible()
  const state     = readState()
  const usedCycle = Array.isArray(state.usedCycle) ? state.usedCycle : []
  const remaining = eligible.filter(e => !usedCycle.includes(e.id))
  const schedule  = buildTodaySchedule()
  return {
    running,
    eligible:    eligible.length,
    cycleUsed:   usedCycle.length,
    cycleRemain: remaining.length,
    todayCount:  shortsUploadedToday(),
    dailyLimit:  DAILY_LIMIT,
    todaySchedule: schedule.map(t => new Date(t).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })),
    nextRunAt:   new Date(nextRunAt).toISOString(),
    msUntilNext: Math.max(0, nextRunAt - Date.now()),
    lastResult,
    nextUp: remaining.slice(0, 3).map(e => ({ id: e.id, title: e.title })),
  }
}

function runNow() {
  nextRunAt = Date.now() + TICK_MS
  return processNext()
}

module.exports = { start, getStatus, runNow }

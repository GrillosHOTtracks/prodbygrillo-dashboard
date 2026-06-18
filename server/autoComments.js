const fs      = require('fs')
const path    = require('path')
const https   = require('https')
const http    = require('http')
const Groq    = require('groq-sdk')
const { google } = require('googleapis')
const { jsonrepair } = require('jsonrepair')
const { search: innertubeSearch } = require('./lib/innertube')

const STATE_FILE = path.join(__dirname, 'data/comments.json')

// 4 daily windows at UTC hours that hit peak audience in BR / US / EU
// 00:00 UTC = 21h BR / 19h EST   (prime time BR+US)
// 13:00 UTC = 10h BR / 08h EST / 14h CET  (morning BR, morning US, lunch EU)
// 17:00 UTC = 14h BR / 12h EST / 18h CET  (afternoon BR, lunch US, evening EU)
// 21:00 UTC = 18h BR / 16h EST / 22h CET  (evening BR, afternoon US, late EU)
// FIX (correction 9): actual fire time is jittered ±45 min so the schedule is
// not a detectable fixed pattern (reduces YouTube spam-detection risk).
const SCHEDULE_UTC_HOURS = [0, 13, 17, 21]
const JITTER_MS = 45 * 60 * 1000  // ±45 minutes

fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, '[]')

function readPosted()     { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) } catch { return [] } }
function writePosted(arr) { fs.writeFileSync(STATE_FILE, JSON.stringify(arr, null, 2)) }

// FIX (correction 9): add ±JITTER_MS to each scheduled window
function getNextRunTime() {
  const now   = new Date()
  const utcH  = now.getUTCHours()
  const utcM  = now.getUTCMinutes()
  const jitter = Math.round((Math.random() * 2 - 1) * JITTER_MS)  // -45..+45 min in ms

  for (const h of SCHEDULE_UTC_HOURS) {
    if (h > utcH || (h === utcH && utcM < 1)) {
      const base = new Date(now)
      base.setUTCHours(h, 0, 0, 0)
      const jittered = new Date(base.getTime() + jitter)
      // Never go earlier than 1 min from now (jitter could make it negative)
      if (jittered.getTime() > now.getTime() + 60000) return jittered
      // If jitter pushed time into the past, move to next window
    }
  }
  // Wrap to next day's first window
  const next = new Date(now)
  next.setUTCDate(next.getUTCDate() + 1)
  next.setUTCHours(SCHEDULE_UTC_HOURS[0], 0, 0, 0)
  return new Date(next.getTime() + jitter)
}

function scheduleNext() {
  const next = getNextRunTime()
  const ms   = Math.max(60 * 1000, next.getTime() - Date.now())
  nextRunAt  = Date.now() + ms
  const localStr = next.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  console.log(`[AUTO-COMMENT] Next run at ${next.toISOString()} (${localStr} BRT) — in ${Math.round(ms / 60000)}m`)
  setTimeout(async () => {
    await run()
    scheduleNext()
  }, ms)
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, res => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!m) throw new Error('No JSON found in response')
  try { return JSON.parse(m[0]) } catch { return JSON.parse(jsonrepair(m[0])) }
}

// Words that indicate the video is NOT an artist's own music
const SKIP_TITLE_PATTERN = /expla[in]+ed|how to|tips|tutorial|need to do|advice|react|review|top \d|best \d|\d best|ranked|ranking|documentary|interview|podcast|vs\.?|versus|\bmix\b|\bmixtape\b|\bplaylist\b|\bcompilation\b|\btape #|\bDJ\s+\w+\s+(mix|presents|vol)/i

// Region-specific query pools — 2 picked randomly per region per run
const REGION_QUERIES = {
  BR: [
    'rapper brasileiro clipe oficial 2026',
    'trap brasileiro videoclipe 2026',
    'rap BR clipe oficial novo artista',
    'rapper brasil music video 2026',
    'funk rap brasileiro clipe 2026',
    'rapper BR lançamento 2026 oficial',
  ],
  US: [
    'rapper USA official music video 2026',
    'hip hop new artist official video 2026',
    'trap rapper official music video 2026',
    'underground rapper official video 2026',
    'new rapper debut official music video 2026',
    'rapper official video 2026 independent USA',
  ],
  OTHER: [
    'UK rapper official music video 2026',
    'UK drill new artist official video 2026',
    'rapper português clipe oficial 2026',
    'rap portugal lançamento clipe 2026',
    'french rapper official video 2026',
    'afroswing UK official music video 2026',
  ],
}

function extractArtistName(title) {
  return title.split(/\s*[-|–]\s*/)[0]
    .replace(/\s*(official|video|clipe|music|ft\.?|feat\.?|x\s+\w).*/i, '')
    .trim().slice(0, 40) || title.slice(0, 40)
}

async function fetchRegionVideos(region, excludeIds, limit) {
  try {
    const pool     = REGION_QUERIES[region]
    const queries  = pool.slice().sort(() => Math.random() - 0.5).slice(0, 2)
    const results  = await Promise.allSettled(queries.map(q => innertubeSearch(q).catch(() => [])))
    const all      = results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
    const seen     = new Set()
    return all.filter(v => {
      if (!v.videoId)                        return false
      if (excludeIds.has(v.videoId))         return false
      if (seen.has(v.videoId))               return false
      if (/type[\s-]?beat/i.test(v.title))   return false
      if (SKIP_TITLE_PATTERN.test(v.title))  return false
      if (v.views > 2_000_000)               return false  // skip mega-viral
      if (v.views < 300)                     return false  // skip empty
      seen.add(v.videoId)
      return true
    }).slice(0, limit).map(v => ({ videoId: v.videoId, title: v.title, artist: extractArtistName(v.title), region }))
  } catch (err) {
    console.warn(`[AUTO-COMMENT] fetchRegionVideos(${region}) failed:`, err.message)
    return []
  }
}

// State
let running    = false
let nextRunAt  = Date.now()
let lastResult = null
let accountMgr = null
let baseUrl    = 'http://localhost:3010'

async function run() {
  if (running || !accountMgr || !accountMgr.isAuthenticated()) return
  running = true
  const today = new Date().toISOString().slice(0, 10)
  console.log('[AUTO-COMMENT] Starting run for', today)
  lastResult = { status: 'running', date: today, startedAt: new Date().toISOString() }

  try {
    const posted = readPosted()
    const todayCount = posted.filter(p => p.date === today).length

    // Never comment on the same video twice — ever (global deduplication)
    const commentedVideoIds = new Set(posted.map(p => p.videoId).filter(Boolean))

    // FIX (correction 9): randomise how many comments per run (0–3) to reduce
    // detectable fixed-pattern behaviour. If 0, skip posting entirely.
    const maxComments = Math.floor(Math.random() * 4)  // 0, 1, 2, or 3
    if (maxComments === 0) {
      console.log('[AUTO-COMMENT] Skipping run (random 0-comment roll) — no API calls made')
      running = false
      lastResult = { status: 'done', date: today, posted: 0, message: 'Skipped (randomized)' }
      return
    }

    // Distribute budget across regions (at most 1 per region when maxComments < 3)
    const brLimit    = Math.min(maxComments, 1 + (maxComments > 1 ? 1 : 0))
    const usLimit    = Math.min(maxComments - brLimit, 1 + (maxComments > 2 ? 1 : 0))
    const otherLimit = Math.max(0, maxComments - brLimit - usLimit)

    // 2. Fetch videos via Innertube (zero quota)
    const [brPick, usPick, otherPick] = await Promise.all([
      fetchRegionVideos('BR',    commentedVideoIds, brLimit || 1),
      fetchRegionVideos('US',    commentedVideoIds, usLimit || 1),
      fetchRegionVideos('OTHER', commentedVideoIds, otherLimit || 1),
    ])

    const allCandidates = [...brPick, ...usPick, ...otherPick]
    // Trim to the rolled max
    const videos = allCandidates.slice(0, maxComments)
    console.log(`[AUTO-COMMENT] Videos: ${brPick.length} BR + ${usPick.length} US + ${otherPick.length} OTHER = ${videos.length} total`)
    if (!videos.length) { console.log('[AUTO-COMMENT] No new videos to comment on'); running = false; lastResult = { status: 'done', date: today, posted: 0, message: 'Sem vídeos novos para comentar' }; return }

    // 3. Generate comments via Groq
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) throw new Error('GROQ_API_KEY não configurada')
    const groq = new Groq({ apiKey })

    const videoList = videos.map((v, i) =>
      `${i + 1}. videoId="${v.videoId}" | region="${v.region}" | artist="${v.artist}" | title="${v.title.slice(0, 70)}"`
    ).join('\n')

    // Inject last 30 comment texts so the AI never repeats or closely paraphrases them
    const recentComments = posted
      .slice(-30)
      .map(p => `- "${p.comment}"`)
      .join('\n')

    const prompt = `You are prodbygrillo, a music producer leaving comments on YouTube rap/hip-hop videos. Be strategic but authentic.

Videos (region: BR=Brazil, US=USA, OTHER=UK/PT/etc):
${videoList}

For EACH video write ONE original comment. 10-25 words, casual tone.
- region="BR": write in Portuguese (BR slang — "cara", "mano", "pesado", "surreal", "que batida")
- region="US": write in English
- region="OTHER": match the video title language (EN for UK, PT for Portugal, etc.)

Rules:
- Sound like a genuine music fan / fellow musician — NOT spam, NOT a promoter
- Subtly hint that you produce beats WITHOUT saying it directly
- NEVER use: "beat", "type beat", BeatStars, links, or direct self-promotion
- Be specific to the artist's style or vibe in the title — not generic
- Vary tone: admiration, hype, curiosity, encouragement, nostalgia
- Every comment must feel like a real person wrote it, NOT a template
${recentComments ? `\nComments you've already left (DO NOT repeat or closely paraphrase ANY of these):\n${recentComments}` : ''}

Reply ONLY in valid JSON (no markdown, no text before or after):
{"comments":[{"videoId":"ID","comment":"..."}]}`

    const resp = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 2400,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = resp.choices[0]?.message?.content || ''
    const parsed = extractJson(raw)
    const commentMap = {}
    ;(parsed.comments || []).forEach(c => { commentMap[c.videoId] = c.comment })

    // 4. Post comments via YouTube API
    const results = []
    let likeCount = 0

    const auth = accountMgr.getAuthClient()
    const yt = google.youtube({ version: 'v3', auth })

    for (const v of videos) {
      const text = commentMap[v.videoId]
      if (!text) continue
      try {
        const commentRes = await yt.commentThreads.insert({
          part: ['snippet'],
          requestBody: {
            snippet: {
              videoId: v.videoId,
              topLevelComment: { snippet: { textOriginal: text } },
            },
          },
        })
        const commentId = commentRes.data.id
        console.log('[AUTO-COMMENT] Posted on', v.videoId, '|', v.artist, '| commentId:', commentId)

        // Like the first 3 videos only (50 units each)
        if (likeCount < 3) {
          try {
            await yt.videos.rate({ id: v.videoId, rating: 'like' })
            console.log('[AUTO-COMMENT] Liked:', v.videoId)
            likeCount++
          } catch (likeErr) {
            console.warn('[AUTO-COMMENT] Like failed:', v.videoId, likeErr.message)
          }
        }

        results.push({ videoId: v.videoId, artist: v.artist, title: v.title, comment: text, commentId, ok: true })
        posted.push({ date: today, videoId: v.videoId, artist: v.artist, comment: text, commentId, postedAt: new Date().toISOString() })
        writePosted(posted)
        // 30s delay between comments to avoid spam detection
        await new Promise(r => setTimeout(r, 30000))
      } catch (err) {
        console.error('[AUTO-COMMENT] Failed on', v.videoId, ':', err.message)
        results.push({ videoId: v.videoId, artist: v.artist, ok: false, error: err.message })
      }
    }

    const successCount = results.filter(r => r.ok).length
    console.log('[AUTO-COMMENT] Done:', successCount, '/', results.length, 'comments posted')
    lastResult = { status: 'done', date: today, posted: successCount, total: results.length, results, finishedAt: new Date().toISOString() }
  } catch (err) {
    console.error('[AUTO-COMMENT] Error:', err.message)
    lastResult = { status: 'error', date: today, error: err.message, finishedAt: new Date().toISOString() }
  } finally {
    running = false
  }
}

function start(mgr, port) {
  accountMgr = mgr
  if (port) baseUrl = `http://localhost:${port}`
  const today = new Date().toISOString().slice(0, 10)
  const todayPosted = readPosted().filter(p => p.date === today).length
  console.log('[AUTO-COMMENT] Scheduler started — 4x/day (00/13/17/21 UTC) | posted today:', todayPosted)
  scheduleNext()
}

function getStatus() {
  const today = new Date().toISOString().slice(0, 10)
  const posted = readPosted()
  const todayEntries = posted.filter(p => p.date === today)
  const allEntries   = posted
  return {
    running,
    schedule:    SCHEDULE_UTC_HOURS.map(h => `${String(h).padStart(2,'0')}:00 UTC`).join(' · '),
    nextRunAt:   new Date(nextRunAt).toISOString(),
    msUntilNext: Math.max(0, nextRunAt - Date.now()),
    todayPosted: todayEntries.length,
    totalPosted: allEntries.length,
    todayEntries,
    lastResult,
  }
}

function runNow() {
  return run()
}

module.exports = { start, getStatus, runNow }

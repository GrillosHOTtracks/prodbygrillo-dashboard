const fs      = require('fs')
const path    = require('path')
const https   = require('https')
const http    = require('http')
const Groq    = require('groq-sdk')
const { google } = require('googleapis')

const STATE_FILE = path.join(__dirname, 'data/comments.json')

// 4 daily runs at UTC hours that hit peak audience in BR / US / EU
// 00:00 UTC = 21h BR / 19h EST   (prime time BR+US)
// 13:00 UTC = 10h BR / 08h EST / 14h CET  (morning BR, morning US, lunch EU)
// 17:00 UTC = 14h BR / 12h EST / 18h CET  (afternoon BR, lunch US, evening EU)
// 21:00 UTC = 18h BR / 16h EST / 22h CET  (evening BR, afternoon US, late EU)
const SCHEDULE_UTC_HOURS = [0, 13, 17, 21]

fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, '[]')

function readPosted()     { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) } catch { return [] } }
function writePosted(arr) { fs.writeFileSync(STATE_FILE, JSON.stringify(arr, null, 2)) }

function getNextRunTime() {
  const now = new Date()
  const utcH = now.getUTCHours()
  const utcM = now.getUTCMinutes()
  for (const h of SCHEDULE_UTC_HOURS) {
    if (h > utcH || (h === utcH && utcM < 1)) {
      const next = new Date(now)
      next.setUTCHours(h, 0, 0, 0)
      return next
    }
  }
  // Wrap to next day
  const next = new Date(now)
  next.setUTCDate(next.getUTCDate() + 1)
  next.setUTCHours(SCHEDULE_UTC_HOURS[0], 0, 0, 0)
  return next
}

function scheduleNext() {
  const next = getNextRunTime()
  const ms   = next.getTime() - Date.now()
  nextRunAt  = next.getTime()
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
  return JSON.parse(m[0])
}

// State
let running    = false
let nextRunAt  = Date.now()
let lastResult = null
let accountMgr = null
let baseUrl    = 'http://localhost:3011'

async function run() {
  if (running || !accountMgr || !accountMgr.isAuthenticated()) return
  running = true
  const today = new Date().toISOString().slice(0, 10)
  console.log('[AUTO-COMMENT] Starting run for', today)
  lastResult = { status: 'running', date: today, startedAt: new Date().toISOString() }

  try {
    const posted = readPosted()
    // Never comment on the same video twice (globally, not just today)
    const postedToday = posted.map(p => p.videoId)

    // 1. Trending artists
    const tData = await fetchJson(`${baseUrl}/api/trending`)
    const artists = (Array.isArray(tData) ? tData : []).map(a => a.name).filter(Boolean).slice(0, 10)
    if (!artists.length) throw new Error('Sem artistas em trending')
    console.log('[AUTO-COMMENT] Artists:', artists.join(', '))

    // 2. Artist videos — 2 per artist = up to 20 per run
    const avData = await fetchJson(`${baseUrl}/api/trending/artist-videos?artists=${encodeURIComponent(artists.join(','))}&perArtist=2`)
    const videos = (avData.videos || []).filter(v => v.videoId && !postedToday.includes(v.videoId))
    if (!videos.length) { console.log('[AUTO-COMMENT] All videos already commented today'); running = false; lastResult = { status: 'done', date: today, posted: 0, message: 'Já comentado hoje' }; return }
    console.log('[AUTO-COMMENT] Videos to comment:', videos.length)

    // 3. Generate comments via Groq
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) throw new Error('GROQ_API_KEY não configurada')
    const groq = new Groq({ apiKey })

    const videoList = videos.map((v, i) =>
      `${i + 1}. videoId="${v.videoId}" | artist="${v.artist}" | title="${v.title.slice(0, 70)}"`
    ).join('\n')

    const prompt = `You are a music producer leaving comments on official artist YouTube videos. Be strategic but authentic.

Videos:
${videoList}

For EACH video write ONE comment in English (15-20 words, casual tone).

Rules:
- Sound like a genuine music fan / fellow musician — NOT spam, NOT a promoter
- Subtly hint that you produce beats in that style WITHOUT saying it directly
- NEVER use: "beat", "type beat", BeatStars, links, or direct self-promotion
- Subtle hints: "This vibe is exactly what I've been working on lately", "Been deep in this sound for weeks", "This hits different every time"
- Be specific to the artist's known sound — not generic
- Vary tone per video: admiration, personal/reflective, hype

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
    const auth = accountMgr.getAuthClient()
    const yt   = google.youtube({ version: 'v3', auth })
    const results = []

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

        // Like the video right after commenting
        try {
          await yt.videos.rate({ id: v.videoId, rating: 'like' })
          console.log('[AUTO-COMMENT] Liked:', v.videoId)
        } catch (likeErr) {
          console.warn('[AUTO-COMMENT] Like failed:', v.videoId, likeErr.message)
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

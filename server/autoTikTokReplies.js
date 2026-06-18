const fs   = require('fs')
const path = require('path')
const Groq = require('groq-sdk')
const tiktok = require('./tiktokAuth')

const STATE_FILE = path.join(__dirname, 'data/tiktok-replies.json')
// 4x/day — offset 2h after TikTok auto-post cycle
const SCHEDULE_UTC_HOURS = [3, 9, 15, 21]

fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, '[]')

function readReplied()     { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) } catch { return [] } }
function writeReplied(arr) { fs.writeFileSync(STATE_FILE, JSON.stringify(arr, null, 2)) }

function getNextRunTime() {
  const now  = new Date()
  const utcH = now.getUTCHours()
  const utcM = now.getUTCMinutes()
  for (const h of SCHEDULE_UTC_HOURS) {
    if (h > utcH || (h === utcH && utcM < 1)) {
      const next = new Date(now)
      next.setUTCHours(h, 0, 0, 0)
      return next
    }
  }
  const next = new Date(now)
  next.setUTCDate(next.getUTCDate() + 1)
  next.setUTCHours(SCHEDULE_UTC_HOURS[0], 0, 0, 0)
  return next
}

function scheduleNext() {
  const next     = getNextRunTime()
  const ms       = Math.max(60 * 1000, next.getTime() - Date.now())
  nextRunAt      = Date.now() + ms
  const localStr = new Date(nextRunAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  console.log(`[AUTO-TT-REPLY] Next run at ${new Date(nextRunAt).toISOString()} (${localStr} BRT) — in ${Math.round(ms / 60000)}m`)
  setTimeout(async () => {
    await run()
    scheduleNext()
  }, ms)
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!m) throw new Error('No JSON in response')
  return JSON.parse(m[0])
}

async function safeJson(res, label) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
}

let running    = false
let nextRunAt  = Date.now()
let lastResult = null

async function run() {
  if (running || !tiktok.isAuthenticated()) return
  running    = true
  lastResult = { status: 'running', startedAt: new Date().toISOString() }
  console.log('[AUTO-TT-REPLY] Starting run')

  try {
    const token      = await tiktok.getAccessToken()
    const replied    = readReplied()
    const repliedIds = new Set(replied.map(r => r.commentId))

    // 1. Get recent videos
    const videosRes  = await fetch(
      'https://open.tiktokapis.com/v2/video/list/?fields=id,title',
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_count: 10 }) }
    )
    const videosData = await safeJson(videosRes, 'video/list')
    if (videosData.error?.code !== 'ok') throw new Error(videosData.error?.message || 'Failed to list videos')
    const videos = videosData.data?.videos || []
    if (!videos.length) {
      lastResult = { status: 'done', replied: 0, message: 'Sem vídeos', finishedAt: new Date().toISOString() }
      running = false
      return
    }

    // 2. Collect unanswered top-level comments across the 5 most recent videos
    const pending = []
    for (const video of videos.slice(0, 5)) {
      const commentsRes  = await fetch(
        'https://open.tiktokapis.com/v2/video/comment/list/?fields=id,video_id,text,create_time,parent_comment_id',
        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_id: video.id, max_count: 20 }) }
      )
      let commentsData
      try { commentsData = await safeJson(commentsRes, 'comment/list') } catch (e) {
        console.warn('[AUTO-TT-REPLY] comment/list skipped:', e.message.slice(0, 120))
        continue
      }
      if (commentsData.error?.code !== 'ok') {
        console.warn('[AUTO-TT-REPLY] comment/list error:', commentsData.error?.message || commentsData.error?.code)
        continue
      }

      const comments = commentsData.data?.comments || []
      // IDs of comments that already have a child reply in this batch
      const hasReply = new Set(comments.filter(c => c.parent_comment_id).map(c => c.parent_comment_id))

      for (const c of comments) {
        if (c.parent_comment_id)  continue  // skip replies
        if (repliedIds.has(c.id)) continue  // already replied by us
        if (hasReply.has(c.id))   continue  // already has a reply visible
        if (!c.text || c.text.trim().length < 3) continue
        pending.push({ commentId: c.id, videoId: video.id, videoTitle: video.title || '', text: c.text.slice(0, 200) })
        if (pending.length >= 10) break
      }
      if (pending.length >= 10) break
    }

    if (!pending.length) {
      console.log('[AUTO-TT-REPLY] No unanswered comments')
      lastResult = { status: 'done', replied: 0, message: 'Sem comentários para responder', finishedAt: new Date().toISOString() }
      running = false
      return
    }
    console.log('[AUTO-TT-REPLY] Pending:', pending.length)

    // 3. Generate replies via Groq
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY não configurada')
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

    const commentList = pending.map((c, i) =>
      `${i + 1}. commentId="${c.commentId}" | video="${c.videoTitle.slice(0, 50)}" | comment="${c.text}"`
    ).join('\n')

    const resp = await Promise.race([
      groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 600,
        messages: [{ role: 'user', content: `You are prodbygrillo, a Brazilian music producer who sells beats on BeatStars. Reply to comments on your TikTok beat videos.

Comments:
${commentList}

Rules:
- 5-15 words max, casual and warm like texting
- If they compliment: thank them genuinely, vary each response
- If they ask about buying/licensing: "link in bio 🔥"
- Write in the SAME LANGUAGE as the comment (EN/PT/ES)
- NEVER sound like a bot or use generic phrases
- NO "thank you so much for the support!"

Reply ONLY in valid JSON:
{"replies":[{"commentId":"ID","reply":"..."}]}` }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Groq timeout')), 25000)),
    ])

    const parsed   = extractJson(resp.choices[0]?.message?.content || '')
    const replyMap = {}
    ;(parsed.replies || []).forEach(r => { replyMap[r.commentId] = r.reply })

    // 4. Post replies
    const results = []
    for (const c of pending) {
      const text = replyMap[c.commentId]
      if (!text) continue
      try {
        const replyRes  = await fetch('https://open.tiktokapis.com/v2/video/comment/create/', {
          method:  'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ video_id: c.videoId, text, parent_comment_id: c.commentId }),
        })
        const replyData = await safeJson(replyRes, 'comment/create')
        if (replyData.error?.code !== 'ok') throw new Error(replyData.error?.message || JSON.stringify(replyData.error))

        console.log('[AUTO-TT-REPLY] Replied to', c.commentId, '→', text.slice(0, 50))
        results.push({ commentId: c.commentId, videoId: c.videoId, text: c.text, reply: text, ok: true })
        replied.push({ commentId: c.commentId, videoId: c.videoId, reply: text, repliedAt: new Date().toISOString() })
        writeReplied(replied)
        await new Promise(r => setTimeout(r, 5000))
      } catch (err) {
        console.error('[AUTO-TT-REPLY] Failed:', c.commentId, err.message)
        results.push({ commentId: c.commentId, ok: false, error: err.message })
      }
    }

    const successCount = results.filter(r => r.ok).length
    console.log('[AUTO-TT-REPLY] Done:', successCount, '/', results.length)
    lastResult = { status: 'done', replied: successCount, total: results.length, results, finishedAt: new Date().toISOString() }

  } catch (err) {
    console.error('[AUTO-TT-REPLY] Error:', err.message)
    lastResult = { status: 'error', error: err.message, finishedAt: new Date().toISOString() }
  } finally {
    running = false
  }
}

function start() {
  const total = readReplied().length
  console.log(`[AUTO-TT-REPLY] Scheduler started — 4x/day (03/09/15/21 UTC) | total replies: ${total}`)
  scheduleNext()
}

function getStatus() {
  const replied = readReplied()
  const today   = new Date().toISOString().slice(0, 10)
  return {
    running,
    schedule:     SCHEDULE_UTC_HOURS.map(h => `${String(h).padStart(2, '0')}:00 UTC`).join(' · '),
    nextRunAt:    new Date(nextRunAt).toISOString(),
    msUntilNext:  Math.max(0, nextRunAt - Date.now()),
    todayReplied: replied.filter(r => r.repliedAt?.startsWith(today)).length,
    totalReplied: replied.length,
    lastResult,
  }
}

function runNow() { return run() }

module.exports = { start, getStatus, runNow }

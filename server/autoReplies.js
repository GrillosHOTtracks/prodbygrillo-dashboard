const fs           = require('fs')
const path         = require('path')
const Groq         = require('groq-sdk')
const { google }   = require('googleapis')
const { jsonrepair } = require('jsonrepair')
const { isQuotaError } = require('./apiError')

const STATE_FILE    = path.join(__dirname, 'data/replies.json')
// 4 daily runs — 2h after each auto-comment batch (comments: 00/13/17/21 UTC)
const SCHEDULE_UTC_HOURS = [2, 15, 19, 23]

fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, '[]')

function readReplied()     { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) } catch { return [] } }
function writeReplied(arr) { fs.writeFileSync(STATE_FILE, JSON.stringify(arr, null, 2)) }

// Strip HTML tags from YouTube API error messages (e.g. quota HTML response)
function cleanErr(err) {
  return String(err?.message || err).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

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
  console.log(`[AUTO-REPLY] Next run at ${new Date(nextRunAt).toISOString()} (${localStr} BRT) — in ${Math.round(ms / 60000)}m`)
  setTimeout(async () => {
    await run()
    scheduleNext()
  }, ms)
}

function sanitizeText(t) {
  return String(t || '').replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim()
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!m) throw new Error('No JSON found')
  try { return JSON.parse(m[0]) } catch { return JSON.parse(jsonrepair(m[0])) }
}

let running    = false
let nextRunAt  = Date.now()
let lastResult = null
let accountMgr = null

async function run() {
  if (running || !accountMgr || !accountMgr.isAuthenticated()) return
  running = true
  console.log('[AUTO-REPLY] Starting run')
  lastResult = { status: 'running', startedAt: new Date().toISOString() }

  try {
    const replied    = readReplied()
    const repliedIds = new Set(replied.map(r => r.commentId))

    // Only reply to comments from the last 60 days — avoids digging into ancient threads
    const CUTOFF_MS  = 60 * 24 * 60 * 60 * 1000
    const cutoff     = Date.now() - CUTOFF_MS

    await accountMgr.withYouTube(async (auth) => {
      const yt = google.youtube({ version: 'v3', auth })

      // 1. Get channel ID
      const channelRes = await yt.channels.list({ part: ['id'], mine: true })
      const channelId  = channelRes.data.items?.[0]?.id
      if (!channelId) throw new Error('Channel not found')

      // 2. Fetch comment threads — paginate up to 3 pages (150 threads) so the bot
      //    doesn't stop at the first 50 when all recent ones are already replied.
      //    BUG FIX: previously only fetched 1 page → after a few days of running,
      //    all 50 most-recent threads were in repliedIds → always "0 unreplied found".
      const pending   = []
      let   pageToken = undefined
      let   page      = 0
      const MAX_PAGES = 3

      do {
        const threadsRes = await yt.commentThreads.list({
          part:                        ['snippet'],
          allThreadsRelatedToChannelId: channelId,
          maxResults:                  50,
          order:                       'time',
          ...(pageToken ? { pageToken } : {}),
        })
        const items = threadsRes.data.items || []
        console.log(`[AUTO-REPLY] Page ${page + 1}: ${items.length} threads fetched`)

        for (const thread of items) {
          if (pending.length >= 10) break

          const top      = thread.snippet?.topLevelComment?.snippet
          const threadId = thread.id
          const videoId  = thread.snippet?.videoId

          if (!top || !threadId) continue

          // Skip comments older than 60 days
          const publishedAt = top.publishedAt ? new Date(top.publishedAt).getTime() : 0
          if (publishedAt > 0 && publishedAt < cutoff) {
            // Comments are ordered by time — once we hit a comment older than cutoff,
            // all remaining on this and subsequent pages will also be older.
            pageToken = undefined
            break
          }

          const text = top.textDisplay || ''
          if (top.authorChannelId?.value === channelId) continue  // our own comments
          if (repliedIds.has(threadId))                continue  // already replied
          if (text.trim().length < 1)                  continue  // skip truly empty
          if (/http|www\.|\.com|spam/i.test(text))     continue

          pending.push({
            threadId, videoId,
            author: sanitizeText(top.authorDisplayName || 'viewer'),
            text:   sanitizeText(text).slice(0, 200),
          })
        }

        pageToken = threadsRes.data.nextPageToken
        page++
      } while (pageToken && pending.length < 10 && page < MAX_PAGES)

      console.log('[AUTO-REPLY] Total threads scanned:', page * 50, '| unreplied found:', pending.length)

      if (!pending.length) {
        console.log('[AUTO-REPLY] No unanswered comments found')
        lastResult = { status: 'done', replied: 0, total: 0, results: [], message: 'Sem comentários para responder', finishedAt: new Date().toISOString() }
        return
      }

      console.log('[AUTO-REPLY] Pending replies:', pending.length)

      // 3. Generate replies via Groq
      const apiKey = process.env.GROQ_API_KEY
      if (!apiKey) throw new Error('GROQ_API_KEY não configurada')
      const groq = new Groq({ apiKey })

      const commentList = pending.map((c, i) =>
        `${i + 1}. threadId="${c.threadId}" | author="${c.author}" | comment="${c.text}"`
      ).join('\n')

      const prompt = `You are prodbygrillo, a Brazilian music producer who sells beats on BeatStars. Reply to comments left on your YouTube videos.

Comments to reply to:
${commentList}

Rules:
- Be genuine, warm, grateful — you appreciate every comment
- Short replies (5-15 words max) — casual, natural, like a real person texting
- If they compliment: thank them genuinely, vary the response
- If they ask about licensing/buying: mention BeatStars but don't be pushy (e.g. "link in bio 🔥")
- If they ask about collab: be open and friendly
- Write in the SAME LANGUAGE as the comment (English, Portuguese, Spanish etc.)
- NEVER use: "beat", "type beat" in the reply, don't sound like a bot
- NO generic "thank you so much for the support!" — be specific

Reply ONLY in valid JSON:
{"replies":[{"threadId":"ID","reply":"..."}]}`

      const resp = await groq.chat.completions.create({
        model:      'llama-3.3-70b-versatile',
        max_tokens: 800,
        messages:   [{ role: 'user', content: prompt }],
      })
      const raw      = resp.choices[0]?.message?.content || ''
      const parsed   = extractJson(raw)
      const replyMap = {}
      ;(parsed.replies || []).forEach(r => { replyMap[r.threadId] = r.reply })

      // 4. Post replies
      const results = []
      for (const c of pending) {
        const text = replyMap[c.threadId]
        if (!text) continue
        try {
          await yt.comments.insert({
            part:        ['snippet'],
            requestBody: {
              snippet: {
                parentId:     c.threadId,
                textOriginal: text,
              },
            },
          })
          console.log('[AUTO-REPLY] Replied to', c.threadId, '|', c.author, '→', text.slice(0, 40))
          results.push({ threadId: c.threadId, author: c.author, originalComment: c.text, reply: text, ok: true })
          replied.push({ commentId: c.threadId, videoId: c.videoId, author: c.author, reply: text, repliedAt: new Date().toISOString() })
          writeReplied(replied)
          await new Promise(r => setTimeout(r, 5000))
        } catch (err) {
          const msg = cleanErr(err)
          console.error('[AUTO-REPLY] Failed on', c.threadId, ':', msg)
          results.push({ threadId: c.threadId, author: c.author, ok: false, error: msg })
          // Abort remaining if quota hit mid-run
          if (isQuotaError(err)) {
            console.warn('[AUTO-REPLY] Quota exceeded mid-run — stopping early')
            break
          }
        }
      }

      const successCount = results.filter(r => r.ok).length
      console.log('[AUTO-REPLY] Done:', successCount, '/', results.length)
      lastResult = { status: 'done', replied: successCount, total: results.length, results, finishedAt: new Date().toISOString() }
    }) // withYouTube

  } catch (err) {
    const msg = cleanErr(err)
    console.error('[AUTO-REPLY] Error:', msg)
    // Provide a user-friendly message for quota errors
    if (isQuotaError(err)) {
      lastResult = { status: 'error', error: 'Quota YouTube esgotada — reset às 08:00 UTC', finishedAt: new Date().toISOString() }
    } else {
      lastResult = { status: 'error', error: msg, finishedAt: new Date().toISOString() }
    }
  } finally {
    running = false
  }
}

function start(mgr) {
  accountMgr = mgr
  const total = readReplied().length
  console.log('[AUTO-REPLY] Scheduler started — 4x/day (02/15/19/23 UTC) | total replies so far:', total)
  scheduleNext()
}

function getStatus() {
  const replied = readReplied()
  const today   = new Date().toISOString().slice(0, 10)
  return {
    running,
    schedule:     SCHEDULE_UTC_HOURS.map(h => `${String(h).padStart(2,'0')}:00 UTC`).join(' · '),
    nextRunAt:    new Date(nextRunAt).toISOString(),
    msUntilNext:  Math.max(0, nextRunAt - Date.now()),
    todayReplied: replied.filter(r => r.repliedAt?.startsWith(today)).length,
    totalReplied: replied.length,
    lastResult,
  }
}

function runNow() {
  return run()
}

module.exports = { start, getStatus, runNow }

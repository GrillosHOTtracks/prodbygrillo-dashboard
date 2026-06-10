const fs           = require('fs')
const path         = require('path')
const Groq         = require('groq-sdk')
const { google }   = require('googleapis')
const { jsonrepair } = require('jsonrepair')

const STATE_FILE  = path.join(__dirname, 'data/replies.json')
// Run 2h after each auto-comment batch so replies are visible fast
const INTERVAL_MS = 2 * 60 * 60 * 1000

fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, '[]')

function readReplied()     { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) } catch { return [] } }
function writeReplied(arr) { fs.writeFileSync(STATE_FILE, JSON.stringify(arr, null, 2)) }

function sanitizeText(t) {
  return String(t || '').replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim()
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!m) throw new Error('No JSON found')
  try { return JSON.parse(m[0]) } catch { return JSON.parse(jsonrepair(m[0])) }
}

let running    = false
let nextRunAt  = Date.now() + INTERVAL_MS
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

    const auth = accountMgr.getAuthClient()
    const yt   = google.youtube({ version: 'v3', auth })

    // 1. Get channel's own videos (last 15)
    const channelRes = await yt.channels.list({ part: ['contentDetails'], mine: true })
    const uploadsId  = channelRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!uploadsId) throw new Error('Uploads playlist not found')

    const playlistRes = await yt.playlistItems.list({
      part: ['contentDetails'], playlistId: uploadsId, maxResults: 15,
    })
    const videoIds = (playlistRes.data.items || []).map(i => i.contentDetails.videoId).filter(Boolean)
    if (!videoIds.length) throw new Error('No videos found')

    // 2. For each video, collect unanswered top-level comments
    const pending = []
    for (const videoId of videoIds) {
      try {
        const threadsRes = await yt.commentThreads.list({
          part: ['snippet'], videoId, maxResults: 20, order: 'time',
        })
        for (const thread of (threadsRes.data.items || [])) {
          const top     = thread.snippet?.topLevelComment?.snippet
          const threadId = thread.id
          const hasReply = thread.snippet?.totalReplyCount > 0

          // Skip: already replied, is own comment, too short, spam-like
          if (!top || !threadId) continue
          if (repliedIds.has(threadId)) continue
          if (hasReply) continue  // already has replies (possibly ours)
          if (!top.textDisplay || top.textDisplay.length < 5) continue
          if (/http|www\.|\.com|spam/i.test(top.textDisplay)) continue

          pending.push({
            threadId, videoId,
            author: sanitizeText(top.authorDisplayName || 'viewer'),
            text:   sanitizeText(top.textDisplay).slice(0, 200),
          })
          if (pending.length >= 10) break
        }
      } catch (e) {
        console.warn('[AUTO-REPLY] commentThreads.list failed for', videoId, ':', e.message)
      }
      if (pending.length >= 10) break
    }

    if (!pending.length) {
      console.log('[AUTO-REPLY] No unanswered comments found')
      lastResult = { status: 'done', replied: 0, message: 'Sem comentários para responder', finishedAt: new Date().toISOString() }
      running = false
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
      model: 'llama-3.3-70b-versatile',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw    = resp.choices[0]?.message?.content || ''
    const parsed = extractJson(raw)
    const replyMap = {}
    ;(parsed.replies || []).forEach(r => { replyMap[r.threadId] = r.reply })

    // 4. Post replies
    const results = []
    for (const c of pending) {
      const text = replyMap[c.threadId]
      if (!text) continue
      try {
        await yt.comments.insert({
          part: ['snippet'],
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
        console.error('[AUTO-REPLY] Failed on', c.threadId, ':', err.message)
        results.push({ threadId: c.threadId, author: c.author, ok: false, error: err.message })
      }
    }

    const successCount = results.filter(r => r.ok).length
    console.log('[AUTO-REPLY] Done:', successCount, '/', results.length)
    lastResult = { status: 'done', replied: successCount, total: results.length, results, finishedAt: new Date().toISOString() }
  } catch (err) {
    console.error('[AUTO-REPLY] Error:', err.message)
    lastResult = { status: 'error', error: err.message, finishedAt: new Date().toISOString() }
  } finally {
    running = false
  }
}

function start(mgr) {
  accountMgr = mgr
  const total = readReplied().length
  console.log('[AUTO-REPLY] Scheduler started — interval: 2h | total replies so far:', total)
  setInterval(async () => {
    nextRunAt = Date.now() + INTERVAL_MS
    await run()
  }, INTERVAL_MS)
}

function getStatus() {
  const replied = readReplied()
  const today   = new Date().toISOString().slice(0, 10)
  return {
    running,
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

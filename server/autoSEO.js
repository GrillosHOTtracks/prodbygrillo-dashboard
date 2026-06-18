// autoSEO.js — weekly job that refreshes tags + descriptions on all channel videos
// with current trending artists, keeping videos discoverable over time
const fs         = require('fs')
const path       = require('path')
const https      = require('https')
const http       = require('http')
const Groq       = require('groq-sdk')
const { google } = require('googleapis')
const { jsonrepair } = require('jsonrepair')

const STATE_FILE  = path.join(__dirname, 'data/seo.json')
const INTERVAL_MS = 7 * 24 * 60 * 60 * 1000  // 7 days
const BEATSTARS   = 'https://www.beatstars.com/prodbygrillo'

fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, '{"lastRun":null,"videosUpdated":0}')

function readState()   { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) } catch { return {} } }
function writeState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)) }

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, res => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!m) throw new Error('No JSON found')
  try { return JSON.parse(m[0]) } catch { return JSON.parse(jsonrepair(m[0])) }
}

// Build optimised tags: existing + trending artists + evergreen keywords
function buildTags(existing, trendingArtists, style) {
  const evergreen = [
    'type beat', 'free type beat', 'free beat', `${style} type beat`,
    `${style} beat`, 'prod by prodbygrillo', 'prodbygrillo',
    'type beat 2026', 'free type beat 2026',
  ]
  const all = [...new Set([
    ...existing,
    ...trendingArtists.map(a => `${a} type beat`),
    ...trendingArtists.map(a => `${a} type beat 2026`),
    ...trendingArtists.slice(0, 3),
    ...evergreen,
  ])]
  // Respect 500 char budget
  const result = []; let total = 0
  for (const tag of all) {
    const cost = tag.length + (tag.includes(' ') ? 2 : 0) + (result.length > 0 ? 1 : 0)
    if (total + cost > 496) break
    result.push(tag); total += cost
  }
  return result
}

// Ensure description starts with BeatStars link
function ensureBeatStarsLink(desc) {
  if (desc.includes(BEATSTARS)) return desc
  return `💰 Licenças → ${BEATSTARS}\n\n${desc}`
}

let running    = false
let nextRunAt  = null  // set by start()
let lastResult = null
let accountMgr = null
let baseUrl    = 'http://localhost:3010'

async function run() {
  if (running || !accountMgr?.isAuthenticated()) return
  running = true
  console.log('[AUTO-SEO] Starting weekly run')
  lastResult = { status: 'running', startedAt: new Date().toISOString() }

  try {
    // 1. Get trending artists (no quota)
    const tData   = await fetchJson(`${baseUrl}/api/trending`)
    const artists = (Array.isArray(tData) ? tData : []).map(a => a.name).filter(Boolean).slice(0, 8)
    console.log('[AUTO-SEO] Trending artists:', artists.join(', '))

    const auth = accountMgr.getAuthClient()
    const yt   = google.youtube({ version: 'v3', auth })

    // 2. Get all channel videos
    const chRes = await yt.channels.list({ part: ['contentDetails'], mine: true })
    const upId  = chRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!upId) throw new Error('No uploads playlist')

    const videos = []
    let pageToken
    do {
      const r = await yt.playlistItems.list({
        part: ['snippet'], playlistId: upId, maxResults: 50,
        ...(pageToken ? { pageToken } : {}),
      })
      for (const item of (r.data.items || [])) {
        const vid = item.snippet?.resourceId?.videoId
        const tit = item.snippet?.title
        if (vid && tit && !/#shorts/i.test(tit)) videos.push({ videoId: vid, title: tit })
      }
      pageToken = r.data.nextPageToken
    } while (pageToken)

    console.log('[AUTO-SEO] Videos to update (non-shorts):', videos.length)

    // 3. Get current snippet for each video (tags + description)
    const ids    = videos.map(v => v.videoId)
    const chunks = []
    for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50))

    const snippets = {}
    for (const chunk of chunks) {
      const r = await yt.videos.list({ part: ['snippet'], id: chunk })
      for (const item of (r.data.items || [])) {
        snippets[item.id] = item.snippet
      }
    }

    // 4. Update each video
    let updated = 0
    for (const v of videos) {
      const snip = snippets[v.videoId]
      if (!snip) continue

      const styleTags = { drill: 'Drill', phonk: 'Phonk', melodic: 'Melodic', afro: 'Afro', rnb: 'RnB' }
      let style = 'Trap'
      for (const [kw, st] of Object.entries(styleTags)) {
        if (v.title.toLowerCase().includes(kw)) { style = st; break }
      }

      const newTags = buildTags(snip.tags || [], artists, style)
      const newDesc = ensureBeatStarsLink(snip.description || '')

      const tagsChanged = JSON.stringify(newTags) !== JSON.stringify(snip.tags || [])
      const descChanged = newDesc !== snip.description
      if (!tagsChanged && !descChanged) continue

      try {
        await yt.videos.update({
          part: ['snippet'],
          requestBody: {
            id: v.videoId,
            snippet: { title: snip.title, description: newDesc, tags: newTags, categoryId: snip.categoryId || '10' },
          },
        })
        updated++
        console.log('[AUTO-SEO] Updated:', v.videoId, v.title.slice(0, 40))
        await new Promise(r => setTimeout(r, 1000))
      } catch (err) {
        console.warn('[AUTO-SEO] Update failed for', v.videoId, ':', err.message)
      }
    }

    const state = readState()
    state.lastRun       = new Date().toISOString()
    state.videosUpdated = (state.videosUpdated || 0) + updated
    state.trendingUsed  = artists
    writeState(state)

    console.log('[AUTO-SEO] Done —', updated, 'videos updated')
    lastResult = { status: 'done', updated, total: videos.length, trendingArtists: artists, finishedAt: new Date().toISOString() }
  } catch (err) {
    console.error('[AUTO-SEO] Error:', err.message)
    lastResult = { status: 'error', error: err.message, finishedAt: new Date().toISOString() }
  } finally {
    running = false
  }
}

function start(mgr, port) {
  accountMgr = mgr
  if (port) baseUrl = `http://localhost:${port}`
  const state = readState()
  // Schedule next auto-run based on last run time
  // Se nunca correu, agenda para INTERVAL_MS a partir de agora (não de epoch 0)
  const lastRunTs = state.lastRun ? new Date(state.lastRun).getTime() : Date.now()
  nextRunAt = lastRunTs + INTERVAL_MS
  const msUntil = Math.max(0, nextRunAt - Date.now())
  console.log('[AUTO-SEO] Started — last run:', state.lastRun || 'never', '| total updated:', state.videosUpdated || 0, '| next in:', Math.round(msUntil / 3600000) + 'h')
  // Schedule auto-run
  setTimeout(async function _seoLoop() {
    await run()
    nextRunAt = Date.now() + INTERVAL_MS
    setTimeout(_seoLoop, INTERVAL_MS)
  }, msUntil)
}

function getStatus() {
  const state = readState()
  const now = Date.now()
  const msUntilNext = nextRunAt ? Math.max(0, nextRunAt - now) : null
  return {
    running,
    lastRun:      state.lastRun,
    totalUpdated: state.videosUpdated || 0,
    trendingUsed: state.trendingUsed || [],
    nextRunAt:    nextRunAt ? new Date(nextRunAt).toISOString() : null,
    msUntilNext,
    lastResult,
  }
}

function runNow() { return run() }

module.exports = { start, getStatus, runNow }

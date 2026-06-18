// autoPlaylists.js — organises channel videos into style playlists automatically
// Runs on startup (full scan) + called after each upload
const fs         = require('fs')
const path       = require('path')
const { google } = require('googleapis')

const STATE_FILE    = path.join(__dirname, 'data/playlists.json')
const ASSIGNED_FILE = path.join(__dirname, 'data/playlists_assigned.json')
fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
if (!fs.existsSync(STATE_FILE))    fs.writeFileSync(STATE_FILE,    '{}')
if (!fs.existsSync(ASSIGNED_FILE)) fs.writeFileSync(ASSIGNED_FILE, '[]')

function readState()          { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) }    catch { return {} } }
function writeState(s)        { fs.writeFileSync(STATE_FILE,    JSON.stringify(s, null, 2)) }
function readAssigned()       { try { return new Set(JSON.parse(fs.readFileSync(ASSIGNED_FILE, 'utf-8'))) } catch { return new Set() } }
function markAssigned(vid)    { const s = readAssigned(); s.add(vid); fs.writeFileSync(ASSIGNED_FILE, JSON.stringify([...s], null, 2)) }

// Detect beat style from title
const STYLE_RULES = [
  [/drill/i,                    'Drill Beats'],
  [/phonk/i,                    'Phonk Beats'],
  [/melodic|melody/i,           'Melodic Beats'],
  [/afro|afrobeat/i,            'Afro Beats'],
  [/rnb|r&b|r n b/i,           'RnB Beats'],
  [/boom\s*bap/i,               'Boom Bap Beats'],
  [/jersey|club\s*edit/i,       'Jersey Club Beats'],
  [/emotional|sad|piano/i,      'Emotional Beats'],
  [/dark|evil|sinister/i,       'Dark Beats'],
  [/chill|lofi|lo-fi/i,         'Chill Beats'],
]
function detectStyle(title) {
  for (const [re, style] of STYLE_RULES) {
    if (re.test(title)) return style
  }
  return 'Trap Beats'
}

let accountMgr = null
let running    = false
let lastResult = null

async function getOrCreatePlaylist(yt, style, state) {
  if (state[style]) return state[style]

  const res = await yt.playlists.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title:       `prodbygrillo — ${style}`,
        description: `${style} pelo produtor prodbygrillo. Licenças em https://www.beatstars.com/prodbygrillo`,
      },
      status: { privacyStatus: 'public' },
    },
  })
  const id = res.data.id
  state[style] = id
  writeState(state)
  console.log('[AUTO-PLAYLIST] Created playlist:', style, id)
  return id
}

async function addToPlaylist(yt, playlistId, videoId) {
  // Skip if already recorded as assigned — avoids burning 50 quota units per re-insert
  const assigned = readAssigned()
  if (assigned.has(videoId)) return false
  try {
    await yt.playlistItems.insert({
      part: ['snippet'],
      requestBody: {
        snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } },
      },
    })
    markAssigned(videoId)
    return true
  } catch (err) {
    if (err.message?.includes('duplicate')) {
      markAssigned(videoId)  // already there — record so we never try again
    } else {
      console.warn('[AUTO-PLAYLIST] addToPlaylist error:', err.message)
    }
    return false
  }
}

// Organise a single video (called from upload.js on new upload)
async function organiseVideo(videoId, title) {
  if (!accountMgr?.isAuthenticated()) return
  const auth  = accountMgr.getAuthClient()
  const yt    = google.youtube({ version: 'v3', auth })
  const state = readState()
  const style = detectStyle(title)
  const pid   = await getOrCreatePlaylist(yt, style, state)
  const added = await addToPlaylist(yt, pid, videoId)
  if (added) console.log('[AUTO-PLAYLIST] Added', videoId, '→', style)
}

// Full scan — run on startup to organise all existing videos
async function scanAll() {
  if (running || !accountMgr?.isAuthenticated()) return
  running = true
  console.log('[AUTO-PLAYLIST] Starting full scan...')
  lastResult = { status: 'running', startedAt: new Date().toISOString() }

  try {
    const auth  = accountMgr.getAuthClient()
    const yt    = google.youtube({ version: 'v3', auth })
    const state = readState()

    // Get uploads playlist
    const chRes  = await yt.channels.list({ part: ['contentDetails'], mine: true })
    const upId   = chRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!upId) throw new Error('No uploads playlist')

    // Fetch all videos
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
        if (vid && tit) videos.push({ videoId: vid, title: tit })
      }
      pageToken = r.data.nextPageToken
    } while (pageToken)

    console.log('[AUTO-PLAYLIST] Found', videos.length, 'videos to organise')
    let added = 0
    for (const v of videos) {
      const style = detectStyle(v.title)
      const pid   = await getOrCreatePlaylist(yt, style, state)
      const ok    = await addToPlaylist(yt, pid, v.videoId)
      if (ok) added++
      await new Promise(r => setTimeout(r, 300))
    }

    const styles = Object.keys(state)
    console.log('[AUTO-PLAYLIST] Done — organised', added, 'videos across', styles.length, 'playlists:', styles.join(', '))
    lastResult = { status: 'done', videosOrganised: added, playlists: styles, finishedAt: new Date().toISOString() }
  } catch (err) {
    console.error('[AUTO-PLAYLIST] Error:', err.message)
    lastResult = { status: 'error', error: err.message, finishedAt: new Date().toISOString() }
  } finally {
    running = false
  }
}

function start(mgr) {
  accountMgr = mgr
  const state = readState()
  console.log('[AUTO-PLAYLIST] Started (manual only) — playlists:', Object.keys(state).length || 'none yet')
}

function getStatus() {
  const state = readState()
  return { running, playlists: state, playlistCount: Object.keys(state).length, lastResult }
}

module.exports = { start, getStatus, organiseVideo, scanAll }

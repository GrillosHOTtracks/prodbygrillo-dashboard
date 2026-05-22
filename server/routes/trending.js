const express = require('express')
const fs   = require('fs')
const path = require('path')
const os   = require('os')
const { search } = require('../lib/innertube')

const router = express.Router()
const CACHE_FILE = path.join(os.tmpdir(), 'trending_cache.json')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadDisk() {
  try {
    if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
  } catch {}
  return null
}
function saveDisk(data) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(data)) } catch {}
}

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
}

// Extract the primary artist name from a "X Type Beat" title
function extractArtist(rawTitle) {
  const title = decodeHtml(rawTitle)
  const match = title.match(/\btype\s*beat\b/i)
  if (!match) return null

  let artist = title.slice(0, match.index).trim()
  artist = artist.replace(/^\[.*?\]\s*/g, '').replace(/^\(.*?\)\s*/g, '')
  artist = artist.replace(/^\s*free\s+/i, '').replace(/^\s*[-|–—:]\s*/, '').replace(/\s*[-|–—:]\s*$/, '').trim()
  if (!artist) return null

  const collabMatch = artist.match(/^(.+?)\s+(?:x\s+|&\s+|\/\s+|ft\.?\s+|feat\.?\s+)/i)
  if (collabMatch) artist = collabMatch[1].trim()

  artist = artist.replace(/\s+\d{4,}$/, '')
    .replace(/\s+(trap|drill|rnb|r&b|afro|pop|melodic|sad|dark|hard|phonk|chill)\s*$/i, '').trim()

  if (!artist || artist.length < 2 || artist.length > 40) return null
  if (/^\d+$/.test(artist)) return null
  if (/^(trap|drill|rnb|r&b|afro|pop|melodic|sad|dark|hard|phonk|freestyle|latino|afrobeat|afrobeats|chill|lofi|lo-fi|boom\s*bap|gangsta|old\s*school)$/i.test(artist)) return null

  return artist.toLowerCase().replace(/(^|\s|-)(\w)/g, (_, pre, char) => pre + char.toUpperCase())
}

function artistKey(name) { return name.toLowerCase().replace(/\s+/g, '') }

// Extract mood/vibe keywords from a video title
const VIBE_WORDS = ['dark', 'melodic', 'sad', 'chill', 'hard', 'aggressive', 'phonk', 'drill', 'afro', 'trap', 'emotional', 'wavy', 'banger', 'smooth', 'slow', 'fast', 'gangsta', 'lofi', 'boom bap', 'latin', 'dancehall', 'jersey', 'rnb', 'r&b', 'romantic', 'evil', 'sinister', 'cinematic', 'epic']
function extractVibes(titles) {
  const counts = {}
  for (const title of titles) {
    const t = title.toLowerCase()
    for (const v of VIBE_WORDS) {
      if (t.includes(v)) counts[v] = (counts[v] || 0) + 1
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([v]) => v)
}

// ─── Deezer enrichment ────────────────────────────────────────────────────────

async function fetchDeezer(artistName) {
  try {
    const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=1`
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4000),
    })
    if (!r.ok) return null
    const data = await r.json()
    const hit = data?.data?.[0]
    if (!hit) return null
    const nameLower = artistName.toLowerCase()
    const hitLower  = (hit.name || '').toLowerCase()
    // Only accept if name roughly matches (avoid random artist enrichment)
    if (!hitLower.includes(nameLower.split(' ')[0]) && !nameLower.includes(hitLower.split(' ')[0])) return null
    return {
      photo:       hit.picture_medium || null,
      deezerFans:  hit.nb_fan         || 0,
      deezerLink:  hit.link           || null,
    }
  } catch {
    return null
  }
}

// ─── Beat ideas per vibe ──────────────────────────────────────────────────────

const VIBE_IDEAS = {
  dark:       { bpm: '140–150', keys: ['Am', 'Dm', 'Cm'], elements: ['piano sombrio', '808 pesado', 'strings', 'snare reverb'] },
  melodic:    { bpm: '135–148', keys: ['F#m', 'Bm', 'Em'], elements: ['synth melodico', '808 suave', 'flute', 'pad'] },
  sad:        { bpm: '130–145', keys: ['Dm', 'Am', 'Em'], elements: ['piano emocional', '808 suave', 'strings', 'coro'] },
  chill:      { bpm: '85–105',  keys: ['Cmaj', 'Gmaj', 'Am'], elements: ['guitar suave', 'hihat delicado', 'bass suave', 'pad'] },
  hard:       { bpm: '148–165', keys: ['Cm', 'Gm', 'F#m'], elements: ['808 agressivo', 'snare pesado', 'bass distorted', 'dark sample'] },
  drill:      { bpm: '140–147', keys: ['Gm', 'Cm', 'F#m'], elements: ['808 slides', 'hihat off-beat', 'amostra dark', 'steel drums'] },
  afro:       { bpm: '95–112',  keys: ['Am', 'Dm', 'G'], elements: ['percussões afro', 'guitar amostrada', 'kora', 'bass afro'] },
  phonk:      { bpm: '130–155', keys: ['Dm', 'Cm', 'Am'], elements: ['amostra old school', 'cowbell', '808 distorted', 'choir vintage'] },
  trap:       { bpm: '140–160', keys: ['Am', 'Dm', 'Cm'], elements: ['hihat triplet', '808', 'piano', 'snare rápido'] },
  emotional:  { bpm: '128–145', keys: ['Em', 'Am', 'Dm'], elements: ['piano', '808', 'strings', 'vocal chop'] },
  wavy:       { bpm: '130–145', keys: ['Gmaj', 'Amaj', 'F#m'], elements: ['synth wave', '808 suave', 'reverb pesado', 'pad'] },
  banger:     { bpm: '145–165', keys: ['Am', 'Cm', 'Dm'], elements: ['808 heavy', 'snare crack', 'bass roll', 'ad-libs'] },
  default:    { bpm: '140–150', keys: ['Am', 'Dm', 'Cm'], elements: ['808', 'piano', 'hi-hats', 'snare'] },
}

function getBeatIdea(vibes) {
  for (const v of vibes) {
    if (VIBE_IDEAS[v]) return VIBE_IDEAS[v]
  }
  return VIBE_IDEAS.default
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function computeScores(artists) {
  // Normalize demandScore 0-100 based on avgViews
  const maxAvg = Math.max(...artists.map(a => a.avgViews), 1)
  return artists.map(a => {
    const demandScore = Math.round(
      (a.beatCount / 3) * 25 + (a.avgViews / maxAvg) * 75
    )
    const saturation =
      a.beatCount <= 4  ? 'low' :
      a.beatCount <= 14 ? 'medium' : 'high'

    // opportunityScore: high deezer fans + low beat demand = big opportunity
    const fans = a.deezerFans || 0
    const fansMil = fans / 1e6
    const oppRaw = fansMil > 0
      ? Math.round(fansMil * 15 / Math.sqrt(a.beatCount + 1) + 20)
      : Math.max(0, 60 - a.beatCount * 4)
    const opportunityScore = Math.min(100, Math.max(0, oppRaw))

    let hotTag = null
    if (demandScore >= 85)                 hotTag = '🔥 VIRAL'
    else if (fans > 5e6 && oppRaw >= 60)  hotTag = '💎 OPORTUNIDADE'
    else if (a.beatCount <= 4)            hotTag = '⬆ SUBINDO'
    else if (saturation === 'high')       hotTag = '⚠ SATURADO'

    return { ...a, demandScore: Math.min(100, demandScore), saturation, opportunityScore, hotTag }
  })
}

// ─── Cache ────────────────────────────────────────────────────────────────────

let _cache   = null
let _cacheTs = 0
const TTL    = 60 * 60 * 1000  // 1 hour

// ─── Route ────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  if (!req.query.bust && _cache && Date.now() - _cacheTs < TTL) {
    return res.json(_cache)
  }

  try {
    const now   = new Date()
    const year  = now.getUTCFullYear()
    const month = now.toLocaleString('en', { month: 'long' })

    // Broad + genre-specific queries — zero API quota (Innertube)
    const queries = [
      `type beat ${year}`,
      `free type beat ${year}`,
      `${month.toLowerCase()} type beat ${year}`,
      `trap type beat ${year}`,
      `drill type beat ${year}`,
      `melodic type beat ${year}`,
    ]

    const results = await Promise.all(queries.map(q => search(q).catch(() => [])))

    // Deduplicate by video ID
    const seen  = new Set()
    const items = []
    for (const videos of results) {
      for (const v of videos) {
        if (!seen.has(v.videoId)) { seen.add(v.videoId); items.push(v) }
      }
    }

    // Aggregate by artist
    const artistMap = {}
    for (const item of items) {
      const artist = extractArtist(decodeHtml(item.title))
      if (!artist) continue
      const key = artistKey(artist)
      if (!artistMap[key]) {
        artistMap[key] = { name: artist, beatCount: 0, totalViews: 0, avgViews: 0, latestBeat: '', titles: [], photo: null, deezerFans: 0, deezerLink: null }
      }
      artistMap[key].beatCount++
      artistMap[key].totalViews += item.views
      artistMap[key].titles.push(decodeHtml(item.title))
      if (!artistMap[key].latestBeat) artistMap[key].latestBeat = decodeHtml(item.title)
    }

    // Compute avgViews + vibes, take top 15
    let sorted = Object.values(artistMap)
      .filter(a => a.beatCount >= 1)
      .map(a => ({
        ...a,
        avgViews: Math.round(a.totalViews / a.beatCount),
        vibes: extractVibes(a.titles),
      }))
      .sort((a, b) => b.totalViews - a.totalViews)
      .slice(0, 15)

    // Deezer enrichment — parallel, 4s timeout each, non-blocking
    await Promise.all(sorted.map(async (a) => {
      const dz = await fetchDeezer(a.name)
      if (dz) { a.photo = dz.photo; a.deezerFans = dz.deezerFans; a.deezerLink = dz.deezerLink }
    }))

    // Add beatIdea + scores, strip internal titles array
    sorted = computeScores(sorted).map(({ titles: _, ...a }) => ({
      ...a,
      beatIdea: getBeatIdea(a.vibes),
    }))

    _cache   = sorted
    _cacheTs = Date.now()
    saveDisk(sorted)
    res.json(sorted)
  } catch (err) {
    const cached = _cache || loadDisk()
    if (cached) { _cache = cached; _cacheTs = Date.now(); return res.json(cached) }
    console.error('[trending]', err.message)
    res.status(500).json({ error: 'Trending unavailable', details: err.message })
  }
})

module.exports = router

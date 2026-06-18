const express = require('express')
const fs      = require('fs')
const path    = require('path')
const os      = require('os')
const { search } = require('../lib/innertube')

const router     = express.Router()
const CACHE_FILE = path.join(os.tmpdir(), 'market_cache.json')
const TTL        = 2 * 60 * 60 * 1000 // 2 h

// ─── Genres (10 niches, 1 query each → ~20 results = ~200 total YT calls) ─────

const GENRES = [
  { id: 'trap',    label: 'Trap',     query: 'trap type beat'     },
  { id: 'drill',   label: 'Drill',    query: 'drill type beat'    },
  { id: 'melodic', label: 'Melodic',  query: 'melodic type beat'  },
  { id: 'phonk',   label: 'Phonk',    query: 'phonk type beat'    },
  { id: 'afro',    label: 'Afro',     query: 'afrobeats type beat'},
  { id: 'dark',    label: 'Dark',     query: 'dark type beat'     },
  { id: 'rnb',     label: 'R&B',      query: 'rnb type beat'      },
  { id: 'hard',    label: 'Hard',     query: 'hard type beat'     },
  { id: 'chill',   label: 'Chill',    query: 'chill type beat'    },
  { id: 'boombap', label: 'Boom Bap', query: 'boom bap type beat' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))
}

function extractArtist(rawTitle) {
  const title = decodeHtml(rawTitle)
  const match = title.match(/\btype\s*beat\b/i)
  if (!match) return null
  let artist = title.slice(0, match.index).trim()
  artist = artist.replace(/^\[.*?\]\s*/g, '').replace(/^\(.*?\)\s*/g, '')
    .replace(/^\s*free\s+/i, '').replace(/^\s*[-|–—:]\s*/, '').replace(/\s*[-|–—:]\s*$/, '').trim()
  if (!artist) return null
  const collab = artist.match(/^(.+?)\s+(?:x\s+|&\s+|\/\s+|ft\.?\s+|feat\.?\s+)/i)
  if (collab) artist = collab[1].trim()
  artist = artist.replace(/\s+\d{4,}$/, '')
    .replace(/\s+(trap|drill|rnb|r&b|afro|pop|melodic|sad|dark|hard|phonk|chill)\s*$/i, '').trim()
  if (!artist || artist.length < 2 || artist.length > 40) return null
  if (/^\d+$/.test(artist)) return null
  if (/\bbeat\b/i.test(artist)) return null
  if (/^(trap|drill|rnb|r&b|afro|pop|melodic|sad|dark|hard|phonk|freestyle|latino|afrobeat|afrobeats|chill|lofi|lo-fi|boom\s*bap|gangsta|old\s*school|free)$/i.test(artist)) return null
  return artist.toLowerCase().replace(/(^|\s|-)(\w)/g, (_, p, c) => p + c.toUpperCase())
}

const VIBE_IDEAS = {
  dark:    { bpm: '140–150', keys: ['Am', 'Dm', 'Cm'],    elements: ['piano sombrio', '808 pesado', 'strings', 'snare reverb'] },
  melodic: { bpm: '135–148', keys: ['F#m', 'Bm', 'Em'],   elements: ['synth melodico', '808 suave', 'flute', 'pad'] },
  chill:   { bpm: '85–105',  keys: ['Cmaj', 'Gmaj', 'Am'],elements: ['guitar suave', 'hihat delicado', 'bass suave', 'pad'] },
  drill:   { bpm: '140–147', keys: ['Gm', 'Cm', 'F#m'],   elements: ['808 slides', 'hihat off-beat', 'sample dark', 'steel drums'] },
  afro:    { bpm: '95–112',  keys: ['Am', 'Dm', 'G'],      elements: ['percussões afro', 'guitar amostrada', 'kora', 'bass afro'] },
  phonk:   { bpm: '130–155', keys: ['Dm', 'Cm', 'Am'],     elements: ['sample old school', 'cowbell', '808 distorted', 'choir vintage'] },
  hard:    { bpm: '148–165', keys: ['Cm', 'Gm', 'F#m'],   elements: ['808 agressivo', 'snare pesado', 'bass distorted', 'dark sample'] },
  rnb:     { bpm: '70–95',   keys: ['Gmaj', 'Cmaj', 'F'],  elements: ['guitar elétrica', 'pad suave', 'hihat suave', 'vocal chop'] },
  boombap: { bpm: '85–100',  keys: ['Cm', 'Am', 'Gm'],     elements: ['sample jazz', 'snare crack', 'bass groove', 'scratches'] },
  trap:    { bpm: '140–160', keys: ['Am', 'Dm', 'Cm'],     elements: ['hihat triplet', '808', 'piano', 'snare rápido'] },
}

// ─── Cache ────────────────────────────────────────────────────────────────────

let _cache   = null
let _cacheTs = 0

function loadDisk() {
  try { if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) } catch {}
  return null
}
function saveDisk(data) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(data)) } catch {}
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  if (!req.query.bust && _cache && Date.now() - _cacheTs < TTL) return res.json(_cache)

  try {
    // Fetch all genres in parallel (10 queries, ~20 results each)
    const results = await Promise.all(
      GENRES.map(g => search(g.query).catch(() => []))
    )

    const maxAvgViews = Math.max(
      1,
      ...results.map(vids =>
        vids.length ? Math.round(vids.reduce((s, v) => s + (v.views || 0), 0) / vids.length) : 0
      )
    )

    const genres = GENRES.map((g, i) => {
      const vids = results[i]
      if (!vids.length) return null

      const beatCount  = vids.length
      const totalViews = vids.reduce((s, v) => s + (v.views || 0), 0)
      const avgViews   = Math.round(totalViews / beatCount)

      // Top artists in this genre
      const artistMap = {}
      for (const v of vids) {
        const artist = extractArtist(decodeHtml(v.title || ''))
        if (!artist) continue
        const key = artist.toLowerCase().replace(/\s+/g, '')
        if (!artistMap[key]) artistMap[key] = { name: artist, views: 0, count: 0 }
        artistMap[key].views += v.views || 0
        artistMap[key].count++
      }
      const topArtists = Object.values(artistMap)
        .sort((a, b) => b.views - a.views)
        .slice(0, 3)
        .map(a => a.name)

      // Saturation
      const saturation = beatCount <= 8 ? 'low' : beatCount <= 15 ? 'medium' : 'high'

      // Opportunity: popularity (avg views normalized) + market space (inverse of beats)
      const popularity  = Math.min(1, avgViews / maxAvgViews)
      const marketSpace = Math.max(0, 1 - beatCount / 20)
      const oppRaw      = Math.round(popularity * 60 + marketSpace * 40)
      const opportunityScore = Math.min(100, Math.max(0, oppRaw))

      let hotTag = null
      if (opportunityScore >= 75 && saturation !== 'high') hotTag = '💎 OPORTUNIDADE'
      else if (avgViews >= maxAvgViews * 0.75)             hotTag = '🔥 VIRAL'
      else if (saturation === 'low')                        hotTag = '⬆ SUBINDO'
      else if (saturation === 'high')                       hotTag = '⚠ SATURADO'

      const beatIdea = VIBE_IDEAS[g.id] || VIBE_IDEAS.trap

      return { id: g.id, label: g.label, beatCount, avgViews, totalViews, topArtists, saturation, opportunityScore, hotTag, beatIdea }
    }).filter(Boolean)

    _cache   = genres
    _cacheTs = Date.now()
    saveDisk(genres)
    res.json(genres)
  } catch (err) {
    const cached = _cache || loadDisk()
    if (cached) { _cache = cached; _cacheTs = Date.now(); return res.json(cached) }
    console.error('[market]', err.message)
    res.status(500).json({ error: 'Market unavailable', details: err.message })
  }
})

module.exports = router

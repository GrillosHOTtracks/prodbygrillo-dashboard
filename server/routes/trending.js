const express = require('express')
const fs   = require('fs')
const path = require('path')
const os   = require('os')
const { search } = require('../lib/innertube')

const router = express.Router()
const CACHE_FILE = path.join(os.tmpdir(), 'trending_cache.json')

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
    .replace(/\s+(trap|drill|rnb|r&b|afro|pop|melodic|sad|dark|hard)\s*$/i, '').trim()

  if (!artist || artist.length < 2 || artist.length > 40) return null
  if (/^\d+$/.test(artist)) return null
  // Filter out bare genre words mistaken as artists
  if (/^(trap|drill|rnb|r&b|afro|pop|melodic|sad|dark|hard|phonk|freestyle|latino|afrobeat|afrobeats|chill|lofi|lo-fi|boom\s*bap|gangsta|old\s*school)$/i.test(artist)) return null

  return artist.toLowerCase().replace(/(^|\s|-)(\w)/g, (_, pre, char) => pre + char.toUpperCase())
}

function artistKey(name) { return name.toLowerCase().replace(/\s+/g, '') }

let _cache = null
let _cacheTs = 0
const TTL = 60 * 60 * 1000

router.get('/', async (req, res) => {
  if (!req.query.bust && _cache && Date.now() - _cacheTs < TTL) {
    return res.json(_cache)
  }

  try {
    const now   = new Date()
    const year  = now.getUTCFullYear()
    const month = now.toLocaleString('en', { month: 'long' })

    // Three queries via Innertube — zero quota cost
    const queries = [
      `type beat ${year}`,
      `free type beat ${year}`,
      `${month.toLowerCase()} type beat ${year}`,
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
      if (!artistMap[key]) artistMap[key] = { name: artist, beatCount: 0, totalViews: 0, latestBeat: '' }
      artistMap[key].beatCount++
      artistMap[key].totalViews += item.views
    }

    const result = Object.values(artistMap)
      .filter(a => a.beatCount >= 1)
      .sort((a, b) => b.totalViews - a.totalViews)
      .slice(0, 10)

    _cache   = result
    _cacheTs = Date.now()
    saveDisk(result)
    res.json(result)
  } catch (err) {
    const cached = _cache || loadDisk()
    if (cached) { _cache = cached; _cacheTs = Date.now(); return res.json(cached) }
    console.error('[trending]', err.message)
    res.status(500).json({ error: 'Trending unavailable', details: err.message })
  }
})

module.exports = router

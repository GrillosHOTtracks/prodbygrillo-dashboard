const express = require('express')
const { google } = require('googleapis')
const accountManager = require('../accountManager')
const { isQuotaError, sendError } = require('../apiError')

const router = express.Router()

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
    const result = await accountManager.withPublicYouTube(async (auth) => {
      const youtube = google.youtube({ version: 'v3', auth })

      const now  = new Date()
      const year = now.getUTCFullYear()
      // Format without milliseconds — some API versions reject .000Z
      const publishedAfter = `${year}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00Z`

      const queries = [`type beat ${year}`, `free type beat ${year}`, `trap type beat ${year}`]

      const searches = await Promise.all(
        queries.map(q =>
          youtube.search.list({
            part: ['id', 'snippet'], q, type: ['video'],
            publishedAfter, maxResults: 50,
          }).catch(err => {
            if (isQuotaError(err)) throw err
            return { data: { items: [] } }
          })
        )
      )

      // Deduplicate by video ID
      const seen = new Set()
      const items = []
      for (const s of searches) {
        for (const item of s.data.items || []) {
          const id = item.id?.videoId
          if (id && !seen.has(id)) { seen.add(id); items.push(item) }
        }
      }
      if (!items.length) return []

      // Fetch view counts (1 quota unit)
      const statsRes = await youtube.videos.list({ part: ['statistics'], id: items.map(i => i.id.videoId) })
      const statsMap = {}
      for (const v of statsRes.data.items || []) statsMap[v.id] = v.statistics

      // Aggregate by artist
      const artistMap = {}
      for (const item of items) {
        const id     = item.id.videoId
        const artist = extractArtist(decodeHtml(item.snippet.title))
        if (!artist) continue
        const views       = parseInt(statsMap[id]?.viewCount || '0')
        const publishedAt = item.snippet.publishedAt || ''
        const key         = artistKey(artist)
        if (!artistMap[key]) artistMap[key] = { name: artist, beatCount: 0, totalViews: 0, latestBeat: publishedAt }
        artistMap[key].beatCount++
        artistMap[key].totalViews += views
        if (publishedAt > artistMap[key].latestBeat) artistMap[key].latestBeat = publishedAt
      }

      return Object.values(artistMap)
        .filter(a => a.beatCount >= 1)
        .sort((a, b) => b.totalViews - a.totalViews)
        .slice(0, 10)
    })

    _cache   = result
    _cacheTs = Date.now()
    res.json(result)
  } catch (err) {
    sendError(res, err, 'trending route')
  }
})

module.exports = router

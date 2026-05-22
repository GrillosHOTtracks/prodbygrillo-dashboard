const express = require('express')
const { google } = require('googleapis')
const accountManager = require('../accountManager')
const { isQuotaError, sendError } = require('../apiError')

const router = express.Router()

// Cache channel info for 30 minutes (saves 1 quota unit per request)
let _cache = null
const CACHE_TTL = 30 * 60 * 1000

router.get('/', async (req, res) => {
  if (!req.query.bust && _cache && Date.now() - _cache._ts < CACHE_TTL) {
    return res.json({ ..._cache.data, _cached: true })
  }

  try {
    const result = await accountManager.withYouTube(async (auth) => {
      const youtube = google.youtube({ version: 'v3', auth })
      const { data } = await youtube.channels.list({
        part: ['snippet', 'statistics', 'brandingSettings'],
        mine: true,
      })
      const ch = data.items?.[0]
      if (!ch) return null
      return {
        id:          ch.id,
        name:        ch.snippet.title,
        handle:      ch.snippet.customUrl || `@${ch.snippet.title}`,
        description: ch.snippet.description,
        thumbnail:   ch.snippet.thumbnails?.default?.url,
        country:     ch.snippet.country || 'BR',
        publishedAt: ch.snippet.publishedAt,
        subscribers: parseInt(ch.statistics.subscriberCount || '0'),
        totalViews:  parseInt(ch.statistics.viewCount || '0'),
        totalVideos: parseInt(ch.statistics.videoCount || '0'),
      }
    })
    if (!result) return res.status(404).json({ error: 'Channel not found' })
    _cache = { data: result, _ts: Date.now() }
    res.json(result)
  } catch (err) {
    if (isQuotaError(err) && _cache) return res.json({ ..._cache.data, _cached: true })
    sendError(res, err, 'channel route')
  }
})

module.exports = router

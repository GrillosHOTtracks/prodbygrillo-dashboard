const express = require('express')
const { google } = require('googleapis')
const accountManager = require('../accountManager')
const { isQuotaError, sendError } = require('../apiError')

const router = express.Router()

function fmtDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return '0:00'
  const h   = parseInt(m[1] || '0')
  const min = parseInt(m[2] || '0')
  const s   = parseInt(m[3] || '0')
  return h > 0
    ? `${h}:${String(min).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${min}:${String(s).padStart(2,'0')}`
}

let _cache = null

// GET /api/videos?maxResults=25
router.get('/', async (req, res) => {
  try {
    const maxResults = Math.min(parseInt(req.query.maxResults || '25'), 50)
    const result = await accountManager.withYouTube(async (auth) => {
      const youtube = google.youtube({ version: 'v3', auth })
      const ya      = google.youtubeAnalytics({ version: 'v2', auth })

      // 1. Get channel ID
      const chRes     = await youtube.channels.list({ part: ['id'], mine: true })
      const channelId = chRes.data.items?.[0]?.id
      if (!channelId) return []

      // 2. Get top videos by viewCount
      const searchRes = await youtube.search.list({
        part: ['id'], channelId, type: ['video'], order: 'viewCount', maxResults,
      })
      const videoIds = (searchRes.data.items || []).map(i => i.id.videoId).filter(Boolean)
      if (!videoIds.length) return []

      // 3. Get full video details
      const videosRes = await youtube.videos.list({
        part: ['snippet', 'statistics', 'contentDetails'],
        id:   videoIds,
      })

      const videos = (videosRes.data.items || []).map(v => ({
        id:          v.id,
        title:       v.snippet.title,
        thumbnail:   v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url,
        publishedAt: v.snippet.publishedAt?.split('T')[0] || '',
        views:       parseInt(v.statistics?.viewCount   || '0'),
        likes:       parseInt(v.statistics?.likeCount   || '0'),
        comments:    parseInt(v.statistics?.commentCount || '0'),
        watchTime:   0,
        ctr:         0,
        avgDuration: fmtDuration(v.contentDetails?.duration || 'PT0S'),
        revenue:     0,
        status:      'published',
      }))

      // 4. Per-video analytics
      const analyticsParams = {
        ids:        'channel==MINE',
        startDate:  '2020-01-01',
        endDate:    new Date().toISOString().split('T')[0],
        dimensions: 'video',
        filters:    `video==${videoIds.join(',')}`,
        sort:       '-views',
        maxResults: videoIds.length,
      }

      let analyticsRows = [], revenueIncluded = false
      try {
        const r = await ya.reports.query({
          ...analyticsParams,
          metrics: 'views,estimatedMinutesWatched,averageViewPercentage,estimatedRevenue',
        })
        analyticsRows   = r.data.rows || []
        revenueIncluded = true
      } catch (revErr) {
        if (isQuotaError(revErr)) throw revErr
        try {
          const r = await ya.reports.query({
            ...analyticsParams,
            metrics: 'views,estimatedMinutesWatched,averageViewPercentage',
          })
          analyticsRows = r.data.rows || []
        } catch (e) {
          console.warn('Per-video analytics unavailable:', e.message)
        }
      }

      const analyticsMap = {}
      for (const row of analyticsRows) {
        analyticsMap[row[0]] = {
          watchTime:  row[2],
          avgViewPct: parseFloat((row[3] || 0).toFixed(1)),
          revenue:    revenueIncluded ? parseFloat((row[4] || 0).toFixed(2)) : 0,
        }
      }
      for (const v of videos) {
        if (analyticsMap[v.id]) {
          v.watchTime = Math.round(analyticsMap[v.id].watchTime)
          v.ctr       = analyticsMap[v.id].avgViewPct
          v.revenue   = analyticsMap[v.id].revenue
        }
      }

      return videos.sort((a, b) => b.views - a.views)
    })
    _cache = { data: result, _cachedAt: new Date().toISOString() }
    res.json({ data: result })
  } catch (err) {
    if (isQuotaError(err) && _cache) return res.json({ ..._cache, _cached: true })
    sendError(res, err, 'videos route')
  }
})

module.exports = router

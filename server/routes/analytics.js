const express = require('express')
const { google } = require('googleapis')
const accountManager = require('../accountManager')
const { isQuotaError, sendError } = require('../apiError')

const router = express.Router()

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

function rangeToDs(range) {
  const map = { '7d': 7, '28d': 28, '90d': 90, '365d': 365 }
  return map[range] || 28
}

function fillDates(rows, startDate, endDate) {
  const empty = { views: 0, watchTime: 0, subscribers: 0, impressions: 0, ctr: 0, revenue: 0 }
  const dateMap = new Map(rows.map(r => [r.date, r]))
  const result = []
  const cur = new Date(startDate + 'T00:00:00Z')
  const end = new Date(endDate + 'T00:00:00Z')
  while (cur <= end) {
    const d = cur.toISOString().split('T')[0]
    result.push(dateMap.get(d) || { ...empty, date: d })
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return result
}

const _cache = { analytics: {}, traffic: {}, revenue: null }

const CACHE_TTL = 30 * 60 * 1000  // 30 min — serve cache while fresh, force refresh after

// GET /api/analytics?range=28d
router.get('/', async (req, res) => {
  const range = req.query.range || '28d'
  // Serve in-memory cache if fresh (avoids unnecessary quota spend)
  const cached = _cache.analytics[range]
  if (!req.query.bust && cached && Date.now() - new Date(cached._cachedAt).getTime() < CACHE_TTL) {
    return res.json({ ...cached, _cached: true })
  }
  try {
    const days   = rangeToDs(range)
    const result = await accountManager.withPrimaryYouTube(async (auth) => {
      const ya        = google.youtubeAnalytics({ version: 'v2', auth })
      const startDate = daysAgo(days)
      const endDate   = daysAgo(0)
      const metrics   = [
        'views', 'estimatedMinutesWatched', 'subscribersGained',
        'averageViewDuration', 'averageViewPercentage',
      ]

      let revenueIncluded = true
      let report
      try {
        report = await ya.reports.query({
          ids: 'channel==MINE', startDate, endDate,
          metrics: [...metrics, 'estimatedRevenue'].join(','),
          dimensions: 'day', sort: 'day',
        })
      } catch (revErr) {
        if (isQuotaError(revErr)) throw revErr
        revenueIncluded = false
        report = await ya.reports.query({
          ids: 'channel==MINE', startDate, endDate,
          metrics: metrics.join(','),
          dimensions: 'day', sort: 'day',
        })
      }

      const sparse = (report.data.rows || []).map(row => ({
        date:        row[0],
        views:       row[1] || 0,
        watchTime:   row[2] || 0,
        subscribers: row[3] || 0,
        impressions: Math.round(row[4] || 0),
        ctr:         parseFloat((row[5] || 0).toFixed(1)),
        revenue:     revenueIncluded ? parseFloat((row[6] || 0).toFixed(2)) : 0,
      }))
      return { data: fillDates(sparse, startDate, endDate), revenueIncluded }
    })
    _cache.analytics[range] = { ...result, _cachedAt: new Date().toISOString() }
    res.json(result)
  } catch (err) {
    const c = _cache.analytics[range]
    if (isQuotaError(err) && c) return res.json({ ...c, _cached: true })
    sendError(res, err, 'analytics route')
  }
})

// GET /api/analytics/traffic
router.get('/traffic', async (req, res) => {
  const range = req.query.range || '28d'
  const cachedT = _cache.traffic[range]
  if (!req.query.bust && cachedT && Date.now() - new Date(cachedT._cachedAt).getTime() < CACHE_TTL) {
    return res.json({ ...cachedT, _cached: true })
  }
  try {
    const days   = rangeToDs(range)
    const rows = await accountManager.withPrimaryYouTube(async (auth) => {
      const ya = google.youtubeAnalytics({ version: 'v2', auth })
      const { data } = await ya.reports.query({
        ids: 'channel==MINE',
        startDate: daysAgo(days),
        endDate:   daysAgo(0),
        metrics:   'views',
        dimensions: 'insightTrafficSourceType',
        sort: '-views',
      })

      const sourceLabels = {
        YT_SEARCH:          'YouTube Search',
        EXT_URL:            'External',
        RELATED_VIDEO:      'Suggested Videos',
        BROWSE_FEATURES:    'Browse Features',
        DIRECT_OR_UNKNOWN:  'Direct / Unknown',
        NO_LINK_OTHER:      'Direct / Unknown',
        PLAYLIST:           'Playlists',
        NOTIFICATION:       'Notifications',
        END_SCREEN:         'End Screen',
        YT_CHANNEL:         'Channel Page',
        YT_OTHER_PAGE:      'YouTube Other',
        SUBSCRIBER:         'Subscribers',
        CAMPAIGN_CARD:      'Paid Promotion',
        HASHTAGS:           'Hashtags',
        SOUND_PAGE:         'Sound Page',
        SHORTS:             'YouTube Shorts',
      }
      const colors = ['#00ff00','#c0c0c0','#909090','#707070','#505050','#333333','#aaaaaa','#808080']
      const dataRows = data.rows || []
      const total = dataRows.reduce((s, r) => s + r[1], 0)

      const raw     = dataRows.map(r => (r[1] / total) * 100)
      const floored = raw.map(Math.floor)
      const remainder = 100 - floored.reduce((a, b) => a + b, 0)
      const indices = raw.map((v, i) => [v - Math.floor(v), i])
        .sort((a, b) => b[0] - a[0])
        .slice(0, remainder)
        .map(([, i]) => i)
      return dataRows.map((row, i) => ({
        name:  sourceLabels[row[0]] || row[0],
        value: floored[i] + (indices.includes(i) ? 1 : 0),
        color: colors[i] || '#333333',
      }))
    })
    _cache.traffic[range] = { data: rows, _cachedAt: new Date().toISOString() }
    res.json({ data: rows })
  } catch (err) {
    const c = _cache.traffic[range]
    if (isQuotaError(err) && c) return res.json({ ...c, _cached: true })
    sendError(res, err, 'traffic route')
  }
})

// GET /api/analytics/revenue-monthly
router.get('/revenue-monthly', async (req, res) => {
  if (!req.query.bust && _cache.revenue && Date.now() - new Date(_cache.revenue._cachedAt).getTime() < CACHE_TTL) {
    return res.json({ ..._cache.revenue, _cached: true })
  }
  try {
    const rows = await accountManager.withPrimaryYouTube(async (auth) => {
      const ya  = google.youtubeAnalytics({ version: 'v2', auth })
      const now = new Date()
      // dimensions=month requires both dates to be the 1st of a month
      const endDate   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().split('T')[0]  // 1st of prev month
      const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1)).toISOString().split('T')[0] // 1st, 12 months ago

      const { data } = await ya.reports.query({
        ids: 'channel==MINE', startDate, endDate,
        metrics: 'estimatedRevenue', dimensions: 'month', sort: 'month',
      })

      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      return (data.rows || []).map(row => {
        const monthNum = parseInt(row[0].split('-')[1]) - 1
        return { month: monthNames[monthNum], revenue: parseFloat((row[1] || 0).toFixed(2)) }
      })
    })
    _cache.revenue = { data: rows, _cachedAt: new Date().toISOString() }
    res.json({ data: rows })
  } catch (err) {
    if (isQuotaError(err) && _cache.revenue) return res.json({ ..._cache.revenue, _cached: true })
    sendError(res, err, 'revenue-monthly')
  }
})

module.exports = router

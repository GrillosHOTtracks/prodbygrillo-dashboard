const express = require('express')
const { google } = require('googleapis')
const fs   = require('fs')
const path = require('path')
const os   = require('os')
const accountManager = require('../accountManager')
const { isQuotaError, sendError } = require('../apiError')
const { channelFeed } = require('../lib/innertube')

const router = express.Router()

const CHANNEL_CACHE_FILE = path.join(os.tmpdir(), 'channel_info.json')
const VIDEOS_CACHE_FILE  = path.join(os.tmpdir(), 'videos_cache.json')
const CACHE_TTL = 15 * 60 * 1000

let _cache = null  // { data, _ts }

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

function loadDisk(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {}
  return null
}

function saveDisk(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data)) } catch {}
}

// Derives uploadsPlaylist from channelId: UC... → UU...
function uploadsFromChannelId(channelId) {
  return channelId ? 'UU' + channelId.slice(2) : null
}

// GET /api/videos
router.get('/', async (req, res) => {
  if (_cache && Date.now() - _cache._ts < CACHE_TTL) {
    return res.json({ data: _cache.data, _cached: true })
  }

  // Declared outside try so catch block can access for RSS fallback
  // Initialize from env so RSS fallback works even when channel cache is cold
  let channelId = process.env.CHANNEL_ID || null
  let uploadsPlaylist = null

  try {
    const maxResults = Math.min(parseInt(req.query.maxResults || '25'), 50)

    // Step 1: resolve channelId + uploadsPlaylistId
    // Try channel cache first (avoids OAuth Data API call when quota exceeded)
    const channelDisk = loadDisk(CHANNEL_CACHE_FILE)
    if (channelDisk?.id) {
      channelId       = channelDisk.id
      uploadsPlaylist = channelDisk.uploadsPlaylist || uploadsFromChannelId(channelId)

    } else {
      // Fall back to live OAuth call
      const chData = await accountManager.withPrimaryYouTube(async (auth) => {
        const yt = google.youtube({ version: 'v3', auth })
        const { data } = await yt.channels.list({ part: ['id', 'contentDetails'], mine: true })
        const ch = data.items?.[0]
        return ch ? { id: ch.id, uploadsPlaylist: ch.contentDetails?.relatedPlaylists?.uploads } : null
      })
      if (!chData) return res.json({ data: [] })
      channelId       = chData.id
      uploadsPlaylist = chData.uploadsPlaylist || uploadsFromChannelId(channelId)
    }

    if (!uploadsPlaylist) return res.json({ data: [] })

    // Step 2: playlistItems + videos.list — use API keys (no OAuth required)
    const result = await accountManager.withPublicYouTube(async ({ auth }) => {
      const youtube = google.youtube({ version: 'v3', auth })

      // 2a. Get video IDs from uploads playlist (1 quota unit)
      const playlistRes = await youtube.playlistItems.list({
        part: ['contentDetails'], playlistId: uploadsPlaylist, maxResults,
      })
      const videoIds = (playlistRes.data.items || [])
        .map(i => i.contentDetails?.videoId).filter(Boolean)
      if (!videoIds.length) return []

      // 2b. Get video details (1 quota unit)
      const videosRes = await youtube.videos.list({
        part: ['snippet', 'statistics', 'contentDetails'], id: videoIds,
      })

      const videos = (videosRes.data.items || []).map(v => ({
        id:          v.id,
        title:       v.snippet.title,
        thumbnail:   v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url,
        publishedAt: v.snippet.publishedAt?.split('T')[0] || '',
        views:       parseInt(v.statistics?.viewCount   || '0'),
        likes:       parseInt(v.statistics?.likeCount   || '0'),
        comments:    parseInt(v.statistics?.commentCount || '0'),
        watchTime:   0, ctr: 0,
        avgDuration: fmtDuration(v.contentDetails?.duration || 'PT0S'),
        revenue:     0, status: 'published',
      }))

      // 2c. Per-video analytics via OAuth (YouTube Analytics API — separate quota)
      try {
        const ya = google.youtubeAnalytics({ version: 'v2', auth: accountManager.getAuthClient() })
        const analyticsParams = {
          ids: 'channel==MINE',
          startDate: '2020-01-01',
          endDate:   new Date().toISOString().split('T')[0],
          dimensions: 'video',
          filters:   `video==${videoIds.join(',')}`,
          sort:      '-views',
          maxResults: videoIds.length,
        }
        let analyticsRows = [], revenueIncluded = false
        try {
          const r = await ya.reports.query({
            ...analyticsParams,
            metrics: 'views,estimatedMinutesWatched,averageViewPercentage,estimatedRevenue',
          })
          analyticsRows = r.data.rows || []
          revenueIncluded = true
        } catch (revErr) {
          if (isQuotaError(revErr)) throw revErr
          const r = await ya.reports.query({
            ...analyticsParams,
            metrics: 'views,estimatedMinutesWatched,averageViewPercentage',
          })
          analyticsRows = r.data.rows || []
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
      } catch (e) {
        console.warn('[videos] analytics unavailable:', e.message)
      }

      return videos.sort((a, b) => b.views - a.views)
    })

    _cache = { data: result, _ts: Date.now() }
    saveDisk(VIDEOS_CACHE_FILE, result)
    res.json({ data: result })
  } catch (err) {
    // Quota exceeded → try RSS feed (zero quota, last 15 videos)
    if (isQuotaError(err) && channelId) {
      try {
        console.log('[videos] quota exceeded, trying RSS fallback')
        const rssVideos = await channelFeed(channelId)
        if (rssVideos.length) {
          // Try to enrich with Analytics (separate quota — usually still available)
          try {
            const ya = google.youtubeAnalytics({ version: 'v2', auth: accountManager.getAuthClient() })
            const videoIds = rssVideos.map(v => v.id)
            const r = await ya.reports.query({
              ids: 'channel==MINE',
              startDate: '2020-01-01',
              endDate: new Date().toISOString().split('T')[0],
              dimensions: 'video',
              filters: `video==${videoIds.join(',')}`,
              metrics: 'views,estimatedMinutesWatched,averageViewPercentage',
              maxResults: videoIds.length,
            })
            const aMap = {}
            for (const row of r.data.rows || []) {
              aMap[row[0]] = { views: row[1], watchTime: row[2], ctr: parseFloat((row[3] || 0).toFixed(1)) }
            }
            for (const v of rssVideos) {
              if (aMap[v.id]) {
                v.views     = aMap[v.id].views || v.views
                v.watchTime = Math.round(aMap[v.id].watchTime)
                v.ctr       = aMap[v.id].ctr
              }
            }
          } catch { /* analytics optional */ }

          const sorted = rssVideos.sort((a, b) => b.views - a.views)
          _cache = { data: sorted, _ts: Date.now() }
          saveDisk(VIDEOS_CACHE_FILE, sorted)
          return res.json({ data: sorted, _rss: true })
        }
      } catch (rssErr) {
        console.warn('[videos] RSS fallback failed:', rssErr.message)
      }
    }

    // Last resort: disk cache
    const diskData = _cache?.data || loadDisk(VIDEOS_CACHE_FILE)
    if (diskData) return res.json({ data: diskData, _cached: true })
    sendError(res, err, 'videos route')
  }
})

module.exports = router

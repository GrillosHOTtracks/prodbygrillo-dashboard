const express = require('express')
const { google } = require('googleapis')
const fs   = require('fs')
const path = require('path')
const os   = require('os')
const accountManager = require('../accountManager')
const { isQuotaError, sendError } = require('../apiError')

const router  = express.Router()
const CACHE_FILE = path.join(os.tmpdir(), 'channel_info.json')
const MEM_TTL    = 30 * 60 * 1000  // 30 min in-memory TTL

let _mem = null  // { data, _ts }

function loadDisk() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    }
  } catch {}
  return null
}

function saveDisk(data) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(data)) } catch {}
}

router.get('/', async (req, res) => {
  // Serve in-memory cache (30 min)
  if (!req.query.bust && _mem && Date.now() - _mem._ts < MEM_TTL) {
    return res.json({ ..._mem.data, _cached: true })
  }

  try {
    const result = await accountManager.withYouTube(async (auth) => {
      const youtube = google.youtube({ version: 'v3', auth })
      const { data } = await youtube.channels.list({
        part: ['snippet', 'statistics', 'contentDetails'],
        mine: true,
      })
      const ch = data.items?.[0]
      if (!ch) return null
      return {
        id:               ch.id,
        name:             ch.snippet.title,
        handle:           ch.snippet.customUrl || `@${ch.snippet.title}`,
        description:      ch.snippet.description,
        thumbnail:        ch.snippet.thumbnails?.default?.url,
        country:          ch.snippet.country || 'BR',
        publishedAt:      ch.snippet.publishedAt,
        subscribers:      parseInt(ch.statistics.subscriberCount || '0'),
        totalViews:       parseInt(ch.statistics.viewCount || '0'),
        totalVideos:      parseInt(ch.statistics.videoCount || '0'),
        uploadsPlaylist:  ch.contentDetails?.relatedPlaylists?.uploads || null,
      }
    })
    if (!result) return res.status(404).json({ error: 'Channel not found' })
    _mem = { data: result, _ts: Date.now() }
    saveDisk(result)
    res.json(result)
  } catch (err) {
    // On quota/error: try memory, then disk
    if (isQuotaError(err)) {
      const cached = _mem?.data || loadDisk()
      if (cached) return res.json({ ...cached, _cached: true })
    }
    sendError(res, err, 'channel route')
  }
})

module.exports = router

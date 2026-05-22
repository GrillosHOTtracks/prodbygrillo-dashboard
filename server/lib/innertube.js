// YouTube Innertube API — zero quota, zero API key
// Same API the YouTube website uses internally

const CTX = {
  client: {
    clientName: 'WEB',
    clientVersion: '2.20240101.00.00',
    hl: 'en',
    gl: 'US',
  },
}

const BASE = 'https://www.youtube.com/youtubei/v1'
const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://www.youtube.com',
  'Referer': 'https://www.youtube.com/',
}

function post(endpoint, body) {
  return fetch(`${BASE}/${endpoint}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ context: CTX, ...body }),
  }).then(r => {
    if (!r.ok) throw new Error(`Innertube ${endpoint} → ${r.status}`)
    return r.json()
  })
}

// Parse "1.2M views", "4,511 views", "1K views" → integer
function parseViews(text) {
  if (!text) return 0
  const s = text.replace(/,/g, '').replace(/\s*views?/i, '').trim()
  const m = s.match(/^([\d.]+)\s*([KMB]?)$/i)
  if (!m) return 0
  const n = parseFloat(m[1])
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()] ?? 1
  return Math.round(n * mult)
}

// Extract all videoRenderer items from Innertube search response
function extractSearchVideos(data) {
  const videos = []
  const sections =
    data?.contents?.twoColumnSearchResultsRenderer
      ?.primaryContents?.sectionListRenderer?.contents ?? []

  for (const section of sections) {
    const items = section?.itemSectionRenderer?.contents ?? []
    for (const item of items) {
      const v = item?.videoRenderer
      if (!v?.videoId) continue
      const title = v.title?.runs?.map(r => r.text).join('') ?? ''
      const vcRaw = v.viewCountText?.simpleText ?? v.viewCountText?.runs?.[0]?.text ?? '0'
      videos.push({ videoId: v.videoId, title, views: parseViews(vcRaw) })
    }
  }
  return videos
}

// Extract channel metadata from Innertube browse response
function extractChannel(data) {
  const header = data?.header?.c4TabbedHeaderRenderer
  if (!header) return null

  const subText =
    header.subscriberCountText?.simpleText ??
    header.subscriberCountText?.runs?.[0]?.text ?? '0'
  const thumbnail =
    header.avatar?.thumbnails?.slice(-1)[0]?.url ??
    header.banner?.thumbnails?.[0]?.url ?? ''

  return {
    name:        header.title ?? '',
    handle:      header.channelHandleText?.runs?.[0]?.text ?? header.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ?? '',
    subscribers: parseViews(subText),
    thumbnail,
  }
}

// ─── Public helpers ────────────────────────────────────────────────────────────

/**
 * Search YouTube without API quota.
 * Returns array of { videoId, title, views }.
 */
async function search(query) {
  const data = await post('search', { query })
  return extractSearchVideos(data)
}

/**
 * Fetch public channel info (name, handle, subscribers, thumbnail)
 * without API quota.
 */
async function channelInfo(channelId) {
  const data = await post('browse', { browseId: channelId })
  return extractChannel(data)
}

/**
 * Fetch last 15 videos from YouTube RSS feed — zero quota, no API key.
 * Returns array compatible with videos route format.
 */
async function channelFeed(channelId) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!res.ok) throw new Error(`RSS feed ${res.status}`)
  const xml = await res.text()

  function tag(entry, name) {
    const m = entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`))
    return m ? m[1].trim() : ''
  }
  function attr(entry, name, attrName) {
    const m = entry.match(new RegExp(`<${name}[^>]*${attrName}="([^"]*)"[^>]*>`))
    return m ? m[1] : ''
  }
  function decHtml(s) {
    return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#(\d+);/g,(_,c)=>String.fromCharCode(c))
  }

  const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) ?? []
  return entries.map(e => {
    const videoId = tag(e, 'yt:videoId')
    const views   = parseInt(attr(e, 'yt:statistics', 'views') || '0')
    const thumb   = attr(e, 'media:thumbnail', 'url') || attr(e, 'media:content', 'url')
    return {
      id:          videoId,
      title:       decHtml(tag(e, 'title')),
      thumbnail:   thumb,
      publishedAt: tag(e, 'published').split('T')[0],
      views,
      likes: 0, comments: 0, watchTime: 0,
      ctr: 0, avgDuration: '', revenue: 0, status: 'published',
    }
  }).filter(v => v.id)
}

module.exports = { search, channelInfo, channelFeed }

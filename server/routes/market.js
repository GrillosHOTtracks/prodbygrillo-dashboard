require('dotenv').config()
const express = require('express')
const fs      = require('fs')
const path    = require('path')
const os      = require('os')
const Groq    = require('groq-sdk')

const router     = express.Router()
const CACHE_FILE = path.join(os.tmpdir(), 'market_cache.json')
const TTL        = 24 * 60 * 60 * 1000

let _cache   = null
let _cacheTs = 0

function loadDisk() {
  try { if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) } catch {}
  return null
}
function saveDisk(data) { try { fs.writeFileSync(CACHE_FILE, JSON.stringify(data)) } catch {} }

// ─── Source 1: YouTube Music Trending via Innertube ───────────────────────────

const YT_HEADERS = {
  'Content-Type':   'application/json',
  'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Origin':         'https://www.youtube.com',
  'Referer':        'https://www.youtube.com/',
  'Accept-Language':'en-US,en;q=0.9',
}

async function fetchYouTubeTrending(gl) {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/browse', {
      method: 'POST',
      headers: YT_HEADERS,
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: gl === 'BR' ? 'pt' : 'en', gl } },
        browseId: 'FEtrending',
        params: '4gINGgt5dGRfbXVzaWM%3D',
      }),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return []
    const data = await res.json()
    return walkForVideos(data?.contents, gl)
  } catch (e) { console.warn(`[market] YT ${gl}:`, e.message); return [] }
}

function walkForVideos(node, geo, depth = 0, acc = []) {
  if (!node || typeof node !== 'object' || depth > 12) return acc
  if (node.videoRenderer?.videoId) {
    const v = node.videoRenderer
    const title   = v.title?.runs?.map(r => r.text).join('') || ''
    const channel = v.longBylineText?.runs?.[0]?.text || v.ownerText?.runs?.[0]?.text || ''
    if (title) acc.push({ title, channel, geo })
    return acc
  }
  const SKIP = new Set(['context', 'trackingParams', 'accessibility', 'thumbnail', 'avatar'])
  if (Array.isArray(node)) {
    for (const el of node) walkForVideos(el, geo, depth + 1, acc)
  } else {
    for (const [k, v] of Object.entries(node)) {
      if (!SKIP.has(k)) walkForVideos(v, geo, depth + 1, acc)
    }
  }
  return acc
}

const VIBE_WORDS = ['drill', 'trap', 'afro', 'phonk', 'melodic', 'sad', 'dark', 'hard', 'chill', 'rage', 'jersey', 'rnb', 'r&b', 'dancehall', 'amapiano', 'boom bap', 'freestyle', 'emotional', 'wavy']
const BR_GENRE   = ['funk', 'samba', 'pagode', 'baile', 'piseiro', 'forró', 'brega', 'axé', 'sertanejo', 'arrocha']

function analyzeItems(items) {
  const artists = {}, vibes = {}, genres = {}
  for (const item of items) {
    const t = (item.title + ' ' + item.channel).toLowerCase()
    for (const v of VIBE_WORDS) { if (t.includes(v)) vibes[v] = (vibes[v] || 0) + 1 }
    for (const g of BR_GENRE)   { if (t.includes(g)) genres[g] = (genres[g] || 0) + 1 }
    if (item.channel) {
      const key = item.channel.toLowerCase()
      if (!artists[key]) artists[key] = { name: item.channel, count: 0 }
      artists[key].count++
    }
  }
  return {
    total:      items.length,
    topVibes:   Object.entries(vibes).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([v]) => v),
    topArtists: Object.values(artists).sort((a, b) => b.count - a.count).slice(0, 10).map(a => a.name),
    topGenres:  Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g]) => g),
    sample:     items.slice(0, 8).map(i => ({ title: i.title, channel: i.channel })),
  }
}

// ─── Source 2: BeatStars public profile ──────────────────────────────────────

async function fetchBeatStars() {
  // Try 1: public profile HTML (__NEXT_DATA__)
  try {
    const res = await fetch('https://www.beatstars.com/prodbygrillo', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      signal: AbortSignal.timeout(12000),
    })
    if (res.ok) {
      const html = await res.text()
      const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
      if (nd) {
        const d = JSON.parse(nd[1])
        const result = parseBeatStarsNextData(d)
        if (result) return result
      }
    }
  } catch {}

  // Try 2: internal REST API
  try {
    const res = await fetch('https://www.beatstars.com/api/tracks?filters[username]=prodbygrillo&page=1&limit=30', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      const json = await res.json()
      const tracks = json?.data || json?.tracks || json?.results || []
      if (tracks.length) return normalizeBeatStarsTracks(tracks)
    }
  } catch {}

  return null
}

function parseBeatStarsNextData(d) {
  const p = d?.props?.pageProps
  const tracks =
    p?.tracks || p?.initialData?.tracks || p?.profile?.tracks ||
    p?.data?.tracks || p?.data?.items ||
    Object.values(d?.props?.pageProps || {}).find(v => Array.isArray(v) && v[0]?.title)
  if (!Array.isArray(tracks) || !tracks.length) return null
  return normalizeBeatStarsTracks(tracks)
}

function normalizeBeatStarsTracks(raw) {
  const tracks = raw.map(t => ({
    title: t.title || t.name || t.track_name || '?',
    plays: t.plays || t.play_count || t.streams || t.listens || 0,
    likes: t.likes || t.like_count || t.favorites || t.favs || 0,
    sales: t.sales || t.leases || t.orders || 0,
  }))
  const topPlayed = [...tracks].sort((a, b) => b.plays - a.plays).slice(0, 5)
  const topLiked  = [...tracks].sort((a, b) => b.likes - a.likes).slice(0, 5)
  const topSold   = tracks.filter(t => t.sales > 0).sort((a, b) => b.sales - a.sales).slice(0, 5)
  return {
    topPlayed,
    topLiked,
    topSold:    topSold.length ? topSold : null,
    totalTracks: tracks.length,
    totalPlays:  tracks.reduce((s, t) => s + t.plays, 0),
    totalLikes:  tracks.reduce((s, t) => s + t.likes, 0),
  }
}

// ─── Source 3: LAIS market analysis via Groq ─────────────────────────────────

async function analyzWithLAIS(ytBR, ytUS, beatstars) {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) return null

  const ytLine = [
    ytBR.total ? `YT Brasil (${ytBR.total} vídeos): artistas=${ytBR.topArtists.slice(0,5).join(', ')} | vibes=${ytBR.topVibes.slice(0,4).join(', ')}${ytBR.topGenres.length ? ' | géneros locais=' + ytBR.topGenres.join(', ') : ''}` : null,
    ytUS.total ? `YT US (${ytUS.total} vídeos): artistas=${ytUS.topArtists.slice(0,5).join(', ')} | vibes=${ytUS.topVibes.slice(0,4).join(', ')}` : null,
  ].filter(Boolean).join('\n')

  const bsLine = beatstars ? [
    `BeatStars prodbygrillo: ${beatstars.totalTracks} beats | ${(beatstars.totalPlays||0).toLocaleString()} plays totais`,
    `Mais ouvidos: ${beatstars.topPlayed.slice(0,3).map(t => `"${t.title}" ${t.plays}p`).join(' · ')}`,
    beatstars.topSold?.length ? `Mais vendidos: ${beatstars.topSold.slice(0,3).map(t => `"${t.title}" ${t.sales}v`).join(' · ')}` : '',
  ].filter(Boolean).join('\n') : 'Dados BeatStars indisponíveis.'

  const prompt = `És LAIS, analista de mercado do produtor prodbygrillo. Analisa os dados e responde em JSON válido com exactamente estes 3 campos:

MERCADO HOJE:
${ytLine}

CATÁLOGO:
${bsLine}

Responde APENAS com JSON:
{
  "pulseMercado": "o que o mercado pede esta semana (2 frases directas, com géneros/artistas específicos)",
  "melhorMatch": "beat do catálogo mais alinhado com o trending e porquê (2 frases — usa os nomes reais dos beats se disponível)",
  "proximoBeat": "próximo beat recomendado: artista concreto + vibe + 3 elementos de produção (3 frases)"
}`

  try {
    const groq = new Groq({ apiKey })
    const res = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      max_tokens: 450,
      temperature: 0.4,
    })
    const text = res.choices[0]?.message?.content || ''
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    return JSON.parse(m[0])
  } catch (e) { console.warn('[market] LAIS:', e.message); return null }
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  if (!req.query.bust && _cache && Date.now() - _cacheTs < TTL) return res.json(_cache)

  try {
    const [ytBRItems, ytUSItems, beatstars] = await Promise.all([
      fetchYouTubeTrending('BR'),
      fetchYouTubeTrending('US'),
      fetchBeatStars(),
    ])

    const ytBR = analyzeItems(ytBRItems)
    const ytUS = analyzeItems(ytUSItems)
    const lais = await analyzWithLAIS(ytBR, ytUS, beatstars)

    const result = { updatedAt: new Date().toISOString(), ytBR, ytUS, beatstars, lais }
    _cache = result; _cacheTs = Date.now()
    saveDisk(result)
    res.json(result)
  } catch (err) {
    const cached = _cache || loadDisk()
    if (cached) { _cache = cached; _cacheTs = Date.now(); return res.json(cached) }
    console.error('[market]', err.message)
    res.status(500).json({ error: 'Market unavailable', details: err.message })
  }
})

module.exports = router

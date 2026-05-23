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

// ─── Source 1: YouTube Music Trending via Innertube search ───────────────────
// FEtrending browse returns 400 — use targeted music searches instead (same
// approach as /api/trending which already works reliably).

const YT_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Origin':       'https://www.youtube.com',
  'Referer':      'https://www.youtube.com/',
}

async function searchYT(query, gl) {
  try {
    const hl = gl === 'BR' ? 'pt' : 'en'
    const res = await fetch('https://www.youtube.com/youtubei/v1/search', {
      method: 'POST',
      headers: YT_HEADERS,
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20240501.00.00', hl, gl } },
        query,
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return []
    const data = await res.json()
    const sections = data?.contents?.twoColumnSearchResultsRenderer
      ?.primaryContents?.sectionListRenderer?.contents ?? []
    const items = []
    for (const sec of sections) {
      for (const item of (sec?.itemSectionRenderer?.contents ?? [])) {
        const v = item?.videoRenderer
        if (!v?.videoId) continue
        const title   = v.title?.runs?.map(r => r.text).join('') || ''
        const channel = v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || ''
        if (title) items.push({ title, channel, geo: gl })
      }
    }
    return items
  } catch (e) { console.warn(`[market] searchYT ${gl} "${query}":`, e.message); return [] }
}

const BR_QUERIES = [
  'musica mais tocada brasil 2025',
  'funk trending brasil 2025',
  'sertanejo hit 2025',
  'pagode trending 2025',
  'top hits brasil',
]
const US_QUERIES = [
  'trending music us 2025',
  'top rap songs 2025',
  'r&b trending 2025',
  'pop hits us 2025',
  'drill music trending 2025',
]

async function fetchYouTubeTrending(gl) {
  const queries = gl === 'BR' ? BR_QUERIES : US_QUERIES
  // Run searches in parallel (no rate limiting needed for searches)
  const results = await Promise.all(queries.map(q => searchYT(q, gl)))
  // Dedupe by title
  const seen = new Set()
  const all  = []
  for (const batch of results) {
    for (const item of batch) {
      const key = item.title.toLowerCase().slice(0, 60)
      if (!seen.has(key)) { seen.add(key); all.push(item) }
    }
  }
  return all
}

const VIBE_WORDS = ['drill', 'trap', 'afro', 'phonk', 'melodic', 'sad', 'dark', 'hard', 'chill', 'rage', 'jersey', 'rnb', 'r&b', 'dancehall', 'amapiano', 'boom bap', 'freestyle', 'emotional', 'wavy', 'romantic', 'gangsta', 'banger']
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

// ─── Source 2: Catálogo prodbygrillo — upload history proxy ──────────────────
// BeatStars uses JS rendering that blocks server-side scraping.
// Use the Scheduler upload history + channel videos as a reliable proxy.

const UPLOADS_FILE = path.join(__dirname, '../data/uploads.json')

function readUploads() {
  try { return JSON.parse(fs.readFileSync(UPLOADS_FILE, 'utf-8')) } catch { return [] }
}

function buildCatalog() {
  const uploads = readUploads()
  if (!uploads.length) return null

  // Normalize entries
  const tracks = uploads.map(u => ({
    title:       u.title || '?',
    publishedAt: u.publishedAt || u.uploadedAt || null,
    views:       u.views || 0,
    status:      u.status || 'live',
  }))

  // Sort by date descending
  const byDate = [...tracks].sort((a, b) => {
    const da = a.publishedAt ? new Date(a.publishedAt) : 0
    const db = b.publishedAt ? new Date(b.publishedAt) : 0
    return db - da
  })

  // Sort by views descending
  const byViews = [...tracks].sort((a, b) => b.views - a.views)

  const totalViews = tracks.reduce((s, t) => s + t.views, 0)

  return {
    totalTracks: tracks.length,
    totalPlays:  totalViews,
    totalLikes:  0,
    topPlayed:   byViews.slice(0, 5).map(t => ({ title: t.title, plays: t.views, likes: 0, sales: 0 })),
    topLiked:    byViews.slice(0, 5).map(t => ({ title: t.title, plays: t.views, likes: 0, sales: 0 })),
    topSold:     null,
    // Extra: most recent uploads (for LAIS context)
    recent:      byDate.slice(0, 5).map(t => t.title),
  }
}

// ─── Source 3: LAIS market analysis via Groq ─────────────────────────────────
// Only runs when there is real YouTube trending data. Never invents catalog.

async function analyzeWithLAIS(ytBR, ytUS, catalog) {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) return null

  // Guard: need at least one region with real data
  if (!ytBR.total && !ytUS.total) {
    return {
      pulseMercado: 'Aguardando dados de mercado. Nenhum vídeo encontrado no trending.',
      melhorMatch:  '—',
      proximoBeat:  '—',
    }
  }

  const ytLine = [
    ytBR.total ? `YT Brasil (${ytBR.total} vídeos): artistas=${ytBR.topArtists.slice(0,5).join(', ')} | vibes=${ytBR.topVibes.slice(0,4).join(', ')}${ytBR.topGenres.length ? ' | géneros=' + ytBR.topGenres.join(', ') : ''}` : null,
    ytUS.total ? `YT US (${ytUS.total} vídeos): artistas=${ytUS.topArtists.slice(0,5).join(', ')} | vibes=${ytUS.topVibes.slice(0,4).join(', ')}` : null,
  ].filter(Boolean).join('\n')

  const catLine = catalog
    ? [
        `Catálogo prodbygrillo: ${catalog.totalTracks} uploads | ${catalog.totalPlays.toLocaleString()} views totais`,
        catalog.recent?.length ? `Mais recentes: ${catalog.recent.slice(0,3).map(t => `"${t}"`).join(' · ')}` : '',
        catalog.topPlayed?.[0]?.plays ? `Mais vistos: ${catalog.topPlayed.slice(0,3).map(t => `"${t.title}" ${t.plays}v`).join(' · ')}` : '',
      ].filter(Boolean).join('\n')
    : 'Nenhum upload no historial do Scheduler ainda.'

  const prompt = `És LAIS, analista de mercado do produtor prodbygrillo. Usa APENAS os dados abaixo — nunca inventes artistas, beats ou tendências que não estejam aqui.

MERCADO (dados reais YouTube):
${ytLine}

CATÁLOGO (historial de uploads):
${catLine}

Responde APENAS com JSON válido, sem texto extra:
{
  "pulseMercado": "o que o mercado pede esta semana com base nos dados acima (2 frases directas, cita artistas/géneros dos dados)",
  "melhorMatch": "beat do catálogo mais alinhado com o trending e porquê (2 frases — usa nomes reais dos uploads se existirem, senão diz que o catálogo está vazio)",
  "proximoBeat": "próximo beat recomendado baseado nos dados: artista real do trending + vibe + 3 elementos de produção (3 frases)"
}`

  try {
    const groq = new Groq({ apiKey })
    const res = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      max_tokens: 500,
      temperature: 0.3,
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
    const [[ytBRItems, ytUSItems], catalog] = await Promise.all([
      Promise.all([fetchYouTubeTrending('BR'), fetchYouTubeTrending('US')]),
      Promise.resolve(buildCatalog()),
    ])

    const ytBR = analyzeItems(ytBRItems)
    const ytUS = analyzeItems(ytUSItems)

    // BeatStars shape for frontend compatibility (null = show "JS rendering" notice)
    // If we have catalog data, map it to the BeatStars card format
    const beatstars = catalog
      ? {
          topPlayed:   catalog.topPlayed,
          topLiked:    catalog.topLiked,
          topSold:     catalog.topSold,
          totalTracks: catalog.totalTracks,
          totalPlays:  catalog.totalPlays,
          totalLikes:  catalog.totalLikes,
        }
      : null

    const lais = await analyzeWithLAIS(ytBR, ytUS, catalog)

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

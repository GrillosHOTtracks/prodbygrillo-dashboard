require('dotenv').config()
const express = require('express')
const fs      = require('fs')
const path    = require('path')
const os      = require('os')
const Groq    = require('groq-sdk')

const router     = express.Router()
const CACHE_FILE = path.join(os.tmpdir(), 'market_cache.json')
const TTL        = 24 * 60 * 60 * 1000

let _cache = null, _cacheTs = 0

function loadDisk() {
  try { if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) } catch {}
  return null
}
function saveDisk(data) { try { fs.writeFileSync(CACHE_FILE, JSON.stringify(data)) } catch {} }

// ─── Dynamic date — nunca hardcoded ──────────────────────────────────────────

function getDate() {
  const now = new Date()
  return {
    year:    now.getFullYear(),
    monthEn: now.toLocaleString('en-US', { month: 'long' }).toLowerCase(),
    monthPt: now.toLocaleString('pt-BR', { month: 'long' }).toLowerCase(),
    monthFr: now.toLocaleString('fr-FR', { month: 'long' }).toLowerCase(),
  }
}

// ─── Nichos ───────────────────────────────────────────────────────────────────

const NICHES = [
  { id: 'trap',         label: 'Trap',          keyword: 'trap beat' },
  { id: 'rnb',          label: 'R&B',           keyword: 'rnb beat' },
  { id: 'rap',          label: 'Rap / Hip-Hop', keyword: 'hip hop beat' },
  { id: 'underground',  label: 'Underground',   keyword: 'cloud rap' },
  { id: 'regional',     label: 'Regional',      keyword: 'afrobeats' },
  { id: 'instrumental', label: 'Instrumentais', keyword: 'free type beat' },
]

function guessNiche(kw) {
  const k = kw.toLowerCase()
  if (/trap|drill|pluggnb|rage|dark trap|melodic trap/.test(k)) return 'trap'
  if (/rnb|r&b|neo soul|bedroom pop|sad rnb/.test(k))           return 'rnb'
  if (/rap|hip hop|boom bap|phonk|hyperpop|mumble/.test(k))     return 'rap'
  if (/cloud|lo.?fi|underground|witch/.test(k))                  return 'underground'
  if (/afro|latin|jersey|miami|naija|grime/.test(k))             return 'regional'
  if (/type beat|free beat|instrumental|prod by|beat tape/.test(k)) return 'instrumental'
  return 'trap'
}

// ─── Mercados ─────────────────────────────────────────────────────────────────

const MARKETS = [
  { gl: 'US', hl: 'en', label: 'US',      flag: '🇺🇸', local: [] },
  { gl: 'GB', hl: 'en', label: 'UK',      flag: '🇬🇧', local: ['uk drill beat', 'uk rap beat', 'grime beat'] },
  { gl: 'BR', hl: 'pt', label: 'Brasil',  flag: '🇧🇷', local: ['trap brasileiro', 'funk beat brasil', 'phonk brasil'] },
  { gl: 'FR', hl: 'fr', label: 'França',  flag: '🇫🇷', local: ['drill français', 'rap français trap', 'trap beat fr'] },
  { gl: 'NG', hl: 'en', label: 'Nigéria', flag: '🇳🇬', local: ['afrobeats beat', 'afrotrap beat', 'naija trap'] },
  { gl: 'CA', hl: 'en', label: 'Canadá',  flag: '🇨🇦', local: ['toronto drill beat', 'canadian trap', 'pluggnb beat'] },
  // JP e HK: sem keyword genérico em inglês — apenas queries locais
  { gl: 'JP', hl: 'ja', label: 'Japão',   flag: '🇯🇵', local: ['japanese trap beat', 'j-rap beat', 'japanese rnb beat', 'city pop trap'] },
  { gl: 'HK', hl: 'zh', label: 'China',   flag: '🇨🇳', local: ['chinese trap beat', 'mandarin rap beat', 'c-pop trap'] },
]

const MARKET_MAP = Object.fromEntries(MARKETS.map(m => [m.gl, m]))

// ─── Filtro de lixo — playlists, compilações, gravadoras ─────────────────────

function isJunk({ title = '', channel = '' }) {
  if (!title || !channel) return true
  const t = title.toLowerCase()
  const c = channel.toLowerCase()
  if (/\bplaylist\b/.test(t))      return true
  if (/\bcompilation\b/.test(t))   return true
  if (/\b\d+\s*hours?\b/.test(t))  return true   // "1 hour mix"
  if (/\btop\s*\d+\b/.test(t) && !/type[\s-]?beat/.test(t)) return true
  if (/\bbest of\b/.test(t))       return true
  if (/\bgreatest hits\b/.test(t)) return true
  if (/\baward/i.test(t))          return true
  if (/vevo$/.test(c))             return true
  if (/^youtube music$/i.test(c))  return true
  return false
}

// ─── Innertube search ─────────────────────────────────────────────────────────

function parseViews(text) {
  if (!text) return 0
  const s = text.replace(/,/g, '').replace(/\s*views?/i, '').trim()
  const m = s.match(/^([\d.]+)\s*([KMBkmb]?)$/)
  if (!m) return 0
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] ?? 1
  return Math.round(parseFloat(m[1]) * mult)
}

const YT_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Origin': 'https://www.youtube.com',
  'Referer': 'https://www.youtube.com/',
}

async function searchYT(query, gl, hl = 'en') {
  try {
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
        const vcRaw   = v.viewCountText?.simpleText ?? v.viewCountText?.runs?.[0]?.text ?? ''
        const obj = { title, channel, views: parseViews(vcRaw), videoId: v.videoId }
        if (!isJunk(obj)) items.push(obj)
      }
    }
    return items
  } catch { return [] }
}

// ─── Extrai artista de "X Type Beat" ─────────────────────────────────────────

function extractTypeBeatArtist(title) {
  const m = title.match(/^(.+?)\s+(?:free\s+)?type[\s-]?beat\b/i)
  if (!m) return null
  let artist = m[1]
    .replace(/^\[?free\]?\s*/i, '')
    .replace(/^\[.*?\]\s*/, '')
    .replace(/^\(.*?\)\s*/, '')
    .replace(/[-|–—:]\s*$/, '')
    .trim()
  if (!artist || artist.length < 2 || artist.length > 40) return null
  if (/^(trap|drill|rnb|r&b|free|dark|melodic|hard|sad|chill|phonk|rap|hip\s*hop|free\s*beat|beat|instrumental|type|new|latest|hot|official)$/i.test(artist)) return null
  if (/^\d/.test(artist)) return null
  return artist
}

// ─── Monta todas as tarefas de busca ─────────────────────────────────────────

function buildTasks() {
  const { year, monthEn, monthPt, monthFr } = getDate()

  const tasks = []

  // 1) Matriz nicho × mercado (excluindo JP/HK das queries genéricas em inglês)
  for (const niche of NICHES) {
    for (const market of MARKETS) {
      if ((market.gl === 'JP' || market.gl === 'HK') && market.local.length) continue
      tasks.push({
        kind: 'niche', nicheId: niche.id, gl: market.gl, hl: market.hl,
        q: `${niche.keyword} ${year}`,
      })
    }
  }

  // 2) Queries locais de cada mercado (regional + JP + HK)
  for (const market of MARKETS) {
    for (const kw of market.local) {
      const month = market.gl === 'BR' ? monthPt : market.gl === 'FR' ? monthFr : monthEn
      tasks.push({
        kind: 'niche', nicheId: guessNiche(kw), gl: market.gl, hl: market.hl,
        q: `${kw} ${year}`,
      })
    }
  }

  // 3) Type beats — US, UK, CA — com mês e ano dinâmicos
  for (const gl of ['US', 'GB', 'CA']) {
    tasks.push({ kind: 'typebeat', gl, hl: 'en', q: `free type beat ${monthEn} ${year}` })
    tasks.push({ kind: 'typebeat', gl, hl: 'en', q: `type beat ${year}` })
    tasks.push({ kind: 'typebeat', gl, hl: 'en', q: `new type beat ${year}` })
  }

  return tasks
}

// ─── Agrega resultados ────────────────────────────────────────────────────────

function aggregateResults(results) {
  const nicheAcc = Object.fromEntries(
    NICHES.map(n => [n.id, { id: n.id, label: n.label, total: 0, byMarket: {}, artists: new Set(), sampleRaw: [] }])
  )
  const marketAcc = Object.fromEntries(
    MARKETS.map(m => [m.gl, { gl: m.gl, label: m.label, flag: m.flag, total: 0, byNiche: {}, artists: new Set() }])
  )
  const typeBeatCount = new Map()

  for (const { kind, nicheId, gl, items } of results) {
    if (kind === 'niche') {
      const nacc = nicheAcc[nicheId]
      const macc = marketAcc[gl]
      if (!nacc || !macc) continue
      nacc.total += items.length
      nacc.byMarket[gl] = (nacc.byMarket[gl] || 0) + items.length
      const mkt = MARKET_MAP[gl] || MARKETS[0]
      for (const { title, channel, views, videoId } of items) {
        if (channel) nacc.artists.add(channel)
        nacc.sampleRaw.push({ title, channel, views, videoId, flag: mkt.flag, market: mkt.label })
        macc.total++
        macc.byNiche[nicheId] = (macc.byNiche[nicheId] || 0) + 1
        if (channel) macc.artists.add(channel)
      }
    }
    if (kind === 'typebeat') {
      for (const { title } of items) {
        const a = extractTypeBeatArtist(title)
        if (a) typeBeatCount.set(a, (typeBeatCount.get(a) || 0) + 1)
      }
    }
  }

  // Nichos — ordenados por total desc
  const niches = NICHES.map(n => {
    const acc  = nicheAcc[n.id]
    const hotEntry = Object.entries(acc.byMarket).sort((a, b) => b[1] - a[1])[0]
    const hotInfo  = MARKET_MAP[hotEntry?.[0]] || MARKETS[0]
    // Dedupe sample by title, sort by views desc, cap at 30
    const seen = new Set()
    const sample = acc.sampleRaw
      .filter(v => { if (seen.has(v.title)) return false; seen.add(v.title); return true })
      .sort((a, b) => b.views - a.views)
      .slice(0, 30)
    return {
      id: n.id, label: n.label,
      total: acc.total,
      hotMarket: { gl: hotEntry?.[0] || 'US', flag: hotInfo.flag, label: hotInfo.label, count: hotEntry?.[1] || 0 },
      topArtists: [...acc.artists].slice(0, 8),
      sample,
    }
  }).sort((a, b) => b.total - a.total)

  // Mercados — ordenados por total desc
  const markets = MARKETS.map(m => {
    const acc           = marketAcc[m.gl]
    const topNicheEntry = Object.entries(acc.byNiche).sort((a, b) => b[1] - a[1])[0]
    const topNicheLabel = NICHES.find(n => n.id === topNicheEntry?.[0])?.label || '—'
    return {
      gl: m.gl, label: m.label, flag: m.flag,
      total: acc.total,
      topNiche: topNicheLabel,
      topArtists: [...acc.artists].slice(0, 6),
    }
  }).sort((a, b) => b.total - a.total)

  // Artistas de referência para type beats
  const referenceArtists = [...typeBeatCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([artist]) => artist)

  return {
    niches,
    markets,
    typeBeat:      { total: [...typeBeatCount.values()].reduce((s, c) => s + c, 0), referenceArtists },
    hottestNiche:  niches[0]?.id || 'trap',
    hottestMarket: markets[0]
      ? { gl: markets[0].gl, flag: markets[0].flag, label: markets[0].label }
      : { gl: 'US', flag: '🇺🇸', label: 'US' },
  }
}

// ─── Catálogo — proxy de uploads do Scheduler ─────────────────────────────────

const UPLOADS_FILE = path.join(__dirname, '../data/uploads.json')

function buildCatalog() {
  const uploads = (() => { try { return JSON.parse(fs.readFileSync(UPLOADS_FILE, 'utf-8')) } catch { return [] } })()
  if (!uploads.length) return null

  const tracks = uploads.map(u => ({
    title:       u.title || '?',
    publishedAt: u.publishedAt || u.uploadedAt || null,
    views:       u.views || 0,
  }))

  const byDate  = [...tracks].sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
  const byViews = [...tracks].sort((a, b) => b.views - a.views)

  return {
    totalTracks: tracks.length,
    totalPlays:  tracks.reduce((s, t) => s + t.views, 0),
    totalLikes:  0,
    topPlayed:   byViews.slice(0, 5).map(t => ({ title: t.title, plays: t.views, likes: 0, sales: 0 })),
    topLiked:    byViews.slice(0, 5).map(t => ({ title: t.title, plays: t.views, likes: 0, sales: 0 })),
    topSold:     null,
    recent:      byDate.slice(0, 5).map(t => t.title),
  }
}

// ─── LAIS — só responde com dados reais ──────────────────────────────────────

console.log(`[market] GROQ_API_KEY: ${process.env.GROQ_API_KEY ? '✓ configurada' : '✗ NÃO CONFIGURADA — LAIS desactivada'}`)

async function analyzeWithLAIS(trending) {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) return null

  const hasData = trending.niches.some(n => n.total > 0)
  if (!hasData) return {
    pulseMercado: 'Aguardando dados de mercado. Nenhum vídeo encontrado nas pesquisas.',
    proximoBeat:  '—',
    tendencia:    '—',
  }

  const topNiches = trending.niches.slice(0, 4)
    .map(n => `${n.label} (${n.total} vídeos, ${n.hotMarket.flag} ${n.hotMarket.label})`)
    .join(' | ')

  const topMarkets = trending.markets.slice(0, 4)
    .map(m => `${m.flag} ${m.label} (${m.total} vídeos, top: ${m.topNiche})`)
    .join(' | ')

  const typeBeatLine = trending.typeBeat.referenceArtists.length
    ? `Type beats mais buscados: ${trending.typeBeat.referenceArtists.slice(0, 8).join(', ')}`
    : ''

  const prompt = `És LAIS, analista de mercado para produtores de beats. Usa APENAS os dados abaixo — nunca inventes artistas, géneros ou tendências.

MERCADO GLOBAL (YouTube, ${new Date().toLocaleDateString('pt-BR')}):
Nichos: ${topNiches}
Mercados: ${topMarkets}
${typeBeatLine}

Responde APENAS com JSON válido, sem texto extra:
{
  "pulseMercado": "2 frases sobre o que o mercado pede com base nos nichos/mercados — cita dados reais",
  "proximoBeat": "3 frases: artista real dos type beats + nicho dominante + 3 elementos de produção específicos",
  "tendencia": "1 frase sobre o mercado que está a crescer mais e porquê"
}`

  try {
    const groq = new Groq({ apiKey })
    const resp = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      max_tokens: 500,
      temperature: 0.3,
    })
    const text = resp.choices[0]?.message?.content || ''
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    return JSON.parse(m[0])
  } catch (e) { console.warn('[market] LAIS:', e.message); return null }
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  if (!req.query.bust && _cache && Date.now() - _cacheTs < TTL) return res.json(_cache)

  try {
    const tasks   = buildTasks()
    console.log(`[market] ${tasks.length} buscas em paralelo`)

    const rawResults = await Promise.all(
      tasks.map(async task => {
        const items = await searchYT(task.q, task.gl, task.hl)
        return { ...task, items }
      })
    )

    const trending = aggregateResults(rawResults)
    const lais = await analyzeWithLAIS(trending, null)

    const result = { updatedAt: new Date().toISOString(), ...trending, lais }
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

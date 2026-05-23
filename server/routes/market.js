require('dotenv').config()
const express = require('express')
const fs      = require('fs')
const path    = require('path')
const os      = require('os')

const router     = express.Router()
const CACHE_FILE = path.join(os.tmpdir(), 'market_cache.json')
const TTL        = 24 * 60 * 60 * 1000

let _cache = null, _cacheTs = 0

function loadDisk() {
  try { if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) } catch {}
  return null
}
function saveDisk(data) { try { fs.writeFileSync(CACHE_FILE, JSON.stringify(data)) } catch {} }

// ─── Dynamic date ─────────────────────────────────────────────────────────────

function getDate() {
  const now = new Date()
  return {
    year:    now.getFullYear(),
    monthEn: now.toLocaleString('en-US', { month: 'long' }).toLowerCase(),
    monthPt: now.toLocaleString('pt-BR', { month: 'long' }).toLowerCase(),
    monthFr: now.toLocaleString('fr-FR', { month: 'long' }).toLowerCase(),
    monthEs: now.toLocaleString('es-ES', { month: 'long' }).toLowerCase(),
    monthDe: now.toLocaleString('de-DE', { month: 'long' }).toLowerCase(),
  }
}

// ─── Nichos ───────────────────────────────────────────────────────────────────

const NICHES = [
  // Trap & subgêneros
  { id: 'trap',         label: 'Trap',          keyword: 'trap beat' },
  { id: 'drill',        label: 'Drill',         keyword: 'drill beat' },
  { id: 'uk_drill',     label: 'UK Drill',      keyword: 'uk drill beat' },
  { id: 'ny_drill',     label: 'NY Drill',      keyword: 'ny drill beat' },
  { id: 'pluggnb',      label: 'PluggnB',       keyword: 'pluggnb beat' },
  { id: 'melodic_trap', label: 'Melodic Trap',  keyword: 'melodic trap beat' },
  { id: 'rage',         label: 'Rage',          keyword: 'rage beat' },
  { id: 'dark_trap',    label: 'Dark Trap',     keyword: 'dark trap beat' },
  { id: 'sad_trap',     label: 'Sad Trap',      keyword: 'sad trap beat' },
  // RnB
  { id: 'rnb',          label: 'R&B',           keyword: 'rnb beat' },
  { id: 'alt_rnb',      label: 'Alt R&B',       keyword: 'alternative rnb beat' },
  { id: 'neo_soul',     label: 'Neo Soul',      keyword: 'neo soul beat' },
  { id: 'bedroom_pop',  label: 'Bedroom Pop',   keyword: 'bedroom pop beat' },
  // Rap
  { id: 'rap',          label: 'Hip-Hop',       keyword: 'hip hop beat' },
  { id: 'boom_bap',     label: 'Boom Bap',      keyword: 'boom bap beat' },
  { id: 'phonk',        label: 'Phonk',         keyword: 'phonk beat' },
  { id: 'hyperpop',     label: 'Hyperpop',      keyword: 'hyperpop beat' },
  // Afro
  { id: 'afrobeats',    label: 'Afrobeats',     keyword: 'afrobeats beat' },
  { id: 'afroswing',    label: 'Afroswing',     keyword: 'afroswing beat' },
  { id: 'afrotrap',     label: 'Afrotrap',      keyword: 'afrotrap beat' },
  { id: 'amapiano',     label: 'Amapiano',      keyword: 'amapiano beat' },
  // Latino
  { id: 'latin_trap',   label: 'Latin Trap',    keyword: 'latin trap beat' },
  { id: 'reggaeton',    label: 'Reggaeton',     keyword: 'reggaeton beat' },
  { id: 'corridos',     label: 'Corridos',      keyword: 'corridos tumbados beat' },
  // Underground
  { id: 'cloud_rap',    label: 'Cloud Rap',     keyword: 'cloud rap beat' },
  { id: 'lofi',         label: 'Lo-Fi',         keyword: 'lo-fi hip hop beat' },
  // Instrumentais
  { id: 'instrumental', label: 'Instrumentais', keyword: 'free type beat' },
]

function guessNiche(kw) {
  const k = kw.toLowerCase()
  if (/uk drill/.test(k))                                          return 'uk_drill'
  if (/ny drill|brooklyn drill/.test(k))                          return 'ny_drill'
  if (/chicago drill|detroit drill|chi drill/.test(k))            return 'drill'
  if (/drill/.test(k))                                            return 'drill'
  if (/pluggnb/.test(k))                                          return 'pluggnb'
  if (/melodic trap/.test(k))                                     return 'melodic_trap'
  if (/rage beat/.test(k))                                        return 'rage'
  if (/dark trap/.test(k))                                        return 'dark_trap'
  if (/sad trap/.test(k))                                         return 'sad_trap'
  if (/trap/.test(k))                                             return 'trap'
  if (/alt.*rnb|alternative.*rnb/.test(k))                       return 'alt_rnb'
  if (/neo soul/.test(k))                                         return 'neo_soul'
  if (/bedroom pop/.test(k))                                      return 'bedroom_pop'
  if (/rnb|r&b/.test(k))                                         return 'rnb'
  if (/boom bap/.test(k))                                         return 'boom_bap'
  if (/phonk/.test(k))                                            return 'phonk'
  if (/hyperpop/.test(k))                                         return 'hyperpop'
  if (/rap|hip hop|mumble/.test(k))                               return 'rap'
  if (/amapiano|gqom/.test(k))                                    return 'amapiano'
  if (/afroswing|afro swing/.test(k))                             return 'afroswing'
  if (/afrotrap|afro trap/.test(k))                               return 'afrotrap'
  if (/afrobeats|afropop|naija/.test(k))                          return 'afrobeats'
  if (/corridos/.test(k))                                         return 'corridos'
  if (/reggaeton/.test(k))                                        return 'reggaeton'
  if (/latin trap/.test(k))                                       return 'latin_trap'
  if (/cloud rap/.test(k))                                        return 'cloud_rap'
  if (/lo.?fi/.test(k))                                           return 'lofi'
  if (/type beat|free beat|instrumental|prod by|beat tape/.test(k)) return 'instrumental'
  return 'trap'
}

// ─── Mercados ─────────────────────────────────────────────────────────────────
// localOnly: true = sem queries genéricas, apenas local[]

const MARKETS = [
  // Americas
  { gl: 'US', hl: 'en', label: 'US',           flag: '🇺🇸', local: [], localOnly: false },
  { gl: 'CA', hl: 'en', label: 'Canadá',        flag: '🇨🇦', local: ['toronto drill beat', 'pluggnb beat canada', 'canadian trap beat'], localOnly: false },
  { gl: 'BR', hl: 'pt', label: 'Brasil',         flag: '🇧🇷', local: ['trap brasileiro', 'funk beat brasil', 'phonk brasil', 'drill br'], localOnly: false },
  { gl: 'MX', hl: 'es', label: 'México',         flag: '🇲🇽', local: ['corridos tumbados beat', 'trap mexicano beat', 'reggaeton beat mx'], localOnly: false },
  { gl: 'AR', hl: 'es', label: 'Argentina',      flag: '🇦🇷', local: ['trap argentino beat', 'reggaeton ar beat', 'latin trap ar'], localOnly: false },
  { gl: 'CO', hl: 'es', label: 'Colômbia',       flag: '🇨🇴', local: ['trap colombiano beat', 'reggaeton co beat', 'latin trap colombia'], localOnly: false },
  // Europa
  { gl: 'GB', hl: 'en', label: 'UK',             flag: '🇬🇧', local: ['uk drill beat', 'grime beat', 'afroswing beat uk'], localOnly: false },
  { gl: 'FR', hl: 'fr', label: 'França',          flag: '🇫🇷', local: ['drill français', 'trap français beat', 'rap fr trap'], localOnly: false },
  { gl: 'DE', hl: 'de', label: 'Alemanha',       flag: '🇩🇪', local: ['deutschrap trap beat', 'german drill beat', 'german trap beat'], localOnly: false },
  { gl: 'ES', hl: 'es', label: 'Espanha',        flag: '🇪🇸', local: ['trap español beat', 'reggaeton es beat', 'drill español'], localOnly: false },
  { gl: 'IT', hl: 'it', label: 'Itália',          flag: '🇮🇹', local: ['trap italiano beat', 'drill italiano beat'], localOnly: false },
  { gl: 'NL', hl: 'nl', label: 'Holanda',        flag: '🇳🇱', local: ['dutch trap beat', 'nederhop beat', 'dutch drill beat'], localOnly: false },
  { gl: 'SE', hl: 'sv', label: 'Suécia',          flag: '🇸🇪', local: ['swedish melodic trap beat', 'scandinavian trap beat'], localOnly: false },
  // África
  { gl: 'NG', hl: 'en', label: 'Nigéria',        flag: '🇳🇬', local: ['afrobeats beat nigeria', 'afrotrap beat naija', 'amapiano beat ng'], localOnly: false },
  { gl: 'GH', hl: 'en', label: 'Gana',           flag: '🇬🇭', local: ['ghana afrobeats beat', 'highlife trap beat gh'], localOnly: false },
  { gl: 'ZA', hl: 'en', label: 'África do Sul',  flag: '🇿🇦', local: ['amapiano beat south africa', 'gqom beat za', 'south africa drill beat'], localOnly: false },
  { gl: 'KE', hl: 'en', label: 'Kenya',          flag: '🇰🇪', local: ['kenyan trap beat', 'afropop beat kenya'], localOnly: false },
  // Ásia
  { gl: 'IN', hl: 'en', label: 'Índia',           flag: '🇮🇳', local: ['desi hip hop beat', 'bollywood trap beat', 'indian drill beat'], localOnly: false },
  { gl: 'PH', hl: 'en', label: 'Filipinas',      flag: '🇵🇭', local: ['opm trap beat', 'pinoy drill beat', 'filipino rap beat'], localOnly: false },
  { gl: 'JP', hl: 'ja', label: 'Japão',           flag: '🇯🇵', local: ['japanese trap beat', 'j-rap beat', 'city pop trap beat', 'japanese drill beat'], localOnly: true },
  { gl: 'KR', hl: 'ko', label: 'Coreia do Sul',  flag: '🇰🇷', local: ['korean trap beat', 'k-hip hop beat', 'krnb beat', 'korean drill beat'], localOnly: true },
  { gl: 'HK', hl: 'zh', label: 'China',          flag: '🇨🇳', local: ['chinese trap beat', 'mandarin rap beat', 'c-pop trap beat'], localOnly: true },
  // Oceania
  { gl: 'AU', hl: 'en', label: 'Austrália',      flag: '🇦🇺', local: ['australian drill beat', 'aussie trap beat', 'au rap beat'], localOnly: false },
]

const MARKET_MAP = Object.fromEntries(MARKETS.map(m => [m.gl, m]))

// ─── Filtro de lixo ───────────────────────────────────────────────────────────

function isJunk({ title = '', channel = '' }) {
  if (!title || !channel) return true
  const t = title.toLowerCase()
  const c = channel.toLowerCase()
  if (/\bplaylist\b/.test(t))      return true
  if (/\bcompilation\b/.test(t))   return true
  if (/\b\d+\s*hours?\b/.test(t))  return true
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

// ─── Concurrency pool ─────────────────────────────────────────────────────────

async function runPool(fns, limit) {
  const results = new Array(fns.length)
  let idx = 0
  async function worker() {
    while (idx < fns.length) {
      const i = idx++
      results[i] = await fns[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, fns.length) }, worker))
  return results
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

// ─── Monta todas as tarefas ───────────────────────────────────────────────────

function buildTasks() {
  const { year, monthEn, monthPt, monthFr, monthEs } = getDate()

  const tasks = []

  // 1) Matriz nicho × mercado (exclui localOnly)
  for (const niche of NICHES) {
    for (const market of MARKETS) {
      if (market.localOnly) continue
      tasks.push({
        kind: 'niche', nicheId: niche.id, gl: market.gl, hl: market.hl,
        q: `${niche.keyword} ${year}`,
      })
    }
  }

  // 2) Queries locais de cada mercado
  for (const market of MARKETS) {
    for (const kw of market.local) {
      const month = market.gl === 'BR' ? monthPt
        : market.gl === 'FR' ? monthFr
        : (market.gl === 'MX' || market.gl === 'AR' || market.gl === 'CO' || market.gl === 'ES') ? monthEs
        : monthEn
      tasks.push({
        kind: 'niche', nicheId: guessNiche(kw), gl: market.gl, hl: market.hl,
        q: `${kw} ${year}`,
      })
    }
  }

  // 3) Type beats — core anglophone markets
  for (const gl of ['US', 'GB', 'CA', 'AU', 'NG']) {
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

  // Nichos — dedupe, sort por views, cap 100, order por total desc
  const niches = NICHES.map(n => {
    const acc      = nicheAcc[n.id]
    const hotEntry = Object.entries(acc.byMarket).sort((a, b) => b[1] - a[1])[0]
    const hotInfo  = MARKET_MAP[hotEntry?.[0]] || MARKETS[0]
    const seen     = new Set()
    const sample   = acc.sampleRaw
      .filter(v => { if (seen.has(v.title)) return false; seen.add(v.title); return true })
      .sort((a, b) => b.views - a.views)
      .slice(0, 100)
    return {
      id: n.id, label: n.label,
      total: acc.total,
      hotMarket: { gl: hotEntry?.[0] || 'US', flag: hotInfo.flag, label: hotInfo.label, count: hotEntry?.[1] || 0 },
      topArtists: [...acc.artists].slice(0, 8),
      sample,
    }
  }).sort((a, b) => b.total - a.total)

  // Mercados — order por total desc
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

  const referenceArtists = [...typeBeatCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
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

// ─── Route ────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  if (!req.query.bust && _cache && Date.now() - _cacheTs < TTL) return res.json(_cache)

  try {
    const tasks = buildTasks()
    console.log(`[market] ${tasks.length} tarefas · pool 30 · ${NICHES.length} nichos · ${MARKETS.length} mercados`)

    const rawResults = await runPool(
      tasks.map(task => async () => {
        const items = await searchYT(task.q, task.gl, task.hl)
        return { ...task, items }
      }),
      30
    )

    const trending = aggregateResults(rawResults)
    const total    = trending.niches.reduce((s, n) => s + n.total, 0)
    console.log(`[market] ${total} vídeos analisados`)

    const result = { updatedAt: new Date().toISOString(), ...trending }
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

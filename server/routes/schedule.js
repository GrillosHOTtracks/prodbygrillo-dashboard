require('dotenv').config()
const express = require('express')
const fs      = require('fs')
const path    = require('path')
const Groq    = require('groq-sdk')
const { search: innertubeSearch } = require('../lib/innertube')

const router    = express.Router()
const DATA_FILE = path.join(__dirname, '../data/schedule.json')

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]')

function readSchedule()     { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) } catch { return [] } }
function writeSchedule(arr) { fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2)) }

// ─── GET /api/schedule ───────────────────────────────────────────────────────
router.get('/', (_req, res) => {
  res.json(readSchedule())
})

// ─── DELETE /api/schedule/:id ────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  writeSchedule(readSchedule().filter(e => e.id !== req.params.id))
  res.json({ ok: true })
})

// ─── PATCH /api/schedule/:id — mark as posted ────────────────────────────────
router.patch('/:id', (req, res) => {
  const schedule = readSchedule().map(e =>
    e.id === req.params.id ? { ...e, ...req.body } : e
  )
  writeSchedule(schedule)
  res.json({ ok: true })
})

// Fetch trending type beat artists from YouTube via Innertube (zero quota)
// Searches TYPE BEAT queries to find which artists are most searched by producers right now
async function fetchTrendingArtists() {
  const queries = [
    'type beat 2026',
    'free type beat 2026',
    'melodic trap type beat 2026',
    'pluggnb type beat 2026',
    'rnb type beat 2026',
  ]
  // Extract artist name from type beat titles:
  // "[FREE] Gunna Type Beat - ..." → "Gunna"
  // "Lil Baby Type Beat 2026 ..."  → "Lil Baby"
  function extractFromTypeBeat(title) {
    // Remove [FREE], [FREE USE], etc.
    let t = title.replace(/\[.*?\]/g, '').trim()
    // Match "Artist Type Beat" pattern
    const m = t.match(/^(.+?)\s+type[\s-]?beat/i)
    if (!m) return null
    return m[1]
      .replace(/\s*[-–|"()\[\]]+.*$/, '')
      .trim()
      .slice(0, 40)
  }

  const tally = {}  // artist → count (most repeated = most in demand)
  const seen  = new Set()

  try {
    const results = await Promise.allSettled(queries.map(q => innertubeSearch(q).catch(() => [])))
    for (const r of results) {
      if (r.status !== 'fulfilled') continue
      for (const v of r.value) {
        if (!v.title) continue
        const artist = extractFromTypeBeat(v.title)
        if (!artist || artist.length < 2) continue
        const key = artist.toLowerCase()
        tally[key] = (tally[key] || 0) + 1
        if (!seen.has(key)) seen.add(key)
      }
    }
  } catch {}

  // Sort by frequency (most searched artist = appears in more type beat titles)
  const sorted = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => {
      // Recover original casing from tally key
      for (const r of Object.values(tally)) { void r }
      // Find original casing from seen set
      return key.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    })
    .slice(0, 15)

  console.log(`[SCHEDULE] Type beat trending artists (${sorted.length}):`, sorted.join(', '))

  if (sorted.length < 5) {
    return ['Rod Wave', 'Toosii', 'Gunna', 'Lil Baby', 'Don Toliver', '42 Dugg', 'NBA YoungBoy', 'Future', 'Loe Shimmy', 'Kodak Black']
  }
  return sorted
}

// ─── POST /api/schedule/generate — AI generates weekly plan ─────────────────
router.post('/generate', async (req, res) => {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) return res.status(503).json({ error: 'GROQ_API_KEY não configurada' })

  const { weeks = 1, anchorArtist = 'Hurricane Wisdom', startDate } = req.body
  const days  = weeks * 7
  const start = startDate ? new Date(startDate) : new Date()

  // Fetch trending artists in real time
  const trendingArtists = await fetchTrendingArtists()
  const artistList = trendingArtists.join(', ')
  console.log(`[SCHEDULE] Trending artists fetched (${trendingArtists.length}):`, artistList)

  // Pass ALL existing beat names and combos to the AI so it never repeats them
  const existing = readSchedule()
  const existingBeatNames  = [...new Set(existing.map(e => e.beatName).filter(Boolean))]
  const existingCombos     = [...new Set(existing.map(e => `${e.anchorArtist}|${e.secondaryArtist}`).filter(Boolean))]

  const prompt = `You are a YouTube content strategist for a type beat channel called prodbygrillo.

Primary artist anchor: "${anchorArtist}". Title format: [FREE] ${anchorArtist} Type Beat - "Beat Name" | Secondary Type Beat

Generate a ${days}-day content calendar starting from ${start.toISOString().slice(0, 10)}.

Rules:
- 70%: "${anchorArtist}" as anchor + secondary artist for the | slot
- 30%: bigger mainstream artist as main + "${anchorArtist}" in the | slot
- Secondary artists (currently trending — use these): ${artistList}
- Beat names: 1-3 words, creative, evocative — real song title feel (e.g. "Still Here", "Cold Summer", "After Midnight")
- NEVER use any beat name that already exists in the calendar — the following are FORBIDDEN: ${existingBeatNames.length ? existingBeatNames.map(n => `"${n}"`).join(', ') : 'none yet'}
- NEVER repeat the same anchor+secondary artist combination — the following combos are FORBIDDEN: ${existingCombos.length ? existingCombos.join(', ') : 'none yet'}
- Each secondary artist must be a SINGLE real artist name (no "X", "&", "feat." combinations)
- Vary genre daily: melodic trap, pluggnb, drill, RnB, dark trap

Return ONLY a JSON array, no markdown:
[
  {
    "date": "YYYY-MM-DD",
    "anchorArtist": "Hurricane Wisdom",
    "secondaryArtist": "Loe Shimmy",
    "beatName": "Still Here",
    "genre": "melodic trap",
    "filenameTemplate": "Hurricane Wisdom Type Beat 2026 - Still Here"
  }
]`

  try {
    const client = new Groq({ apiKey })
    const resp = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    let raw = (resp.choices[0]?.message?.content || '').trim()
    if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

    let entries
    try { entries = JSON.parse(raw) }
    catch { return res.status(500).json({ error: 'IA devolveu JSON inválido' }) }

    if (!Array.isArray(entries)) return res.status(500).json({ error: 'Resposta inesperada da IA' })

    // Merge with existing — enforce uniqueness on date, beat name, and artist combo
    const existingDates  = new Set(existing.map(e => e.date))
    const usedBeatNames  = new Set(existing.map(e => (e.beatName || '').toLowerCase()))
    const usedCombos     = new Set(existing.map(e => `${e.anchorArtist}|${e.secondaryArtist}`))

    const newEntries = []
    for (const e of entries) {
      if (!e.date || !e.beatName) continue
      if (existingDates.has(e.date))  continue  // date already planned

      const anchor    = (e.anchorArtist || anchorArtist).trim()
      const secondary = (e.secondaryArtist || '').trim()
      const beatKey   = e.beatName.toLowerCase()
      const comboKey  = `${anchor}|${secondary}`

      if (usedBeatNames.has(beatKey)) continue   // beat name already used
      if (usedCombos.has(comboKey))   continue   // artist combo already used

      const entry = {
        id:               `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        date:             e.date,
        anchorArtist:     anchor,
        secondaryArtist:  secondary,
        beatName:         e.beatName,
        genre:            e.genre || '',
        filenameTemplate: `${anchor} Type Beat 2026 - ${e.beatName}`,
        status:           'planned',
      }
      newEntries.push(entry)
      existingDates.add(e.date)
      usedBeatNames.add(beatKey)
      usedCombos.add(comboKey)
    }

    const merged = [...existing, ...newEntries].sort((a, b) => a.date.localeCompare(b.date))
    writeSchedule(merged)

    res.json(newEntries)
  } catch (err) {
    console.error('[SCHEDULE] generate error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

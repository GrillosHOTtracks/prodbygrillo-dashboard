require('dotenv').config()
const express = require('express')
const fs      = require('fs')
const path    = require('path')
const Groq    = require('groq-sdk')

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

// ─── POST /api/schedule/generate — AI generates weekly plan ─────────────────
router.post('/generate', async (req, res) => {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) return res.status(503).json({ error: 'GROQ_API_KEY não configurada' })

  const { weeks = 1, anchorArtist = 'Hurricane Wisdom', startDate } = req.body
  const days = weeks * 7

  const start = startDate ? new Date(startDate) : new Date()

  const prompt = `You are a YouTube content strategist for a type beat channel called prodbygrillo.

Primary artist anchor: "${anchorArtist}". Title format: [FREE] ${anchorArtist} Type Beat - "Beat Name" | Secondary Type Beat

Generate a ${days}-day content calendar starting from ${start.toISOString().slice(0, 10)}.

Rules:
- 70%: "${anchorArtist}" as anchor + secondary artist for the | slot
- 30%: bigger mainstream artist as main + "${anchorArtist}" in the | slot
- Secondary artists: Loe Shimmy, Rod Wave, Toosii, Gunna, Lil Baby, Don Toliver, 42 Dugg, NBA YoungBoy, Kodak Black, Future
- Beat names: 1-3 words, creative, evocative — real song title feel (e.g. "Still Here", "Cold Summer", "After Midnight")
- Never repeat beat names or same artist combo twice in a row
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

    // Merge with existing — skip dates already planned or posted
    const existing = readSchedule()
    const existingDates = new Set(existing.map(e => e.date))

    const newEntries = entries
      .filter(e => e.date && e.beatName && !existingDates.has(e.date))
      .map(e => ({
        id:               `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        date:             e.date,
        anchorArtist:     e.anchorArtist || anchorArtist,
        secondaryArtist:  e.secondaryArtist || '',
        beatName:         e.beatName,
        genre:            e.genre || '',
        filenameTemplate: `${e.anchorArtist || anchorArtist} Type Beat 2026 - ${e.beatName}`,
        status:           'planned',
      }))

    const merged = [...existing, ...newEntries].sort((a, b) => a.date.localeCompare(b.date))
    writeSchedule(merged)

    res.json(newEntries)
  } catch (err) {
    console.error('[SCHEDULE] generate error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

require('dotenv').config()
const express = require('express')
const fs      = require('fs')
const path    = require('path')
const Groq = require('groq-sdk')
const { jsonrepair } = require('jsonrepair')

const SCHEDULE_FILE = path.join(__dirname, '../data/schedule.json')
const UPLOADS_FILE  = path.join(__dirname, '../data/uploads.json')

function loadSchedule() { try { return JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf-8')) } catch { return [] } }
function loadUploads()  { try { return JSON.parse(fs.readFileSync(UPLOADS_FILE,  'utf-8')) } catch { return [] } }

const router = express.Router()

// ─── Chat prompt builder ──────────────────────────────────────────────────────
function buildChatPrompt(ctx, history, question) {
  let prompt = `És LAIS, analista e planeadora de conteúdo do canal prodbygrillo. O teu papel é analisar os dados reais do canal, o cronograma de beats planeados e o histórico de uploads — dando respostas concretas, directas e accionáveis. Respondes sempre em português de Portugal. Sem introduções, sem rodeios — vai directo aos números e às conclusões. Evita linguagem genérica quando tens dados disponíveis.`

  if (ctx?.channel) {
    const c = ctx.channel
    prompt += `\n\n## Canal\nNome: ${c.name}\nInscritos: ${(c.subscribers || 0).toLocaleString('pt-PT')}\nViews totais: ${(c.totalViews || 0).toLocaleString('pt-PT')}\nVídeos publicados: ${c.totalVideos}`
  }

  if (ctx?.analytics) {
    const a = ctx.analytics
    const last7  = (a.daily || []).slice(-7)
    const prev7  = (a.daily || []).slice(-14, -7)
    const last7v = last7.reduce((s, d) => s + d.views, 0)
    const prev7v = prev7.reduce((s, d) => s + d.views, 0)
    const trend  = prev7v > 0 ? (((last7v - prev7v) / prev7v) * 100).toFixed(1) : null

    prompt += `\n\n## Analytics (últimos ${a.days} dias)\nViews totais: ${(a.totalViews || 0).toLocaleString('pt-PT')}\nWatch time: ${Math.round(a.totalWatchTime || 0).toLocaleString('pt-PT')} minutos\nCTR médio: ${a.avgCtr}%\nInscritos ganhos: ${a.totalSubscribers}`
    if (a.bestDay)  prompt += `\nMelhor dia: ${a.bestDay.date} — ${a.bestDay.views} views`
    if (a.worstDay) prompt += `\nPior dia activo: ${a.worstDay.date} — ${a.worstDay.views} views`
    if (trend !== null) prompt += `\nTendência (últimos 7d vs 7d anteriores): ${Number(trend) > 0 ? '+' : ''}${trend}%`

    if (last7.length) {
      prompt += '\n\nÚltimos 7 dias:'
      last7.forEach(d => {
        prompt += `\n- ${d.date}: ${d.views} views | ${Math.round(d.watchTime)} min | ${d.subscribers} subs`
      })
    }
  }

  if (ctx?.traffic?.length) {
    prompt += '\n\n## Fontes de tráfego'
    ctx.traffic.forEach(t => { prompt += `\n- ${t.name}: ${t.value}%` })
  }

  if (ctx?.videos?.length) {
    prompt += `\n\n## Top ${ctx.videos.length} vídeos (por views)`
    ctx.videos.forEach((v, i) => {
      prompt += `\n${i + 1}. "${v.title}" — ${(v.views || 0).toLocaleString('pt-PT')} views | CTR: ${v.ctr}% | publicado: ${(v.publishedAt || '').slice(0, 10)}`
    })
  }

  // ── Cronograma de beats planeados ──────────────────────────────────────────
  if (ctx?.schedule?.length) {
    const today = new Date().toISOString().slice(0, 10)
    const upcoming = ctx.schedule.filter(e => e.status === 'planned' && e.date >= today)
    const done     = ctx.schedule.filter(e => e.status === 'posted').slice(-5)
    if (upcoming.length) {
      prompt += `\n\n## Cronograma — Próximos Beats a Criar (${upcoming.length})`
      upcoming.forEach(e => {
        const title = `[FREE] ${e.anchorArtist} Type Beat - "${e.beatName}"${e.secondaryArtist ? ` | ${e.secondaryArtist} Type Beat` : ''}`
        prompt += `\n- ${e.date}: ${title}`
      })
    }
    if (done.length) {
      prompt += `\n\n## Cronograma — Últimos Beats Concluídos`
      done.forEach(e => { prompt += `\n- ${e.date}: "${e.beatName}" ✓` })
    }
  }

  // ── Histórico de uploads recentes ──────────────────────────────────────────
  if (ctx?.uploadHistory?.length) {
    prompt += `\n\n## Uploads Recentes (últimos ${ctx.uploadHistory.length})`
    ctx.uploadHistory.forEach(e => {
      prompt += `\n- ${(e.publishedAt || '').slice(0, 10)} | ${e.status === 'live' ? '● LIVE' : '◌ AGENDADO'} | ${(e.views || 0)} views | "${e.title?.slice(0, 60)}"`
    })
  }

  if (history?.length) {
    prompt += '\n\n## Histórico da conversa'
    history.forEach(m => { prompt += `\n${m.role === 'user' ? 'Utilizador' : 'AI'}: ${m.text}` })
  }

  prompt += `\n\nPergunta actual: ${question}`
  prompt += '\n\nResponde de forma directa e prática com base nos dados acima. Se algum dado for insuficiente para responder, diz-o claramente.'

  return prompt
}

// Fixes bare control chars inside JSON string values and validates \uXXXX escapes.
// Uses index-based iteration so \uXXXX is handled atomically (no per-char flag drift).
function sanitizeJsonStrings(raw) {
  let result   = ''
  let inString = false
  let i        = 0

  while (i < raw.length) {
    const ch = raw[i]

    if (!inString) {
      result += ch
      if (ch === '"') inString = true
      i++
      continue
    }

    // ── Inside a JSON string value ──────────────────────────────────────────
    if (ch === '\\') {
      const next = raw[i + 1]

      if (next === '"' || next === '\\' || next === '/' ||
          next === 'b' || next === 'f'  || next === 'n' ||
          next === 'r' || next === 't') {
        result += ch + next      // valid single-char escape — pass through
        i += 2
        continue
      }

      if (next === 'u') {
        const hex = raw.slice(i + 2, i + 6)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          result += raw.slice(i, i + 6)   // valid \uXXXX — pass through intact
          i += 6
        } else {
          result += '\\\\'                // malformed \u — escape the backslash
          i++                             // leave 'u' + rest to be re-processed
        }
        continue
      }

      // Bare or unknown backslash — escape it so JSON.parse doesn't choke
      result += '\\\\'
      i++
      continue
    }

    if (ch === '"') {
      // Peek past whitespace: a real closing quote is followed by , } ] : or EOF.
      // Anything else is a stray inner quote — the model forgot to escape it.
      let j = i + 1
      while (j < raw.length && (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\r' || raw[j] === '\n')) j++
      const after = raw[j]
      if (after === ',' || after === '}' || after === ']' || after === ':' || after === undefined) {
        result += ch; inString = false; i++  // real closing quote
      } else {
        result += '\\"'; i++                  // stray inner quote — escape it
      }
      continue
    }

    // Bare control characters — must be escaped inside JSON strings
    if (ch === '\n') { result += '\\n'; i++; continue }
    if (ch === '\r') { result += '\\r'; i++; continue }
    if (ch === '\t') { result += '\\t'; i++; continue }
    if (ch.charCodeAt(0) < 0x20) { i++; continue }

    result += ch
    i++
  }

  return result
}

// ─── Build video title (x9beatz dual-SEO format) ─────────────────────────────
// Solo:   [FREE] Lil Baby Type Beat - "Beat Name" | Rod Wave Type Beat
// Collab: [FREE] Lil Baby x Toosii Type Beat - "Beat Name" | Rod Wave Type Beat
//
// forcedSecondary (from Agenda plan) is ALWAYS reserved for the | pipe position.
// It is never promoted to the x collab slot.
function buildTitle(parsed, beatName, mainArtist, forcedSecondary) {
  const allArtists = parsed.trendingComparison?.matchingArtists || []

  let titleArtists
  if (mainArtist) {
    if (forcedSecondary) {
      // Plan-driven: solo format — forcedSecondary goes to the | pipe, no x collab
      titleArtists = mainArtist
    } else {
      // No plan: pick a collab from matchingArtists for x format
      const excluded = new Set([mainArtist].map(s => s.toLowerCase().trim()))
      const collab = allArtists.find(a => !excluded.has(a.toLowerCase().trim())) || null
      titleArtists = collab ? `${mainArtist} x ${collab}` : mainArtist
    }
  } else {
    titleArtists = allArtists.slice(0, 2).join(' x ') || 'Type'
  }

  // Pipe secondary: forced value takes priority; falls back to AI's pick if not already in the title
  const usedNames = new Set(titleArtists.split(' x ').map(s => s.toLowerCase().trim()))
  let secondary = null
  if (forcedSecondary && !usedNames.has(forcedSecondary.toLowerCase().trim())) {
    secondary = forcedSecondary
  } else if (!forcedSecondary) {
    const aiPick = typeof parsed.secondaryArtist === 'string' ? parsed.secondaryArtist.trim() : ''
    if (aiPick && !usedNames.has(aiPick.toLowerCase())) secondary = aiPick
  }

  const base = `[FREE] ${titleArtists} Type Beat - "${beatName}"`
  return secondary ? `${base} | ${secondary} Type Beat` : base
}

// ─── Assemble description server-side ────────────────────────────────────────
function buildDescription(parsed, beatName, detectedBpm, detectedKey, mainArtist, forcedSecondary) {
  const videoTitle = buildTitle(parsed, beatName, mainArtist, forcedSecondary)
  const bpm        = detectedBpm ?? parsed.bpm ?? null
  const key        = detectedKey ?? parsed.key ?? null
  const year       = new Date().getFullYear()
  const secondary  = forcedSecondary || (typeof parsed.secondaryArtist === 'string' ? parsed.secondaryArtist.trim() : '')
  const vibes      = (parsed.trendingComparison?.vibes || []).slice(0, 3).join(', ')

  // ── Keyword-rich opening (indexed by YouTube above the fold) ─────────────
  const artistLine = secondary
    ? `Free ${mainArtist} Type Beat ${year} | Free ${secondary} Type Beat ${year} | "${beatName}"`
    : `Free ${mainArtist} Type Beat ${year} | "${beatName}"`

  const keywordPara = secondary
    ? `Free ${mainArtist} x ${secondary} type beat instrumental produced by prodbygrillo.${vibes ? ` ${vibes.charAt(0).toUpperCase() + vibes.slice(1)} vibes.` : ''} Perfect for artists looking for a ${mainArtist} type beat, ${secondary} type beat, or any ${vibes || 'melodic trap'} instrumental ${year}.`
    : `Free ${mainArtist} type beat instrumental produced by prodbygrillo.${vibes ? ` ${vibes.charAt(0).toUpperCase() + vibes.slice(1)} vibes.` : ''}`

  const bpmKeyLine = [bpm ? `BPM: ${bpm}` : null, key ? `Key: ${key}` : null].filter(Boolean).join(' | ')

  const lines = [
    videoTitle,
    '',
    artistLine,
    keywordPara,
    '',
    '💰 Download/Purchase: https://www.beatstars.com/prodbygrillo',
    '',
    '📋 LEASING OPTIONS:',
    '• MP3 Lease — $24.99',
    '• WAV Lease — $34.99',
    '• Unlimited Lease — $99.99',
    '• Exclusive Rights — DM for pricing',
    '',
    `FREE FOR NON-PROFIT only. To monetize on any distribution platform, purchase a lease.`,
    '',
    ...(bpmKeyLine ? [`🎵 ${bpmKeyLine}`] : []),
    '✍️ Credit required in song title: (prod. prodbygrillo)',
    '',
    '🔔 Subscribe for free type beats daily → https://www.youtube.com/@prodbygrillo?sub_confirmation=1',
    '',
    '📩 Contact & Socials:',
    'DM: @prodbygrillo',
    'Instagram: @prodbygrillo',
    'TikTok: @prodbygrillo',
    'BeatStars: beatstars.com/prodbygrillo',
  ]

  // Remove consecutive blank lines
  return lines.reduce((acc, line, i, arr) => {
    if (line === '' && arr[i - 1] === '') return acc
    return acc + (acc ? '\n' : '') + line
  }, '')
}

function buildPrompt(beatName, detectedBpm, detectedKey, mainArtist, forcedSecondary) {
  const now    = new Date()
  const month  = now.toLocaleString('en-US', { month: 'long' })
  const year   = now.getFullYear()
  const seed   = Math.random().toString(36).slice(2, 10)
  const angles = [
    'focus on viral short-form potential and TikTok crossover artists',
    'focus on underground SoundCloud artists and niche communities',
    'focus on mainstream chart-topping artists and radio-friendly keywords',
    'focus on international markets — UK drill, Afrobeats crossover, Latin trap',
    'focus on emerging artists with under 1M monthly listeners who match this vibe',
    'focus on classic influential artists that still drive search volume in this niche',
    'focus on producers with similar sound — producer tags and beatmaker community keywords',
    'focus on playlist placement keywords and Spotify editorial pitching language',
  ]
  const angle = angles[Math.floor(Math.random() * angles.length)]

  const audioNote = (detectedBpm !== null || detectedKey !== null)
    ? `\n\nAUDIO ANALYSIS (detected from the audio file — use these EXACT values, do NOT override):\n` +
      (detectedBpm !== null ? `- BPM: ${detectedBpm}\n` : '') +
      (detectedKey !== null ? `- Key: ${detectedKey}\n` : '')
    : ''

  const forcedSecondaryNote = forcedSecondary
    ? `\n\nFORCED SECONDARY ARTIST — The production plan mandates "${forcedSecondary}" as the pipe secondary (after |). You MUST return "secondaryArtist": "${forcedSecondary}" in your JSON. Do NOT place "${forcedSecondary}" in the x collab slot or in matchingArtists[0].\n`
    : ''

  const artistAnchor = mainArtist
    ? `\n\nARTIST ANCHOR — The filename identifies "${mainArtist}" as the primary artist reference. Rules:\n` +
      `- "${mainArtist}" MUST be the FIRST entry in matchingArtists — never replace or move it.\n` +
      `- Add 1-2 complementary artists after it that match the same genre/vibe.\n` +
      `- optimizedTitle MUST start with [FREE] ${mainArtist} x <complementary1> x <complementary2> Type Beat ${new Date().getFullYear()}.\n` +
      `- Every artist-based tag MUST lead with "${mainArtist}": "${mainArtist} type beat", "${mainArtist} free type beat", "${mainArtist} x [other] type beat", "${mainArtist} prodbygrillo", etc.\n` +
      `- thumbnail.concept must be inspired by "${mainArtist}"'s visual aesthetic.\n`
    : ''

  return `You are an expert in YouTube SEO and digital marketing for beat producers, with encyclopedic knowledge of RnB, PluggnB, Melodic Trap, Drill, Afrobeats, and all instrumental/type-beat subgenres.

VARIATION SEED: ${seed}
CREATIVE ANGLE FOR THIS ANALYSIS: ${angle}

Your ONLY source of truth is this beat name: "${beatName}"
Generate ALL content (title, description, tags, hashtags, matching artists, thumbnail concept) based EXCLUSIVELY on this name. Derive genre, mood, and artist references from what the name evokes. Never invent content unrelated to it, never copy examples from the schema below literally, and never output a beat name different from the one provided.${audioNote}${artistAnchor}${forcedSecondaryNote}

Context: it is ${month} ${year}. You have deep knowledge of:
- Current trending artists across all subgenres of trap, RnB, PluggnB, melodic rap
- YouTube instrumental/type beat channel strategies (how top producers title, tag, and describe beats)
- Beatmaker community keywords: "free type beat", "instrumental", "loop kit", "sample pack"
- Which artists are currently hot in the streets vs charting on Billboard vs trending on TikTok
- How to write descriptions that rank for long-tail searches AND satisfy the YouTube algorithm
- Musical theory — infer BPM and key signature from the beat name, mood keywords, and genre context
- The difference between "type beat" keyword clustering vs. artist-specific search intent

DUAL-SEO RULE: The title uses the format: [FREE] ANCHOR Type Beat - "Name" | SECONDARY Type Beat. Choose a secondaryArtist with high search volume in the type beat niche that matches the vibe — this makes the video appear in TWO different artist searches. Pick from: Loe Shimmy, Rod Wave, Toosii, Gunna, Lil Baby, Don Toliver, 42 Dugg, NBA YoungBoy, Kodak Black — whichever fits the mood best.

TAGS RULE: Generate tags anchored to "${mainArtist || '<artist>'}". Pattern:
1. "${mainArtist || '<artist>'} type beat", "free ${mainArtist || '<artist>'} type beat", "${mainArtist || '<artist>'} type beat free", "${mainArtist || '<artist>'} instrumental", "${mainArtist || '<artist>'} type beat ${new Date().getFullYear()}"
2. If collab artist: "[collab] type beat", "free [collab] type beat", "[collab] x ${mainArtist || '<artist>'} type beat", "[collab] type beat ${new Date().getFullYear()}"
3. Genre-specific (3-4 tags): match the vibe — e.g. "melodic trap type beat", "pluggnb type beat", "drill type beat", "rnb type beat"
4. Location tags (2-3): infer from artist origin — e.g. "atlanta type beat", "florida type beat", "new york type beat", "chicago type beat", "london drill type beat"
5. Mood tags (2-3): e.g. "dark type beat", "emotional type beat", "sad type beat", "aggressive type beat"
6. The server will add generic tags automatically — do NOT include: "type beat", "free type beat", "free beats", "rap beat", "no copyright beats", "beats to rap to", "prod by prodbygrillo" — focus your tags on artist+genre+location+mood only.

TITLE/DESCRIPTION: Both are built server-side. Set "optimizedTitle" and "description" to "" (empty string) in your JSON.

Return ONLY valid JSON, no markdown, no extra text. Use this exact structure:

{
  "seoScore": <integer 0-100>,
  "bpm": ${detectedBpm !== null ? detectedBpm : '<exact BPM as integer ONLY if explicitly stated in the beat name — otherwise return null>'},
  "key": ${detectedKey !== null ? `"${detectedKey}"` : '"<exact musical key ONLY if explicitly stated in the beat name — otherwise return null>"'},
  "titleAnalysis": {
    "score": <integer 0-100>,
    "charCount": <character count of the original beat name>,
    "strengths": ["strength 1", "strength 2"],
    "issues": ["issue 1", "issue 2"],
    "alternatives": [
      "optimized alternative title 1",
      "optimized alternative title 2",
      "optimized alternative title 3"
    ]
  },
  "optimizedTitle": "Built server-side — leave as empty string ''",
  "description": "Built server-side — leave as empty string ''",
  "secondaryArtist": "<ONE artist for dual-SEO after the pipe: pick someone who shares the same vibe as ${mainArtist || 'the main artist'} and has high search volume in type beats — e.g. Loe Shimmy, Rod Wave, Toosii, Gunna, Lil Baby. Must be DIFFERENT from any artist already in matchingArtists. Return null if no good fit.>",
  "tags": ${mainArtist
    ? `["${mainArtist} type beat", "free ${mainArtist} type beat", "${mainArtist} type beat free", "${mainArtist} instrumental", "${mainArtist} type beat ${new Date().getFullYear()}", "free type beat", "type beat", "beats", "free beats", "rap beat", "free beat", "hip hop beat", "type beat ${new Date().getFullYear()}", "sample type beat", "<add 3-5 genre-specific tags matching the vibe of '${beatName}' e.g. 'philly drill type beat', 'melodic trap type beat', 'pluggnb type beat'>"]`
    : `["<artist1> type beat", "free <artist1> type beat", "<artist1> type beat free", "<artist1> instrumental", "<artist1> type beat ${new Date().getFullYear()}", "free type beat", "type beat", "beats", "free beats", "rap beat", "free beat", "hip hop beat", "type beat ${new Date().getFullYear()}", "sample type beat", "<3-5 genre-specific tags>"]`
  },
  "hashtags": ["#<mainartistnospaces>typebeat", "#typebeat", "#sampletypebeat", "#freetypebeat", "#<genre>typebeat", "#freebeat", "#rapbeat", "#hiphop", "#<mood>typebeat", "#typebeat${new Date().getFullYear()}"],
  "thumbnail": {
    "concept": "detailed visual description of the thumbnail concept",
    "colors": ["#hex1", "#hex2", "#hex3"],
    "mainText": "MAIN TEXT IN UPPERCASE",
    "subText": "complementary subtext",
    "style": "dark"
  },
  "postingSchedule": {
    "bestDay": "day of the week",
    "bestTime": "HH:MM",
    "timezone": "BRT",
    "reasoning": "explanation based on RnB/PluggnB niche data"
  },
  "trendingComparison": {
    "matchingArtists": ["artist1", "artist2", "artist3"],
    "vibes": ["vibe1", "vibe2", "vibe3"],
    "uniquenessScore": <integer 0-100>,
    "competitionLevel": "low|medium|high",
    "suggestion": "specific suggestion to stand out"
  }
}`
}

// POST /api/ai/analyze-beat  — streams SSE
router.post('/analyze-beat', async (req, res) => {
  const { beatName, bpm, key, mainArtist, secondaryArtist: rawSecondary } = req.body
  if (!beatName || typeof beatName !== 'string' || !beatName.trim()) {
    return res.status(400).json({ error: 'beatName is required' })
  }
  const detectedBpm   = typeof bpm === 'number' && Number.isFinite(bpm) ? Math.round(bpm) : null
  const detectedKey   = typeof key === 'string' && key.trim() ? key.trim() : null
  const cleanSecondary = typeof rawSecondary === 'string' && rawSecondary.trim() ? rawSecondary.trim() : null

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    return res.status(503).json({
      error: 'GROQ_API_KEY não configurada. Adicione ao arquivo .env na raiz do projeto.',
      code: 'NO_API_KEY',
    })
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  try {
    const client = new Groq({ apiKey })
    const MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']

    // Buffer full response to sanitize JSON before streaming back.
    // Cascade through models on 429 (daily token limit).
    let fullText = ''
    for (let mi = 0; mi < MODELS.length; mi++) {
      fullText = ''
      try {
        const stream = await client.chat.completions.create({
          model: MODELS[mi],
          max_tokens: 4096,
          stream: true,
          messages: [{ role: 'user', content: buildPrompt(beatName.trim(), detectedBpm, detectedKey, typeof mainArtist === 'string' && mainArtist.trim() ? mainArtist.trim() : null, cleanSecondary) }],
        })
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || ''
          if (text) fullText += text
        }
        break // success — stop trying models
      } catch (modelErr) {
        const is429 = modelErr?.status === 429 || /rate_limit_exceeded/i.test(modelErr?.message || '')
        if (is429 && mi < MODELS.length - 1) {
          console.warn(`[AI] ${MODELS[mi]} rate-limited — retrying with ${MODELS[mi + 1]}`)
          continue
        }
        throw modelErr
      }
    }

    // Strip markdown fences if model wrapped in ```json ... ```
    let clean = fullText.trim()
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    }

    // Parse with progressive fallback: raw → repair → sanitize+repair
    let parsed
    try {
      parsed = JSON.parse(clean)
    } catch {
      try {
        parsed = JSON.parse(jsonrepair(clean))
      } catch {
        try {
          parsed = JSON.parse(jsonrepair(sanitizeJsonStrings(clean)))
        } catch (finalErr) {
          throw new Error(`IA devolveu JSON inválido: ${finalErr.message}`)
        }
      }
    }

    // Build title and description server-side (guaranteed December channel format)
    const cleanMain = typeof mainArtist === 'string' && mainArtist.trim() ? mainArtist.trim() : null
    // Force secondaryArtist from plan before title/tag building
    if (cleanSecondary) parsed.secondaryArtist = cleanSecondary
    parsed.optimizedTitle = buildTitle(parsed, beatName.trim(), cleanMain, cleanSecondary)
    parsed.description    = buildDescription(parsed, beatName.trim(), detectedBpm, detectedKey, cleanMain, cleanSecondary)

    // Rebuild tags server-side anchored to mainArtist (December channel pattern)
    const year = new Date().getFullYear()
    if (cleanMain) {
      const anchor = cleanMain
      const collab = (parsed.trendingComparison?.matchingArtists || [])
        .find(a => a.toLowerCase().trim() !== anchor.toLowerCase().trim())

      // Secondary must differ from anchor and collab to avoid duplicate tags
      const usedInTitle = new Set([anchor, collab].filter(Boolean).map(s => s.toLowerCase().trim()))
      const secondary = typeof parsed.secondaryArtist === 'string' && parsed.secondaryArtist.trim()
        && !usedInTitle.has(parsed.secondaryArtist.trim().toLowerCase())
        ? parsed.secondaryArtist.trim() : null

      const coreTags = [
        `${anchor} type beat`,
        `free ${anchor} type beat`,
        `${anchor} type beat free`,
        `${anchor} instrumental`,
        `${anchor} type beat ${year}`,
        `${anchor} prod prodbygrillo`,
        ...(collab ? [
          `${collab} type beat`,
          `free ${collab} type beat`,
          `${collab} x ${anchor} type beat`,
          `${collab} type beat ${year}`,
        ] : []),
        ...(secondary ? [
          `${secondary} type beat`,
          `free ${secondary} type beat`,
          `${secondary} type beat ${year}`,
          `${anchor} x ${secondary} type beat`,
        ] : []),
      ]
      const genericTags = [
        'type beat', 'free type beat', 'free beats', 'rap beat', 'beats',
        'free beat', 'hip hop beat', 'sample type beat', `type beat ${year}`,
        'no copyright beats', 'beats to rap to', 'rap instrumentals',
        'free instrumentals', 'prod by prodbygrillo', 'prodbygrillo',
      ]
      // Keep AI genre-specific tags (filter out anything already in core/generic)
      const coreSet = new Set([...coreTags, ...genericTags].map(t => t.toLowerCase()))
      const aiGenre = (parsed.tags || []).filter(t => !coreSet.has(t.toLowerCase().trim())).slice(0, 10)

      parsed.tags = [...coreTags, ...aiGenre, ...genericTags]
    }

    clean = JSON.stringify(parsed)

    // Re-stream in chunks so the frontend terminal shows the build-up effect
    const CHUNK = 60
    for (let i = 0; i < clean.length; i += CHUNK) {
      res.write(`data: ${JSON.stringify({ text: clean.slice(i, i + CHUNK) })}\n\n`)
    }

    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    console.error('[AI] error:', err.message)
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    res.end()
  }
})

// POST /api/ai/chat — Groq llama-3.3-70b, SSE streaming
router.post('/chat', async (req, res) => {
  const { question, context, history, maxTokens, systemPrompt } = req.body
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'question is required' })
  }
  const tokenLimit = typeof maxTokens === 'number' ? Math.min(Math.max(maxTokens, 256), 4096) : 1024

  // Inject schedule and upload history into context automatically
  const enrichedContext = {
    ...(context || {}),
    schedule:      loadSchedule(),
    uploadHistory: loadUploads().slice(0, 15),
  }

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    return res.status(503).json({ error: 'GROQ_API_KEY não configurada no .env', code: 'NO_API_KEY' })
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const send = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch {} }

  try {
    const client = new Groq({ apiKey })
    const prompt = (typeof systemPrompt === 'string' && systemPrompt.trim())
      ? `${systemPrompt.trim()}\n\n${question.trim()}`
      : buildChatPrompt(enrichedContext, history, question.trim())
    const MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']

    let streamed = false
    for (let mi = 0; mi < MODELS.length; mi++) {
      try {
        const stream = await client.chat.completions.create({
          model:      MODELS[mi],
          max_tokens: tokenLimit,
          stream:     true,
          messages:   [{ role: 'user', content: prompt }],
        })
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || ''
          if (text) send({ text })
        }
        streamed = true
        break
      } catch (modelErr) {
        const is429 = modelErr?.status === 429 || /rate_limit_exceeded/i.test(modelErr?.message || '')
        if (is429 && mi < MODELS.length - 1) {
          console.warn(`[AI/chat] ${MODELS[mi]} rate-limited — retrying with ${MODELS[mi + 1]}`)
          continue
        }
        throw modelErr
      }
    }
    if (streamed) { res.write('data: [DONE]\n\n'); res.end() }
  } catch (err) {
    console.error('[AI/chat] error:', err.message)
    send({ error: err.message })
    res.write('data: [DONE]\n\n')
    res.end()
  }
})

module.exports = router

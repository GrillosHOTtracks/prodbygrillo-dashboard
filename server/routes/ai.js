require('dotenv').config()
const express = require('express')
const Groq = require('groq-sdk')
const { GoogleGenerativeAI } = require('@google/generative-ai')
const { jsonrepair } = require('jsonrepair')

const router = express.Router()

// ─── Chat prompt builder ──────────────────────────────────────────────────────
function buildChatPrompt(ctx, history, question) {
  let prompt = `És LAIS, analista do canal prodbygrillo. O teu papel é analisar os dados reais do canal e dar respostas concretas, directas e accionáveis. Respondes sempre em português de Portugal. Sem introduções, sem rodeios — vai directo aos números e às conclusões. Evita linguagem genérica quando tens dados disponíveis.`

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

// ─── Assemble description server-side — ensures correct format regardless of model ──
function buildDescription(parsed, beatName, detectedBpm, detectedKey) {
  const artists  = (parsed.trendingComparison?.matchingArtists || []).slice(0, 3).join(' x ')
  const bpm      = detectedBpm ?? parsed.bpm ?? null
  const key      = detectedKey ?? parsed.key ?? null
  const bpmLine  = [bpm ? `${bpm} BPM` : null, key || null].filter(Boolean).join(' | ') || '[BPM] BPM | [KEY]'
  const hashtags = (parsed.hashtags || []).join(' ')

  return [
    `🦗 ${artists} Type Beat - ${beatName} prodbygrillo`,
    '',
    '💰 BUY (Untagged): https://www.beatstars.com/prodbygrillo',
    '',
    `🎵 ${bpmLine}`,
    '',
    '📋 LEASING:',
    '* MP3 Lease - $24.99',
    '',
    '📩 Custom beats & exclusives: DM @prodbygrillo',
    '',
    '━━━━━━━━━━━━━━━━━━━',
    '🚫 TERMS OF USE 🚫',
    '━━━━━━━━━━━━━━━━━━━',
    '✅ FREE for non-profit use only',
    '✅ MUST credit prodbygrillo in the title',
    '✅ MUST tag @prodbygrillo on social media',
    '❌ NO monetization without purchasing a lease',
    '❌ NO distribution to Spotify/Apple Music without lease',
    '❌ NO selling, leasing or transferring this beat',
    '',
    '━━━━━━━━━━━━━━━━━━━',
    '🔗 FOLLOW',
    '━━━━━━━━━━━━━━━━━━━',
    '📱 TikTok: @prodbygrillo',
    '📷 Instagram: @prodbygrillo',
    '🛒 BeatStars: beatstars.com/prodbygrillo',
    ...(hashtags ? ['', hashtags] : []),
  ].join('\n')
}

function buildPrompt(beatName, detectedBpm, detectedKey) {
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

  return `You are an expert in YouTube SEO and digital marketing for beat producers, with encyclopedic knowledge of RnB, PluggnB, Melodic Trap, Drill, Afrobeats, and all instrumental/type-beat subgenres.

VARIATION SEED: ${seed}
CREATIVE ANGLE FOR THIS ANALYSIS: ${angle}

You MUST produce a completely unique analysis every time. Never reuse titles, tags, or suggestions from previous analyses. The seed and angle above must influence your output in a measurable way.

Analyze the following beat name for a YouTube upload:
"${beatName}"${audioNote}

Context: it is ${month} ${year}. You have deep knowledge of:
- Current trending artists across all subgenres of trap, RnB, PluggnB, melodic rap
- YouTube instrumental/type beat channel strategies (how top producers title, tag, and describe beats)
- Beatmaker community keywords: "free type beat", "instrumental", "loop kit", "sample pack"
- Which artists are currently hot in the streets vs charting on Billboard vs trending on TikTok
- How to write descriptions that rank for long-tail searches AND satisfy the YouTube algorithm
- Musical theory — infer BPM and key signature from the beat name, mood keywords, and genre context
- The difference between "type beat" keyword clustering vs. artist-specific search intent

CRITICAL — The "description" field MUST use EXACTLY this template. Fill in only the bracketed placeholders; copy everything else character-for-character including all emojis, dashes, and symbols:

🦗 [TOP 2-3 ARTISTS FROM matchingArtists, e.g. Lil Baby x Rod Wave] Type Beat - [BEAT_NAME] prodbygrillo

💰 BUY (Untagged): https://www.beatstars.com/prodbygrillo

🎵 ${detectedBpm !== null ? detectedBpm : '[INFERRED_BPM]'} BPM | ${detectedKey !== null ? detectedKey : '[INFERRED_KEY]'}

📋 LEASING:
* MP3 Lease - $24.99

📩 Custom beats & exclusives: DM @prodbygrillo

━━━━━━━━━━━━━━━━━━━
🚫 TERMS OF USE 🚫
━━━━━━━━━━━━━━━━━━━
✅ FREE for non-profit use only
✅ MUST credit prodbygrillo in the title
✅ MUST tag @prodbygrillo on social media
❌ NO monetization without purchasing a lease
❌ NO distribution to Spotify/Apple Music without lease
❌ NO selling, leasing or transferring this beat

━━━━━━━━━━━━━━━━━━━
🔗 FOLLOW
━━━━━━━━━━━━━━━━━━━
📱 TikTok: @prodbygrillo
📷 Instagram: @prodbygrillo
🛒 BeatStars: beatstars.com/prodbygrillo

[ALL HASHTAGS FROM hashtags ARRAY JOINED WITH SPACES]

The description value in JSON must be a single string with \\n for every line break. Keep all emojis, ━ symbols, ✅ ❌ exactly as shown above. NEVER use double-quote characters (") inside the description string — they break JSON. Use single quotes (') if quoting is needed.

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
  "optimizedTitle": "YouTube title within 70 chars that maximizes reach — always include [FREE], top 2-3 matching artist names joined with x, genre keyword, 'Type Beat', and year. Example: '[FREE] Drake x PartyNextDoor x Loe Shimmy Type Beat 2026'. Front-load the most searchable artist name.",
  "description": "<FULL DESCRIPTION USING THE TEMPLATE ABOVE — single string, \\n for each line break>",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10", "tag11", "tag12", "tag13", "tag14", "tag15"],
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5", "#hashtag6", "#hashtag7", "#hashtag8", "#hashtag9", "#hashtag10"],
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
  const { beatName, bpm, key } = req.body
  if (!beatName || typeof beatName !== 'string' || !beatName.trim()) {
    return res.status(400).json({ error: 'beatName is required' })
  }
  const detectedBpm = typeof bpm === 'number' && Number.isFinite(bpm) ? Math.round(bpm) : null
  const detectedKey = typeof key === 'string' && key.trim() ? key.trim() : null

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
          max_tokens: 3500,
          stream: true,
          messages: [{ role: 'user', content: buildPrompt(beatName.trim(), detectedBpm, detectedKey) }],
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

    // Override description with server-built version — guaranteed correct format
    parsed.description = buildDescription(parsed, beatName.trim(), detectedBpm, detectedKey)
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
      : buildChatPrompt(context, history, question.trim())
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

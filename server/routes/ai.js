require('dotenv').config()
const express = require('express')
const Groq = require('groq-sdk')

const router = express.Router()

// Replaces bare control chars inside JSON string values (LLaMA outputs literal \n in strings)
function sanitizeJsonStrings(raw) {
  let result = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) { result += ch; escaped = false; continue }
    if (ch === '\\' && inString) { result += ch; escaped = true; continue }
    if (ch === '"') { inString = !inString; result += ch; continue }
    if (inString) {
      if (ch === '\n') { result += '\\n'; continue }
      if (ch === '\r') { result += '\\r'; continue }
      if (ch === '\t') { result += '\\t'; continue }
      if (ch.charCodeAt(0) < 0x20) continue
    }
    result += ch
  }
  return result
}

function buildPrompt(beatName) {
  const now   = new Date()
  const month = now.toLocaleString('en-US', { month: 'long' })
  const year  = now.getFullYear()

  return `You are an expert in YouTube SEO and digital marketing for beat producers, with deep knowledge of the RnB, PluggnB, and Melodic Trap niche.

Analyze the following beat name for a YouTube upload:
"${beatName}"

Context: it is ${month} ${year}. Focus on current trends in the niche.

Return ONLY valid JSON, no markdown, no extra text. Use this exact structure:

{
  "seoScore": <integer 0-100>,
  "titleAnalysis": {
    "score": <integer 0-100>,
    "charCount": <character count of the original name>,
    "strengths": ["strength 1", "strength 2"],
    "issues": ["issue 1", "issue 2"],
    "alternatives": [
      "optimized alternative title 1",
      "optimized alternative title 2",
      "optimized alternative title 3"
    ]
  },
  "optimizedTitle": "full optimized YouTube title (max 70 chars)",
  "description": "full YouTube description in English with 3 paragraphs separated by \\n\\n: 1) about the beat and its vibe, 2) natural keywords and artists it fits, 3) call-to-action with licensing contact info.",
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
  const { beatName } = req.body
  if (!beatName || typeof beatName !== 'string' || !beatName.trim()) {
    return res.status(400).json({ error: 'beatName is required' })
  }

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

    // Buffer full response to sanitize JSON before streaming back
    let fullText = ''
    const stream = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 2048,
      stream: true,
      messages: [{ role: 'user', content: buildPrompt(beatName.trim()) }],
    })

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || ''
      if (text) fullText += text
    }

    // Strip markdown fences if model wrapped in ```json ... ```
    let clean = fullText.trim()
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    }

    // Fix bare control chars inside string values
    clean = sanitizeJsonStrings(clean)

    // Validate
    JSON.parse(clean)

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

module.exports = router

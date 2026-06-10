import { useState, useEffect, useCallback } from 'react'
import type { Page } from '../types'
import type { DailyRow, ChannelInfo, Video as ApiVideo } from '../lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────
interface EngagementItem {
  videoId: string
  title:   string
  channel: string
  artist:  string
  comment: string
}

interface CheckItem {
  id: string
  text: string
  page?: Page
}

interface PlanData {
  date: string
  dayContext: string
  mainTask: { text: string; page?: Page }
  checklist: CheckItem[]
  insights: string[]
  weeklyGoal: { subsProgress: number; subsTarget: number; watchMinutes: number; watchTarget: number }
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const panel: React.CSSProperties = {
  backgroundColor: '#0d0d0d',
  borderTop: '2px solid #555555', borderLeft: '2px solid #555555',
  borderRight: '2px solid #1a1a1a', borderBottom: '2px solid #1a1a1a',
  padding: '14px',
}
const dim: React.CSSProperties = { color: '#555555', fontSize: '10px', letterSpacing: '1px', margin: 0 }
const retroBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid #2a2a2a', color: '#555555',
  fontSize: '10px', padding: '5px 14px', cursor: 'pointer',
  fontFamily: 'Courier New, monospace', letterSpacing: '1px', whiteSpace: 'nowrap',
}

// ─── Constants ────────────────────────────────────────────────────────────────
const VALID_PAGES: Page[] = ['overview', 'videos', 'analytics', 'audience', 'revenue', 'plan', 'scheduler', 'settings']
const DAYS_PT = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

function sanitizePage(p: unknown): Page | undefined {
  return VALID_PAGES.includes(p as Page) ? (p as Page) : undefined
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

// ─── System prompt for all Plan/LAIS calls ────────────────────────────────────
const PLAN_SYSTEM_PROMPT = `Você é um estrategista de crescimento do YouTube especializado no nicho de produtores musicais, beatmakers e venda de beats (Type Beats). Seu objetivo é transformar o canal prodbygrillo em uma máquina de visualizações, inscritos e vendas de beats via BeatStars.

Você domina o algoritmo do YouTube (vídeos longos e Shorts), SEO para música, funis de conversão de ouvintes para compradores, e psicologia do público (rappers, cantores e compositores que buscam beats).

Ao gerar o checklist diário e insights, aplica sempre estes pilares:
1. SEO de Type Beats: tags estratégicas, títulos magnéticos com artista em alta + estilo, descrições otimizadas com links de compra no topo
2. Retenção e Engajamento: como prender o artista nos primeiros 5-10 segundos, drop forte
3. Linha Editorial Diversificada: não só beat estático — bastidores, tutoriais, Shorts, conteúdo que humaniza o canal
4. Funil de Vendas: estratégias para levar o lead do YouTube para o BeatStars ou lista de contatos

Tom: profissional, direto, focado em resultados, inovador.`

// ─── SSE helper — POST /api/ai/chat, collect full text ────────────────────────
async function laisChat(question: string, maxTokens = 1024, systemPrompt?: string): Promise<string> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, maxTokens, ...(systemPrompt ? { systemPrompt } : {}) }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const reader  = res.body!.getReader()
  const decoder = new TextDecoder()
  let rawBuf = '', full = ''
  outer: while (true) {
    const { done, value } = await reader.read()
    if (done) break
    rawBuf += decoder.decode(value, { stream: true })
    const lines = rawBuf.split('\n')
    rawBuf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6)
      if (payload === '[DONE]') break outer
      try { const evt = JSON.parse(payload); if (evt.text) full += evt.text } catch {}
    }
  }
  return full
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('JSON inválido da LAIS')
  return JSON.parse(match[0])
}

// ─── GoalBar ──────────────────────────────────────────────────────────────────
function GoalBar({ label, current, target, fmt }: { label: string; current: number; target: number; fmt: (n: number) => string }) {
  const pct    = Math.min(100, Math.round((current / target) * 100))
  const color  = pct >= 80 ? '#00ff00' : pct >= 40 ? '#ffaa00' : '#00aa00'
  const filled = Math.round(pct / 5)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ color: '#555555', fontSize: '10px', letterSpacing: '1px' }}>{label}</span>
        <span style={{ color, fontSize: '10px' }}>{fmt(current)} / {fmt(target)} · {pct}%</span>
      </div>
      <div style={{ fontSize: '11px', letterSpacing: '-1px', lineHeight: 1 }}>
        <span style={{ color }}>{'█'.repeat(filled)}</span>
        <span style={{ color: '#1a1a1a' }}>{'░'.repeat(20 - filled)}</span>
      </div>
    </div>
  )
}

// ─── CopyBtn ──────────────────────────────────────────────────────────────────
function CopyBtn({ text, label = '[ COPIAR ]' }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500) })}
      style={{
        background: 'transparent',
        border: `1px solid ${ok ? '#00ff00' : '#1a3a1a'}`,
        color: ok ? '#00ff00' : '#00aa00',
        fontSize: '9px', padding: '3px 8px', cursor: 'pointer',
        fontFamily: 'Courier New, monospace', letterSpacing: '0.5px', flexShrink: 0,
      }}
    >
      {ok ? '✓ COPIADO' : label}
    </button>
  )
}

// ─── Plan ─────────────────────────────────────────────────────────────────────
interface PlanProps {
  channelInfo: ChannelInfo | null
  analyticsData: DailyRow[] | null
  videos: ApiVideo[] | null
  onNavigate: (page: Page) => void
}

export function Plan({ channelInfo, analyticsData, videos, onNavigate }: PlanProps) {
  const [plan, setPlan]       = useState<PlanData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [checks, setChecks]   = useState<Record<string, boolean>>({})

  const [engagement, setEngagement] = useState<EngagementItem[] | null>(null)
  const [engLoading, setEngLoading] = useState(false)
  const [engError, setEngError]     = useState('')
  const [engDone, setEngDone]       = useState<Record<string, boolean>>({})

  const [autoComStatus, setAutoComStatus]     = useState<any>(null)
  const [autoRepStatus, setAutoRepStatus]     = useState<any>(null)
  const [autoPlStatus,  setAutoPlStatus]      = useState<any>(null)
  const [autoSeoStatus, setAutoSeoStatus]     = useState<any>(null)
  const [comExpanded, setComExpanded]         = useState(false)
  const [repExpanded, setRepExpanded]         = useState(false)

  function fmtCountdown(ms: number) {
    if (ms <= 0) return '—'
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    const d = Math.floor(h / 24)
    if (d > 0) return `${d}d ${(h % 24)}h`
    return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`
  }

  function loadAllEngineStatus() {
    const apis = [
      ['/api/plan/comments-status',  setAutoComStatus],
      ['/api/plan/replies-status',   setAutoRepStatus],
      ['/api/plan/playlists-status', setAutoPlStatus],
      ['/api/plan/seo-status',       setAutoSeoStatus],
    ] as const
    apis.forEach(([url, setter]) => {
      fetch(url).then(r => r.ok ? r.json() : null).then(d => { if (d) setter(d) }).catch(() => {})
    })
  }

  function loadAutoComStatus() { fetch('/api/plan/comments-status').then(r => r.ok ? r.json() : null).then(d => { if (d) setAutoComStatus(d) }).catch(() => {}) }
  function loadAutoRepStatus() { fetch('/api/plan/replies-status').then(r => r.ok ? r.json() : null).then(d => { if (d) setAutoRepStatus(d) }).catch(() => {}) }

  function runComNow() {
    setAutoComStatus((s: any) => s ? { ...s, running: true } : s)
    fetch('/api/plan/run-comments', { method: 'POST' }).then(() => setTimeout(loadAutoComStatus, 1500)).catch(() => {})
  }
  function runRepNow() {
    setAutoRepStatus((s: any) => s ? { ...s, running: true } : s)
    fetch('/api/plan/run-replies', { method: 'POST' }).then(() => setTimeout(loadAutoRepStatus, 1500)).catch(() => {})
  }
  function runPlNow() {
    setAutoPlStatus((s: any) => s ? { ...s, running: true } : s)
    fetch('/api/plan/run-playlists', { method: 'POST' }).then(() => setTimeout(() => fetch('/api/plan/playlists-status').then(r => r.json()).then(setAutoPlStatus), 2000)).catch(() => {})
  }
  function runSeoNow() {
    setAutoSeoStatus((s: any) => s ? { ...s, running: true } : s)
    fetch('/api/plan/run-seo', { method: 'POST' }).then(() => setTimeout(() => fetch('/api/plan/seo-status').then(r => r.json()).then(setAutoSeoStatus), 2000)).catch(() => {})
  }

  const today = todayStr()

  // ── Load from localStorage ─────────────────────────────────────────────────
  useEffect(() => {
    try { const s = localStorage.getItem(`plan_${today}`);        if (s) setPlan(JSON.parse(s)) } catch {}
    try { const s = localStorage.getItem(`plan_checks_${today}`); if (s) setChecks(JSON.parse(s)) } catch {}
    try { const s = localStorage.getItem(`engagement_${today}`);  if (s) setEngagement(JSON.parse(s)) } catch {}
    try { const s = localStorage.getItem(`eng_done_${today}`);    if (s) setEngDone(JSON.parse(s)) } catch {}
  }, [today])

  function toggleEngDone(id: string) {
    setEngDone(prev => {
      const next = { ...prev, [id]: !prev[id] }
      localStorage.setItem(`eng_done_${today}`, JSON.stringify(next))
      return next
    })
  }

  function toggleCheck(id: string) {
    setChecks(prev => {
      const next = { ...prev, [id]: !prev[id] }
      localStorage.setItem(`plan_checks_${today}`, JSON.stringify(next))
      return next
    })
  }

  // ── fetchEngagement ────────────────────────────────────────────────────────
  const fetchEngagement = useCallback(async (bust = false) => {
    if (engLoading) return
    setEngLoading(true)
    setEngError('')

    try {
      // Step 1: get trending artists from /api/trending (uses Innertube, no market needed)
      const tRes = await fetch('/api/trending')
      if (!tRes.ok) throw new Error(`trending HTTP ${tRes.status}`)
      const tData = await tRes.json() as Array<{ name: string }>

      const artists: string[] = tData.map(a => a.name).filter(Boolean)
      if (!artists.length) throw new Error('Sem artistas em trending — tenta mais tarde')

      // On bust: shuffle to rotate through different artists
      const pool     = bust ? [...artists].sort(() => Math.random() - 0.5) : artists
      const selected = pool.slice(0, 5)

      // Step 2: fetch one official music video per artist via Innertube
      const avRes = await fetch(`/api/trending/artist-videos?artists=${encodeURIComponent(selected.join(','))}`)
      if (!avRes.ok) throw new Error(`artist-videos HTTP ${avRes.status}`)
      const avData = await avRes.json() as { videos: Array<{ artist: string; videoId: string; title: string; channel: string }> }

      const artistVids = avData.videos.filter(v => v.videoId)
      if (!artistVids.length) throw new Error('Não foi possível encontrar vídeos dos artistas')

      // Step 3: LAIS generates strategic comments
      const videoList = artistVids.map((v, i) =>
        `${i + 1}. videoId="${v.videoId}" | artist="${v.artist}" | title="${v.title.slice(0, 70)}"`
      ).join('\n')

      const question = `You are a music producer leaving comments on official artist YouTube videos. Be strategic but authentic.

Videos:
${videoList}

For EACH video write ONE comment in English (15-20 words, casual tone).

Rules:
- Sound like a genuine music fan / fellow musician — NOT spam, NOT a promoter
- Subtly hint that you produce beats in that style WITHOUT saying it directly
- NEVER use: "beat", "type beat", BeatStars, links, or direct self-promotion
- Subtle hints: "This vibe is exactly what I've been working on lately", "Been deep in this sound for weeks", "This hits different every time"
- Be specific to the artist's known sound — not generic
- Vary tone per video: admiration, personal/reflective, hype

Reply ONLY in valid JSON (no markdown, no text before or after):
{"comments":[{"videoId":"ID","comment":"..."}]}`

      const full   = await laisChat(question, 1200, PLAN_SYSTEM_PROMPT)
      const parsed = extractJson(full) as { comments: { videoId: string; comment: string }[] }

      const commentMap: Record<string, string> = {}
      parsed.comments.forEach(c => { commentMap[c.videoId] = c.comment ?? '' })

      const result: EngagementItem[] = artistVids.map(v => ({
        videoId: v.videoId,
        title:   v.title,
        channel: v.channel,
        artist:  v.artist,
        comment: commentMap[v.videoId] ?? '',
      }))

      setEngagement(result)
      localStorage.setItem(`engagement_${today}`, JSON.stringify(result))
    } catch (err: any) {
      console.warn('[engagement]', err.message)
      setEngError(err.message)
    } finally {
      setEngLoading(false)
    }
  }, [engLoading, today])

  // ── fetchPlan ──────────────────────────────────────────────────────────────
  const fetchPlan = useCallback(async () => {
    if (loading) return
    setLoading(true)
    setError('')

    const subs        = channelInfo?.subscribers ?? 0
    const totalVideos = channelInfo?.totalVideos ?? 0
    const channelName = (channelInfo?.name ?? 'prodbygrillo').replace(/"/g, "'")

    const sorted          = [...(videos ?? [])].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    const lastUploadMs    = sorted[0] ? new Date(sorted[0].publishedAt).getTime() : null
    const daysSinceUpload = lastUploadMs ? Math.floor((Date.now() - lastUploadMs) / 86400000) : null
    const lastVideoTitle  = (sorted[0]?.title ?? '').slice(0, 50).replace(/"/g, "'")
    const lastVideoViews  = sorted[0]?.views ?? 0
    const lastVideoCtr    = sorted[0]?.ctr?.toFixed(1) ?? '?'
    const lastDaysAgo     = lastUploadMs ? Math.floor((Date.now() - lastUploadMs) / 86400000) : '?'

    const recent7     = (analyticsData ?? []).slice(-7)
    const totalViews7 = recent7.reduce((s, r) => s + r.views, 0)
    const subGain7    = recent7.reduce((s, r) => s + r.subscribers, 0)
    const allWatchMin = (analyticsData ?? []).reduce((s, r) => s + r.watchTime, 0)
    const avgCtr      = recent7.length ? (recent7.reduce((s, r) => s + r.ctr, 0) / recent7.length).toFixed(2) : '?'

    const dayOfWeek = DAYS_PT[new Date().getDay()]
    const dateStr   = new Date().toLocaleDateString('pt-BR')

    // Yesterday's task IDs to avoid repetition
    const yesterday     = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const yesterdayIds  = (() => {
      try {
        const y = localStorage.getItem(`plan_${yesterday}`)
        if (!y) return ''
        return (JSON.parse(y).checklist as CheckItem[]).map(i => i.id).join(', ')
      } catch { return '' }
    })()

    const question = `És a LAIS — estrategista de crescimento para canais de beats no YouTube, treinada nas metodologias de Sean Cannell (Think Media), Paddy Galloway e Nick Nimmin.

ESTADO REAL DO CANAL "${channelName}" — ${dayOfWeek}, ${dateStr}:
- Subscribers: ${subs.toLocaleString()} / 1.000 (meta YPP)
- Vídeos publicados: ${totalVideos} · Dias sem upload: ${daysSinceUpload ?? '?'}
- CTR médio (7d): ${avgCtr}% · Views (7d): ${totalViews7.toLocaleString()} · Subs ganhos (7d): +${subGain7}
- Watch time acumulado: ${Math.round(allWatchMin / 60)}h / 4.000h (meta YPP)
- Último vídeo: "${lastVideoTitle}" · há ${lastDaysAgo} dias · ${lastVideoViews.toLocaleString()} views · CTR ${lastVideoCtr}%
- Semente de variação: ${today}
- IDs de tarefas de ontem (NÃO repetir): [${yesterdayIds || 'nenhum'}]

PILARES DE CRESCIMENTO — CANAIS DE BEATS 2026 (roda de forma diferente cada dia):
① UPLOAD — frequência semanal, horário peak, formato "[FREE] Artista x Artista Type Beat 2026"
② CTR — thumbnail (rosto, contraste, texto grande), hook primeiros 30s, test de títulos
③ ENGAJAMENTO — responder comentários primeiras 24h pós-upload, pinned comment com link BeatStars
④ SEO — descrição com keywords de nicho, capítulos, playlists temáticas, cards e end screens
⑤ DISTRIBUIÇÃO — clip do loop principal para TikTok/Reels, YouTube Shorts
⑥ ANÁLISE — verificar retenção dos últimos 3 vídeos, CTR por thumbnail, peak hours no analytics
⑦ MONETIZAÇÃO — link BeatStars na bio, pricing visível, teaser de exclusivo
⑧ COMUNIDADE — community post, collab com outro produtor, responder DMs

Gera o plano do dia. Os itens do checklist devem ser ESPECÍFICOS e ACIONÁVEIS para este canal, não genéricos.
Responde APENAS em JSON válido (sem markdown, sem texto antes ou depois):
{
  "dayContext": "1 frase sobre hoje — ex: Sexta à noite é peak de plays em trap. Canal parado há X dias.",
  "mainTask": { "text": "tarefa de maior impacto para hoje (específica, com números)", "page": "scheduler" },
  "checklist": [
    { "id": "slug-kebab-unico", "text": "tarefa acionável e específica", "page": "videos" }
  ],
  "insights": [
    "insight 1 com dado concreto",
    "insight 2",
    "insight 3"
  ],
  "weeklyGoal": {
    "subsProgress": ${subs},
    "subsTarget": 1000,
    "watchMinutes": ${Math.round(allWatchMin)},
    "watchTarget": 240000
  }
}
REGRAS: máximo 7 itens · IDs únicos em kebab-case sem repetir os de ontem · page deve ser um dos valores válidos ou null · português de Portugal · se dias sem upload > 7, tarefa principal é OBRIGATORIAMENTE fazer upload`

    try {
      const full   = await laisChat(question, 2048, PLAN_SYSTEM_PROMPT)
      const parsed = extractJson(full) as PlanData
      if (parsed.mainTask?.page) parsed.mainTask.page = sanitizePage(parsed.mainTask.page)
      if (Array.isArray(parsed.checklist)) {
        parsed.checklist = parsed.checklist.map(item => ({ ...item, page: sanitizePage(item.page) }))
      }
      parsed.date = today
      setPlan(parsed)
      localStorage.setItem(`plan_${today}`, JSON.stringify(parsed))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [loading, channelInfo, analyticsData, videos, today])

  // ── Auto-fetch on mount ────────────────────────────────────────────────────
  useEffect(() => {
    if (!localStorage.getItem(`plan_${today}`))       fetchPlan()
    if (!localStorage.getItem(`engagement_${today}`)) fetchEngagement()
    loadAllEngineStatus()
  }, []) // eslint-disable-line

  // ── Poll auto-comment status — fast when running, slow when idle ───────────
  const anyRunning = autoComStatus?.running || autoRepStatus?.running || autoPlStatus?.running || autoSeoStatus?.running
  useEffect(() => {
    const iv = setInterval(loadAllEngineStatus, anyRunning ? 3000 : 30000)
    return () => clearInterval(iv)
  }, [anyRunning])

  // ── Midnight regeneration ──────────────────────────────────────────────────
  useEffect(() => {
    const now             = new Date()
    const tomorrow        = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const msUntilMidnight = tomorrow.getTime() - now.getTime()
    const tid = setTimeout(() => {
      setPlan(null); setChecks({}); fetchPlan()
      setEngagement(null); setEngDone({}); fetchEngagement()
    }, msUntilMidnight)
    return () => clearTimeout(tid)
  }, []) // eslint-disable-line

  const doneCount    = plan?.checklist.filter(i => checks[i.id]).length ?? 0
  const totalCount   = plan?.checklist.length ?? 0

  // videoIds the auto-job already commented on
  const jobPostedIds = new Set<string>(
    (autoComStatus?.todayEntries ?? []).map((e: any) => e.videoId)
  )
  // item counts as done if manually marked OR job already posted
  const engDoneCount = (engagement ?? []).filter(
    item => !!engDone[item.videoId] || jobPostedIds.has(item.videoId)
  ).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '2px', margin: 0, opacity: 0.8 }}>
        ┌─ PLANO DIÁRIO · LAIS AI ────────────────────────────────────────
      </p>

      {/* ── Plan loading ── */}
      {loading && (
        <div style={{ ...panel, textAlign: 'center', padding: '40px 20px' }}>
          <p style={{ color: '#00ff00', fontSize: '12px', margin: '0 0 8px', letterSpacing: '1px' }}>A GERAR PLANO DO DIA_</p>
          <p style={{ color: '#333333', fontSize: '11px', margin: 0 }}>{'█'.repeat(14)}<span className="blink">█</span></p>
          <p style={{ color: '#2a2a2a', fontSize: '10px', margin: '12px 0 0', letterSpacing: '1px' }}>LAIS a analisar dados reais do canal...</p>
        </div>
      )}

      {/* ── Plan error ── */}
      {error && !loading && (
        <div style={{ ...panel, borderTopColor: '#550000', borderLeftColor: '#550000' }}>
          <p style={{ color: '#ff4400', fontSize: '11px', margin: '0 0 10px' }}>ERRO: {error}</p>
          <button
            onClick={fetchPlan}
            style={{ ...retroBtn, borderColor: '#550000', color: '#ff4400' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#ff4400' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#550000' }}
          >
            [ TENTAR NOVAMENTE ]
          </button>
        </div>
      )}

      {plan && !loading && (
        <>
          {/* ── Header row ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', alignItems: 'stretch' }}>
            <div style={panel}>
              <p style={{ ...dim, marginBottom: '6px' }}>📅 CONTEXTO · {today}</p>
              <p style={{ color: '#c0c0c0', fontSize: '12px', margin: 0, lineHeight: 1.6 }}>{plan.dayContext}</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', justifyContent: 'center' }}>
              <button
                onClick={fetchPlan}
                style={retroBtn}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#00aa00'; (e.currentTarget as HTMLElement).style.color = '#00aa00' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2a2a2a'; (e.currentTarget as HTMLElement).style.color = '#555555' }}
              >
                [ REGENERAR ]
              </button>
              <p style={{ ...dim, textAlign: 'center', fontSize: '9px' }}>meia-noite auto</p>
            </div>
          </div>

          {/* ── Main task ── */}
          <div style={{ ...panel, borderTopColor: '#00ff00', borderLeftColor: '#00ff00', backgroundColor: '#080808' }}>
            <p style={{ ...dim, marginBottom: '8px' }}>⚡ TAREFA PRINCIPAL</p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
              <p style={{ color: '#00ff00', fontSize: '13px', margin: 0, fontWeight: 'bold', lineHeight: 1.5, flex: 1 }}>
                {plan.mainTask.text}
              </p>
              {plan.mainTask.page && (
                <button
                  onClick={() => onNavigate(plan!.mainTask.page!)}
                  style={{ background: '#00ff00', color: '#000', border: 'none', padding: '8px 20px', cursor: 'pointer', fontFamily: 'Courier New, monospace', fontSize: '11px', fontWeight: 'bold', letterSpacing: '2px', flexShrink: 0 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#00cc00' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#00ff00' }}
                >
                  [ FAZER AGORA ]
                </button>
              )}
            </div>
          </div>

          {/* ── Main grid ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '12px' }}>

            {/* Checklist */}
            <div style={panel}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <p style={{ ...dim, margin: 0 }}>✅ CHECKLIST DO DIA</p>
                <span style={{ color: doneCount === totalCount && totalCount > 0 ? '#00ff00' : '#555555', fontSize: '10px', letterSpacing: '1px' }}>
                  {doneCount}/{totalCount}{doneCount === totalCount && totalCount > 0 ? ' · COMPLETO' : ''}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {plan.checklist.map(item => {
                  const done = !!checks[item.id]
                  return (
                    <div
                      key={item.id}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 8px', backgroundColor: done ? '#0a1a0a' : '#080808', border: `1px solid ${done ? '#1a3a1a' : '#1a1a1a'}` }}
                    >
                      <button
                        onClick={() => toggleCheck(item.id)}
                        style={{ width: '14px', height: '14px', flexShrink: 0, border: `1px solid ${done ? '#00ff00' : '#333333'}`, background: done ? '#00ff00' : 'transparent', cursor: 'pointer', padding: 0, color: '#000', fontSize: '10px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        {done ? '✓' : ''}
                      </button>
                      <span style={{ flex: 1, color: done ? '#333333' : '#b0b0b0', fontSize: '11px', textDecoration: done ? 'line-through' : 'none', lineHeight: 1.4 }}>
                        {item.text}
                      </span>
                      {item.page && !done && (
                        <button
                          onClick={() => onNavigate(item.page!)}
                          style={{ background: 'transparent', border: '1px solid #1a3a1a', color: '#00aa00', fontSize: '9px', padding: '2px 7px', cursor: 'pointer', fontFamily: 'Courier New, monospace', letterSpacing: '0.5px', flexShrink: 0 }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#00ff00'; (e.currentTarget as HTMLElement).style.borderColor = '#00aa00' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#00aa00'; (e.currentTarget as HTMLElement).style.borderColor = '#1a3a1a' }}
                        >
                          IR →
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Right column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Insights */}
              <div style={panel}>
                <p style={{ ...dim, marginBottom: '10px' }}>📊 INSIGHTS DO DIA</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {plan.insights.map((ins, i) => (
                    <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                      <span style={{ color: '#00ff00', fontSize: '10px', flexShrink: 0, marginTop: '2px' }}>▸</span>
                      <p style={{ color: '#a0a0a0', fontSize: '11px', margin: 0, lineHeight: 1.5 }}>{ins}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* YPP progress */}
              <div style={panel}>
                <p style={{ ...dim, marginBottom: '12px' }}>🎯 PROGRESSO · META YPP</p>
                <GoalBar label="SUBSCRIBERS" current={plan.weeklyGoal.subsProgress} target={plan.weeklyGoal.subsTarget} fmt={n => n.toLocaleString()} />
                <div style={{ height: '10px' }} />
                <GoalBar label="WATCH TIME" current={plan.weeklyGoal.watchMinutes} target={plan.weeklyGoal.watchTarget} fmt={n => `${Math.round(n / 60).toLocaleString()}h`} />
                <p style={{ color: '#2a2a2a', fontSize: '9px', margin: '10px 0 0', letterSpacing: '1px' }}>YPP: 1.000 SUBS + 4.000H WATCH TIME</p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════
          ALGORITHM ENGINE — todos os jobs automáticos
      ══════════════════════════════════════════════════════════ */}
      <div style={{ ...panel, borderTopColor: '#00ff00', borderLeftColor: '#00ff00' }}>
        <p style={{ ...dim, marginBottom: '12px', color: '#00aa00' }}>⚡ ALGORITHM ENGINE · jobs automáticos</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>

          {/* SHORTS */}
          <div style={{ padding: '10px', backgroundColor: '#080808', border: '1px solid #1a1a1a' }}>
            <p style={{ ...dim, margin: '0 0 6px' }}>🎬 AUTO-SHORTS</p>
            <p style={{ color: '#c0c0c0', fontSize: '11px', margin: '0 0 4px' }}>corta + publica · a cada 2h</p>
            <p style={{ color: '#00aa00', fontSize: '10px', margin: 0 }}>pendentes: 11 · público imediato</p>
          </div>

          {/* COMMENTS */}
          <div style={{ padding: '10px', backgroundColor: '#080808', border: '1px solid #1a1a1a' }}>
            <p style={{ ...dim, margin: '0 0 6px' }}>💬 AUTO-COMMENTS + LIKES</p>
            <p style={{ color: '#c0c0c0', fontSize: '11px', margin: '0 0 4px' }}>
              {autoComStatus?.running ? <span style={{ color: '#ffaa00' }}>● a comentar...</span>
                : `${autoComStatus?.todayPosted ?? 0} hoje · próx. ${fmtCountdown(autoComStatus?.msUntilNext ?? 0)}`}
            </p>
            <p style={{ color: '#2a4a2a', fontSize: '9px', margin: '0 0 6px' }}>00:00 · 13:00 · 17:00 · 21:00 UTC</p>
            <button onClick={runComNow} disabled={autoComStatus?.running}
              style={{ ...retroBtn, fontSize: '9px', padding: '2px 8px', opacity: autoComStatus?.running ? 0.4 : 1 }}
              onMouseEnter={e => { if (!autoComStatus?.running) (e.currentTarget as HTMLElement).style.color = '#00aa00' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555555' }}>
              [ RUN ]
            </button>
          </div>

          {/* REPLIES */}
          <div style={{ padding: '10px', backgroundColor: '#080808', border: '1px solid #1a1a1a' }}>
            <p style={{ ...dim, margin: '0 0 6px' }}>🔁 AUTO-REPLIES</p>
            <p style={{ color: '#c0c0c0', fontSize: '11px', margin: '0 0 4px' }}>
              {autoRepStatus?.running ? <span style={{ color: '#ffaa00' }}>● a responder...</span>
                : `${autoRepStatus?.todayReplied ?? 0} hoje · ${autoRepStatus?.totalReplied ?? 0} total`}
            </p>
            <p style={{ color: '#2a4a2a', fontSize: '9px', margin: '0 0 6px' }}>responde comentários nos teus vídeos · 2h</p>
            <button onClick={runRepNow} disabled={autoRepStatus?.running}
              style={{ ...retroBtn, fontSize: '9px', padding: '2px 8px', opacity: autoRepStatus?.running ? 0.4 : 1 }}
              onMouseEnter={e => { if (!autoRepStatus?.running) (e.currentTarget as HTMLElement).style.color = '#00aa00' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555555' }}>
              [ RUN ]
            </button>
          </div>

          {/* PLAYLISTS */}
          <div style={{ padding: '10px', backgroundColor: '#080808', border: '1px solid #1a1a1a' }}>
            <p style={{ ...dim, margin: '0 0 6px' }}>📂 AUTO-PLAYLISTS</p>
            <p style={{ color: '#c0c0c0', fontSize: '11px', margin: '0 0 4px' }}>
              {autoPlStatus?.running ? <span style={{ color: '#ffaa00' }}>● a organizar...</span>
                : `${autoPlStatus?.playlistCount ?? 0} playlists · scan no arranque`}
            </p>
            <p style={{ color: '#2a4a2a', fontSize: '9px', margin: '0 0 6px' }}>
              {autoPlStatus?.playlists ? Object.keys(autoPlStatus.playlists).join(' · ') : 'Trap · Drill · Melodic · Phonk...'}
            </p>
            <button onClick={runPlNow} disabled={autoPlStatus?.running}
              style={{ ...retroBtn, fontSize: '9px', padding: '2px 8px', opacity: autoPlStatus?.running ? 0.4 : 1 }}
              onMouseEnter={e => { if (!autoPlStatus?.running) (e.currentTarget as HTMLElement).style.color = '#00aa00' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555555' }}>
              [ SCAN ]
            </button>
          </div>

          {/* SEO */}
          <div style={{ padding: '10px', backgroundColor: '#080808', border: '1px solid #1a1a1a', gridColumn: '1 / -1' }}>
            <p style={{ ...dim, margin: '0 0 6px' }}>🔍 AUTO-SEO · tags + descrições com artistas trending</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <p style={{ color: '#c0c0c0', fontSize: '11px', margin: '0 0 3px' }}>
                  {autoSeoStatus?.running ? <span style={{ color: '#ffaa00' }}>● a atualizar SEO...</span>
                    : `${autoSeoStatus?.totalUpdated ?? 0} vídeos atualizados · próx. ${fmtCountdown(autoSeoStatus?.msUntilNext ?? 0)}`}
                </p>
                {autoSeoStatus?.trendingUsed?.length > 0 && (
                  <p style={{ color: '#2a4a2a', fontSize: '9px', margin: 0 }}>
                    última run: {autoSeoStatus.trendingUsed.slice(0, 5).join(', ')}
                  </p>
                )}
                {autoSeoStatus?.lastResult?.status === 'error' && (
                  <p style={{ color: '#ff4400', fontSize: '9px', margin: 0 }}>ERRO: {autoSeoStatus.lastResult.error}</p>
                )}
              </div>
              <button onClick={runSeoNow} disabled={autoSeoStatus?.running}
                style={{ ...retroBtn, opacity: autoSeoStatus?.running ? 0.4 : 1 }}
                onMouseEnter={e => { if (!autoSeoStatus?.running) { (e.currentTarget as HTMLElement).style.borderColor = '#00aa00'; (e.currentTarget as HTMLElement).style.color = '#00aa00' } }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2a2a2a'; (e.currentTarget as HTMLElement).style.color = '#555555' }}>
                {autoSeoStatus?.running ? '[ A ATUALIZAR... ]' : '[ ATUALIZAR SEO AGORA ]'}
              </button>
            </div>
          </div>

          {/* FIRST-HOUR BURST */}
          <div style={{ padding: '10px', backgroundColor: '#080808', border: '1px solid #1a1a1a', gridColumn: '1 / -1' }}>
            <p style={{ ...dim, margin: '0 0 4px' }}>🚀 FIRST-HOUR BURST · ativado automaticamente em cada upload</p>
            <p style={{ color: '#444444', fontSize: '10px', margin: 0 }}>
              5min após upload → engagement comment (AI) + comentários trending + replies · auto-playlist
            </p>
          </div>

        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          FILA DE ENGAJAMENTO
      ══════════════════════════════════════════════════════════ */}
      <div style={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div>
            <p style={{ ...dim, margin: '0 0 4px' }}>💬 COMENTÁRIOS · vídeos em alta no nicho · só inglês</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: engDoneCount >= 5 ? '#00ff00' : '#c0c0c0', fontSize: '12px', fontWeight: 'bold' }}>
                {engDoneCount}/5 comentários feitos
              </span>
              <div style={{ fontSize: '10px', letterSpacing: '-1px' }}>
                <span style={{ color: engDoneCount >= 5 ? '#00ff00' : '#00aa00' }}>{'█'.repeat(engDoneCount)}</span>
                <span style={{ color: '#1a1a1a' }}>{'░'.repeat(Math.max(0, 5 - engDoneCount))}</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => fetchEngagement(true)}
            disabled={engLoading}
            style={{ ...retroBtn, opacity: engLoading ? 0.4 : 1 }}
            onMouseEnter={e => { if (!engLoading) { (e.currentTarget as HTMLElement).style.borderColor = '#00aa00'; (e.currentTarget as HTMLElement).style.color = '#00aa00' } }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2a2a2a'; (e.currentTarget as HTMLElement).style.color = '#555555' }}
          >
            {engLoading ? '[ A GERAR... ]' : '[ 5 NOVOS VÍDEOS ]'}
          </button>
        </div>

        {/* ── Auto-comment job status bar ── */}
        {autoComStatus && (
          <div style={{ backgroundColor: '#050505', border: '1px solid #1a2a1a', marginBottom: '12px' }}>
            {/* Top row */}
            <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ color: '#2a4a2a', fontSize: '9px', letterSpacing: '1px', flexShrink: 0 }}>● JOB AUTO · 4×/DIA</span>

              {autoComStatus.running ? (
                <span style={{ color: '#ffaa00', fontSize: '10px', flexShrink: 0 }}>
                  <span className="blink">●</span> A COMENTAR...
                </span>
              ) : (
                <span style={{ color: '#00aa00', fontSize: '10px', flexShrink: 0 }}>
                  ✓ {autoComStatus.todayPosted ?? 0} hoje · {autoComStatus.totalPosted ?? 0} total
                </span>
              )}

              {!autoComStatus.running && (
                <span style={{ color: '#2a2a2a', fontSize: '10px', flexShrink: 0 }}>
                  próx. {fmtCountdown(autoComStatus.msUntilNext)}
                </span>
              )}

              {autoComStatus.lastResult?.status === 'error' && (
                <span style={{ color: '#ff4400', fontSize: '10px', flex: 1 }}>
                  ERRO: {autoComStatus.lastResult.error}
                </span>
              )}

              <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', flexShrink: 0 }}>
                {(autoComStatus.todayEntries?.length > 0 || autoComStatus.lastResult) && (
                  <button
                    onClick={() => setComExpanded(x => !x)}
                    style={{ ...retroBtn, fontSize: '9px', padding: '3px 8px' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#555555'; (e.currentTarget as HTMLElement).style.color = '#888888' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2a2a2a'; (e.currentTarget as HTMLElement).style.color = '#555555' }}
                  >
                    {comExpanded ? '[ ▲ FECHAR ]' : '[ ▼ DETALHES ]'}
                  </button>
                )}
                <button
                  onClick={runComNow}
                  disabled={autoComStatus.running}
                  style={{ ...retroBtn, opacity: autoComStatus.running ? 0.4 : 1 }}
                  onMouseEnter={e => { if (!autoComStatus.running) { (e.currentTarget as HTMLElement).style.borderColor = '#00aa00'; (e.currentTarget as HTMLElement).style.color = '#00aa00' } }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2a2a2a'; (e.currentTarget as HTMLElement).style.color = '#555555' }}
                >
                  {autoComStatus.running ? '[ A COMENTAR... ]' : '[ EXECUTAR AGORA ]'}
                </button>
              </div>
            </div>

            {/* Schedule row */}
            <div style={{ padding: '4px 12px 8px', display: 'flex', gap: '6px', flexWrap: 'wrap', borderTop: '1px solid #111' }}>
              <span style={{ color: '#2a2a2a', fontSize: '9px', letterSpacing: '1px', marginRight: '4px' }}>HORÁRIOS BRT:</span>
              {['21:00', '10:00', '14:00', '18:00'].map(t => {
                const [h] = t.split(':').map(Number)
                const nowBRT = new Date(Date.now() - 3 * 3600000)
                const nowH = nowBRT.getUTCHours()
                const passed = nowH > h || (nowH === h && nowBRT.getUTCMinutes() > 5)
                return (
                  <span key={t} style={{ color: passed ? '#1a3a1a' : '#00aa00', fontSize: '9px', letterSpacing: '1px' }}>
                    {passed ? '✓' : '▸'} {t}
                  </span>
                )
              })}
            </div>

            {/* Expanded: today's posted comments */}
            {comExpanded && autoComStatus.todayEntries?.length > 0 && (
              <div style={{ borderTop: '1px solid #111', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {autoComStatus.todayEntries.map((e: any) => {
                  const link = e.commentId
                    ? `https://www.youtube.com/watch?v=${e.videoId}&lc=${e.commentId}`
                    : `https://www.youtube.com/watch?v=${e.videoId}`
                  return (
                    <div key={e.videoId} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                      <span style={{ color: '#00aa00', fontSize: '9px', flexShrink: 0, marginTop: '2px' }}>✓</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <span style={{ color: '#555555', fontSize: '9px' }}>{e.artist}</span>
                          <span style={{ color: '#444444', fontSize: '9px', fontStyle: 'italic', flex: 1 }}>"{e.comment}"</span>
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#2a4a6a', fontSize: '9px', textDecoration: 'none', flexShrink: 0, letterSpacing: '0.3px' }}
                            onMouseEnter={e2 => { (e2.currentTarget as HTMLElement).style.color = '#5588aa' }}
                            onMouseLeave={e2 => { (e2.currentTarget as HTMLElement).style.color = '#2a4a6a' }}
                          >
                            {e.commentId ? '[ VER COMENTÁRIO ]' : '[ VER VÍDEO ]'}
                          </a>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {engLoading && !engagement && (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <p style={{ color: '#333333', fontSize: '11px', margin: 0 }}>{'█'.repeat(10)}<span className="blink">█</span></p>
            <p style={{ color: '#2a2a2a', fontSize: '10px', margin: '8px 0 0', letterSpacing: '1px' }}>LAIS a selecionar vídeos do nicho via trending...</p>
          </div>
        )}

        {engError && !engLoading && (
          <div style={{ padding: '8px 12px', backgroundColor: '#0a0000', border: '1px solid #330000', marginBottom: '8px' }}>
            <p style={{ color: '#ff4400', fontSize: '10px', margin: 0, letterSpacing: '0.5px' }}>ERRO: {engError}</p>
          </div>
        )}

        {!engagement && !engLoading && (
          <div style={{ padding: '16px', backgroundColor: '#080808', border: '1px solid #1a1a1a', textAlign: 'center' }}>
            <p style={{ color: '#444444', fontSize: '11px', margin: '0 0 8px' }}>
              Sem vídeos para hoje — clica para gerar via artistas em trending.
            </p>
            <button
              onClick={() => fetchEngagement(false)}
              style={retroBtn}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#00aa00'; (e.currentTarget as HTMLElement).style.color = '#00aa00' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2a2a2a'; (e.currentTarget as HTMLElement).style.color = '#555555' }}
            >
              [ GERAR FILA ]
            </button>
          </div>
        )}

        {engagement && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {engagement.map((item, idx) => {
              const jobDone    = jobPostedIds.has(item.videoId)
              const manualDone = !!engDone[item.videoId]
              const done       = manualDone || jobDone
              return (
                <div
                  key={item.videoId}
                  style={{ padding: '10px 12px', backgroundColor: done ? '#0a1a0a' : '#080808', border: `1px solid ${done ? '#1a3a1a' : '#1a1a1a'}`, opacity: done ? 0.55 : 1 }}
                >
                  <div style={{ flex: 1, minWidth: 0, marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                      <p style={{ color: done ? '#444444' : '#c0c0c0', fontSize: '11px', margin: 0, textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {idx + 1}. {item.title}
                      </p>
                      {jobDone && (
                        <span style={{ color: '#1a4a1a', fontSize: '9px', border: '1px solid #1a3a1a', padding: '1px 5px', flexShrink: 0, letterSpacing: '0.5px' }}>
                          JOB ✓
                        </span>
                      )}
                    </div>
                    <p style={{ color: '#555555', fontSize: '10px', margin: 0 }}>
                      <span style={{ color: '#00aa00' }}>{item.artist}</span>{item.channel ? ` · ${item.channel}` : ''}
                    </p>
                  </div>

                  {item.comment && (
                    <div style={{ backgroundColor: '#050505', border: '1px solid #1a2030', padding: '8px 10px', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                        <p style={{ color: '#a0a0a0', fontSize: '11px', margin: 0, lineHeight: 1.5, fontStyle: 'italic', flex: 1 }}>
                          "{item.comment}"
                        </p>
                        <CopyBtn text={item.comment} label="[ COPY ]" />
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <a
                      href={`https://www.youtube.com/watch?v=${item.videoId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ background: 'transparent', border: '1px solid #1a2030', color: '#5588aa', fontSize: '9px', padding: '3px 8px', fontFamily: 'Courier New, monospace', letterSpacing: '0.5px', textDecoration: 'none', flexShrink: 0 }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#336699'; (e.currentTarget as HTMLElement).style.color = '#88bbdd' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1a2030'; (e.currentTarget as HTMLElement).style.color = '#5588aa' }}
                    >
                      [ VER VÍDEO ]
                    </a>
                    {jobDone ? (
                      <span style={{ color: '#1a4a1a', fontSize: '9px', padding: '3px 8px', border: '1px solid #1a3a1a', letterSpacing: '0.5px' }}>
                        ✓ JOB POSTOU
                      </span>
                    ) : (
                      <button
                        onClick={() => toggleEngDone(item.videoId)}
                        style={{ background: manualDone ? '#0a1a0a' : 'transparent', border: `1px solid ${manualDone ? '#00ff00' : '#1a1a1a'}`, color: manualDone ? '#00ff00' : '#333333', fontSize: '9px', padding: '3px 8px', cursor: 'pointer', fontFamily: 'Courier New, monospace', letterSpacing: '0.5px', flexShrink: 0 }}
                        onMouseEnter={e => { if (!manualDone) { (e.currentTarget as HTMLElement).style.borderColor = '#00aa00'; (e.currentTarget as HTMLElement).style.color = '#00aa00' } }}
                        onMouseLeave={e => { if (!manualDone) { (e.currentTarget as HTMLElement).style.borderColor = '#1a1a1a'; (e.currentTarget as HTMLElement).style.color = '#333333' } }}
                      >
                        {manualDone ? '✓ FEITO' : '[ MARCAR FEITO ]'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════
          AUTO-REPLIES — responde comentários nos teus vídeos
      ══════════════════════════════════════════════════════════ */}
      <div style={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div>
            <p style={{ ...dim, margin: '0 0 3px' }}>💬 RESPOSTAS · comentários nos teus vídeos · AI</p>
            <span style={{ color: '#555555', fontSize: '10px' }}>
              {autoRepStatus ? `${autoRepStatus.todayReplied ?? 0} hoje · ${autoRepStatus.totalReplied ?? 0} total` : '—'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {autoRepStatus?.lastResult?.results?.length > 0 && (
              <button
                onClick={() => setRepExpanded(x => !x)}
                style={{ ...retroBtn, fontSize: '9px', padding: '3px 8px' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#555555'; (e.currentTarget as HTMLElement).style.color = '#888888' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2a2a2a'; (e.currentTarget as HTMLElement).style.color = '#555555' }}
              >
                {repExpanded ? '[ ▲ FECHAR ]' : '[ ▼ VER RESPOSTAS ]'}
              </button>
            )}
            <button
              onClick={runRepNow}
              disabled={autoRepStatus?.running}
              style={{ ...retroBtn, opacity: autoRepStatus?.running ? 0.4 : 1 }}
              onMouseEnter={e => { if (!autoRepStatus?.running) { (e.currentTarget as HTMLElement).style.borderColor = '#00aa00'; (e.currentTarget as HTMLElement).style.color = '#00aa00' } }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2a2a2a'; (e.currentTarget as HTMLElement).style.color = '#555555' }}
            >
              {autoRepStatus?.running ? '[ A RESPONDER... ]' : '[ EXECUTAR AGORA ]'}
            </button>
          </div>
        </div>

        {/* Status row */}
        {autoRepStatus && (
          <div style={{ padding: '6px 10px', backgroundColor: '#050505', border: '1px solid #1a1a1a', marginBottom: repExpanded ? '10px' : 0, display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: autoRepStatus.running ? '#ffaa00' : '#2a4a2a', fontSize: '9px', letterSpacing: '1px' }}>
              {autoRepStatus.running ? <span className="blink">● A RESPONDER...</span> : '● JOB AUTO · 2h'}
            </span>
            {!autoRepStatus.running && (
              <span style={{ color: '#2a2a2a', fontSize: '10px' }}>
                próx. {fmtCountdown(autoRepStatus.msUntilNext)}
              </span>
            )}
            {autoRepStatus.lastResult?.status === 'done' && !autoRepStatus.running && (
              <span style={{ color: '#1a4a1a', fontSize: '10px' }}>
                ✓ última run: {autoRepStatus.lastResult.replied}/{autoRepStatus.lastResult.total} respostas
              </span>
            )}
            {autoRepStatus.lastResult?.status === 'error' && (
              <span style={{ color: '#ff4400', fontSize: '10px' }}>ERRO: {autoRepStatus.lastResult.error}</span>
            )}
            {autoRepStatus.lastResult?.message && (
              <span style={{ color: '#333333', fontSize: '10px' }}>{autoRepStatus.lastResult.message}</span>
            )}
          </div>
        )}

        {/* Expanded: last run replies */}
        {repExpanded && autoRepStatus?.lastResult?.results?.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {autoRepStatus.lastResult.results.filter((r: any) => r.ok).map((r: any, i: number) => (
              <div key={i} style={{ padding: '8px 10px', backgroundColor: '#050505', border: '1px solid #1a1a1a' }}>
                <p style={{ color: '#333333', fontSize: '9px', margin: '0 0 4px', fontStyle: 'italic' }}>
                  {r.author}: "{r.originalComment?.slice(0, 80)}{(r.originalComment?.length ?? 0) > 80 ? '…' : ''}"
                </p>
                <p style={{ color: '#00aa00', fontSize: '10px', margin: 0 }}>
                  ↳ {r.reply}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}

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
  checklist: CheckItem[]
  insights: string[]
  weeklyGoal: { subsProgress: number; subsTarget: number; watchMinutes: number; watchTarget: number }
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const S = {
  bg:      '#0a0a0a',
  bgCard:  '#0d0d0d',
  bgDeep:  '#070707',
  border:  '#1a1a1a',
  borderA: '#2a2a2a',
  green:   '#00ff00',
  greenM:  '#00cc00',
  greenD:  '#00aa00',
  greenX:  '#004400',
  yellow:  '#ffaa00',
  red:     '#ff4400',
  blue:    '#5588aa',
  muted:   '#555555',
  dimmer:  '#333333',
  text:    '#c0c0c0',
  textM:   '#a0a0a0',
  mono:    'Courier New, monospace',
}

const panel: React.CSSProperties = {
  backgroundColor: S.bgCard,
  borderTop: `2px solid ${S.muted}`, borderLeft: `2px solid ${S.muted}`,
  borderRight: `2px solid ${S.border}`, borderBottom: `2px solid ${S.border}`,
  padding: '14px',
}
const panelGreen: React.CSSProperties = {
  ...panel,
  borderTopColor: S.greenD, borderLeftColor: S.greenD,
  backgroundColor: '#080808',
}
const dim: React.CSSProperties = {
  color: S.muted, fontSize: '10px', letterSpacing: '1px', margin: 0,
}
const label: React.CSSProperties = {
  color: S.muted, fontSize: '9px', letterSpacing: '2px', textTransform: 'uppercase', margin: 0,
}
const retroBtn: React.CSSProperties = {
  background: 'transparent', border: `1px solid ${S.borderA}`, color: S.muted,
  fontSize: '10px', padding: '5px 14px', cursor: 'pointer',
  fontFamily: S.mono, letterSpacing: '1px', whiteSpace: 'nowrap',
}

const DAYS_PT = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
function todayStr() { return new Date().toISOString().slice(0, 10) }

const PLAN_SYSTEM_PROMPT = `Você é um estrategista de crescimento do YouTube especializado no nicho de produtores musicais, beatmakers e venda de beats (Type Beats). Seu objetivo é transformar o canal prodbygrillo em uma máquina de visualizações, inscritos e vendas de beats via BeatStars.

Você domina o algoritmo do YouTube (vídeos longos e Shorts), SEO para música, funis de conversão de ouvintes para compradores, e psicologia do público (rappers, cantores e compositores que buscam beats).

Ao gerar o checklist diário e insights, aplica sempre estes pilares:
1. SEO de Type Beats: tags estratégicas, títulos magnéticos com artista em alta + estilo, descrições otimizadas com links de compra no topo
2. Retenção e Engajamento: como prender o artista nos primeiros 5-10 segundos, drop forte
3. Linha Editorial Diversificada: não só beat estático — bastidores, tutoriais, Shorts, conteúdo que humaniza o canal
4. Funil de Vendas: estratégias para levar o lead do YouTube para o BeatStars ou lista de contatos

Tom: profissional, direto, focado em resultados, inovador.`

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function GoalBar({ label: lbl, current, target, fmt }: { label: string; current: number; target: number; fmt: (n: number) => string }) {
  const pct    = Math.min(100, Math.round((current / target) * 100))
  const color  = pct >= 80 ? S.green : pct >= 40 ? S.yellow : S.greenD
  const filled = Math.round(pct / 5)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ color: S.muted, fontSize: '10px', letterSpacing: '1px' }}>{lbl}</span>
        <span style={{ color, fontSize: '10px' }}>{fmt(current)} / {fmt(target)} · {pct}%</span>
      </div>
      <div style={{ fontSize: '11px', letterSpacing: '-1px', lineHeight: 1 }}>
        <span style={{ color }}>{'█'.repeat(filled)}</span>
        <span style={{ color: S.border }}>{'░'.repeat(20 - filled)}</span>
      </div>
    </div>
  )
}

function CopyBtn({ text, lbl = '[ COPY ]' }: { text: string; lbl?: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500) })}
      style={{
        background: 'transparent',
        border: `1px solid ${ok ? S.green : '#1a3a1a'}`,
        color: ok ? S.green : S.greenD,
        fontSize: '9px', padding: '3px 8px', cursor: 'pointer',
        fontFamily: S.mono, letterSpacing: '0.5px', flexShrink: 0,
      }}
    >
      {ok ? '✓ OK' : lbl}
    </button>
  )
}

// ─── EngineJob pill ───────────────────────────────────────────────────────────
function JobPill({
  icon, name, stat, sub, running, error, onRun, runLabel = '[ RUN ]',
}: {
  icon: string; name: string; stat: string; sub?: string
  running?: boolean; error?: boolean; onRun?: () => void; runLabel?: string
}) {
  const dot = running ? S.yellow : error ? S.red : S.greenD
  return (
    <div style={{
      backgroundColor: S.bgDeep,
      border: `1px solid ${running ? '#2a2000' : error ? '#330000' : S.border}`,
      padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: '6px',
    }}>
      {/* top row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '12px', lineHeight: 1 }}>{icon}</span>
        <span style={{ color: S.muted, fontSize: '9px', letterSpacing: '1.5px', flex: 1 }}>{name}</span>
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: dot, flexShrink: 0, ...(running ? { animation: 'pulse 1s infinite' } : {}) }} />
      </div>
      {/* stat */}
      <p style={{ color: running ? S.yellow : S.text, fontSize: '11px', margin: 0, lineHeight: 1.3 }}>
        {running ? <span style={{ color: S.yellow }}>a correr...</span> : stat}
      </p>
      {sub && <p style={{ color: S.dimmer, fontSize: '9px', margin: 0 }}>{sub}</p>}
      {/* run button */}
      {onRun && (
        <button
          onClick={onRun}
          disabled={running}
          style={{ ...retroBtn, fontSize: '9px', padding: '3px 0', opacity: running ? 0.4 : 1, marginTop: '2px', width: '100%', textAlign: 'center' }}
          onMouseEnter={e => { if (!running) { (e.currentTarget as HTMLElement).style.borderColor = S.greenD; (e.currentTarget as HTMLElement).style.color = S.greenD } }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = S.borderA; (e.currentTarget as HTMLElement).style.color = S.muted }}
        >
          {running ? '...' : runLabel}
        </button>
      )}
    </div>
  )
}

// ─── Plan page ────────────────────────────────────────────────────────────────
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

  const [engagement, setEngagement] = useState<EngagementItem[] | null>(null)
  const [engLoading, setEngLoading] = useState(false)
  const [engError, setEngError]     = useState('')
  const [engDone, setEngDone]       = useState<Record<string, boolean>>({})

  const [autoComStatus, setAutoComStatus] = useState<any>(null)
  const [autoRepStatus, setAutoRepStatus] = useState<any>(null)
  const [autoPlStatus,  setAutoPlStatus]  = useState<any>(null)
  const [autoSeoStatus, setAutoSeoStatus] = useState<any>(null)
  const [comExpanded, setComExpanded]     = useState(false)
  const [repExpanded, setRepExpanded]     = useState(false)
  const [engineExpanded, setEngineExpanded] = useState(false)

  function fmtCountdown(ms: number) {
    if (!ms || ms <= 0) return '—'
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    const d = Math.floor(h / 24)
    if (d > 0) return `${d}d ${h % 24}h`
    return h > 0 ? `${h}h${m.toString().padStart(2, '0')}m` : `${m}m`
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

  useEffect(() => {
    try { const s = localStorage.getItem(`plan_${today}`);       if (s) setPlan(JSON.parse(s)) } catch {}
    try { const s = localStorage.getItem(`engagement_${today}`); if (s) setEngagement(JSON.parse(s)) } catch {}
    try { const s = localStorage.getItem(`eng_done_${today}`);    if (s) setEngDone(JSON.parse(s)) } catch {}
  }, [today])

  function toggleEngDone(id: string) {
    setEngDone(prev => {
      const next = { ...prev, [id]: !prev[id] }
      localStorage.setItem(`eng_done_${today}`, JSON.stringify(next))
      return next
    })
  }


  const fetchEngagement = useCallback(async (bust = false) => {
    if (engLoading) return
    setEngLoading(true); setEngError('')
    try {
      const tRes = await fetch('/api/trending')
      if (!tRes.ok) throw new Error(`trending HTTP ${tRes.status}`)
      const tData = await tRes.json() as Array<{ name: string }>
      const artists: string[] = tData.map(a => a.name).filter(Boolean)
      if (!artists.length) throw new Error('Sem artistas em trending — tenta mais tarde')
      const pool     = bust ? [...artists].sort(() => Math.random() - 0.5) : artists
      const selected = pool.slice(0, 5)
      const avRes = await fetch(`/api/trending/artist-videos?artists=${encodeURIComponent(selected.join(','))}`)
      if (!avRes.ok) throw new Error(`artist-videos HTTP ${avRes.status}`)
      const avData = await avRes.json() as { videos: Array<{ artist: string; videoId: string; title: string; channel: string }> }
      const artistVids = avData.videos.filter(v => v.videoId)
      if (!artistVids.length) throw new Error('Não foi possível encontrar vídeos dos artistas')
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
        videoId: v.videoId, title: v.title, channel: v.channel,
        artist: v.artist, comment: commentMap[v.videoId] ?? '',
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

  const fetchPlan = useCallback(async () => {
    if (loading) return
    setLoading(true); setError('')
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
    const yesterday    = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const yesterdayIds = (() => {
      try { const y = localStorage.getItem(`plan_${yesterday}`); if (!y) return ''; return (JSON.parse(y).checklist as CheckItem[]).map(i => i.id).join(', ') } catch { return '' }
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

Gera os insights estratégicos do dia para o canal. Foca em observações que o produtor NÃO consegue ver sozinho — padrões, oportunidades de nicho, timing de tendências.
Responde APENAS em JSON válido (sem markdown, sem texto antes ou depois):
{
  "dayContext": "1 frase sobre hoje — contexto de mercado, ex: Terça à tarde tem peak de pesquisa de beats trap. Artistas X e Y em alta.",
  "checklist": [],
  "insights": [
    "insight 1 com dado concreto e ação específica",
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
REGRAS: checklist deve ser array vazio [] · insights máximo 3 · português de Portugal · cada insight deve ter um dado concreto e uma ação específica · foca em SEO, trending artists, CTR e timing`
    try {
      const full   = await laisChat(question, 2048, PLAN_SYSTEM_PROMPT)
      const parsed = extractJson(full) as PlanData
      parsed.date = today
      setPlan(parsed)
      localStorage.setItem(`plan_${today}`, JSON.stringify(parsed))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [loading, channelInfo, analyticsData, videos, today])

  useEffect(() => {
    if (!localStorage.getItem(`plan_${today}`))       fetchPlan()
    if (!localStorage.getItem(`engagement_${today}`)) fetchEngagement()
    loadAllEngineStatus()
  }, []) // eslint-disable-line

  const anyRunning = autoComStatus?.running || autoRepStatus?.running || autoPlStatus?.running || autoSeoStatus?.running
  useEffect(() => {
    const iv = setInterval(loadAllEngineStatus, anyRunning ? 3000 : 30000)
    return () => clearInterval(iv)
  }, [anyRunning])

  useEffect(() => {
    const now = new Date()
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const tid = setTimeout(() => {
      setPlan(null); fetchPlan()
      setEngagement(null); setEngDone({}); fetchEngagement()
    }, tomorrow.getTime() - now.getTime())
    return () => clearTimeout(tid)
  }, []) // eslint-disable-line


  const jobPostedIds = new Set<string>(
    (autoComStatus?.todayEntries ?? []).map((e: any) => e.videoId)
  )
  const engDoneCount = (engagement ?? []).filter(
    item => !!engDone[item.videoId] || jobPostedIds.has(item.videoId)
  ).length

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ═══════════════════════════════════════════════════════════════
          HEADER
      ═══════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ color: S.green, fontSize: '11px', letterSpacing: '2px', margin: 0, opacity: 0.8 }}>
          ┌─ PLANO DIÁRIO · LAIS AI ─── {today}
        </p>
        {plan && !loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: S.dimmer, fontSize: '9px', letterSpacing: '1px' }}>atualiza à meia-noite</span>
            <button
              onClick={fetchPlan}
              style={retroBtn}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = S.greenD; (e.currentTarget as HTMLElement).style.color = S.greenD }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = S.borderA; (e.currentTarget as HTMLElement).style.color = S.muted }}
            >
              [ REGENERAR ]
            </button>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          ALGORITHM ENGINE — barra de status compacta
      ═══════════════════════════════════════════════════════════════ */}
      <div style={{ backgroundColor: '#060606', border: `1px solid ${S.border}`, borderTop: `2px solid ${S.greenX}` }}>
        {/* title row */}
        <div style={{ padding: '8px 14px 6px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: `1px solid ${S.border}` }}>
          <span style={{ color: S.greenD, fontSize: '9px', letterSpacing: '2px' }}>⚡ ALGORITHM ENGINE</span>
          {anyRunning && <span style={{ color: S.yellow, fontSize: '9px' }} className="blink">● A CORRER</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ color: S.dimmer, fontSize: '9px' }}>5 jobs activos</span>
            <button
              onClick={() => setEngineExpanded(x => !x)}
              style={{ ...retroBtn, fontSize: '9px', padding: '2px 10px' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = S.greenD; (e.currentTarget as HTMLElement).style.color = S.greenD }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = S.borderA; (e.currentTarget as HTMLElement).style.color = S.muted }}
            >
              {engineExpanded ? '[ ▲ FECHAR ]' : '[ ▼ DETALHES ]'}
            </button>
          </div>
        </div>
        {/* jobs grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1px', backgroundColor: S.border }}>
          {/* SHORTS */}
          <JobPill
            icon="🎬" name="AUTO-SHORTS"
            stat="11 pendentes"
            sub="intervalo · 2h"
          />
          {/* COMMENTS */}
          <JobPill
            icon="💬" name="COMMENTS + LIKES"
            stat={autoComStatus ? `${autoComStatus.todayPosted ?? 0} hoje · ${autoComStatus.totalPosted ?? 0} total` : '—'}
            sub={autoComStatus ? `próx. ${fmtCountdown(autoComStatus.msUntilNext)}` : '00·13·17·21 UTC'}
            running={autoComStatus?.running}
            error={autoComStatus?.lastResult?.status === 'error'}
            onRun={runComNow}
          />
          {/* REPLIES */}
          <JobPill
            icon="🔁" name="AUTO-REPLIES"
            stat={autoRepStatus ? `${autoRepStatus.todayReplied ?? 0} hoje · ${autoRepStatus.totalReplied ?? 0} total` : '—'}
            sub={autoRepStatus ? `próx. ${fmtCountdown(autoRepStatus.msUntilNext)}` : 'intervalo · 2h'}
            running={autoRepStatus?.running}
            error={autoRepStatus?.lastResult?.status === 'error'}
            onRun={runRepNow}
          />
          {/* PLAYLISTS */}
          <JobPill
            icon="📂" name="AUTO-PLAYLISTS"
            stat={autoPlStatus ? `${autoPlStatus.playlistCount ?? 0} playlists` : '—'}
            sub={autoPlStatus?.playlists ? Object.keys(autoPlStatus.playlists).slice(0, 3).join(' · ') + (Object.keys(autoPlStatus.playlists).length > 3 ? '...' : '') : 'scan no arranque'}
            running={autoPlStatus?.running}
            error={autoPlStatus?.lastResult?.status === 'error'}
            onRun={runPlNow}
            runLabel="[ SCAN ]"
          />
          {/* SEO */}
          <JobPill
            icon="🔍" name="AUTO-SEO"
            stat={autoSeoStatus ? `${autoSeoStatus.totalUpdated ?? 0} vídeos` : '—'}
            sub={autoSeoStatus ? (autoSeoStatus.lastRun ? `run: ${new Date(autoSeoStatus.lastRun).toLocaleDateString('pt-BR')}` : `próx. ${fmtCountdown(autoSeoStatus.msUntilNext)}`) : 'semanal'}
            running={autoSeoStatus?.running}
            error={autoSeoStatus?.lastResult?.status === 'error'}
            onRun={runSeoNow}
          />
        </div>
        {/* first-hour burst note */}
        <div style={{ padding: '5px 14px', borderTop: `1px solid ${S.border}` }}>
          <span style={{ color: S.dimmer, fontSize: '9px', letterSpacing: '0.5px' }}>
            🚀 FIRST-HOUR BURST — 5min após cada upload: comment AI + trending comments + replies + auto-playlist
          </span>
        </div>

        {/* ── DETALHES expandidos ── */}
        {engineExpanded && (
          <div style={{ borderTop: `1px solid ${S.border}`, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

            {/* COMMENTS — hoje */}
            <div>
              <p style={{ ...label, marginBottom: '6px', color: S.greenD }}>💬 AUTO-COMMENTS · hoje</p>
              {autoComStatus?.todayEntries?.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {autoComStatus.todayEntries.map((e: any) => {
                    const link = e.commentId
                      ? `https://www.youtube.com/watch?v=${e.videoId}&lc=${e.commentId}`
                      : `https://www.youtube.com/watch?v=${e.videoId}`
                    return (
                      <div key={e.videoId} style={{ display: 'flex', gap: '8px', alignItems: 'baseline', padding: '4px 8px', backgroundColor: S.bgDeep }}>
                        <span style={{ color: S.greenD, fontSize: '9px', flexShrink: 0 }}>✓</span>
                        <span style={{ color: S.muted, fontSize: '9px', flexShrink: 0, minWidth: '90px' }}>{e.artist}</span>
                        <span style={{ color: S.dimmer, fontSize: '9px', fontStyle: 'italic', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>"{e.comment}"</span>
                        <a href={link} target="_blank" rel="noopener noreferrer"
                          style={{ color: '#2a4a6a', fontSize: '9px', textDecoration: 'none', flexShrink: 0 }}
                          onMouseEnter={e2 => { (e2.currentTarget as HTMLElement).style.color = S.blue }}
                          onMouseLeave={e2 => { (e2.currentTarget as HTMLElement).style.color = '#2a4a6a' }}>
                          [ VER ]
                        </a>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p style={{ color: S.dimmer, fontSize: '10px', margin: 0 }}>Sem comentários hoje ainda.</p>
              )}
            </div>

            {/* REPLIES — última run */}
            <div>
              <p style={{ ...label, marginBottom: '6px', color: S.greenD }}>🔁 AUTO-REPLIES · última run</p>
              {autoRepStatus?.lastResult?.results?.filter((r: any) => r.ok).length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {autoRepStatus.lastResult.results.filter((r: any) => r.ok).map((r: any, i: number) => (
                    <div key={i} style={{ padding: '5px 8px', backgroundColor: S.bgDeep, display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                      <span style={{ color: S.greenD, fontSize: '9px', flexShrink: 0, marginTop: '1px' }}>✓</span>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ color: S.dimmer, fontSize: '9px', margin: '0 0 2px', fontStyle: 'italic' }}>
                          {r.author}: "{r.originalComment?.slice(0, 60)}{(r.originalComment?.length ?? 0) > 60 ? '…' : ''}"
                        </p>
                        <p style={{ color: S.greenD, fontSize: '10px', margin: 0 }}>↳ {r.reply}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: S.dimmer, fontSize: '10px', margin: 0 }}>
                  {autoRepStatus?.lastResult?.message ?? 'Sem respostas na última run.'}
                </p>
              )}
            </div>

            {/* PLAYLISTS */}
            <div>
              <p style={{ ...label, marginBottom: '6px', color: S.greenD }}>📂 AUTO-PLAYLISTS · estado</p>
              {autoPlStatus?.playlists && Object.keys(autoPlStatus.playlists).length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {Object.entries(autoPlStatus.playlists).map(([style, pid]: [string, any]) => (
                    <a key={style}
                      href={`https://www.youtube.com/playlist?list=${pid}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ color: S.blue, fontSize: '9px', border: `1px solid #1a2030`, padding: '3px 8px', textDecoration: 'none' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#88bbdd' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = S.blue }}>
                      {style} ↗
                    </a>
                  ))}
                </div>
              ) : (
                <p style={{ color: S.dimmer, fontSize: '10px', margin: 0 }}>Nenhuma playlist criada ainda.</p>
              )}
              {autoPlStatus?.lastResult?.status === 'done' && (
                <p style={{ color: S.dimmer, fontSize: '9px', margin: '5px 0 0' }}>
                  última scan: {autoPlStatus.lastResult.videosOrganised} vídeos organizados
                </p>
              )}
            </div>

            {/* SEO */}
            <div>
              <p style={{ ...label, marginBottom: '6px', color: S.greenD }}>🔍 AUTO-SEO · última run</p>
              {autoSeoStatus?.lastResult?.status === 'done' ? (
                <div>
                  <p style={{ color: S.text, fontSize: '10px', margin: '0 0 5px' }}>
                    ✓ {autoSeoStatus.lastResult.updated}/{autoSeoStatus.lastResult.total} vídeos atualizados
                  </p>
                  {autoSeoStatus.trendingUsed?.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {autoSeoStatus.trendingUsed.map((a: string) => (
                        <span key={a} style={{ color: S.greenD, fontSize: '9px', border: `1px solid ${S.greenX}`, padding: '2px 6px' }}>{a}</span>
                      ))}
                    </div>
                  )}
                </div>
              ) : autoSeoStatus?.lastResult?.status === 'error' ? (
                <p style={{ color: S.red, fontSize: '10px', margin: 0 }}>ERRO: {autoSeoStatus.lastResult.error}</p>
              ) : (
                <p style={{ color: S.dimmer, fontSize: '10px', margin: 0 }}>
                  {autoSeoStatus?.lastRun ? `Última run: ${new Date(autoSeoStatus.lastRun).toLocaleDateString('pt-BR')}` : 'Ainda não correu.'}
                </p>
              )}
            </div>

          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          PLAN — loading / error / content
      ═══════════════════════════════════════════════════════════════ */}

      {loading && (
        <div style={{ ...panel, textAlign: 'center', padding: '40px 20px' }}>
          <p style={{ color: S.green, fontSize: '12px', margin: '0 0 8px', letterSpacing: '1px' }}>A GERAR PLANO DO DIA_</p>
          <p style={{ color: S.dimmer, fontSize: '11px', margin: 0 }}>{'█'.repeat(14)}<span className="blink">█</span></p>
          <p style={{ color: '#2a2a2a', fontSize: '10px', margin: '12px 0 0', letterSpacing: '1px' }}>LAIS a analisar dados reais do canal...</p>
        </div>
      )}

      {error && !loading && (
        <div style={{ ...panel, borderTopColor: '#550000', borderLeftColor: '#550000' }}>
          <p style={{ color: S.red, fontSize: '11px', margin: '0 0 10px' }}>ERRO: {error}</p>
          <button onClick={fetchPlan} style={{ ...retroBtn, borderColor: '#550000', color: S.red }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = S.red }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#550000' }}>
            [ TENTAR NOVAMENTE ]
          </button>
        </div>
      )}

      {plan && !loading && (
        <>
          {/* ── Upload alert + canal stats ── */}
          {(() => {
            const sorted     = [...(videos ?? [])].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
            const lastVideo  = sorted[0]
            const daysSince  = lastVideo ? Math.floor((Date.now() - new Date(lastVideo.publishedAt).getTime()) / 86400000) : null

            const recent7  = (analyticsData ?? []).slice(-7)
            const prev7    = (analyticsData ?? []).slice(-14, -7)
            const views7   = recent7.reduce((s, r) => s + r.views, 0)
            const viewsPrev= prev7.reduce((s, r) => s + r.views, 0)
            const viewsDelta = viewsPrev > 0 ? Math.round(((views7 - viewsPrev) / viewsPrev) * 100) : null
            const subs7    = recent7.reduce((s, r) => s + r.subscribers, 0)
            const avgCtr   = recent7.length ? (recent7.reduce((s, r) => s + r.ctr, 0) / recent7.length) : 0

            // pick the most actionable insight automatically
            let alertMsg = '', alertColor = S.greenD
            if (avgCtr < 2 && avgCtr > 0) {
              alertMsg = `CTR médio ${avgCtr.toFixed(1)}% — abaixo de 2%. Testa nova thumbnail.`
              alertColor = S.yellow
            } else if (viewsDelta !== null && viewsDelta < -20) {
              alertMsg = `Views caíram ${Math.abs(viewsDelta)}% esta semana vs anterior. Analisa retenção.`
              alertColor = S.yellow
            } else if (subs7 === 0 && views7 > 0) {
              alertMsg = `0 subs esta semana com ${views7.toLocaleString()} views. Verifica CTA e descrição.`
              alertColor = S.yellow
            } else if (viewsDelta !== null && viewsDelta > 20) {
              alertMsg = `Views +${viewsDelta}% esta semana. Replica o formato do último vídeo.`
              alertColor = S.green
            } else if (avgCtr >= 4) {
              alertMsg = `CTR ${avgCtr.toFixed(1)}% — excelente. Mantém este estilo de thumbnail.`
              alertColor = S.green
            } else {
              alertMsg = `${views7.toLocaleString()} views · +${subs7} subs · CTR ${avgCtr.toFixed(1)}% esta semana.`
              alertColor = S.textM
            }

            // urgency for upload
            const uploadColor = daysSince === null ? S.muted
              : daysSince <= 3 ? S.greenD
              : daysSince <= 7 ? S.yellow
              : S.red
            const uploadBg = daysSince !== null && daysSince > 7 ? '#0a0000' : S.bgCard

            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

                {/* upload alert */}
                <div style={{ ...panel, backgroundColor: uploadBg, borderTopColor: uploadColor, borderLeftColor: uploadColor, padding: '12px 14px' }}>
                  <p style={{ ...label, color: uploadColor, marginBottom: '8px' }}>📅 último upload</p>
                  {daysSince !== null ? (
                    <>
                      <p style={{ color: uploadColor, fontSize: '28px', fontWeight: 'bold', margin: '0 0 4px', lineHeight: 1 }}>
                        {daysSince}
                        <span style={{ fontSize: '11px', fontWeight: 'normal', marginLeft: '6px', color: S.muted }}>dias atrás</span>
                      </p>
                      <p style={{ color: S.dimmer, fontSize: '10px', margin: '0 0 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {lastVideo?.title?.slice(0, 48) ?? '—'}
                      </p>
                      {daysSince > 5 && (
                        <button
                          onClick={() => onNavigate('scheduler')}
                          style={{ background: daysSince > 7 ? S.red : S.yellow, color: '#000', border: 'none', padding: '6px 14px', cursor: 'pointer', fontFamily: S.mono, fontSize: '10px', fontWeight: 'bold', letterSpacing: '1px' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.85' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
                        >
                          {daysSince > 7 ? '[ ⚠ FAZER UPLOAD AGORA ]' : '[ PLANEAR UPLOAD ]'}
                        </button>
                      )}
                    </>
                  ) : (
                    <p style={{ color: S.dimmer, fontSize: '11px', margin: 0 }}>Sem dados de vídeos.</p>
                  )}
                </div>

                {/* canal insight */}
                <div style={{ ...panel, padding: '12px 14px' }}>
                  <p style={{ ...label, marginBottom: '8px' }}>📊 canal · esta semana</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                    {[
                      { lbl: 'VIEWS', val: views7.toLocaleString(), delta: viewsDelta },
                      { lbl: 'SUBS', val: `+${subs7}`, delta: null },
                      { lbl: 'CTR', val: `${avgCtr.toFixed(1)}%`, delta: null },
                    ].map(({ lbl: l, val, delta }) => (
                      <div key={l} style={{ backgroundColor: S.bgDeep, border: `1px solid ${S.border}`, padding: '6px 8px', textAlign: 'center' }}>
                        <p style={{ ...label, margin: '0 0 2px' }}>{l}</p>
                        <p style={{ color: S.text, fontSize: '13px', margin: 0, fontWeight: 'bold' }}>{val}</p>
                        {delta !== null && (
                          <p style={{ color: delta >= 0 ? S.greenD : S.red, fontSize: '9px', margin: '2px 0 0' }}>
                            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: '7px 10px', backgroundColor: S.bgDeep, border: `1px solid ${alertColor === S.green ? '#1a3a1a' : alertColor === S.yellow ? '#2a2000' : alertColor === S.red ? '#2a0000' : S.border}` }}>
                    <p style={{ color: alertColor, fontSize: '10px', margin: 0, lineHeight: 1.5 }}>▸ {alertMsg}</p>
                  </div>
                </div>

              </div>
            )
          })()}

          {/* insights + YPP — 2 colunas */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'start' }}>

            <div style={panel}>
              <p style={{ ...label, marginBottom: '10px' }}>📊 insights · lais</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {plan.insights.map((ins, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <span style={{ color: S.green, fontSize: '10px', flexShrink: 0, marginTop: '2px' }}>▸</span>
                    <p style={{ color: S.textM, fontSize: '11px', margin: 0, lineHeight: 1.5 }}>{ins}</p>
                  </div>
                ))}
              </div>
            </div>

            <div style={panel}>
              <p style={{ ...label, marginBottom: '12px' }}>🎯 meta ypp</p>
              <GoalBar label="SUBSCRIBERS" current={plan.weeklyGoal.subsProgress} target={plan.weeklyGoal.subsTarget} fmt={n => n.toLocaleString()} />
              <div style={{ height: '10px' }} />
              <GoalBar label="WATCH TIME" current={plan.weeklyGoal.watchMinutes} target={plan.weeklyGoal.watchTarget} fmt={n => `${Math.round(n / 60).toLocaleString()}h`} />
              <p style={{ color: '#2a2a2a', fontSize: '9px', margin: '10px 0 0', letterSpacing: '1px' }}>1.000 SUBS + 4.000H</p>
            </div>

          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          ENGAGEMENT + REPLIES — 2 colunas
      ═══════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '12px', alignItems: 'start' }}>

        {/* ── FILA DE ENGAJAMENTO ────────────────────────────── */}
        <div style={panel}>
          {/* header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div>
              <p style={{ ...label, margin: '0 0 5px' }}>💬 fila de engajamento · vídeos em alta</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: engDoneCount >= 5 ? S.green : S.text, fontSize: '12px', fontWeight: 'bold' }}>
                  {engDoneCount}/5
                </span>
                <div style={{ fontSize: '10px', letterSpacing: '-1px' }}>
                  <span style={{ color: engDoneCount >= 5 ? S.green : S.greenD }}>{'█'.repeat(engDoneCount)}</span>
                  <span style={{ color: S.border }}>{'░'.repeat(Math.max(0, 5 - engDoneCount))}</span>
                </div>
                <span style={{ color: S.muted, fontSize: '9px' }}>comentários feitos</span>
              </div>
            </div>
            <button
              onClick={() => fetchEngagement(true)}
              disabled={engLoading}
              style={{ ...retroBtn, opacity: engLoading ? 0.4 : 1 }}
              onMouseEnter={e => { if (!engLoading) { (e.currentTarget as HTMLElement).style.borderColor = S.greenD; (e.currentTarget as HTMLElement).style.color = S.greenD } }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = S.borderA; (e.currentTarget as HTMLElement).style.color = S.muted }}
            >
              {engLoading ? '[ A GERAR... ]' : '[ 5 NOVOS ]'}
            </button>
          </div>

          {/* auto-job mini status */}
          {autoComStatus && (
            <div style={{ padding: '6px 10px', backgroundColor: '#050505', border: `1px solid #1a2a1a`, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ color: '#2a4a2a', fontSize: '9px', letterSpacing: '1px' }}>● JOB · 4×/DIA</span>
              <span style={{ color: autoComStatus.running ? S.yellow : S.greenD, fontSize: '10px' }}>
                {autoComStatus.running ? <span className="blink">a comentar...</span> : `✓ ${autoComStatus.todayPosted ?? 0} hoje · ${autoComStatus.totalPosted ?? 0} total`}
              </span>
              {!autoComStatus.running && (
                <span style={{ color: S.dimmer, fontSize: '9px' }}>próx. {fmtCountdown(autoComStatus.msUntilNext)}</span>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                {(autoComStatus.todayEntries?.length > 0) && (
                  <button onClick={() => setComExpanded(x => !x)}
                    style={{ ...retroBtn, fontSize: '9px', padding: '2px 8px' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#888' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = S.muted }}>
                    {comExpanded ? '▲' : '▼'}
                  </button>
                )}
                <button onClick={runComNow} disabled={autoComStatus.running}
                  style={{ ...retroBtn, fontSize: '9px', padding: '2px 8px', opacity: autoComStatus.running ? 0.4 : 1 }}
                  onMouseEnter={e => { if (!autoComStatus.running) { (e.currentTarget as HTMLElement).style.borderColor = S.greenD; (e.currentTarget as HTMLElement).style.color = S.greenD } }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = S.borderA; (e.currentTarget as HTMLElement).style.color = S.muted }}>
                  [ RUN ]
                </button>
              </div>
            </div>
          )}

          {/* expanded job entries */}
          {comExpanded && autoComStatus?.todayEntries?.length > 0 && (
            <div style={{ backgroundColor: '#050505', border: `1px solid #111`, padding: '8px', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {autoComStatus.todayEntries.map((e: any) => {
                const link = e.commentId
                  ? `https://www.youtube.com/watch?v=${e.videoId}&lc=${e.commentId}`
                  : `https://www.youtube.com/watch?v=${e.videoId}`
                return (
                  <div key={e.videoId} style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                    <span style={{ color: S.greenD, fontSize: '9px', flexShrink: 0 }}>✓</span>
                    <span style={{ color: S.muted, fontSize: '9px', flexShrink: 0 }}>{e.artist}</span>
                    <span style={{ color: S.dimmer, fontSize: '9px', fontStyle: 'italic', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>"{e.comment}"</span>
                    <a href={link} target="_blank" rel="noopener noreferrer"
                      style={{ color: '#2a4a6a', fontSize: '9px', textDecoration: 'none', flexShrink: 0 }}
                      onMouseEnter={e2 => { (e2.currentTarget as HTMLElement).style.color = S.blue }}
                      onMouseLeave={e2 => { (e2.currentTarget as HTMLElement).style.color = '#2a4a6a' }}>
                      ↗
                    </a>
                  </div>
                )
              })}
            </div>
          )}

          {/* loading state */}
          {engLoading && !engagement && (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <p style={{ color: S.dimmer, fontSize: '11px', margin: 0 }}>{'█'.repeat(10)}<span className="blink">█</span></p>
              <p style={{ color: '#2a2a2a', fontSize: '10px', margin: '8px 0 0', letterSpacing: '1px' }}>LAIS a selecionar vídeos via trending...</p>
            </div>
          )}

          {/* error */}
          {engError && !engLoading && (
            <div style={{ padding: '8px 10px', backgroundColor: '#0a0000', border: `1px solid #330000`, marginBottom: '8px' }}>
              <p style={{ color: S.red, fontSize: '10px', margin: 0 }}>ERRO: {engError}</p>
            </div>
          )}

          {/* empty state */}
          {!engagement && !engLoading && (
            <div style={{ padding: '16px', backgroundColor: S.bgDeep, border: `1px solid ${S.border}`, textAlign: 'center' }}>
              <p style={{ color: S.dimmer, fontSize: '11px', margin: '0 0 8px' }}>Sem vídeos — clica para gerar via trending.</p>
              <button onClick={() => fetchEngagement(false)} style={retroBtn}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = S.greenD; (e.currentTarget as HTMLElement).style.color = S.greenD }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = S.borderA; (e.currentTarget as HTMLElement).style.color = S.muted }}>
                [ GERAR FILA ]
              </button>
            </div>
          )}

          {/* items */}
          {engagement && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {engagement.map((item, idx) => {
                const jobDone    = jobPostedIds.has(item.videoId)
                const manualDone = !!engDone[item.videoId]
                const done       = manualDone || jobDone
                return (
                  <div key={item.videoId} style={{ padding: '10px 12px', backgroundColor: done ? '#0a1a0a' : S.bgDeep, border: `1px solid ${done ? '#1a3a1a' : S.border}`, opacity: done ? 0.5 : 1, transition: 'all 0.2s' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                      <span style={{ color: S.muted, fontSize: '10px', flexShrink: 0 }}>{idx + 1}.</span>
                      <p style={{ color: done ? S.dimmer : S.text, fontSize: '11px', margin: 0, textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {item.title}
                      </p>
                      {jobDone && <span style={{ color: '#1a4a1a', fontSize: '9px', border: `1px solid #1a3a1a`, padding: '1px 5px', flexShrink: 0 }}>JOB ✓</span>}
                    </div>
                    <p style={{ color: S.muted, fontSize: '10px', margin: '0 0 6px' }}>
                      <span style={{ color: S.greenD }}>{item.artist}</span>{item.channel ? ` · ${item.channel}` : ''}
                    </p>
                    {item.comment && (
                      <div style={{ backgroundColor: '#050505', border: `1px solid #1a2030`, padding: '7px 10px', marginBottom: '7px', display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
                        <p style={{ color: S.textM, fontSize: '11px', margin: 0, lineHeight: 1.5, fontStyle: 'italic', flex: 1 }}>
                          "{item.comment}"
                        </p>
                        <CopyBtn text={item.comment} />
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <a href={`https://www.youtube.com/watch?v=${item.videoId}`} target="_blank" rel="noopener noreferrer"
                        style={{ background: 'transparent', border: `1px solid #1a2030`, color: S.blue, fontSize: '9px', padding: '3px 8px', fontFamily: S.mono, textDecoration: 'none', flexShrink: 0 }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#88bbdd' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = S.blue }}>
                        [ VER VÍDEO ]
                      </a>
                      {jobDone ? (
                        <span style={{ color: '#1a4a1a', fontSize: '9px', padding: '3px 8px', border: `1px solid #1a3a1a` }}>
                          ✓ JOB POSTOU
                        </span>
                      ) : (
                        <button
                          onClick={() => toggleEngDone(item.videoId)}
                          style={{ background: manualDone ? '#0a1a0a' : 'transparent', border: `1px solid ${manualDone ? S.green : S.border}`, color: manualDone ? S.green : S.dimmer, fontSize: '9px', padding: '3px 8px', cursor: 'pointer', fontFamily: S.mono, flexShrink: 0 }}
                          onMouseEnter={e => { if (!manualDone) { (e.currentTarget as HTMLElement).style.borderColor = S.greenD; (e.currentTarget as HTMLElement).style.color = S.greenD } }}
                          onMouseLeave={e => { if (!manualDone) { (e.currentTarget as HTMLElement).style.borderColor = S.border; (e.currentTarget as HTMLElement).style.color = S.dimmer } }}
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

        {/* ── AUTO-REPLIES ───────────────────────────────────── */}
        <div style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
            <div>
              <p style={{ ...label, margin: '0 0 5px' }}>🔁 auto-replies · teus vídeos</p>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ color: autoRepStatus?.running ? S.yellow : S.greenD, fontSize: '9px' }}>
                  {autoRepStatus?.running ? <span className="blink">● a responder</span> : '● job · 2h'}
                </span>
                {autoRepStatus && !autoRepStatus.running && (
                  <span style={{ color: S.dimmer, fontSize: '9px' }}>próx. {fmtCountdown(autoRepStatus.msUntilNext)}</span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
              {autoRepStatus?.lastResult?.results?.length > 0 && (
                <button onClick={() => setRepExpanded(x => !x)}
                  style={{ ...retroBtn, fontSize: '9px', padding: '3px 8px' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#888' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = S.muted }}>
                  {repExpanded ? '▲' : '▼'}
                </button>
              )}
              <button onClick={runRepNow} disabled={autoRepStatus?.running}
                style={{ ...retroBtn, opacity: autoRepStatus?.running ? 0.4 : 1 }}
                onMouseEnter={e => { if (!autoRepStatus?.running) { (e.currentTarget as HTMLElement).style.borderColor = S.greenD; (e.currentTarget as HTMLElement).style.color = S.greenD } }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = S.borderA; (e.currentTarget as HTMLElement).style.color = S.muted }}>
                {autoRepStatus?.running ? '[ ... ]' : '[ RUN ]'}
              </button>
            </div>
          </div>

          {/* stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
            {[
              { lbl: 'HOJE', val: autoRepStatus?.todayReplied ?? '—' },
              { lbl: 'TOTAL', val: autoRepStatus?.totalReplied ?? '—' },
            ].map(({ lbl: l, val }) => (
              <div key={l} style={{ backgroundColor: S.bgDeep, border: `1px solid ${S.border}`, padding: '8px 10px', textAlign: 'center' }}>
                <p style={{ ...label, margin: '0 0 3px' }}>{l}</p>
                <p style={{ color: S.text, fontSize: '16px', margin: 0, fontWeight: 'bold' }}>{val}</p>
              </div>
            ))}
          </div>

          {/* last run summary */}
          {autoRepStatus?.lastResult?.status === 'done' && (
            <div style={{ padding: '6px 8px', backgroundColor: '#050505', border: `1px solid #1a2a1a`, marginBottom: '8px' }}>
              <p style={{ color: '#1a4a1a', fontSize: '10px', margin: 0 }}>
                ✓ última run: {autoRepStatus.lastResult.replied}/{autoRepStatus.lastResult.total} respostas
              </p>
            </div>
          )}
          {autoRepStatus?.lastResult?.status === 'error' && (
            <div style={{ padding: '6px 8px', backgroundColor: '#0a0000', border: `1px solid #330000`, marginBottom: '8px' }}>
              <p style={{ color: S.red, fontSize: '10px', margin: 0 }}>ERRO: {autoRepStatus.lastResult.error}</p>
            </div>
          )}
          {autoRepStatus?.lastResult?.message && !autoRepStatus?.lastResult?.status?.startsWith('') && (
            <p style={{ color: S.dimmer, fontSize: '9px', margin: '0 0 8px' }}>{autoRepStatus.lastResult.message}</p>
          )}

          {/* expanded replies */}
          {repExpanded && autoRepStatus?.lastResult?.results?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {autoRepStatus.lastResult.results.filter((r: any) => r.ok).map((r: any, i: number) => (
                <div key={i} style={{ padding: '8px 10px', backgroundColor: S.bgDeep, border: `1px solid ${S.border}` }}>
                  <p style={{ color: S.dimmer, fontSize: '9px', margin: '0 0 4px', fontStyle: 'italic' }}>
                    {r.author}: "{r.originalComment?.slice(0, 70)}{(r.originalComment?.length ?? 0) > 70 ? '…' : ''}"
                  </p>
                  <p style={{ color: S.greenD, fontSize: '10px', margin: 0 }}>↳ {r.reply}</p>
                </div>
              ))}
            </div>
          )}

          {/* no status yet */}
          {!autoRepStatus && (
            <p style={{ color: S.dimmer, fontSize: '10px', margin: 0 }}>A carregar...</p>
          )}
        </div>

      </div>

    </div>
  )
}

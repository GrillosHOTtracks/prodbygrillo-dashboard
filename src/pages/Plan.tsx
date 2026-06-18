import { useState, useEffect, useCallback, useRef } from 'react'
import type { Page } from '../types'
import type { DailyRow, ChannelInfo, Video as ApiVideo } from '../lib/api'
import { useToast } from '../components/ui/Toast'

// ─── Types ────────────────────────────────────────────────────────────────────
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
  const toast = useToast()
  const [plan, setPlan]       = useState<PlanData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const [autoShStatus,  setAutoShStatus]  = useState<any>(null)
  const [autoComStatus, setAutoComStatus] = useState<any>(null)
  const [autoRepStatus, setAutoRepStatus] = useState<any>(null)
  const [autoPlStatus,  setAutoPlStatus]  = useState<any>(null)
  const [autoSeoStatus, setAutoSeoStatus] = useState<any>(null)
  const [autoTtStatus,  setAutoTtStatus]  = useState<any>(null)
  const [ttRepStatus,   setTtRepStatus]   = useState<any>(null)
  const [ttUser,        setTtUser]        = useState<string | null>(null)
  const [ttRunMode,     setTtRunMode]     = useState<'immediate'|'scheduled'|'draft'>('immediate')
  const [ttRunSched,    setTtRunSched]    = useState('')   // datetime-local string
  const [ttVideos,      setTtVideos]      = useState<any[] | null>(null)
  const [ttVidsLoading, setTtVidsLoading] = useState(false)
  const [ttDeleting,    setTtDeleting]    = useState<string | null>(null)
  const [repExpanded, setRepExpanded]     = useState(false)
  const [engineExpanded, setEngineExpanded] = useState(false)
  const [acctStatus, setAcctStatus]       = useState<any>(null)

  function fmtCountdown(ms: number) {
    if (!ms || ms <= 0) return '—'
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    const d = Math.floor(h / 24)
    if (d > 0) return `${d}d ${h % 24}h`
    return h > 0 ? `${h}h${m.toString().padStart(2, '0')}m` : `${m}m`
  }

  function loadAcctStatus() {
    fetch('/api/accounts/status').then(r => r.ok ? r.json() : null).then(d => { if (d) setAcctStatus(d) }).catch(() => {})
  }


  function loadAllEngineStatus() {
    loadAcctStatus()
    const apis = [
      ['/api/upload/auto-shorts/status', setAutoShStatus],
      ['/api/plan/comments-status',      setAutoComStatus],
      ['/api/plan/replies-status',       setAutoRepStatus],
      ['/api/plan/playlists-status',     setAutoPlStatus],
      ['/api/plan/seo-status',           setAutoSeoStatus],
      ['/api/tiktok/auto-status',        setAutoTtStatus],
      ['/api/tiktok/replies-status',     setTtRepStatus],
    ] as const
    apis.forEach(([url, setter]) => {
      fetch(url).then(r => r.ok ? r.json() : null).then(d => { if (d) setter(d) }).catch(() => {})
    })
  }

  function loadAutoShStatus()  { fetch('/api/upload/auto-shorts/status').then(r => r.ok ? r.json() : null).then(d => { if (d) setAutoShStatus(d) }).catch(() => {}) }
  function loadAutoComStatus() { fetch('/api/plan/comments-status').then(r => r.ok ? r.json() : null).then(d => { if (d) setAutoComStatus(d) }).catch(() => {}) }
  function loadAutoRepStatus() { fetch('/api/plan/replies-status').then(r => r.ok ? r.json() : null).then(d => { if (d) setAutoRepStatus(d) }).catch(() => {}) }

  function runShNow() {
    setAutoShStatus((s: any) => s ? { ...s, running: true } : s)
    fetch('/api/upload/auto-shorts/run-now', { method: 'POST' }).then(() => setTimeout(loadAutoShStatus, 2000)).catch(() => {})
    toast('AUTO-SHORTS iniciado')
  }
  function runComNow() {
    setAutoComStatus((s: any) => s ? { ...s, running: true } : s)
    fetch('/api/plan/run-comments', { method: 'POST' }).then(() => setTimeout(loadAutoComStatus, 1500)).catch(() => {})
    toast('AUTO-COMMENTS iniciado')
  }
  function runRepNow() {
    setAutoRepStatus((s: any) => s ? { ...s, running: true } : s)
    fetch('/api/plan/run-replies', { method: 'POST' }).then(() => setTimeout(loadAutoRepStatus, 1500)).catch(() => {})
    toast('AUTO-REPLIES iniciado')
  }
  function runPlNow() {
    setAutoPlStatus((s: any) => s ? { ...s, running: true } : s)
    fetch('/api/plan/run-playlists', { method: 'POST' }).then(() => setTimeout(() => fetch('/api/plan/playlists-status').then(r => r.json()).then(setAutoPlStatus), 2000)).catch(() => {})
    toast('AUTO-PLAYLISTS a fazer scan...')
  }
  function runSeoNow() {
    setAutoSeoStatus((s: any) => s ? { ...s, running: true } : s)
    fetch('/api/plan/run-seo', { method: 'POST' }).then(() => setTimeout(() => fetch('/api/plan/seo-status').then(r => r.json()).then(setAutoSeoStatus), 2000)).catch(() => {})
    toast('AUTO-SEO iniciado')
  }
  async function loadTtVideos() {
    setTtVidsLoading(true)
    try {
      const r = await fetch('/api/tiktok/videos')
      if (r.ok) setTtVideos(await r.json())
    } catch {}
    setTtVidsLoading(false)
  }
  async function deleteTtVideo(id: string) {
    setTtDeleting(id)
    try {
      const r = await fetch(`/api/tiktok/videos/${id}`, { method: 'DELETE' })
      if (r.ok) {
        setTtVideos(v => v ? v.filter(x => x.id !== id) : v)
        toast('Vídeo TikTok apagado')
      } else {
        const d = await r.json()
        toast(`Erro: ${d.error}`)
      }
    } catch { toast('Erro ao apagar') }
    setTtDeleting(null)
  }

  function runTtNow() {
    if (ttRunMode === 'scheduled' && !ttRunSched) { toast('Define a data/hora primeiro'); return }
    setAutoTtStatus((s: any) => s ? { ...s, running: true } : s)
    const body: any = {}
    if (ttRunMode === 'draft') body.isDraft = true
    if (ttRunMode === 'scheduled' && ttRunSched) body.scheduledTime = Math.floor(new Date(ttRunSched).getTime() / 1000)
    fetch('/api/tiktok/auto-run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(() => setTimeout(() => fetch('/api/tiktok/auto-status').then(r => r.json()).then(setAutoTtStatus), 2000))
      .catch(() => {})
    toast('AUTO-TIKTOK iniciado')
  }
  function runTtRepliesNow() {
    setTtRepStatus((s: any) => s ? { ...s, running: true } : s)
    fetch('/api/tiktok/run-replies', { method: 'POST' }).then(() => setTimeout(() => fetch('/api/tiktok/replies-status').then(r => r.json()).then(setTtRepStatus), 3000)).catch(() => {})
    toast('TikTok replies iniciado')
  }

  const today = todayStr()

  useEffect(() => {
    try { const s = localStorage.getItem(`plan_${today}`); if (s) setPlan(JSON.parse(s)) } catch {}
  }, [today])

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
    const topByViews = [...(videos ?? [])]
      .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
      .slice(0, 15)
    const topVideosBlock = topByViews.length
      ? '\n\nTOP VÍDEOS DO CANAL (por views — usa para inferir quais artistas e géneros convertem melhor):\n' +
        topByViews.map((v, i) => {
          const artist = (v.title ?? '').match(/\[FREE\]\s+(.+?)\s+Type Beat/i)?.[1] ?? '?'
          return `${i + 1}. "${(v.title ?? '').slice(0, 60)}" · ${(v.views ?? 0).toLocaleString()} views · CTR ${v.ctr?.toFixed(1) ?? '?'}% · ${(v.publishedAt ?? '').slice(0, 10)} · artista inferido: ${artist}`
        }).join('\n')
      : ''

    const question = `És a LAIS — estrategista de crescimento para canais de beats no YouTube, treinada nas metodologias de Sean Cannell (Think Media), Paddy Galloway e Nick Nimmin.

ESTADO REAL DO CANAL "${channelName}" — ${dayOfWeek}, ${dateStr}:
- Subscribers: ${subs.toLocaleString()} / 1.000 (meta YPP)
- Vídeos publicados: ${totalVideos} · Dias sem upload: ${daysSinceUpload ?? '?'}
- CTR médio (7d): ${avgCtr}% · Views (7d): ${totalViews7.toLocaleString()} · Subs ganhos (7d): +${subGain7}
- Watch time acumulado: ${Math.round(allWatchMin / 60)}h / 4.000h (meta YPP)
- Último vídeo: "${lastVideoTitle}" · há ${lastDaysAgo} dias · ${lastVideoViews.toLocaleString()} views · CTR ${lastVideoCtr}%
- Semente de variação: ${today}
- IDs de tarefas de ontem (NÃO repetir): [${yesterdayIds || 'nenhum'}]${topVideosBlock}

PILARES DE CRESCIMENTO — CANAIS DE BEATS 2026 (roda de forma diferente cada dia):
① UPLOAD — frequência semanal, horário peak, formato "[FREE] Artista x Artista Type Beat 2026"
② CTR — thumbnail (rosto, contraste, texto grande), hook primeiros 30s, test de títulos
③ ENGAJAMENTO — responder comentários primeiras 24h pós-upload, pinned comment com link BeatStars
④ SEO — descrição com keywords de nicho, capítulos, playlists temáticas, cards e end screens
⑤ DISTRIBUIÇÃO — clip do loop principal para TikTok/Reels, YouTube Shorts
⑥ ANÁLISE — verificar retenção dos últimos 3 vídeos, CTR por thumbnail, peak hours no analytics
⑦ MONETIZAÇÃO — link BeatStars na bio, pricing visível, teaser de exclusivo
⑧ COMUNIDADE — community post, collab com outro produtor, responder DMs

Gera os insights estratégicos do dia para o canal. Usa os TOP VÍDEOS para identificar quais artistas e géneros já provaram converter neste canal — prioriza sugestões baseadas nesses padrões reais. Foca em observações que o produtor NÃO consegue ver sozinho — padrões, oportunidades de nicho, timing de tendências, e próximos artistas a explorar com base no histórico de views.
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
      // Always override weeklyGoal with real values — AI often returns wrong watchTarget
      parsed.weeklyGoal = {
        subsProgress: channelInfo?.subscribers ?? 0,
        subsTarget:   1000,
        watchMinutes: Math.round(allWatchMin),
        watchTarget:  240000,
      }
      setPlan(parsed)
      localStorage.setItem(`plan_${today}`, JSON.stringify(parsed))
      toast('Plano do dia gerado pela LAIS')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [loading, channelInfo, analyticsData, videos, today])

  // Poll quota every 10s so the bars update in near-real-time
  useEffect(() => {
    const iv = setInterval(loadAcctStatus, 10000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    if (!localStorage.getItem(`plan_${today}`)) fetchPlan()
    loadAllEngineStatus()
    fetch('/api/tiktok/status').then(r => r.ok ? r.json() : null).then((d: any) => {
      if (d?.user?.display_name) setTtUser(d.user.display_name)
    }).catch(() => {})
  }, []) // eslint-disable-line

  const anyRunning = autoShStatus?.running || autoComStatus?.running || autoRepStatus?.running || autoPlStatus?.running || autoSeoStatus?.running
  useEffect(() => {
    const iv = setInterval(loadAllEngineStatus, anyRunning ? 3000 : 30000)
    return () => clearInterval(iv)
  }, [anyRunning])

  // Detect engine job completions (running true→false) and fire toast
  const prevRunning = useRef({ sh: false, com: false, rep: false, pl: false, seo: false })
  useEffect(() => {
    const jobs = [
      { key: 'sh'  as const, st: autoShStatus,  label: 'AUTO-SHORTS',
        msg: (r: any) => r.title ? `Short "${r.title}" publicado` : 'AUTO-SHORTS concluído' },
      { key: 'com' as const, st: autoComStatus, label: 'AUTO-COMMENTS',
        msg: (r: any) => `AUTO-COMMENTS — ${r.posted ?? 0} comentários postados` },
      { key: 'rep' as const, st: autoRepStatus, label: 'AUTO-REPLIES',
        msg: (r: any) => `AUTO-REPLIES — ${r.replied ?? 0} respostas enviadas` },
      { key: 'pl'  as const, st: autoPlStatus,  label: 'AUTO-PLAYLISTS',
        msg: (r: any) => `AUTO-PLAYLISTS — ${r.videosOrganised ?? 0} vídeos organizados` },
      { key: 'seo' as const, st: autoSeoStatus, label: 'AUTO-SEO',
        msg: (r: any) => `AUTO-SEO — ${r.updated ?? 0}/${r.total ?? 0} vídeos atualizados` },
    ]
    for (const { key, st, label, msg } of jobs) {
      const wasRunning = prevRunning.current[key]
      const isRunning  = st?.running ?? false
      if (wasRunning && !isRunning && st?.lastResult) {
        if (st.lastResult.status === 'done')  toast(msg(st.lastResult))
        if (st.lastResult.status === 'error') toast(`${label} — erro: ${String(st.lastResult.error ?? '').slice(0, 50)}`)
      }
      prevRunning.current[key] = isRunning
    }
  }, [autoShStatus, autoComStatus, autoRepStatus, autoPlStatus, autoSeoStatus]) // eslint-disable-line

  useEffect(() => {
    const now = new Date()
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const tid = setTimeout(() => {
      setPlan(null); fetchPlan()
    }, tomorrow.getTime() - now.getTime())
    return () => clearTimeout(tid)
  }, []) // eslint-disable-line


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
            <span style={{ color: S.dimmer, fontSize: '9px' }}>6 jobs activos</span>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '1px', backgroundColor: S.border }}>
          {/* SHORTS */}
          <JobPill
            icon="🎬" name="AUTO-SHORTS"
            stat={autoShStatus ? `${autoShStatus.pending ?? 0} pendentes` : '—'}
            sub={autoShStatus ? `próx. ${fmtCountdown(autoShStatus.msUntilNext)}` : 'intervalo · 2h'}
            running={autoShStatus?.running}
            error={autoShStatus?.lastResult?.status === 'error'}
            onRun={runShNow}
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
          {/* TIKTOK */}
          <JobPill
            icon="🎵" name="AUTO-TIKTOK"
            stat={autoTtStatus ? `${autoTtStatus.posted ?? 0} postados · ${autoTtStatus.pending ?? 0} pend.` : '—'}
            sub={autoTtStatus ? `próx. ${fmtCountdown(autoTtStatus.msUntilNext)}` : 'intervalo · 4h'}
            running={autoTtStatus?.running}
            error={autoTtStatus?.lastResult?.status === 'error'}
            onRun={(autoTtStatus?.clipsQueued > 0 || autoTtStatus?.pendingVideos > 0) ? runTtNow : undefined}
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

            {/* TIKTOK */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <p style={{ ...label, margin: 0, color: '#ff0050' }}>🎵 AUTO-TIKTOK</p>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {ttUser && (
                    <a href={`https://www.tiktok.com/@${ttUser}`} target="_blank" rel="noopener noreferrer"
                      style={{ color: '#660033', fontSize: '9px', border: '1px solid #330020', padding: '2px 8px', textDecoration: 'none', fontFamily: S.mono, letterSpacing: '0.5px' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ff0050'; (e.currentTarget as HTMLElement).style.borderColor = '#660033' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#660033'; (e.currentTarget as HTMLElement).style.borderColor = '#330020' }}>
                      @{ttUser} ↗
                    </a>
                  )}
                  <a href="https://www.tiktok.com/tiktokstudio/content" target="_blank" rel="noopener noreferrer"
                    style={{ color: '#ff0050', fontSize: '9px', border: '1px solid #44001a', padding: '2px 8px', textDecoration: 'none', fontFamily: S.mono, letterSpacing: '0.5px', backgroundColor: '#100508' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#ff0050' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#44001a' }}>
                    STUDIO ↗
                  </a>
                </div>
              </div>

              {/* stats row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '4px', marginBottom: '8px' }}>
                {[
                  { lbl: 'POSTADOS',  val: autoTtStatus?.posted       ?? '—' },
                  { lbl: 'CLIPS',     val: autoTtStatus?.clipsQueued  ?? '—' },
                  { lbl: 'VÍDEOS',    val: autoTtStatus?.pendingVideos ?? '—' },
                  { lbl: 'FALHOS',    val: autoTtStatus?.failed        ?? '—' },
                ].map(({ lbl: l, val }) => (
                  <div key={l} style={{ backgroundColor: S.bgDeep, border: `1px solid ${S.border}`, padding: '5px 4px', textAlign: 'center' }}>
                    <p style={{ ...label, margin: '0 0 2px', fontSize: '8px' }}>{l}</p>
                    <p style={{ color: S.text, fontSize: '13px', margin: 0, fontWeight: 'bold' }}>{val}</p>
                  </div>
                ))}
              </div>

              {/* reset buttons */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                {[
                  { label: 'RESET ERROS',    endpoint: '/api/tiktok/auto-reset-failed', color: '#553300' },
                  { label: 'RESET POSTADOS', endpoint: '/api/tiktok/auto-reset-posted', color: '#334400' },
                  { label: 'RESET TUDO',     endpoint: '/api/tiktok/auto-reset-all',    color: '#550011' },
                ].map(({ label: lbl, endpoint, color }) => (
                  <button key={lbl}
                    onClick={() => {
                      fetch(endpoint, { method: 'POST' })
                        .then(() => fetch('/api/tiktok/auto-status').then(r => r.json()).then(setAutoTtStatus))
                        .catch(() => {})
                      toast(lbl + ' feito')
                    }}
                    style={{
                      flex: 1, padding: '4px 2px', fontFamily: S.mono, fontSize: '8px', letterSpacing: '0.5px',
                      cursor: 'pointer', background: 'transparent', color,
                      border: `1px solid ${color}22`,
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = color; (e.currentTarget as HTMLElement).style.color = S.text }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = `${color}22`; (e.currentTarget as HTMLElement).style.color = color }}
                  >{lbl}</button>
                ))}
              </div>

              {/* post mode selector + run button */}
              <div style={{ marginBottom: '10px' }}>
                <p style={{ ...label, margin: '0 0 5px', color: S.dimmer }}>MODO · PRÓXIMO POST</p>
                <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                  {(['immediate', 'scheduled', 'draft'] as const).map(m => {
                    const lbl = { immediate: 'IMEDIATO', scheduled: 'AGENDADO', draft: 'RASCUNHO' }
                    const active = ttRunMode === m
                    return (
                      <button key={m} onClick={() => setTtRunMode(m)}
                        style={{
                          flex: 1, padding: '4px 2px', fontFamily: S.mono, fontSize: '9px', letterSpacing: '0.5px',
                          cursor: 'pointer', background: active ? '#150008' : 'transparent',
                          color: active ? '#ff0050' : S.dimmer,
                          border: `1px solid ${active ? '#550020' : '#1a000a'}`,
                        }}
                        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = S.muted }}
                        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = S.dimmer }}
                      >{lbl[m]}</button>
                    )
                  })}
                </div>
                {ttRunMode === 'scheduled' && (
                  <input
                    type="datetime-local"
                    value={ttRunSched}
                    onChange={e => setTtRunSched(e.target.value)}
                    min={new Date(Date.now() + 15 * 60 * 1000).toISOString().slice(0, 16)}
                    max={new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString().slice(0, 16)}
                    style={{
                      width: '100%', boxSizing: 'border-box', marginBottom: '6px',
                      background: '#080808', border: '1px solid #330015',
                      color: '#ff0050', fontFamily: S.mono, fontSize: '10px', padding: '5px 8px', outline: 'none',
                    }}
                  />
                )}
                <button
                  onClick={runTtNow}
                  disabled={autoTtStatus?.running || (!autoTtStatus?.clipsQueued && !autoTtStatus?.pendingVideos)}
                  style={{
                    width: '100%', padding: '5px', fontFamily: S.mono, fontSize: '10px', letterSpacing: '1px',
                    cursor: (autoTtStatus?.running || (!autoTtStatus?.clipsQueued && !autoTtStatus?.pendingVideos)) ? 'not-allowed' : 'pointer',
                    background: (autoTtStatus?.running || (!autoTtStatus?.clipsQueued && !autoTtStatus?.pendingVideos)) ? 'transparent' : '#150008',
                    color: (autoTtStatus?.running || (!autoTtStatus?.clipsQueued && !autoTtStatus?.pendingVideos)) ? S.dimmer : '#ff0050',
                    border: `1px solid ${(autoTtStatus?.running || (!autoTtStatus?.clipsQueued && !autoTtStatus?.pendingVideos)) ? '#1a000a' : '#550020'}`,
                  }}
                  onMouseEnter={e => { if (!autoTtStatus?.running && autoTtStatus?.pending) (e.currentTarget as HTMLElement).style.borderColor = '#ff0050' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#550020' }}
                >
                  {autoTtStatus?.running ? '[ A PROCESSAR... ]' : `[ POSTAR AGORA · ${ttRunMode === 'draft' ? 'RASCUNHO' : ttRunMode === 'scheduled' ? 'AGENDADO' : 'IMEDIATO'} ]`}
                </button>
              </div>

              {/* last result */}
              {autoTtStatus?.lastResult?.status === 'running' && (
                <p style={{ color: S.yellow, fontSize: '10px', margin: '0 0 6px' }} className="blink">⟳ a processar...</p>
              )}
              {autoTtStatus?.lastResult?.status === 'done' && (
                <p style={{ color: S.greenD, fontSize: '10px', margin: '0 0 6px' }}>
                  ✓ último: {autoTtStatus.lastResult.title}
                </p>
              )}
              {autoTtStatus?.lastResult?.status === 'error' && (
                <p style={{ color: S.red, fontSize: '10px', margin: '0 0 6px' }}>⚠ {autoTtStatus.lastResult.error}</p>
              )}

              {/* AI caption of last post */}
              {(autoTtStatus?.lastDescription || autoTtStatus?.lastResult?.description) && (
                <div style={{ backgroundColor: '#060606', border: '1px solid #330020', padding: '8px 10px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                    <span style={{ color: '#660033', fontSize: '9px', letterSpacing: '1px' }}>CAPTION IA · PRONTA PARA COPIAR</span>
                    <CopyBtn text={autoTtStatus.lastDescription || autoTtStatus.lastResult.description} />
                  </div>
                  <p style={{ color: S.textM, fontSize: '10px', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap', fontStyle: 'italic' }}>
                    {autoTtStatus.lastDescription || autoTtStatus.lastResult.description}
                  </p>
                </div>
              )}

              {/* clips queued */}
              {autoTtStatus?.clips?.length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  <p style={{ ...label, margin: '0 0 5px', color: S.dimmer }}>CLIPS · fila de posts</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {autoTtStatus.clips.map((c: any, i: number) => (
                      <div key={`${c.id}-${c.startTime}`} style={{ display: 'flex', gap: '6px', alignItems: 'center', padding: '3px 6px', backgroundColor: S.bgDeep }}>
                        <span style={{ color: i === 0 ? '#ff0050' : S.dimmer, fontSize: '9px', flexShrink: 0 }}>{i === 0 ? '▶' : `${i + 1}.`}</span>
                        <span style={{ color: S.muted, fontSize: '9px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                        <span style={{ color: S.dimmer, fontSize: '8px', flexShrink: 0 }}>clip {c.clip} · {c.startTime}s</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* next videos pending extraction */}
              {autoTtStatus?.queue?.length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  <p style={{ ...label, margin: '0 0 5px', color: S.dimmer }}>VÍDEOS · para extrair</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {autoTtStatus.queue.slice(0, 3).map((q: any, i: number) => (
                      <div key={q.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '3px 6px', backgroundColor: S.bgDeep }}>
                        <span style={{ color: S.dimmer, fontSize: '9px', flexShrink: 0 }}>{i + 1}.</span>
                        <span style={{ color: S.muted, fontSize: '9px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.title}</span>
                        <a href={q.url} target="_blank" rel="noopener noreferrer"
                          style={{ color: '#2a4a6a', fontSize: '9px', textDecoration: 'none', flexShrink: 0 }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = S.blue }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#2a4a6a' }}>YT ↗</a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TikTok auto-replies */}
              <div style={{ borderTop: `1px solid #1a0010`, padding: '8px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <div>
                    <span style={{ ...label, color: '#003322' }}>AUTO-REPLIES · TIKTOK</span>
                    <span style={{ color: S.dimmer, fontSize: '9px', marginLeft: '8px' }}>
                      {ttRepStatus ? `${ttRepStatus.todayReplied ?? 0} hoje · ${ttRepStatus.totalReplied ?? 0} total` : '—'}
                    </span>
                  </div>
                  <button
                    onClick={runTtRepliesNow}
                    disabled={ttRepStatus?.running}
                    style={{ ...retroBtn, fontSize: '9px', padding: '2px 8px', opacity: ttRepStatus?.running ? 0.5 : 1, borderColor: '#002a1a', color: ttRepStatus?.running ? S.dimmer : '#00cc66' }}
                    onMouseEnter={e => { if (!ttRepStatus?.running) (e.currentTarget as HTMLElement).style.borderColor = '#00cc66' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#002a1a' }}
                  >
                    {ttRepStatus?.running ? '[ ... ]' : '[ RUN ]'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '4px' }}>
                  <span style={{ color: S.dimmer, fontSize: '9px' }}>
                    {ttRepStatus?.schedule ?? '03:00 · 09:00 · 15:00 · 21:00 UTC'}
                  </span>
                  {ttRepStatus?.nextRunAt && (
                    <span style={{ color: S.dimmer, fontSize: '9px' }}>
                      · próx. {fmtCountdown(ttRepStatus.msUntilNext)}
                    </span>
                  )}
                </div>
                {ttRepStatus?.lastResult?.status === 'running' && (
                  <p style={{ color: S.yellow, fontSize: '9px', margin: '4px 0 0' }} className="blink">⟳ a responder...</p>
                )}
                {ttRepStatus?.lastResult?.status === 'done' && ttRepStatus.lastResult.replied > 0 && (
                  <p style={{ color: S.greenD, fontSize: '9px', margin: '4px 0 0' }}>
                    ✓ {ttRepStatus.lastResult.replied}/{ttRepStatus.lastResult.total} respondidos
                  </p>
                )}
                {ttRepStatus?.lastResult?.status === 'done' && ttRepStatus.lastResult.replied === 0 && (
                  <p style={{ color: S.dimmer, fontSize: '9px', margin: '4px 0 0' }}>
                    {ttRepStatus.lastResult.message || 'Sem comentários novos'}
                  </p>
                )}
                {ttRepStatus?.lastResult?.status === 'error' && (
                  <p style={{ color: S.red, fontSize: '9px', margin: '4px 0 0' }}>⚠ {ttRepStatus.lastResult.error}</p>
                )}
              </div>

              {/* TikTok video manager — list + delete */}
              <div style={{ borderTop: `1px solid #1a0010`, paddingTop: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <p style={{ ...label, margin: 0, color: '#440022' }}>VÍDEOS NO TIKTOK</p>
                  <button
                    onClick={loadTtVideos}
                    disabled={ttVidsLoading}
                    style={{ ...retroBtn, fontSize: '9px', padding: '2px 8px', opacity: ttVidsLoading ? 0.5 : 1, borderColor: '#330020', color: ttVidsLoading ? S.dimmer : '#ff0050' }}
                    onMouseEnter={e => { if (!ttVidsLoading) (e.currentTarget as HTMLElement).style.borderColor = '#ff0050' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#330020' }}
                  >
                    {ttVidsLoading ? '[ ... ]' : '[ CARREGAR ]'}
                  </button>
                </div>
                {ttVideos === null && (
                  <p style={{ color: S.dimmer, fontSize: '9px', margin: 0 }}>Clica em CARREGAR para ver os teus vídeos no TikTok.</p>
                )}
                {ttVideos?.length === 0 && (
                  <p style={{ color: S.dimmer, fontSize: '9px', margin: 0 }}>Nenhum vídeo publicado no TikTok.</p>
                )}
                {ttVideos && ttVideos.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {ttVideos.map((v: any) => (
                      <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 8px', backgroundColor: S.bgDeep, border: `1px solid #1a000e` }}>
                        {v.cover_image_url && (
                          <img src={v.cover_image_url} alt="" style={{ width: 36, height: 64, objectFit: 'cover', flexShrink: 0, border: '1px solid #220011' }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ color: S.text, fontSize: '10px', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {v.title || '(sem título)'}
                          </p>
                          <p style={{ color: S.dimmer, fontSize: '9px', margin: 0 }}>
                            {v.create_time ? new Date(v.create_time * 1000).toLocaleDateString('pt-BR') : '—'}
                          </p>
                        </div>
                        <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
                          {v.share_url && (
                            <a href={v.share_url} target="_blank" rel="noopener noreferrer"
                              style={{ color: '#440033', fontSize: '9px', border: '1px solid #330022', padding: '2px 6px', textDecoration: 'none', fontFamily: S.mono }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ff0050' }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#440033' }}>
                              ↗
                            </a>
                          )}
                          <button
                            onClick={() => deleteTtVideo(v.id)}
                            disabled={ttDeleting === v.id}
                            style={{ background: 'transparent', border: '1px solid #2a0000', color: ttDeleting === v.id ? S.dimmer : '#551111', fontSize: '9px', padding: '2px 6px', cursor: ttDeleting === v.id ? 'wait' : 'pointer', fontFamily: S.mono }}
                            onMouseEnter={e => { if (ttDeleting !== v.id) { (e.currentTarget as HTMLElement).style.color = '#ff4400'; (e.currentTarget as HTMLElement).style.borderColor = '#550000' } }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#551111'; (e.currentTarget as HTMLElement).style.borderColor = '#2a0000' }}
                          >
                            {ttDeleting === v.id ? '...' : '[ DEL ]'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
                        {daysSince}{' '}
                        <span style={{ fontSize: '11px', fontWeight: 'normal', color: S.muted }}>dias atrás</span>
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
              <GoalBar label="SUBSCRIBERS"
                current={channelInfo?.subscribers ?? 0}
                target={1000}
                fmt={n => n.toLocaleString()} />
              <div style={{ height: '10px' }} />
              <GoalBar label="WATCH TIME"
                current={Math.round((analyticsData ?? []).reduce((s, r) => s + r.watchTime, 0))}
                target={240000}
                fmt={n => `${Math.round(n / 60).toLocaleString()}h`} />
              <p style={{ color: '#2a2a2a', fontSize: '9px', margin: '10px 0 0', letterSpacing: '1px' }}>1.000 SUBS + 4.000H</p>
            </div>

          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          AUTO-REPLIES
      ═══════════════════════════════════════════════════════════════ */}
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

      {/* ═══════════════════════════════════════════════════════════════
          QUOTA STATUS
      ═══════════════════════════════════════════════════════════════ */}
        <div style={panel}>
          <p style={{ ...label, marginBottom: '12px' }}>📊 quota youtube · tempo real</p>
          {acctStatus?.quota ? (() => {
            const q   = acctStatus.quota
            const exhausted = !!(q as any).ytExhausted
            const ytP = exhausted ? 100 : Math.min(100, Math.round((q.ytUnits / q.ytLimit) * 100))
            const yaP = Math.min(100, Math.round((q.yaUnits / q.yaLimit) * 100))
            const barColor = (p: number) => p >= 80 ? S.red : p >= 50 ? S.yellow : S.greenD
            const resetIn = Math.max(0, new Date(q.resetAt).getTime() - Date.now())
            const hh = Math.floor(resetIn / 3600000)
            const mm = Math.floor((resetIn % 3600000) / 60000)
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* YouTube Data API bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: S.muted, fontSize: '10px', letterSpacing: '1px' }}>DATA API v3</span>
                    <span style={{ color: exhausted ? S.red : barColor(ytP), fontSize: '10px', fontFamily: S.mono }}>
                      {exhausted ? 'ESGOTADA' : `${q.ytUnits.toLocaleString()} / ${q.ytLimit.toLocaleString()} units`}
                    </span>
                  </div>
                  <div style={{ height: '6px', backgroundColor: S.bgDeep, border: `1px solid ${S.border}` }}>
                    <div style={{ height: '100%', width: `${ytP}%`, backgroundColor: exhausted ? S.red : barColor(ytP), transition: 'width 0.4s ease' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2px' }}>
                    <span style={{ color: S.dimmer, fontSize: '9px' }}>{exhausted ? '' : `${ytP}% usado`}</span>
                  </div>
                </div>
                {/* YouTube Analytics API bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: S.muted, fontSize: '10px', letterSpacing: '1px' }}>ANALYTICS API</span>
                    <span style={{ color: barColor(yaP), fontSize: '10px', fontFamily: S.mono }}>
                      {q.yaUnits.toLocaleString()} / {q.yaLimit.toLocaleString()} units
                    </span>
                  </div>
                  <div style={{ height: '6px', backgroundColor: S.bgDeep, border: `1px solid ${S.border}` }}>
                    <div style={{ height: '100%', width: `${yaP}%`, backgroundColor: barColor(yaP), transition: 'width 0.4s ease' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2px' }}>
                    <span style={{ color: S.dimmer, fontSize: '9px' }}>{yaP}% usado</span>
                  </div>
                </div>
                {/* Reset countdown */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '4px', borderTop: `1px solid ${exhausted ? S.red : S.border}` }}>
                  <span style={{ color: exhausted ? S.red : S.dimmer, fontSize: '9px', letterSpacing: '1px' }}>reset em</span>
                  <span style={{ color: exhausted ? S.red : S.muted, fontSize: '10px', fontFamily: S.mono }}>
                    {hh}h {mm.toString().padStart(2, '0')}m
                  </span>
                </div>
              </div>
            )
          })() : (
            <p style={{ color: S.dimmer, fontSize: '10px', margin: 0 }}>A carregar...</p>
          )}
        </div>

    </div>
  )
}

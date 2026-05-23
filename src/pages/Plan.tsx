import { useState, useEffect, useCallback } from 'react'
import type { Page } from '../types'
import type { DailyRow, ChannelInfo, Video as ApiVideo } from '../lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────
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

interface EngagementItem {
  videoId: string
  title: string
  channel: string
  flag: string
  views: number
  commentPt: string
  commentEn: string
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
const VALID_PAGES: Page[] = ['overview', 'videos', 'analytics', 'audience', 'revenue', 'plan', 'scheduler', 'beatstore', 'market', 'settings']
const DAYS_PT = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

function sanitizePage(p: unknown): Page | undefined {
  return VALID_PAGES.includes(p as Page) ? (p as Page) : undefined
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function fmtViews(n: number) {
  return n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
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
  const [plan, setPlan]         = useState<PlanData | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [checks, setChecks]     = useState<Record<string, boolean>>({})

  const [engagement, setEngagement]   = useState<EngagementItem[] | null>(null)
  const [engLoading, setEngLoading]   = useState(false)
  const [engDone, setEngDone]         = useState<Record<string, boolean>>({})

  const today = todayStr()

  // ── Load from localStorage ─────────────────────────────────────────────────
  useEffect(() => {
    try { const s = localStorage.getItem(`plan_${today}`);         if (s) setPlan(JSON.parse(s)) } catch {}
    try { const s = localStorage.getItem(`plan_checks_${today}`);  if (s) setChecks(JSON.parse(s)) } catch {}
    try { const s = localStorage.getItem(`engagement_${today}`);   if (s) setEngagement(JSON.parse(s)) } catch {}
    try { const s = localStorage.getItem(`eng_done_${today}`);     if (s) setEngDone(JSON.parse(s)) } catch {}
  }, [today])

  function toggleCheck(id: string) {
    setChecks(prev => {
      const next = { ...prev, [id]: !prev[id] }
      localStorage.setItem(`plan_checks_${today}`, JSON.stringify(next))
      return next
    })
  }

  function toggleEngDone(id: string) {
    setEngDone(prev => {
      const next = { ...prev, [id]: !prev[id] }
      localStorage.setItem(`eng_done_${today}`, JSON.stringify(next))
      return next
    })
  }

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

  // ── fetchEngagement ────────────────────────────────────────────────────────
  const fetchEngagement = useCallback(async (bust = false) => {
    if (engLoading) return
    setEngLoading(true)

    try {
      // Step 1: get market videos (cached on server — fast)
      const mRes = await fetch('/api/market')
      if (!mRes.ok) throw new Error(`market HTTP ${mRes.status}`)
      const mData = await mRes.json()

      type RawVid = { videoId?: string; title: string; channel: string; flag: string; views: number }
      const allVids: RawVid[] = (mData.niches as Array<{ sample: RawVid[] }>)
        .flatMap(n => n.sample ?? [])
        .filter(v => v.videoId)

      if (!allVids.length) throw new Error('Sem vídeos no mercado — abre a aba MERCADO primeiro')

      // On bust: exclude currently shown videos so we always get fresh ones
      const currentIds = new Set(bust ? (engagement?.map(e => e.videoId) ?? []) : [])
      const pool = allVids.filter(v => !currentIds.has(v.videoId!))

      // Shuffle for variety, then pick top 5 by views from the shuffled slice
      const shuffled = [...(pool.length >= 5 ? pool : allVids)].sort(() => Math.random() - 0.5)
      const selected = shuffled.slice(0, 20).sort((a, b) => b.views - a.views).slice(0, 5)

      // Step 2: LAIS generates PT-BR + EN comments, specific to each video's niche/artist
      const videoList = selected.map((v, i) =>
        `${i + 1}. videoId="${v.videoId}" | title="${v.title.slice(0, 70)}" | channel="${v.channel}"`
      ).join('\n')

      const question = `You are an expert in hip-hop, trap, RnB, and beat music culture. Write authentic YouTube comments for these videos.

Videos:
${videoList}

For EACH video write TWO comments:
1. commentPt: in Brazilian Portuguese (casual, 15-25 words). Must sound like a real Brazilian fan.
2. commentEn: in English (casual, 15-25 words). Must sound like a real music fan.

Rules for BOTH comments:
- Analyze the artist name(s) in the title and write something specific to their style, era, or known songs
- Sound like a genuine listener — NOT a producer or anyone promoting something
- Never mention "beat", "type beat", "production", or self-promotion
- No generic phrases like "this is fire", "goes hard", "slaps" — be specific and original
- Vary the tone: excitement, nostalgia, question, cultural reference, mood description

Reply ONLY in valid JSON (no markdown, no text before or after):
{"comments":[{"videoId":"ID","commentPt":"...","commentEn":"..."}]}`

      const full   = await laisChat(question, 1500, PLAN_SYSTEM_PROMPT)
      const parsed = extractJson(full) as { comments: { videoId: string; commentPt: string; commentEn: string }[] }

      const commentMap: Record<string, { pt: string; en: string }> = {}
      parsed.comments.forEach(c => { commentMap[c.videoId] = { pt: c.commentPt ?? '', en: c.commentEn ?? '' } })

      const result: EngagementItem[] = selected.map(v => ({
        videoId:   v.videoId!,
        title:     v.title,
        channel:   v.channel,
        flag:      v.flag,
        views:     v.views,
        commentPt: commentMap[v.videoId!]?.pt ?? '',
        commentEn: commentMap[v.videoId!]?.en ?? '',
      }))

      setEngagement(result)
      localStorage.setItem(`engagement_${today}`, JSON.stringify(result))
    } catch (err: any) {
      console.warn('[engagement]', err.message)
    } finally {
      setEngLoading(false)
    }
  }, [engLoading, today, engagement])

  // ── Auto-fetch on mount ────────────────────────────────────────────────────
  useEffect(() => {
    if (!localStorage.getItem(`plan_${today}`))       fetchPlan()
    if (!localStorage.getItem(`engagement_${today}`)) fetchEngagement()
  }, []) // eslint-disable-line

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
  const engDoneCount = Object.values(engDone).filter(Boolean).length

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
          FILA DE ENGAJAMENTO
      ══════════════════════════════════════════════════════════ */}
      <div style={panel}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div>
            <p style={{ ...dim, margin: '0 0 4px' }}>💬 FILA DE ENGAJAMENTO</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: engDoneCount >= 5 ? '#00ff00' : '#c0c0c0', fontSize: '12px', fontWeight: 'bold' }}>
                ENGAJAMENTO DO DIA: {engDoneCount}/5
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

        {/* Loading state */}
        {engLoading && !engagement && (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <p style={{ color: '#333333', fontSize: '11px', margin: 0 }}>{'█'.repeat(10)}<span className="blink">█</span></p>
            <p style={{ color: '#2a2a2a', fontSize: '10px', margin: '8px 0 0', letterSpacing: '1px' }}>LAIS a selecionar vídeos do nicho...</p>
          </div>
        )}

        {/* No data prompt */}
        {!engagement && !engLoading && (
          <div style={{ padding: '16px', backgroundColor: '#080808', border: '1px solid #1a1a1a', textAlign: 'center' }}>
            <p style={{ color: '#444444', fontSize: '11px', margin: '0 0 8px' }}>
              Sem dados de mercado — abre a aba MERCADO primeiro para carregar os vídeos do nicho.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button
                onClick={() => onNavigate('market')}
                style={{ ...retroBtn, borderColor: '#1a3a1a', color: '#00aa00' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#00ff00'; (e.currentTarget as HTMLElement).style.borderColor = '#00aa00' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#00aa00'; (e.currentTarget as HTMLElement).style.borderColor = '#1a3a1a' }}
              >
                [ IR PARA MERCADO ]
              </button>
              <button
                onClick={() => fetchEngagement(false)}
                style={retroBtn}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#00aa00'; (e.currentTarget as HTMLElement).style.color = '#00aa00' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2a2a2a'; (e.currentTarget as HTMLElement).style.color = '#555555' }}
              >
                [ TENTAR MESMO ASSIM ]
              </button>
            </div>
          </div>
        )}

        {/* Engagement list */}
        {engagement && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {engagement.map((item, idx) => {
              const done = !!engDone[item.videoId]
              return (
                <div
                  key={item.videoId}
                  style={{ padding: '10px 12px', backgroundColor: done ? '#0a1a0a' : '#080808', border: `1px solid ${done ? '#1a3a1a' : '#1a1a1a'}`, opacity: done ? 0.5 : 1 }}
                >
                  {/* Video info */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '14px', flexShrink: 0 }}>{item.flag}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ color: done ? '#444444' : '#c0c0c0', fontSize: '11px', margin: '0 0 2px', textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {idx + 1}. {item.title}
                      </p>
                      <p style={{ color: '#555555', fontSize: '10px', margin: 0 }}>
                        {item.channel} · {fmtViews(item.views)} views
                      </p>
                    </div>
                  </div>

                  {/* Comments: PT + EN */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                    {item.commentPt && (
                      <div style={{ backgroundColor: '#050505', border: '1px solid #1a2a1a', padding: '7px 10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
                          <CopyBtn text={item.commentPt} label="[ COPIAR PT ]" />
                        </div>
                        <p style={{ color: '#a0a0a0', fontSize: '11px', margin: 0, lineHeight: 1.5, fontStyle: 'italic' }}>
                          "{item.commentPt}"
                        </p>
                      </div>
                    )}
                    {item.commentEn && (
                      <div style={{ backgroundColor: '#050505', border: '1px solid #1a2030', padding: '7px 10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
                          <CopyBtn text={item.commentEn} label="[ COPIAR EN ]" />
                        </div>
                        <p style={{ color: '#a0a0a0', fontSize: '11px', margin: 0, lineHeight: 1.5, fontStyle: 'italic' }}>
                          "{item.commentEn}"
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <a
                      href={`https://www.youtube.com/watch?v=${item.videoId}&lc=new&comment=${encodeURIComponent(item.commentEn)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ background: 'transparent', border: '1px solid #1a2030', color: '#5588aa', fontSize: '9px', padding: '3px 8px', fontFamily: 'Courier New, monospace', letterSpacing: '0.5px', textDecoration: 'none', flexShrink: 0 }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#336699'; (e.currentTarget as HTMLElement).style.color = '#88bbdd' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1a2030'; (e.currentTarget as HTMLElement).style.color = '#5588aa' }}
                    >
                      [ COMENTAR ]
                    </a>
                    <button
                      onClick={() => toggleEngDone(item.videoId)}
                      style={{ background: done ? '#0a1a0a' : 'transparent', border: `1px solid ${done ? '#00ff00' : '#1a1a1a'}`, color: done ? '#00ff00' : '#333333', fontSize: '9px', padding: '3px 8px', cursor: 'pointer', fontFamily: 'Courier New, monospace', letterSpacing: '0.5px', flexShrink: 0 }}
                      onMouseEnter={e => { if (!done) { (e.currentTarget as HTMLElement).style.borderColor = '#00aa00'; (e.currentTarget as HTMLElement).style.color = '#00aa00' } }}
                      onMouseLeave={e => { if (!done) { (e.currentTarget as HTMLElement).style.borderColor = '#1a1a1a'; (e.currentTarget as HTMLElement).style.color = '#333333' } }}
                    >
                      {done ? '✓ FEITO' : '[ MARCAR FEITO ]'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}

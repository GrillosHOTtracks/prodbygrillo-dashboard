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

// ─── Helpers ──────────────────────────────────────────────────────────────────
const VALID_PAGES: Page[] = ['overview', 'videos', 'analytics', 'audience', 'revenue', 'plan', 'scheduler', 'beatstore', 'market', 'settings']

function sanitizePage(p: unknown): Page | undefined {
  return VALID_PAGES.includes(p as Page) ? (p as Page) : undefined
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
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
  const today = todayStr()

  // Load saved plan + checkbox state from localStorage
  useEffect(() => {
    const saved      = localStorage.getItem(`plan_${today}`)
    const savedChecks = localStorage.getItem(`plan_checks_${today}`)
    if (saved)      { try { setPlan(JSON.parse(saved)) }   catch {} }
    if (savedChecks){ try { setChecks(JSON.parse(savedChecks)) } catch {} }
  }, [today])

  function toggleCheck(id: string) {
    setChecks(prev => {
      const next = { ...prev, [id]: !prev[id] }
      localStorage.setItem(`plan_checks_${today}`, JSON.stringify(next))
      return next
    })
  }

  const fetchPlan = useCallback(async () => {
    if (loading) return
    setLoading(true)
    setError('')

    const subs        = channelInfo?.subscribers ?? 0
    const totalVideos = channelInfo?.totalVideos ?? 0
    const channelName = channelInfo?.name ?? 'prodbygrillo'

    const sorted = [...(videos ?? [])].sort((a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    )
    const lastUploadMs    = sorted[0] ? new Date(sorted[0].publishedAt).getTime() : null
    const daysSinceUpload = lastUploadMs ? Math.floor((Date.now() - lastUploadMs) / 86400000) : null

    const recent7       = (analyticsData ?? []).slice(-7)
    const totalViews7   = recent7.reduce((s, r) => s + r.views, 0)
    const subGain7      = recent7.reduce((s, r) => s + r.subscribers, 0)
    const watchMin7     = recent7.reduce((s, r) => s + r.watchTime, 0)
    const allWatchMin   = (analyticsData ?? []).reduce((s, r) => s + r.watchTime, 0)

    const days      = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
    const dayOfWeek = days[new Date().getDay()]
    const dateStr   = new Date().toLocaleDateString('pt-BR')

    const recentVids = sorted.slice(0, 3).map(v => ({
      title:   v.title.slice(0, 45),
      views:   v.views,
      ctr:     v.ctr?.toFixed(1) ?? '?',
      daysAgo: Math.floor((Date.now() - new Date(v.publishedAt).getTime()) / 86400000),
    }))

    const msg = `Você é a LAIS, assistente IA para produtores de beats no YouTube. Gera um plano diário ultra-específico para o canal "${channelName}".

DADOS REAIS DO CANAL:
- Subscribers: ${subs.toLocaleString()} (meta YPP: 1.000)
- Total de vídeos publicados: ${totalVideos}
- Dias desde o último upload: ${daysSinceUpload ?? 'desconhecido'}
- Hoje: ${dayOfWeek}, ${dateStr}
- Últimos 7 dias: ${totalViews7.toLocaleString()} views · +${subGain7} subs · ${Math.round(watchMin7 / 60)}h watch time
- Watch time total (janela atual): ${Math.round(allWatchMin / 60)}h (meta YPP: 4.000h)
- Vídeos recentes: ${JSON.stringify(recentVids)}

Responde APENAS com um JSON válido com esta estrutura exata (sem markdown, sem explicações):
{
  "dayContext": "frase curta e direta sobre hoje e o que isso significa para o canal (ex: Sexta à noite — pico de plays em beats trap. Ideal para postar agora.)",
  "mainTask": {
    "text": "1 ação principal de altíssimo impacto para hoje, específica e baseada nos dados",
    "page": "scheduler"
  },
  "checklist": [
    { "id": "upload", "text": "tarefa específica baseada nos dados reais do canal", "page": "scheduler" },
    { "id": "comments", "text": "...", "page": "videos" }
  ],
  "insights": [
    "observação concreta e útil sobre o canal hoje",
    "segunda observação",
    "terceira observação"
  ],
  "weeklyGoal": {
    "subsProgress": ${subs},
    "subsTarget": 1000,
    "watchMinutes": ${Math.round(allWatchMin)},
    "watchTarget": 240000
  }
}

Regras obrigatórias:
- checklist: entre 5 e 8 itens, cada um acionável e específico para este canal
- page em cada item deve ser um destes valores exatos ou null: overview, videos, analytics, audience, revenue, plan, scheduler, beatstore, market, settings
- insights: exatamente 3, frases curtas e diretas com dados concretos
- Usa português de Portugal (não Brasil)
- Se o canal está há mais de 7 dias sem upload, a tarefa principal deve ser fazer upload`

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: msg }),
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

      const match = full.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('JSON inválido da LAIS — tenta novamente')
      const parsed = JSON.parse(match[0]) as PlanData

      // Sanitize page values so invalid strings don't crash navigation
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

  // Auto-generate if no plan for today
  useEffect(() => {
    if (!localStorage.getItem(`plan_${today}`)) fetchPlan()
  }, []) // eslint-disable-line

  // Schedule midnight regeneration
  useEffect(() => {
    const now             = new Date()
    const tomorrow        = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const msUntilMidnight = tomorrow.getTime() - now.getTime()
    const tid = setTimeout(() => {
      setPlan(null)
      setChecks({})
      fetchPlan()
    }, msUntilMidnight)
    return () => clearTimeout(tid)
  }, []) // eslint-disable-line

  const doneCount = plan ? plan.checklist.filter(item => checks[item.id]).length : 0
  const totalCount = plan?.checklist.length ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '2px', margin: 0, opacity: 0.8 }}>
        ┌─ PLANO DIÁRIO · LAIS AI ────────────────────────────────────────
      </p>

      {/* Loading */}
      {loading && (
        <div style={{ ...panel, textAlign: 'center', padding: '40px 20px' }}>
          <p style={{ color: '#00ff00', fontSize: '12px', margin: '0 0 8px', letterSpacing: '1px' }}>
            A GERAR PLANO DO DIA_
          </p>
          <p style={{ color: '#333333', fontSize: '11px', margin: 0 }}>
            {'█'.repeat(14)}<span className="blink">█</span>
          </p>
          <p style={{ color: '#2a2a2a', fontSize: '10px', margin: '12px 0 0', letterSpacing: '1px' }}>
            LAIS a analisar dados reais do canal...
          </p>
        </div>
      )}

      {/* Error */}
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
          {/* Top row: day context + date + regenerate */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', alignItems: 'stretch' }}>
            <div style={panel}>
              <p style={{ ...dim, marginBottom: '6px' }}>📅 CONTEXTO DO DIA · {today}</p>
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
              <p style={{ ...dim, textAlign: 'center', fontSize: '9px' }}>regenera à meia-noite</p>
            </div>
          </div>

          {/* Main task */}
          <div style={{ ...panel, borderTopColor: '#00ff00', borderLeftColor: '#00ff00', borderTopWidth: '2px', borderLeftWidth: '2px', backgroundColor: '#080808' }}>
            <p style={{ ...dim, marginBottom: '8px' }}>⚡ TAREFA PRINCIPAL</p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
              <p style={{ color: '#00ff00', fontSize: '13px', margin: 0, fontWeight: 'bold', lineHeight: 1.5, flex: 1 }}>
                {plan.mainTask.text}
              </p>
              {plan.mainTask.page && (
                <button
                  onClick={() => onNavigate(plan!.mainTask.page!)}
                  style={{
                    background: '#00ff00', color: '#000', border: 'none',
                    padding: '8px 20px', cursor: 'pointer',
                    fontFamily: 'Courier New, monospace', fontSize: '11px',
                    fontWeight: 'bold', letterSpacing: '2px', flexShrink: 0,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#00cc00' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#00ff00' }}
                >
                  [ FAZER AGORA ]
                </button>
              )}
            </div>
          </div>

          {/* Main grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '12px' }}>

            {/* Checklist */}
            <div style={panel}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <p style={{ ...dim, margin: 0 }}>✅ CHECKLIST DO DIA</p>
                <span style={{ color: doneCount === totalCount && totalCount > 0 ? '#00ff00' : '#555555', fontSize: '10px', letterSpacing: '1px' }}>
                  {doneCount}/{totalCount} {doneCount === totalCount && totalCount > 0 ? '· COMPLETO' : ''}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {plan.checklist.map(item => {
                  const done = !!checks[item.id]
                  return (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '7px 8px',
                        backgroundColor: done ? '#0a1a0a' : '#080808',
                        border: `1px solid ${done ? '#1a3a1a' : '#1a1a1a'}`,
                        transition: 'background 0.15s, border-color 0.15s',
                      }}
                    >
                      <button
                        onClick={() => toggleCheck(item.id)}
                        style={{
                          width: '14px', height: '14px', flexShrink: 0,
                          border: `1px solid ${done ? '#00ff00' : '#333333'}`,
                          background: done ? '#00ff00' : 'transparent',
                          cursor: 'pointer', padding: 0,
                          color: '#000', fontSize: '10px', fontWeight: 'bold',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        {done ? '✓' : ''}
                      </button>
                      <span style={{
                        flex: 1, color: done ? '#333333' : '#b0b0b0', fontSize: '11px',
                        textDecoration: done ? 'line-through' : 'none', lineHeight: 1.4,
                      }}>
                        {item.text}
                      </span>
                      {item.page && !done && (
                        <button
                          onClick={() => onNavigate(item.page!)}
                          style={{
                            background: 'transparent', border: '1px solid #1a3a1a',
                            color: '#00aa00', fontSize: '9px', padding: '2px 7px',
                            cursor: 'pointer', fontFamily: 'Courier New, monospace',
                            letterSpacing: '0.5px', flexShrink: 0,
                          }}
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

              {/* Weekly goal */}
              <div style={panel}>
                <p style={{ ...dim, marginBottom: '12px' }}>🎯 PROGRESSO · META YPP</p>
                <GoalBar
                  label="SUBSCRIBERS"
                  current={plan.weeklyGoal.subsProgress}
                  target={plan.weeklyGoal.subsTarget}
                  fmt={n => n.toLocaleString()}
                />
                <div style={{ height: '10px' }} />
                <GoalBar
                  label="WATCH TIME"
                  current={plan.weeklyGoal.watchMinutes}
                  target={plan.weeklyGoal.watchTarget}
                  fmt={n => `${Math.round(n / 60).toLocaleString()}h`}
                />
                <p style={{ color: '#2a2a2a', fontSize: '9px', margin: '10px 0 0', letterSpacing: '1px' }}>
                  YPP: 1.000 SUBS + 4.000H WATCH TIME
                </p>
              </div>

            </div>
          </div>
        </>
      )}

    </div>
  )
}

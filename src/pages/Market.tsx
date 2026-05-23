import { useEffect, useState } from 'react'
import type { Page } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface VideoItem {
  title:   string
  channel: string
  views:   number
  flag:    string
  market:  string
  videoId?: string
}

interface HotMarket { gl: string; flag: string; label: string; count: number }

interface NicheResult {
  id:         string
  label:      string
  total:      number
  hotMarket:  HotMarket
  topArtists: string[]
  sample:     VideoItem[]
}

interface MarketResult {
  gl:         string
  label:      string
  flag:       string
  total:      number
  topNiche:   string
  topArtists: string[]
}

interface TypeBeatResult {
  total:            number
  referenceArtists: string[]
}

interface LaisData {
  oportunidade:  { artista: string; nicho: string; mercado: string; porque: string }
  fazerAgora:    { titulo: string; bpm: number | string; tom: string }
  insights:      { nichoCrescendo: string; artistaSubindo: string; evitar: string }
  mercadoQuente: string
}

interface MarketData {
  updatedAt:    string
  niches:       NicheResult[]
  markets:      MarketResult[]
  typeBeat:     TypeBeatResult
  hottestNiche: string
  hottestMarket: { gl: string; flag: string; label: string }
}

// ─── LAIS — chama POST /api/ai/chat como AIChat.tsx ──────────────────────────

async function fetchLAIS(trending: MarketData): Promise<LaisData | null> {
  const monthEn = new Date().toLocaleString('en-US', { month: 'long' })
  const year    = new Date().getFullYear()
  const date    = new Date().toLocaleDateString('pt-BR')

  const topNiches  = trending.niches.slice(0, 4)
    .map(n => `${n.label}: ${n.total} vídeos, top ${n.hotMarket.flag} ${n.hotMarket.label}`)
    .join(' | ')
  const topMarkets = trending.markets.slice(0, 4)
    .map(m => `${m.flag} ${m.label}: ${m.total} vídeos, nicho ${m.topNiche}`)
    .join(' | ')
  const artistaRef = trending.typeBeat.referenceArtists[0]
    || trending.niches[0]?.topArtists?.[0] || '—'
  const typeBeatLine = trending.typeBeat.referenceArtists.slice(0, 6).join(', ') || '—'

  const question = `Dados de mercado YouTube (${date}):
Nichos: ${topNiches}
Mercados: ${topMarkets}
Artistas type beat: ${typeBeatLine}
Artista referência principal: ${artistaRef}
Nicho mais quente: ${trending.niches[0]?.label || '—'}
Mercado mais quente: ${trending.markets[0]?.flag || ''} ${trending.markets[0]?.label || '—'}
Mês: ${monthEn} ${year}

Responde APENAS com JSON válido (sem markdown, sem texto antes ou depois):
{
  "oportunidade": {
    "artista": "<artista real dos dados>",
    "nicho": "<nicho mais quente>",
    "mercado": "<flag + nome do mercado>",
    "porque": "<1 linha com dados reais>"
  },
  "fazerAgora": {
    "titulo": "<[FREE] Artista Type Beat ${monthEn} ${year} - Vibe>",
    "bpm": <número inteiro>,
    "tom": "<ex: A minor>"
  },
  "insights": {
    "nichoCrescendo": "<nicho + quantidade de vídeos>",
    "artistaSubindo": "<artista dos dados + contexto>",
    "evitar": "<nicho com menos resultados>"
  },
  "mercadoQuente": "<flag País · nicho · 1 motivo curto>"
}`

  try {
    const res = await fetch('/api/ai/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ question, context: null, history: [] }),
    })
    if (!res.ok || !res.body) return null

    const reader  = res.body.getReader()
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
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') break outer
        try {
          const evt = JSON.parse(payload)
          if (evt.error) throw new Error(evt.error)
          if (evt.text) full += evt.text
        } catch (e) { if (!(e instanceof SyntaxError)) throw e }
      }
    }

    const m = full.match(/\{[\s\S]*\}/)
    if (!m) return null
    return JSON.parse(m[0])
  } catch { return null }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  backgroundColor: 'var(--bg-card)',
  border: '1px solid var(--border)',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  minHeight: 480,
}

const lbl: React.CSSProperties = {
  color: 'var(--text-faint)',
  fontSize: '9px',
  letterSpacing: '1.5px',
  textTransform: 'uppercase' as const,
  margin: 0,
}

const heading: React.CSSProperties = {
  color: 'var(--accent)',
  fontSize: '11px',
  letterSpacing: '2px',
  margin: '0 0 4px',
}

function fmtNum(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n > 0 ? String(n) : '—'
}

function Divider() {
  return <div style={{ height: 1, backgroundColor: 'var(--border)', opacity: 0.4 }} />
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        fontSize: '10px', letterSpacing: '1px', padding: '3px 8px',
        fontFamily: 'Courier New, monospace',
        color: active ? 'var(--accent)' : 'var(--text-faint)',
        borderBottom: active ? '1px solid var(--accent)' : '1px solid transparent',
        whiteSpace: 'nowrap',
      }}
    >{children}</button>
  )
}

// ─── Card 1: Tendências Globais ───────────────────────────────────────────────

type TrendingTab = 'niches' | 'markets' | 'videos' | 'typebeat'

function CardTrending({ niches, markets, typeBeat }: {
  niches:   NicheResult[]
  markets:  MarketResult[]
  typeBeat: TypeBeatResult
}) {
  const [tab, setTab]             = useState<TrendingTab>('videos')
  const [filterNiche, setFilter]  = useState<string>('all')
  const [minViews, setMinViews]   = useState<number>(0)
  const [hoveredIdx, setHovered]  = useState<number | null>(null)

  const maxNicheTotal = niches[0]?.total || 1
  const maxMktTotal   = markets[0]?.total || 1
  const noData        = niches.every(n => n.total === 0)

  // Header context: ALL = global totals, specific = that niche's hot market
  const ctxNiche  = filterNiche === 'all' ? null : niches.find(n => n.id === filterNiche)
  const ctxMarket = ctxNiche?.hotMarket ?? null

  // Flat video list: global sort by views desc, then apply niche + views filters
  const allVideos: (VideoItem & { nicheLabel: string })[] = niches
    .flatMap(n => n.sample.map(v => ({ ...v, nicheLabel: n.label })))
    .sort((a, b) => b.views - a.views)

  const baseVideos = filterNiche === 'all'
    ? allVideos
    : (niches.find(n => n.id === filterNiche)?.sample ?? [])
        .map(v => ({ ...v, nicheLabel: niches.find(x => x.id === filterNiche)!.label }))
        .sort((a, b) => b.views - a.views)

  const filteredVideos = minViews === 0 ? baseVideos : baseVideos.filter(v => v.views >= minViews)

  const VIEW_FILTERS: { label: string; value: number }[] = [
    { label: 'TODOS', value: 0 },
    { label: '1K+',   value: 1_000 },
    { label: '10K+',  value: 10_000 },
    { label: '100K+', value: 100_000 },
  ]

  return (
    <div style={card}>
      {/* Header */}
      <div>
        <p style={heading}>┌─ TENDÊNCIAS GLOBAIS ────────────</p>
        {noData ? (
          <p style={{ ...lbl, color: 'var(--text-faint)' }}>a pesquisar — aguarda cache</p>
        ) : filterNiche === 'all' ? (
          <p style={{ ...lbl, margin: 0 }}>
            <span style={{ color: 'var(--accent)' }}>TODOS OS NICHOS</span>
            &nbsp;·&nbsp;<span style={{ color: 'var(--accent)' }}>TODOS OS MERCADOS</span>
            &nbsp;·&nbsp;<span style={{ opacity: 0.6 }}>{filteredVideos.length} vídeos</span>
          </p>
        ) : (
          <p style={{ ...lbl, margin: 0 }}>
            nicho: <span style={{ color: 'var(--accent)' }}>{ctxNiche?.label}</span>
            {ctxMarket && <>&nbsp;·&nbsp;mercado: <span style={{ color: 'var(--accent)' }}>{ctxMarket.flag} {ctxMarket.label}</span></>}
            &nbsp;·&nbsp;<span style={{ opacity: 0.6 }}>{filteredVideos.length} vídeos</span>
          </p>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', flexWrap: 'nowrap' }}>
        <TabBtn active={tab === 'videos'}   onClick={() => setTab('videos')}>  [ VÍDEOS ]    </TabBtn>
        <TabBtn active={tab === 'niches'}   onClick={() => setTab('niches')}>  [ NICHOS ]    </TabBtn>
        <TabBtn active={tab === 'markets'}  onClick={() => setTab('markets')}>  [ MERCADOS ]  </TabBtn>
        <TabBtn active={tab === 'typebeat'} onClick={() => setTab('typebeat')}> [ TYPE BEATS ] </TabBtn>
      </div>

      {/* ── VÍDEOS ── */}
      {tab === 'videos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflow: 'hidden' }}>
          {/* Niche filter chips */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button
              onClick={() => setFilter('all')}
              style={{
                fontSize: '9px', padding: '2px 7px', border: `1px solid ${filterNiche === 'all' ? 'var(--accent)' : 'var(--border)'}`,
                background: filterNiche === 'all' ? 'var(--accent-muted)' : 'transparent',
                color: filterNiche === 'all' ? 'var(--accent)' : 'var(--text-faint)',
                cursor: 'pointer', fontFamily: 'Courier New, monospace', letterSpacing: '0.5px',
              }}
            >ALL</button>
            {niches.map(n => (
              <button
                key={n.id}
                onClick={() => setFilter(n.id)}
                style={{
                  fontSize: '9px', padding: '2px 7px', border: `1px solid ${filterNiche === n.id ? 'var(--accent)' : 'var(--border)'}`,
                  background: filterNiche === n.id ? 'var(--accent-muted)' : 'transparent',
                  color: filterNiche === n.id ? 'var(--accent)' : 'var(--text-faint)',
                  cursor: 'pointer', fontFamily: 'Courier New, monospace', letterSpacing: '0.5px',
                }}
              >{n.label}</button>
            ))}
          </div>

          {/* Views filter */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ ...lbl, marginRight: 2 }}>views</span>
            {VIEW_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setMinViews(f.value)}
                style={{
                  fontSize: '9px', padding: '2px 7px',
                  border: `1px solid ${minViews === f.value ? 'var(--accent)' : 'var(--border)'}`,
                  background: minViews === f.value ? 'var(--accent-muted)' : 'transparent',
                  color: minViews === f.value ? 'var(--accent)' : 'var(--text-faint)',
                  cursor: 'pointer', fontFamily: 'Courier New, monospace', letterSpacing: '0.5px',
                }}
              >{f.label}</button>
            ))}
            <span style={{ ...lbl, marginLeft: 4 }}>{filteredVideos.length} resultados</span>
          </div>

          {/* Scrollable video list */}
          <div style={{ overflowY: 'auto', flex: 1, maxHeight: 340, scrollBehavior: 'smooth' }}>
            {filteredVideos.length === 0 ? (
              <p style={{ color: 'var(--text-faint)', fontSize: '10px', padding: '8px 0' }}>sem vídeos</p>
            ) : filteredVideos.map((v, i) => (
              <div
                key={i}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 4px',
                  borderBottom: '1px solid var(--border)',
                  backgroundColor: hoveredIdx === i ? 'rgba(0,255,0,0.04)' : 'transparent',
                  transition: 'background-color 0.12s',
                  cursor: 'default',
                }}
              >
                {/* Rank */}
                <span style={{ color: 'var(--text-faint)', fontSize: '8px', width: 16, flexShrink: 0, textAlign: 'right' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>

                {/* Thumbnail */}
                {v.videoId ? (
                  <img
                    src={`https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`}
                    alt=""
                    style={{ width: 48, height: 27, objectFit: 'cover', flexShrink: 0, opacity: 0.85 }}
                  />
                ) : (
                  <div style={{ width: 48, height: 27, flexShrink: 0, backgroundColor: 'var(--border)', opacity: 0.3 }} />
                )}

                {/* Title + channel */}
                <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
                  <p style={{ color: '#00ff00', fontSize: '10px', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {v.title}
                  </p>
                  <p style={{ color: '#555555', fontSize: '9px', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {v.channel}
                    {filterNiche === 'all' && <span style={{ marginLeft: 6, opacity: 0.6 }}>{v.nicheLabel}</span>}
                  </p>
                </div>

                {/* Views */}
                <span style={{ color: 'var(--accent)', fontSize: '9px', fontWeight: 'bold', flexShrink: 0, minWidth: 36, textAlign: 'right' }}>
                  {fmtNum(v.views)}
                </span>

                {/* Flag badge */}
                <span style={{
                  fontSize: '10px', flexShrink: 0,
                  padding: '1px 4px',
                  border: '1px solid var(--border)',
                  backgroundColor: hoveredIdx === i ? 'rgba(0,255,0,0.06)' : 'transparent',
                }}>
                  {v.flag}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── NICHOS ── */}
      {tab === 'niches' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {niches.map((n, i) => {
            const barPct = Math.round((n.total / maxNicheTotal) * 100)
            const color  = i === 0 ? 'var(--accent)' : i < 3 ? '#aaff00' : 'var(--text-dim)'
            return (
              <div key={n.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ color: 'var(--text-faint)', fontSize: '9px', width: 14, flexShrink: 0, textAlign: 'right' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span style={{ color, fontSize: '11px', flex: 1, fontWeight: i === 0 ? 'bold' : 'normal' }}>
                    {n.label}
                  </span>
                  <span style={{ color: 'var(--text-faint)', fontSize: '9px', flexShrink: 0 }}>
                    {n.hotMarket.flag}&nbsp;{n.hotMarket.label}
                  </span>
                  <span style={{ color, fontSize: '9px', fontWeight: 'bold', flexShrink: 0, minWidth: 28, textAlign: 'right' }}>
                    {n.total}
                  </span>
                </div>
                <div style={{ height: 2, backgroundColor: 'var(--border)', marginLeft: 20 }}>
                  <div style={{ height: '100%', width: `${barPct}%`, backgroundColor: color, transition: 'width 0.4s' }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── MERCADOS ── */}
      {tab === 'markets' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {markets.map((m, i) => {
            const barPct = Math.round((m.total / maxMktTotal) * 100)
            const color  = i === 0 ? 'var(--accent)' : i < 3 ? '#aaff00' : 'var(--text-dim)'
            return (
              <div key={m.gl}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: '12px', flexShrink: 0 }}>{m.flag}</span>
                  <span style={{ color, fontSize: '10px', flex: 1 }}>{m.label}</span>
                  <span style={{ color: 'var(--text-faint)', fontSize: '9px', flexShrink: 0, marginRight: 6 }}>
                    {m.topNiche}
                  </span>
                  <span style={{ color, fontSize: '9px', fontWeight: 'bold', flexShrink: 0, minWidth: 28, textAlign: 'right' }}>
                    {m.total}
                  </span>
                </div>
                <div style={{ height: 1, backgroundColor: 'var(--border)', marginLeft: 22 }}>
                  <div style={{ height: '100%', width: `${barPct}%`, backgroundColor: color, opacity: 0.6, transition: 'width 0.4s' }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── TYPE BEATS ── */}
      {tab === 'typebeat' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <p style={{ ...lbl, marginBottom: 4 }}>artistas mais buscados como referência</p>
          {typeBeat.referenceArtists.length === 0 ? (
            <p style={{ color: 'var(--text-faint)', fontSize: '10px' }}>sem dados</p>
          ) : (
            typeBeat.referenceArtists.map((artist, i) => (
              <div key={artist} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: i < 3 ? 'var(--accent)' : 'var(--text-faint)', fontSize: '9px', width: 16, textAlign: 'right', flexShrink: 0 }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span style={{ color: i < 3 ? 'var(--text-bright)' : 'var(--text-dim)', fontSize: '11px' }}>
                  {artist}
                </span>
              </div>
            ))
          )}
          {typeBeat.total > 0 && (
            <>
              <Divider />
              <p style={{ ...lbl }}>{typeBeat.total} ocorrências · US · UK · Canada</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Card 2: LAIS ─────────────────────────────────────────────────────────────

function CardLAIS({ data, loading, onSchedule }: { data: LaisData | null; loading?: boolean; onSchedule?: (title: string) => void }) {
  const [btnHover, setBtnHover] = useState(false)

  if (loading && !data) return (
    <div style={card}>
      <p style={heading}>┌─ LAIS · RADAR DE MERCADO ─</p>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <p style={{ color: 'var(--text-faint)', fontSize: '10px', letterSpacing: '2px' }}>
          A ANALISAR MERCADO<span className="blink">_</span>
        </p>
        <p style={{ color: 'var(--text-faint)', fontSize: '9px', opacity: 0.5 }}>via /api/ai/chat</p>
      </div>
    </div>
  )

  if (!data) return (
    <div style={card}>
      <p style={heading}>┌─ LAIS · RADAR DE MERCADO ─</p>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-faint)', fontSize: '10px', letterSpacing: '1px' }}>
          sem dados — aguarda mercado carregar
        </p>
      </div>
    </div>
  )

  const sectionLbl: React.CSSProperties = { ...lbl, color: 'var(--accent)', marginBottom: 6 }

  return (
    <div style={card}>
      <p style={heading}>┌─ LAIS · RADAR DE MERCADO ─</p>

      {/* 🎯 OPORTUNIDADE */}
      <div style={{ padding: '12px', backgroundColor: 'var(--accent-muted)', border: '1px solid var(--accent-border)' }}>
        <p style={sectionLbl}>🎯 OPORTUNIDADE DA SEMANA</p>
        <p style={{ color: 'var(--text-bright)', fontSize: '11px', margin: '0 0 4px', fontWeight: 'bold' }}>
          {data.oportunidade.artista}&nbsp;·&nbsp;{data.oportunidade.nicho}&nbsp;·&nbsp;{data.oportunidade.mercado}
        </p>
        <p style={{ color: 'var(--text-dim)', fontSize: '10px', margin: 0, lineHeight: 1.6 }}>
          Por quê: {data.oportunidade.porque}
        </p>
      </div>

      {/* ⚡ FAZER AGORA */}
      <div style={{ padding: '12px', backgroundColor: '#0a0a0a', border: '1px solid var(--border)' }}>
        <p style={{ ...lbl, color: '#ffcc00', marginBottom: 6 }}>⚡ FAZER AGORA</p>
        <p style={{ color: '#00ff00', fontSize: '11px', margin: '0 0 4px', fontStyle: 'italic' }}>
          "{data.fazerAgora.titulo}"
        </p>
        <p style={{ color: 'var(--text-faint)', fontSize: '10px', margin: '0 0 8px' }}>
          BPM sugerido: <span style={{ color: 'var(--text-dim)' }}>{data.fazerAgora.bpm}</span>
          &nbsp;|&nbsp;Tom: <span style={{ color: 'var(--text-dim)' }}>{data.fazerAgora.tom}</span>
        </p>
        {onSchedule && (
          <button
            onClick={() => onSchedule(data.fazerAgora.titulo)}
            onMouseEnter={() => setBtnHover(true)}
            onMouseLeave={() => setBtnHover(false)}
            style={{
              background: btnHover ? 'var(--accent-muted)' : 'transparent',
              border: '1px solid var(--accent-border)',
              color: 'var(--accent)',
              fontSize: '10px', padding: '4px 10px',
              cursor: 'pointer', fontFamily: 'Courier New, monospace',
              letterSpacing: '1px', transition: 'background 0.12s',
            }}
          >[ CRIAR NO SCHEDULER ]</button>
        )}
      </div>

      {/* 📊 INSIGHTS */}
      <div style={{ padding: '12px', backgroundColor: '#0a0a0a', border: '1px solid var(--border)' }}>
        <p style={{ ...lbl, marginBottom: 8 }}>📊 INSIGHTS</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <p style={{ color: 'var(--text-dim)', fontSize: '10px', margin: 0 }}>
            <span style={{ color: '#00ff00' }}>+</span> Nicho mais quente: {data.insights.nichoCrescendo}
          </p>
          <p style={{ color: 'var(--text-dim)', fontSize: '10px', margin: 0 }}>
            <span style={{ color: '#00ff00' }}>+</span> Artista subindo: {data.insights.artistaSubindo}
          </p>
          <p style={{ color: 'var(--text-dim)', fontSize: '10px', margin: 0 }}>
            <span style={{ color: '#ff4444' }}>–</span> Evitar: {data.insights.evitar}
          </p>
        </div>
      </div>

      {/* 🌍 MERCADO MAIS QUENTE */}
      <div style={{ padding: '10px 12px', border: '1px solid var(--border)', backgroundColor: '#050505' }}>
        <p style={{ ...lbl, marginBottom: 4 }}>🌍 MERCADO MAIS QUENTE</p>
        <p style={{ color: 'var(--text-dim)', fontSize: '10px', margin: 0, lineHeight: 1.6 }}>
          {data.mercadoQuente}
        </p>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function Market({ onNavigate }: { onNavigate?: (page: Page) => void }) {
  const [data, setData]           = useState<MarketData | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [laisData, setLaisData]   = useState<LaisData | null>(null)
  const [laisLoading, setLaisLoading] = useState(false)

  const load = (bust = false) => {
    setLoading(true)
    setError('')
    setLaisData(null)
    fetch(`/api/market${bust ? '?bust=1' : ''}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!data || !data.niches.some(n => n.total > 0)) return
    setLaisLoading(true)
    fetchLAIS(data)
      .then(setLaisData)
      .catch(() => setLaisData(null))
      .finally(() => setLaisLoading(false))
  }, [data])

  const updatedLabel = data?.updatedAt
    ? new Date(data.updatedAt).toLocaleString('pt', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null

  const totalVideos = data?.niches.reduce((s, n) => s + n.total, 0) ?? 0

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <p style={{ color: 'var(--accent)', fontSize: '11px', letterSpacing: '2px', margin: '0 0 4px', opacity: 0.8 }}>
            ┌─ MERCADO · INTELIGÊNCIA DE VENDAS ─────────────────────
          </p>
          <p style={{ color: 'var(--text-faint)', fontSize: '10px', margin: 0, letterSpacing: '0.5px' }}>
            {data
              ? `${totalVideos.toLocaleString('pt')} vídeos analisados · 27 nichos · 23 mercados · cache 24h`
              : '27 nichos × 23 mercados · Americas · Europa · África · Ásia · Oceania · cache 24h'}
            {updatedLabel && <span style={{ marginLeft: 12, opacity: 0.6 }}>actualizado {updatedLabel}</span>}
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading}
          style={{
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-faint)',
            fontSize: '10px', padding: '5px 14px', cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: 'Courier New, monospace', letterSpacing: '1px',
          }}
          onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLElement).style.color = 'var(--accent)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-faint)' }}
        >
          {loading ? '[ A CARREGAR... ]' : '[ ATUALIZAR ]'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', border: '1px solid #ff4444', backgroundColor: '#1a0000' }}>
          <p style={{ color: '#ff4444', fontSize: '11px', margin: 0 }}>⚠ {error}</p>
        </div>
      )}

      {loading && !data ? (
        <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '12px' }}>
          {[0, 1].map(i => (
            <div key={i} style={{ ...card, alignItems: 'center', justifyContent: 'center' }}>
              <p style={{ color: 'var(--text-faint)', fontSize: '10px', letterSpacing: '2px' }}>
                A CARREGAR<span className="blink">_</span>
              </p>
            </div>
          ))}
        </div>
      ) : data ? (
        <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '12px' }}>
          <CardTrending
            niches={data.niches}
            markets={data.markets}
            typeBeat={data.typeBeat}
          />
          <CardLAIS
            data={laisData}
            loading={laisLoading}
            onSchedule={onNavigate ? (_title) => { onNavigate('scheduler') } : undefined}
          />
        </div>
      ) : null}

    </div>
  )
}

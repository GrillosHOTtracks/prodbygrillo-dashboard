import { useEffect, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface YTData {
  total:      number
  topVibes:   string[]
  topArtists: string[]
  topGenres:  string[]
  sample:     { title: string; channel: string }[]
}

interface BeatStarsTrack { title: string; plays: number; likes: number; sales: number }

interface BeatStarsData {
  topPlayed:   BeatStarsTrack[]
  topLiked:    BeatStarsTrack[]
  topSold:     BeatStarsTrack[] | null
  totalTracks: number
  totalPlays:  number
  totalLikes:  number
}

interface LaisData {
  pulseMercado: string
  melhorMatch:  string
  proximoBeat:  string
}

interface MarketData {
  updatedAt: string
  ytBR:      YTData
  ytUS:      YTData
  beatstars: BeatStarsData | null
  lais:      LaisData | null
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  backgroundColor: 'var(--bg-card)',
  border: '1px solid var(--border)',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  minHeight: 420,
}

const label: React.CSSProperties = {
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
  return String(n)
}

function Vibe({ text }: { text: string }) {
  return (
    <span style={{ fontSize: '9px', padding: '2px 7px', border: '1px solid var(--border)', color: 'var(--text-dim)', letterSpacing: '0.5px' }}>
      {text}
    </span>
  )
}

function Divider() {
  return <div style={{ height: 1, backgroundColor: 'var(--border)', opacity: 0.5 }} />
}

// ─── Card 1: YouTube Trending ─────────────────────────────────────────────────

function CardYouTube({ ytBR, ytUS }: { ytBR: YTData; ytUS: YTData }) {
  const [geo, setGeo] = useState<'BR' | 'US'>('BR')
  const data = geo === 'BR' ? ytBR : ytUS

  const tabBtn = (id: typeof geo, label: string) => (
    <button
      onClick={() => setGeo(id)}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        fontSize: '10px', letterSpacing: '1px', padding: '3px 10px',
        fontFamily: 'Courier New, monospace',
        color: geo === id ? 'var(--accent)' : 'var(--text-faint)',
        borderBottom: geo === id ? '1px solid var(--accent)' : '1px solid transparent',
      }}
    >{label}</button>
  )

  return (
    <div style={card}>
      <div>
        <p style={heading}>┌─ YOUTUBE TRENDING ──────────────</p>
        <p style={{ ...label, margin: 0 }}>{data.total} músicas analisadas agora</p>
      </div>

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
        {tabBtn('BR', '[ BRASIL ]')}
        {tabBtn('US', '[ US ]')}
      </div>

      <div>
        <p style={label}>vibes dominantes</p>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
          {data.topVibes.length ? data.topVibes.map(v => <Vibe key={v} text={v} />) : <span style={{ color: 'var(--text-faint)', fontSize: '10px' }}>—</span>}
        </div>
      </div>

      {data.topGenres.length > 0 && (
        <div>
          <p style={label}>géneros locais</p>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
            {data.topGenres.map(g => <Vibe key={g} text={g} />)}
          </div>
        </div>
      )}

      <Divider />

      <div>
        <p style={{ ...label, marginBottom: 8 }}>top artistas</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.topArtists.slice(0, 8).map((a, i) => (
            <div key={a} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: i < 3 ? 'var(--accent)' : 'var(--text-faint)', fontSize: '9px', width: 16, textAlign: 'right', flexShrink: 0 }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>{a}</span>
            </div>
          ))}
        </div>
      </div>

      {data.sample.length > 0 && (
        <>
          <Divider />
          <div>
            <p style={{ ...label, marginBottom: 6 }}>sample de títulos</p>
            {data.sample.slice(0, 4).map((s, i) => (
              <p key={i} style={{ color: 'var(--text-faint)', fontSize: '9px', margin: '3px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                · {s.title}
              </p>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Card 2: BeatStars ────────────────────────────────────────────────────────

function CardBeatStars({ data }: { data: BeatStarsData | null }) {
  if (!data) return (
    <div style={card}>
      <p style={heading}>┌─ BEATSTARS · PRODBYGRILLO ──────</p>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-faint)', fontSize: '10px', textAlign: 'center', letterSpacing: '1px' }}>
          DADOS INDISPONÍVEIS<br/>
          <span style={{ fontSize: '9px', opacity: 0.6 }}>BeatStars usa JS rendering</span>
        </p>
      </div>
    </div>
  )

  const [tab, setTab] = useState<'plays' | 'likes' | 'sales'>('plays')
  const tracks = tab === 'plays' ? data.topPlayed : tab === 'likes' ? data.topLiked : data.topSold || []
  const statKey = tab === 'plays' ? 'plays' : tab === 'likes' ? 'likes' : 'sales'
  const maxVal  = Math.max(...tracks.map(t => t[statKey] || 0), 1)

  const tabBtn = (id: typeof tab, lbl: string, disabled?: boolean) => (
    <button
      onClick={() => !disabled && setTab(id)}
      disabled={disabled}
      style={{
        background: 'transparent', border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: '10px', letterSpacing: '1px', padding: '3px 10px',
        fontFamily: 'Courier New, monospace',
        color: disabled ? 'var(--text-faint)' : tab === id ? 'var(--accent)' : 'var(--text-faint)',
        borderBottom: tab === id && !disabled ? '1px solid var(--accent)' : '1px solid transparent',
        opacity: disabled ? 0.4 : 1,
      }}
    >{lbl}</button>
  )

  return (
    <div style={card}>
      <div>
        <p style={heading}>┌─ BEATSTARS · PRODBYGRILLO ──────</p>
        <div style={{ display: 'flex', gap: '16px' }}>
          <span style={{ color: 'var(--text-dim)', fontSize: '10px' }}>{data.totalTracks} beats</span>
          <span style={{ color: 'var(--text-dim)', fontSize: '10px' }}>{fmtNum(data.totalPlays)} plays</span>
          <span style={{ color: 'var(--text-dim)', fontSize: '10px' }}>{fmtNum(data.totalLikes)} likes</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
        {tabBtn('plays', '[ MAIS OUVIDOS ]')}
        {tabBtn('likes', '[ MAIS CURTIDOS ]')}
        {tabBtn('sales', '[ MAIS VENDIDOS ]', !data.topSold?.length)}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tracks.map((t, i) => {
          const val   = t[statKey] || 0
          const pct   = Math.round((val / maxVal) * 100)
          const color = i === 0 ? 'var(--accent)' : i < 3 ? '#aaff00' : 'var(--text-dim)'
          return (
            <div key={t.title}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ color: 'var(--text-bright)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>
                  {String(i + 1).padStart(2, '0')} · {t.title}
                </span>
                <span style={{ color, fontSize: '10px', fontWeight: 'bold', flexShrink: 0, marginLeft: 8 }}>
                  {fmtNum(val)}
                </span>
              </div>
              <div style={{ height: 2, backgroundColor: 'var(--border)' }}>
                <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, transition: 'width 0.4s' }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Card 3: LAIS Recommendation ─────────────────────────────────────────────

function CardLAIS({ data, loading }: { data: LaisData | null; loading: boolean }) {
  if (loading) return (
    <div style={{ ...card, alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'var(--text-faint)', fontSize: '11px', letterSpacing: '2px' }}>
        LAIS A ANALISAR<span className="blink">_</span>
      </p>
    </div>
  )

  if (!data) return (
    <div style={card}>
      <p style={heading}>┌─ LAIS · INTELIGÊNCIA DE MERCADO ─</p>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-faint)', fontSize: '10px', letterSpacing: '1px' }}>
          GROQ_API_KEY NÃO CONFIGURADA
        </p>
      </div>
    </div>
  )

  const sections = [
    { key: '📡 MERCADO ESTA SEMANA', text: data.pulseMercado },
    { key: '🎯 MELHOR MATCH DO TEU CATÁLOGO', text: data.melhorMatch },
    { key: '🔥 PRÓXIMO BEAT RECOMENDADO', text: data.proximoBeat },
  ]

  return (
    <div style={card}>
      <p style={heading}>┌─ LAIS · INTELIGÊNCIA DE MERCADO ─</p>

      {sections.map((s, i) => (
        <div key={i} style={{ padding: '12px', backgroundColor: i === 2 ? 'var(--accent-muted)' : '#0a0a0a', border: `1px solid ${i === 2 ? 'var(--accent-border)' : 'var(--border)'}` }}>
          <p style={{ ...label, marginBottom: 6, color: i === 2 ? 'var(--accent)' : 'var(--text-faint)' }}>
            {s.key}
          </p>
          <p style={{ color: i === 2 ? 'var(--text-bright)' : 'var(--text-dim)', fontSize: '11px', lineHeight: 1.7, margin: 0 }}>
            {s.text}
          </p>
        </div>
      ))}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function Market() {
  const [data, setData]       = useState<MarketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  const load = (bust = false) => {
    setLoading(true)
    setError('')
    fetch(`/api/market${bust ? '?bust=1' : ''}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  const updatedLabel = data?.updatedAt
    ? new Date(data.updatedAt).toLocaleString('pt', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <p style={{ color: 'var(--accent)', fontSize: '11px', letterSpacing: '2px', margin: '0 0 4px', opacity: 0.8 }}>
            ┌─ MERCADO · INTELIGÊNCIA DE VENDAS ─────────────────────
          </p>
          <p style={{ color: 'var(--text-faint)', fontSize: '10px', margin: 0, letterSpacing: '0.5px' }}>
            YouTube Trending (BR + US) · BeatStars · LAIS · cache 24h
            {updatedLabel && <span style={{ marginLeft: 12, color: 'var(--text-faint)', opacity: 0.6 }}>actualizado {updatedLabel}</span>}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ ...card, alignItems: 'center', justifyContent: 'center' }}>
              <p style={{ color: 'var(--text-faint)', fontSize: '10px', letterSpacing: '2px' }}>
                A CARREGAR<span className="blink">_</span>
              </p>
            </div>
          ))}
        </div>
      ) : data ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          <CardYouTube ytBR={data.ytBR} ytUS={data.ytUS} />
          <CardBeatStars data={data.beatstars} />
          <CardLAIS data={data.lais} loading={false} />
        </div>
      ) : null}

    </div>
  )
}

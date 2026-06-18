import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import type { GenreTrend } from '../lib/api'
import type { Page } from '../types'

type SortKey = 'opportunityScore' | 'avgViews' | 'beatCount'
type FilterSat = 'all' | 'low' | 'medium' | 'high'

const SAT_LABEL: Record<string, string> = { low: 'BAIXO', medium: 'MÉDIO', high: 'ALTO' }
const SAT_COLOR: Record<string, string> = { low: '#00ff00', medium: '#ffaa00', high: '#ff4444' }

interface MarketProps {
  onNavigate?: (page: Page) => void
  onUseInScheduler?: (artist: string) => void
}

export function Market({ onUseInScheduler }: MarketProps) {
  const [data,    setData]    = useState<GenreTrend[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [sort,    setSort]    = useState<SortKey>('opportunityScore')
  const [filter,  setFilter]  = useState<FilterSat>('all')
  const [busting, setBusting] = useState(false)

  const load = useCallback((bust = false) => {
    setLoading(true)
    setError(null)
    api.market(bust)
      .then(setData)
      .catch(err => setError(err.message || 'Erro ao carregar'))
      .finally(() => { setLoading(false); setBusting(false) })
  }, [])

  useEffect(() => { load() }, [load])

  function refresh() { setBusting(true); load(true) }

  const displayed = (data ?? [])
    .filter(g => filter === 'all' || g.saturation === filter)
    .slice()
    .sort((a, b) => (b[sort] as number) - (a[sort] as number))

  return (
    <div style={{ fontFamily: 'Courier New, monospace', color: 'var(--text)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ color: 'var(--accent)', fontSize: '13px', letterSpacing: '2px', margin: 0 }}>MARKET ANALYSIS</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: '10px', margin: '2px 0 0', letterSpacing: '0.5px' }}>
            {data ? `${data.length} GÉNEROS · CACHE 2H` : 'CARREGANDO...'}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={busting || loading}
          style={{
            background: 'transparent', border: '1px solid var(--border)',
            color: busting ? 'var(--text-faint)' : 'var(--accent)',
            fontFamily: 'Courier New, monospace', fontSize: '10px',
            letterSpacing: '1px', padding: '5px 12px', cursor: busting ? 'wait' : 'pointer',
          }}
        >
          {busting ? '[ ATUALIZANDO... ]' : '[ ATUALIZAR ]'}
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-faint)', fontSize: '10px', alignSelf: 'center', letterSpacing: '1px' }}>SATURAÇÃO:</span>
        {(['all', 'low', 'medium', 'high'] as FilterSat[]).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            background: filter === f ? 'var(--accent-muted)' : 'transparent',
            border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border)'}`,
            color: filter === f ? 'var(--accent)' : 'var(--text-dim)',
            fontFamily: 'Courier New, monospace', fontSize: '10px',
            padding: '4px 10px', cursor: 'pointer', letterSpacing: '0.5px',
          }}>
            {f === 'all' ? 'TODOS' : SAT_LABEL[f]}
          </button>
        ))}
        <span style={{ color: 'var(--text-faint)', fontSize: '10px', alignSelf: 'center', letterSpacing: '1px', marginLeft: '8px' }}>ORDENAR:</span>
        {([
          ['opportunityScore', 'OPORTUNIDADE'],
          ['avgViews',         'MEDIA VIEWS'],
          ['beatCount',        'BEATS'],
        ] as [SortKey, string][]).map(([key, lbl]) => (
          <button key={key} onClick={() => setSort(key)} style={{
            background: sort === key ? 'var(--accent-muted)' : 'transparent',
            border: `1px solid ${sort === key ? 'var(--accent)' : 'var(--border)'}`,
            color: sort === key ? 'var(--accent)' : 'var(--text-dim)',
            fontFamily: 'Courier New, monospace', fontSize: '10px',
            padding: '4px 10px', cursor: 'pointer', letterSpacing: '0.5px',
          }}>{lbl}</button>
        ))}
      </div>

      {/* States */}
      {loading && !data && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <p style={{ color: 'var(--accent)', fontSize: '12px', marginBottom: '8px' }}>&gt; ANALISANDO MERCADO...</p>
          <p style={{ color: 'var(--text-faint)', fontSize: '10px' }}>{'█'.repeat(14)}<span className="blink">█</span></p>
          <p style={{ color: 'var(--text-faint)', fontSize: '10px', marginTop: '8px' }}>Pode demorar 15–30s na primeira vez</p>
        </div>
      )}

      {error && (
        <div style={{ border: '1px solid #ff4444', padding: '12px 16px', marginBottom: '16px' }}>
          <p style={{ color: '#ff4444', fontSize: '11px', margin: 0 }}>&gt; ERRO: {error}</p>
        </div>
      )}

      {/* Grid */}
      {displayed.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
          {displayed.map(g => (
            <GenreCard key={g.id} genre={g} onSchedule={onUseInScheduler} />
          ))}
        </div>
      )}

      {!loading && !error && displayed.length === 0 && data && (
        <p style={{ color: 'var(--text-faint)', fontSize: '11px', textAlign: 'center', marginTop: '40px' }}>
          Nenhum género com filtro selecionado.
        </p>
      )}
    </div>
  )
}

// ─── Genre Card ───────────────────────────────────────────────────────────────

function GenreCard({ genre: g, onSchedule }: { genre: GenreTrend; onSchedule?: (artist: string) => void }) {
  const satColor = SAT_COLOR[g.saturation]
  const score    = g.opportunityScore

  return (
    <div style={{
      backgroundColor: 'var(--bg-card)',
      border: '1px solid var(--border)',
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    }}>

      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--accent)', fontSize: '13px', fontWeight: 'bold', letterSpacing: '1.5px' }}>
          {g.label.toUpperCase()}
        </span>
        {g.hotTag && (
          <span style={{ fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '0.5px' }}>{g.hotTag}</span>
        )}
      </div>

      {/* Score bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ color: 'var(--text-faint)', fontSize: '9px', letterSpacing: '1px' }}>OPORTUNIDADE</span>
          <span style={{ color: score >= 70 ? 'var(--accent)' : score >= 40 ? '#ffaa00' : '#ff4444', fontSize: '11px', fontWeight: 'bold' }}>{score}</span>
        </div>
        <div style={{ height: '3px', backgroundColor: 'var(--border)', width: '100%' }}>
          <div style={{ height: '3px', width: `${score}%`, backgroundColor: score >= 70 ? 'var(--accent)' : score >= 40 ? '#ffaa00' : '#ff4444', transition: 'width 0.4s' }} />
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '16px' }}>
        <StatPill label="SATURAÇÃO" value={SAT_LABEL[g.saturation]} color={satColor} />
        <StatPill label="MÉDIA VIEWS" value={fmtViews(g.avgViews)} color="var(--text)" />
        <StatPill label="BEATS" value={String(g.beatCount)} color="var(--text-dim)" />
      </div>

      {/* Top artists */}
      {g.topArtists.length > 0 && (
        <div>
          <p style={{ color: 'var(--text-faint)', fontSize: '9px', letterSpacing: '1px', margin: '0 0 6px' }}>TOP ARTISTAS</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
            {g.topArtists.map(artist => (
              <button
                key={artist}
                onClick={() => onSchedule?.(artist)}
                title={`Usar ${artist} no Scheduler`}
                style={{
                  background: 'var(--bg-hover)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-dim)',
                  fontFamily: 'Courier New, monospace',
                  fontSize: '10px', padding: '3px 8px',
                  cursor: onSchedule ? 'pointer' : 'default',
                  letterSpacing: '0.3px',
                  transition: 'color 0.15s, border-color 0.15s',
                }}
                onMouseEnter={e => {
                  if (onSchedule) {
                    const el = e.currentTarget as HTMLElement
                    el.style.color = 'var(--accent)'
                    el.style.borderColor = 'var(--accent)'
                  }
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLElement
                  el.style.color = 'var(--text-dim)'
                  el.style.borderColor = 'var(--border)'
                }}
              >
                {artist}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Beat idea */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
        <p style={{ color: 'var(--text-faint)', fontSize: '9px', letterSpacing: '1px', margin: '0 0 5px' }}>BEAT IDEA</p>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '4px' }}>
          <Tag>{g.beatIdea.bpm} BPM</Tag>
          {g.beatIdea.keys.slice(0, 2).map(k => <Tag key={k}>{k}</Tag>)}
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: '10px', margin: 0, lineHeight: '1.5' }}>
          {g.beatIdea.elements.join(' · ')}
        </p>
      </div>
    </div>
  )
}

function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <p style={{ color: 'var(--text-faint)', fontSize: '9px', letterSpacing: '1px', margin: '0 0 2px' }}>{label}</p>
      <p style={{ color, fontSize: '11px', margin: 0, fontWeight: 'bold' }}>{value}</p>
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      background: 'var(--bg)', border: '1px solid var(--border)',
      color: 'var(--text-faint)', fontSize: '9px',
      padding: '2px 6px', letterSpacing: '0.5px',
    }}>{children}</span>
  )
}

function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

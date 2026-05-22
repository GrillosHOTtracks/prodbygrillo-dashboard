import { useState, useMemo, useEffect, useRef } from 'react'
import { VideoTable } from '../components/VideoTable'
import { SkeletonTable, SkeletonCard } from '../components/ui/Skeleton'
import { fmtNum } from '../utils/format'
import type { Video } from '../types'
import type { Video as ApiVideo } from '../lib/api'

function apiVideoToLocal(v: ApiVideo): Video {
  return {
    id: v.id, title: v.title, thumbnail: '▶',
    views: v.views, watchTime: v.watchTime, likes: v.likes,
    comments: v.comments, ctr: v.ctr, avgDuration: v.avgDuration,
    publishedAt: v.publishedAt, revenue: v.revenue,
    status: v.status as Video['status'],
  }
}

type SortKey = keyof Pick<Video, 'views' | 'watchTime' | 'likes' | 'ctr' | 'revenue' | 'publishedAt'>

const panel: React.CSSProperties = {
  backgroundColor: 'var(--bg-card)',
  border: '1px solid var(--border)',
  padding: '14px',
  transition: `border-color var(--t-fast)`,
}

const fieldStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  padding: '5px 10px',
  fontSize: '12px',
  outline: 'none',
  fontFamily: 'Courier New, monospace',
  transition: `border-color var(--t-fast), box-shadow var(--t-fast)`,
}

// ─── Empty state — vinyl + piano ASCII art ────────────────────────────────────
function VideosEmptyState() {
  const [frame, setFrame] = useState(0)
  const raf = useRef<number | null>(null)
  const lastRef = useRef(0)

  useEffect(() => {
    let f = 0
    function tick(ts: number) {
      if (ts - lastRef.current > 120) { f = (f + 1) % 8; setFrame(f); lastRef.current = ts }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [])

  const vinyl = [
    '        .·:·:·:·:·:·:·:·.',
    '     .·:·:·:·:·:·:·:·:·:·:·.',
    '   .·:·:·:·:·:·:·:·:·:·:·:·:·.',
    '  ·:·:·:·:·:·:·:·:·:·:·:·:·:·:·',
    ' ·:·:·:·:·:· (( ● )) ·:·:·:·:·:·',
    '  ·:·:·:·:·:·:·:·:·:·:·:·:·:·:·',
    '   \'·:·:·:·:·:·:·:·:·:·:·:·:·\'',
    '     \'·:·:·:·:·:·:·:·:·:·:\'',
    '        \'·:·:·:·:·:·:·\'',
  ]

  const pianoKeys = '  |  | |  | |  | |  | |  | |  | |  |  '
  const pianoBlack = [false,true,false,true,false,false,true,false,true,false,true,false]

  // Spinning dots simulate vinyl rotation
  const spinChars = ['◜','◝','◞','◟','◜','◝','◞','◟']
  const spin = spinChars[frame]

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '60vh', fontFamily: 'Courier New, monospace',
    }}>
      {/* Vinyl */}
      <div style={{ position: 'relative', marginBottom: '32px' }}>
        <pre style={{
          color: '#00ff00', fontSize: '13px', lineHeight: '1.55',
          margin: 0, textShadow: '0 0 8px #00ff0055', letterSpacing: '0px',
          userSelect: 'none',
        }}>
          {vinyl.map((line, i) => {
            if (i === 4) {
              return line.replace('●', spin) + '\n'
            }
            return line + '\n'
          }).join('')}
        </pre>
        {/* Glow ring */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at center, #00ff0008 0%, transparent 70%)',
        }} />
      </div>

      {/* Piano keys */}
      <div style={{ marginBottom: '28px', userSelect: 'none' }}>
        <div style={{ display: 'flex', gap: '2px' }}>
          {pianoBlack.map((isBlack, i) => (
            <div key={i} style={{
              width: isBlack ? '14px' : '20px',
              height: isBlack ? '40px' : '64px',
              backgroundColor: isBlack ? '#111' : '#0a1a0a',
              border: isBlack ? '1px solid #00ff0044' : '1px solid #00ff0077',
              borderRadius: '0 0 3px 3px',
              boxShadow: isBlack ? 'none' : '0 0 4px #00ff0022',
              zIndex: isBlack ? 2 : 1,
              position: 'relative',
              alignSelf: 'flex-start',
            }} />
          ))}
        </div>
        <p style={{ color: '#00ff0033', fontSize: '9px', letterSpacing: '3px', textAlign: 'center', marginTop: '8px' }}>
          {pianoKeys}
        </p>
      </div>

      {/* Label */}
      <p style={{
        color: '#00ff00', fontSize: '11px', letterSpacing: '3px',
        opacity: 0.6, margin: '0 0 6px', textShadow: '0 0 6px #00ff0044',
      }}>
        ┌─ NO VIDEOS LOADED ─────────────────┐
      </p>
      <p style={{
        color: '#00ff0088', fontSize: '10px', letterSpacing: '2px', margin: 0,
      }}>
        connect · authenticate · stream
      </p>
    </div>
  )
}

export function Videos({ realVideos, loading }: { realVideos?: ApiVideo[] | null; loading?: boolean }) {
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('views')

  const allVideos = useMemo(
    () => realVideos?.map(apiVideoToLocal) ?? [],
    [realVideos],
  )

  const filtered = useMemo(
    () => allVideos
      .filter(v => v.title.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        if (sortBy === 'publishedAt') return b.publishedAt.localeCompare(a.publishedAt)
        return (b[sortBy] as number) - (a[sortBy] as number)
      }),
    [allVideos, search, sortBy],
  )

  const stats = useMemo(() => ({
    total:   allVideos.length,
    views:   allVideos.reduce((s, v) => s + v.views, 0),
    revenue: allVideos.reduce((s, v) => s + v.revenue, 0),
    avgCtr:  allVideos.length
      ? allVideos.reduce((s, v) => s + v.ctr, 0) / allVideos.length
      : 0,
  }), [allVideos])

  if (loading) {
    return (
      <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} height="28px" />)}
        </div>
        <div style={panel}><SkeletonTable rows={8} /></div>
      </div>
    )
  }

  if (!loading && (!realVideos || realVideos.length === 0)) {
    return <VideosEmptyState />
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* Source tag */}
      {realVideos && (
        <p style={{ color: 'var(--text-faint)', fontSize: '10px', margin: 0, letterSpacing: '1px' }}>
          ● LIVE DATA — {realVideos.length} VIDEOS FROM YOUTUBE API
        </p>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: 'var(--text-dim)', fontSize: '11px', letterSpacing: '0.5px' }}>SEARCH:</span>
        <input
          type="text"
          placeholder="filter videos..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...fieldStyle, width: '220px' }}
          onFocus={e => {
            const el = e.currentTarget
            el.style.borderColor = 'var(--accent-border)'
            el.style.boxShadow = 'var(--glow-xs)'
          }}
          onBlur={e => {
            const el = e.currentTarget
            el.style.borderColor = 'var(--border)'
            el.style.boxShadow = 'none'
          }}
        />
        <span style={{ color: 'var(--text-dim)', fontSize: '11px', letterSpacing: '0.5px' }}>SORT:</span>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortKey)}
          style={{ ...fieldStyle, cursor: 'pointer' }}
        >
          <option value="views">VIEWS</option>
          <option value="watchTime">WATCH TIME</option>
          <option value="likes">LIKES</option>
          <option value="ctr">CTR</option>
          <option value="revenue">REVENUE</option>
          <option value="publishedAt">DATE</option>
        </select>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
        {[
          { label: 'TOTAL VIDEOS',  value: stats.total.toString() },
          { label: 'TOTAL VIEWS',   value: fmtNum(stats.views) },
          { label: 'TOTAL REVENUE', value: `$${stats.revenue.toFixed(0)}` },
          { label: 'AVG CTR',       value: stats.avgCtr > 0 ? `${stats.avgCtr.toFixed(1)}%` : '—' },
        ].map(stat => (
          <div key={stat.label} style={panel}>
            <p style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '1px', margin: 0 }}>{stat.label}</p>
            <p style={{ color: 'var(--text-bright)', fontSize: '20px', fontWeight: 'bold', margin: '4px 0 0' }}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={panel}>
        <p style={{ color: 'var(--accent)', fontSize: '11px', letterSpacing: '1px', marginBottom: '10px', opacity: 0.8 }}>
          ┌─ VIDEO LIST ({filtered.length} results) ────────────────────────
        </p>
        <VideoTable videos={filtered} />
      </div>

    </div>
  )
}

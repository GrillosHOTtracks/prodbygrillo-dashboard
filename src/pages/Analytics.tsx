import { useMemo } from 'react'
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { SkeletonCard } from '../components/ui/Skeleton'
import { fmtNumFull, fmtSecs, fmtPct } from '../utils/format'
import type { DailyMetric } from '../types'

const panel: React.CSSProperties = {
  backgroundColor: 'var(--bg-card)',
  border: '1px solid var(--border)',
  padding: '14px',
  transition: `border-color var(--t-fast)`,
}

const TT = ({ active, payload, label, unit }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)',
      padding: '8px 12px', fontSize: '12px', fontFamily: 'Courier New, monospace',
      boxShadow: 'var(--glow-xs)',
    }}>
      <p style={{ color: 'var(--text-dim)' }}>{label}</p>
      {payload.map((e: any) => (
        <p key={e.name} style={{ color: 'var(--text-bright)', fontWeight: 'bold' }}>
          &gt; {unit === '$' ? `$${e.value.toFixed(2)}` : `${e.value.toLocaleString()}${unit || ''}`}
        </p>
      ))}
    </div>
  )
}

function MiniChart({ data, dataKey, title, total, unit = '' }: {
  data: DailyMetric[]; dataKey: keyof DailyMetric
  title: string; total: string; unit?: string
}) {
  return (
    <div style={panel}>
      <p style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '1px', margin: '0 0 2px' }}>{title}</p>
      <p style={{ color: 'var(--text-bright)', fontSize: '22px', fontWeight: 'bold', margin: '0 0 10px', letterSpacing: '1px' }}>{total}</p>
      <ResponsiveContainer width="100%" height={80}>
        <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={`g-${String(dataKey)}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#00ff00" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#00ff00" stopOpacity={0}    />
            </linearGradient>
          </defs>
          <Tooltip content={<TT unit={unit} />} labelFormatter={v => v} />
          <Area type="monotone" dataKey={dataKey} stroke="#00ff00" strokeWidth={1.5}
            fill={`url(#g-${String(dataKey)})`} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function CTRChart({ data }: { data: DailyMetric[] }) {
  const step = Math.max(1, Math.floor(data.length / 10))
  return (
    <div style={panel}>
      <p style={{ color: 'var(--accent)', fontSize: '11px', letterSpacing: '1px', marginBottom: '12px', opacity: 0.8 }}>
        ┌─ AVERAGE VIEW PERCENTAGE ──────────────────────
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -10 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#1e1e1e" />
          <XAxis
            dataKey="date"
            tickFormatter={v => v.slice(5)}
            ticks={data.filter((_, i) => i % step === 0).map(d => d.date)}
            tick={{ fill: '#555555', fontSize: 10, fontFamily: 'Courier New' }}
            axisLine={{ stroke: '#333333' }} tickLine={false}
          />
          <YAxis
            tick={{ fill: '#555555', fontSize: 10, fontFamily: 'Courier New' }}
            axisLine={false} tickLine={false}
            tickFormatter={v => `${v}%`} domain={[0, 'auto']}
          />
          <Tooltip content={<TT unit="%" />} labelFormatter={v => v} />
          <Line type="monotone" dataKey="ctr" stroke="#00ff00" strokeWidth={1.5}
            dot={false} activeDot={{ r: 4, fill: '#00ff00', stroke: 'none' }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function Heatmap({ data }: { data: DailyMetric[] }) {
  const maxViews = Math.max(...data.map(x => x.views), 1)

  return (
    <div style={panel}>
      <p style={{ color: 'var(--accent)', fontSize: '11px', letterSpacing: '1px', marginBottom: '10px', opacity: 0.8 }}>
        ┌─ DAILY VIEWS HEATMAP ({data.length} DAYS) ──────────────
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
        {data.map(d => {
          const t = d.views / maxViews
          const char = t > 0.8 ? '█' : t > 0.6 ? '▓' : t > 0.4 ? '▒' : t > 0.2 ? '░' : '·'
          const lightness = Math.round(32 + t * 160)
          return (
            <span
              key={d.date}
              title={`${d.date}: ${d.views.toLocaleString()} views`}
              style={{
                color: t > 0.7 ? 'var(--accent)' : `rgb(${lightness},${lightness},${lightness})`,
                fontSize: '13px',
                cursor: 'default',
                lineHeight: 1,
                fontFamily: 'Courier New, monospace',
                transition: `color var(--t-fast)`,
                textShadow: t > 0.7 ? 'var(--glow-xs)' : 'none',
              }}
            >
              {char}
            </span>
          )
        })}
      </div>
      <p style={{ color: 'var(--text-faint)', fontSize: '10px', marginTop: '10px' }}>
        · ░ ▒ ▓ █  →  low to high views
      </p>
    </div>
  )
}

export function Analytics({ data, loading }: { data: DailyMetric[]; loading?: boolean }) {
  const stats = useMemo(() => {
    if (!data.length) return null
    const totalViews     = data.reduce((s, d) => s + d.views, 0)
    const totalWatchTime = data.reduce((s, d) => s + d.watchTime, 0)
    const avgDuration    = data.reduce((s, d) => s + d.impressions, 0) / data.length
    const avgCtr         = data.reduce((s, d) => s + d.ctr, 0) / data.length
    return { totalViews, totalWatchTime, avgDuration, avgCtr }
  }, [data])

  if (loading && !data.length) {
    return (
      <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px' }}>
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} height="80px" />)}
        </div>
        <SkeletonCard height="200px" />
        <SkeletonCard height="120px" />
      </div>
    )
  }

  if (!data.length) {
    return (
      <div style={{
        ...panel, padding: '60px 20px', textAlign: 'center',
      }}>
        <p style={{ color: 'var(--text-faint)', fontSize: '13px', letterSpacing: '2px', marginBottom: '8px' }}>*** NO DATA ***</p>
        <p style={{ color: 'var(--text-dim)', fontSize: '11px', letterSpacing: '1px' }}>Connect your YouTube channel to load analytics.</p>
      </div>
    )
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px' }}>
        <MiniChart data={data} dataKey="views"       title="TOTAL VIEWS"      total={fmtNumFull(stats!.totalViews)} />
        <MiniChart data={data} dataKey="watchTime"   title="WATCH TIME (MIN)" total={fmtNumFull(stats!.totalWatchTime)} unit=" min" />
        <MiniChart data={data} dataKey="impressions" title="AVG VIEW DURATION" total={fmtSecs(stats!.avgDuration)} unit=" s" />
        <MiniChart data={data} dataKey="ctr"         title="AVG VIEW %"        total={fmtPct(stats!.avgCtr)} unit="%" />
      </div>
      <CTRChart data={data} />
      <Heatmap data={data} />
    </div>
  )
}

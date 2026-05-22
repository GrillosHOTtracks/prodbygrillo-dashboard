import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import type { DailyMetric } from '../../types'

function formatDate(dateStr: string, totalDays: number) {
  const date = new Date(dateStr)
  if (totalDays <= 7) return date.toLocaleDateString('en', { weekday: 'short' }).toUpperCase()
  return date.toLocaleDateString('en', { month: 'short', day: 'numeric' }).toUpperCase()
}

function formatNumber(n: number) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`
  return n.toString()
}

const TT = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      backgroundColor: '#0d0d0d', border: '1px solid #333333',
      padding: '8px 12px', fontSize: '12px', fontFamily: 'Courier New, monospace',
    }}>
      <p style={{ color: '#707070', marginBottom: '4px' }}>DATE: {label}</p>
      {payload.map((e: any) => (
        <div key={e.name} style={{ display: 'flex', gap: '8px', color: e.color }}>
          <span>&gt; {e.name}:</span>
          <span style={{ color: '#c0c0c0', fontWeight: 'bold' }}>{formatNumber(e.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function ViewsChart({ data, showSubscribers = false }: { data: DailyMetric[]; showSubscribers?: boolean }) {
  if (!data.length) {
    return (
      <div style={{
        backgroundColor: '#0d0d0d',
        borderTop: '2px solid #555555', borderLeft: '2px solid #555555',
        borderRight: '2px solid #1a1a1a', borderBottom: '2px solid #1a1a1a',
        padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '280px',
      }}>
        <p style={{ color: '#333333', fontSize: '11px', letterSpacing: '2px' }}>*** NO VIEWS DATA ***</p>
      </div>
    )
  }

  const days = data.length
  const formatted = data.map(d => ({ ...d, dateLabel: formatDate(d.date, days) }))
  const step = days <= 7 ? 1 : days <= 28 ? 4 : days <= 90 ? 7 : 30
  const tickData = formatted.filter((_, i) => i % step === 0 || i === formatted.length - 1)

  return (
    <div style={{
      backgroundColor: '#0d0d0d',
      borderTop: '2px solid #555555', borderLeft: '2px solid #555555',
      borderRight: '2px solid #1a1a1a', borderBottom: '2px solid #1a1a1a',
      padding: '12px',
    }}>
      <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', marginBottom: '12px' }}>
        ┌─ VIEWS {showSubscribers ? '& SUBSCRIBERS ' : ''}OVER TIME ─────────────────
      </p>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={formatted} margin={{ top: 4, right: 8, bottom: 4, left: -10 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#1e1e1e" />
          <XAxis
            dataKey="dateLabel"
            ticks={tickData.map(d => d.dateLabel)}
            tick={{ fill: '#555555', fontSize: 10, fontFamily: 'Courier New' }}
            axisLine={{ stroke: '#333333' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#555555', fontSize: 10, fontFamily: 'Courier New' }}
            axisLine={false} tickLine={false}
            tickFormatter={formatNumber}
          />
          <Tooltip content={<TT />} />
          <Legend wrapperStyle={{ fontSize: '11px', color: '#707070', fontFamily: 'Courier New', paddingTop: '8px' }} />
          <Line type="monotone" dataKey="views" name="VIEWS" stroke="#00ff00" strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: '#00ff00', stroke: 'none' }} />
          {showSubscribers && (
            <Line type="monotone" dataKey="subscribers" name="SUBS" stroke="#00aaff" strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: '#00aaff', stroke: 'none' }} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts'
import type { MonthlyRevenue } from '../../lib/api'
import type { RevenueBreakdown } from '../../types'

const panelStyle: React.CSSProperties = {
  backgroundColor: '#0d0d0d',
  borderTop: '2px solid #555555', borderLeft: '2px solid #555555',
  borderRight: '2px solid #1a1a1a', borderBottom: '2px solid #1a1a1a',
  padding: '12px',
}
const noData: React.CSSProperties = {
  color: '#333333', fontSize: '11px', textAlign: 'center',
  padding: '60px 0', letterSpacing: '1px',
}
const TTStyle: React.CSSProperties = {
  backgroundColor: '#0d0d0d', border: '1px solid #333333',
  padding: '8px 12px', fontSize: '12px', fontFamily: 'Courier New, monospace',
}

const CustomBarTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={TTStyle}>
      <p style={{ color: '#707070' }}>{label}</p>
      <p style={{ color: '#00ff00', fontWeight: 'bold' }}>&gt; ${payload[0].value.toLocaleString()}</p>
    </div>
  )
}

export function MonthlyRevenueChart({ data }: { data?: MonthlyRevenue[] | null }) {
  return (
    <div style={panelStyle}>
      <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', marginBottom: '12px' }}>
        ┌─ MONTHLY REVENUE (12 MONTHS) ──────────────────
      </p>
      {!data || data.length === 0 ? (
        <p style={noData}>*** NO REVENUE DATA YET ***</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -10 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="#1e1e1e" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fill: '#555555', fontSize: 10, fontFamily: 'Courier New' }}
              axisLine={{ stroke: '#333333' }} tickLine={false}
            />
            <YAxis
              tick={{ fill: '#555555', fontSize: 10, fontFamily: 'Courier New' }}
              axisLine={false} tickLine={false}
              tickFormatter={v => `$${v}`}
            />
            <Tooltip content={<CustomBarTooltip />} />
            <Bar dataKey="revenue" radius={[0, 0, 0, 0]}>
              {data.map((_, i) => (
                <Cell
                  key={i}
                  fill={i === data.length - 1 ? '#00ff00' : '#2a2a2a'}
                  stroke={i === data.length - 1 ? '#00ff00' : '#333333'}
                  strokeWidth={1}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

const RADIAN = Math.PI / 180
const renderLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.06) return null
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="#0d0d0d" textAnchor="middle" dominantBaseline="central"
      fontSize={10} fontFamily="Courier New" fontWeight="bold">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

const pieColors = ['#00ff00', '#909090', '#606060', '#3a3a3a']

export function RevenueBreakdownChart({ data }: { data?: RevenueBreakdown[] | null }) {
  return (
    <div style={panelStyle}>
      <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', marginBottom: '12px' }}>
        ┌─ REVENUE BREAKDOWN ────────────────────────────
      </p>
      {!data || data.length === 0 ? (
        <p style={noData}>*** NO BREAKDOWN DATA YET ***</p>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <ResponsiveContainer width={160} height={160}>
            <PieChart>
              <Pie
                data={data}
                dataKey="amount"
                nameKey="source"
                cx="50%" cy="50%"
                innerRadius={40} outerRadius={72}
                labelLine={false} label={renderLabel} stroke="none"
              >
                {data.map((_, i) => <Cell key={i} fill={pieColors[i]} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
            {data.map((item, i) => (
              <div key={item.source} style={{
                display: 'flex', justifyContent: 'space-between', fontSize: '12px',
                borderBottom: '1px solid #1a1a1a', paddingBottom: '4px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: pieColors[i] }}>■</span>
                  <span style={{ color: '#c0c0c0' }}>{item.source.split(' ')[0]}</span>
                </div>
                <span style={{ color: i === 0 ? '#00ff00' : '#c0c0c0', fontWeight: 'bold' }}>
                  ${item.amount}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

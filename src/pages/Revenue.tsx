import { MonthlyRevenueChart } from '../components/charts/RevenueChart'
import type { MonthlyRevenue } from '../lib/api'

const panel: React.CSSProperties = {
  backgroundColor: '#0d0d0d',
  borderTop: '2px solid #555555', borderLeft: '2px solid #555555',
  borderRight: '2px solid #1a1a1a', borderBottom: '2px solid #1a1a1a',
  padding: '12px',
}

export function Revenue({
  revenueMonthly,
  revenueIncluded,
}: {
  revenueMonthly?: MonthlyRevenue[] | null
  revenueIncluded?: boolean | null
}) {
  // isReal = channel is authenticated (revenueIncluded is explicitly set, not undefined)
  const isReal = revenueIncluded != null

  if (isReal && revenueIncluded === false) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ ...panel, textAlign: 'center', padding: '60px 20px' }}>
          <p style={{ color: '#333333', fontSize: '14px', letterSpacing: '2px', marginBottom: '8px' }}>
            *** NOT MONETIZED ***
          </p>
          <p style={{ color: '#555555', fontSize: '11px', letterSpacing: '1px' }}>
            Channel does not meet YouTube Partner Program requirements yet.
          </p>
          <p style={{ color: '#444444', fontSize: '10px', marginTop: '12px', lineHeight: '1.8' }}>
            Requirements: 1,000 subscribers + 4,000 watch hours (last 12 months)<br/>
            or 1,000 subscribers + 10M YouTube Shorts views
          </p>
        </div>
      </div>
    )
  }

  const monthlyData = revenueMonthly ?? null

  const lastRev  = monthlyData?.length ? monthlyData[monthlyData.length - 1].revenue : null
  const prevRev  = monthlyData && monthlyData.length >= 2 ? monthlyData[monthlyData.length - 2].revenue : null
  const change   = lastRev != null && prevRev != null && prevRev > 0
    ? ((lastRev - prevRev) / prevRev * 100).toFixed(1)
    : null
  const yearly   = monthlyData?.reduce((s, m) => s + m.revenue, 0) ?? null
  const isUp     = lastRev != null && prevRev != null && lastRev >= prevRev

  const cards = [
    {
      label: 'THIS MONTH',
      value: lastRev != null ? `$${lastRev.toLocaleString()}` : '—',
      sub:   change != null ? `${isUp ? '▲ +' : '▼ '}${change}% vs last` : '—',
      up: isUp,
    },
    {
      label: 'LAST 12 MONTHS',
      value: yearly != null ? `$${yearly.toLocaleString()}` : '—',
      sub:   'annual total',
      up: true,
    },
    { label: 'EST. RPM', value: '—', sub: 'per 1K views',    up: true  },
    { label: 'EST. CPM', value: '—', sub: 'per 1K impress.', up: false },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
        {cards.map(card => (
          <div key={card.label} style={panel}>
            <p style={{ color: '#555555', fontSize: '10px', letterSpacing: '1px', margin: 0 }}>{card.label}</p>
            <p style={{ color: '#c0c0c0', fontSize: '20px', fontWeight: 'bold', margin: '4px 0' }}>{card.value}</p>
            <p style={{ color: card.up ? '#00ff00' : '#ff4400', fontSize: '10px', margin: 0 }}>{card.sub}</p>
          </div>
        ))}
      </div>

      <MonthlyRevenueChart data={monthlyData} />
    </div>
  )
}

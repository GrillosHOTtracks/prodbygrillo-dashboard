import { AudienceAgeChart, TopCountriesChart } from '../components/charts/AudienceChart'
import type { AudienceResponse, ChannelInfo } from '../lib/api'

const panel: React.CSSProperties = {
  backgroundColor: '#0d0d0d',
  borderTop: '2px solid #555555', borderLeft: '2px solid #555555',
  borderRight: '2px solid #1a1a1a', borderBottom: '2px solid #1a1a1a',
  padding: '12px',
}
const noData: React.CSSProperties = {
  color: '#333333', fontSize: '11px', textAlign: 'center',
  padding: '32px 0', letterSpacing: '1px',
}

function BarRow({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  const filled = Math.round(value / 2)
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px' }}>
        <span style={{ color: '#c0c0c0' }}>{label}</span>
        <span style={{ color: accent ? '#00ff00' : '#c0c0c0', fontWeight: 'bold' }}>{value}%</span>
      </div>
      <div style={{ fontSize: '10px', letterSpacing: '-1px', overflow: 'hidden' }}>
        <span style={{ color: accent ? '#00ff00' : '#707070' }}>{'█'.repeat(filled)}</span>
        <span style={{ color: '#222222' }}>{'░'.repeat(50 - filled)}</span>
      </div>
    </div>
  )
}

export function Audience({
  realData,
  channelInfo,
}: {
  realData?: AudienceResponse | null
  channelInfo?: ChannelInfo | null
}) {
  // Gender computed from viewerPercentage values (each gender's values sum to total%)
  const genderData = realData?.audienceAge?.length
    ? [
        { label: 'MALE',   value: Math.round(realData.audienceAge.reduce((s, a) => s + a.male,   0)), accent: true  },
        { label: 'FEMALE', value: Math.round(realData.audienceAge.reduce((s, a) => s + a.female, 0)), accent: false },
        { label: 'OTHER',  value: Math.round(realData.audienceAge.reduce((s, a) => s + a.other,  0)), accent: false },
      ]
    : null

  const devices = realData?.devices ?? []
  const subRatio = realData?.subscriberRatio

  const summaryStats = [
    {
      label: 'TOTAL SUBSCRIBERS',
      value: channelInfo ? channelInfo.subscribers.toLocaleString() : '—',
    },
    { label: 'AVG VIEW DURATION', value: '—' },
    { label: 'RETURN VIEWERS',    value: '—' },
    {
      label: 'COUNTRIES REACHED',
      value: realData?.countries?.length ? realData.countries.length.toString() : '—',
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
        {summaryStats.map(stat => (
          <div key={stat.label} style={panel}>
            <p style={{ color: '#555555', fontSize: '10px', letterSpacing: '1px', margin: 0 }}>{stat.label}</p>
            <p style={{ color: '#c0c0c0', fontSize: '18px', fontWeight: 'bold', margin: '4px 0 0' }}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <AudienceAgeChart data={realData?.audienceAge ?? null} />
        <TopCountriesChart data={realData?.countries ?? null} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div style={panel}>
          <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', marginBottom: '12px' }}>
            ┌─ GENDER DISTRIBUTION ──────────────────────
          </p>
          {genderData
            ? genderData.map(g => <BarRow key={g.label} label={g.label} value={g.value} accent={g.accent} />)
            : <p style={noData}>*** NO AUDIENCE DATA YET ***</p>
          }
        </div>
        <div style={panel}>
          <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', marginBottom: '12px' }}>
            ┌─ DEVICE TYPE ──────────────────────────────
          </p>
          {devices.length > 0
            ? devices.map((d, i) => <BarRow key={d.label} label={d.label.toUpperCase()} value={d.value} accent={i === 0} />)
            : <p style={noData}>*** NO DEVICE DATA YET ***</p>
          }
        </div>
      </div>

      <div style={panel}>
        <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', marginBottom: '10px' }}>
          ┌─ VIEWER TYPE ──────────────────────────────────
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px' }}>
          {[
            { label: 'SUBSCRIBERS',  value: subRatio ? `${subRatio.subscribed}%`   : '—' },
            { label: 'NON-SUBS',     value: subRatio ? `${subRatio.unsubscribed}%` : '—' },
            { label: 'RETURNING',    value: '—' },
            { label: 'NEW VISITORS', value: '—' },
          ].map(item => (
            <div key={item.label} style={{
              border: '1px solid #333333', padding: '10px',
              textAlign: 'center', backgroundColor: '#111111',
            }}>
              <p style={{ color: '#c0c0c0', fontSize: '22px', fontWeight: 'bold', margin: 0 }}>{item.value}</p>
              <p style={{ color: '#555555', fontSize: '10px', margin: '4px 0 0', letterSpacing: '1px' }}>{item.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

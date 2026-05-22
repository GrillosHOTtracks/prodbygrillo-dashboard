import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

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

const TT = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      backgroundColor: '#0d0d0d', border: '1px solid #333333',
      padding: '8px 12px', fontSize: '12px', fontFamily: 'Courier New, monospace',
    }}>
      <p style={{ color: '#707070', marginBottom: '4px' }}>AGE: {label}</p>
      {payload.map((e: any) => (
        <div key={e.name} style={{ color: e.fill, fontSize: '11px' }}>
          &gt; {e.name}: <span style={{ color: '#c0c0c0' }}>{e.value}%</span>
        </div>
      ))}
    </div>
  )
}

type AgeGroup = { range: string; male: number; female: number; other: number }

export function AudienceAgeChart({ data }: { data?: AgeGroup[] | null }) {
  return (
    <div style={panelStyle}>
      <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', marginBottom: '12px' }}>
        ┌─ AUDIENCE AGE & GENDER ─────────────────────────
      </p>
      {!data || data.length === 0 ? (
        <p style={noData}>*** NO AUDIENCE DATA YET ***</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -10 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="#1e1e1e" vertical={false} />
            <XAxis dataKey="range"
              tick={{ fill: '#555555', fontSize: 10, fontFamily: 'Courier New' }}
              axisLine={{ stroke: '#333333' }} tickLine={false} />
            <YAxis
              tick={{ fill: '#555555', fontSize: 10, fontFamily: 'Courier New' }}
              axisLine={false} tickLine={false}
              tickFormatter={v => `${v}%`} />
            <Tooltip content={<TT />} />
            <Legend wrapperStyle={{ fontSize: '11px', color: '#707070', fontFamily: 'Courier New', paddingTop: '8px' }} />
            <Bar dataKey="male"   name="MALE"   fill="#00ff00" radius={[0,0,0,0]} />
            <Bar dataKey="female" name="FEMALE" fill="#909090" radius={[0,0,0,0]} />
            <Bar dataKey="other"  name="OTHER"  fill="#555555" radius={[0,0,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

function fmtV(n: number) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`
  return n.toString()
}

type Country = { code: string; name: string; views: number; percentage: number }

export function TopCountriesChart({ data }: { data?: Country[] | null }) {
  return (
    <div style={panelStyle}>
      <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', marginBottom: '12px' }}>
        ┌─ TOP COUNTRIES ────────────────────────────────
      </p>
      {!data || data.length === 0 ? (
        <p style={noData}>*** NO COUNTRY DATA YET ***</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {data.map((country, i) => (
            <div key={country.code}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '3px' }}>
                <span style={{ color: '#c0c0c0' }}>
                  {String(i + 1).padStart(2, '0')}. {country.name.toUpperCase()}
                </span>
                <span style={{ display: 'flex', gap: '12px' }}>
                  <span style={{ color: '#555555' }}>{fmtV(country.views)}</span>
                  <span style={{ color: i === 0 ? '#00ff00' : '#c0c0c0', fontWeight: 'bold', minWidth: '36px', textAlign: 'right' }}>
                    {country.percentage}%
                  </span>
                </span>
              </div>
              <div style={{ height: '8px', backgroundColor: '#111111', border: '1px solid #222222' }}>
                <div style={{
                  height: '100%',
                  width: `${country.percentage}%`,
                  backgroundColor: i === 0 ? '#00ff00' : `rgba(192,192,192,${0.6 - i * 0.06})`,
                }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

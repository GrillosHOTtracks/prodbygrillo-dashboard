import type { TrafficSource } from '../../lib/api'

const barColors = ['#00ff00', '#c0c0c0', '#909090', '#707070', '#505050', '#333333']

const noData: React.CSSProperties = {
  color: '#333333', fontSize: '11px', textAlign: 'center',
  padding: '32px 0', letterSpacing: '1px',
}

export function TrafficSourcesChart({ sources }: { sources?: TrafficSource[] | null }) {
  return (
    <div style={{
      backgroundColor: '#0d0d0d',
      borderTop: '2px solid #555555', borderLeft: '2px solid #555555',
      borderRight: '2px solid #1a1a1a', borderBottom: '2px solid #1a1a1a',
      padding: '12px',
    }}>
      <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', marginBottom: '12px' }}>
        ┌─ TRAFFIC SOURCES ──────────────────────────────
      </p>
      {!sources || sources.length === 0 ? (
        <p style={noData}>*** NO TRAFFIC DATA YET ***</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {sources.map((source, i) => (
            <div key={source.name}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '3px' }}>
                <span style={{ color: '#c0c0c0' }}>&gt; {source.name.toUpperCase()}</span>
                <span style={{ color: i === 0 ? '#00ff00' : '#c0c0c0', fontWeight: 'bold' }}>{source.value}%</span>
              </div>
              <div style={{ height: '10px', backgroundColor: '#111111', border: '1px solid #222222' }}>
                <div style={{
                  height: '100%', width: `${source.value}%`,
                  backgroundColor: barColors[i] || '#333333',
                  transition: 'width 0.5s',
                }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

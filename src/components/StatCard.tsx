interface StatCardProps {
  label: string
  value: string
  change?: number | null
  icon: React.ReactNode
  accent?: string
  subtitle?: string
}

export function StatCard({ label, value, change, icon, subtitle }: StatCardProps) {
  const hasChange = change != null
  const positive = hasChange && change >= 0

  return (
    <div
      className="panel fade-in"
      style={{ cursor: 'default' }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = 'var(--border-bright)'
        el.style.boxShadow = 'var(--glow-xs)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = 'var(--border)'
        el.style.boxShadow = 'none'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.7 }}>
          {icon}
        </div>
        <span style={{
          fontSize: '10px',
          color: hasChange ? (positive ? 'var(--accent)' : '#ff4400') : 'var(--text-faint)',
          border: `1px solid ${hasChange ? (positive ? 'var(--accent-border)' : '#3a1a1a') : 'var(--border)'}`,
          padding: '1px 5px',
          lineHeight: '1.4',
        }}>
          {hasChange ? `${positive ? '+' : ''}${change}%` : '—'}
        </span>
      </div>
      <p style={{ color: 'var(--text-bright)', fontSize: '22px', fontWeight: 'bold', margin: '0 0 4px', letterSpacing: '1px' }}>
        {value}
      </p>
      <p style={{ color: 'var(--text-dim)', fontSize: '10px', margin: 0, letterSpacing: '1px' }}>
        {label.toUpperCase()}
      </p>
      {subtitle && (
        <p style={{ color: 'var(--text-faint)', fontSize: '10px', marginTop: '4px' }}>{subtitle}</p>
      )}
    </div>
  )
}

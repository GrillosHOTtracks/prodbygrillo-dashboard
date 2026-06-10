import type { DateRange, Page } from '../types'

const dateRanges: { value: DateRange; label: string }[] = [
  { value: '7d',   label: 'LAST 7 DAYS'   },
  { value: '28d',  label: 'LAST 28 DAYS'  },
  { value: '90d',  label: 'LAST 90 DAYS'  },
  { value: '365d', label: 'LAST 365 DAYS' },
]

const pageTitles: Record<Page, string> = {
  overview:  '=[ CHANNEL OVERVIEW ]========================',
  videos:    '=[ VIDEO PERFORMANCE ]========================',
  analytics: '=[ ANALYTICS ]================================',
  audience:  '=[ AUDIENCE INSIGHTS ]========================',
  revenue:   '=[ REVENUE ]==================================',
  scheduler:  '=[ SCHEDULER / UPLOAD ]=======================',
  agenda:     '=[ AGENDA DE PUBLICAÇÕES ]=====================',
  plan:       '=[ PLANO DIÁRIO · LAIS ]======================',
  market:     '=[ MARKET ANALYSIS ]==========================',
  settings:   '=[ SETTINGS ]=================================',
}

interface HeaderProps {
  currentPage: Page
  dateRange: DateRange
  onDateRangeChange: (range: DateRange) => void
  authenticated?: boolean
  isDemo?: boolean
  channelId?: string
  onLogout?: () => void
  engineActive?: boolean
}

export function Header({ currentPage, dateRange, onDateRangeChange, authenticated, isDemo, channelId, onLogout, engineActive }: HeaderProps) {
  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      onLogout?.()
    }
  }
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)

  return (
    <header style={{
      height: '56px',
      backgroundColor: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      position: 'sticky',
      top: 0,
      zIndex: 40,
      flexShrink: 0,
    }}>
      <span style={{ color: 'var(--accent)', fontSize: '11px', letterSpacing: '0.5px', overflow: 'hidden', whiteSpace: 'nowrap', opacity: 0.8 }}>
        {pageTitles[currentPage]}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        {/* Connection indicator */}
        <span style={{
          fontSize: '10px', letterSpacing: '1px', padding: '2px 7px',
          border: `1px solid ${authenticated ? 'var(--accent-border)' : 'var(--border)'}`,
          color: authenticated ? 'var(--accent)' : 'var(--text-dim)',
          background: authenticated ? 'var(--accent-muted)' : 'transparent',
        }}>
          {authenticated ? '● LIVE' : isDemo ? '● DEMO' : '○ OFFLINE'}
        </span>

        <span style={{ color: 'var(--text-faint)', fontSize: '10px' }}>{now}</span>

        <select
          value={dateRange}
          onChange={e => onDateRangeChange(e.target.value as DateRange)}
          style={{
            backgroundColor: 'var(--bg-card)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            padding: '4px 8px',
            cursor: 'pointer',
            fontSize: '11px',
            outline: 'none',
            letterSpacing: '0.5px',
            fontFamily: 'Courier New, monospace',
            transition: `border-color var(--t-fast)`,
          }}
          onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-border)' }}
          onBlur={e  => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
        >
          {dateRanges.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>

        <a
          href={channelId ? `https://studio.youtube.com/channel/${channelId}` : 'https://studio.youtube.com'}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: '#000000',
            backgroundColor: 'var(--accent)',
            padding: '4px 10px',
            fontSize: '11px',
            textDecoration: 'none',
            letterSpacing: '1px',
            fontWeight: 'bold',
            fontFamily: 'Courier New, monospace',
            transition: `background var(--t-fast), box-shadow var(--t-fast)`,
          }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLElement
            el.style.backgroundColor = 'var(--accent-dim)'
            el.style.boxShadow = 'var(--glow-sm)'
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement
            el.style.backgroundColor = 'var(--accent)'
            el.style.boxShadow = 'none'
          }}
        >
          [YT STUDIO]
        </a>

        {authenticated && (
          <button
            onClick={handleLogout}
            style={{
              backgroundColor: 'transparent',
              color: '#ff4400',
              border: '1px solid #ff4400',
              padding: '4px 10px',
              fontSize: '11px',
              letterSpacing: '1px',
              fontFamily: 'Courier New, monospace',
              cursor: 'pointer',
              transition: `background var(--t-fast), color var(--t-fast)`,
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement
              el.style.backgroundColor = '#ff440022'
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement
              el.style.backgroundColor = 'transparent'
            }}
          >
            [LOGOUT]
          </button>
        )}

        <span
          title={engineActive ? 'ALGORITHM ENGINE · ACTIVO' : 'ALGORITHM ENGINE · DESLIGADO'}
          style={{
            fontSize: '18px',
            lineHeight: 1,
            cursor: 'default',
            filter: engineActive
              ? 'drop-shadow(0 0 6px #00ff00) drop-shadow(0 0 12px #00aa00)'
              : 'grayscale(1) brightness(0.25)',
            transition: 'filter 0.6s ease',
            userSelect: 'none',
          }}
        >
          🦗
        </span>
      </div>
    </header>
  )
}

import React from 'react'
import type { Page } from '../types'
import { ChevronRight } from 'lucide-react'
import {
  IconMonitor, IconCamera, IconBarChart,
  IconAudience, IconCoin, IconGear, IconAI, IconStore,
} from './PixelIcons'

type NavItem = {
  id: Page
  label: string
  Icon: ({ size }: { size?: number }) => React.ReactElement
}

const navItems: NavItem[] = [
  { id: 'overview',   label: 'OVERVIEW',   Icon: IconMonitor  },
  { id: 'videos',     label: 'VIDEOS',     Icon: IconCamera   },
  { id: 'analytics',  label: 'ANALYTICS',  Icon: IconBarChart },
  { id: 'audience',   label: 'AUDIENCE',   Icon: IconAudience },
  { id: 'revenue',    label: 'REVENUE',    Icon: IconCoin     },
  { id: 'scheduler',  label: 'SCHEDULER',  Icon: IconAI       },
  { id: 'beatstore',  label: 'BEAT STORE', Icon: IconStore    },
  { id: 'settings',   label: 'SETTINGS',   Icon: IconGear     },
]

interface SidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ currentPage, onNavigate, collapsed, onToggle }: SidebarProps) {
  return (
    <aside style={{
      width: collapsed ? '52px' : '196px',
      backgroundColor: 'var(--bg-surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      position: 'sticky',
      top: 0,
      transition: `width var(--t-base) var(--ease)`,
      flexShrink: 0,
      overflow: 'hidden',
    }}>

      {/* Logo */}
      <div style={{
        height: '56px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: '10px',
        flexShrink: 0,
      }}>
        <svg viewBox="0 0 10 8" width="20" height="16" shapeRendering="crispEdges" style={{ flexShrink: 0 }}>
          <rect x="0" y="0" width="10" height="6" fill="#00cc00"/>
          <rect x="0" y="0" width="10" height="1" fill="#00ff00"/>
          <rect x="0" y="0" width="1"  height="6" fill="#00ff00"/>
          <rect x="1" y="1" width="8"  height="4" fill="#001100"/>
          <rect x="2" y="2" width="6"  height="1" fill="#00ff00"/>
          <rect x="2" y="4" width="4"  height="1" fill="#00ff00"/>
          <rect x="10" y="1" width="1" height="5" fill="#007700"/>
          <rect x="0"  y="6" width="10" height="1" fill="#005500"/>
          <rect x="4" y="6" width="2" height="2" fill="#00cc00"/>
          <rect x="3" y="8" width="4" height="1" fill="#007700"/>
        </svg>
        {!collapsed && (
          <div style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
              <span style={{ color: 'var(--accent)', fontWeight: 'bold', fontSize: '11px', letterSpacing: '1px' }}>
                PRODBYGRILLO
              </span>
              <span className="blink" style={{ color: 'var(--accent)' }}>_</span>
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.5px' }}>
              analytics
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, paddingTop: '6px', overflowY: 'auto', overflowX: 'hidden' }}>
        {navItems.map(({ id, label, Icon }) => {
          const active = currentPage === id
          return (
            <NavButton
              key={id}
              id={id}
              label={label}
              Icon={Icon}
              active={active}
              collapsed={collapsed}
              onClick={() => onNavigate(id)}
            />
          )
        })}
      </nav>

      {/* Online indicator */}
      <div style={{
        padding: collapsed ? '8px 0' : '6px 14px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: '6px',
      }}>
        <span
          className="dot-pulse"
          style={{
            width: '6px', height: '6px',
            backgroundColor: 'var(--accent)',
            borderRadius: '50%',
            display: 'inline-block',
            boxShadow: 'var(--glow-xs)',
            flexShrink: 0,
          }}
        />
        {!collapsed && (
          <span style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '1px', whiteSpace: 'nowrap' }}>
            ONLINE
          </span>
        )}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '28px',
          background: 'transparent',
          color: 'var(--text-faint)',
          cursor: 'pointer',
          border: 'none',
          borderTop: '1px solid var(--border)',
          width: '100%',
          transition: `color var(--t-fast)`,
          flexShrink: 0,
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-faint)' }}
      >
        <ChevronRight
          size={12}
          style={{
            transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
            transition: `transform var(--t-base) var(--ease)`,
          }}
        />
      </button>
    </aside>
  )
}

function NavButton({ label, Icon, active, collapsed, onClick }: {
  id?: Page; label: string
  Icon: ({ size }: { size?: number }) => React.ReactElement
  active: boolean; collapsed: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: collapsed ? '10px 0' : '9px 12px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        background: active ? 'var(--accent-muted)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-dim)',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        fontSize: '11px',
        letterSpacing: '0.8px',
        borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
        boxShadow: active ? 'inset 0 0 12px rgba(0,255,0,0.04)' : 'none',
        transition: `background var(--t-fast), color var(--t-fast), box-shadow var(--t-fast)`,
        position: 'relative',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => {
        if (!active) {
          const el = e.currentTarget as HTMLElement
          el.style.color = 'var(--text-bright)'
          el.style.background = 'var(--bg-hover)'
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          const el = e.currentTarget as HTMLElement
          el.style.color = 'var(--text-dim)'
          el.style.background = 'transparent'
        }
      }}
    >
      <span style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        opacity: active ? 1 : 0.5,
        filter: active ? `drop-shadow(0 0 4px rgba(0,255,0,0.6))` : 'none',
        transition: `opacity var(--t-fast), filter var(--t-fast)`,
      }}>
        <Icon size={18} />
      </span>
      {!collapsed && <span>{label}</span>}
    </button>
  )
}

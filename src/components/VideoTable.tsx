import type { Video } from '../types'
import { fmtNum, fmtMinutes, fmtPct } from '../utils/format'

interface VideoTableProps {
  videos: Video[]
  compact?: boolean
}

const TH: React.CSSProperties = {
  textAlign: 'left',
  padding: '5px 10px',
  color: 'var(--text-dim)',
  fontSize: '10px',
  letterSpacing: '1px',
  borderBottom: '1px solid var(--border)',
  fontWeight: 'normal',
  whiteSpace: 'nowrap',
}

const TD: React.CSSProperties = {
  padding: '7px 10px',
  fontSize: '12px',
  borderBottom: '1px solid rgba(34,34,34,0.6)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  color: 'var(--text)',
}

export function VideoTable({ videos, compact = false }: VideoTableProps) {
  if (!videos.length) {
    return (
      <p style={{ color: 'var(--text-faint)', textAlign: 'center', padding: '24px', fontSize: '12px' }}>
        *** NO VIDEOS FOUND ***
      </p>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr>
            <th style={{ ...TH, width: '28px' }}>#</th>
            <th style={{ ...TH, width: '100%' }}>TITLE</th>
            <th style={{ ...TH, textAlign: 'right' }}>VIEWS</th>
            <th style={{ ...TH, textAlign: 'right' }}>W.TIME</th>
            {!compact && (
              <>
                <th style={{ ...TH, textAlign: 'right' }}>LIKES</th>
                <th style={{ ...TH, textAlign: 'right' }}>CTR</th>
                <th style={{ ...TH, textAlign: 'right' }}>REV</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {videos.map((video, i) => (
            <VideoRow key={video.id} video={video} index={i} compact={compact} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function VideoRow({ video, index, compact }: { video: Video; index: number; compact: boolean }) {
  const ctrGood = video.ctr >= 6

  return (
    <tr
      className="slide-left"
      style={{
        cursor: 'default',
        animationDelay: `${index * 30}ms`,
        transition: `background var(--t-fast), box-shadow var(--t-fast)`,
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.backgroundColor = 'var(--bg-hover)'
        el.style.boxShadow = 'inset 1px 0 0 var(--accent-border)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.backgroundColor = 'transparent'
        el.style.boxShadow = 'none'
      }}
    >
      <td style={{ ...TD, color: 'var(--text-faint)', fontSize: '11px' }}>
        {String(index + 1).padStart(2, '0')}
      </td>
      <td style={{ ...TD, maxWidth: compact ? '160px' : '300px', textOverflow: 'ellipsis' }}>
        <span style={{ color: 'var(--text-faint)', marginRight: '6px' }}>{video.thumbnail}</span>
        {video.title}
      </td>
      <td style={{ ...TD, textAlign: 'right', color: 'var(--accent)', fontWeight: 'bold' }}>
        {fmtNum(video.views)}
      </td>
      <td style={{ ...TD, textAlign: 'right', color: 'var(--text-dim)' }}>
        {fmtMinutes(video.watchTime)}
      </td>
      {!compact && (
        <>
          <td style={{ ...TD, textAlign: 'right', color: 'var(--text-dim)' }}>
            {fmtNum(video.likes)}
          </td>
          <td style={{ ...TD, textAlign: 'right' }}>
            <span style={{
              color: ctrGood ? 'var(--accent)' : 'var(--text-dim)',
              padding: '1px 5px',
              border: ctrGood ? '1px solid var(--accent-border)' : '1px solid transparent',
              background: ctrGood ? 'var(--accent-muted)' : 'transparent',
              fontSize: '11px',
            }}>
              {fmtPct(video.ctr)}
            </span>
          </td>
          <td style={{ ...TD, textAlign: 'right', color: 'var(--accent)', fontWeight: 'bold' }}>
            ${video.revenue.toFixed(0)}
          </td>
        </>
      )}
    </tr>
  )
}

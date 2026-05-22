import { useMemo } from 'react'
import { StatCard } from '../components/StatCard'
import { IconEye, IconClock, IconUsers, IconDollar, IconPlay, IconCursor } from '../components/PixelIcons'
import { ViewsChart } from '../components/charts/ViewsChart'
import { TrafficSourcesChart } from '../components/charts/TrafficChart'
import { VideoTable } from '../components/VideoTable'
import { SkeletonCard, SkeletonTable } from '../components/ui/Skeleton'
import { fmtNum, fmtSecs, fmtPct } from '../utils/format'
import type { DailyMetric, Video } from '../types'
import type { ChannelInfo, Video as ApiVideo, ArtistTrend, TrafficSource } from '../lib/api'

const panel: React.CSSProperties = {
  backgroundColor: 'var(--bg-card)',
  border: '1px solid var(--border)',
  padding: '14px',
  transition: `border-color var(--t-fast)`,
}

function apiToLocal(v: ApiVideo): Video {
  return {
    id: v.id, title: v.title, thumbnail: '▶',
    views: v.views, watchTime: v.watchTime, likes: v.likes,
    comments: v.comments, ctr: v.ctr, avgDuration: v.avgDuration,
    publishedAt: v.publishedAt, revenue: v.revenue,
    status: v.status as Video['status'],
  }
}

// ─── Channel banner ───────────────────────────────────────────────────────────
function ChannelBanner({ info }: { info: ChannelInfo }) {
  return (
    <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
      <pre style={{ margin: 0, fontSize: '11px', color: 'var(--text-dim)', lineHeight: '1.7' }}>{
`*** CHANNEL INFO ***
nick    : ${info.name}
handle  : ${info.handle}
country : ${info.country}
joined  : ${info.publishedAt?.slice(0, 10) ?? 'N/A'}`
      }</pre>
      <div style={{ flex: 1, display: 'flex', gap: '28px', flexWrap: 'wrap', paddingLeft: '20px', borderLeft: '1px solid var(--border)' }}>
        {[
          { label: 'SUBSCRIBERS',  value: fmtNum(info.subscribers) },
          { label: 'TOTAL VIEWS',  value: fmtNum(info.totalViews) },
          { label: 'TOTAL VIDEOS', value: info.totalVideos.toString() },
        ].map(stat => (
          <div key={stat.label}>
            <p style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '1px', margin: 0 }}>{stat.label}</p>
            <p style={{ color: 'var(--text-bright)', fontSize: '22px', fontWeight: 'bold', margin: '2px 0 0', letterSpacing: '1px' }}>{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Artist ranking ───────────────────────────────────────────────────────────
function ArtistRankingTable({ artists }: { artists: ArtistTrend[] }) {
  const now = new Date()
  const monthLabel = now.toLocaleString('en', { month: 'long', year: 'numeric' }).toUpperCase()
  const maxViews = artists[0]?.totalViews || 1

  const TH: React.CSSProperties = {
    textAlign: 'left', padding: '5px 10px',
    color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '1px',
    borderBottom: '1px solid var(--border)', fontWeight: 'normal', whiteSpace: 'nowrap',
  }
  const TD: React.CSSProperties = {
    padding: '7px 10px', fontSize: '11px',
    borderBottom: '1px solid rgba(34,34,34,0.6)', whiteSpace: 'nowrap',
    overflow: 'hidden', color: 'var(--text)',
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <p style={{ color: 'var(--text-faint)', fontSize: '10px', marginBottom: '10px', letterSpacing: '1px' }}>
        type beats em {monthLabel} · ordenado por views totais
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={TH}>#</th>
            <th style={{ ...TH, width: '30%' }}>ARTISTA</th>
            <th style={{ ...TH, textAlign: 'right' }}>BEATS</th>
            <th style={{ ...TH, width: '35%' }}>VIEWS TOTAIS</th>
            <th style={{ ...TH }}>ÚLTIMO BEAT</th>
            <th style={{ ...TH }}>AÇÃO</th>
          </tr>
        </thead>
        <tbody>
          {artists.map((artist, i) => {
            const barLen = Math.round((artist.totalViews / maxViews) * 24)
            const rankColor = i === 0 ? 'var(--accent)' : i === 1 ? '#c0c0c0' : i === 2 ? '#aa7700' : 'var(--text-faint)'
            const searchQuery = encodeURIComponent(`${artist.name} type beat ${now.getFullYear()}`)
            return (
              <tr
                key={artist.name}
                style={{ transition: `background var(--t-fast)` }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
              >
                <td style={{ ...TD, color: rankColor, fontWeight: 'bold', fontSize: '13px' }}>
                  {String(i + 1).padStart(2, '0')}
                </td>
                <td style={{ ...TD, color: 'var(--text-bright)', fontWeight: 'bold', letterSpacing: '0.5px' }}>
                  {artist.name}
                </td>
                <td style={{ ...TD, textAlign: 'right', color: 'var(--text-dim)' }}>
                  {artist.beatCount}
                </td>
                <td style={{ ...TD }}>
                  <span style={{ color: 'var(--text-faint)', letterSpacing: '-1px', fontSize: '12px' }}>
                    {'█'.repeat(barLen)}
                  </span>
                  <span style={{ color: i === 0 ? 'var(--accent)' : 'var(--text-dim)', marginLeft: '6px' }}>
                    {fmtNum(artist.totalViews)}
                  </span>
                </td>
                <td style={{ ...TD, color: 'var(--text-faint)', fontSize: '10px' }}>
                  {artist.latestBeat ? artist.latestBeat.slice(0, 10) : '—'}
                </td>
                <td style={{ ...TD }}>
                  <a
                    href={`https://www.youtube.com/results?search_query=${searchQuery}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-block',
                      padding: '3px 8px',
                      backgroundColor: 'transparent',
                      color: 'var(--text-dim)',
                      border: '1px solid var(--border)',
                      fontSize: '10px',
                      letterSpacing: '0.5px',
                      textDecoration: 'none',
                      cursor: 'pointer',
                      fontFamily: 'Courier New, monospace',
                      transition: `color var(--t-fast), border-color var(--t-fast), background var(--t-fast)`,
                    }}
                    onMouseEnter={e => {
                      const el = e.currentTarget as HTMLElement
                      el.style.color = 'var(--accent)'
                      el.style.borderColor = 'var(--accent-border)'
                      el.style.backgroundColor = 'var(--accent-muted)'
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget as HTMLElement
                      el.style.color = 'var(--text-dim)'
                      el.style.borderColor = 'var(--border)'
                      el.style.backgroundColor = 'transparent'
                    }}
                  >
                    ▶ CRIAR BEAT
                  </a>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: 'var(--accent)', fontSize: '11px', letterSpacing: '2px', margin: 0, opacity: 0.8 }}>
      ┌─ {children}
    </p>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export function Overview({
  data, channelInfo: realChannel, loading,
  videos, videosLoading,
  trending, trendingLoading,
  trafficSources,
}: {
  data: DailyMetric[]
  channelInfo?: ChannelInfo | null
  loading?: boolean
  videos?: ApiVideo[] | null
  videosLoading?: boolean
  trending?: ArtistTrend[] | null
  trendingLoading?: boolean
  trafficSources?: TrafficSource[] | null
}) {
  const stats = useMemo(() => {
    if (!data.length) return null
    const totalViews     = data.reduce((s, d) => s + d.views, 0)
    const totalWatchTime = data.reduce((s, d) => s + d.watchTime, 0)
    const totalSubs      = data.reduce((s, d) => s + d.subscribers, 0)
    const totalRevenue   = data.reduce((s, d) => s + d.revenue, 0)
    const avgDuration    = data.reduce((s, d) => s + d.impressions, 0) / data.length
    const avgCtr         = data.reduce((s, d) => s + d.ctr, 0) / data.length
    return { totalViews, totalWatchTime, totalSubs, totalRevenue, avgDuration, avgCtr }
  }, [data])

  const topVideos = useMemo(
    () => videos?.slice(0, 5).map(apiToLocal) ?? [],
    [videos],
  )

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ── CHANNEL ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <SectionLabel>MEU CANAL ────────────────────────────────────────────────</SectionLabel>

        <div style={panel}>
          {realChannel
            ? <ChannelBanner info={realChannel} />
            : <p style={{ color: 'var(--text-faint)', fontSize: '11px', padding: '8px 0' }}>
                &gt; LOADING CHANNEL DATA...
              </p>
          }
        </div>

        {/* Stat cards */}
        {loading && !data.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} height="60px" />)}
          </div>
        ) : stats ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
            <StatCard label="Views"        value={fmtNum(stats.totalViews)}                     change={null} icon={<IconEye    size={22}/>} />
            <StatCard label="Watch Time"   value={`${(stats.totalWatchTime / 60).toFixed(0)}h`} change={null} icon={<IconClock  size={22}/>} />
            <StatCard label="New Subs"     value={`+${fmtNum(stats.totalSubs)}`}                change={null} icon={<IconUsers  size={22}/>} />
            <StatCard label="Revenue"      value={`$${stats.totalRevenue.toFixed(0)}`}          change={null} icon={<IconDollar size={22}/>} />
            <StatCard label="Avg Duration" value={fmtSecs(stats.avgDuration)}                   change={null} icon={<IconPlay   size={22}/>} />
            <StatCard label="Avg CTR"      value={stats.avgCtr > 0 ? fmtPct(stats.avgCtr) : '—'} change={null} icon={<IconCursor size={22}/>} />
          </div>
        ) : null}

        {/* Charts */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
          <ViewsChart data={data} />
          <TrafficSourcesChart sources={trafficSources ?? null} />
        </div>

        {/* Top videos */}
        <div style={panel}>
          <p style={{ color: 'var(--accent)', fontSize: '11px', letterSpacing: '1px', marginBottom: '10px', opacity: 0.8 }}>
            ┌─ TOP VIDEOS ─────────────────────────────────────────
          </p>
          {videosLoading
            ? <SkeletonTable rows={5} />
            : <VideoTable videos={topVideos} compact />
          }
        </div>
      </div>

      {/* ── TOP ARTISTAS ────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <SectionLabel>TOP ARTISTAS EM ALTA ─────────────────────────────────────</SectionLabel>

        <div style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px', flexWrap: 'wrap', gap: '8px' }}>
            <p style={{ color: 'var(--accent)', fontSize: '11px', letterSpacing: '1px', margin: 0, opacity: 0.8 }}>
              ┌─ RANKING BASEADO EM TYPE BEATS DO MÊS ATUAL ──────────
            </p>
            {trending && (
              <p style={{ color: 'var(--text-faint)', fontSize: '10px', margin: 0 }}>
                {trending.length} artistas detectados
              </p>
            )}
          </div>

          {trendingLoading ? (
            <SkeletonTable rows={6} />
          ) : trending && trending.length > 0 ? (
            <ArtistRankingTable artists={trending} />
          ) : (
            <p style={{ color: 'var(--text-faint)', fontSize: '11px', padding: '16px 0', textAlign: 'center' }}>
              *** SEM DADOS — QUOTA EXCEDIDA OU NENHUM TYPE BEAT ENCONTRADO ESTE MÊS ***
            </p>
          )}
        </div>
      </div>

    </div>
  )
}

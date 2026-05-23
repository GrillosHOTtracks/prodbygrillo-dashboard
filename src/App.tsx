import { useState, useEffect, useCallback, useRef } from 'react'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { Overview } from './pages/Overview'
import { Videos } from './pages/Videos'
import { Analytics } from './pages/Analytics'
import { Audience } from './pages/Audience'
import { Revenue } from './pages/Revenue'
import { Settings } from './pages/Settings'
import { Scheduler } from './pages/Scheduler'
import { BeatStore } from './pages/BeatStore'
import { Market } from './pages/Market'
import { api } from './lib/api'
import type { Page, DateRange } from './types'
import type { DailyRow, ChannelInfo, Video as ApiVideo, AudienceResponse, ArtistTrend, TrafficSource, MonthlyRevenue } from './lib/api'

// ─── Auth overlay ──────────────────────────────────────────────────────────────
function AuthOverlay({ serverDown = false }: { serverDown?: boolean }) {
  const [loading, setLoading] = useState(false)

  async function handleConnect() {
    setLoading(true)
    try {
      const { url } = await api.auth.url()
      window.open(url, '_blank', 'width=500,height=650')
    } catch {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, fontFamily: 'Courier New, monospace',
    }}>
      <div style={{
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--glow-sm)',
        padding: '32px 40px', maxWidth: '440px', width: '90%',
      }}>
        <pre style={{ color: '#00ff00', fontSize: '11px', margin: '0 0 20px', lineHeight: '1.5' }}>{
`  ██████╗ ██████╗  ██████╗
  ██╔══██╗██╔══██╗██╔════╝
  ██████╔╝██████╔╝██║  ███╗
  ██╔═══╝ ██╔══██╗██║   ██║
  ██║     ██║  ██║╚██████╔╝
  ╚═╝     ╚═╝  ╚═╝ ╚═════╝
  prodbygrillo :: analytics`
        }</pre>

        {serverDown ? (
          <>
            <p style={{ color: '#ff4400', fontSize: '12px', marginBottom: '8px' }}>
              &gt; STATUS: SERVER OFFLINE
            </p>
            <p style={{ color: '#555555', fontSize: '11px', marginBottom: '24px', lineHeight: '1.6' }}>
              The backend server is not running.<br/>
              Start it with: <span style={{ color: '#707070' }}>npm run server</span>
            </p>
          </>
        ) : (
          <>
            <p style={{ color: '#707070', fontSize: '12px', marginBottom: '8px' }}>
              &gt; STATUS: NOT AUTHENTICATED
            </p>
            <p style={{ color: '#555555', fontSize: '11px', marginBottom: '24px', lineHeight: '1.6' }}>
              Connect your YouTube channel to load real data.<br/>
              A Google OAuth window will open in your browser.
            </p>

            <button
              onClick={handleConnect}
              disabled={loading}
              style={{
                width: '100%', padding: '10px',
                backgroundColor: loading ? '#003300' : '#00ff00',
                color: '#000000', border: 'none', cursor: loading ? 'wait' : 'pointer',
                fontSize: '13px', fontFamily: 'Courier New, monospace',
                fontWeight: 'bold', letterSpacing: '1px',
                borderTop: '2px solid #00ff00', borderLeft: '2px solid #00ff00',
                borderRight: '2px solid #007700', borderBottom: '2px solid #007700',
              }}
            >
              {loading ? '[ WAITING FOR GOOGLE... ]' : '[ CONNECT YOUTUBE CHANNEL ]'}
            </button>
          </>
        )}

        <p style={{ color: '#333333', fontSize: '10px', marginTop: '16px', textAlign: 'center' }}>
          Make sure the server is running: npm run server
        </p>
      </div>
    </div>
  )
}

// ─── Loading bar ───────────────────────────────────────────────────────────────
function LoadingBar({ label }: { label: string }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', fontFamily: 'Courier New, monospace' }}>
      <p style={{ color: '#00ff00', fontSize: '12px', marginBottom: '8px' }}>{label}</p>
      <p style={{ color: '#333333', fontSize: '11px' }}>
        {'█'.repeat(12)}<span className="blink">█</span>
      </p>
    </div>
  )
}

// ─── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage]                         = useState<Page>('overview')
  const [dateRange, setDateRange]               = useState<DateRange>('28d')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [schedulerPreset, setSchedulerPreset]   = useState<string | undefined>(undefined)

  // Auth
  const [authChecked, setAuthChecked]           = useState(false)
  const [authenticated, setAuthenticated]       = useState(false)
  const [serverDown, setServerDown]             = useState(false)
  const prevAuthenticated                       = useRef(false)

  // Data
  const [channelInfo, setChannelInfo]           = useState<ChannelInfo | null>(null)
  const [analyticsData, setAnalyticsData]       = useState<DailyRow[] | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [videos, setVideos]                     = useState<ApiVideo[] | null>(null)
  const [videosLoading, setVideosLoading]       = useState(false)
  const [audienceData, setAudienceData]         = useState<AudienceResponse | null>(null)
  const [trending, setTrending]                 = useState<ArtistTrend[] | null>(null)
  const [trendingLoading, setTrendingLoading]   = useState(false)
  const [trafficSources, setTrafficSources]     = useState<TrafficSource[] | null>(null)
  const [revenueMonthly, setRevenueMonthly]     = useState<MonthlyRevenue[] | null>(null)
  const [revenueIncluded, setRevenueIncluded]   = useState<boolean | null>(null)

  // Check auth on load + listen for redirect
  const checkAuth = useCallback(async () => {
    try {
      const { authenticated: ok } = await api.auth.status()
      setAuthenticated(ok)
      setServerDown(false)
      return ok
    } catch {
      setServerDown(true)
      return false
    } finally {
      setAuthChecked(true)
    }
  }, [])

  useEffect(() => {
    checkAuth()

    const params = new URLSearchParams(window.location.search)
    if (params.get('auth') === 'success') {
      window.history.replaceState({}, '', '/')
      checkAuth().then(ok => { if (ok) setAuthenticated(true) })
    }

    const interval = setInterval(async () => {
      try {
        const { authenticated: ok } = await api.auth.status()
        if (ok) { setAuthenticated(true); setServerDown(false); clearInterval(interval) }
      } catch { /* server not ready */ }
    }, 2000)
    return () => clearInterval(interval)
  }, [checkAuth])

  // Fetch channel info once authenticated
  useEffect(() => {
    if (!authenticated) return
    const justConnected = !prevAuthenticated.current
    prevAuthenticated.current = true
    api.channel(justConnected).then(setChannelInfo).catch(err => {
      console.warn('[channel]', err?.message || err)
    })
    setVideosLoading(true)
    api.videos()
      .then(r => setVideos(r.data))
      .catch(err => { console.warn('[videos]', err?.message || err) })
      .finally(() => setVideosLoading(false))
    setTrendingLoading(true)
    api.trending()
      .then(setTrending)
      .catch(err => { console.warn('[trending]', err?.message || err) })
      .finally(() => setTrendingLoading(false))
    api.revenueMonthly().then(r => setRevenueMonthly(r.data)).catch(err => {
      console.warn('[revenue-monthly]', err?.message || err)
    })
  }, [authenticated])

  // Fetch analytics + audience when range changes
  useEffect(() => {
    if (!authenticated) return
    setAnalyticsLoading(true)
    api.analytics(dateRange)
      .then(r => { setAnalyticsData(r.data); setRevenueIncluded(r.revenueIncluded) })
      .catch(err => { console.warn('[analytics]', err?.message || err) })
      .finally(() => setAnalyticsLoading(false))
    api.traffic(dateRange).then(r => setTrafficSources(r.data)).catch(err => {
      console.warn('[traffic]', err?.message || err)
    })
    api.audience(dateRange).then(setAudienceData).catch(err => {
      console.warn('[audience]', err?.message || err)
    })
  }, [authenticated, dateRange])

  const metricsData = analyticsData ?? []

  if (!authChecked) return <LoadingBar label="> CONNECTING TO SERVER..." />
  if (serverDown)   return <AuthOverlay serverDown />
  if (!authenticated) return <AuthOverlay />

  function renderPage() {
    switch (page) {
      case 'overview':
        return <Overview
          data={metricsData}
          channelInfo={channelInfo}
          loading={analyticsLoading}
          videos={videos}
          videosLoading={videosLoading}
          trending={trending}
          trendingLoading={trendingLoading}
          trafficSources={trafficSources}
          onUseInScheduler={(name) => { setSchedulerPreset(name); setPage('scheduler') }}
        />
      case 'videos':
        return <Videos realVideos={videos} loading={videosLoading} />
      case 'analytics':
        return <Analytics data={metricsData} loading={analyticsLoading} />
      case 'audience':
        return <Audience realData={audienceData} channelInfo={channelInfo} />
      case 'revenue':
        return <Revenue revenueMonthly={revenueMonthly} revenueIncluded={revenueIncluded} />
      case 'scheduler':
        return <Scheduler onNavigate={setPage} presetArtist={schedulerPreset} onPresetConsumed={() => setSchedulerPreset(undefined)} />
      case 'beatstore':
        return <BeatStore onNavigate={setPage} />
      case 'market':
        return <Market onNavigate={setPage} />
      case 'settings':
        return <Settings authenticated={authenticated} onLogout={async () => {
          setAuthenticated(false)
          setAnalyticsData(null)
          setChannelInfo(null)
        }} />
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', backgroundColor: 'var(--bg)' }}>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar
          currentPage={page}
          onNavigate={setPage}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(c => !c)}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Header
            currentPage={page}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            authenticated={authenticated}
            isDemo={false}
            channelId={channelInfo?.id}
            onLogout={async () => {
              setAuthenticated(false)
              setAnalyticsData(null)
              setChannelInfo(null)
            }}
          />
          <main style={{ flex: 1, overflowY: 'auto', padding: '14px', backgroundColor: 'var(--bg)' }}>
            {renderPage()}
          </main>
        </div>
      </div>
    </div>
  )
}

const BASE = '/api'

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('dashboard_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw Object.assign(new Error(body.error || res.statusText), { status: res.status, code: body.code })
  }
  return res.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw Object.assign(new Error(b.error || res.statusText), { status: res.status, code: b.code })
  }
  return res.json()
}

type Cacheable = { _cached?: boolean; _cachedAt?: string }

export type AuthStatus = { authenticated: boolean }
export type ChannelInfo = {
  id: string; name: string; handle: string; description: string
  thumbnail: string; country: string; publishedAt: string
  subscribers: number; totalViews: number; totalVideos: number
  _seeded?: boolean
  _innertube?: boolean
} & Cacheable
export type DailyRow = {
  date: string; views: number; watchTime: number
  subscribers: number; impressions: number; ctr: number; revenue: number
}
export type AnalyticsResponse = { data: DailyRow[]; revenueIncluded: boolean } & Cacheable
export type TrafficSource = { name: string; value: number; color: string }
export type TrafficResponse = { data: TrafficSource[] } & Cacheable
export type MonthlyRevenue = { month: string; revenue: number }
export type RevenueResponse = { data: MonthlyRevenue[] } & Cacheable
export type Video = {
  id: string; title: string; thumbnail: string; publishedAt: string
  views: number; likes: number; comments: number; watchTime: number
  ctr: number; avgDuration: string; revenue: number; status: string
}
export type VideosResponse = { data: Video[] } & Cacheable
export type BeatIdea = {
  bpm:      string
  keys:     string[]
  elements: string[]
}

export type ArtistTrend = {
  name:               string
  beatCount:          number
  totalViews:         number
  avgViews:           number
  latestBeat:         string
  photo?:             string | null
  vibes?:             string[]
  demandScore?:       number
  saturation?:        'low' | 'medium' | 'high'
  opportunityScore?:  number
  hotTag?:            string | null
  beatIdea?:          BeatIdea
  beats7d?:           number
  beats7_14d?:        number
  uploadGrowth?:      number
  viewsGrowth?:       number | null
  newestDaysAgo?:     number | null
  spotifyPopularity?: number
  spotifyFollowers?:  number
  trendsScore?:       number | null
}

export type OAuthStatus = {
  type:          'oauth'
  label:         string
  authenticated: boolean
  quotaExceeded: boolean
  hasCredFile:   boolean
}
export type ApiKeyStatus = {
  n:             number
  type:          'apikey'
  label:         string
  active:        boolean
  quotaExceeded: boolean
  quotaExceededAt: number | null
}
export type AccountsStatus = {
  oauth: OAuthStatus
  keys:  ApiKeyStatus[]
}

export type AudienceResponse = {
  audienceAge: { range: string; male: number; female: number; other: number }[]
  countries: { code: string; name: string; views: number; percentage: number }[]
  devices: { label: string; value: number }[]
  subscriberRatio: { subscribed: number; unsubscribed: number } | null
} & Cacheable

export const api = {
  dashboard: {
    login:  (username: string, password: string) =>
      post<{ token: string }>('/auth/dashboard-login', { username, password }),
    verify: () => get<{ ok: boolean }>('/auth/dashboard-verify'),
    logout: () => { localStorage.removeItem('dashboard_token') },
  },
  auth: {
    status:  ()         => get<AuthStatus>('/auth/status'),
    url:     ()         => get<{ url: string }>(`/auth/url?origin=${encodeURIComponent(window.location.origin)}`),
    logout:  async ()   => { await fetch(`${BASE}/auth/logout`, { method: 'POST', headers: authHeaders() }) },
  },
  accounts: {
    status:     ()  => get<AccountsStatus>('/accounts/status'),
    connect:    ()  => get<{ url: string }>(`/auth/url?origin=${encodeURIComponent(window.location.origin)}`),
    disconnect: async () => { await fetch(`${BASE}/auth/logout`, { method: 'POST' }) },
  },
  channel:        (bust = false) => get<ChannelInfo>(`/channel${bust ? '?bust=1' : ''}`),
  analytics:      (range: string) => get<AnalyticsResponse>(`/analytics?range=${range}`),
  traffic:        (range: string) => get<TrafficResponse>(`/analytics/traffic?range=${range}`),
  revenueMonthly: ()             => get<RevenueResponse>('/analytics/revenue-monthly'),
  videos:         ()             => get<VideosResponse>('/videos'),
  audience:       (range: string) => get<AudienceResponse>(`/audience?range=${range}`),
  trending:       ()             => get<ArtistTrend[]>('/trending'),
}

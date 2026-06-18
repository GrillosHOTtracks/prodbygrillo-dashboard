const BASE = '/api'

// FIX (correction 8): all requests use credentials:'include' so the httpOnly
// cookie is sent automatically. No JWT stored in localStorage.
// The authHeaders helper is kept as an empty object so existing call-sites compile
// unchanged — the cookie handles authentication now.
function authHeaders(): HeadersInit {
  return {}
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers:     authHeaders(),
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw Object.assign(new Error(body.error || res.statusText), { status: res.status, code: body.code })
  }
  return res.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method:      'POST',
    headers:     { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'include',
    body:        JSON.stringify(body),
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
  type:           'oauth'
  label:          string
  authenticated:  boolean
  quotaExceeded:  boolean
  hasCredFile:    boolean
  channelName:    string | null
  channelHandle:  string | null
  accountEmail:   string | null
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

export type GenreTrend = {
  id:               string
  label:            string
  beatCount:        number
  avgViews:         number
  totalViews:       number
  topArtists:       string[]
  saturation:       'low' | 'medium' | 'high'
  opportunityScore: number
  hotTag:           string | null
  beatIdea:         BeatIdea
}

export type TikTokUser = {
  display_name:   string
  avatar_url:     string
  follower_count: number
  following_count: number
  likes_count:    number
  video_count:    number
  is_verified:    boolean
}
export type TikTokStatus = {
  authenticated: boolean
  hasToken:      boolean
  openId:        string | null
  expiresAt:     number | null
  scope:         string | null
  configured:    boolean
  user?:         TikTokUser | null
}

export const api = {
  dashboard: {
    // FIX (correction 8): login no longer returns a token — authentication is via
    // httpOnly cookie set by the server. No localStorage involved.
    login:  (username: string, password: string) =>
      post<{ ok: boolean }>('/auth/dashboard-login', { username, password }),
    verify: () => get<{ ok: boolean }>('/auth/dashboard-verify'),
    // FIX (correction 8): logout calls server endpoint to clear the httpOnly cookie
    logout: () => post<{ ok: boolean }>('/auth/dashboard-logout', {}),
  },
  auth: {
    status:  ()         => get<AuthStatus>('/auth/status'),
    url:     ()         => get<{ url: string }>(`/auth/url?origin=${encodeURIComponent(window.location.origin)}`),
    logout:  async ()   => { await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' }) },
  },
  accounts: {
    status:     () => get<AccountsStatus>('/accounts/status'),
    connect:    () => get<{ url: string }>(`/auth/url?origin=${encodeURIComponent(window.location.origin)}`),
    disconnect: () => post<{ ok: boolean }>('/auth/logout', {}),
  },
  channel:        (bust = false) => get<ChannelInfo>(`/channel${bust ? '?bust=1' : ''}`),
  analytics:      (range: string) => get<AnalyticsResponse>(`/analytics?range=${range}`),
  traffic:        (range: string) => get<TrafficResponse>(`/analytics/traffic?range=${range}`),
  revenueMonthly: ()             => get<RevenueResponse>('/analytics/revenue-monthly'),
  videos:         ()             => get<VideosResponse>('/videos'),
  audience:       (range: string) => get<AudienceResponse>(`/audience?range=${range}`),
  trending:       ()             => get<ArtistTrend[]>('/trending'),
  market:         (bust = false) => get<GenreTrend[]>(`/market${bust ? '?bust=1' : ''}`),
  tiktok: {
    status: () => get<TikTokStatus>('/tiktok/status'),
    auth:   () => get<{ url: string }>('/tiktok/auth'),
    logout: () => post<{ ok: boolean }>('/tiktok/logout', {}),
  },
}

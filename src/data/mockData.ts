import type { Video, DailyMetric, TrafficSource, AgeGroup, Country, RevenueBreakdown } from '../types'

export const channelInfo = {
  name: 'prodbygrillo',
  handle: '@prodbygrillo',
  avatar: 'PG',
  subscribers: 127400,
  totalViews: 8420000,
  totalVideos: 247,
  joinedDate: 'Jan 2019',
  country: 'Brazil',
  category: 'Music Production',
}

function generateDailyMetrics(days: number): DailyMetric[] {
  const data: DailyMetric[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    const base = Math.sin(i * 0.2) * 0.3 + 0.7
    const spike = Math.random() > 0.85 ? 1.8 : 1
    const views = Math.floor(14000 * base * spike + Math.random() * 3000)
    data.push({
      date: date.toISOString().split('T')[0],
      views,
      watchTime: Math.floor(views * 4.2),
      subscribers: Math.floor(views * 0.0045 + Math.random() * 15),
      revenue: parseFloat((views * 0.0016 + Math.random() * 8).toFixed(2)),
      impressions: Math.floor(views * 3.1),
      ctr: parseFloat((3.2 + Math.random() * 2.4).toFixed(1)),
    })
  }
  return data
}

export const metrics365 = generateDailyMetrics(365)
export const metrics90 = metrics365.slice(-90)
export const metrics28 = metrics365.slice(-28)
export const metrics7 = metrics365.slice(-7)

export const topVideos: Video[] = [
  {
    id: '1',
    title: 'FREE Trap Beat 2024 - "Dark Hours" | Hard Rap Instrumental',
    thumbnail: '🎵',
    views: 892400,
    watchTime: 3840000,
    likes: 18200,
    comments: 1430,
    ctr: 8.4,
    avgDuration: '3:42',
    publishedAt: '2024-01-15',
    revenue: 1247.80,
    status: 'published',
  },
  {
    id: '2',
    title: 'FREE Drill Beat 2024 - "Night Shift" | UK Drill Type Beat',
    thumbnail: '🥁',
    views: 654300,
    watchTime: 2740000,
    likes: 12100,
    comments: 876,
    ctr: 7.2,
    avgDuration: '3:58',
    publishedAt: '2024-02-08',
    revenue: 934.20,
    status: 'published',
  },
  {
    id: '3',
    title: 'How I Make Professional Trap Beats in FL Studio 21 (Full Tutorial)',
    thumbnail: '🎹',
    views: 487200,
    watchTime: 5810000,
    likes: 9800,
    comments: 2140,
    ctr: 6.8,
    avgDuration: '12:18',
    publishedAt: '2024-03-22',
    revenue: 712.50,
    status: 'published',
  },
  {
    id: '4',
    title: 'FREE Afrobeats Beat 2024 - "Lagos Nights" | Afro Pop Instrumental',
    thumbnail: '🌍',
    views: 421800,
    watchTime: 1680000,
    likes: 8900,
    comments: 634,
    ctr: 5.9,
    avgDuration: '3:29',
    publishedAt: '2024-04-10',
    revenue: 589.40,
    status: 'published',
  },
  {
    id: '5',
    title: 'FREE Melodic Drill Beat - "Midnight Rain" | Central Cee Type Beat',
    thumbnail: '🎸',
    views: 398700,
    watchTime: 1590000,
    likes: 8200,
    comments: 521,
    ctr: 6.1,
    avgDuration: '3:51',
    publishedAt: '2024-04-28',
    revenue: 541.30,
    status: 'published',
  },
  {
    id: '6',
    title: 'FREE R&B Beat 2024 - "Velvet" | SZA Type Beat',
    thumbnail: '🎤',
    views: 312400,
    watchTime: 1248000,
    likes: 6700,
    comments: 412,
    ctr: 5.4,
    avgDuration: '3:44',
    publishedAt: '2024-05-14',
    revenue: 423.80,
    status: 'published',
  },
  {
    id: '7',
    title: 'Beat Making Secrets: The Swing Technique That Changes Everything',
    thumbnail: '🔧',
    views: 276100,
    watchTime: 2488000,
    likes: 5900,
    comments: 1820,
    ctr: 7.8,
    avgDuration: '9:02',
    revenue: 389.20,
    publishedAt: '2024-05-30',
    status: 'published',
  },
  {
    id: '8',
    title: 'FREE Phonk Beat 2024 - "Drift Season" | Aggressive Type Beat',
    thumbnail: '💀',
    views: 241600,
    watchTime: 964000,
    likes: 5200,
    comments: 318,
    ctr: 4.9,
    avgDuration: '3:22',
    publishedAt: '2024-06-12',
    revenue: 312.40,
    status: 'published',
  },
]

export const trafficSources: TrafficSource[] = [
  { name: 'YouTube Search', value: 38, color: '#ff0000' },
  { name: 'External', value: 22, color: '#3b82f6' },
  { name: 'Suggested Videos', value: 18, color: '#8b5cf6' },
  { name: 'Browse Features', value: 12, color: '#f97316' },
  { name: 'Direct / Unknown', value: 6, color: '#00c896' },
  { name: 'Playlists', value: 4, color: '#eab308' },
]

export const audienceAgeGroups: AgeGroup[] = [
  { range: '13-17', male: 8, female: 4, other: 1 },
  { range: '18-24', male: 32, female: 14, other: 2 },
  { range: '25-34', male: 24, female: 8, other: 1 },
  { range: '35-44', male: 12, female: 4, other: 1 },
  { range: '45-54', male: 5, female: 2, other: 0 },
  { range: '55+', male: 2, female: 1, other: 0 },
]

export const topCountries: Country[] = [
  { name: 'United States', code: 'US', views: 2210000, percentage: 26.2 },
  { name: 'Brazil', code: 'BR', views: 1480000, percentage: 17.6 },
  { name: 'United Kingdom', code: 'GB', views: 892000, percentage: 10.6 },
  { name: 'Germany', code: 'DE', views: 634000, percentage: 7.5 },
  { name: 'Mexico', code: 'MX', views: 521000, percentage: 6.2 },
  { name: 'Canada', code: 'CA', views: 412000, percentage: 4.9 },
  { name: 'France', code: 'FR', views: 318000, percentage: 3.8 },
  { name: 'Australia', code: 'AU', views: 287000, percentage: 3.4 },
]

export const revenueBreakdown: RevenueBreakdown[] = [
  { source: 'Ad Revenue (CPM)', amount: 1842, color: '#ff0000' },
  { source: 'Super Thanks', amount: 312, color: '#3b82f6' },
  { source: 'Channel Memberships', amount: 189, color: '#8b5cf6' },
  { source: 'YouTube Premium', amount: 97, color: '#00c896' },
]

export const monthlyRevenue = [
  { month: 'Jun', revenue: 1840 },
  { month: 'Jul', revenue: 2120 },
  { month: 'Aug', revenue: 1980 },
  { month: 'Sep', revenue: 2340 },
  { month: 'Oct', revenue: 2780 },
  { month: 'Nov', revenue: 3120 },
  { month: 'Dec', revenue: 3840 },
  { month: 'Jan', revenue: 2640 },
  { month: 'Feb', revenue: 2280 },
  { month: 'Mar', revenue: 2490 },
  { month: 'Apr', revenue: 2710 },
  { month: 'May', revenue: 2440 },
]

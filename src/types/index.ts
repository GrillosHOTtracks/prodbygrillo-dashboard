export type Page = 'overview' | 'videos' | 'analytics' | 'audience' | 'revenue' | 'scheduler' | 'beatstore' | 'settings'

export type DateRange = '7d' | '28d' | '90d' | '365d'

export interface StatCard {
  label: string
  value: string
  change: number
  icon: string
  color: string
}

export interface Video {
  id: string
  title: string
  thumbnail: string
  views: number
  watchTime: number
  likes: number
  comments: number
  ctr: number
  avgDuration: string
  publishedAt: string
  revenue: number
  status: 'published' | 'processing' | 'draft'
}

export interface DailyMetric {
  date: string
  views: number
  watchTime: number
  subscribers: number
  revenue: number
  impressions: number
  ctr: number
}

export interface TrafficSource {
  name: string
  value: number
  color: string
}

export interface AgeGroup {
  range: string
  male: number
  female: number
  other: number
}

export interface Country {
  name: string
  code: string
  views: number
  percentage: number
}

export interface RevenueBreakdown {
  source: string
  amount: number
  color: string
}

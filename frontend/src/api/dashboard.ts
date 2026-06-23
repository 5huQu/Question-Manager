import { api } from './client'

export type ActivityHeatmapMetric = 'all' | 'questions_created' | 'questions_updated' | 'exports_created' | 'ocr_completed'

export type ActivityHeatmapParams = {
  from?: string
  to?: string
  metric?: ActivityHeatmapMetric
}

export type ActivityHeatmapSummary = {
  totalCount: number
  activeDays: number
  maxCount: number
  averagePerActiveDay: number
}

export type ActivityHeatmapDay = {
  date: string
  count: number
  level: 0 | 1 | 2 | 3 | 4
  breakdown: {
    questionsCreated: number
    questionsUpdated: number
    questionsBanked: number
    exportsCreated: number
    ocrCompleted: number
  }
}

export type ActivityHeatmapResponse = {
  from: string
  to: string
  metric: ActivityHeatmapMetric
  timezone: string
  summary: ActivityHeatmapSummary
  days: ActivityHeatmapDay[]
}

function buildActivityHeatmapQuery(params: ActivityHeatmapParams = {}) {
  const query = new URLSearchParams()
  const entries: Array<[keyof ActivityHeatmapParams, string | undefined]> = [
    ['from', params.from],
    ['to', params.to],
    ['metric', params.metric],
  ]

  for (const [key, value] of entries) {
    const normalized = value?.trim()
    if (normalized) query.set(key, normalized)
  }

  const queryString = query.toString()
  return queryString ? `?${queryString}` : ''
}

export const dashboardApi = {
  getActivityHeatmap(params: ActivityHeatmapParams = {}) {
    return api<ActivityHeatmapResponse>(`/api/dashboard/activity-heatmap${buildActivityHeatmapQuery(params)}`)
  },
}

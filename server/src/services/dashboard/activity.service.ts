import { RouteError } from '../../utils/http-error.js'
import { getActivityBreakdownByDay, type ActivityBreakdownCounts, type ActivityMetricKey } from '../../repositories/dashboard/activity.repo.js'

export type ActivityMetric = 'all' | 'questions_created' | 'questions_updated' | 'exports_created' | 'ocr_completed'

type ActivityHeatmapQuery = {
  from?: unknown
  to?: unknown
  metric?: unknown
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const SUPPORTED_METRICS: ActivityMetric[] = ['all', 'questions_created', 'questions_updated', 'exports_created', 'ocr_completed']

const METRIC_KEYS: Record<Exclude<ActivityMetric, 'all'>, ActivityMetricKey> = {
  questions_created: 'questionsCreated',
  questions_updated: 'questionsUpdated',
  exports_created: 'exportsCreated',
  ocr_completed: 'ocrCompleted',
}

function localDateParts(date: Date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
  }
}

function formatLocalDate(date: Date) {
  const { year, month, day } = localDateParts(date)
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

function addLocalDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function addLocalMonths(date: Date, months: number) {
  const next = new Date(date)
  next.setMonth(next.getMonth() + months)
  return next
}

function parseDateParam(value: unknown, name: 'from' | 'to') {
  if (value === undefined || value === null || value === '') return undefined
  if (Array.isArray(value) || typeof value !== 'string' || !DATE_PATTERN.test(value) || !parseLocalDate(value)) {
    throw new RouteError(400, `${name} 参数必须是 YYYY-MM-DD 格式。`)
  }
  return value
}

function parseMetricParam(value: unknown): ActivityMetric {
  if (value === undefined || value === null || value === '') return 'all'
  if (Array.isArray(value) || typeof value !== 'string' || !SUPPORTED_METRICS.includes(value as ActivityMetric)) {
    throw new RouteError(400, `metric 参数仅支持：${SUPPORTED_METRICS.join(', ')}。`)
  }
  return value as ActivityMetric
}

function resolveDateRange(query: ActivityHeatmapQuery) {
  const fromParam = parseDateParam(query.from, 'from')
  const toParam = parseDateParam(query.to, 'to')
  const today = new Date()
  const to = toParam ?? formatLocalDate(today)
  const from = fromParam ?? formatLocalDate(addLocalMonths(parseLocalDate(to) ?? today, -6))
  const fromDate = parseLocalDate(from)
  const toDate = parseLocalDate(to)
  if (!fromDate || !toDate) throw new RouteError(400, '日期参数无效。')
  if (fromDate.getTime() > toDate.getTime()) throw new RouteError(400, 'from 不能晚于 to。')
  return { from, to, fromDate, toDate }
}

function emptyBreakdown(): ActivityBreakdownCounts & { questionsBanked: number } {
  return {
    questionsCreated: 0,
    questionsUpdated: 0,
    // question_bank_items.bank_status has no reliable transition timestamp yet.
    questionsBanked: 0,
    exportsCreated: 0,
    ocrCompleted: 0,
  }
}

function countForMetric(metric: ActivityMetric, breakdown: ActivityBreakdownCounts) {
  if (metric === 'all') {
    return breakdown.questionsCreated + breakdown.questionsUpdated + breakdown.exportsCreated + breakdown.ocrCompleted
  }
  return breakdown[METRIC_KEYS[metric]]
}

function levelForCount(count: number, maxCount: number) {
  if (count === 0 || maxCount === 0) return 0
  if (count <= maxCount * 0.25) return 1
  if (count <= maxCount * 0.5) return 2
  if (count <= maxCount * 0.75) return 3
  return 4
}

export function getActivityHeatmap(query: ActivityHeatmapQuery = {}) {
  const metric = parseMetricParam(query.metric)
  const { from, to, fromDate, toDate } = resolveDateRange(query)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
  const rowsByMetric = getActivityBreakdownByDay(from, to)
  const daysByDate = new Map<string, ReturnType<typeof emptyBreakdown>>()

  for (let cursor = fromDate; cursor.getTime() <= toDate.getTime(); cursor = addLocalDays(cursor, 1)) {
    daysByDate.set(formatLocalDate(cursor), emptyBreakdown())
  }

  for (const [key, rows] of Object.entries(rowsByMetric) as Array<[ActivityMetricKey, Array<{ date: string; count: number }>]>) {
    for (const row of rows) {
      const breakdown = daysByDate.get(row.date)
      if (breakdown) breakdown[key] = Number(row.count || 0)
    }
  }

  const rawDays = Array.from(daysByDate.entries()).map(([date, breakdown]) => ({
    date,
    count: countForMetric(metric, breakdown),
    breakdown,
  }))
  const maxCount = rawDays.reduce((max, day) => Math.max(max, day.count), 0)
  const days = rawDays.map((day) => ({
    date: day.date,
    count: day.count,
    level: levelForCount(day.count, maxCount),
    breakdown: day.breakdown,
  }))
  const totalCount = days.reduce((sum, day) => sum + day.count, 0)
  const activeDays = days.filter((day) => day.count > 0).length

  return {
    from,
    to,
    metric,
    timezone,
    summary: {
      totalCount,
      activeDays,
      maxCount,
      averagePerActiveDay: activeDays ? totalCount / activeDays : 0,
    },
    days,
  }
}

import { db } from '../../db/connection.js'

export type ActivityMetricKey = 'questionsCreated' | 'questionsUpdated' | 'exportsCreated' | 'ocrCompleted' | 'documentsCreated'

export type ActivityBreakdownCounts = Record<ActivityMetricKey, number>

export type ActivityCountRow = {
  date: string
  count: number
}

export type ActivityHourCountRow = {
  hour: number
  count: number
}

const SOURCES: Record<ActivityMetricKey, Array<{ table: string; column: string }>> = {
  questionsCreated: [{ table: 'question_bank_items', column: 'created_at' }],
  questionsUpdated: [{ table: 'question_bank_items', column: 'updated_at' }],
  exportsCreated: [{ table: 'question_bank_export_records', column: 'created_at' }],
  ocrCompleted: [{ table: 'source_document_ocr_tasks', column: 'finished_at' }],
  documentsCreated: [
    { table: 'source_documents', column: 'created_at' },
    { table: 'pdf_slicer_runs', column: 'created_at' },
  ],
}

function tableHasColumn(table: string, column: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return columns.some((item) => item.name === column)
}

function countByLocalDay(sources: Array<{ table: string; column: string }>, from: string, to: string): ActivityCountRow[] {
  const counts = new Map<string, number>()
  for (const { table, column } of sources) {
    if (!tableHasColumn(table, column)) continue
    const rows = db.prepare(`
      SELECT date(${column}, 'localtime') AS date, COUNT(*) AS count
      FROM ${table}
      WHERE TRIM(COALESCE(${column}, '')) != ''
        AND date(${column}, 'localtime') BETWEEN ? AND ?
      GROUP BY date(${column}, 'localtime')
      ORDER BY date ASC
    `).all(from, to) as ActivityCountRow[]
    for (const row of rows) {
      counts.set(row.date, (counts.get(row.date) ?? 0) + Number(row.count || 0))
    }
  }
  return Array.from(counts.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

function countByLocalHour(sources: Array<{ table: string; column: string }>, from: string, to: string): ActivityHourCountRow[] {
  const counts = new Map<number, number>()
  for (const { table, column } of sources) {
    if (!tableHasColumn(table, column)) continue
    const rows = db.prepare(`
      SELECT CAST(strftime('%H', ${column}, 'localtime') AS INTEGER) AS hour, COUNT(*) AS count
      FROM ${table}
      WHERE TRIM(COALESCE(${column}, '')) != ''
        AND date(${column}, 'localtime') BETWEEN ? AND ?
      GROUP BY CAST(strftime('%H', ${column}, 'localtime') AS INTEGER)
      ORDER BY hour ASC
    `).all(from, to) as ActivityHourCountRow[]
    for (const row of rows) {
      counts.set(Number(row.hour), (counts.get(Number(row.hour)) ?? 0) + Number(row.count || 0))
    }
  }
  return Array.from(counts.entries())
    .map(([hour, count]) => ({ hour, count }))
    .sort((a, b) => a.hour - b.hour)
}

export function getActivityBreakdownByDay(from: string, to: string) {
  const result: Record<ActivityMetricKey, ActivityCountRow[]> = {
    questionsCreated: [],
    questionsUpdated: [],
    exportsCreated: [],
    ocrCompleted: [],
    documentsCreated: [],
  }

  for (const [key, sources] of Object.entries(SOURCES) as Array<[ActivityMetricKey, Array<{ table: string; column: string }>]>) {
    result[key] = countByLocalDay(sources, from, to)
  }

  return result
}

export function getActivityBreakdownByHour(from: string, to: string) {
  const result: Record<ActivityMetricKey, ActivityHourCountRow[]> = {
    questionsCreated: [],
    questionsUpdated: [],
    exportsCreated: [],
    ocrCompleted: [],
    documentsCreated: [],
  }

  for (const [key, sources] of Object.entries(SOURCES) as Array<[ActivityMetricKey, Array<{ table: string; column: string }>]>) {
    result[key] = countByLocalHour(sources, from, to)
  }

  return result
}

import { db } from '../../db/connection.js'

export type ActivityMetricKey = 'questionsCreated' | 'questionsUpdated' | 'exportsCreated' | 'ocrCompleted'

export type ActivityBreakdownCounts = Record<ActivityMetricKey, number>

export type ActivityCountRow = {
  date: string
  count: number
}

export type ActivityHourCountRow = {
  hour: number
  count: number
}

const SOURCES: Record<ActivityMetricKey, { table: string; column: string }> = {
  questionsCreated: { table: 'question_bank_items', column: 'created_at' },
  questionsUpdated: { table: 'question_bank_items', column: 'updated_at' },
  exportsCreated: { table: 'question_bank_export_records', column: 'created_at' },
  ocrCompleted: { table: 'source_document_ocr_tasks', column: 'finished_at' },
}

function tableHasColumn(table: string, column: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return columns.some((item) => item.name === column)
}

function countByLocalDay(table: string, column: string, from: string, to: string): ActivityCountRow[] {
  if (!tableHasColumn(table, column)) return []
  return db.prepare(`
    SELECT date(${column}, 'localtime') AS date, COUNT(*) AS count
    FROM ${table}
    WHERE TRIM(COALESCE(${column}, '')) != ''
      AND date(${column}, 'localtime') BETWEEN ? AND ?
    GROUP BY date(${column}, 'localtime')
    ORDER BY date ASC
  `).all(from, to) as ActivityCountRow[]
}

function countByLocalHour(table: string, column: string, from: string, to: string): ActivityHourCountRow[] {
  if (!tableHasColumn(table, column)) return []
  return db.prepare(`
    SELECT CAST(strftime('%H', ${column}, 'localtime') AS INTEGER) AS hour, COUNT(*) AS count
    FROM ${table}
    WHERE TRIM(COALESCE(${column}, '')) != ''
      AND date(${column}, 'localtime') BETWEEN ? AND ?
    GROUP BY CAST(strftime('%H', ${column}, 'localtime') AS INTEGER)
    ORDER BY hour ASC
  `).all(from, to) as ActivityHourCountRow[]
}

export function getActivityBreakdownByDay(from: string, to: string) {
  const result: Record<ActivityMetricKey, ActivityCountRow[]> = {
    questionsCreated: [],
    questionsUpdated: [],
    exportsCreated: [],
    ocrCompleted: [],
  }

  for (const [key, source] of Object.entries(SOURCES) as Array<[ActivityMetricKey, { table: string; column: string }]>) {
    result[key] = countByLocalDay(source.table, source.column, from, to)
  }

  return result
}

export function getActivityBreakdownByHour(from: string, to: string) {
  const result: Record<ActivityMetricKey, ActivityHourCountRow[]> = {
    questionsCreated: [],
    questionsUpdated: [],
    exportsCreated: [],
    ocrCompleted: [],
  }

  for (const [key, source] of Object.entries(SOURCES) as Array<[ActivityMetricKey, { table: string; column: string }]>) {
    result[key] = countByLocalHour(source.table, source.column, from, to)
  }

  return result
}

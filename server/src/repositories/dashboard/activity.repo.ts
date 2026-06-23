import { db } from '../../db/connection.js'

export type ActivityMetricKey = 'questionsCreated' | 'questionsUpdated' | 'exportsCreated' | 'ocrCompleted'

export type ActivityBreakdownCounts = Record<ActivityMetricKey, number>

export type ActivityCountRow = {
  date: string
  count: number
}

const SOURCES: Record<ActivityMetricKey, { table: string; column: string }> = {
  questionsCreated: { table: 'question_bank_items', column: 'created_at' },
  questionsUpdated: { table: 'question_bank_items', column: 'updated_at' },
  exportsCreated: { table: 'question_bank_export_records', column: 'created_at' },
  ocrCompleted: { table: 'pdf_slicer_runs', column: 'ocr_finished_at' },
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

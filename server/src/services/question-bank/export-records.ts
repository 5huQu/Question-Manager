import type { ExportRecordSourceType } from '../../types/index.js'

type ExportVariant = 'student' | 'teacher'

export function normalizeExportRecordSourceType(value: unknown): ExportRecordSourceType | '' {
  if (value === 'collection' || value === 'run' || value === 'import_job') return value
  return ''
}

export function normalizeExportVariant(value: unknown): ExportVariant {
  if (value === 'teacher' || value === 'answers') return 'teacher'
  return 'student'
}

export function normalizeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

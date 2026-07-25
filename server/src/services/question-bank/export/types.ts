import { getCollection } from '../../../db/collections.js'

/**
 * Collection-shaped object with the minimum fields needed for export.
 */
export type ExportCollection = NonNullable<ReturnType<typeof getCollection>>

export type ExportVariant = 'student' | 'teacher' | 'error_notebook'
export type StandardExportVariant = Exclude<ExportVariant, 'error_notebook'>
export type ExportContentField = 'stem' | 'answer' | 'analysis'

export function normalizeExportVariant(value: unknown): ExportVariant {
  if (value === 'error_notebook' || value === 'error-notebook') return 'error_notebook'
  if (value === 'teacher' || value === 'answers') return 'teacher'
  return 'student'
}

export function exportFieldsForVariant(variant: ExportVariant): ExportContentField[] {
  return variant === 'teacher' ? ['stem', 'answer', 'analysis'] : ['stem']
}

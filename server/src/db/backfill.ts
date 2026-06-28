import { db } from './connection.js'
import path from 'node:path'
import fs from 'node:fs'
import { storageRoot, pythonDataRoot, pythonRoot } from '../config.js'
import { parseJson } from '../utils/json.js'
import { resolveStoragePath, stripAssetPrefix } from '../utils/paths.js'
import { nowIso } from '../utils/ids.js'
import type { ExportRecordRow, ExportRecordItemSnapshot } from '../types/index.js'

/**
 * Backfill figure assets from doc2x_v3 OCR draft files into question_bank_items.
 * Processes figures_json that reference doc2x_v3 origin figures and normalizes
 * them into the standard figures format with usage categorization.
 */
export function backfillDoc2xFigureAssets() {
  const rows = db.prepare("SELECT id, figures_json FROM question_bank_items WHERE figures_json LIKE '%doc2x_v3%'").all() as Array<{ id: string; figures_json: string }>
  for (const row of rows) {
    const draftPath = path.join(pythonDataRoot, 'ocr_drafts', row.id, 'ocr_result.json')
    if (!fs.existsSync(draftPath)) continue
    const draft = parseJson<Record<string, any>>(fs.readFileSync(draftPath, 'utf8'), {})
    const figures = Array.isArray(draft.figures) ? draft.figures : []
    const directAssets = figures.filter((figure) => {
      if (!figure || figure.origin !== 'doc2x_v3' || !figure.path) return false
      return fs.existsSync(resolveStoragePath(stripAssetPrefix(String(figure.path))))
    })
    if (!directAssets.length) continue
    const normalizedAssets = directAssets.map((figure) => {
      const usage = String(figure.usage || figure.category || 'stem') === 'question' ? 'stem' : String(figure.usage || figure.category || 'stem')
      return { ...figure, usage, category: String(figure.category || (usage === 'stem' ? 'question' : usage)) }
    })
    const current = parseJson<Array<Record<string, any>>>(row.figures_json, [])
    const currentPaths = current.map((figure) => String(figure.path || '')).join('|')
    const nextPaths = normalizedAssets.map((figure) => `${String(figure.path || '')}:${String(figure.usage || '')}`).join('|')
    const currentWithUsage = current.map((figure) => `${String(figure.path || '')}:${String(figure.usage || '')}`).join('|')
    if (currentPaths === nextPaths || currentWithUsage === nextPaths) continue
    db.prepare('UPDATE question_bank_items SET figures_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(normalizedAssets), nowIso(), row.id)
  }
}

/**
 * Convert doc2x inline figure Media comments into DOC2X_FIGURE markers.
 * Used internally by backfillDoc2xInlineFigures.
 */
function doc2xInlineFigureMarkdown(content: string, figures: Array<Record<string, any>>) {
  let nextFigure = 0
  const mediaPair = /<!--\s*Media\s*-->(?:\s*<!--\s*Media\s*-->\s*)+/gi
  const withMarkers = String(content || '').replace(mediaPair, () => {
    const figure = figures[nextFigure++]
    const id = String(figure?.blockId || figure?.id || '')
    return id ? `\n\n<!-- DOC2X_FIGURE:${id} -->\n\n` : ''
  })
  return withMarkers.replace(/<!--\s*Media\s*-->/gi, '').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Backfill doc2x inline figure markers for older OCR runs whose expiring <img>
 * URLs were removed but paired Media comments remained.
 */
export function backfillDoc2xInlineFigures() {
  const rows = db.prepare(`
    SELECT id, stem_markdown, answer_text, analysis_markdown, figures_json
    FROM question_bank_items WHERE figures_json LIKE '%doc2x_v3%'
  `).all() as Array<{ id: string; stem_markdown: string; answer_text: string; analysis_markdown: string; figures_json: string }>
  for (const row of rows) {
    const figures = parseJson<Array<Record<string, any>>>(row.figures_json, [])
    const stemFigures = figures.filter((figure) => String(figure.usage || figure.category || '') === 'stem' || String(figure.category || '') === 'question')
    const analysisFigures = figures.filter((figure) => String(figure.usage || figure.category || '') === 'analysis')
    const stem = doc2xInlineFigureMarkdown(row.stem_markdown, stemFigures)
    const answer = doc2xInlineFigureMarkdown(row.answer_text, analysisFigures)
    const analysis = doc2xInlineFigureMarkdown(row.analysis_markdown, analysisFigures)
    if (stem === row.stem_markdown && answer === row.answer_text && analysis === row.analysis_markdown) continue
    db.prepare(`
      UPDATE question_bank_items
      SET stem_markdown = ?, answer_text = ?, analysis_markdown = ?, updated_at = ?
      WHERE id = ?
    `).run(stem, answer, analysis, nowIso(), row.id)
  }
}

/**
 * Get the file size of an export record's output file.
 * Checks the record path or URL, resolving through storage paths.
 */
function exportRecordFileSize(recordPath = '', recordUrl = '') {
  const urlPath = String(recordUrl || '').replace(/^\/assets\//, '')
  const rawPath = String(recordPath || urlPath || '').trim()
  if (!rawPath) return 0
  try {
    const stat = fs.statSync(resolveStoragePath(rawPath))
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

/**
 * Backfill content_length for export records that have zero file size.
 * Only processes succeeded PDF exports with a known path or URL.
 */
export function backfillExportRecordFileSizes() {
  const rows = db.prepare(`
    SELECT id, path, url
    FROM question_bank_export_records
    WHERE status = 'succeeded'
      AND LOWER(format) = 'pdf'
      AND content_length = 0
      AND (path != '' OR url != '')
  `).all() as Array<Pick<ExportRecordRow, 'id' | 'path' | 'url'>>
  if (!rows.length) return 0
  const update = db.prepare('UPDATE question_bank_export_records SET content_length = ? WHERE id = ?')
  let updated = 0
  for (const row of rows) {
    const size = exportRecordFileSize(row.path, row.url)
    if (size <= 0) continue
    update.run(size, row.id)
    updated += 1
  }
  return updated
}

/**
 * Build a list of export record item snapshots for a collection.
 * @param collectionId - the collection ID to query
 */
function collectionExportItems(collectionId: string): ExportRecordItemSnapshot[] {
  const rows = db.prepare(`
    SELECT question_id
    FROM question_bank_collection_items
    WHERE collection_id = ?
    ORDER BY sort_order ASC, created_at ASC
  `).all(collectionId) as Array<{ question_id: string }>
  return rows.map((row, index) => ({
    questionId: row.question_id,
    exportOrder: index + 1,
  })).filter((item) => item.questionId)
}

/**
 * Build a list of export record item snapshots for a run.
 * @param runId - the run ID to query
 */
function runExportItems(runId: string): ExportRecordItemSnapshot[] {
  return (db.prepare(`
    SELECT id
    FROM question_bank_items
    WHERE source_run_id = ?
    ORDER BY serial_no ASC, created_at ASC
  `).all(runId) as Array<{ id: string }>).map((row, index) => ({
    questionId: row.id,
    exportOrder: index + 1,
  }))
}

/**
 * Build a list of export record item snapshots for an import job.
 * @param importJobId - the import job ID to query
 */
function importJobExportItems(importJobId: string): ExportRecordItemSnapshot[] {
  const sourceIds = (db.prepare('SELECT source_document_id FROM import_job_documents WHERE job_id = ?')
    .all(importJobId) as Array<{ source_document_id: string }>).map((row) => row.source_document_id)
  const importSourceIds = [importJobId, `ifv2-job:${importJobId}`, ...sourceIds]
  return (db.prepare(`
    SELECT id
    FROM question_bank_items
    WHERE import_source_id IN (${importSourceIds.map(() => '?').join(', ')})
    ORDER BY serial_no ASC, created_at ASC
  `).all(...importSourceIds) as Array<{ id: string }>).map((row, index) => ({
    questionId: row.id,
    exportOrder: index + 1,
  }))
}

/**
 * Backfill items_json for export records that have empty items.
 * Reconstructs item snapshots from the source collection or run.
 */
export function backfillExportRecordItems() {
  const rows = db.prepare(`
    SELECT id, source_type, collection_id, run_id, import_job_id, items_json, question_count
    FROM question_bank_export_records
    WHERE items_json = ''
       OR items_json = '[]'
       OR items_json IS NULL
  `).all() as Array<Pick<ExportRecordRow, 'id' | 'source_type' | 'collection_id' | 'run_id' | 'import_job_id' | 'items_json' | 'question_count'>>
  if (!rows.length) return 0
  const update = db.prepare('UPDATE question_bank_export_records SET items_json = ? WHERE id = ?')
  let updated = 0
  for (const row of rows) {
    const items = row.source_type === 'collection' && row.collection_id
      ? collectionExportItems(row.collection_id)
      : row.source_type === 'run' && row.run_id
        ? runExportItems(row.run_id)
        : row.source_type === 'import_job' && row.import_job_id
          ? importJobExportItems(row.import_job_id)
          : []
    const expectedCount = Number(row.question_count || 0)
    if (!items.length || (expectedCount > 0 && items.length !== expectedCount)) continue
    update.run(JSON.stringify(items), row.id)
    updated += 1
  }
  return updated
}

/**
 * Clear items_json for export records whose item count does not match
 * the stored question_count. This allows re-backfill on next schema init.
 */
export function clearMismatchedExportRecordItems() {
  const rows = db.prepare(`
    SELECT id, question_count, items_json
    FROM question_bank_export_records
    WHERE question_count > 0
      AND items_json != ''
      AND items_json != '[]'
  `).all() as Array<Pick<ExportRecordRow, 'id' | 'question_count' | 'items_json'>>
  if (!rows.length) return 0
  const update = db.prepare("UPDATE question_bank_export_records SET items_json = '[]' WHERE id = ?")
  let cleared = 0
  for (const row of rows) {
    const items = parseJson<ExportRecordItemSnapshot[]>(row.items_json || '[]', [])
    if (items.length === Number(row.question_count || 0)) continue
    update.run(row.id)
    cleared += 1
  }
  return cleared
}

/**
 * Ensure a compatibility symlink exists at {pythonRoot}/question_assets
 * pointing to storageRoot. Python scripts can use this as a stable asset
 * root path.
 */
export function ensureQuestionAssetLink() {
  const linkPath = path.join(pythonRoot, 'question_assets')
  if (!fs.existsSync(linkPath)) {
    try {
      fs.symlinkSync(storageRoot, linkPath, 'dir')
    } catch {
      // Packaged apps and some Windows setups cannot create this compatibility link.
      // Python also receives QUESTION_ASSET_ROOT and can resolve question_assets paths directly.
    }
  }
}

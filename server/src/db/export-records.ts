import { db } from './connection.js'
import type { ExportRecordRow, ExportRecordItemSnapshot } from '../types/index.js'
import fs from 'node:fs'
import path from 'node:path'
import { parseJson } from '../utils/json.js'
import { nowIso } from '../utils/ids.js'
import { storageRoot } from '../config.js'
import { resolveStoragePath } from '../utils/paths.js'

function createId(prefix: string) {
  const raw = crypto.randomUUID().replace(/-/g, '').slice(0, 20)
  return `${prefix}_${raw}`
}

export function mapExportRecord(row: ExportRecordRow) {
  return {
    id: row.id,
    sourceType: row.source_type,
    collectionId: row.collection_id,
    runId: row.run_id,
    importJobId: row.import_job_id,
    title: row.title,
    format: row.format,
    variant: row.variant,
    filename: row.filename,
    path: row.path,
    url: row.url,
    items: parseJson<ExportRecordItemSnapshot[]>(row.items_json || '[]', []),
    contentLength: Number(row.content_length || 0),
    questionCount: Number(row.question_count || 0),
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
  }
}

export function exportRecordFileSize(recordPath = '', recordUrl = '') {
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

function collectionExportItems(collection: { questions: Array<{ item: { id?: string } }> } | undefined): ExportRecordItemSnapshot[] {
  if (!collection) return []
  return collection.questions.map((entry, index) => ({
    questionId: String(entry.item.id || ''),
    exportOrder: index + 1,
  })).filter((item) => item.questionId)
}

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

function getCollection(id: string) {
  const row = db.prepare('SELECT * FROM question_bank_collections WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return undefined
  const items = db.prepare(`
    SELECT qbi.* FROM question_bank_collection_items qbci
    JOIN question_bank_items qbi ON qbi.id = qbci.question_id
    WHERE qbci.collection_id = ?
    ORDER BY qbci.sort_order ASC, qbci.created_at ASC
  `).all(id) as Array<Record<string, unknown>>
  return { ...row, questions: items.map((item) => ({ item })) }
}

function getBasket() {
  return getCollection('_basket_')
}

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
      ? collectionExportItems(getCollection(row.collection_id) ?? getBasket())
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

export function restoreExportRecordToCollection(recordId: string, targetCollectionId: string, options: { syncTitle?: boolean } = {}) {
  const record = db.prepare('SELECT * FROM question_bank_export_records WHERE id = ?').get(recordId) as ExportRecordRow | undefined
  if (!record) throw new Error('导出记录不存在。')
  if (!collectionExists(targetCollectionId)) throw new Error('目标试题篮不存在。')
  const items = parseJson<ExportRecordItemSnapshot[]>(record.items_json || '[]', [])
    .map((item) => ({
      questionId: String(item.questionId || '').trim(),
      exportOrder: Math.max(1, Math.floor(Number(item.exportOrder || 0))),
    }))
    .filter((item) => item.questionId)
    .sort((left, right) => left.exportOrder - right.exportOrder)
  if (!items.length) throw new Error('该导出记录没有可回填的题目快照。')

  const seen = new Set<string>()
  const uniqueItems = items.filter((item) => {
    if (seen.has(item.questionId)) return false
    seen.add(item.questionId)
    return true
  })
  const questions = uniqueItems.map((item) => ({
    snapshot: item,
    row: db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(item.questionId) as Record<string, unknown> | undefined,
  }))
  const missing = questions.filter((item) => !item.row).map((item) => item.snapshot.questionId)
  if (missing.length) {
    throw new Error(`有 ${missing.length} 道题已不存在，无法回填。`)
  }

  const now = nowIso()
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM question_bank_collection_items WHERE collection_id = ?').run(targetCollectionId)
    const insert = db.prepare(`
      INSERT INTO question_bank_collection_items
        (id, collection_id, question_id, sort_order, score, section_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    questions.forEach((entry, index) => {
      const row = entry.row as Record<string, unknown>
      insert.run(
        createId('rel'),
        targetCollectionId,
        String(row.id ?? ''),
        entry.snapshot.exportOrder || index + 1,
        0,
        '',
        now
      )
    })
    const restoredTitle = String(record.title || '').trim()
    if (options.syncTitle && restoredTitle) {
      db.prepare('UPDATE question_bank_collections SET title = ?, updated_at = ? WHERE id = ?').run(restoredTitle, now, targetCollectionId)
    } else {
      db.prepare('UPDATE question_bank_collections SET updated_at = ? WHERE id = ?').run(now, targetCollectionId)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return {
    restoredCount: questions.length,
    collection: getCollection(targetCollectionId),
    exportRecord: mapExportRecord(record),
  }
}

function collectionExists(id: string) {
  const row = db.prepare('SELECT 1 FROM question_bank_collections WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return !!row
}

export function createExportRecord(input: {
  sourceType: ExportRecordRow['source_type']
  collectionId?: string
  runId?: string
  importJobId?: string
  title?: string
  format: string
  variant?: string
  filename?: string
  path?: string
  url?: string
  items?: ExportRecordItemSnapshot[]
  contentLength?: number
  questionCount?: number
  status?: 'succeeded' | 'failed'
  error?: string
}) {
  const id = createId('export')
  const now = nowIso()
  db.prepare(`
    INSERT INTO question_bank_export_records
      (id, source_type, collection_id, run_id, import_job_id, title, format, variant, filename, path, url, items_json, content_length, question_count, status, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.sourceType,
    input.collectionId || '',
    input.runId || '',
    input.importJobId || '',
    input.title || '',
    input.format,
    input.variant || '',
    input.filename || '',
    input.path || '',
    input.url || '',
    JSON.stringify(input.items || []),
    Math.max(0, Math.floor(Number(input.contentLength || 0))),
    Math.max(0, Math.floor(Number(input.questionCount || 0))),
    input.status || 'succeeded',
    input.error || '',
    now
  )
  return db.prepare('SELECT * FROM question_bank_export_records WHERE id = ?').get(id) as ExportRecordRow
}

export function listExportRecords(options: {
  sourceType?: ExportRecordRow['source_type'] | ''
  collectionId?: string
  runId?: string
  importJobId?: string
  query?: string
  limit?: number
} = {}) {
  const where: string[] = []
  const values: Array<string | number> = []
  if (options.sourceType) {
    where.push('source_type = ?')
    values.push(options.sourceType)
  }
  if (options.collectionId) {
    where.push('collection_id = ?')
    values.push(options.collectionId)
  }
  if (options.runId) {
    where.push('run_id = ?')
    values.push(options.runId)
  }
  if (options.importJobId) {
    where.push('import_job_id = ?')
    values.push(options.importJobId)
  }
  const query = String(options.query || '').trim()
  if (query) {
    where.push('(title LIKE ? OR filename LIKE ? OR format LIKE ?)')
    const pattern = `%${query}%`
    values.push(pattern, pattern, pattern)
  }
  const limit = Math.max(1, Math.min(Math.floor(Number(options.limit || 100)), 500))
  const sql = `
    SELECT *
    FROM question_bank_export_records
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC
    LIMIT ?
  `
  return (db.prepare(sql).all(...values, limit) as ExportRecordRow[]).map(mapExportRecord)
}

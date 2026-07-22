import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = path.resolve(import.meta.dirname, '../..')
const sqlitePath = path.join(root, 'data', 'question.sqlite')
const batchIds = Array.from(new Set(process.argv.slice(2).map((value) => value.trim()).filter(Boolean)))
if (!batchIds.length || batchIds.some((id) => !/^batch_[A-Za-z0-9_]+$/.test(id))) {
  console.error('Usage: node server/scripts/remove-legacy-import-batches.mjs batch_id [...]')
  process.exit(2)
}

const placeholders = (items) => items.map(() => '?').join(',')
const sqlString = (value) => `'${value.replaceAll("'", "''")}'`
const database = new DatabaseSync(sqlitePath)
database.exec('PRAGMA foreign_keys = ON')

const batches = database.prepare(`
  SELECT id, title FROM pdf_slicer_batches WHERE id IN (${placeholders(batchIds)}) ORDER BY id
`).all(...batchIds)
if (batches.length !== batchIds.length) {
  const found = new Set(batches.map((row) => row.id))
  throw new Error(`Legacy batches not found: ${batchIds.filter((id) => !found.has(id)).join(', ')}`)
}

const runs = database.prepare(`
  SELECT run_id, batch_id, run_dir FROM pdf_slicer_runs
  WHERE batch_id IN (${placeholders(batchIds)}) ORDER BY run_id
`).all(...batchIds)
if (!runs.length) throw new Error('No legacy runs found for requested batches')
const runIds = runs.map((row) => row.run_id)
const jobIds = batchIds.map((id) => `v1-job:${id}`)
const mappings = database.prepare(`
  SELECT batch_id, import_job_id FROM v1_import_batch_map
  WHERE batch_id IN (${placeholders(batchIds)})
`).all(...batchIds)
if (mappings.length !== batchIds.length || mappings.some((row) => row.import_job_id !== `v1-job:${row.batch_id}`)) {
  throw new Error('Requested batches are not exclusively mapped to their expected v1-job records')
}
const sourceRows = database.prepare(`
  SELECT source_document_id FROM v1_import_run_map WHERE run_id IN (${placeholders(runIds)})
`).all(...runIds)
const sourceDocumentIds = sourceRows.map((row) => row.source_document_id)

for (const [table, column] of [['ocr_documents', 'source_document_id'], ['question_candidates', 'source_document_id']]) {
  const count = sourceDocumentIds.length
    ? Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} IN (${placeholders(sourceDocumentIds)})`).get(...sourceDocumentIds).count)
    : 0
  if (count) throw new Error(`Refusing cleanup: ${table} still has ${count} live dependent record(s)`)
}

const runsRoot = path.join(root, 'experiments', 'pdf_slicer', 'runs')
const runDirectories = runs.map((run) => {
  const resolved = path.resolve(root, run.run_dir)
  if (resolved === runsRoot || !resolved.startsWith(`${runsRoot}${path.sep}`)) {
    throw new Error(`Unsafe run directory: ${run.run_dir}`)
  }
  return { runId: run.run_id, relative: path.relative(root, resolved), resolved }
})
const targetRoots = runDirectories.map((item) => item.resolved)
const isInsideRemovedRun = (value) => {
  if (typeof value !== 'string' || !value.trim()) return false
  const resolved = path.resolve(root, value)
  return targetRoots.some((target) => resolved === target || resolved.startsWith(`${target}${path.sep}`))
}

const questions = database.prepare(`
  SELECT id, stem_markdown, answer_text, analysis_markdown, figures_json
  FROM question_bank_items WHERE source_run_id IN (${placeholders(runIds)})
`).all(...runIds)
let strippedFigureSourcePaths = 0
const questionFigureUpdates = []
for (const question of questions) {
  const markdown = [question.stem_markdown, question.answer_text, question.analysis_markdown].join('\n')
  if (targetRoots.some((target) => markdown.includes(path.relative(root, target)))) {
    throw new Error(`Refusing cleanup: question ${question.id} markdown directly references a run directory`)
  }
  let figures
  try { figures = JSON.parse(question.figures_json || '[]') } catch { figures = [] }
  let changed = false
  for (const figure of Array.isArray(figures) ? figures : []) {
    if (isInsideRemovedRun(figure?.path)) {
      throw new Error(`Refusing cleanup: question ${question.id} primary figure is inside a run directory`)
    }
    if (isInsideRemovedRun(figure?.sourcePath)) {
      delete figure.sourcePath
      strippedFigureSourcePaths += 1
      changed = true
    }
  }
  if (changed) questionFigureUpdates.push({ id: question.id, figuresJson: JSON.stringify(figures) })
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupDirectory = path.join(root, 'data', 'database-backups', 'manual-cleanup')
fs.mkdirSync(backupDirectory, { recursive: true })
const backupPath = path.join(backupDirectory, `${timestamp}-before-remove-legacy-runs.sqlite`)
database.exec(`VACUUM INTO ${sqlString(backupPath)}`)
const backup = new DatabaseSync(backupPath, { readOnly: true })
try {
  const integrity = backup.prepare('PRAGMA integrity_check').get().integrity_check
  if (integrity !== 'ok') throw new Error(`Backup integrity check failed: ${integrity}`)
} finally {
  backup.close()
}

const stagingRoot = path.join(root, 'data', 'cleanup-staging', `${timestamp}-legacy-import-runs`)
const moved = []
try {
  for (const target of runDirectories) {
    if (!fs.existsSync(target.resolved)) continue
    const destination = path.join(stagingRoot, target.relative)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.renameSync(target.resolved, destination)
    moved.push({ source: target.resolved, destination })
  }

  database.exec('BEGIN IMMEDIATE')
  try {
    const updateFigures = database.prepare('UPDATE question_bank_items SET figures_json = ? WHERE id = ?')
    for (const update of questionFigureUpdates) updateFigures.run(update.figuresJson, update.id)
    database.prepare(`
      UPDATE question_bank_items SET source_run_id = '', import_job_id = NULL
      WHERE source_run_id IN (${placeholders(runIds)})
    `).run(...runIds)
    const exportRows = database.prepare(`
      SELECT id, run_id, snapshot_json FROM question_bank_export_records
      WHERE run_id IN (${placeholders(runIds)})
    `).all(...runIds)
    const detachExport = database.prepare(`
      UPDATE question_bank_export_records SET run_id = '', import_job_id = '', snapshot_json = ? WHERE id = ?
    `)
    for (const record of exportRows) {
      let snapshot
      try { snapshot = JSON.parse(record.snapshot_json || '{}') } catch { snapshot = {} }
      detachExport.run(JSON.stringify({ ...snapshot, removedLegacyRunId: record.run_id }), record.id)
    }
    database.prepare(`DELETE FROM pdf_slicer_annotation_regions WHERE source_run_id IN (${placeholders(runIds)})`).run(...runIds)
    database.prepare(`DELETE FROM pdf_slicer_annotation_sessions WHERE batch_id IN (${placeholders(batchIds)})`).run(...batchIds)
    database.prepare(`DELETE FROM pdf_slicer_solution_items WHERE source_run_id IN (${placeholders(runIds)})`).run(...runIds)
    database.prepare(`DELETE FROM import_provenance_archive WHERE import_job_id IN (${placeholders(jobIds)})`).run(...jobIds)
    if (sourceDocumentIds.length) {
      database.prepare(`DELETE FROM source_documents WHERE id IN (${placeholders(sourceDocumentIds)})`).run(...sourceDocumentIds)
    }
    database.prepare(`DELETE FROM import_jobs WHERE id IN (${placeholders(jobIds)})`).run(...jobIds)
    database.prepare(`DELETE FROM pdf_slicer_runs WHERE run_id IN (${placeholders(runIds)})`).run(...runIds)
    database.prepare(`DELETE FROM pdf_slicer_batches WHERE id IN (${placeholders(batchIds)})`).run(...batchIds)
    database.exec('COMMIT')

    const metadata = {
      createdAt: new Date().toISOString(),
      batchIds,
      runIds,
      jobIds,
      sourceDocumentIds,
      preservedQuestionCount: questions.length,
      detachedExportCount: exportRows.length,
      strippedFigureSourcePaths,
      removedRunDirectories: moved.map((item) => path.relative(root, item.source)),
      databaseSha256: crypto.createHash('sha256').update(fs.readFileSync(backupPath)).digest('hex'),
    }
    fs.writeFileSync(`${backupPath}.json`, JSON.stringify(metadata, null, 2), 'utf8')
    fs.rmSync(stagingRoot, { recursive: true, force: true })
    console.log(JSON.stringify({ success: true, backupPath: path.relative(root, backupPath), ...metadata }, null, 2))
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK')
    throw error
  }
} catch (error) {
  for (const item of moved.reverse()) {
    if (!fs.existsSync(item.destination) || fs.existsSync(item.source)) continue
    fs.mkdirSync(path.dirname(item.source), { recursive: true })
    fs.renameSync(item.destination, item.source)
  }
  throw error
} finally {
  database.close()
}

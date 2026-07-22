import fs from 'node:fs'
import path from 'node:path'
import { db } from '../../db/connection.js'
import { createId } from '../../utils/ids.js'
import { parseJson } from '../../utils/json.js'
import { resolveStoragePath } from '../../utils/paths.js'

type V1BatchRow = {
  id: string
  title: string
  workflow_mode: string
  created_at: string
}

type V1RunRow = {
  run_id: string
  batch_id: string
  paper_title: string
  pdf_name: string
  pdf_path: string
  source_file_name: string
  source_file_kind: string
  file_role: string
  stage: string
  ocr_status: string
  ocr_provider: string
  created_at: string
  updated_at: string
}

export type V1MigrationReport = {
  reportId: string
  mode: 'audit' | 'migrate'
  createdAt: string
  counts: Record<string, number>
  missingSourceFiles: Array<{ runId: string; path: string }>
  missingFigureFiles: Array<{ recordType: string; recordId: string; path: string }>
  exceptions: Array<{ kind: string; id: string; detail: string }>
  archivedAnnotationSessionIds: string[]
  annotationTableDeletionBlocked: boolean
  gatePassed: boolean
}

function v1ImportJobId(batchId: string) {
  return `v1-job:${batchId}`
}

function v1SourceDocumentId(runId: string) {
  return `v1-source:${runId}`
}

function sourceStatus(run: V1RunRow) {
  if (run.ocr_status === 'succeeded') return 'ocr_succeeded'
  if (run.ocr_status === 'failed') return 'ocr_failed'
  if (run.ocr_status === 'running' || run.ocr_status === 'queued') return 'ocr_failed'
  return 'uploaded'
}

function sourceProvider(value: string) {
  return value === 'doc2x' || value === 'glm' ? value : 'manual'
}

function sourceRole(value: string) {
  return value === 'questions' || value === 'solutions' ? value : 'full'
}

function existingPortablePath(value: string) {
  const resolved = path.isAbsolute(value) ? value : resolveStoragePath(value)
  return resolved && fs.existsSync(resolved) ? resolved : ''
}

function localFileReference(value: string) {
  const candidate = value.trim()
  if (!candidate || /^(?:https?:|data:|blob:)/i.test(candidate)) return ''
  if (/^<[^>]+>/s.test(candidate) || /<(?:table|tr|td|img|svg)\b/i.test(candidate)) return ''
  const withoutQuery = candidate.split(/[?#]/, 1)[0]
  return /\.(?:png|jpe?g|webp|gif|svg|bmp|tiff?|avif)$/i.test(withoutQuery) ? candidate : ''
}

function figurePaths(value: unknown, output: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) figurePaths(item, output)
    return output
  }
  if (!value || typeof value !== 'object') return output
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === 'string' && ['path', 'sourcePath', 'source_path', 'imagePath', 'image_path'].includes(key)) {
      const path = localFileReference(child)
      if (path) output.push(path)
    } else {
      figurePaths(child, output)
    }
  }
  return output
}

function inventory(mode: V1MigrationReport['mode'], reportId: string, createdAt: string): V1MigrationReport {
  const batches = db.prepare('SELECT id, title, workflow_mode, created_at FROM pdf_slicer_batches ORDER BY created_at, id').all() as V1BatchRow[]
  const runs = db.prepare(`
    SELECT run_id, batch_id, paper_title, pdf_name, pdf_path, source_file_name, source_file_kind,
      file_role, stage, ocr_status, ocr_provider, created_at, updated_at
    FROM pdf_slicer_runs ORDER BY created_at, run_id
  `).all() as V1RunRow[]
  const missingSourceFiles = runs
    .filter((run) => run.pdf_path && !existingPortablePath(run.pdf_path))
    .map((run) => ({ runId: run.run_id, path: run.pdf_path }))
  const missingFigureFiles: V1MigrationReport['missingFigureFiles'] = []
  const assetRecords = [
    ...(db.prepare(`SELECT id, figures_json FROM question_bank_items WHERE source_run_id != ''`).all() as Array<{ id: string; figures_json: string }>).map((row) => ({ type: 'question', ...row })),
    ...(db.prepare(`SELECT result_id AS id, figures_json FROM pdf_slicer_review_items`).all() as Array<{ id: string; figures_json: string }>).map((row) => ({ type: 'review', ...row })),
    ...(db.prepare(`SELECT id, figures_json FROM pdf_slicer_solution_items`).all() as Array<{ id: string; figures_json: string }>).map((row) => ({ type: 'solution', ...row })),
  ]
  for (const row of assetRecords) {
    for (const figurePath of new Set(figurePaths(parseJson(row.figures_json || '[]', [])))) {
      if (!existingPortablePath(figurePath)) missingFigureFiles.push({ recordType: row.type, recordId: row.id, path: figurePath })
    }
  }
  const directAssetRecords = [
    ...(db.prepare(`SELECT result_id AS id, page_image_path AS path FROM pdf_slicer_review_items WHERE page_image_path != ''`).all() as Array<{ id: string; path: string }>).map((row) => ({ type: 'review_page', ...row })),
    ...(db.prepare(`SELECT result_id AS id, auto_image_path AS path FROM pdf_slicer_review_items WHERE auto_image_path != ''`).all() as Array<{ id: string; path: string }>).map((row) => ({ type: 'review_auto', ...row })),
    ...(db.prepare(`SELECT id, source_image_path AS path FROM pdf_slicer_solution_items WHERE source_image_path != ''`).all() as Array<{ id: string; path: string }>).map((row) => ({ type: 'solution_source', ...row })),
  ]
  for (const row of directAssetRecords) {
    const filePath = localFileReference(row.path)
    if (filePath && !existingPortablePath(filePath)) missingFigureFiles.push({ recordType: row.type, recordId: row.id, path: filePath })
  }
  const exceptions = db.prepare(`
    SELECT 'unmapped_question' AS kind, q.id, q.source_run_id AS detail
    FROM question_bank_items q
    WHERE q.source_run_id != '' AND TRIM(COALESCE(q.import_job_id, '')) = ''
    UNION ALL
    SELECT 'unmapped_export', record.id, record.run_id
    FROM question_bank_export_records record
    WHERE record.source_type = 'run' AND record.run_id != '' AND TRIM(COALESCE(record.import_job_id, '')) = ''
    UNION ALL
    SELECT 'unmapped_review_item', review.result_id, review.run_id
    FROM pdf_slicer_review_items review
    LEFT JOIN v1_import_run_map mapping ON mapping.run_id = review.run_id
    WHERE mapping.run_id IS NULL
    UNION ALL
    SELECT 'unmapped_solution_item', solution.id, solution.source_run_id
    FROM pdf_slicer_solution_items solution
    LEFT JOIN v1_import_run_map mapping ON mapping.run_id = solution.source_run_id
    WHERE mapping.run_id IS NULL
    UNION ALL
    SELECT 'unmapped_annotation_session', session.id, session.batch_id
    FROM pdf_slicer_annotation_sessions session
    JOIN pdf_slicer_batches batch ON batch.id = session.batch_id
    LEFT JOIN v1_import_batch_map mapping ON mapping.batch_id = session.batch_id
    WHERE mapping.batch_id IS NULL
    UNION ALL
    SELECT 'unmapped_annotation_region', region.id, region.source_run_id
    FROM pdf_slicer_annotation_regions region
    JOIN pdf_slicer_runs run ON run.run_id = region.source_run_id
    LEFT JOIN v1_import_run_map mapping ON mapping.run_id = region.source_run_id
    WHERE mapping.run_id IS NULL
    ORDER BY kind, id
  `).all() as V1MigrationReport['exceptions']
  const archivedAnnotationSessionIds = (db.prepare(`
    SELECT id FROM pdf_slicer_annotation_sessions ORDER BY created_at, id
  `).all() as Array<{ id: string }>).map((row) => row.id)
  const count = (sql: string) => Number((db.prepare(sql).get() as { count: number }).count || 0)
  const counts = {
    v1Batches: batches.length,
    v1Runs: runs.length,
    v1ReviewItems: count('SELECT COUNT(*) AS count FROM pdf_slicer_review_items'),
    v1SolutionItems: count('SELECT COUNT(*) AS count FROM pdf_slicer_solution_items'),
    v1AnnotationSessions: archivedAnnotationSessionIds.length,
    v1AnnotationRegions: count('SELECT COUNT(*) AS count FROM pdf_slicer_annotation_regions'),
    v1Questions: count("SELECT COUNT(*) AS count FROM question_bank_items WHERE source_run_id != ''"),
    v1ExportRecords: count("SELECT COUNT(*) AS count FROM question_bank_export_records WHERE source_type = 'run' AND run_id != ''"),
    mappedBatches: count('SELECT COUNT(*) AS count FROM v1_import_batch_map'),
    mappedRuns: count('SELECT COUNT(*) AS count FROM v1_import_run_map'),
    questionsWithImportJob: count("SELECT COUNT(*) AS count FROM question_bank_items WHERE source_run_id != '' AND TRIM(COALESCE(import_job_id, '')) != ''"),
    exportsWithImportJob: count("SELECT COUNT(*) AS count FROM question_bank_export_records WHERE source_type = 'run' AND run_id != '' AND TRIM(COALESCE(import_job_id, '')) != ''"),
    candidateFixSessions: count('SELECT COUNT(*) AS count FROM candidate_fix_sessions'),
  }
  const gatePassed = counts.mappedBatches === counts.v1Batches
    && counts.mappedRuns === counts.v1Runs
    && counts.questionsWithImportJob === counts.v1Questions
    && counts.exportsWithImportJob === counts.v1ExportRecords
    && exceptions.length === 0
    && missingSourceFiles.length === 0
    && missingFigureFiles.length === 0
  const annotationTableDeletionBlocked = archivedAnnotationSessionIds.length > 0
  return { reportId, mode, createdAt, counts, missingSourceFiles, missingFigureFiles, exceptions, archivedAnnotationSessionIds, annotationTableDeletionBlocked, gatePassed }
}

export function auditV1ImportData() {
  const createdAt = new Date().toISOString()
  return inventory('audit', createId('v1audit'), createdAt)
}

function archiveJobId(kind: 'v2doc' | 'v1run', legacyId: string) {
  return `archive-${kind}:${legacyId}`
}

function ensureArchiveJob(id: string, title: string, createdAt: string) {
  db.prepare(`
    INSERT OR IGNORE INTO import_jobs (id, title, mode, status, created_at, updated_at)
    VALUES (?, ?, 'single_document', 'parsed', ?, ?)
  `).run(id, title, createdAt, createdAt)
}

function archiveV2QuestionProvenance(createdAt: string) {
  const sources = db.prepare(`
    SELECT DISTINCT SUBSTR(source_run_id, 6) AS source_document_id
    FROM question_bank_items
    WHERE source_run_id LIKE 'ifv2:%' AND TRIM(COALESCE(import_job_id, '')) = ''
  `).all() as Array<{ source_document_id: string }>
  for (const row of sources) {
    const source = db.prepare('SELECT id, title, created_at FROM source_documents WHERE id = ?').get(row.source_document_id) as {
      id: string
      title: string
      created_at: string
    } | undefined
    const owner = source ? db.prepare(`
      SELECT job_id FROM import_job_documents WHERE source_document_id = ? ORDER BY created_at, id LIMIT 1
    `).get(source.id) as { job_id: string } | undefined : undefined
    const jobId = owner?.job_id || archiveJobId('v2doc', row.source_document_id)
    if (!owner) {
      ensureArchiveJob(jobId, source?.title || `Archived V2 document ${row.source_document_id}`, source?.created_at || createdAt)
      if (source) db.prepare(`
        INSERT INTO import_job_documents (id, job_id, source_document_id, role, sort_order, created_at, updated_at)
        SELECT ?, ?, ?, 'full', 0, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM import_job_documents WHERE source_document_id = ?)
      `).run(`archive-v2-link:${source.id}`, jobId, source.id, source.created_at, createdAt, source.id)
    }
    const kind = source ? 'v2_source_document' : 'missing_v2_source_document'
    db.prepare(`
      INSERT OR IGNORE INTO import_provenance_archive
        (provenance_kind, legacy_id, import_job_id, source_document_id, resolution, detail_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      kind,
      row.source_document_id,
      jobId,
      source?.id || null,
      source ? (owner ? 'existing_import_job_owner' : 'archive_job_linked_to_existing_source') : 'archive_job_without_source_file',
      JSON.stringify({ sourceRunId: `ifv2:${row.source_document_id}`, sourceDocumentExisted: Boolean(source), sourceFileInvented: false }),
      createdAt,
    )
    db.prepare(`
      UPDATE question_bank_items SET import_job_id = ?
      WHERE source_run_id = ? AND TRIM(COALESCE(import_job_id, '')) = ''
    `).run(jobId, `ifv2:${row.source_document_id}`)
  }
}

function archiveOrphanExportProvenance(createdAt: string) {
  const runs = db.prepare(`
    SELECT record.run_id, MIN(NULLIF(record.title, '')) AS title, MIN(record.created_at) AS first_created_at
    FROM question_bank_export_records record
    LEFT JOIN pdf_slicer_runs run ON run.run_id = record.run_id
    WHERE record.source_type = 'run' AND record.run_id != ''
      AND TRIM(COALESCE(record.import_job_id, '')) = '' AND run.run_id IS NULL
    GROUP BY record.run_id
  `).all() as Array<{ run_id: string; title: string | null; first_created_at: string }>
  for (const run of runs) {
    const jobId = archiveJobId('v1run', run.run_id)
    ensureArchiveJob(jobId, run.title || `Archived legacy run ${run.run_id}`, run.first_created_at || createdAt)
    db.prepare(`
      INSERT OR IGNORE INTO import_provenance_archive
        (provenance_kind, legacy_id, import_job_id, source_document_id, resolution, detail_json, created_at)
      VALUES ('orphan_v1_run', ?, ?, NULL, 'archive_job_without_source_file', ?, ?)
    `).run(run.run_id, jobId, JSON.stringify({ legacyRunExists: false, sourceFileInvented: false }), createdAt)
    db.prepare(`
      UPDATE question_bank_export_records SET import_job_id = ?
      WHERE source_type = 'run' AND run_id = ? AND TRIM(COALESCE(import_job_id, '')) = ''
    `).run(jobId, run.run_id)
  }
}

export function migrateV1ImportData() {
  const createdAt = new Date().toISOString()
  const reportId = createId('v1migration')
  const batches = db.prepare('SELECT id, title, workflow_mode, created_at FROM pdf_slicer_batches ORDER BY created_at, id').all() as V1BatchRow[]
  const runs = db.prepare(`
    SELECT run_id, batch_id, paper_title, pdf_name, pdf_path, source_file_name, source_file_kind,
      file_role, stage, ocr_status, ocr_provider, created_at, updated_at
    FROM pdf_slicer_runs ORDER BY created_at, run_id
  `).all() as V1RunRow[]

  db.exec('BEGIN IMMEDIATE')
  try {
    for (const batch of batches) {
      const jobId = v1ImportJobId(batch.id)
      db.prepare(`
        INSERT OR IGNORE INTO import_jobs (id, title, mode, status, created_at, updated_at)
        VALUES (?, ?, ?, 'draft', ?, ?)
      `).run(jobId, batch.title || batch.id, batch.workflow_mode === 'separated_exam' ? 'separated_documents' : 'single_document', batch.created_at, createdAt)
      db.prepare(`
        INSERT OR IGNORE INTO v1_import_batch_map (batch_id, import_job_id, migrated_at)
        VALUES (?, ?, ?)
      `).run(batch.id, jobId, createdAt)
    }
    for (const run of runs) {
      const jobId = v1ImportJobId(run.batch_id)
      const sourceDocumentId = v1SourceDocumentId(run.run_id)
      db.prepare(`
        INSERT OR IGNORE INTO source_documents (
          id, title, original_file_name, file_path, file_type, provider, status, stage,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sourceDocumentId,
        run.paper_title || run.pdf_name || run.run_id,
        run.source_file_name || run.pdf_name,
        run.pdf_path,
        run.source_file_kind === 'image' ? 'image' : 'pdf',
        sourceProvider(run.ocr_provider),
        sourceStatus(run),
        run.stage || '高三',
        JSON.stringify({ migratedFrom: 'pdf_slicer_run', legacyRunId: run.run_id, legacyBatchId: run.batch_id }),
        run.created_at,
        run.updated_at || createdAt,
      )
      db.prepare(`
        INSERT INTO import_job_documents
          (id, job_id, source_document_id, role, sort_order, created_at, updated_at)
        SELECT ?, ?, ?, ?, 0, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM import_job_documents WHERE source_document_id = ?
        )
      `).run(`v1-link:${run.run_id}`, jobId, sourceDocumentId, sourceRole(run.file_role), run.created_at, createdAt, sourceDocumentId)
      db.prepare(`
        INSERT OR IGNORE INTO v1_import_run_map (run_id, source_document_id, import_job_id, migrated_at)
        VALUES (?, ?, ?, ?)
      `).run(run.run_id, sourceDocumentId, jobId, createdAt)
    }
    archiveV2QuestionProvenance(createdAt)
    archiveOrphanExportProvenance(createdAt)
    db.prepare(`
      UPDATE question_bank_items
      SET import_job_id = (SELECT import_job_id FROM v1_import_run_map WHERE run_id = question_bank_items.source_run_id)
      WHERE source_run_id != ''
        AND EXISTS (SELECT 1 FROM v1_import_run_map WHERE run_id = question_bank_items.source_run_id)
    `).run()
    db.prepare(`
      UPDATE question_bank_export_records
      SET import_job_id = (SELECT import_job_id FROM v1_import_run_map WHERE run_id = question_bank_export_records.run_id)
      WHERE source_type = 'run' AND run_id != ''
        AND EXISTS (SELECT 1 FROM v1_import_run_map WHERE run_id = question_bank_export_records.run_id)
    `).run()
    db.prepare(`
      UPDATE import_jobs
      SET status = CASE
        WHEN EXISTS (
          SELECT 1 FROM v1_import_run_map mapping
          JOIN question_bank_items question ON question.source_run_id = mapping.run_id
          WHERE mapping.import_job_id = import_jobs.id
        ) THEN 'parsed'
        ELSE status
      END,
      updated_at = ?
      WHERE id IN (SELECT import_job_id FROM v1_import_batch_map)
    `).run(createdAt)
    db.exec('COMMIT')
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  }

  const report = inventory('migrate', reportId, createdAt)
  db.prepare(`
    INSERT INTO v1_import_migration_runs (id, mode, report_json, gate_passed, created_at)
    VALUES (?, 'migrate', ?, ?, ?)
  `).run(reportId, JSON.stringify(report), report.gatePassed ? 1 : 0, createdAt)
  return report
}

export function v1MigrationReportMarkdown(report: V1MigrationReport) {
  const counts = Object.entries(report.counts).map(([key, value]) => `| ${key} | ${value} |`).join('\n')
  const exceptions = report.exceptions.length
    ? report.exceptions.map((item) => `- ${item.kind}: ${item.id} (${item.detail})`).join('\n')
    : '- None'
  return `# V1 Import Migration Report\n\n- Report: ${report.reportId}\n- Mode: ${report.mode}\n- Created: ${report.createdAt}\n- WS-04 gate: ${report.gatePassed ? 'PASS' : 'BLOCKED'}\n\n## Counts\n\n| Metric | Count |\n| --- | ---: |\n${counts}\n\n## Exceptions\n\n${exceptions}\n\n## Missing Files\n\n- Source files: ${report.missingSourceFiles.length}\n- Figure files: ${report.missingFigureFiles.length}\n- Archived annotation sessions: ${report.archivedAnnotationSessionIds.length}\n- Annotation table deletion blocked: ${report.annotationTableDeletionBlocked ? 'YES — provenance remains in retained V1 tables' : 'NO'}\n`
}

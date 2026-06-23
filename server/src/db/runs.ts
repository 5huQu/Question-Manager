import { db } from './connection.js'
import type { RunRow, BatchRow, MaterialType, WorkflowMode, WorkflowStatus, FileRole } from '../types/index.js'
import { dataDir, pythonDataRoot } from '../config.js'
import { resolveStoragePath } from '../utils/paths.js'
import { nowIso } from '../utils/ids.js'
import { parseJson } from '../utils/json.js'
import { buildDocumentDiagnosticMessage } from '../utils/document-conversion.js'
import {
  cleanSourceTitle,
  normalizeMaterialType,
  normalizeFileRole,
  normalizeWorkflowMode,
  normalizeWorkflowStatus,
  normalizeUploadName,
} from '../utils/ocr-helpers.js'
import { normalizeOcrProvider } from '../services/settings/ocr-settings.js'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { activeOcrProcesses } from '../types/index.js'

function doc2xArtifactDir(row: RunRow) {
  return path.join(resolveStoragePath(row.run_dir), 'doc2x')
}

function glmArtifactDir(row: RunRow) {
  return path.join(resolveStoragePath(row.run_dir), 'glm')
}

function readDoc2xState(row: RunRow) {
  return parseJson<Record<string, any>>(
    fs.existsSync(path.join(doc2xArtifactDir(row), 'state.json'))
      ? fs.readFileSync(path.join(doc2xArtifactDir(row), 'state.json'), 'utf8')
      : '{}',
    {},
  )
}

function syncDoc2xState(row: RunRow) {
  const provider = normalizeOcrProvider(row.ocr_provider)
  if (provider !== 'doc2x' && provider !== 'glm') return row
  const statePath = provider === 'glm' ? path.join(glmArtifactDir(row), 'state.json') : path.join(doc2xArtifactDir(row), 'state.json')
  const state = parseJson<Record<string, any>>(fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : '{}', {})
  if (!Object.keys(state).length) return row
  const progress = Math.max(0, Math.min(100, Number(state.progress || 0)))
  const uid = String(state.uid || row.ocr_external_uid || '')
  const phase = String(state.phase || row.ocr_provider_phase || '')
  const resultPath = String(state.result_path || row.ocr_provider_result_path || '')
  if (uid !== row.ocr_external_uid || phase !== row.ocr_provider_phase || progress !== row.ocr_provider_progress || resultPath !== row.ocr_provider_result_path) {
    db.prepare(`
      UPDATE pdf_slicer_runs
      SET ocr_external_uid = ?, ocr_provider_phase = ?, ocr_provider_progress = ?, ocr_provider_result_path = ?, updated_at = ?
      WHERE run_id = ?
    `).run(uid, phase, progress, resultPath, nowIso(), row.run_id)
  }
  return { ...row, ocr_external_uid: uid, ocr_provider_phase: phase, ocr_provider_progress: progress, ocr_provider_result_path: resultPath }
}

function ocrJobLogPath(runId: string) {
  return path.join(pythonDataRoot, 'ocr_jobs', `${runId}.log`)
}

function removePathInChild(targetPath: string, options: { recursive?: boolean } = {}) {
  if (!targetPath || !fs.existsSync(targetPath)) return
  const recursive = Boolean(options.recursive)
  let cleanupPath = targetPath
  if (recursive) {
    const parent = path.dirname(targetPath)
    const basename = path.basename(targetPath)
    const trashPath = path.join(parent, `${basename}.deleted-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`)
    try {
      fs.renameSync(targetPath, trashPath)
      cleanupPath = trashPath
    } catch {
      cleanupPath = targetPath
    }
  }
  const script = [
    'const fs = require("node:fs");',
    'const target = process.argv[1];',
    `fs.rmSync(target, { recursive: ${recursive ? 'true' : 'false'}, force: true });`,
  ].join('\n')
  const child = spawn(process.execPath, ['-e', script, cleanupPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
}

export function mapBatch(row: BatchRow) {
  return {
    id: row.id,
    title: cleanSourceTitle(row.title || row.id, row.id),
    materialType: normalizeMaterialType(row.material_type),
    workflowMode: normalizeWorkflowMode(row.workflow_mode),
    workflowStatus: normalizeWorkflowStatus(row.workflow_status),
    createdAt: row.created_at,
    uploadedCount: row.uploaded_count,
  }
}

export function batchRuns(batchId: string) {
  return (db.prepare('SELECT * FROM pdf_slicer_runs WHERE batch_id = ? ORDER BY created_at ASC').all(batchId) as RunRow[]).map(mapRun)
}

export function mapRun(row: RunRow) {
  row = syncDoc2xState(row)
  const importedQuestions = (db.prepare('SELECT COUNT(*) AS count FROM question_bank_items WHERE source_run_id = ?').get(row.run_id) as { count: number }).count
  const bankedQuestions = (db.prepare("SELECT COUNT(*) AS count FROM question_bank_items WHERE source_run_id = ? AND bank_status = 'banked'").get(row.run_id) as { count: number }).count
  const solutionItems = (db.prepare('SELECT COUNT(*) AS count FROM pdf_slicer_solution_items WHERE source_run_id = ?').get(row.run_id) as { count: number }).count
  const expectedQuestions = row.approved_questions || row.total_questions || 0
  const completedByImport = expectedQuestions > 0 && importedQuestions >= expectedQuestions
  const ocrStatus = row.ocr_status === 'succeeded' || completedByImport ? 'succeeded' : row.ocr_status
  const provider = normalizeOcrProvider(row.ocr_provider)
  const providerProgress = Math.max(0, Math.min(100, Number(row.ocr_provider_progress || 0))) / 100
  const progressPercent = ocrStatus === 'succeeded' ? 1 : (provider === 'doc2x' || provider === 'glm') && providerProgress > 0 ? providerProgress : ocrStatus === 'running' ? 0.5 : ocrStatus === 'failed' ? 0.2 : 0
  const documentDiagnostics = parseJson<Record<string, any>>(row.document_diagnostics_json || '{}', {})
  return {
    runId: row.run_id,
    batchId: row.batch_id,
    uploadMode: row.upload_mode,
    paperTitle: cleanSourceTitle(row.paper_title || row.pdf_name),
    pdfName: normalizeUploadName(row.pdf_name),
    pdfPath: row.pdf_path,
    sourceFileName: normalizeUploadName(row.source_file_name),
    sourceFileKind: row.source_file_kind,
    materialType: normalizeMaterialType(row.material_type),
    fileRole: normalizeFileRole(row.file_role),
    stage: row.stage || '高三',
    classificationConfidence: Number(row.classification_confidence || 0),
    classificationReasons: parseJson<string[]>(row.classification_reasons_json || '[]', []),
    runDir: row.run_dir,
    documentDiagnostics,
    diagnosticMessage: buildDocumentDiagnosticMessage(documentDiagnostics),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sliceStatus: row.slice_status,
    sliceError: row.slice_error,
    quickReviewStatus: row.quick_review_status,
    totalQuestions: row.total_questions,
    approvedQuestions: row.approved_questions,
    unreviewedQuestions: row.unreviewed_questions,
    ocrStatus,
    ocrError: row.ocr_error,
    ocrStartedAt: row.ocr_started_at,
    ocrFinishedAt: row.ocr_finished_at,
    ocrProvider: provider,
    ocrExternalUid: row.ocr_external_uid || '',
    ocrProviderPhase: row.ocr_provider_phase || '',
    ocrProviderProgress: Number(row.ocr_provider_progress || 0),
    ocrProviderResultPath: row.ocr_provider_result_path || '',
    rulesVersion: row.rules_version || 0,
    rulesHash: row.rules_hash || '',
    rulesFallbackUsed: Boolean(row.rules_fallback_used),
    rulesWarnings: parseJson<string[]>(row.rules_warnings_json || '[]', []),
    progressPercent: ocrStatus === 'failed' && importedQuestions > 0 && row.approved_questions > 0 ? importedQuestions / row.approved_questions : progressPercent,
    totalOcrQuestions: row.approved_questions,
    processedQuestions: Math.max(importedQuestions, solutionItems) || (ocrStatus === 'succeeded' ? row.approved_questions : ocrStatus === 'running' ? Math.floor(row.approved_questions / 2) : 0),
    importedQuestions,
    bankedQuestions,
    solutionItems,
  }
}

export function getRun(runId: string) {
  const row = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as RunRow | undefined
  return row ? mapRun(row) : null
}

export function updateBatchWorkflow(batchId: string) {
  const runs = db.prepare('SELECT * FROM pdf_slicer_runs WHERE batch_id = ?').all(batchId) as RunRow[]
  if (!runs.length) return
  const materialTypes = new Set(runs.map((run) => normalizeMaterialType(run.material_type)).filter((item) => item !== 'unknown'))
  const roles = new Set(runs.map((run) => normalizeFileRole(run.file_role)))
  const materialType: MaterialType = materialTypes.has('lecture') && !materialTypes.has('exam') ? 'lecture' : materialTypes.has('exam') ? 'exam' : 'unknown'
  const sameRunSolutionRows = db.prepare(`
    SELECT DISTINCT source_run_id AS run_id
    FROM pdf_slicer_solution_items
    WHERE batch_id = ?
      AND source_run_id IN (
        SELECT run_id FROM pdf_slicer_runs
        WHERE batch_id = ? AND file_role != 'solutions'
      )
  `).all(batchId, batchId) as Array<{ run_id: string }>
  const sameRunSolutionRunIds = new Set(sameRunSolutionRows.map((row) => row.run_id))
  const workflowMode: WorkflowMode = (roles.has('questions') && roles.has('solutions')) || sameRunSolutionRunIds.size > 0 ? 'separated_exam' : 'single'
  let workflowStatus: WorkflowStatus = runs.some((run) => normalizeMaterialType(run.material_type) === 'unknown' || normalizeFileRole(run.file_role) === 'unknown') ? 'needs_classification' : 'ready'
  if (workflowMode === 'separated_exam') {
    const relevantRuns = runs.filter((run) => ['questions', 'solutions'].includes(normalizeFileRole(run.file_role)) || sameRunSolutionRunIds.has(run.run_id))
    const active = relevantRuns.some((run) => run.ocr_status === 'running' || run.ocr_status === 'queued' || run.slice_status === 'running')
    const completed = relevantRuns.length > 0 && relevantRuns.every((run) => run.ocr_status === 'succeeded')
    const unresolved = (db.prepare(`
      SELECT COUNT(*) AS count FROM question_bank_items
      WHERE source_run_id IN (
        SELECT run_id FROM pdf_slicer_runs
        WHERE batch_id = ?
          AND (
            file_role = 'questions'
            OR run_id IN (
              SELECT source_run_id FROM pdf_slicer_solution_items WHERE batch_id = ?
            )
          )
      )
        AND COALESCE(merge_status, '') NOT IN ('merged')
    `).get(batchId, batchId) as { count: number }).count
    if (active) workflowStatus = 'processing'
    else if (completed && unresolved > 0) workflowStatus = 'needs_review'
    else if (completed) workflowStatus = 'ready_for_bank'
  }
  const titleRow = db.prepare('SELECT COALESCE(NULLIF(paper_title, \'\'), NULLIF(pdf_name, \'\'), ?) AS title FROM pdf_slicer_runs WHERE batch_id = ? ORDER BY created_at ASC LIMIT 1').get(batchId, batchId) as { title: string } | undefined
  db.prepare('UPDATE pdf_slicer_batches SET title = COALESCE(NULLIF(title, \'\'), ?), material_type = ?, workflow_mode = ?, workflow_status = ? WHERE id = ?')
    .run(cleanSourceTitle(titleRow?.title || batchId, batchId), materialType, workflowMode, workflowStatus, batchId)
}

export function findReusableSeparatedExamBatch(title: string, materialType: MaterialType, fileRole: FileRole) {
  if (!title || materialType !== 'exam' || !['questions', 'solutions'].includes(fileRole)) return ''
  const row = db.prepare(`
    SELECT id
    FROM pdf_slicer_batches
    WHERE title = ?
      AND material_type IN ('exam', 'unknown')
      AND workflow_status IN ('ready', 'needs_classification', 'processing', 'needs_review')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(title) as { id: string } | undefined
  return row?.id || ''
}

export function recoverInterruptedRuns() {
  const now = nowIso()
  db.prepare(`
    UPDATE pdf_slicer_runs
    SET slice_status = 'failed',
        slice_error = CASE WHEN TRIM(slice_error) = '' THEN '服务重启后已中断，请重新执行切题。' ELSE slice_error END,
        updated_at = ?
    WHERE slice_status = 'running'
  `).run(now)
  db.prepare(`
    UPDATE pdf_slicer_runs
    SET ocr_status = 'failed',
        ocr_error = CASE WHEN TRIM(ocr_error) = '' THEN '服务重启后已中断，请重新执行 OCR。' ELSE ocr_error END,
        ocr_finished_at = CASE WHEN TRIM(ocr_finished_at) = '' THEN ? ELSE ocr_finished_at END,
        updated_at = ?
    WHERE ocr_status = 'running'
  `).run(now, now)
  db.prepare(`
    DELETE FROM pdf_slicer_batches
    WHERE id NOT IN (SELECT DISTINCT batch_id FROM pdf_slicer_runs)
  `).run()
}

export function removeRunArtifacts(runId: string) {
  const row = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as RunRow | undefined
  const questionIds = (db.prepare('SELECT id FROM question_bank_items WHERE source_run_id = ?').all(runId) as Array<{ id: string }>).map((item) => item.id)
  const child = activeOcrProcesses.get(runId)
  if (child) {
    child.kill('SIGTERM')
    activeOcrProcesses.delete(runId)
  }
  if (row?.run_dir) removePathInChild(resolveStoragePath(row.run_dir), { recursive: true })
  for (const id of questionIds) {
    removePathInChild(path.join(dataDir, 'question_figures', id), { recursive: true })
  }
  const draftsDir = path.join(pythonDataRoot, 'ocr_drafts')
  if (fs.existsSync(draftsDir)) {
    for (const entry of fs.readdirSync(draftsDir)) {
      if (entry.startsWith(runId)) removePathInChild(path.join(draftsDir, entry), { recursive: true })
    }
  }
  removePathInChild(ocrJobLogPath(runId))
  db.prepare('DELETE FROM pdf_slicer_solution_items WHERE source_run_id = ?').run(runId)
}

export function removeRunOcrOutputs(runId: string) {
  const row = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as RunRow | undefined
  const questionIds = (db.prepare('SELECT id FROM question_bank_items WHERE source_run_id = ?').all(runId) as Array<{ id: string }>).map((item) => item.id)
  db.prepare('DELETE FROM question_bank_items WHERE source_run_id = ?').run(runId)
  for (const id of questionIds) {
    removePathInChild(path.join(dataDir, 'question_figures', id), { recursive: true })
  }
  const draftsDir = path.join(pythonDataRoot, 'ocr_drafts')
  if (fs.existsSync(draftsDir)) {
    for (const entry of fs.readdirSync(draftsDir)) {
      if (entry.startsWith(runId)) removePathInChild(path.join(draftsDir, entry), { recursive: true })
    }
  }
  removePathInChild(ocrJobLogPath(runId))
  if (row) removePathInChild(doc2xArtifactDir(row), { recursive: true })
  db.prepare(`
    UPDATE pdf_slicer_runs
    SET ocr_external_uid = '', ocr_provider_phase = '', ocr_provider_progress = 0, ocr_provider_result_path = ''
    WHERE run_id = ?
  `).run(runId)
  // Same-document solution rows also hold the reviewer-confirmed solution
  // figures. OCR reruns replace their text, but must not discard that review
  // work before the next manifest is built.
}

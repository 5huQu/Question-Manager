import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { db } from '../../db/connection.js'
import { runsRoot, sourceRoot, pythonRoot, pythonDataRoot, storageRoot } from '../../config.js'
import { nowIso, createId } from '../../utils/ids.js'
import { parseJson } from '../../utils/json.js'
import { pythonCommand, pythonEnv } from '../settings/python.js'
import { stripOcrTemplateNoise } from '../../utils/rich-content.js'
import { buildSearchText, difficultyLabel10, normalizeDifficultyScore10, parseTimestampMs } from '../../utils/search.js'
import {
  cleanQuestionNoLabel,
  cleanSourceTitle,
  normalizeFileRole,
} from '../../utils/ocr-helpers.js'
import { createQuestion, getQuestion } from '../../db/questions.js'
import { getRun, updateBatchWorkflow } from '../../db/runs.js'
import { getReviewItems } from '../../db/review.js'
import { ocrRunnerEnv, readOcrSettings } from '../settings/ocr-settings.js'
import { classifyRunAfterImport } from './classification.js'
import { tryAutoMergeSeparatedExamForRun } from './merging.js'
import { formatIssueFromReviewJson } from './review.js'
import {
  cropFigureImage,
  loadCutResultRecord,
  loadSolutionCutResultRecord,
  normalizedFigureId,
  reviewSegmentReadingKey,
  reviewFigureReadingKey,
  answerOrAnalysisBoundary,
  reviewFigureDefaultUsage,
  expandedReviewBBox,
  reviewFigurePixelBBox,
  figurePixelBBoxForSegments,
  imageDimensions,
  figuresForImportedOcrResult,
  figuresForImportedOcrResultAsync,
  bindInlineImageReferences,
  sliceImagePathForOcrResult,
  bindExplicitAttachments,
} from '../../utils/figure-helpers.js'
import { resolveStoragePath, stripAssetPrefix, assetPathFor } from '../../utils/paths.js'
import { configuredGradeStages } from '../settings/app-settings.js'
import { activeOcrProcesses } from '../../types/index.js'
import { formatReviewPayload, validateQuestionMarkdown } from '../../utils/validation.js'
import type { RunRow, OcrProvider } from '../../types/index.js'
import {
  inferQuestionType,
  stripLeadingQuestionNo,
} from '../../utils/question-type.js'
import { normalizeTags } from '../tags/tag-libraries.js'

// ── Local helpers ────────────────────────────────────────────────────────────

const REVIEW_FIGURE_CROP_VERSION = 'review-slice-layout-v2'

function withQuestionAssetPrefix(value: string) {
  const clean = stripAssetPrefix(String(value || ''))
  return clean ? `question_assets/${clean}` : ''
}

function normalizeOcrSegment(segment: Record<string, any>) {
  return {
    ...segment,
    page_image_path: withQuestionAssetPrefix(String(segment.page_image_path || '')),
  }
}

function normalizeOcrTextRegions(regions: Array<Record<string, any>>) {
  return regions.map((region) => ({
    ...region,
    segments: Array.isArray(region.segments) ? region.segments.map(normalizeOcrSegment) : [],
  }))
}

function loadSolutionCutResultRecords(runId: string) {
  const run = getRun(runId)
  if (!run) return []
  const cutPath = path.join(resolveStoragePath(run.runDir), 'output', 'cut_results.json')
  if (!fs.existsSync(cutPath)) return []
  const payload = parseJson<{ solution_results?: Array<Record<string, any>> }>(fs.readFileSync(cutPath, 'utf8'), { solution_results: [] })
  return payload.solution_results || []
}

function restoreSolutionItemsFromCutResults(run: { runId: string; batchId: string }, solutionCutRecords: Array<Record<string, any>>) {
  if (!solutionCutRecords.length) return [] as Array<Record<string, any>>
  const insert = db.prepare(`
    INSERT OR IGNORE INTO pdf_slicer_solution_items (
      id, batch_id, source_run_id, question_no, answer_text, analysis_markdown,
      figures_json, source_image_path, match_status, matched_question_id, match_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '', '', ?, ?, 'pending', '', ?, ?, ?)
  `)
  const now = nowIso()
  for (const cutRecord of solutionCutRecords) {
    const cutId = String(cutRecord.id || '')
    if (!cutId) continue
    const figures = Array.isArray(cutRecord.figures)
      ? cutRecord.figures.map((figure: Record<string, any>) => ({ ...figure, origin: String(figure.origin || 'cutter_auto') }))
      : []
    insert.run(
      `${run.runId}_${cutId}`,
      run.batchId,
      run.runId,
      String(cutRecord.question_no || ''),
      JSON.stringify(figures),
      String(cutRecord.auto_image_path || cutRecord.page_image_path || ''),
      '从切题产物恢复解析分段，等待 OCR 识别。',
      now,
      now,
    )
  }
  return db.prepare('SELECT * FROM pdf_slicer_solution_items WHERE source_run_id = ? ORDER BY created_at ASC').all(run.runId) as Array<Record<string, any>>
}

function composeQuestionSolutionImage(runId: string, questionNo: string, questionPath: string, solutionPath: string) {
  const questionAbs = resolveStoragePath(stripAssetPrefix(questionPath))
  const solutionAbs = resolveStoragePath(stripAssetPrefix(solutionPath))
  if (!questionAbs || !solutionAbs || !fs.existsSync(questionAbs) || !fs.existsSync(solutionAbs)) return ''
  const safeNo = String(questionNo || 'unknown').replace(/[^\w.-]+/g, '_')
  const run = getRun(runId)
  if (!run) return ''
  const outputPath = path.join(resolveStoragePath(run.runDir), 'output', 'composed', `question_solution_${safeNo}.jpg`)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const script = [
    'from PIL import Image',
    'import json, sys',
    'raw_paths, dst = json.loads(sys.argv[1]), sys.argv[2]',
    'images = [Image.open(path).convert("RGB") for path in raw_paths]',
    'width = max(im.width for im in images)',
    'height = sum(im.height for im in images)',
    'canvas = Image.new("RGB", (width, height), "white")',
    'y = 0',
    'for im in images:',
    '    canvas.paste(im, (0, y))',
    '    y += im.height',
    'canvas.save(dst, quality=95)',
  ].join('\n')
  execFileSync(pythonCommand(), ['-c', script, JSON.stringify([questionAbs, solutionAbs]), outputPath], { encoding: 'utf8' })
  return path.relative(storageRoot, outputPath).replace(/\\/g, '/')
}

function ensureQuestionAssetLink() {
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

function persistGlmFigureBindings(runId: string, result: Record<string, any>) {
  const binding = result.post_processing?.figure_binding
  if (!binding || typeof binding !== 'object' || binding.source !== 'glm') return
  const resultId = String(result.id || '')
  if (!resultId) return
  db.prepare(`
    UPDATE pdf_slicer_review_items
    SET glm_figure_bindings_json = ?, updated_at = ?
    WHERE run_id = ? AND result_id = ?
  `).run(JSON.stringify(binding), nowIso(), runId, resultId)
}

export function normalizeOcrProvider(value: unknown): OcrProvider {
  const provider = String(value || '').toLowerCase()
  if (provider === 'doc2x') return 'doc2x'
  if (provider === 'glm') return 'glm'
  return 'legacy'
}

function ocrEnvPath() {
  const configDir = path.join(storageRoot, 'config')
  fs.mkdirSync(configDir, { recursive: true })
  return path.join(configDir, 'ocr.env')
}

export function hasOcrConfig(provider: OcrProvider = normalizeOcrProvider(readOcrSettings().ocrProvider)) {
  const envPath = ocrEnvPath()
  const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const hasInText = (key: string) => new RegExp(`^${key}=.+`, 'm').test(envText)
  if (provider === 'doc2x') {
    return Boolean(process.env.DOC2X_API_KEY || hasInText('DOC2X_API_KEY'))
  }
  if (provider === 'glm') {
    return Boolean(process.env.GLM_OCR_API_KEY || hasInText('GLM_OCR_API_KEY'))
  }
  return Boolean(
    (process.env.OCR_API_BASE_URL || hasInText('OCR_API_BASE_URL')) &&
    (process.env.OCR_API_KEY || hasInText('OCR_API_KEY')) &&
    (process.env.OCR_MODEL || hasInText('OCR_MODEL'))
  )
}

export function doc2xArtifactDir(row: RunRow) {
  return path.join(resolveStoragePath(row.run_dir), 'doc2x')
}

export function glmArtifactDir(row: RunRow) {
  return path.join(resolveStoragePath(row.run_dir), 'glm')
}

type OcrSourceDocuments = {
  questionPdfPath: string
  questionPdfRel: string
  solutionPdfPath: string
  solutionPdfRel: string
}

/** Resolve the original question/solution PDFs behind a derived manual run. */
function ocrSourceDocuments(runRow: RunRow): OcrSourceDocuments {
  const diagnostics = parseJson<Record<string, any>>(runRow.document_diagnostics_json || '{}', {})
  const manualSourceIds = new Set<string>(Array.isArray(diagnostics.manualAnnotation?.sourceRunIds) ? diagnostics.manualAnnotation.sourceRunIds.map(String) : [])
  const batchRows = db.prepare('SELECT * FROM pdf_slicer_runs WHERE batch_id = ?').all(runRow.batch_id) as RunRow[]
  const candidates = manualSourceIds.size ? batchRows.filter((row) => manualSourceIds.has(row.run_id)) : batchRows
  const questionRow = candidates.find((row) => normalizeFileRole(row.file_role) === 'questions') || runRow
  const solutionRow = candidates.find((row) => normalizeFileRole(row.file_role) === 'solutions')
  const questionPdfRel = String(questionRow.pdf_path || runRow.pdf_path || '')
  const solutionPdfRel = String(solutionRow?.pdf_path || '')
  return {
    questionPdfPath: resolveStoragePath(questionPdfRel),
    questionPdfRel,
    solutionPdfPath: solutionPdfRel ? resolveStoragePath(solutionPdfRel) : '',
    solutionPdfRel,
  }
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

// ── Exported functions ────────────────────────────────────────────────────

export function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

export function createQuestionBankRerunTask(questionIds: string[], options: { forceRegionOcr?: boolean } = {}) {
  if (!questionIds.length) {
    throw new Error('没有可重新 OCR 的题目。')
  }
  ensureQuestionAssetLink()
  const now = nowIso()
  const questions = questionIds.map((questionId) => {
    const question = getQuestion(questionId)
    if (!question?.sourceRunId) return null
    const sourceRun = getRun(question.sourceRunId)
    if (!sourceRun?.pdfPath) return null
    const reviewItem = getReviewItems(question.sourceRunId).find((entry) => entry.resultId === question.id)
    if (!reviewItem) return null
    const cutRecord = loadCutResultRecord(question.sourceRunId, question.id)
    const sourceSegments = Array.isArray((reviewItem as any).segments) && (reviewItem as any).segments.length
      ? (reviewItem as any).segments
      : (Array.isArray(cutRecord?.segments) ? cutRecord.segments : [])
    const fallbackSegment = { page_number: reviewItem.pageStart, page_image_path: reviewItem.pageImagePath, bbox: reviewItem.bbox }
    const textRegions = Array.isArray((reviewItem as any).textRegions) && (reviewItem as any).textRegions.length
      ? (reviewItem as any).textRegions
      : (Array.isArray(cutRecord?.text_regions) ? cutRecord.text_regions : [
        { kind: 'problem', segments: sourceSegments.length ? sourceSegments : [fallbackSegment] },
        { kind: 'answer', segments: sourceSegments.length ? sourceSegments : [fallbackSegment] },
        { kind: 'analysis', segments: sourceSegments.length ? sourceSegments : [fallbackSegment] },
      ])
    return {
      question,
      sourceRun,
      reviewItem,
      cutRecord,
      sourceSegments,
      textRegions,
    }
  }).filter(Boolean) as Array<{
    question: NonNullable<ReturnType<typeof getQuestion>>
    sourceRun: NonNullable<ReturnType<typeof getRun>>
    reviewItem: ReturnType<typeof getReviewItems>[number]
    cutRecord: Record<string, any> | null
    sourceSegments: Array<Record<string, any>>
    textRegions: Array<Record<string, any>>
  }>

  if (!questions.length) {
    throw new Error('当前题目缺少原始 OCR 分块信息，无法重新 OCR。')
  }

  const batchId = createId('batch', 'question_bank_rerun')
  const batchTitle = batchId
  db.prepare('INSERT INTO pdf_slicer_batches (id, title, material_type, workflow_mode, workflow_status, created_at, uploaded_count) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(batchId, batchTitle, 'unknown', 'single', 'processing', now, questions.length)
  const insertRun = db.prepare(`
    INSERT INTO pdf_slicer_runs (
      run_id, batch_id, upload_mode, paper_title, pdf_name, pdf_path, source_file_name, source_file_kind, run_dir, document_diagnostics_json,
      material_type, file_role, stage, classification_confidence, classification_reasons_json,
      created_at, updated_at, slice_status, quick_review_status, total_questions, approved_questions, unreviewed_questions, ocr_status,
      rules_version, rules_hash, rules_fallback_used, rules_warnings_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'succeeded', 'submitted', ?, ?, 0, 'idle', 0, '', 0, '[]')
  `)
  const insertReview = db.prepare(`
    INSERT INTO pdf_slicer_review_items (
      result_id, run_id, question_label, page_start, page_end, page_image_path, auto_image_path, bbox_json, segments_json, text_regions_json, figures_json, review_status, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready_for_ocr', ?, ?, ?)
  `)
  const runId = createId('run', 'question_bank_rerun')
  const runDir = path.join(runsRoot, runId)
  fs.mkdirSync(runDir, { recursive: true })

  insertRun.run(
    runId,
    batchId,
    'question_bank_rerun',
    '题库批量重新 OCR',
    '题库批量重新 OCR',
    '',
    'question_bank',
    'question_bank',
    assetPathFor(runDir),
    JSON.stringify({ bulkRerun: true, questionCount: questions.length }),
    'unknown',
    'full',
    questions[0]?.question.stage || configuredGradeStages()[0] || '高三',
    1,
    JSON.stringify(['题库批量重新 OCR']),
    now,
    now,
    questions.length,
    questions.length
  )

  for (const entry of questions) {
    const resultId = `${runId}__${entry.question.id}`
    const payload = {
      originalQuestionId: entry.question.id,
      originalSourceRunId: entry.question.sourceRunId,
      sourcePdf: `question_assets/${entry.sourceRun.pdfPath}`,
      reviewedImagePath: entry.reviewItem.autoImagePath || entry.question.sliceImagePath,
      forceRegionOcr: Boolean(options.forceRegionOcr),
    }
    insertReview.run(
      resultId,
      runId,
      entry.question.questionNo || entry.reviewItem.questionLabel || entry.question.id,
      entry.reviewItem.pageStart,
      entry.reviewItem.pageEnd,
      entry.reviewItem.pageImagePath,
      entry.reviewItem.autoImagePath || entry.question.sliceImagePath,
      JSON.stringify(entry.reviewItem.bbox || entry.cutRecord?.bbox || {}),
      JSON.stringify(entry.sourceSegments.length ? entry.sourceSegments : [{ page_number: entry.reviewItem.pageStart, page_image_path: entry.reviewItem.pageImagePath, bbox: entry.reviewItem.bbox }]),
      JSON.stringify(entry.textRegions),
      JSON.stringify(entry.question.figures || entry.reviewItem.figures || entry.cutRecord?.figures || []),
      JSON.stringify(payload),
      now,
      now
    )
  }

  updateBatchWorkflow(batchId)
  return { batchId, runId, createdCount: questions.length }
}

export function createPendingBankRerunTask(sourceRunId: string, resultId: string, options: { forceRegionOcr?: boolean } = {}) {
  ensureQuestionAssetLink()
  const sourceRun = getRun(sourceRunId)
  if (!sourceRun) throw new Error('批次不存在。')
  const reviewItem = getReviewItems(sourceRunId).find((entry) => entry.resultId === resultId)
  if (!reviewItem) throw new Error('当前题目缺少原始 OCR 分块信息。')
  const cutRecord = loadCutResultRecord(sourceRunId, resultId)
  const sourceSegments = Array.isArray((reviewItem as any).segments) && (reviewItem as any).segments.length
    ? (reviewItem as any).segments
    : (Array.isArray(cutRecord?.segments) ? cutRecord.segments : [])
  const fallbackSegment = { page_number: reviewItem.pageStart, page_image_path: reviewItem.pageImagePath, bbox: reviewItem.bbox }
  const textRegions = Array.isArray((reviewItem as any).textRegions) && (reviewItem as any).textRegions.length
    ? (reviewItem as any).textRegions
    : (Array.isArray(cutRecord?.text_regions) ? cutRecord.text_regions : [
      { kind: 'problem', segments: sourceSegments.length ? sourceSegments : [fallbackSegment] },
      { kind: 'answer', segments: sourceSegments.length ? sourceSegments : [fallbackSegment] },
      { kind: 'analysis', segments: sourceSegments.length ? sourceSegments : [fallbackSegment] },
    ])

  const now = nowIso()
  const batchId = createId('batch', 'pending_bank_rerun')
  const runId = createId('run', 'pending_bank_rerun')
  const runDir = path.join(runsRoot, runId)
  fs.mkdirSync(runDir, { recursive: true })
  db.prepare('INSERT INTO pdf_slicer_batches (id, title, material_type, workflow_mode, workflow_status, created_at, uploaded_count) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(batchId, batchId, 'unknown', 'single', 'processing', now, 1)
  db.prepare(`
    INSERT INTO pdf_slicer_runs (
      run_id, batch_id, upload_mode, paper_title, pdf_name, pdf_path, source_file_name, source_file_kind, run_dir, document_diagnostics_json,
      material_type, file_role, stage, classification_confidence, classification_reasons_json,
      created_at, updated_at, slice_status, quick_review_status, total_questions, approved_questions, unreviewed_questions, ocr_status,
      rules_version, rules_hash, rules_fallback_used, rules_warnings_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'succeeded', 'submitted', 1, 1, 0, 'idle', 0, '', 0, '[]')
  `).run(
    runId,
    batchId,
    'question_bank_rerun',
    '待入库单题重新 OCR',
    '待入库单题重新 OCR',
    '',
    'pending_bank',
    'pending_bank',
    assetPathFor(runDir),
    JSON.stringify({ pendingBankRerun: true, sourceRunId, resultId }),
    'unknown',
    'full',
    sourceRun.stage || configuredGradeStages()[0] || '高三',
    1,
    JSON.stringify(['待入库单题重新 OCR']),
    now,
    now
  )
  const payload = {
    originalQuestionId: resultId,
    originalSourceRunId: sourceRunId,
    sourcePdf: `question_assets/${sourceRun.pdfPath}`,
    reviewedImagePath: reviewItem.autoImagePath || reviewItem.pageImagePath,
    forceRegionOcr: Boolean(options.forceRegionOcr),
  }
  db.prepare(`
    INSERT INTO pdf_slicer_review_items (
      result_id, run_id, question_label, page_start, page_end, page_image_path, auto_image_path, bbox_json, segments_json, text_regions_json, figures_json, review_status, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready_for_ocr', ?, ?, ?)
  `).run(
    `${runId}__${resultId}`,
    runId,
    reviewItem.questionLabel || resultId,
    reviewItem.pageStart,
    reviewItem.pageEnd,
    reviewItem.pageImagePath,
    reviewItem.autoImagePath || reviewItem.pageImagePath,
    JSON.stringify(reviewItem.bbox || cutRecord?.bbox || {}),
    JSON.stringify(sourceSegments.length ? sourceSegments : [fallbackSegment]),
    JSON.stringify(textRegions),
    JSON.stringify(reviewItem.figures || cutRecord?.figures || []),
    JSON.stringify(payload),
    now,
    now
  )
  updateBatchWorkflow(batchId)
  return { batchId, runId, createdCount: 1 }
}

function computeFileSha256(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath)
  const hashSum = crypto.createHash('sha256')
  hashSum.update(fileBuffer)
  return hashSum.digest('hex')
}

export function materializeReviewFigures(runId: string) {
  const run = getRun(runId)
  if (!run) throw new Error('批次不存在。')
  const reviewItems = db.prepare('SELECT * FROM pdf_slicer_review_items WHERE run_id = ?').all(runId) as Array<Record<string, any>>
  const solutionItems = db.prepare('SELECT * FROM pdf_slicer_solution_items WHERE source_run_id = ?').all(runId) as Array<Record<string, any>>
  const failures: string[] = []
  const updateReview = db.prepare('UPDATE pdf_slicer_review_items SET figures_json = ?, updated_at = ? WHERE run_id = ? AND result_id = ?')
  const updateSolution = db.prepare('UPDATE pdf_slicer_solution_items SET figures_json = ?, updated_at = ? WHERE id = ? AND source_run_id = ?')

  // Review figure bboxes are defined against the displayed review slice, not
  // necessarily against run.pdfPath. Crop that slice directly so answer PDFs,
  // manual annotations and merge/split results stay in the correct coordinate
  // system.
  const materialize = (fig: Record<string, any>, itemId: string, sourceRel: string, pixelBBox: Record<string, any>) => {
    const sourceAbs = resolveStoragePath(stripAssetPrefix(sourceRel))
    const version = Number(fig.assetVersion || 1)
    const outputRel = path.join('data', 'review_figures', runId, itemId, `${fig.id}_v${version}.png`)
    const outputAbs = resolveStoragePath(outputRel)
    if (!sourceRel || !fs.existsSync(sourceAbs)) {
      throw new Error(`来源切片不存在：${sourceRel || '(空)'}`)
    }
    const margin = 0
    const expanded = {
      x: Math.max(0, Number(pixelBBox.x || 0) - margin),
      y: Math.max(0, Number(pixelBBox.y || 0) - margin),
      width: Number(pixelBBox.width || 0) + margin * 2,
      height: Number(pixelBBox.height || 0) + margin * 2,
    }
    if (!(expanded.width > margin * 2 && expanded.height > margin * 2)) {
      throw new Error('图框坐标无效')
    }
    cropFigureImage(sourceAbs, outputAbs, expanded)
    if (!fs.existsSync(outputAbs) || fs.statSync(outputAbs).size === 0) {
      throw new Error('未生成裁剪图片')
    }
    fig.sourceImagePath = stripAssetPrefix(sourceRel)
    fig.assetPath = outputRel
    fig.path = outputRel
    fig.assetHash = `sha256:${computeFileSha256(outputAbs)}`
    fig.cropVersion = REVIEW_FIGURE_CROP_VERSION
    fig.ocrBinding = { ...fig.ocrBinding, status: 'ready' }
  }

  for (const item of reviewItems) {
    const figures = parseJson<any[]>(String(item.figures_json || '[]'), [])
    let changed = false
    for (const fig of figures) {
      if (fig.ocrBinding?.status !== 'pending_render') continue
      try {
        const sourceRel = String(fig.sourceImagePath || item.auto_image_path || item.page_image_path || '')
        materialize(fig, String(item.result_id), sourceRel, reviewFigurePixelBBox(item as any, fig, resolveStoragePath(stripAssetPrefix(sourceRel))))
        changed = true
      } catch (error) {
        failures.push(`题目 ${item.question_label || item.result_id} 的图 ${fig.ocrBinding?.attachmentId || fig.id}：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (changed) updateReview.run(JSON.stringify(figures), nowIso(), runId, item.result_id)
  }

  for (const item of solutionItems) {
    const figures = parseJson<any[]>(String(item.figures_json || '[]'), [])
    let changed = false
    const cutRecord = loadSolutionCutResultRecord(runId, String(item.id || ''))
    const segments = Array.isArray(cutRecord?.segments) ? cutRecord.segments : []
    for (const fig of figures) {
      if (fig.ocrBinding?.status !== 'pending_render') continue
      try {
        const sourceRel = String(fig.sourceImagePath || item.source_image_path || '')
        const sourceAbs = resolveStoragePath(stripAssetPrefix(sourceRel))
        const pixelBBox = segments.length
          ? figurePixelBBoxForSegments(segments, Number(cutRecord?.page || fig.pageNumber || 1), fig, sourceAbs)
          : (fig.bbox || fig.reviewBBox || {})
        materialize(fig, String(item.id), sourceRel, pixelBBox)
        changed = true
      } catch (error) {
        failures.push(`解析 ${item.question_no || item.id} 的图 ${fig.ocrBinding?.attachmentId || fig.id}：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (changed) updateSolution.run(JSON.stringify(figures), nowIso(), item.id, runId)
  }

  if (failures.length) {
    throw new Error(`人工图框物化失败，已阻止 OCR：${failures.join('；')}`)
  }
}

export function exportRunForMigratedOcr(runId: string) {
  materializeReviewFigures(runId)
  ensureQuestionAssetLink()
  const run = getRun(runId)
  if (!run) throw new Error('批次不存在。')
  const sourceRun = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as RunRow | undefined
  if (!sourceRun) throw new Error('批次不存在。')
  const sourceDocuments = ocrSourceDocuments(sourceRun)
  const items = getReviewItems(runId).filter((item) => item.reviewStatus === 'ready_for_ocr')
  if (!items.length) throw new Error('没有已通过复核的切片，请先提交切题复核。')
  const solutionCutRecords = loadSolutionCutResultRecords(runId)
  const existingSolutionRows = db.prepare('SELECT * FROM pdf_slicer_solution_items WHERE source_run_id = ? ORDER BY created_at ASC').all(runId) as Array<Record<string, any>>
  const solutionRows = solutionCutRecords.length
    ? restoreSolutionItemsFromCutResults(run, solutionCutRecords)
    : existingSolutionRows
  const solutionCutById = new Map<string, Record<string, any>>()
  for (const item of solutionCutRecords) {
    const id = String(item.id || '')
    const questionNo = String(item.question_no || '')
    if (id) solutionCutById.set(id, item)
    if (questionNo && !solutionCutById.has(questionNo)) solutionCutById.set(questionNo, item)
  }
  const hasSameRunSolutions = solutionRows.length > 0
  const solutionImageByNo = new Map<string, string>()
  for (const solution of solutionRows) {
    const solutionId = String(solution.id || '')
    const cutId = solutionId.match(/SOL_\d+/)?.[0] || ''
    const cutRecord = solutionCutById.get(cutId) || solutionCutById.get(String(solution.question_no || '')) || {}
    const imagePath = String(cutRecord.auto_image_path || solution.source_image_path || cutRecord.page_image_path || '')
    const key = cleanQuestionNoLabel(String(solution.question_no || cutRecord.question_no || ''))
    if (key && imagePath && !solutionImageByNo.has(key)) solutionImageByNo.set(key, imagePath)
  }
  const outputDir = path.join(pythonDataRoot, 'output')
  fs.mkdirSync(outputDir, { recursive: true })

  const records = items.map((item) => {
    const notePayload = parseJson<Record<string, any>>(String((item as any).note || ''), {})
    const cutRecord = loadCutResultRecord(runId, item.resultId)
    const storedSegments = Array.isArray((item as any).segments) ? (item as any).segments : []
    const storedTextRegions = Array.isArray((item as any).textRegions) ? (item as any).textRegions : []
    const sourceSegments = storedSegments.length ? storedSegments : (Array.isArray(cutRecord?.segments) ? cutRecord?.segments : [])
    const fallbackSegment = { page_number: item.pageStart, page_image_path: item.pageImagePath, bbox: item.bbox }
    const reviewedSegments = (sourceSegments.length ? sourceSegments : [fallbackSegment]).map(normalizeOcrSegment)
    const sourceTextRegions = storedTextRegions.length ? storedTextRegions : (Array.isArray(cutRecord?.text_regions) ? cutRecord?.text_regions : [])
    const textRegions = hasSameRunSolutions
      ? [{ kind: 'problem', segments: reviewedSegments }]
      : sourceTextRegions.length
      ? normalizeOcrTextRegions(sourceTextRegions)
      : [
        { kind: 'problem', segments: reviewedSegments },
        { kind: 'answer', segments: reviewedSegments },
        { kind: 'analysis', segments: reviewedSegments },
      ]
    const reviewedPath = withQuestionAssetPrefix(item.autoImagePath || String(notePayload.reviewedImagePath || cutRecord?.auto_image_path || ''))
    const solutionImagePath = solutionImageByNo.get(cleanQuestionNoLabel(String(item.questionLabel || ''))) || ''
    const composedPath = solutionImagePath ? composeQuestionSolutionImage(runId, item.questionLabel, reviewedPath, solutionImagePath) : ''
    const ocrImagePath = withQuestionAssetPrefix(composedPath || reviewedPath)
    const questionFigures = Array.isArray((item as any).figures) ? (item as any).figures : (Array.isArray(cutRecord?.figures) ? cutRecord?.figures : [])
    const key = cleanQuestionNoLabel(String(item.questionLabel || ''))
    const matchingSolutions = solutionRows.filter((s) => cleanQuestionNoLabel(String(s.question_no || '')) === key)
    const solutionFigures = matchingSolutions.flatMap((solution) => parseJson<any[]>(String(solution.figures_json || '[]'), []))

    const allAttachments: any[] = []
    questionFigures.forEach((fig: any) => {
      if (fig.ocrBinding?.enabled && fig.assetPath) {
        allAttachments.push({
          id: fig.ocrBinding.attachmentId || fig.id,
          path: withQuestionAssetPrefix(fig.assetPath),
          usage: fig.usage || 'stem',
          targetField: fig.usage === 'options' ? 'options' : (fig.usage || 'stem'),
          source: 'question'
        })
      }
    })
    solutionFigures.forEach((fig: any) => {
      if (fig.ocrBinding?.enabled && fig.assetPath) {
        allAttachments.push({
          id: fig.ocrBinding.attachmentId || fig.id,
          path: withQuestionAssetPrefix(fig.assetPath),
          usage: fig.usage || 'analysis',
          targetField: 'analysis',
          source: 'solution'
        })
      }
    })

    return {
      id: item.resultId,
      source_pdf: String(notePayload.sourcePdf || `question_assets/${sourceDocuments.questionPdfRel || run.pdfPath}`),
      page: item.pageStart,
      page_span: [item.pageStart, item.pageEnd],
      question_no: item.questionLabel,
      material_type: run.materialType,
      reviewed_image_path: ocrImagePath,
      auto_image_path: ocrImagePath,
      problem_image_path: reviewedPath,
      solution_image_path: solutionImagePath ? withQuestionAssetPrefix(solutionImagePath) : '',
      reviewed_bbox: cutRecord?.bbox || item.bbox,
      auto_bbox: cutRecord?.bbox || item.bbox,
      reviewed_segments: reviewedSegments,
      segments: reviewedSegments,
      text_regions: textRegions,
      ocr_record_kind: 'question',
      ocr_parse_mode: hasSameRunSolutions ? 'region' : 'auto',
      figures: questionFigures,
      attachments: allAttachments,
      original_question_id: String(notePayload.originalQuestionId || ''),
      original_source_run_id: String(notePayload.originalSourceRunId || ''),
      force_region_ocr: Boolean(notePayload.forceRegionOcr),
      status: 'ready_for_ocr',
      note: item.note,
    }
  })
  const solutionRecords = solutionRows.map((solution) => {
    const solutionId = String(solution.id || '')
    const cutId = solutionId.match(/SOL_\d+/)?.[0] || ''
    const cutRecord = solutionCutById.get(cutId) || solutionCutById.get(String(solution.question_no || '')) || {}
    const rawSegments = Array.isArray(cutRecord.segments) ? cutRecord.segments : []
    const segments = rawSegments.map(normalizeOcrSegment)
    const imagePath = withQuestionAssetPrefix(String(cutRecord.auto_image_path || solution.source_image_path || cutRecord.page_image_path || ''))

    const reviewedFigures = parseJson<Array<Record<string, any>>>(String(solution.figures_json || '[]'), [])
    const solutionAttachments = reviewedFigures
      .filter((fig) => fig.ocrBinding?.enabled && fig.assetPath)
      .map((fig) => ({
        id: fig.ocrBinding.attachmentId || fig.id,
        path: withQuestionAssetPrefix(fig.assetPath),
        usage: 'analysis',
        targetField: 'analysis',
        source: 'solution'
      }))

    return {
      id: solutionId,
      source_pdf: `question_assets/${sourceDocuments.solutionPdfRel || sourceDocuments.questionPdfRel || run.pdfPath}`,
      page: Number(cutRecord.page || (Array.isArray(cutRecord.page_span) ? cutRecord.page_span[0] : 1) || 1),
      page_span: Array.isArray(cutRecord.page_span) ? cutRecord.page_span : [Number(cutRecord.page || 1), Number(cutRecord.page || 1)],
      question_no: String(solution.question_no || cutRecord.question_no || ''),
      material_type: run.materialType,
      reviewed_image_path: imagePath,
      auto_image_path: imagePath,
      reviewed_bbox: cutRecord.bbox || {},
      auto_bbox: cutRecord.bbox || {},
      reviewed_segments: segments,
      segments,
      text_regions: [{ kind: 'analysis', segments }],
      figures: reviewedFigures.length ? reviewedFigures : (Array.isArray(cutRecord.figures) ? cutRecord.figures : []),
      attachments: solutionAttachments,
      status: 'ready_for_ocr',
      ocr_record_kind: 'solution',
      ocr_parse_mode: sourceDocuments.solutionPdfRel ? 'document' : 'region',
      note: String(solution.match_note || ''),
    }
  }).filter((record) => record.id && (Boolean(sourceDocuments.solutionPdfRel) || record.segments.length))
  const manifestRecords = [...records, ...solutionRecords]
  const payload = JSON.stringify({ results: manifestRecords }, null, 2)
  fs.writeFileSync(path.join(outputDir, 'reviewed_results.json'), payload)
  fs.writeFileSync(path.join(outputDir, 'cut_results.json'), payload)
  fs.writeFileSync(path.join(outputDir, 'ocr_manifest.json'), payload)
  return records.length
}

export async function importMigratedOcrResults(runId: string) {
  const runRow = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as RunRow | undefined
  const roleRow = runRow ? { file_role: runRow.file_role } : undefined
  if (normalizeFileRole(roleRow?.file_role) === 'solutions') {
    const imported = await importMigratedOcrSolutionResults(runId)
    tryAutoMergeSeparatedExamForRun(runId)
    return imported
  }
  const draftsDir = path.join(pythonDataRoot, 'ocr_drafts')
  const sourceTitle = cleanSourceTitle(runRow?.paper_title || runRow?.pdf_name || '', runRow?.pdf_name || 'OCR 导入')
  const runStage = String(runRow?.stage || configuredGradeStages()[0] || '高三')
  const isQuestionBankRerun = runRow?.upload_mode === 'question_bank_rerun'
  const sameRunSolutionCount = (db.prepare('SELECT COUNT(*) AS count FROM pdf_slicer_solution_items WHERE source_run_id = ?').get(runId) as { count: number }).count
  const hasSeparatedSolutions = normalizeFileRole(runRow?.file_role) === 'questions' || sameRunSolutionCount > 0
  if (!fs.existsSync(draftsDir)) return 0
  let imported = 0
  const reviewOrder = new Map(getReviewItems(runId).map((item, index) => [item.resultId, index]))
  const entries = (await fs.promises.readdir(draftsDir))
    .filter((entry) => entry.startsWith(runId))
    .sort((left, right) => {
      const leftRank = reviewOrder.get(left)
      const rightRank = reviewOrder.get(right)
      if (leftRank != null && rightRank != null) return leftRank - rightRank
      if (leftRank != null) return -1
      if (rightRank != null) return 1
      return left.localeCompare(right)
    })
  for (const [index, entry] of entries.entries()) {
    const resultPath = path.join(draftsDir, entry, 'ocr_result.json')
    if (!fs.existsSync(resultPath)) continue
    const result = JSON.parse(await fs.promises.readFile(resultPath, 'utf8')) as Record<string, any>
    persistGlmFigureBindings(runId, result)
    if (String(result.ocr_record_kind || '') === 'solution') {
      await importSameRunGlmSolutionDraft(runId, result)
      continue
    }
    const targetQuestionId = isQuestionBankRerun
      ? String(result.original_question_id || entry.split('__').slice(1).join('__') || result.id || '')
      : String(result.id || '')
    const questionNo = cleanQuestionNoLabel(String(result.question_no || ''))
    const localFigures = await figuresForImportedOcrResultAsync(result, runId)
    bindExplicitAttachments(result, localFigures)

    // Inline <img> references describe locations in the OCR text.  They must
    // bind exclusively to reviewed cut figures: GLM page-level images are
    // useful supplemental assets, but including them here makes an otherwise
    // unambiguous 1:1 cut look like a many-image mismatch.
    const inlineImages = bindInlineImageReferences(result, runId, { localFigures })
    const stem = stripOcrTemplateNoise(stripLeadingQuestionNo(String(inlineImages?.stem ?? result.problem_text ?? '').trim(), questionNo)).trim()
    const answer = stripOcrTemplateNoise(String(inlineImages?.answer ?? result.answer ?? '').trim()).trim()
    const analysis = stripOcrTemplateNoise(String(inlineImages?.analysis ?? result.analysis ?? '').trim()).trim()
    const knowledgePoints = normalizeTags(result.knowledge_points)
    const solutionMethods = normalizeTags(result.solution_methods)
    const difficultyScore10 = normalizeDifficultyScore10(result.difficulty_score_10)
    const difficultyLabel = String(result.difficulty_label || difficultyLabel10(difficultyScore10))
    if (!stem && !answer && !analysis) continue
    const questionType = inferQuestionType(stem, answer)
    const figures = inlineImages ? inlineImages.figures : localFigures
    const sliceImagePath = sliceImagePathForOcrResult(result, runId)

    const unplacedAttachments = localFigures.filter((f) => f.ocrBinding?.enabled && f.ocrBinding?.status === 'unplaced')
    const formatIssues = [inlineImages?.issue, ...validateQuestionMarkdown({ problem_text: stem, answer, analysis })].filter(Boolean) as Array<any>
    if (unplacedAttachments.length > 0) {
      formatIssues.push({
        field: 'figures',
        code: 'unplaced_attachment',
        message: `含有未定位的人工附件图（${unplacedAttachments.map((f: any) => f.ocrBinding.attachmentId || f.id).join('、')}）。可用待定位操作放置到文本中。`,
        snippet: unplacedAttachments.map((f: any) => f.ocrBinding.attachmentId || f.id).join(','),
      })
    }
    const needsFormatReview = Boolean(formatIssues.length)
    const formatReviewJson = needsFormatReview ? JSON.stringify(formatReviewPayload(formatIssues, nowIso())) : '{}'
    const existing = db.prepare('SELECT id, chapter, source_title, source_run_id, source_solution_run_id, merge_status, merge_note, bank_status, slice_image_path, updated_at FROM question_bank_items WHERE id = ?').get(targetQuestionId) as {
      id: string
      chapter: string
      source_title: string
      source_run_id: string
      source_solution_run_id: string
      merge_status: string
      merge_note: string
      bank_status: string
      slice_image_path: string
      updated_at: string
    } | undefined
    const originalSourceRunId = String(result.original_source_run_id || '')
    if (existing) {
      const draftUpdatedAtMs = (await fs.promises.stat(resultPath)).mtime.getTime()
      if (!isQuestionBankRerun && parseTimestampMs(existing.updated_at) > draftUpdatedAtMs) {
        continue
      }
      if (isQuestionBankRerun) {
        db.prepare(`
          UPDATE question_bank_items SET
            question_no = ?,
            stage = ?,
            question_type = ?,
            difficulty_score = ?,
            difficulty_score_10 = ?,
            difficulty_label = ?,
            chapter = ?,
            knowledge_points_json = ?,
            solution_methods_json = ?,
            stem_markdown = ?,
            answer_text = ?,
            analysis_markdown = ?,
            search_text = ?,
            slice_image_path = ?,
            figures_json = ?,
            format_review_required = ?,
            format_review_reasons_json = ?,
            updated_at = ?
          WHERE id = ?
        `).run(
          questionNo,
          runStage,
          questionType,
          result.needs_human_review ? 4 : 3,
          difficultyScore10,
          difficultyLabel,
          knowledgePoints[0] || existing.chapter || '待整理',
          JSON.stringify(knowledgePoints),
          JSON.stringify(solutionMethods),
          stem,
          answer,
          analysis,
          buildSearchText(stem, answer, analysis, [sourceTitle, knowledgePoints.join(' '), solutionMethods.join(' ')]),
          sliceImagePath || existing.slice_image_path,
          JSON.stringify(figures),
          needsFormatReview ? 1 : 0,
          formatReviewJson,
          nowIso(),
          targetQuestionId
        )
      } else {
        db.prepare(`
          UPDATE question_bank_items SET
            question_no = ?,
            stage = ?,
            question_type = ?,
            difficulty_score = ?,
            difficulty_score_10 = ?,
            difficulty_label = ?,
            chapter = ?,
            knowledge_points_json = ?,
            solution_methods_json = ?,
            source_title = ?,
            stem_markdown = ?,
            answer_text = ?,
            analysis_markdown = ?,
            search_text = ?,
            slice_image_path = ?,
            figures_json = ?,
            source_run_id = ?,
            bank_status = ?,
            source_solution_run_id = CASE WHEN ? THEN '' ELSE source_solution_run_id END,
            merge_status = ?,
            merge_note = ?,
            format_review_required = ?,
            format_review_reasons_json = ?,
            updated_at = ?
          WHERE id = ?
        `).run(
          questionNo,
          runStage,
          questionType,
          result.needs_human_review ? 4 : 3,
          difficultyScore10,
          difficultyLabel,
          knowledgePoints[0] || '待整理',
          JSON.stringify(knowledgePoints),
          JSON.stringify(solutionMethods),
          sourceTitle,
          stem,
          answer,
          analysis,
          buildSearchText(stem, answer, analysis, [sourceTitle, knowledgePoints.join(' '), solutionMethods.join(' ')]),
          sliceImagePath,
          JSON.stringify(figures),
          runId,
          needsFormatReview ? 'blocked' : 'ready',
          hasSeparatedSolutions ? 1 : 0,
          hasSeparatedSolutions ? 'waiting_solution' : '',
          hasSeparatedSolutions ? '等待原卷/解析按题号合并。' : '',
          needsFormatReview ? 1 : 0,
          formatReviewJson,
          nowIso(),
          targetQuestionId
        )
      }
      imported += 1
      if (index > 0 && index % 5 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
      continue
    }
    const targetSourceRunId = isQuestionBankRerun ? originalSourceRunId : runId
    const targetSourceTitle = isQuestionBankRerun && originalSourceRunId
      ? cleanSourceTitle(getRun(originalSourceRunId)?.paperTitle || getRun(originalSourceRunId)?.pdfName || sourceTitle, sourceTitle)
      : sourceTitle
    createQuestion({
      id: targetQuestionId,
      questionNo,
      stage: runStage,
      questionType,
      difficultyScore: result.needs_human_review ? 4 : 3,
      difficultyScore10,
      difficultyLabel,
      chapter: '待整理',
      knowledgePoints,
      solutionMethods,
      sourceTitle: targetSourceTitle,
      stemMarkdown: stem,
      answerText: answer,
      analysisMarkdown: analysis,
      sliceImagePath,
      figures,
      sourceRunId: targetSourceRunId,
      mergeStatus: hasSeparatedSolutions ? 'waiting_solution' : '',
      mergeNote: hasSeparatedSolutions ? '等待原卷/解析按题号合并。' : '',
      needsFormatReview,
      formatIssue: needsFormatReview ? formatIssueFromReviewJson(formatReviewJson) : undefined,
    })
    imported += 1
    if (index > 0 && index % 5 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
  }
  tryAutoMergeSeparatedExamForRun(runId)
  return imported
}

async function importSameRunGlmSolutionDraft(runId: string, result: Record<string, any>) {
  const solutionId = String(result.id || '')
  if (!solutionId) return false
  const existing = db.prepare('SELECT id FROM pdf_slicer_solution_items WHERE id = ? AND source_run_id = ?').get(solutionId, runId) as { id: string } | undefined
  if (!existing) return false
  const answer = stripOcrTemplateNoise(String(result.answer || '').trim()).trim()
  const analysis = stripOcrTemplateNoise(String(result.analysis || result.problem_text || '').trim()).trim()
  if (!answer && !analysis) return false
  const figures = (await figuresForImportedOcrResultAsync(result, runId)).map((figure) => ({ ...figure, usage: 'analysis' }))
  db.prepare(`
    UPDATE pdf_slicer_solution_items
    SET answer_text = ?,
        analysis_markdown = ?,
        figures_json = ?,
        source_image_path = COALESCE(NULLIF(?, ''), source_image_path),
        match_status = CASE WHEN match_status = 'matched' THEN match_status ELSE 'pending' END,
        match_note = CASE WHEN match_status = 'matched' THEN match_note ELSE ? END,
        updated_at = ?
    WHERE id = ? AND source_run_id = ?
  `).run(
    answer,
    analysis,
    JSON.stringify(figures),
    stripAssetPrefix(String(result.reviewed_image_path || result.auto_image_path || result.image_path || '')),
    'GLM-OCR 已识别同卷参考答案/解析，等待题干 OCR 后合并。',
    nowIso(),
    solutionId,
    runId,
  )
  return true
}

export async function importMigratedOcrSolutionResults(runId: string) {
  const draftsDir = path.join(pythonDataRoot, 'ocr_drafts')
  const runRow = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as RunRow | undefined
  if (!runRow || !fs.existsSync(draftsDir)) return 0
  db.prepare('DELETE FROM pdf_slicer_solution_items WHERE source_run_id = ?').run(runId)
  const insert = db.prepare(`
    INSERT INTO pdf_slicer_solution_items (
      id, batch_id, source_run_id, question_no, answer_text, analysis_markdown, figures_json, source_image_path, match_status, matched_question_id, match_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', '', ?, ?)
  `)
  let imported = 0
  const now = nowIso()
  const entries = await fs.promises.readdir(draftsDir)
  for (const [index, entry] of entries.entries()) {
    if (!entry.startsWith(runId)) continue
    const resultPath = path.join(draftsDir, entry, 'ocr_result.json')
    if (!fs.existsSync(resultPath)) continue
    const result = JSON.parse(await fs.promises.readFile(resultPath, 'utf8')) as Record<string, any>
    const questionNo = cleanQuestionNoLabel(String(result.question_no || ''))
    const stem = stripOcrTemplateNoise(stripLeadingQuestionNo(String(result.problem_text || '').trim(), questionNo)).trim()
    const answer = stripOcrTemplateNoise(String(result.answer || '').trim()).trim()
    const analysis = stripOcrTemplateNoise(String(result.analysis || stem).trim()).trim()
    if (!answer && !analysis) continue
    const figures = (await figuresForImportedOcrResultAsync(result, runId)).map((figure) => ({ ...figure, usage: 'analysis' }))
    insert.run(
      String(result.id || entry),
      runRow.batch_id,
      runId,
      questionNo,
      answer,
      analysis,
      JSON.stringify(figures),
      stripAssetPrefix(String(result.image_path || '')),
      now,
      now
    )
    imported += 1
    if (index > 0 && index % 5 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
  }
  updateBatchWorkflow(runRow.batch_id)
  return imported
}

export function startMigratedOcrBackground(runId: string, options: { force?: boolean } = {}) {
  if (activeOcrProcesses.has(runId)) {
    throw new Error('该 OCR 任务已经在运行。')
  }
  const runRow = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as RunRow | undefined
  if (!runRow) throw new Error('批次不存在。')
  const settings = readOcrSettings()
  const provider = normalizeOcrProvider(settings.ocrProvider)
  if (provider === 'legacy') {
    throw new Error('历史 OCR 已下线，无法重新启动；请在 OCR 设置中选择 GLM-OCR 后从题库或待入库页面重新识别。')
  }
  if (!hasOcrConfig(provider)) {
    throw new Error(provider === 'doc2x'
      ? '缺少 Doc2X 配置：请在 OCR 设置中配置 Doc2X API Key。'
      : provider === 'glm'
        ? '缺少 GLM-OCR 配置：请在 OCR 设置中配置 GLM-OCR API Key。'
        : '缺少 OCR 配置：请在应用 OCR 设置或进程环境中配置 OCR_API_BASE_URL、OCR_API_KEY、OCR_MODEL。')
  }
  const count = exportRunForMigratedOcr(runId)
  const logPath = ocrJobLogPath(runId)
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  db.prepare(`
    UPDATE pdf_slicer_runs
    SET ocr_provider = ?, ocr_provider_phase = ?, ocr_provider_progress = ?, updated_at = ?
    WHERE run_id = ?
  `).run(provider, provider === 'doc2x' || provider === 'glm' ? 'starting' : '', provider === 'doc2x' || provider === 'glm' ? 1 : 0, nowIso(), runId)
  fs.writeFileSync(logPath, `[${nowIso()}] OCR runner started. provider=${provider} total=${count} concurrency=${settings.concurrency || '20'}\n`)
  let args: string[]
  if (provider === 'doc2x') {
    const artifactDir = doc2xArtifactDir(runRow)
    fs.mkdirSync(artifactDir, { recursive: true })
    const sourceDocuments = ocrSourceDocuments(runRow)
    const pdfPath = sourceDocuments.questionPdfPath
    if (!pdfPath || !fs.existsSync(pdfPath)) throw new Error('Doc2X 找不到当前批次的原始 PDF。')
    args = [
      'scripts/run_doc2x_ocr.py',
      '--run-id', runId,
      '--pdf', pdfPath,
      '--manifest', path.join(pythonDataRoot, 'output', 'ocr_manifest.json'),
      '--drafts-root', path.join(pythonDataRoot, 'ocr_drafts'),
      '--artifact-dir', artifactDir,
      '--storage-root', storageRoot,
    ]
    if (sourceDocuments.solutionPdfPath && fs.existsSync(sourceDocuments.solutionPdfPath)) args.push('--solutions-pdf', sourceDocuments.solutionPdfPath)
    if (options.force === true) args.push('--force')
  } else if (provider === 'glm') {
    const artifactDir = glmArtifactDir(runRow)
    fs.mkdirSync(artifactDir, { recursive: true })
    const sourceDocuments = ocrSourceDocuments(runRow)
    const pdfPath = sourceDocuments.questionPdfPath
    const isSingleQuestion = runRow.upload_mode === 'question_bank_rerun' || runRow.upload_mode === 'pending_bank_rerun'
    if (!isSingleQuestion && (!pdfPath || !fs.existsSync(pdfPath))) throw new Error('GLM-OCR 找不到当前批次的原始 PDF。')
    args = [
      'scripts/run_glm_ocr.py', '--run-id', runId,
      '--pdf', pdfPath || path.join(artifactDir, 'placeholder.pdf'),
      '--manifest', path.join(pythonDataRoot, 'output', 'ocr_manifest.json'),
      '--drafts-root', path.join(pythonDataRoot, 'ocr_drafts'),
      '--artifact-dir', artifactDir,
      '--storage-root', storageRoot,
    ]
    if (!isSingleQuestion && sourceDocuments.solutionPdfPath && fs.existsSync(sourceDocuments.solutionPdfPath)) args.push('--solutions-pdf', sourceDocuments.solutionPdfPath)
    if (isSingleQuestion) args.push('--single-question')
    if (options.force === true) args.push('--force')
  } else {
    args = ['scripts/run_ocr_trial.py', '--max-items', String(count), '--concurrency', settings.concurrency || '20', '--skip-manifest-check']
    if (options.force !== false) args.push('--force')
  }
  const child = spawn(pythonCommand(), args, {
    cwd: pythonRoot,
    env: ocrRunnerEnv(),
  })
  activeOcrProcesses.set(runId, child)
  const append = (chunk: Buffer) => fs.appendFileSync(logPath, chunk)
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  child.on('close', (code, signal) => {
    activeOcrProcesses.delete(runId)
    fs.appendFileSync(logPath, `\n[${nowIso()}] OCR runner exited. code=${code ?? 'null'} signal=${signal ?? 'null'}\n`)
    void finishMigratedOcrBackground(runId, count, code, signal, logPath)
  })
  return count
}

export async function finishMigratedOcrBackground(runId: string, count: number, code: number | null, signal: NodeJS.Signals | null, logPath: string) {
  try {
    const sourceRow = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as RunRow | undefined
    if (sourceRow) syncDoc2xState(sourceRow)
    const current = db.prepare('SELECT ocr_error FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as { ocr_error?: string } | undefined
    if (current?.ocr_error === '用户强制中断') {
      tryAutoMergeSeparatedExamForRun(runId)
      return
    }
    if (code === 0) {
      const imported = await importMigratedOcrResults(runId)
      await classifyRunAfterImport(runId, logPath)
      const finishedAt = nowIso()
      if (imported >= count) {
        db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'succeeded', ocr_error = '', ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
          .run(finishedAt, finishedAt, runId)
      } else if (imported > 0) {
        const message = `OCR 部分完成：已生成 ${imported}/${count} 道待入库题目；请查看 server/python/ocr_jobs/${runId}.log。`
        db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
          .run(message, finishedAt, finishedAt, runId)
      } else {
        const message = 'OCR runner 已结束，但没有产生待入库的题目内容；请检查 OCR 进度日志。'
        db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
          .run(message, finishedAt, finishedAt, runId)
      }
    } else {
      const imported = await importMigratedOcrResults(runId)
      const finishedAt = nowIso()
      const message = imported > 0
        ? `OCR 部分完成：已生成 ${imported}/${count} 道待入库题目；请查看 server/python/ocr_jobs/${runId}.log。`
        : `OCR runner 异常退出：code=${code ?? 'null'} signal=${signal ?? 'null'}；请检查 OCR 进度日志。`
      db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
        .run(message, finishedAt, finishedAt, runId)
    }
  } catch (error) {
    const finishedAt = nowIso()
    const message = error instanceof Error ? error.message : String(error)
    db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
      .run(message, finishedAt, finishedAt, runId)
  }
  tryAutoMergeSeparatedExamForRun(runId)
}

export async function runMigratedOcr(runId: string) {
  const provider = normalizeOcrProvider(readOcrSettings().ocrProvider)
  if (!hasOcrConfig(provider)) {
    throw new Error('缺少 OCR 配置：请在应用 OCR 设置或进程环境中配置 OCR_API_BASE_URL、OCR_API_KEY、OCR_MODEL。')
  }
  if (provider === 'doc2x') {
    throw new Error('Doc2X 仅支持后台任务模式。')
  }
  if (provider === 'glm') {
    throw new Error('GLM-OCR 仅支持后台任务模式。')
  }
  const count = exportRunForMigratedOcr(runId)
  const settings = readOcrSettings()
  execFileSync(pythonCommand(), ['scripts/run_ocr_trial.py', '--max-items', String(count), '--concurrency', settings.concurrency || '20', '--force', '--skip-manifest-check'], {
    cwd: pythonRoot,
    env: pythonEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const imported = await importMigratedOcrResults(runId)
  if (imported <= 0) {
    throw new Error('OCR runner 已结束，但没有产生待入库的题目内容；请检查 server/python/ocr_drafts/ocr_trial_report.md。')
  }
  return imported
}

export function getOcrProgress(runId: string) {
  const run = getRun(runId)
  if (!run) return null
  const importedQuestions = (db.prepare('SELECT COUNT(*) AS count FROM question_bank_items WHERE source_run_id = ?').get(runId) as { count: number }).count
  const draftStats = getOcrDraftStats(runId)
  const total = run.approvedQuestions || run.totalQuestions || 0
  const processed = Math.max(importedQuestions, draftStats.total, run.processedQuestions || 0)
  const itemProgress = total ? Math.min(1, processed / total) : 0
  const providerProgress = run.ocrProvider === 'doc2x' || run.ocrProvider === 'glm' ? Math.max(0, Math.min(1, Number(run.ocrProviderProgress || 0) / 100)) : 0
  const progressPercent = Math.max(itemProgress, providerProgress, run.progressPercent || 0)
  return {
    run: { ...run, processedQuestions: processed, progressPercent, totalOcrQuestions: total },
    active: activeOcrProcesses.has(runId),
    importedQuestions,
    draftCount: draftStats.total,
    successfulDraftCount: draftStats.successful,
    failedDraftCount: draftStats.failed,
    pendingDraftCount: draftStats.pending,
    totalQuestions: total,
    progressPercent,
    logTail: tailText(ocrJobLogPath(runId)),
  }
}

export function getOcrDraftStats(runId: string) {
  const draftsDir = path.join(pythonDataRoot, 'ocr_drafts')
  const stats = { total: 0, successful: 0, failed: 0, pending: 0 }
  if (!fs.existsSync(draftsDir)) return stats
  for (const entry of fs.readdirSync(draftsDir)) {
    if (!entry.startsWith(runId)) continue
    const resultPath = path.join(draftsDir, entry, 'ocr_result.json')
    if (!fs.existsSync(resultPath)) continue
    stats.total += 1
    const result = parseJson<Record<string, any>>(fs.readFileSync(resultPath, 'utf8'), {})
    const hasContent = Boolean(
      String(result.problem_text || '').trim() ||
      String(result.answer || '').trim() ||
      String(result.analysis || '').trim()
    )
    if (result.ocr_status === 'parse_failed' || result.ocr_status === 'failed') {
      stats.failed += 1
    } else if (result.ocr_status === 'draft' && !hasContent) {
      stats.pending += 1
    } else if (hasContent) {
      stats.successful += 1
    } else {
      stats.pending += 1
    }
  }
  return stats
}

export function ocrFailureReasonsFromJobLog(runId: string) {
  const reasons = new Map<string, string>()
  const logPath = ocrJobLogPath(runId)
  if (!fs.existsSync(logPath)) return reasons
  const text = fs.readFileSync(logPath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(`| ${runId}`)) continue
    const cells = line.split('|').map((cell) => cell.trim())
    const id = cells[1] || ''
    const status = cells[11] || ''
    const reason = cells[12] || ''
    if (id && (status === 'failed' || status === 'parse_failed' || reason)) {
      reasons.set(id, reason || status)
    }
  }
  return reasons
}

export function ocrFailureReasonFromResult(result: Record<string, any>, fallback = '') {
  const post = result.post_processing && typeof result.post_processing === 'object' ? result.post_processing as Record<string, any> : {}
  const wholeError = post.whole_question_error && typeof post.whole_question_error === 'object' ? post.whole_question_error as Record<string, any> : {}
  return String(
    wholeError.error_reason ||
    wholeError.message ||
    result.ocr_error ||
    result.error_reason ||
    fallback ||
    'OCR 未生成可入库内容。'
  )
}

export function pendingBankOcrFailureItems(runId: string, importedIds: Set<string>, sourceTitle: string) {
  const draftsDir = path.join(pythonDataRoot, 'ocr_drafts')
  const reportReasons = ocrFailureReasonsFromJobLog(runId)
  const runStage = getRun(runId)?.stage || configuredGradeStages()[0] || '高三'
  const failures: Array<any> = []
  const reviewItems = getReviewItems(runId).filter((item) => item.reviewStatus === 'ready_for_ocr' && !importedIds.has(item.resultId))
  reviewItems.forEach((item, index) => {
    const resultPath = path.join(draftsDir, item.resultId, 'ocr_result.json')
    const result = fs.existsSync(resultPath)
      ? parseJson<Record<string, any>>(fs.readFileSync(resultPath, 'utf8'), {})
      : null
    const hasContent = result ? Boolean(
      String(result.problem_text || '').trim() ||
      String(result.answer || '').trim() ||
      String(result.analysis || '').trim()
    ) : false
    const status = String(result?.ocr_status || (result ? 'unknown' : 'missing'))
    if (result && status === 'draft' && hasContent) return
    const reason = result
      ? ocrFailureReasonFromResult(result, reportReasons.get(item.resultId))
      : (reportReasons.get(item.resultId) || 'OCR 请求未生成结果文件，可能是远端连接中断或任务异常结束。')
    const questionNo = cleanQuestionNoLabel(String(result?.question_no || item.questionLabel || ''))
    const sliceImagePath = stripAssetPrefix(item.autoImagePath || item.pageImagePath || String(result?.image_path || ''))
    failures.push({
      id: item.resultId,
      serialNo: Number.parseInt(questionNo, 10) || index + 1,
      questionNo,
      stage: runStage,
      questionType: 'OCR题',
      difficultyScore: 3,
      difficultyScore10: 5,
      difficultyLabel: difficultyLabel10(5),
      chapter: '待整理',
      knowledgePoints: [],
      solutionMethods: [],
      sourceTitle,
      bankStatus: 'blocked',
      stemMarkdown: '',
      answerText: '',
      analysisMarkdown: '',
      problemBlocks: [],
      answerBlocks: [],
      analysisBlocks: [],
      searchText: reason,
      sliceImagePath,
      ocrSegmentImages: [],
      figures: item.figures || [],
      sourceRunId: runId,
      sourceOcrProvider: getRun(runId)?.ocrProvider || 'legacy',
      sourceSolutionRunId: '',
      mergeStatus: '',
      mergeNote: '',
      createdAt: '',
      updatedAt: '',
      hasFigures: Boolean(item.figures?.length),
      pendingBankReadOnly: true,
      needsFormatReview: true,
      formatIssue: {
        field: 'ocr',
        code: status === 'missing' ? 'ocr_result_missing' : status || 'ocr_failed',
        message: reason,
        snippet: status === 'missing' ? '未生成 ocr_result.json' : `ocr_status: ${status}`,
      },
    })
  })
  return failures
}

export function ocrJobLogPath(runId: string) {
  return path.join(pythonDataRoot, 'ocr_jobs', `${runId}.log`)
}

export function tailText(filePath: string, limit = 6000) {
  if (!fs.existsSync(filePath)) return ''
  const stat = fs.statSync(filePath)
  const fd = fs.openSync(filePath, 'r')
  try {
    const length = Math.min(stat.size, limit)
    const buffer = Buffer.alloc(length)
    fs.readSync(fd, buffer, 0, length, Math.max(0, stat.size - length))
    return buffer.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

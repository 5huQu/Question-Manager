import fs from 'node:fs'
import path from 'node:path'
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
import { tryAutoMergeSeparatedExamForRun, formatIssueFromReviewJson } from './review.js'
import {
  cropFigureImage,
  loadCutResultRecord,
  normalizedFigureId,
  reviewSegmentReadingKey,
  reviewFigureReadingKey,
  answerOrAnalysisBoundary,
  reviewFigureDefaultUsage,
  expandedReviewBBox,
  reviewFigurePixelBBox,
  imageDimensions,
  figuresForImportedOcrResult,
  figuresForImportedOcrResultAsync,
  bindInlineImageReferences,
  sliceImagePathForOcrResult,
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

export function exportRunForMigratedOcr(runId: string) {
  ensureQuestionAssetLink()
  const run = getRun(runId)
  if (!run) throw new Error('批次不存在。')
  const items = getReviewItems(runId).filter((item) => item.reviewStatus === 'ready_for_ocr')
  if (!items.length) throw new Error('没有已通过复核的切片，请先提交切题复核。')
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
    const textRegions = sourceTextRegions.length
      ? normalizeOcrTextRegions(sourceTextRegions)
      : [
        { kind: 'problem', segments: reviewedSegments },
        { kind: 'answer', segments: reviewedSegments },
        { kind: 'analysis', segments: reviewedSegments },
      ]
    const reviewedPath = withQuestionAssetPrefix(item.autoImagePath || String(notePayload.reviewedImagePath || cutRecord?.auto_image_path || ''))
    return {
      id: item.resultId,
      source_pdf: String(notePayload.sourcePdf || `question_assets/${run.pdfPath}`),
      page: item.pageStart,
      page_span: [item.pageStart, item.pageEnd],
      question_no: item.questionLabel,
      material_type: run.materialType,
      reviewed_image_path: reviewedPath,
      auto_image_path: reviewedPath,
      reviewed_bbox: cutRecord?.bbox || item.bbox,
      auto_bbox: cutRecord?.bbox || item.bbox,
      reviewed_segments: reviewedSegments,
      segments: reviewedSegments,
      text_regions: textRegions,
      figures: Array.isArray((item as any).figures) ? (item as any).figures : (Array.isArray(cutRecord?.figures) ? cutRecord?.figures : []),
      original_question_id: String(notePayload.originalQuestionId || ''),
      original_source_run_id: String(notePayload.originalSourceRunId || ''),
      force_region_ocr: Boolean(notePayload.forceRegionOcr),
      status: 'ready_for_ocr',
      note: item.note,
    }
  })
  const payload = JSON.stringify({ results: records }, null, 2)
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
  if (!fs.existsSync(draftsDir)) return 0
  let imported = 0
  const entries = await fs.promises.readdir(draftsDir)
  for (const [index, entry] of entries.entries()) {
    if (!entry.startsWith(runId)) continue
    const resultPath = path.join(draftsDir, entry, 'ocr_result.json')
    if (!fs.existsSync(resultPath)) continue
    const result = JSON.parse(await fs.promises.readFile(resultPath, 'utf8')) as Record<string, any>
    const targetQuestionId = isQuestionBankRerun
      ? String(result.original_question_id || entry.split('__').slice(1).join('__') || result.id || '')
      : String(result.id || '')
    const questionNo = cleanQuestionNoLabel(String(result.question_no || ''))
    const localFigures = await figuresForImportedOcrResultAsync(result, runId)
    // Inline <img> references describe locations in the OCR text.  They must
    // bind exclusively to reviewed cut figures: GLM page-level images are
    // useful supplemental assets, but including them here makes an otherwise
    // unambiguous 1:1 cut look like a many-image mismatch.
    const inlineImages = bindInlineImageReferences(result, runId)
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
    const formatIssues = [inlineImages?.issue, ...validateQuestionMarkdown({ problem_text: stem, answer, analysis })].filter(Boolean) as Array<any>
    const needsFormatReview = Boolean(formatIssues.length)
    const formatReviewJson = needsFormatReview ? JSON.stringify(formatReviewPayload(formatIssues, nowIso())) : '{}'
    const isQuestionOnlyRun = normalizeFileRole(runRow?.file_role) === 'questions'
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
          isQuestionOnlyRun ? 1 : 0,
          isQuestionOnlyRun ? 'waiting_solution' : '',
          isQuestionOnlyRun ? '等待同组解析文件合并。' : '',
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
      mergeStatus: normalizeFileRole(runRow?.file_role) === 'questions' ? 'waiting_solution' : '',
      mergeNote: normalizeFileRole(runRow?.file_role) === 'questions' ? '等待同组解析文件合并。' : '',
      needsFormatReview,
      formatIssue: needsFormatReview ? formatIssueFromReviewJson(formatReviewJson) : undefined,
    })
    imported += 1
    if (index > 0 && index % 5 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
  }
  tryAutoMergeSeparatedExamForRun(runId)
  return imported
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
  const provider = runRow.ocr_provider === 'doc2x' || runRow.ocr_provider === 'glm' || runRow.ocr_provider === 'legacy'
    ? normalizeOcrProvider(runRow.ocr_provider)
    : normalizeOcrProvider(settings.ocrProvider)
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
    const pdfPath = resolveStoragePath(runRow.pdf_path)
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
    if (options.force === true) args.push('--force')
  } else if (provider === 'glm') {
    const artifactDir = glmArtifactDir(runRow)
    fs.mkdirSync(artifactDir, { recursive: true })
    const pdfPath = resolveStoragePath(runRow.pdf_path)
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

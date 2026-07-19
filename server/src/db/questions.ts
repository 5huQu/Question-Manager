import { db } from './connection.js'
import type { QuestionRow, BankStatus } from '../types/index.js'
import { duplicateSimilarityThreshold } from '../types/index.js'
import { formatIssueFromReviewJson, formatReviewPayload, validateQuestionMarkdown, type FormatIssue } from '../utils/validation.js'
import type { RichBlock } from '../types/index.js'
import { parseJson } from '../utils/json.js'
import { nowIso, createId } from '../utils/ids.js'
import {
  buildSearchText,
  jaccardSimilarity,
  textBigrams,
  stemPreview,
  difficultyLabel10,
  normalizeDifficultyScore10,
} from '../utils/search.js'
import {
  blocksToMarkdown,
  paragraphBlock,
  stripDoc2xNoiseComments,
} from '../utils/rich-content.js'
import { normalizeQuestionType } from '../utils/question-type.js'
import { assetPathFor, stripAssetPrefix } from '../utils/paths.js'
import { cleanSourceTitle, normalizeUploadName, ocrSegmentImages } from '../utils/ocr-helpers.js'
import { normalizeImportMetadata } from '../utils/import-metadata.js'
import { configuredGradeStages } from '../services/settings/app-settings.js'

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function normalizeTags(value: unknown) {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，、;/；\n]+/) : []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const item of raw) {
    const tag = String(item || '').replace(/\s+/g, ' ').trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return tags.slice(0, 8)
}

export type ScoringRubricItem = {
  label: string
  score: number
  text: string
}

export function normalizeTotalScore(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function normalizeScoringRubric(value: unknown): ScoringRubricItem[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? parseJson<unknown>(value, []) : []
  if (!Array.isArray(raw)) return []
  return raw.map((entry, index) => {
    if (entry && typeof entry === 'object') {
      const item = entry as Record<string, unknown>
      return {
        label: String(item.label ?? item.part ?? item.name ?? (index + 1)).trim(),
        score: normalizeTotalScore(item.score ?? item.points ?? item.value),
        text: String(item.text ?? item.description ?? item.criteria ?? '').trim(),
      }
    }
    return {
      label: String(index + 1),
      score: 0,
      text: String(entry ?? '').trim(),
    }
  }).filter((item) => item.label || item.score || item.text).slice(0, 20)
}

// ---------------------------------------------------------------------------
// mapQuestion
// ---------------------------------------------------------------------------

export function mapQuestion(row: QuestionRow) {
  const figures = parseJson<Array<Record<string, unknown>>>(row.figures_json, [])
  const solutionImageRow = db.prepare(`
    SELECT source_image_path
    FROM pdf_slicer_solution_items
    WHERE matched_question_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(row.id) as { source_image_path?: string } | undefined
  const knowledgePoints = parseJson<string[]>(row.knowledge_points_json || '[]', [])
  const solutionMethods = parseJson<string[]>(row.solution_methods_json || '[]', [])
  const stemMarkdown = row.stem_markdown || ''
  const answerText = row.answer_text || ''
  const analysisMarkdown = row.analysis_markdown || ''
  const questionType = normalizeQuestionType(row.question_type, stemMarkdown, answerText)
  const scoringRubric = normalizeScoringRubric(row.scoring_rubric_json || '[]')
  const { stage: _metadataStage, ...metadata } = normalizeImportMetadata({
    province: row.province,
    city: row.city,
    paper_title: row.paper_title,
    batch_name: row.batch_name,
    subject: row.subject,
    paper_kind: row.paper_kind,
    exam_year: row.exam_year,
    source_org: row.source_org,
  })
  return {
    id: row.id,
    serialNo: row.serial_no,
    questionNo: row.question_no,
    stage: row.stage,
    questionType,
    difficultyScore: row.difficulty_score,
    difficultyScore10: row.difficulty_score_10,
    difficultyLabel: row.difficulty_label || difficultyLabel10(row.difficulty_score_10),
    chapter: row.chapter,
    knowledgePoints,
    solutionMethods,
    sourceTitle: cleanSourceTitle(row.source_title),
    ...metadata,
    importSourceId: row.import_source_id || '',
    bankStatus: row.bank_status,
    stemMarkdown,
    answerText,
    analysisMarkdown,
    contentRevision: Number(row.content_revision || 1),
    totalScore: normalizeTotalScore(row.total_score),
    scoringRubric,
    problemBlocks: paragraphBlock(stemMarkdown),
    answerBlocks: paragraphBlock(answerText),
    analysisBlocks: paragraphBlock(analysisMarkdown),
    searchText: row.search_text || buildSearchText(stemMarkdown, answerText, analysisMarkdown),
    sliceImagePath: stripAssetPrefix(row.slice_image_path),
    solutionImagePath: stripAssetPrefix(solutionImageRow?.source_image_path || ''),
    ocrSegmentImages: ocrSegmentImages(row.id, { assetPathFor }),
    figures,
    sourceRunId: row.source_run_id,
    sourceOcrProvider: 'legacy',
    sourceSolutionRunId: row.source_solution_run_id,
    mergeStatus: row.merge_status,
    mergeNote: row.merge_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasFigures: figures.length > 0,
    needsFormatReview: Boolean(row.format_review_required),
    formatIssue: row.format_review_required ? formatIssueFromReviewJson(row.format_review_reasons_json) : undefined,
  }
}

// ---------------------------------------------------------------------------
// getQuestion
// ---------------------------------------------------------------------------

export function getQuestion(id: string) {
  const row = db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(id) as QuestionRow | undefined
  return row ? mapQuestion(row) : null
}

// ---------------------------------------------------------------------------
// createQuestion
// ---------------------------------------------------------------------------

export type PublicQuestion = ReturnType<typeof mapQuestion>

export function createQuestion(input: Record<string, any> = {}) {
  const now = nowIso()
  const id = input.id || createId('qb')
  const serial = db.prepare('SELECT COALESCE(MAX(serial_no), 0) + 1 AS next FROM question_bank_items').get() as { next: number }
  const requestedSerial = Number(input.serialNo)
  const serialNo = Number.isSafeInteger(requestedSerial) && requestedSerial > 0 ? requestedSerial : serial.next
  const stemMarkdown = stripDoc2xNoiseComments(String((input.stemMarkdown ?? blocksToMarkdown(input.problemBlocks ?? [])) || '请在右侧编辑 Markdown，录入题干内容。'))
  const answerText = stripDoc2xNoiseComments(String((input.answerText ?? blocksToMarkdown(input.answerBlocks ?? [])) || ''))
  const analysisMarkdown = stripDoc2xNoiseComments(String((input.analysisMarkdown ?? blocksToMarkdown(input.analysisBlocks ?? [])) || ''))
  const knowledgePoints = normalizeTags(input.knowledgePoints)
  const solutionMethods = normalizeTags(input.solutionMethods)
  const sourceTitle = input.sourceTitle || '手动创建'
  const chapter = input.chapter || knowledgePoints[0] || '知识点未设置'
  const metadata = normalizeImportMetadata(input)
  const validationIssues = validateQuestionMarkdown({ problem_text: stemMarkdown, answer: answerText, analysis: analysisMarkdown })
  const formatIssues = [...(input.formatIssue ? [input.formatIssue] : []), ...validationIssues]
  const needsFormatReview = Boolean(input.needsFormatReview || formatIssues.length)
  db.prepare(`
    INSERT INTO question_bank_items (
      id, serial_no, question_no, stage, question_type, difficulty_score, chapter, source_title, bank_status,
      province, city, paper_title, batch_name, subject, paper_kind, exam_year, source_org, import_source_id,
      difficulty_score_10, difficulty_label, knowledge_points_json, solution_methods_json, stem_markdown, answer_text, analysis_markdown, total_score, scoring_rubric_json, search_text, slice_image_path, figures_json, source_run_id, source_solution_run_id, merge_status, merge_note, format_review_required, format_review_reasons_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    serialNo,
    input.questionNo || String(serialNo),
    input.stage || configuredGradeStages()[0] || '高三',
    input.questionType || '未设题型',
    input.difficultyScore ?? 0,
    chapter,
    sourceTitle,
    needsFormatReview && (input.bankStatus || 'ready') === 'ready' ? 'blocked' : (input.bankStatus || 'ready'),
    metadata.province,
    metadata.city,
    metadata.paperTitle,
    metadata.batchName,
    metadata.subject,
    metadata.paperKind,
    metadata.examYear,
    metadata.sourceOrg,
    input.importSourceId || input.import_source_id || '',
    normalizeDifficultyScore10(input.difficultyScore10),
    input.difficultyLabel || difficultyLabel10(normalizeDifficultyScore10(input.difficultyScore10)),
    JSON.stringify(knowledgePoints),
    JSON.stringify(solutionMethods),
    stemMarkdown,
    answerText,
    analysisMarkdown,
    normalizeTotalScore(input.totalScore ?? input.total_score),
    JSON.stringify(normalizeScoringRubric(input.scoringRubric ?? input.scoring_rubric)),
    buildSearchText(stemMarkdown, answerText, analysisMarkdown, [sourceTitle, chapter, knowledgePoints.join(' '), solutionMethods.join(' ')]),
    input.sliceImagePath || '',
    JSON.stringify(input.figures || []),
    input.sourceRunId || '',
    input.sourceSolutionRunId || '',
    input.mergeStatus || '',
    input.mergeNote || '',
    needsFormatReview ? 1 : 0,
    needsFormatReview ? JSON.stringify(formatReviewPayload(formatIssues, now)) : '{}',
    now,
    now,
  )
  return getQuestion(id)
}

// ---------------------------------------------------------------------------
// Similar question detection
// ---------------------------------------------------------------------------

type SimilarQuestionCandidate = {
  id: string
  questionNo: string
  sourceTitle: string
  sourceRunId: string
  bankStatus: BankStatus
  similarity: number
  stemPreview: string
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  questionType: string
}

export function similarQuestionCandidates(row: QuestionRow, options: { threshold?: number; limit?: number } = {}): SimilarQuestionCandidate[] {
  const source = row.stem_markdown || row.search_text || ''
  const sourceBigrams = textBigrams(source)
  if (sourceBigrams.size < 8) return []
  const threshold = options.threshold ?? duplicateSimilarityThreshold
  const limit = options.limit ?? 3
  const candidates = db.prepare(`
    SELECT id, question_no, source_title, source_run_id, bank_status, stem_markdown, answer_text, analysis_markdown, question_type, search_text
    FROM question_bank_items
    WHERE id != ?
      AND bank_status IN ('ready', 'banked')
      AND TRIM(COALESCE(stem_markdown, '')) != ''
    ORDER BY updated_at DESC
    LIMIT 800
  `).all(row.id) as Array<Pick<QuestionRow, 'id' | 'question_no' | 'source_title' | 'source_run_id' | 'bank_status' | 'stem_markdown' | 'answer_text' | 'analysis_markdown' | 'question_type' | 'search_text'>>

  return candidates
    .map((candidate) => ({
      id: candidate.id,
      questionNo: candidate.question_no,
      sourceTitle: cleanSourceTitle(candidate.source_title),
      sourceRunId: candidate.source_run_id || '',
      bankStatus: candidate.bank_status,
      similarity: Number(jaccardSimilarity(sourceBigrams, textBigrams(candidate.stem_markdown || candidate.search_text || '')).toFixed(3)),
      stemPreview: stemPreview(candidate.stem_markdown || candidate.search_text || ''),
      stemMarkdown: candidate.stem_markdown || '',
      answerText: candidate.answer_text || '',
      analysisMarkdown: candidate.analysis_markdown || '',
      questionType: candidate.question_type || '',
    }))
    .filter((candidate) => candidate.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}

export function attachSimilarQuestions<T extends PublicQuestion>(item: T, row: QuestionRow): T & { similarQuestions: SimilarQuestionCandidate[] } {
  return {
    ...item,
    similarQuestions: item.bankStatus === 'banked' || item.bankStatus === 'skipped'
      ? []
      : similarQuestionCandidates(row),
  }
}

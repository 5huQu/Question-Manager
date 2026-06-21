import fs from 'node:fs'
import path from 'node:path'

import { pythonDataRoot } from '../config.js'
import { parseJson } from './json.js'
import {
  normalizeBlocks,
  normalizeInlines,
  inlineMarkdown,
  blocksToMarkdown,
} from './rich-content.js'
import { nowIso } from './ids.js'

// ── renderOcrDraftMarkdown ────────────────────────────────────────

/**
 * Render an OCR draft result object to a human-readable Markdown
 * file that can be stored alongside the raw JSON.
 */
export function renderOcrDraftMarkdown(result: Record<string, any>) {
  const lines = [
    '---',
    `id: ${result.id || ''}`,
    `source_pdf: ${result.source_pdf || ''}`,
    `page: ${result.page || ''}`,
    `question_no: ${result.question_no || ''}`,
    `ocr_status: ${result.ocr_status || 'draft'}`,
    `needs_human_review: ${Boolean(result.needs_human_review)}`,
    '---',
    '',
    '# 题目',
    '',
    String(result.problem_text || '').trim(),
    '',
    '# 答案',
    '',
    String(result.answer || '').trim(),
    '',
    '# 解析',
    '',
    String(result.analysis || '').trim(),
    '',
  ]
  return lines.join('\n')
}

// ── syncQuestionBankItemToOcrDraft ────────────────────────────────

/**
 * Write the current question-bank data back into the OCR draft
 * directory so the Markdown preview stays in sync with manual edits.
 *
 * Returns `true` when the draft was found and updated.
 */
export function syncQuestionBankItemToOcrDraft(
  item: Record<string, any> | null,
): boolean {
  if (!item?.id) return false
  const draftDir = path.join(pythonDataRoot, 'ocr_drafts', item.id)
  const resultPath = path.join(draftDir, 'ocr_result.json')
  if (!fs.existsSync(resultPath)) return false

  const result = parseJson<Record<string, any>>(fs.readFileSync(resultPath, 'utf8'), {})
  const nextResult = {
    ...result,
    id: result.id || item.id,
    question_no: item.questionNo,
    problem_text: item.stemMarkdown,
    answer: item.answerText,
    analysis: item.analysisMarkdown,
    knowledge_points: item.knowledgePoints,
    solution_methods: item.solutionMethods,
    difficulty_score_10: item.difficultyScore10,
    difficulty_label: item.difficultyLabel,
    post_processing: {
      ...(result.post_processing && typeof result.post_processing === 'object' ? result.post_processing : {}),
      question_bank_manual_edit: {
        synced_at: nowIso(),
      },
    },
  }
  fs.writeFileSync(resultPath, JSON.stringify(nextResult, null, 2), 'utf8')
  fs.writeFileSync(path.join(draftDir, 'question.md'), renderOcrDraftMarkdown(nextResult), 'utf8')
  return true
}

// ── syncRunQuestionBankItemsToOcrDrafts ───────────────────────────

/**
 * Sync every question-bank item belonging to *runId* back to its OCR
 * draft directory.  Accepts a **callback** that looks up the item by
 * id (e.g. from the DB) so this utility stays free of a direct DB
 * dependency.
 *
 * @returns Number of successfully synced items.
 */
export function syncRunQuestionBankItemsToOcrDrafts(
  runId: string,
  options: { getItem: (id: string) => Record<string, any> | null; listItemIds: (runId: string) => string[] },
): number {
  const { getItem, listItemIds } = options
  const ids = listItemIds(runId)
  let synced = 0
  for (const id of ids) {
    if (syncQuestionBankItemToOcrDraft(getItem(id))) synced += 1
  }
  return synced
}

// ── ocrSegmentImages ──────────────────────────────────────────────

/**
 * Walk the region-OCR segment directories for a question and return
 * an ordered list of image descriptors (kind, label, asset-path).
 */
export function ocrSegmentImages(
  questionId: string,
  options: { assetPathFor: (absPath: string) => string },
) {
  const { assetPathFor } = options
  const baseDir = path.join(pythonDataRoot, 'ocr_drafts', questionId, 'region_ocr')
  const kinds = [
    ['problem', '题干'],
    ['answer', '答案'],
    ['analysis', '解析'],
  ] as const

  return kinds.flatMap(([kind, label]) => {
    const segmentDir = path.join(baseDir, kind, 'segments')
    if (!fs.existsSync(segmentDir)) return []

    return fs.readdirSync(segmentDir)
      .filter((name) => name.toLowerCase().endsWith('.png'))
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))
      .map((name, index) => ({
        kind,
        label: `${label}分块 ${index + 1}`,
        path: assetPathFor(path.join(segmentDir, name)),
      }))
  })
}

// ── normalizeOcrSegment ───────────────────────────────────────────

/**
 * Normalize a single OCR segment record, prefixing its page image
 * path with the `question_assets/` prefix.
 */
export function normalizeOcrSegment(
  segment: Record<string, any>,
  options: { withQuestionAssetPrefix: (value: string) => string },
) {
  return {
    ...segment,
    page_image_path: options.withQuestionAssetPrefix(String(segment.page_image_path || '')),
  }
}

// ── normalizeOcrTextRegions ───────────────────────────────────────

/**
 * Normalize an array of OCR text regions, recursively normalizing
 * the `segments` array inside each region.
 */
export function normalizeOcrTextRegions(
  regions: Array<Record<string, any>>,
  options: { withQuestionAssetPrefix: (value: string) => string },
) {
  return regions.map((region) => ({
    ...region,
    segments: Array.isArray(region.segments) ? region.segments.map((s) => normalizeOcrSegment(s, options)) : [],
  }))
}

// ── normalizeUploadName ───────────────────────────────────────────

/**
 * Decode a filename that may have been mangled by Latin-1 / UTF-8
 * mis-encoding during upload.  Returns the decoded UTF-8 string when
 * the original name looks like garbage and the decoded form contains
 * CJK characters; otherwise returns the original.
 */
export function normalizeUploadName(originalName: string): string {
  const decoded = Buffer.from(originalName, 'latin1').toString('utf8')
  return /[À-ÿ]/.test(originalName) && /[一-鿿]/.test(decoded) ? decoded : originalName
}

// ── cleanSourceTitle ──────────────────────────────────────────────

/**
 * Derive a human-readable source title from a file path / URL value.
 * Strips the `question_assets/` prefix, extracts the basename, and
 * removes the file extension.
 */
export function cleanSourceTitle(value: string, fallback = '来源待补充'): string {
  const raw = stripAssetPrefix(String(value || '').trim())
  if (!raw) return fallback
  return normalizeUploadName(path.basename(raw)).replace(/\.[^.]+$/, '') || fallback
}

// ── cleanQuestionNoLabel ──────────────────────────────────────────

const semanticExerciseLabelPattern = /^\s*(?:[【［\[]\s*)?(?:第\s*)?(?:典例|例题|变式|即学即练|即学即练习|课堂练习|限时训练|课后训练|巩固训练|能力提升)\s*(?:\d+|[一二三四五六七八九十]+)?(?:\s*[-—–_·：:、.．]\s*(?:\d+|[一二三四五六七八九十]+))?\s*(?:题)?\s*(?:[】］\]]\s*)?/u
const semanticQuestionNoPattern = /^\s*(?:第\s*)?(?:典例|例题|变式|即学即练|即学即练习|课堂练习|限时训练|课后训练|巩固训练|能力提升)\s*((?:\d+|[一二三四五六七八九十]+)(?:\s*[-—–_]\s*(?:\d+|[一二三四五六七八九十]+))?)\s*(?:题)?\s*$/u

function stripSemanticExerciseLabel(value: string) {
  return String(value || '').replace(semanticExerciseLabelPattern, '').trimStart()
}

/**
 * Normalize a question-number label by extracting the numeric portion
 * from common Chinese exercise patterns (e.g. "例题 1" -> "1").
 */
export function cleanQuestionNoLabel(value: string): string {
  const raw = String(value || '').trim()
  const semanticMatch = raw.match(semanticQuestionNoPattern)
  if (semanticMatch?.[1]) return semanticMatch[1].replace(/\s+/g, '')
  const cleaned = stripSemanticExerciseLabel(raw).replace(/^\s*第\s*/, '').replace(/\s*题\s*$/u, '').trim()
  return cleaned || raw
}

// ── comparableQuestionNo ──────────────────────────────────────────

/**
 * Normalize a question number for comparison purposes (strip
 * trailing punctuation and whitespace).
 */
export function comparableQuestionNo(value: unknown): string {
  return cleanQuestionNoLabel(String(value || ''))
    .replace(/\s+/g, '')
    .replace(/[.．、:：）)]$/u, '')
}

// ── Material / file-role type normalisers ─────────────────────────

export type MaterialType = 'exam' | 'lecture' | 'unknown'
export type FileRole = 'full' | 'questions' | 'solutions' | 'unknown'
export type WorkflowMode = 'single' | 'separated_exam'
export type WorkflowStatus = 'ready' | 'needs_classification' | 'processing' | 'ready_for_bank' | 'needs_review'

export function normalizeMaterialType(value: unknown): MaterialType {
  return (['exam', 'lecture', 'unknown'] as string[]).includes(String(value))
    ? String(value) as MaterialType
    : 'unknown'
}

export function normalizeFileRole(value: unknown): FileRole {
  return (['full', 'questions', 'solutions', 'unknown'] as string[]).includes(String(value))
    ? String(value) as FileRole
    : 'unknown'
}

export function normalizeWorkflowMode(value: unknown): WorkflowMode {
  return String(value) === 'separated_exam' ? 'separated_exam' : 'single'
}

export function normalizeWorkflowStatus(value: unknown): WorkflowStatus {
  return (['ready', 'needs_classification', 'processing', 'ready_for_bank', 'needs_review'] as string[]).includes(String(value))
    ? String(value) as WorkflowStatus
    : 'ready'
}

// ── Label helpers ─────────────────────────────────────────────────

export function materialTypeLabelForReason(value: MaterialType): string {
  return value === 'exam' ? '试卷' : value === 'lecture' ? '讲义' : '未确认'
}

export function fileRoleLabelForReason(value: FileRole): string {
  if (value === 'questions') return '原卷'
  if (value === 'solutions') return '解析文件'
  if (value === 'full') return '解析版一体'
  return '未确认'
}

// ── internal helpers ──────────────────────────────────────────────

export function stripAssetPrefix(value: string): string {
  return value.replace(/^question_assets\//, '').replace(/^\/+/, '')
}

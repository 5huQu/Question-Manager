import fs from 'node:fs'
import { db } from '../../db/connection.js'
import { nowIso, createId } from '../../utils/ids.js'
import { parseJson } from '../../utils/json.js'
import { normalizeBlocks, blocksToMarkdown } from '../../utils/rich-content.js'
import { buildSearchText } from '../../utils/search.js'
import { normalizeQuestionType, inferQuestionType, stripLeadingQuestionNo } from '../../utils/question-type.js'
import {
  cleanSourceTitle,
  cleanQuestionNoLabel,
  comparableQuestionNo,
  stripAssetPrefix,
} from '../../utils/ocr-helpers.js'
import { normalizeTags } from '../../services/tags/tag-libraries.js'
import { normalizeDifficultyScore10, difficultyLabel10 } from '../../utils/search.js'
import { getQuestion, mapQuestion, createQuestion } from '../../db/questions.js'
import { getRun, updateBatchWorkflow } from '../../db/runs.js'
import { getReviewItems, syncReviewRunCounts } from '../../db/review.js'
import { getCollection, refreshCollectionScore } from '../../db/collections.js'
import { figuresForImportedOcrResult, figuresForSolutionItem } from '../../utils/figure-helpers.js'
import { resolveStoragePath } from '../../utils/paths.js'

function mergeImportedFigures(...groups: Array<Array<Record<string, unknown>>>) {
  const merged: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  for (const figure of groups.flat()) {
    const figurePath = stripAssetPrefix(String(figure.path || ''))
    if (!figurePath || !fs.existsSync(resolveStoragePath(figurePath))) continue
    const key = [
      String(figure.usage || figure.category || ''),
      figurePath,
      JSON.stringify(figure.bbox || {}),
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({ ...figure, path: figurePath })
  }
  return merged
}

/**
 * Import JSON-format questions from a slice run.  Validates that the number
 * of questions matches the review items and that IDs do not already exist,
 * then creates question_bank_items (and optionally a collection).
 */
export function importJsonQuestionsFromSliceRun(
  runId: string,
  questions: Array<Record<string, unknown>>,
  options: { sourceTitle?: string; stage?: string; createCollection?: boolean } = {},
) {
  const run = getRun(runId)
  if (!run) {
    const error = new Error('切分批次不存在。')
    ;(error as Error & { status?: number }).status = 404
    throw error
  }
  const reviewItems = getReviewItems(runId)
  if (!reviewItems.length) {
    const error = new Error('当前切分批次没有可绑定的题块。')
    ;(error as Error & { status?: number }).status = 400
    throw error
  }
  if (questions.length !== reviewItems.length) {
    const error = new Error(
      `JSON 题目数量为 ${questions.length}，切分题块数量为 ${reviewItems.length}，请先修正后再导入。`,
    )
    ;(error as Error & { status?: number }).status = 400
    throw error
  }

  const mismatches = questions.flatMap((question, index) => {
    const jsonNo = comparableQuestionNo(question.question_no ?? question.questionNo ?? index + 1)
    const sliceNo = comparableQuestionNo(reviewItems[index]?.questionLabel || index + 1)
    return jsonNo && sliceNo && jsonNo !== sliceNo
      ? [
          {
            index: index + 1,
            sliceQuestionNo: reviewItems[index]?.questionLabel || '',
            jsonQuestionNo: String(question.question_no ?? question.questionNo ?? ''),
          },
        ]
      : []
  })
  if (mismatches.length) {
    const error = new Error(`有 ${mismatches.length} 道题号与切分题块不一致，请确认后再导入。`)
    ;(error as Error & { status?: number; details?: unknown }).status = 400
    ;(error as Error & { status?: number; details?: unknown }).details = { mismatches }
    throw error
  }

  const duplicateIds = reviewItems
    .map((item) => item.resultId)
    .filter((id) => db.prepare('SELECT id FROM question_bank_items WHERE id = ?').get(id))
  if (duplicateIds.length) {
    const error = new Error(`已有 ${duplicateIds.length} 个题块导入过题库，请勿重复导入。`)
    ;(error as Error & { status?: number; details?: unknown }).status = 409
    ;(error as Error & { status?: number; details?: unknown }).details = { duplicateIds }
    throw error
  }

  const sourceTitle = cleanSourceTitle(options.sourceTitle || run.paperTitle || run.pdfName || '', run.pdfName || '切分题块导入')
  const stage = String(options.stage || '高三')
  const now = nowIso()
  const collectionId = options.createCollection === false ? '' : createId('paper', sourceTitle)
  const created: Array<Record<string, unknown>> = []
  const solutionRows = db.prepare('SELECT * FROM pdf_slicer_solution_items WHERE source_run_id = ? ORDER BY created_at ASC').all(runId) as Array<Record<string, unknown>>
  const solutionsByNo = new Map<string, Record<string, unknown>>()
  for (const solution of solutionRows) {
    const key = comparableQuestionNo(solution.question_no)
    if (key && !solutionsByNo.has(key)) solutionsByNo.set(key, solution)
  }

  const insertCollectionItem = db.prepare(`
    INSERT OR IGNORE INTO question_bank_collection_items
      (id, collection_id, question_id, sort_order, score, section_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  db.exec('BEGIN')
  try {
    if (collectionId) {
      db.prepare(`
        INSERT INTO question_bank_collections
          (id, title, subtitle, description, kind, status, total_score, time_limit, export_format, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'paper', 'draft', 0, 0, 'markdown', ?, ?)
      `).run(collectionId, sourceTitle, '', `由切分题块 ${runId} 与用户粘贴 JSON 顺序绑定导入。`, now, now)
    }
    for (const [index, question] of questions.entries()) {
      const reviewItem = reviewItems[index]
      const review = Boolean(question.needs_human_review)
      const questionNo = cleanQuestionNoLabel(
        String(question.question_no ?? question.questionNo ?? reviewItem.questionLabel ?? index + 1),
      )
      const stemMarkdown = String(question.problem_text || question.stemMarkdown || question.problemText || '')
      const answerText = String(question.answer || question.answerText || '')
      const analysisMarkdown = String(question.analysis || question.analysisMarkdown || question.analysisText || '')
      const stemFigures = figuresForImportedOcrResult({ id: reviewItem.resultId, image_path: reviewItem.autoImagePath, figures: question.figures }, runId)
      const solution = solutionsByNo.get(comparableQuestionNo(reviewItem.questionLabel || questionNo))
      const solutionFigures = solution ? figuresForSolutionItem(solution, reviewItem.resultId) : []
      const figures = mergeImportedFigures(stemFigures, solutionFigures)
      const knowledgePoints = normalizeTags(
        (question as Record<string, unknown>).knowledge_points ??
          (question as Record<string, unknown>).knowledgePoints,
      )
      const solutionMethods = normalizeTags(
        (question as Record<string, unknown>).solution_methods ??
          (question as Record<string, unknown>).solutionMethods,
      )
      const difficultyScore10 = normalizeDifficultyScore10(
        (question as Record<string, unknown>).difficulty_score_10 ??
          (question as Record<string, unknown>).difficultyScore10,
      )
      const item = createQuestion({
        id: reviewItem.resultId,
        questionNo,
        stage,
        questionType:
          String(question.question_type || question.questionType || '') ||
          inferQuestionType(stemMarkdown, answerText),
        difficultyScore: review ? 4 : 3,
        difficultyScore10,
        difficultyLabel: String(question.difficulty_label || question.difficultyLabel || difficultyLabel10(difficultyScore10)),
        chapter: knowledgePoints[0] || '待整理',
        knowledgePoints,
        solutionMethods,
        sourceTitle,
        bankStatus: review ? 'blocked' : 'ready',
        stemMarkdown,
        answerText,
        analysisMarkdown,
        sliceImagePath: stripAssetPrefix(reviewItem.autoImagePath || reviewItem.pageImagePath || ''),
        figures,
        sourceRunId: runId,
        needsFormatReview: review,
        formatIssue: review
          ? { field: 'system', code: 'needs_human_review', message: '用户粘贴 JSON 标记需要人工复核。', snippet: '' }
          : undefined,
      })
      if (item) created.push(item)
      if (collectionId) {
        insertCollectionItem.run(createId('rel'), collectionId, item?.id || reviewItem.resultId, index + 1, 0, '', now)
      }
    }
    if (collectionId) refreshCollectionScore(collectionId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const targetCount = run.approvedQuestions || run.totalQuestions || reviewItems.length
  if (created.length >= targetCount) {
    db.prepare(`
      UPDATE pdf_slicer_runs
      SET ocr_status = 'succeeded',
          ocr_error = '',
          ocr_started_at = COALESCE(NULLIF(ocr_started_at, ''), ?),
          ocr_finished_at = ?,
          updated_at = ?
      WHERE run_id = ?
    `).run(now, now, now, runId)
    updateBatchWorkflow(run.batchId)
  }

  return {
    items: created,
    count: created.length,
    collection: collectionId ? getCollection(collectionId) : null,
    pendingBankUrl: `/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/pending-bank`,
  }
}

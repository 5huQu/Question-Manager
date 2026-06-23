import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from '../../config.js'
import { stripAssetPrefix } from '../../utils/paths.js'
import { cleanSourceTitle, cleanQuestionNoLabel, syncQuestionBankItemToOcrDraft } from '../../utils/ocr-helpers.js'
import { inferQuestionType } from '../../utils/question-type.js'
import { normalizeDifficultyScore10, difficultyLabel10 } from '../../utils/search.js'
import { normalizeTags } from '../tags/tag-libraries.js'
import { readOcrSettings } from '../settings/ocr-settings.js'
import { normalizeOcrProvider, createPendingBankRerunTask, startMigratedOcrBackground, pendingBankOcrFailureItems } from './ocr.js'
import { blocksToMarkdown } from '../../utils/rich-content.js'
import { RouteError } from '../../utils/http-error.js'
import * as repo from '../../repositories/pdf-slicer/pending-bank.repo.js'

export function listPendingBank(runId: string, query: Record<string, unknown>) {
  const run = repo.getRun(runId)
  if (!run) throw new RouteError(404, '批次不存在。')
  const filter = String(query.filter || 'all')
  const allRows = repo.questionRowsForRun(runId)
  const importedIds = new Set(allRows.map((row) => row.id))
  const sourceTitle = cleanSourceTitle(run.paperTitle || run.pdfName || '', run.pdfName || 'OCR 导入')
  const allItems = [...allRows.map((row) => repo.attachSimilarQuestions(repo.mapQuestion(row), row)), ...pendingBankOcrFailureItems(runId, importedIds, sourceTitle)]
  const summary = { total: allItems.length, ready: 0, blocked: 0, banked: 0, skipped: 0, ocrFailed: 0, hasFigures: 0 }
  const isOcrFailed = (item: ReturnType<typeof repo.mapQuestion>) => !item.stemMarkdown || item.stemMarkdown.trim() === ''
  const needsReview = (item: ReturnType<typeof repo.mapQuestion>) => {
    if (item.bankStatus === 'banked' || item.bankStatus === 'skipped') return false
    return isOcrFailed(item) || item.bankStatus === 'blocked'
  }
  const isReady = (item: ReturnType<typeof repo.mapQuestion>) => item.bankStatus === 'ready' && !isOcrFailed(item)
  for (const item of allItems) {
    if (isOcrFailed(item)) summary.ocrFailed += 1
    if (item.hasFigures) summary.hasFigures += 1
    if (isReady(item)) summary.ready += 1
    else if (needsReview(item)) summary.blocked += 1
    else if (item.bankStatus === 'banked') summary.banked += 1
    else if (item.bankStatus === 'skipped') summary.skipped += 1
  }
  let filtered = allItems
  if (filter === 'ready') filtered = allItems.filter(isReady)
  else if (filter === 'blocked') filtered = allItems.filter(needsReview)
  else if (filter === 'banked') filtered = allItems.filter((item) => item.bankStatus === 'banked')
  else if (filter === 'skipped') filtered = allItems.filter((item) => item.bankStatus === 'skipped')
  else if (filter === 'ocr_failed') filtered = allItems.filter(isOcrFailed)
  else if (filter === 'has_figures') filtered = allItems.filter((item) => item.hasFigures)
  const statusOrder: Record<string, number> = { blocked: 0, ready: 1, banked: 2, skipped: 3 }
  filtered.sort((a, b) => {
    const aOrder = needsReview(a) ? 0 : (statusOrder[a.bankStatus] ?? 1)
    const bOrder = needsReview(b) ? 0 : (statusOrder[b.bankStatus] ?? 1)
    if (aOrder !== bOrder) return aOrder - bOrder
    return (a.serialNo || 0) - (b.serialNo || 0)
  })
  return { run, summary, items: filtered }
}

export function saveManualCandidate(runId: string, body: Record<string, any>) {
  const run = repo.getRun(runId)
  if (!run) throw new RouteError(404, '批次不存在。')
  const itemBody = body?.item || {}
  const id = String(itemBody.id || '').trim()
  if (!id) throw new RouteError(400, '缺少题目 ID。')
  const existing = repo.getQuestion(id)
  if (existing) return { status: 200, item: existing }
  const reviewItem = repo.getReviewItems(runId).find((entry) => entry.resultId === id)
  if (!reviewItem) throw new RouteError(404, '当前题目缺少原始切题记录。')
  const sourceTitle = cleanSourceTitle(run.paperTitle || run.pdfName || '', run.pdfName || 'OCR 导入')
  const stemMarkdown = String((itemBody.stemMarkdown ?? blocksToMarkdown(itemBody.problemBlocks ?? [])) || '').trim()
  const answerText = String((itemBody.answerText ?? blocksToMarkdown(itemBody.answerBlocks ?? [])) || '').trim()
  const analysisMarkdown = String((itemBody.analysisMarkdown ?? blocksToMarkdown(itemBody.analysisBlocks ?? [])) || '').trim()
  try {
    const item = repo.createQuestion({ id, serialNo: Number.parseInt(String(itemBody.serialNo || ''), 10) || undefined, questionNo: cleanQuestionNoLabel(String(itemBody.questionNo || reviewItem.questionLabel || '')), stage: String(itemBody.stage || '高三'), questionType: itemBody.questionType && itemBody.questionType !== 'OCR题' ? String(itemBody.questionType) : inferQuestionType(stemMarkdown, answerText), difficultyScore: Number(itemBody.difficultyScore ?? 3), difficultyScore10: normalizeDifficultyScore10(itemBody.difficultyScore10), difficultyLabel: itemBody.difficultyLabel || difficultyLabel10(normalizeDifficultyScore10(itemBody.difficultyScore10)), chapter: itemBody.chapter || '待整理', knowledgePoints: normalizeTags(itemBody.knowledgePoints), solutionMethods: normalizeTags(itemBody.solutionMethods), sourceTitle, bankStatus: 'ready', stemMarkdown, answerText, analysisMarkdown, sliceImagePath: stripAssetPrefix(String(itemBody.sliceImagePath || reviewItem.autoImagePath || reviewItem.pageImagePath || '')), figures: Array.isArray(itemBody.figures) ? itemBody.figures : reviewItem.figures, sourceRunId: runId, sourceSolutionRunId: '', mergeStatus: '', mergeNote: '', needsFormatReview: false })
    if (!item) throw new Error('题目创建失败。')
    syncQuestionBankItemToOcrDraft(repo.getQuestion(id))
    return { status: 201, item: repo.getQuestion(id) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new RouteError(500, `手动候选保存失败：${message}`)
  }
}

export function rerunPendingBankOcr(runId: string, id: string, body: Record<string, any>) {
  const sourceRun = repo.getRun(runId)
  if (sourceRun?.ocrProvider === 'doc2x' || normalizeOcrProvider(readOcrSettings().ocrProvider) === 'doc2x') throw new RouteError(400, 'Doc2X 首版仅支持整批完全重跑，暂不支持单题重新 OCR。')
  const route = String(body?.route || 'whole_question_json')
  const forceRegionOcr = route === 'region_chunks'
  try {
    const task = createPendingBankRerunTask(runId, id, { forceRegionOcr })
    repo.markRerunRunning(task.runId)
    startMigratedOcrBackground(task.runId)
    return { ...task, route: forceRegionOcr ? 'region_chunks' : 'whole_question_json', message: forceRegionOcr ? '已启动当前题分块 OCR。' : '已启动当前题整图 OCR。' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new RouteError(500, `待入库单题重新 OCR 启动失败：${message}`)
  }
}

export function bulkConfirm(runId: string, body: Record<string, any>) {
  if (!repo.getRun(runId)) throw new RouteError(404, '批次不存在。')
  const questionIds: string[] = Boolean(body?.all) ? repo.confirmableQuestionIds(runId) : body?.questionIds || []
  if (!questionIds.length) return { success: 0, failed: 0 }
  const warnings: string[] = []
  const bankedUpdates: Array<{ id: string; questionNo: string }> = []
  let success = 0
  let failed = 0
  for (const id of questionIds) {
    const row = repo.questionRowForRun(id, runId)
    if (!row) { failed += 1; continue }
    const review = JSON.parse(row.format_review_reasons_json || '{}') as { issue?: { code?: string; message?: string }; importBlockingIssues?: Array<{ code?: string; message?: string }> }
    if (review.importBlockingIssues?.length) { warnings.push(`第 ${row.question_no || id} 题存在公式或格式问题；请修复后再入库。`); failed += 1; continue }
    if (review.issue?.code === 'inline_image_reference_mismatch' && !body?.confirmImageReview) { warnings.push(`第 ${row.question_no || id} 题题图引用数量不一致；请在待入库页确认后再入库。`); failed += 1; continue }
    if (row.bank_status === 'blocked') warnings.push(`题目 ${id} 仍存在识别风险。`)
    const similar = repo.similarQuestionCandidates(row, { limit: 2 })
    if (similar.length) {
      const label = row.question_no ? `第 ${row.question_no} 题` : id
      warnings.push(`${label} 可能与题库中 ${similar.map((item) => `${item.questionNo || item.id}（${Math.round(item.similarity * 100)}%）`).join('、')} 重复。`)
    }
    bankedUpdates.push({ id, questionNo: cleanQuestionNoLabel(row.question_no) })
    success += 1
  }
  repo.markQuestionsBanked(bankedUpdates)
  return { success, failed, warnings: warnings.length ? warnings : undefined }
}

export function bulkSkip(runId: string, body: Record<string, any>) {
  if (!repo.getRun(runId)) throw new RouteError(404, '批次不存在。')
  const questionIds: string[] = body?.questionIds || []
  if (!questionIds.length) throw new RouteError(400, '请指定要跳过的题目。')
  const skippedIds: string[] = []
  let success = 0
  let failed = 0
  for (const id of questionIds) {
    if (!repo.questionExistsInRun(id, runId)) { failed += 1; continue }
    skippedIds.push(id)
    success += 1
  }
  repo.markQuestionsSkipped(skippedIds)
  return { success, failed }
}

export function bulkDelete(runId: string, body: Record<string, any>) {
  if (!repo.getRun(runId)) throw new RouteError(404, '批次不存在。')
  const questionIds: string[] = body?.questionIds || []
  if (!questionIds.length) throw new RouteError(400, '请指定要删除的题目。')
  try {
    const result = repo.deleteQuestions(runId, questionIds, (id) => fs.rmSync(path.join(dataDir, 'question_figures', id), { recursive: true, force: true }))
    if (result.success > 0) repo.syncReviewRunCounts(runId)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new RouteError(500, `删除题目失败：${message}`)
  }
}

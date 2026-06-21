import fs from 'node:fs'
import path from 'node:path'
import type { Express } from 'express'
import { db } from '../../db/connection.js'
import { getRun } from '../../db/runs.js'
import { getQuestion, mapQuestion, createQuestion, similarQuestionCandidates, attachSimilarQuestions } from '../../db/questions.js'
import { getReviewItems, syncReviewRunCounts } from '../../db/review.js'
import { nowIso } from '../../utils/ids.js'
import { stripAssetPrefix } from '../../utils/paths.js'
import { cleanSourceTitle, cleanQuestionNoLabel, syncQuestionBankItemToOcrDraft } from '../../utils/ocr-helpers.js'
import { inferQuestionType } from '../../utils/question-type.js'
import { normalizeDifficultyScore10, difficultyLabel10 } from '../../utils/search.js'
import { normalizeTags } from '../../services/tags/tag-libraries.js'
import { readOcrSettings } from '../../services/settings/ocr-settings.js'
import { normalizeOcrProvider, createPendingBankRerunTask, startMigratedOcrBackground, pendingBankOcrFailureItems } from '../../services/pdf-slicer/ocr.js'
import { blocksToMarkdown } from '../../utils/rich-content.js'
import type { QuestionRow } from '../../types/index.js'
import { dataDir } from '../../config.js'

export function mountPendingBankRoutes(app: Express) {
  app.get('/api/tools/pdf-slicer/runs/:runId/pending-bank', (req, res) => {
    const runId = req.params.runId
    const run = getRun(runId)
    if (!run) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const filter = String(req.query.filter || 'all')
    const allRows = db.prepare('SELECT * FROM question_bank_items WHERE source_run_id = ? ORDER BY serial_no ASC').all(runId) as QuestionRow[]
    const importedIds = new Set(allRows.map((row) => row.id))
    const sourceTitle = cleanSourceTitle(run.paperTitle || run.pdfName || '', run.pdfName || 'OCR 导入')
    const allItems = [
      ...allRows.map((row) => attachSimilarQuestions(mapQuestion(row), row)),
      ...pendingBankOcrFailureItems(runId, importedIds, sourceTitle),
    ]

    const summary = { total: allItems.length, ready: 0, blocked: 0, banked: 0, skipped: 0, ocrFailed: 0, hasFigures: 0 }
    const isOcrFailed = (item: ReturnType<typeof mapQuestion>) => !item.stemMarkdown || item.stemMarkdown.trim() === ''
    const needsReview = (item: ReturnType<typeof mapQuestion>) => {
      if (item.bankStatus === 'banked' || item.bankStatus === 'skipped') return false
      return isOcrFailed(item) || item.bankStatus === 'blocked'
    }
    const isReady = (item: ReturnType<typeof mapQuestion>) => item.bankStatus === 'ready' && !isOcrFailed(item)

    for (const item of allItems) {
      if (isOcrFailed(item)) {
        summary.ocrFailed += 1
      }
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

    res.json({ run, summary, items: filtered })
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/pending-bank/manual-candidate', (req, res) => {
    const runId = req.params.runId
    const run = getRun(runId)
    if (!run) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const body = req.body?.item || {}
    const id = String(body.id || '').trim()
    if (!id) {
      res.status(400).json({ error: '缺少题目 ID。' })
      return
    }
    if (getQuestion(id)) {
      res.json(getQuestion(id))
      return
    }
    const reviewItem = getReviewItems(runId).find((entry) => entry.resultId === id)
    if (!reviewItem) {
      res.status(404).json({ error: '当前题目缺少原始切题记录。' })
      return
    }
    const sourceTitle = cleanSourceTitle(run.paperTitle || run.pdfName || '', run.pdfName || 'OCR 导入')
    const stemMarkdown = String((body.stemMarkdown ?? blocksToMarkdown(body.problemBlocks ?? [])) || '').trim()
    const answerText = String((body.answerText ?? blocksToMarkdown(body.answerBlocks ?? [])) || '').trim()
    const analysisMarkdown = String((body.analysisMarkdown ?? blocksToMarkdown(body.analysisBlocks ?? [])) || '').trim()
    try {
      const item = createQuestion({
        id,
        serialNo: Number.parseInt(String(body.serialNo || ''), 10) || undefined,
        questionNo: cleanQuestionNoLabel(String(body.questionNo || reviewItem.questionLabel || '')),
        stage: String(body.stage || '高三'),
        questionType: body.questionType && body.questionType !== 'OCR题' ? String(body.questionType) : inferQuestionType(stemMarkdown, answerText),
        difficultyScore: Number(body.difficultyScore ?? 3),
        difficultyScore10: normalizeDifficultyScore10(body.difficultyScore10),
        difficultyLabel: body.difficultyLabel || difficultyLabel10(normalizeDifficultyScore10(body.difficultyScore10)),
        chapter: body.chapter || '待整理',
        knowledgePoints: normalizeTags(body.knowledgePoints),
        solutionMethods: normalizeTags(body.solutionMethods),
        sourceTitle,
        bankStatus: 'ready',
        stemMarkdown,
        answerText,
        analysisMarkdown,
        sliceImagePath: stripAssetPrefix(String(body.sliceImagePath || reviewItem.autoImagePath || reviewItem.pageImagePath || '')),
        figures: Array.isArray(body.figures) ? body.figures : reviewItem.figures,
        sourceRunId: runId,
        sourceSolutionRunId: '',
        mergeStatus: '',
        mergeNote: '',
        needsFormatReview: false,
      })
      if (!item) throw new Error('题目创建失败。')
      syncQuestionBankItemToOcrDraft(getQuestion(id))
      res.status(201).json(getQuestion(id))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.status(500).json({ error: `手动候选保存失败：${message}` })
    }
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/pending-bank/:id/rerun-ocr', (req, res) => {
    const runId = req.params.runId
    const sourceRun = getRun(runId)
    if (sourceRun?.ocrProvider === 'doc2x' || normalizeOcrProvider(readOcrSettings().ocrProvider) === 'doc2x') {
      res.status(400).json({ error: 'Doc2X 首版仅支持整批完全重跑，暂不支持单题重新 OCR。' })
      return
    }
    const id = decodeURIComponent(String(req.params.id || ''))
    const route = String(req.body?.route || 'whole_question_json')
    const forceRegionOcr = route === 'region_chunks'
    try {
      const task = createPendingBankRerunTask(runId, id, { forceRegionOcr })
      const now = nowIso()
      db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'running', ocr_error = '', ocr_started_at = COALESCE(NULLIF(ocr_started_at, ''), ?), updated_at = ? WHERE run_id = ?")
        .run(now, now, task.runId)
      startMigratedOcrBackground(task.runId)
      res.json({
        ...task,
        route: forceRegionOcr ? 'region_chunks' : 'whole_question_json',
        message: forceRegionOcr ? '已启动当前题分块 OCR。' : '已启动当前题整图 OCR。',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.status(500).json({ error: `待入库单题重新 OCR 启动失败：${message}` })
    }
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/pending-bank/bulk-confirm', (req, res) => {
    const runId = req.params.runId
    if (!getRun(runId)) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const confirmAll = Boolean(req.body?.all)
    const questionIds: string[] = confirmAll
      ? (db.prepare("SELECT id FROM question_bank_items WHERE source_run_id = ? AND bank_status NOT IN ('banked', 'skipped') ORDER BY serial_no ASC").all(runId) as Array<{ id: string }>).map((row) => row.id)
      : req.body?.questionIds || []
    if (!questionIds.length) {
      res.json({ success: 0, failed: 0 })
      return
    }
    const now = nowIso()
    const warnings: string[] = []
    let success = 0
    let failed = 0
    for (const id of questionIds) {
      const row = db.prepare('SELECT * FROM question_bank_items WHERE id = ? AND source_run_id = ?').get(id, runId) as QuestionRow | undefined
      if (!row) { failed += 1; continue }
      if (row.bank_status === 'blocked') {
        warnings.push(`题目 ${id} 仍存在识别风险。`)
      }
      const similar = similarQuestionCandidates(row, { limit: 2 })
      if (similar.length) {
        const label = row.question_no ? `第 ${row.question_no} 题` : id
        warnings.push(`${label} 可能与题库中 ${similar.map((item) => `${item.questionNo || item.id}（${Math.round(item.similarity * 100)}%）`).join('、')} 重复。`)
      }
      db.prepare(`
        UPDATE question_bank_items SET
          question_no = ?,
          bank_status = 'banked',
          format_review_required = 0,
          format_review_reasons_json = '{}',
          updated_at = ?
        WHERE id = ?
      `).run(
        cleanQuestionNoLabel(row.question_no),
        now,
        id
      )
      success += 1
    }
    res.json({ success, failed, warnings: warnings.length ? warnings : undefined })
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/pending-bank/bulk-skip', (req, res) => {
    const runId = req.params.runId
    if (!getRun(runId)) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const questionIds: string[] = req.body?.questionIds || []
    if (!questionIds.length) {
      res.status(400).json({ error: '请指定要跳过的题目。' })
      return
    }
    const now = nowIso()
    let success = 0
    let failed = 0
    for (const id of questionIds) {
      const exists = db.prepare('SELECT 1 FROM question_bank_items WHERE id = ? AND source_run_id = ?').get(id, runId)
      if (!exists) { failed += 1; continue }
      db.prepare("UPDATE question_bank_items SET bank_status = 'skipped', updated_at = ? WHERE id = ?").run(now, id)
      success += 1
    }
    res.json({ success, failed })
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/pending-bank/bulk-delete', (req, res) => {
    const runId = req.params.runId
    if (!getRun(runId)) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const questionIds: string[] = req.body?.questionIds || []
    if (!questionIds.length) {
      res.status(400).json({ error: '请指定要删除的题目。' })
      return
    }
    let success = 0
    let failed = 0
    try {
      db.exec('BEGIN')
      for (const id of questionIds) {
        const exists = db.prepare('SELECT 1 FROM question_bank_items WHERE id = ? AND source_run_id = ?').get(id, runId)
        if (!exists) { failed += 1; continue }
        db.prepare('DELETE FROM question_bank_collection_items WHERE question_id = ?').run(id)
        db.prepare('DELETE FROM question_bank_items WHERE id = ?').run(id)
        db.prepare('DELETE FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?').run(runId, id)
        fs.rmSync(path.join(dataDir, 'question_figures', id), { recursive: true, force: true })
        success += 1
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      const message = error instanceof Error ? error.message : String(error)
      res.status(500).json({ error: `删除题目失败：${message}` })
      return
    }
    if (success > 0) syncReviewRunCounts(runId)
    res.json({ success, failed })
  })
}

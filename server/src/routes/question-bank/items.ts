import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Express } from 'express'
import { db } from '../../db/connection.js'
import { getQuestion, mapQuestion, createQuestion } from '../../db/questions.js'
import { getBasket } from '../../db/collections.js'
import { getRun } from '../../db/runs.js'
import { upload, dataDir } from '../../config.js'
import { resolveStoragePath } from '../../utils/paths.js'
import { buildSearchText, difficultyLabel10, normalizeDifficultyScore10 } from '../../utils/search.js'
import { normalizeQuestionType, inferQuestionType } from '../../utils/question-type.js'
import { cleanQuestionNoLabel, normalizeUploadName, syncQuestionBankItemToOcrDraft } from '../../utils/ocr-helpers.js'
import { blocksToMarkdown } from '../../utils/rich-content.js'
import { nowIso, createId } from '../../utils/ids.js'
import { bindInlineImageReferences, imageExtension } from '../../utils/figure-helpers.js'
import { normalizeTags } from '../../services/tags/tag-libraries.js'
import { formatReviewPayload, validateQuestionMarkdown } from '../../utils/validation.js'
import { pythonCommand } from '../../services/settings/python.js'
import { normalizeOcrProvider, readOcrSettings } from '../../services/settings/ocr-settings.js'
import { createQuestionBankRerunTask, startMigratedOcrBackground } from '../../services/pdf-slicer/ocr.js'
import { importJsonQuestionsFromSliceRun } from '../../services/question-bank/import.js'
import type { QuestionRow } from '../../types/index.js'

export function mountQuestionBankItemsRoutes(app: Express) {
  app.get('/api/question-bank/items', (req, res) => {
    const q = String(req.query.q || '').trim()
    const stage = String(req.query.stage || '').trim()
    const questionType = String(req.query.questionType || '').trim()
    const knowledgePoint = String(req.query.knowledgePoint || '').trim()
    const solutionMethod = String(req.query.solutionMethod || '').trim()
    const difficulty = String(req.query.difficulty || '').trim()
    const requestedPage = Number.parseInt(String(req.query.page || '1'), 10)
    const requestedPageSize = Number.parseInt(String(req.query.pageSize || '20'), 10)
    const pageSize = Math.min(100, Math.max(1, Number.isFinite(requestedPageSize) ? requestedPageSize : 20))
    const whereSql = `
      WHERE (? = '' OR search_text LIKE ? OR source_title LIKE ? OR chapter LIKE ? OR knowledge_points_json LIKE ? OR solution_methods_json LIKE ?)
        AND (? = '' OR stage = ?)
        AND (? = '' OR question_type = ?)
        AND (? = '' OR knowledge_points_json LIKE ?)
        AND (? = '' OR solution_methods_json LIKE ?)
        AND (? = '' OR difficulty_label = ?)
    `
    const filterParams = [
      q,
      `%${q}%`,
      `%${q}%`,
      `%${q}%`,
      `%${q}%`,
      `%${q}%`,
      stage,
      stage,
      questionType,
      questionType,
      knowledgePoint,
      `%${knowledgePoint}%`,
      solutionMethod,
      `%${solutionMethod}%`,
      difficulty,
      difficulty,
    ]
    const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM question_bank_items ${whereSql}`).get(...filterParams) as { count: number }
    const totalItems = totalRow.count ?? 0
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
    const page = Math.min(totalPages, Math.max(1, Number.isFinite(requestedPage) ? requestedPage : 1))
    const offset = (page - 1) * pageSize
    const rows = db.prepare(`
      SELECT * FROM question_bank_items
      ${whereSql}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `).all(...filterParams, pageSize, offset) as QuestionRow[]
    res.json({ items: rows.map(mapQuestion), totalItems, page, pageSize, totalPages, basket: getBasket() })
  })

  app.post('/api/question-bank/items/:id/rerun-ocr', (req, res) => {
    const id = decodeURIComponent(String(req.params.id || ''))
    const item = getQuestion(id)
    if (!item) {
      res.status(404).json({ error: '题目不存在。' })
      return
    }
    if (!item.sourceRunId) {
      res.status(400).json({ error: '当前题目没有原始 OCR 来源，无法重新 OCR。' })
      return
    }
    const sourceRun = getRun(item.sourceRunId)
    if (sourceRun?.ocrProvider === 'doc2x' || normalizeOcrProvider(readOcrSettings().ocrProvider) === 'doc2x') {
      res.status(400).json({ error: 'Doc2X 首版仅支持整批完全重跑，暂不支持单题重新 OCR。' })
      return
    }
    const route = String(req.body?.route || 'whole_question_json')
    const forceRegionOcr = route === 'region_chunks'
    try {
      const task = createQuestionBankRerunTask([id], { forceRegionOcr })
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
      res.status(500).json({ error: `单题重新 OCR 启动失败：${message}` })
    }
  })

  app.post('/api/question-bank/items', (req, res) => {
    res.status(201).json(createQuestion(req.body || {}))
  })

  app.post('/api/question-bank/import-json', (req, res) => {
    const body = req.body || {}
    const questions = Array.isArray(body) ? body : Array.isArray(body.questions) ? body.questions : []
    if (!questions.length) {
      res.status(400).json({ error: '请提供 questions 数组。' })
      return
    }
    const sourceTitle = String(body.sourceTitle || body.paperTitle || 'AI 识别导入')
    const stage = String(body.stage || '高三')
    const created = questions.map((question: Record<string, unknown>, index: number) => {
      const review = Boolean(question.needs_human_review)
      const stemMarkdown = String(question.problem_text || question.stemMarkdown || '')
      const answerText = String(question.answer || question.answerText || '')
      const analysisMarkdown = String(question.analysis || question.analysisMarkdown || '')
      const knowledgePoints = normalizeTags(question.knowledge_points ?? question.knowledgePoints)
      const solutionMethods = normalizeTags(question.solution_methods ?? question.solutionMethods)
      const difficultyScore10 = normalizeDifficultyScore10(question.difficulty_score_10 ?? question.difficultyScore10)
      return createQuestion({
        questionNo: String(question.question_no || question.questionNo || index + 1),
        stage,
        questionType: String(question.question_type || question.questionType || '') || inferQuestionType(stemMarkdown, answerText),
        sourceTitle,
        bankStatus: review ? 'blocked' : 'ready',
        difficultyScore: review ? 4 : 3,
        difficultyScore10,
        difficultyLabel: String(question.difficulty_label || question.difficultyLabel || difficultyLabel10(difficultyScore10)),
        knowledgePoints,
        solutionMethods,
        stemMarkdown,
        answerText,
        analysisMarkdown,
      })
    })
    res.status(201).json({ items: created, count: created.length })
  })

  app.post('/api/question-bank/import-json-from-slices', (req, res) => {
    const body = req.body || {}
    const questions = Array.isArray(body) ? body : Array.isArray(body.questions) ? body.questions : []
    const runId = String(body.runId || '')
    if (!runId) {
      res.status(400).json({ error: '请选择已切分的 PDF 批次。' })
      return
    }
    if (!questions.length) {
      res.status(400).json({ error: '请提供 questions 数组。' })
      return
    }
    try {
      const result = importJsonQuestionsFromSliceRun(runId, questions as Array<Record<string, unknown>>, {
        sourceTitle: String(body.sourceTitle || body.paperTitle || ''),
        stage: String(body.stage || '高三'),
        createCollection: body.createCollection !== false,
      })
      res.status(201).json(result)
    } catch (error) {
      const typed = error as Error & { status?: number; details?: unknown }
      res.status(typed.status || 500).json({ error: typed.message, details: typed.details })
    }
  })

  app.get('/api/question-bank/items/:id', (req, res) => {
    const item = getQuestion(decodeURIComponent(req.params.id))
    item ? res.json(item) : res.status(404).json({ error: '题目不存在。' })
  })

  app.patch('/api/question-bank/items/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id)
    const before = getQuestion(id)
    if (!before) {
      res.status(404).json({ error: '题目不存在。' })
      return
    }
    const body = req.body?.item || req.body || {}
    const nextQuestionNo = body.questionNo == null ? null : cleanQuestionNoLabel(body.questionNo)
    const fieldFromPatch = (markdownValue: unknown, blocksValue: unknown, previous: string) => {
      if (markdownValue != null && String(markdownValue) !== previous) return String(markdownValue)
      if (blocksValue != null) return blocksToMarkdown(blocksValue)
      if (markdownValue != null) return String(markdownValue)
      return previous
    }
    const stemMarkdown = fieldFromPatch(body.stemMarkdown, body.problemBlocks, before.stemMarkdown)
    const answerText = fieldFromPatch(body.answerText, body.answerBlocks, before.answerText)
    const analysisMarkdown = fieldFromPatch(body.analysisMarkdown, body.analysisBlocks, before.analysisMarkdown)
    const knowledgePoints = body.knowledgePoints ? normalizeTags(body.knowledgePoints) : before.knowledgePoints
    const solutionMethods = body.solutionMethods ? normalizeTags(body.solutionMethods) : before.solutionMethods
    const sourceTitle = body.sourceTitle ?? before.sourceTitle
    const chapter = body.chapter ?? before.chapter
    const formatIssues = validateQuestionMarkdown({ problem_text: stemMarkdown, answer: answerText, analysis: analysisMarkdown })
    const requiresFormatReview = Boolean(formatIssues.length)
    const nextBankStatus = body.bankStatus ?? (
      !requiresFormatReview && before.bankStatus === 'blocked' && before.needsFormatReview
        ? 'ready'
        : null
    )
    const formatReviewJson = requiresFormatReview ? JSON.stringify(formatReviewPayload(formatIssues, nowIso())) : '{}'
    db.prepare(`
      UPDATE question_bank_items SET
        question_no = COALESCE(?, question_no),
        stage = COALESCE(?, stage),
        question_type = COALESCE(?, question_type),
        difficulty_score = COALESCE(?, difficulty_score),
        difficulty_score_10 = COALESCE(?, difficulty_score_10),
        difficulty_label = COALESCE(?, difficulty_label),
        chapter = COALESCE(?, chapter),
        knowledge_points_json = COALESCE(?, knowledge_points_json),
        solution_methods_json = COALESCE(?, solution_methods_json),
        source_title = COALESCE(?, source_title),
        stem_markdown = ?,
        answer_text = ?,
        analysis_markdown = ?,
        search_text = ?,
        format_review_required = ?,
        format_review_reasons_json = ?,
        bank_status = CASE WHEN ? AND bank_status = 'ready' THEN 'blocked' ELSE COALESCE(?, bank_status) END,
        updated_at = ?
      WHERE id = ?
    `).run(
      nextQuestionNo,
      body.stage ?? null,
      body.questionType ?? null,
      body.difficultyScore ?? null,
      body.difficultyScore10 ?? null,
      body.difficultyLabel ?? (body.difficultyScore10 ? difficultyLabel10(normalizeDifficultyScore10(body.difficultyScore10)) : null),
      body.chapter ?? null,
      body.knowledgePoints ? JSON.stringify(knowledgePoints) : null,
      body.solutionMethods ? JSON.stringify(solutionMethods) : null,
      body.sourceTitle ?? null,
      stemMarkdown,
      answerText,
      analysisMarkdown,
      buildSearchText(stemMarkdown, answerText, analysisMarkdown, [String(sourceTitle), String(chapter), knowledgePoints.join(' '), solutionMethods.join(' ')]),
      requiresFormatReview ? 1 : 0,
      formatReviewJson,
      requiresFormatReview ? 1 : 0,
      nextBankStatus,
      nowIso(),
      id
    )
    syncQuestionBankItemToOcrDraft(getQuestion(id))
    res.json(getQuestion(id))
  })

  app.delete('/api/question-bank/items/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id)
    if (!getQuestion(id)) {
      res.status(404).json({ error: '题目不存在。' })
      return
    }
    db.prepare('DELETE FROM question_bank_collection_items WHERE question_id = ?').run(id)
    db.prepare('DELETE FROM question_bank_items WHERE id = ?').run(id)
    fs.rmSync(path.join(dataDir, 'question_figures', id), { recursive: true, force: true })
    res.json({ deleted: true })
  })

  app.post('/api/question-bank/items/:id/figures', (req, res) => {
    const id = decodeURIComponent(req.params.id)
    const item = getQuestion(id)
    if (!item) {
      res.status(404).json({ error: '题目不存在。' })
      return
    }
    const bbox = req.body?.bbox || { x: 168, y: 142, width: 412, height: 176 }
    const figureId = createId('fig')
    const sourcePath = String(item.sliceImagePath || '').replace(/^question_assets\//, '').replace(/^\/+/, '')
    const outputRel = path.join('data', 'question_figures', id, `${figureId}.png`)
    if (sourcePath) {
      const inputPath = resolveStoragePath(sourcePath)
      const outputPath = resolveStoragePath(outputRel)
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      const cropScript = [
        'from PIL import Image',
        'import json, sys',
        'src, dst, raw = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])',
        'x = int(round(float(raw.get("x", raw.get("x0", 0)))))',
        'y = int(round(float(raw.get("y", raw.get("y0", 0)))))',
        'w = int(round(float(raw.get("width", raw.get("w", raw.get("x1", 0) - raw.get("x0", 0))))))',
        'h = int(round(float(raw.get("height", raw.get("h", raw.get("y1", 0) - raw.get("y0", 0))))))',
        'im = Image.open(src)',
        'x = max(0, min(x, im.width - 1)); y = max(0, min(y, im.height - 1))',
        'w = max(1, min(w, im.width - x)); h = max(1, min(h, im.height - y))',
        'im.crop((x, y, x + w, y + h)).save(dst)',
      ].join('; ')
      execFileSync(pythonCommand(), ['-c', cropScript, inputPath, outputPath, JSON.stringify(bbox)], { encoding: 'utf8' })
    }
    const figure = {
      id: figureId,
      origin: 'manual_crop',
      usage: req.body?.usage || 'stem',
      category: req.body?.category || 'question_figure',
      optionLabel: req.body?.optionLabel ? String(req.body.optionLabel).toUpperCase() : '',
      pageNumber: Number(req.body?.pageNumber || 1),
      bbox,
      sourcePath,
      path: outputRel,
    }
    const figures = [...item.figures, figure]
    const binding = bindInlineImageReferences({ id, problem_text: item.stemMarkdown, answer: item.answerText, analysis: item.analysisMarkdown }, item.sourceRunId, { localFigures: figures })
    if (binding) {
      const formatReview = binding.issue
        ? JSON.stringify({ issue: binding.issue, reasons: [binding.issue], renderErrors: [], updatedAt: nowIso() })
        : '{}'
      db.prepare('UPDATE question_bank_items SET stem_markdown = ?, answer_text = ?, analysis_markdown = ?, figures_json = ?, bank_status = ?, format_review_required = ?, format_review_reasons_json = ?, updated_at = ? WHERE id = ?')
        // Keep manually saved crops while the set is incomplete.  They become
        // inline bindings only after every referenced image has a match.
        .run(binding.stem, binding.answer, binding.analysis, JSON.stringify(binding.issue ? figures : binding.figures), binding.issue ? 'blocked' : item.bankStatus === 'blocked' ? 'ready' : item.bankStatus, binding.issue ? 1 : 0, formatReview, nowIso(), id)
      const saved = getQuestion(id)
      res.status(201).json(saved?.figures.find((entry) => entry.id === figure.id) || figure)
      return
    }
    db.prepare('UPDATE question_bank_items SET figures_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(figures), nowIso(), id)
    res.status(201).json(figure)
  })

  app.patch('/api/question-bank/items/:id/figures/:figureId', (req, res) => {
    const id = decodeURIComponent(req.params.id)
    const figureId = decodeURIComponent(req.params.figureId)
    const item = getQuestion(id)
    if (!item) {
      res.status(404).json({ error: '题目不存在。' })
      return
    }
    const figures = item.figures as Array<Record<string, any>>
    const index = figures.findIndex((figure) => String(figure.id || '') === figureId)
    if (index < 0) {
      res.status(404).json({ error: '题图不存在。' })
      return
    }
    const current = figures[index]
    const bbox = req.body?.bbox || current.bbox || {}
    const sourcePath = String(current.sourcePath || item.sliceImagePath || '').replace(/^question_assets\//, '').replace(/^\/+/, '')
    let outputRel = String(current.path || '').replace(/^question_assets\//, '').replace(/^\/+/, '')
    if (!outputRel) outputRel = path.join('data', 'question_figures', id, `${figureId}.png`)
    if (sourcePath && Object.keys(bbox).length) {
      const inputPath = resolveStoragePath(sourcePath)
      const outputPath = resolveStoragePath(outputRel)
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      const cropScript = [
        'from PIL import Image',
        'import json, sys',
        'src, dst, raw = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])',
        'x = int(round(float(raw.get("x", raw.get("x0", 0)))))',
        'y = int(round(float(raw.get("y", raw.get("y0", 0)))))',
        'w = int(round(float(raw.get("width", raw.get("w", raw.get("x1", 0) - raw.get("x0", 0))))))',
        'h = int(round(float(raw.get("height", raw.get("h", raw.get("y1", 0) - raw.get("y0", 0))))))',
        'im = Image.open(src)',
        'x = max(0, min(x, im.width - 1)); y = max(0, min(y, im.height - 1))',
        'w = max(1, min(w, im.width - x)); h = max(1, min(h, im.height - y))',
        'im.crop((x, y, x + w, y + h)).save(dst)',
      ].join('; ')
      execFileSync(pythonCommand(), ['-c', cropScript, inputPath, outputPath, JSON.stringify(bbox)], { encoding: 'utf8' })
    }
    const usage = req.body?.usage ? String(req.body.usage) : String(current.usage || 'stem')
    const nextFigure = {
      ...current,
      usage,
      category: req.body?.category || current.category || 'question_figure',
      optionLabel: usage === 'options' && req.body?.optionLabel ? String(req.body.optionLabel).toUpperCase() : '',
      pageNumber: Number(req.body?.pageNumber || current.pageNumber || 1),
      bbox,
      sourcePath,
      path: outputRel,
    }
    const nextFigures = figures.map((figure, figureIndex) => figureIndex === index ? nextFigure : figure)
    db.prepare('UPDATE question_bank_items SET figures_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(nextFigures), nowIso(), id)
    res.json(nextFigure)
  })

  app.post('/api/question-bank/items/:id/figures/upload', upload.single('file'), (req, res) => {
    const id = decodeURIComponent(String(req.params.id || ''))
    const item = getQuestion(id)
    if (!item) {
      res.status(404).json({ error: '题目不存在。' })
      return
    }
    const file = req.file
    if (!file) {
      res.status(400).json({ error: '请上传一个图片文件。' })
      return
    }
    if (!String(file.mimetype || '').startsWith('image/')) {
      res.status(400).json({ error: '只能上传图片文件。' })
      return
    }
    const usage = String(req.body?.usage || 'stem')
    if (!['stem', 'analysis', 'options'].includes(usage)) {
      res.status(400).json({ error: '图片类型无效。' })
      return
    }
    const figureId = createId('fig')
    const extension = imageExtension(file.originalname, file.mimetype)
    const outputRel = path.join('data', 'question_figures', id, `${figureId}${extension}`)
    const outputPath = resolveStoragePath(outputRel)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, file.buffer)
    const figure = {
      id: figureId,
      origin: 'manual_upload',
      usage,
      category: 'question_figure',
      optionLabel: usage === 'options' && req.body?.optionLabel ? String(req.body.optionLabel).toUpperCase() : '',
      pageNumber: 1,
      bbox: {},
      sourcePath: '',
      path: outputRel,
      originalName: file.originalname,
    }
    const figures = [...item.figures, figure]
    db.prepare('UPDATE question_bank_items SET figures_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(figures), nowIso(), id)
    res.status(201).json(figure)
  })

  app.delete('/api/question-bank/items/:id/figures/:figureId', (req, res) => {
    const id = decodeURIComponent(req.params.id)
    const figureId = decodeURIComponent(req.params.figureId)
    const item = getQuestion(id)
    if (!item) {
      res.status(404).json({ error: '题目不存在。' })
      return
    }
    const figures = item.figures as Array<Record<string, any>>
    const target = figures.find((figure) => String(figure.id || '') === figureId)
    if (!target) {
      res.status(404).json({ error: '题图不存在。' })
      return
    }
    const targetPath = String(target.path || '').replace(/^question_assets\//, '').replace(/^\/+/, '')
    if (targetPath && targetPath.startsWith(path.join('data', 'question_figures', id))) {
      fs.rmSync(resolveStoragePath(targetPath), { force: true })
    }
    const nextFigures = figures.filter((figure) => String(figure.id || '') !== figureId)
    db.prepare('UPDATE question_bank_items SET figures_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(nextFigures), nowIso(), id)
    res.json({ deleted: true, item: getQuestion(id) })
  })
}

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Request } from 'express'
import { createQuestion, normalizeScoringRubric, normalizeTotalScore } from '../../db/questions.js'
import { candidateFigureUpload, dataDir } from '../../config.js'
import { resolveStoragePath } from '../../utils/paths.js'
import { buildSearchText, difficultyLabel10, normalizeDifficultyScore10 } from '../../utils/search.js'
import { inferQuestionType } from '../../utils/question-type.js'
import { cleanQuestionNoLabel, syncQuestionBankItemToOcrDraft } from '../../utils/ocr-helpers.js'
import { blocksToMarkdown, stripDoc2xNoiseComments } from '../../utils/rich-content.js'
import { nowIso, createId } from '../../utils/ids.js'
import { bindInlineImageReferences } from '../../utils/figure-helpers.js'
import { imageExtension } from '../../utils/image-operations.js'
import { normalizeTags } from '../tags/tag-libraries.js'
import { formatReviewPayload, validateQuestionMarkdown } from '../../utils/validation.js'
import { pythonCommand } from '../settings/python.js'
import { rerunQuestionBankItemOcr } from './ocr-rerun.js'
import { RouteError } from '../../utils/http-error.js'
import * as repo from '../../repositories/question-bank/items.repo.js'

export const questionFigureUpload = candidateFigureUpload.single('file')

export function listItems(query: Record<string, unknown>) {
  const requestedPage = Number.parseInt(String(query.page || '1'), 10)
  const requestedPageSize = Number.parseInt(String(query.pageSize || '20'), 10)
  return repo.listQuestionBankItems({
    q: String(query.q || '').trim(),
    stage: String(query.stage || '').trim(),
    questionType: String(query.questionType || '').trim(),
    knowledgePoint: String(query.knowledgePoint || '').trim(),
    solutionMethod: String(query.solutionMethod || '').trim(),
    difficulty: String(query.difficulty || '').trim(),
    page: Number.isFinite(requestedPage) ? requestedPage : 1,
    pageSize: Math.min(100, Math.max(1, Number.isFinite(requestedPageSize) ? requestedPageSize : 20)),
  })
}

export function rerunItemOcr(id: string, _body: Record<string, unknown>) {
  const item = repo.getQuestion(id)
  if (!item) throw new RouteError(404, '题目不存在。')
  return rerunQuestionBankItemOcr(id)
}

export function createItem(body: Record<string, unknown>) {
  return createQuestion(body || {})
}

export function importJsonItems(body: unknown) {
  const payload = (body || {}) as Record<string, any>
  const questions = Array.isArray(payload) ? payload : Array.isArray(payload.questions) ? payload.questions : []
  if (!questions.length) throw new RouteError(400, '请提供 questions 数组。')
  const sourceTitle = String(payload.sourceTitle || payload.paperTitle || 'AI 识别导入')
  const stage = String(payload.stage || '高三')
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
      totalScore: normalizeTotalScore(question.total_score ?? question.totalScore),
      scoringRubric: normalizeScoringRubric(question.scoring_rubric ?? question.scoringRubric),
      stemMarkdown,
      answerText,
      analysisMarkdown,
    })
  })
  return { items: created, count: created.length }
}

export function getItem(id: string) {
  const item = repo.getQuestion(id)
  if (!item) throw new RouteError(404, '题目不存在。')
  return item
}

export function updateItem(id: string, rawBody: Record<string, any>) {
  const before = repo.getQuestion(id)
  if (!before) throw new RouteError(404, '题目不存在。')
  const body = rawBody?.item || rawBody || {}
  const nextQuestionNo = body.questionNo == null ? null : cleanQuestionNoLabel(body.questionNo)
  const fieldFromPatch = (markdownValue: unknown, blocksValue: unknown, previous: string) => {
    if (markdownValue != null && String(markdownValue) !== previous) return String(markdownValue)
    if (blocksValue != null) return blocksToMarkdown(blocksValue)
    if (markdownValue != null) return String(markdownValue)
    return previous
  }
  const stemMarkdown = stripDoc2xNoiseComments(fieldFromPatch(body.stemMarkdown, body.problemBlocks, before.stemMarkdown))
  const answerText = stripDoc2xNoiseComments(fieldFromPatch(body.answerText, body.answerBlocks, before.answerText))
  const analysisMarkdown = stripDoc2xNoiseComments(fieldFromPatch(body.analysisMarkdown, body.analysisBlocks, before.analysisMarkdown))
  const contentChanged = stemMarkdown !== before.stemMarkdown || answerText !== before.answerText || analysisMarkdown !== before.analysisMarkdown
  const knowledgePoints = body.knowledgePoints ? normalizeTags(body.knowledgePoints) : before.knowledgePoints
  const solutionMethods = body.solutionMethods ? normalizeTags(body.solutionMethods) : before.solutionMethods
  const sourceTitle = body.sourceTitle ?? before.sourceTitle
  const chapter = body.chapter ?? before.chapter
  const totalScore = body.totalScore != null ? normalizeTotalScore(body.totalScore) : before.totalScore
  const scoringRubric = body.scoringRubric != null ? normalizeScoringRubric(body.scoringRubric) : before.scoringRubric
  const figures = body.figures ? body.figures : before.figures
  const formatIssues = validateQuestionMarkdown({ problem_text: stemMarkdown, answer: answerText, analysis: analysisMarkdown })
  const unplacedAttachments = (figures as Array<Record<string, any>> || []).filter(
    (f) => f.ocrBinding?.enabled && f.ocrBinding?.status === 'unplaced'
  )
  if (unplacedAttachments.length > 0) {
    formatIssues.push({
      field: 'figures',
      code: 'unplaced_attachment',
      message: `含有未定位的人工附件图（${unplacedAttachments.map((f: any) => f.ocrBinding.attachmentId || f.id).join('、')}）。可用待定位操作放置到文本中。`,
      snippet: unplacedAttachments.map((f: any) => f.ocrBinding.attachmentId || f.id).join(','),
    })
  }
  const requiresFormatReview = Boolean(formatIssues.length)
  const nextBankStatus = body.bankStatus ?? (!requiresFormatReview && before.bankStatus === 'blocked' && before.needsFormatReview ? 'ready' : null)
  const formatReviewJson = requiresFormatReview ? JSON.stringify(formatReviewPayload(formatIssues, nowIso())) : '{}'
  const rawExpectedContentRevision = rawBody.expectedContentRevision ?? body.expectedContentRevision
  const expectedContentRevision = rawExpectedContentRevision == null ? undefined : Number(rawExpectedContentRevision)
  const result = repo.updateQuestionBankItem(id, [
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
    totalScore,
    JSON.stringify(scoringRubric),
    buildSearchText(stemMarkdown, answerText, analysisMarkdown, [String(sourceTitle), String(chapter), knowledgePoints.join(' '), solutionMethods.join(' ')]),
    requiresFormatReview ? 1 : 0,
    formatReviewJson,
    requiresFormatReview ? 1 : 0,
    nextBankStatus,
    nowIso(),
  ], { expectedContentRevision, contentChanged, figures })
  if (!result.changes) {
    const current = repo.getQuestion(id)
    if (!current) throw new RouteError(404, '题目不存在。')
    throw new RouteError(409, '内容已在其他页面更新，请刷新后重试。', undefined, {
      error: 'content_revision_conflict',
      message: '内容已在其他页面更新，请刷新后重试。',
      expectedContentRevision: Number(expectedContentRevision),
      actualContentRevision: current.contentRevision,
      current,
    })
  }
  const updated = repo.getQuestion(id)
  const warnings: Array<{ code: string; message: string }> = []
  try {
    syncQuestionBankItemToOcrDraft(updated)
  } catch (error) {
    warnings.push({ code: 'ocr_draft_sync_failed', message: error instanceof Error ? error.message : String(error) })
  }
  return warnings.length ? { ...updated, warnings } : updated
}

export function deleteItem(id: string) {
  if (!repo.getQuestion(id)) throw new RouteError(404, '题目不存在。')
  repo.deleteQuestionBankItem(id)
  fs.rmSync(path.join(dataDir, 'question_figures', id), { recursive: true, force: true })
  return { deleted: true }
}

function cropFigure(sourcePath: string, outputRel: string, bbox: unknown) {
  if (!sourcePath) return
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

export function createFigure(id: string, body: Record<string, any>) {
  const item = repo.getQuestion(id)
  if (!item) throw new RouteError(404, '题目不存在。')
  const bbox = body?.bbox || { x: 168, y: 142, width: 412, height: 176 }
  const figureId = createId('fig')
  const sourcePath = String(body?.sourcePath || item.sliceImagePath || '').replace(/^question_assets\//, '').replace(/^\/+/, '')
  const outputRel = path.join('data', 'question_figures', id, `${figureId}.png`)
  cropFigure(sourcePath, outputRel, bbox)
  const figure = { id: figureId, origin: 'manual_crop', usage: body?.usage || 'stem', category: body?.category || 'question_figure', optionLabel: body?.optionLabel ? String(body.optionLabel).toUpperCase() : '', pageNumber: Number(body?.pageNumber || 1), bbox, sourcePath, path: outputRel }
  const figures = [...item.figures, figure]
  const binding = bindInlineImageReferences({ id, problem_text: item.stemMarkdown, answer: item.answerText, analysis: item.analysisMarkdown }, item.sourceRunId, { localFigures: figures })
  if (binding) {
    const formatReview = binding.issue ? JSON.stringify({ issue: binding.issue, reasons: [binding.issue], renderErrors: [], updatedAt: nowIso() }) : '{}'
    repo.updateQuestionAfterFigureBinding(id, [binding.stem, binding.answer, binding.analysis, JSON.stringify(binding.issue ? figures : binding.figures), binding.issue ? 'blocked' : item.bankStatus === 'blocked' ? 'ready' : item.bankStatus, binding.issue ? 1 : 0, formatReview, nowIso()])
    const saved = repo.getQuestion(id)
    return saved?.figures.find((entry) => entry.id === figure.id) || figure
  }
  repo.updateQuestionFigures(id, figures)
  return figure
}

function persistFiguresWithInlineBinding(id: string, item: NonNullable<ReturnType<typeof repo.getQuestion>>, figures: Array<Record<string, any>>) {
  const binding = bindInlineImageReferences(
    { id, problem_text: item.stemMarkdown, answer: item.answerText, analysis: item.analysisMarkdown },
    item.sourceRunId,
    { localFigures: figures },
  )
  if (!binding) {
    repo.updateQuestionFigures(id, figures)
    return
  }
  const formatReview = binding.issue ? JSON.stringify({ issue: binding.issue, reasons: [binding.issue], renderErrors: [], updatedAt: nowIso() }) : '{}'
  repo.updateQuestionAfterFigureBinding(id, [
    binding.stem,
    binding.answer,
    binding.analysis,
    JSON.stringify(binding.issue ? figures : binding.figures),
    binding.issue ? 'blocked' : item.bankStatus === 'blocked' ? 'ready' : item.bankStatus,
    binding.issue ? 1 : 0,
    formatReview,
    nowIso(),
  ])
}

export function updateFigure(id: string, figureId: string, body: Record<string, any>) {
  const item = repo.getQuestion(id)
  if (!item) throw new RouteError(404, '题目不存在。')
  const figures = item.figures as Array<Record<string, any>>
  const index = figures.findIndex((figure) => String(figure.id || '') === figureId)
  if (index < 0) throw new RouteError(404, '题图不存在。')
  const current = figures[index]
  const bbox = body?.bbox || current.bbox || {}
  const sourcePath = String(body?.sourcePath || current.sourcePath || item.sliceImagePath || '').replace(/^question_assets\//, '').replace(/^\/+/, '')
  let outputRel = String(current.path || '').replace(/^question_assets\//, '').replace(/^\/+/, '')
  if (!outputRel) outputRel = path.join('data', 'question_figures', id, `${figureId}.png`)
  if (sourcePath && Object.keys(bbox).length) cropFigure(sourcePath, outputRel, bbox)
  const usage = body?.usage ? String(body.usage) : String(current.usage || 'stem')
  const nextFigure = { ...current, usage, category: body?.category || current.category || 'question_figure', optionLabel: usage === 'options' && body?.optionLabel ? String(body.optionLabel).toUpperCase() : '', pageNumber: Number(body?.pageNumber || current.pageNumber || 1), bbox, sourcePath, path: outputRel }
  const nextFigures = figures.map((figure, figureIndex) => figureIndex === index ? nextFigure : figure)
  persistFiguresWithInlineBinding(id, item, nextFigures)
  return nextFigure
}

export function uploadFigure(id: string, req: Request) {
  const item = repo.getQuestion(id)
  if (!item) throw new RouteError(404, '题目不存在。')
  const file = req.file
  if (!file) throw new RouteError(400, '请上传一个图片文件。')
  if (!String(file.mimetype || '').startsWith('image/')) throw new RouteError(400, '只能上传图片文件。')
  const usage = String(req.body?.usage || 'stem')
  if (!['stem', 'analysis', 'options'].includes(usage)) throw new RouteError(400, '图片类型无效。')
  const figureId = createId('fig')
  const extension = imageExtension(file.originalname, file.mimetype)
  const outputRel = path.join('data', 'question_figures', id, `${figureId}${extension}`)
  const outputPath = resolveStoragePath(outputRel)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, file.buffer)
  const figure = { id: figureId, origin: 'manual_upload', usage, category: 'question_figure', optionLabel: usage === 'options' && req.body?.optionLabel ? String(req.body.optionLabel).toUpperCase() : '', pageNumber: 1, bbox: {}, sourcePath: '', path: outputRel, originalName: file.originalname }
  persistFiguresWithInlineBinding(id, item, [...item.figures, figure])
  return figure
}

export function deleteFigure(id: string, figureId: string) {
  const item = repo.getQuestion(id)
  if (!item) throw new RouteError(404, '题目不存在。')
  const figures = item.figures as Array<Record<string, any>>
  const target = figures.find((figure) => String(figure.id || '') === figureId)
  if (!target) throw new RouteError(404, '题图不存在。')
  const targetPath = String(target.path || '').replace(/^question_assets\//, '').replace(/^\/+/, '')
  if (targetPath && targetPath.startsWith(path.join('data', 'question_figures', id))) {
    fs.rmSync(resolveStoragePath(targetPath), { force: true })
  }
  const nextFigures = figures.filter((figure) => String(figure.id || '') !== figureId)
  persistFiguresWithInlineBinding(id, item, nextFigures)
  return { deleted: true, item: repo.getQuestion(id) }
}

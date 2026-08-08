import { randomUUID } from 'node:crypto'
import type { ImportJob, ImportJobDocument } from '../../types/import-job.js'
import type { OCRDocument } from '../../types/ocr-document.js'
import type { CandidateSourceRef, QuestionCandidate } from '../../types/question-candidate.js'
import { DEFAULT_IMPORT_METADATA, normalizeImportMetadata } from '../../utils/import-metadata.js'
import { normalizeQuestionType } from '../../utils/question-type.js'
import { RouteError } from '../../utils/http-error.js'
import { createId, nowIso } from '../../utils/ids.js'
import { readAiAssistantConfig } from '../settings/ocr-settings.js'
import * as importJobRepo from '../../repositories/import-jobs.repo.js'
import * as sourceRepo from '../../repositories/source-documents.repo.js'
import { firstDocumentByRole, latestOcrDocumentForSource, metadataForCandidates, saveParsedCandidates } from './import-job.service.js'
import { loadOcrDocument } from './ocr-document.service.js'
import { figuresForRange, sourceRefsForRange } from '../question-parser/figure-linker.js'
import { fillDoc2xFigures } from '../question-parser/candidate-builder.js'
import { statusForIssues, validateQuestionCandidate } from '../question-parser/candidate-validator.js'
import { revalidateAllCandidatesForSourceDocument } from './candidate-validation.service.js'

type ModelSplitRole = 'full' | 'questions' | 'solutions'

type SplitSegment = {
  id: string
  text: string
  start: number
  end: number
  pageNo?: number
  blockIds: string[]
}

type SplitItem = {
  question_no?: unknown
  raw_question_no?: unknown
  normalized_question_no?: unknown
  number_repair?: { applied?: unknown; reason?: unknown; confidence?: unknown }
  stem_segment_ids?: unknown
  answer_segment_ids?: unknown
  analysis_segment_ids?: unknown
}

type ModelSplitPayload = {
  schema_version?: unknown
  document_role?: unknown
  items?: unknown
  unassigned_segment_ids?: unknown
  warnings?: unknown
}

export type ModelSplitPreviewItem = {
  questionNo: string
  rawQuestionNo?: string
  numberRepair?: { reason: string; confidence: number }
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  sourceRefs: CandidateSourceRef[]
  issues: Array<{ code: string; severity: 'warning' | 'error'; message: string }>
}

export type ModelSplitPreview = {
  id: string
  importJobId: string
  mode: ImportJob['mode']
  items: ModelSplitPreviewItem[]
  diagnostics: string[]
  warnings: string[]
  candidates: QuestionCandidate[]
  createdAt: string
}

const previews = new Map<string, ModelSplitPreview>()
const MAX_SEGMENT_CHARS = 240_000

const FIXED_SYSTEM_PROMPT = `你是题目结构拆分器，只负责识别题目边界、字段归属和题号元数据。

严格禁止：
1. 改写、润色、翻译或校正 OCR 正文、公式、表格和图片引用。
2. 推理答案，补写缺失内容，或进行题型、知识点、解题方法、难度分类。
3. 创建、删除、修改或重排任何图片标识符。
4. 输出题目正文。正文只能通过输入片段 ID 归属来恢复。

允许的唯一修复是题号元数据：如果 OCR 题号明显漏字，且前后题号、解析稿或其他上下文提供了充分证据，可以把原始题号归一化为正确题号；必须同时返回 raw_question_no、normalized_question_no、number_repair.reason 和 number_repair.confidence。没有充分证据时不得猜测。

图片标识符形如 <!-- DOC2X_FIGURE:asset_id -->，它们是系统内部引用，必须原样保留。只返回严格 JSON，不要 Markdown 代码围栏。`

function requireImportJob(id: string) {
  const job = importJobRepo.getImportJob(id)
  if (!job) throw new RouteError(404, '导入批次不存在。')
  return job
}

function requireSourceDocument(id: string) {
  const source = sourceRepo.getSourceDocument(id)
  if (!source) throw new RouteError(404, '资料不存在。')
  return source
}

function roleForJobDocument(job: ImportJob, document: ImportJobDocument): ModelSplitRole {
  if (job.mode === 'single_document') return 'full'
  return document.role === 'solutions' ? 'solutions' : 'questions'
}

function segmentsForDocument(document: OCRDocument): SplitSegment[] {
  const source = String(document.markdown || '')
  if (source.length > MAX_SEGMENT_CHARS) throw new RouteError(413, 'OCR 识别稿过长，当前版本暂不支持一次性模型拆分。')
  const lines = source.match(/[^\n]*(?:\n|$)/g) || []
  const segments: SplitSegment[] = []
  let offset = 0
  for (const [index, text] of lines.entries()) {
    const end = offset + text.length
    if (text.length > 0) {
      const blocks = document.pages.flatMap((page) => page.blocks)
        .filter((block) => block.markdownStart !== undefined && block.markdownEnd !== undefined && block.markdownStart < end && block.markdownEnd > offset)
      segments.push({
        id: `seg_${String(index + 1).padStart(6, '0')}`,
        text,
        start: offset,
        end,
        pageNo: blocks[0]?.pageNo,
        blockIds: blocks.map((block) => block.id),
      })
    }
    offset = end
  }
  return segments
}

function endpoints(baseUrl: string) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) return []
  return base.endsWith('/chat/completions') ? [base] : [`${base}/chat/completions`, base]
}

function extractMessageContent(body: any) {
  const content = body?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((item) => typeof item === 'string' ? item : item?.text || '').join('')
  return ''
}

function parseModelJson(text: string): ModelSplitPayload {
  let candidate = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    const value = JSON.parse(candidate)
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as ModelSplitPayload
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        const value = JSON.parse(candidate.slice(start, end + 1))
        if (value && typeof value === 'object' && !Array.isArray(value)) return value as ModelSplitPayload
      } catch {
        // fall through to the user-facing error
      }
    }
  }
  throw new RouteError(502, '拆题模型没有返回合法 JSON。')
}

async function callModel(role: ModelSplitRole, segments: SplitSegment[]) {
  const settings = readAiAssistantConfig()
  if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
    throw new RouteError(400, '缺少模型辅助拆题配置，请先配置 AI 助手 API 地址、密钥和模型。')
  }
  const payload = {
    document_role: role,
    instructions: role === 'solutions'
      ? '这是答案解析文档。只把片段分配到 answer_segment_ids 或 analysis_segment_ids。不要生成 stem。'
      : role === 'questions'
        ? '这是原卷文档。只把片段分配到 stem_segment_ids。不要生成答案或解析。'
        : '这是同一份原卷与答案解析文档。按题号把片段分配到题干、答案或解析。',
    output_schema: {
      schema_version: 'model-split-v1',
      items: [{
        question_no: 'string',
        raw_question_no: 'string',
        normalized_question_no: 'string',
        number_repair: { applied: 'boolean', reason: 'string', confidence: 'number 0..1' },
        stem_segment_ids: 'string[]',
        answer_segment_ids: 'string[]',
        analysis_segment_ids: 'string[]',
      }],
      unassigned_segment_ids: 'string[]',
      warnings: 'string[]',
    },
    segments: segments.map(({ id, text, pageNo, blockIds }) => ({ id, text, pageNo, blockIds })),
  }
  const requestBody = {
    model: settings.model,
    messages: [
      { role: 'system', content: FIXED_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(payload, null, 2) },
    ],
    temperature: 0,
    top_p: 0.1,
    stream: false,
    response_format: { type: 'json_object' },
  }
  let lastError = ''
  for (const endpoint of endpoints(settings.apiBaseUrl)) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(180_000),
      })
      const raw = await response.text()
      if (!response.ok) throw new Error(`模型服务返回 HTTP ${response.status}: ${raw.slice(0, 300)}`)
      return parseModelJson(extractMessageContent(JSON.parse(raw)))
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  throw new RouteError(502, `模型辅助拆题失败：${lastError}`)
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : []
}

function normalizeQuestionNo(value: unknown) {
  const text = String(value || '').replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - '０'.charCodeAt(0))).replace(/\D/g, '')
  return text ? String(Number.parseInt(text, 10)) : ''
}

function selectedSegments(ids: string[], byId: Map<string, SplitSegment>, used: Set<string>, diagnostics: string[], itemLabel: string) {
  const selected: SplitSegment[] = []
  for (const id of ids) {
    const segment = byId.get(id)
    if (!segment) {
      diagnostics.push(`${itemLabel}引用了不存在的片段 ${id}。`)
      continue
    }
    if (used.has(id)) diagnostics.push(`${itemLabel}重复引用了片段 ${id}。`)
    used.add(id)
    selected.push(segment)
  }
  return selected.sort((left, right) => left.start - right.start)
}

function reconstruct(segments: SplitSegment[]) {
  return segments.map((segment) => segment.text).join('').trim()
}

function figureMarkerIds(value: string) {
  return Array.from(String(value || '').matchAll(/<!--[ \t]*DOC2X_FIGURE:([^>\s]+)[ \t]*-->/gi), (match) => match[1])
}

function rangesForSegments(document: OCRDocument, segments: SplitSegment[], kind: CandidateSourceRef['kind']) {
  return segments.flatMap((segment) => sourceRefsForRange(document, { start: segment.start, end: segment.end }, kind))
}

function removeLeadingQuestionMarker(value: string) {
  return value.replace(/^\s*(?:#{1,6}\s*)?(?:第\s*)?[0-9０-９]{1,3}\s*(?:题)?\s*[.．、·•:：]\s*/u, '').trim()
}

function candidateFromModelItem(
  item: SplitItem,
  role: ModelSplitRole,
  document: OCRDocument,
  segments: SplitSegment[],
  metadata: ReturnType<typeof normalizeImportMetadata>,
  used: Set<string>,
  diagnostics: string[],
) {
  const byId = new Map(segments.map((segment) => [segment.id, segment]))
  const label = `第 ${String(item.normalized_question_no || item.question_no || item.raw_question_no || '?')} 题`
  const stemSegments = selectedSegments(stringList(item.stem_segment_ids), byId, used, diagnostics, `${label}题干`)
  const answerSegments = selectedSegments(stringList(item.answer_segment_ids), byId, used, diagnostics, `${label}答案`)
  const analysisSegments = selectedSegments(stringList(item.analysis_segment_ids), byId, used, diagnostics, `${label}解析`)
  const questionNo = normalizeQuestionNo(item.normalized_question_no || item.question_no || item.raw_question_no)
  const rawQuestionNo = normalizeQuestionNo(item.raw_question_no || item.question_no)
  const repair = item.number_repair && item.number_repair.applied === true && rawQuestionNo && questionNo && rawQuestionNo !== questionNo
    ? { reason: String(item.number_repair.reason || '模型修复题号'), confidence: Math.max(0, Math.min(1, Number(item.number_repair.confidence || 0))) }
    : undefined
  const stemMarkdown = role === 'solutions' ? '' : removeLeadingQuestionMarker(reconstruct(stemSegments))
  const answerText = role === 'questions' ? '' : reconstruct(answerSegments)
  const analysisMarkdown = role === 'questions' ? '' : reconstruct(analysisSegments)
  const sourceRefs = [
    ...rangesForSegments(document, stemSegments, 'stem'),
    ...rangesForSegments(document, answerSegments, 'answer'),
    ...rangesForSegments(document, analysisSegments, 'analysis'),
  ]
  const figures = [
    ...stemSegments.flatMap((segment) => figuresForRange(document, { start: segment.start, end: segment.end }, 'stem')),
    ...answerSegments.flatMap((segment) => figuresForRange(document, { start: segment.start, end: segment.end }, 'analysis')),
    ...analysisSegments.flatMap((segment) => figuresForRange(document, { start: segment.start, end: segment.end }, 'analysis')),
  ]
  const issues: QuestionCandidate['issues'] = []
  if (!questionNo) issues.push({ code: 'missing_question_no', severity: 'error', message: `${label}缺少题号。` })
  if (!stemMarkdown && role !== 'solutions') issues.push({ code: 'missing_stem', severity: 'error', message: `${label}缺少题干。` })
  if (!answerText && role !== 'questions') issues.push({ code: 'missing_answer', severity: 'warning', message: `${label}缺少答案。` })
  if (!analysisMarkdown && role !== 'questions') issues.push({ code: 'missing_analysis', severity: 'warning', message: `${label}缺少解析。` })
  if (repair && repair.confidence < 0.8) issues.push({ code: 'manual_review_required', severity: 'warning', message: `${label}题号由 OCR「${rawQuestionNo}」修复为「${questionNo}」，置信度较低。` })
  const timestamp = nowIso()
  const candidate: QuestionCandidate = {
    id: createId('candidate', `${document.id}:${questionNo || 'unknown'}:${stemSegments[0]?.id || answerSegments[0]?.id || randomUUID()}`),
    sourceDocumentId: document.sourceDocumentId,
    ocrDocumentId: document.id,
    questionNo,
    stemMarkdown,
    answerText,
    analysisMarkdown,
    questionType: normalizeQuestionType('', stemMarkdown, answerText),
    knowledgePoints: [],
    solutionMethods: [],
    ...DEFAULT_IMPORT_METADATA,
    ...metadata,
    figures,
    sourceRefs,
    status: 'needs_review',
    issues,
    parseDiagnostics: repair ? [{ code: 'model_repaired_question_no', severity: repair.confidence >= 0.8 ? 'info' : 'warning', questionNo, message: `模型根据上下文将 OCR 题号「${rawQuestionNo}」修复为「${questionNo}」：${repair.reason}` }] : [],
    parserConfigSnapshot: { source: 'model-assisted-split-v1', rawQuestionNo: rawQuestionNo || undefined, numberRepair: repair || undefined },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const duplicateNos = new Set<string>()
  candidate.issues = validateQuestionCandidate(candidate, duplicateNos)
  const filled = fillDoc2xFigures(document, candidate.stemMarkdown, candidate.answerText, candidate.analysisMarkdown, candidate.figures)
  candidate.figures = filled.figures
  candidate.status = statusForIssues(candidate.issues)
  return { candidate, preview: { questionNo, rawQuestionNo: rawQuestionNo || undefined, numberRepair: repair, stemMarkdown, answerText, analysisMarkdown, sourceRefs, issues: candidate.issues } }
}

function mergeSeparatedCandidates(questionCandidates: QuestionCandidate[], solutionCandidates: QuestionCandidate[]) {
  const solutions = new Map(solutionCandidates.map((candidate) => [candidate.questionNo, candidate]))
  const diagnostics: string[] = []
  for (const question of questionCandidates) {
    const solution = solutions.get(question.questionNo)
    if (!solution) {
      question.issues.push({ code: 'missing_solution', severity: 'warning', message: `未匹配到第 ${question.questionNo || '未知'} 题的解析文档内容。` })
      question.status = statusForIssues(question.issues)
      continue
    }
    question.answerText = solution.answerText
    question.analysisMarkdown = solution.analysisMarkdown
    question.sourceRefs.push(...solution.sourceRefs)
    question.figures.push(...solution.figures)
    if (question.parseDiagnostics.length === 0 && solution.parseDiagnostics.length > 0) question.parseDiagnostics = solution.parseDiagnostics
    question.issues = question.issues.filter((issue) => issue.code !== 'missing_answer' && issue.code !== 'missing_analysis')
    question.status = statusForIssues(question.issues)
  }
  for (const solution of solutionCandidates) {
    if (!questionCandidates.some((question) => question.questionNo === solution.questionNo)) diagnostics.push(`解析文档中的第 ${solution.questionNo || '未知'} 题未匹配到原卷题干。`)
  }
  return diagnostics
}

async function splitDocument(role: ModelSplitRole, document: OCRDocument, metadata: ReturnType<typeof normalizeImportMetadata>) {
  const segments = segmentsForDocument(document)
  const result = await callModel(role, segments)
  const items = Array.isArray(result.items) ? result.items as SplitItem[] : []
  if (!items.length) throw new RouteError(502, '拆题模型没有返回题目。')
  const used = new Set<string>()
  const diagnostics: string[] = []
  const candidates: QuestionCandidate[] = []
  const previews: ModelSplitPreviewItem[] = []
  for (const item of items) {
    const built = candidateFromModelItem(item, role, document, segments, metadata, used, diagnostics)
    candidates.push(built.candidate)
    previews.push(built.preview)
  }
  const questionNos = new Map<string, number>()
  for (const candidate of candidates) {
    if (!candidate.questionNo) continue
    questionNos.set(candidate.questionNo, (questionNos.get(candidate.questionNo) || 0) + 1)
  }
  for (const candidate of candidates) {
    if (candidate.questionNo && (questionNos.get(candidate.questionNo) || 0) > 1) {
      const message = `检测到重复题号 ${candidate.questionNo}，请人工确认。`
      diagnostics.push(message)
      candidate.issues.push({ code: 'duplicate_question_no', severity: 'error', message })
      candidate.parseDiagnostics.push({ code: 'model_duplicate_question_no', severity: 'error', questionNo: candidate.questionNo, message })
      candidate.status = statusForIssues(candidate.issues)
      const item = previews.find((preview) => preview.questionNo === candidate.questionNo && preview.stemMarkdown === candidate.stemMarkdown)
      if (item && !item.issues.some((issue) => issue.code === 'duplicate_question_no')) item.issues.push({ code: 'duplicate_question_no', severity: 'error', message })
    }
  }
  const sourceMarkerIds = new Set(figureMarkerIds(document.markdown))
  const assignedMarkerIds = new Set(candidates.flatMap((candidate) => figureMarkerIds(`${candidate.stemMarkdown}\n${candidate.answerText}\n${candidate.analysisMarkdown}`)))
  for (const markerId of sourceMarkerIds) {
    if (!assignedMarkerIds.has(markerId)) diagnostics.push(`图片标识符 ${markerId} 未被模型分配到任何题目，已保留在 OCR 原文中。`)
  }
  return { candidates, previews, diagnostics, warnings: Array.isArray(result.warnings) ? result.warnings.map((value) => String(value || '')).filter(Boolean) : [] }
}

export async function createModelSplitPreview(jobId: string) {
  const job = requireImportJob(jobId)
  const documents = importJobRepo.listImportJobDocuments(jobId)
  if (documents.length === 0) throw new RouteError(400, '导入批次没有关联资料。')
  const committed = documents.some((document) => (sourceRepo.getSourceDocument(document.sourceDocumentId)?.importStats?.committedCount || 0) > 0)
  if (committed) throw new RouteError(409, '该批次已有题目入库，暂不支持模型辅助拆题。')
  const questionDocument = firstDocumentByRole(documents, job.mode === 'single_document' ? 'full' : 'questions')
  if (!questionDocument) throw new RouteError(400, '导入批次缺少原卷 OCR 文档。')
  const questionSource = requireSourceDocument(questionDocument.sourceDocumentId)
  const questionOcr = loadOcrDocument(latestOcrDocumentForSource(questionSource.id).id)
  const metadata = metadataForCandidates(job, questionSource)
  const questionPromise = splitDocument(roleForJobDocument(job, questionDocument), questionOcr, metadata)
  if (job.mode === 'single_document') {
    const result = await questionPromise
    const preview: ModelSplitPreview = { id: randomUUID(), importJobId: job.id, mode: job.mode, items: result.previews, diagnostics: result.diagnostics, warnings: result.warnings, candidates: result.candidates, createdAt: nowIso() }
    previews.set(preview.id, preview)
    return preview
  }
  const solutionDocument = firstDocumentByRole(documents, 'solutions')
  if (!solutionDocument) throw new RouteError(400, '导入批次缺少解析 OCR 文档。')
  const solutionSource = requireSourceDocument(solutionDocument.sourceDocumentId)
  const solutionOcr = loadOcrDocument(latestOcrDocumentForSource(solutionSource.id).id)
  const [questionResult, solutionResult] = await Promise.all([questionPromise, splitDocument('solutions', solutionOcr, metadata)])
  const mergeDiagnostics = mergeSeparatedCandidates(questionResult.candidates, solutionResult.candidates)
  const solutionByNo = new Map(solutionResult.previews.map((item) => [item.questionNo, item]))
  const mergedPreviews = questionResult.previews.map((item) => {
    const solution = solutionByNo.get(item.questionNo)
    return solution ? { ...item, answerText: solution.answerText, analysisMarkdown: solution.analysisMarkdown, sourceRefs: [...item.sourceRefs, ...solution.sourceRefs], issues: [...item.issues, ...solution.issues] } : item
  })
  const preview: ModelSplitPreview = { id: randomUUID(), importJobId: job.id, mode: job.mode, items: mergedPreviews, diagnostics: [...questionResult.diagnostics, ...solutionResult.diagnostics, ...mergeDiagnostics], warnings: [...questionResult.warnings, ...solutionResult.warnings], candidates: questionResult.candidates, createdAt: nowIso() }
  previews.set(preview.id, preview)
  return preview
}

export function applyModelSplitPreview(jobId: string, previewId: string) {
  const preview = previews.get(previewId)
  if (!preview) throw new RouteError(404, '模型拆题预览已过期，请重新生成。')
  if (preview.importJobId !== jobId) throw new RouteError(404, '模型拆题预览不属于当前导入批次。')
  if (preview.diagnostics.length) throw new RouteError(409, '模型拆题结果存在无法自动修复的结构错误，请重新生成或人工处理。')
  const job = requireImportJob(preview.importJobId)
  const documents = importJobRepo.listImportJobDocuments(job.id)
  const committed = documents.some((document) => (sourceRepo.getSourceDocument(document.sourceDocumentId)?.importStats?.committedCount || 0) > 0)
  if (committed) throw new RouteError(409, '该批次已有题目入库，不能应用模型拆题结果。')
  const questionDocument = firstDocumentByRole(documents, job.mode === 'single_document' ? 'full' : 'questions')
  if (!questionDocument) throw new RouteError(400, '导入批次缺少原卷资料。')
  const questionSource = requireSourceDocument(questionDocument.sourceDocumentId)
  const result = saveParsedCandidates(job, questionSource, latestOcrDocumentForSource(questionSource.id).id, preview.candidates)
  if (job.mode === 'separated_documents') {
    const solutionDocument = firstDocumentByRole(documents, 'solutions')
    if (solutionDocument) {
      const solutionSource = requireSourceDocument(solutionDocument.sourceDocumentId)
      sourceRepo.updateSourceDocument(solutionSource.id, { status: 'parsed' })
    }
  }
  revalidateAllCandidatesForSourceDocument(questionSource.id)
  previews.delete(previewId)
  return { ...result, previewId }
}

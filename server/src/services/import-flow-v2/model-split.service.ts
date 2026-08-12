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
import {
  DEFAULT_MODEL_SPLIT_SYSTEM_PROMPT,
  renderModelSplitUserPrompt,
} from './model-split-prompt.js'

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
  solution_segment_ids?: unknown
  answer_segment_ids?: unknown
  analysis_segment_ids?: unknown
  stem_line_ranges?: unknown
  solution_line_ranges?: unknown
  answer_line_ranges?: unknown
  analysis_line_ranges?: unknown
  answer_text?: unknown
  answer_evidence_text?: unknown
  /** 仅描述题型；正文仍必须由本地从 OCR 行范围重建。 */
  question_type?: unknown
  /** 原卷中的选择项定位与内容，供本地逐字核验后结构化。 */
  options?: unknown
  /** 模型直出模式下的可编辑候选内容。 */
  stem_markdown?: unknown
  analysis_markdown?: unknown
  source_line_ranges?: unknown
  issues?: unknown
  suggested_replacements?: unknown
  cleanup_operations?: unknown
  /** @deprecated; kept so previews from the initial v4 contract still work. */
  analysis_trim_prefix?: unknown
  answer_source_text?: unknown
  analysis_start_source_text?: unknown
  analysis_source_text?: unknown
  answer_inline_spans?: unknown
  analysis_inline_spans?: unknown
}

type ModelSplitOptions = {
  userNote?: string
}

type AnswerTableEntry = {
  question_no?: unknown
  answer_text?: unknown
  source_line_ranges?: unknown
}

type ModelSplitPayload = {
  schema_version?: unknown
  document_role?: unknown
  items?: unknown
  answer_table_entries?: unknown
  unassigned_segment_ids?: unknown
  unassigned_line_ranges?: unknown
  warnings?: unknown
}

export type ModelSplitStreamEvent =
  | { event: 'started'; data: { mode: ImportJob['mode']; documents: Array<{ role: ModelSplitRole; totalLines: number }> } }
  | { event: 'item'; data: { role: ModelSplitRole; index: number; item: ModelSplitPreviewItem } }
  | { event: 'warning'; data: { role?: ModelSplitRole; message: string } }
  | { event: 'done'; data: ModelSplitPreview }

export type ModelSplitPreviewItem = {
  questionNo: string
  /** 从题干与答案推断的题型，仅用于模型拆题核对阶段的交互与展示。 */
  questionType?: string
  rawQuestionNo?: string
  numberRepair?: { reason: string; confidence: number }
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  /** OCR 原稿中对应的题干，始终只读，用于和模型草稿对照。 */
  sourceStemMarkdown: string
  /** OCR 原稿中对应的完整答案解析片段，始终只读，用于和模型草稿对照。 */
  sourceSolutionMarkdown: string
  /** 已逐字核验并应用的模型清理记录；不会修改右侧 OCR 原稿。 */
  cleanupNotes: string[]
  /** 用户确认后才会应用的模型文本建议；不会自动改写草稿。 */
  suggestedReplacements: Array<{
    field: 'stemMarkdown' | 'answerText' | 'analysisMarkdown'
    exactText: string
    replacementText: string
    reason: string
  }>
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
const MAX_MARKDOWN_CHARS = 240_000

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
  if (source.length > MAX_MARKDOWN_CHARS) throw new RouteError(413, 'OCR Markdown 过长，当前版本暂不支持一次性模型拆分。')
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

function extractDeltaContent(body: any) {
  const content = body?.choices?.[0]?.delta?.content ?? body?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((item) => typeof item === 'string' ? item : item?.text || '').join('')
  return ''
}

function modelRequest(role: ModelSplitRole, segments: SplitSegment[], stream: boolean, options: ModelSplitOptions = {}) {
  const numberedMarkdown = segments.map((segment, index) => {
    const line = segment.text.endsWith('\n') ? segment.text.slice(0, -1) : segment.text
    return `L${String(index + 1).padStart(6, '0')}\t${line}`
  }).join('\n')
  const payload = {
    document_role: role,
    instructions: role === 'solutions'
      ? '这是答案解析文档。使用直出候选模式：为每题直接生成 answer_text、analysis_markdown、source_line_ranges 和 issues；不生成 stem_markdown，question_type 固定为 other，options 必须为 []。source_line_ranges 指向该题完整 OCR 原稿；如有汇总答案表，同时提取 answer_table_entries。'
      : role === 'questions'
        ? '这是原卷文档。使用直出候选模式：为每题直接生成 stem_markdown、question_type、options、source_line_ranges 和 issues；answer_text 与 analysis_markdown 必须为空字符串。source_line_ranges 指向该题完整 OCR 原稿；通常不应存在 answer_table_entries。'
        : '这是同一份原卷与答案解析文档。使用直出候选模式：为每题直接生成 stem_markdown、answer_text、analysis_markdown、question_type、options、source_line_ranges 和 issues。source_line_ranges 指向该题完整 OCR 原稿；不要输出 stem_line_ranges、solution_line_ranges、answer_line_ranges 或 analysis_line_ranges。',
    line_numbering: '1-based, inclusive; L000001 means line 1',
    output_schema: {
      schema_version: 'model-split-draft-v4',
      items: [{
        question_no: 'string',
        raw_question_no: 'string',
        normalized_question_no: 'string',
        number_repair: { applied: 'boolean', reason: 'string', confidence: 'number 0..1' },
        stem_line_ranges: 'Array<[start_line, end_line]>',
        solution_line_ranges: 'Array<[start_line, end_line]>',
        answer_text: 'string copied exactly from the source; may come from any position inside the solution range',
        answer_evidence_text: 'optional short source excerpt containing the answer, copied exactly; may occur anywhere in the solution range',
        stem_markdown: 'direct editable stem for full document mode, without question number, score, answer, analysis headings or commentary',
        analysis_markdown: 'direct editable solution for full document mode, with solution steps retained and presentation headings removed',
        source_line_ranges: 'Array<[start_line, end_line]> covering the complete OCR source for this question in full document mode',
        question_type: '"single_choice" | "multiple_choice" | "fill_blank" | "short_answer" | "proof" | "other"',
        options: [{
          label: '"A" | "B" | "C" | "D"',
          content_markdown: 'exact option content with its label removed',
          source_text: 'the complete exact OCR source option, including its label',
        }],
        cleanup_operations: [{
          field: '"stem" | "answer" | "analysis"',
          action: '"trim_prefix" | "remove"',
          exact_text: 'exact source text to remove; must be unique in the field for remove',
          reason: 'Chinese reason such as 分值、题号和作答答案、考点标签、通用点评',
        }],
        issues: [{ code: 'string', field: 'string', message: 'Chinese description of OCR uncertainty' }],
        suggested_replacements: [{
          field: '"stem" | "answer" | "analysis"',
          exact_text: 'the exact text currently retained in the corresponding direct draft field',
          replacement_text: 'a proposed replacement for that exact text',
          reason: 'Chinese reason for the suggestion',
        }],
      }],
      answer_table_entries: [{
        question_no: 'string',
        answer_text: 'string copied exactly from the source answer cell',
        source_line_ranges: 'Array<[start_line, end_line]>',
      }],
      unassigned_line_ranges: 'Array<[start_line, end_line]>',
      warnings: 'string[]',
    },
    user_note: options.userNote || undefined,
    numbered_markdown: numberedMarkdown,
  }
  const settings = readAiAssistantConfig()
  const isOfficialDeepSeek = (() => {
    try {
      return new URL(settings.apiBaseUrl).hostname.toLowerCase().endsWith('deepseek.com')
        && settings.model.toLowerCase().startsWith('deepseek-')
    } catch {
      return false
    }
  })()
  return {
    model: settings.model,
    messages: [
      {
        role: 'system',
        content: settings.modelSplitSystemPrompt || DEFAULT_MODEL_SPLIT_SYSTEM_PROMPT,
      },
      { role: 'user', content: renderModelSplitUserPrompt(settings.modelSplitUserPrompt, payload) },
    ],
    temperature: 0,
    top_p: 0.1,
    // Whole papers can contain complete worked solutions. Do not rely on a
    // gateway's usually much smaller default output budget.
    max_tokens: settings.modelSplitMaxTokens,
    stream,
    response_format: { type: 'json_object' },
    // DeepSeek V4 Flash defaults to thinking mode. Splitting is an extraction task,
    // and disabling it lets the first complete item reach the review UI promptly.
    ...(isOfficialDeepSeek ? { thinking: { type: 'disabled' } } : {}),
  }
}

class StreamingItemsParser {
  private text = ''
  private scanIndex = 0
  private arrayStarted = false
  private objectStart = -1
  private depth = 0
  private inString = false
  private escaped = false

  push(delta: string) {
    this.text += delta
    const items: SplitItem[] = []
    if (!this.arrayStarted) {
      const keyMatch = /["']items["']\s*:\s*\[/.exec(this.text)
      if (!keyMatch) return items
      this.arrayStarted = true
      this.scanIndex = keyMatch.index + keyMatch[0].length
    }
    for (; this.scanIndex < this.text.length; this.scanIndex += 1) {
      const char = this.text[this.scanIndex]
      if (this.objectStart < 0) {
        if (char === '{') {
          this.objectStart = this.scanIndex
          this.depth = 1
          this.inString = false
          this.escaped = false
        } else if (char === ']') {
          break
        }
        continue
      }
      if (this.inString) {
        if (this.escaped) this.escaped = false
        else if (char === '\\') this.escaped = true
        else if (char === '"') this.inString = false
        continue
      }
      if (char === '"') this.inString = true
      else if (char === '{' || char === '[') this.depth += 1
      else if (char === '}' || char === ']') {
        this.depth -= 1
        if (this.depth === 0) {
          const candidate = this.text.slice(this.objectStart, this.scanIndex + 1)
          this.objectStart = -1
          const parsed = JSON.parse(candidate)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) items.push(parsed as SplitItem)
        }
      }
    }
    return items
  }

  payload() {
    return parseModelJson(this.text)
  }
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

function finishReason(body: any) {
  return String(body?.choices?.[0]?.finish_reason || '').trim().toLowerCase()
}

function lengthLimitError() {
  return new RouteError(502, '模型输出达到长度上限，结果未完整生成。请在“设置 → AI 助手与分类”提高模型拆题最大输出 Token 后重新生成。')
}

function normalizeModelSplitOptions(body?: unknown): ModelSplitOptions {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
  const raw = (body as { userNote?: unknown; note?: unknown }).userNote ?? (body as { note?: unknown }).note
  if (raw == null) return {}
  if (typeof raw !== 'string') throw new RouteError(400, '识别备注格式不正确。')
  const userNote = raw.trim()
  if (userNote.length > 800) throw new RouteError(400, '识别备注不能超过 800 个字符。')
  return userNote ? { userNote } : {}
}

async function callModel(role: ModelSplitRole, segments: SplitSegment[], options: ModelSplitOptions = {}) {
  const settings = readAiAssistantConfig()
  if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
    throw new RouteError(400, '缺少模型辅助拆题配置，请先配置 AI 助手 API 地址、密钥和模型。')
  }
  const requestBody = modelRequest(role, segments, false, options)
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
      const body = JSON.parse(raw)
      if (finishReason(body) === 'length') throw lengthLimitError()
      return parseModelJson(extractMessageContent(body))
    } catch (error) {
      if (error instanceof RouteError) throw error
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  throw new RouteError(502, `模型辅助拆题失败：${lastError}`)
}

async function callModelStream(role: ModelSplitRole, segments: SplitSegment[], options: ModelSplitOptions, onItem: (item: SplitItem) => void, signal?: AbortSignal) {
  const settings = readAiAssistantConfig()
  if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
    throw new RouteError(400, '缺少模型辅助拆题配置，请先配置 AI 助手 API 地址、密钥和模型。')
  }
  let lastError = ''
  let emittedAny = false
  for (const endpoint of endpoints(settings.apiBaseUrl)) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(modelRequest(role, segments, true, options)),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000),
      })
      if (!response.ok) {
        const raw = await response.text()
        throw new Error(`模型服务返回 HTTP ${response.status}: ${raw.slice(0, 300)}`)
      }
      if (!response.body) throw new Error('模型服务没有返回可读取的数据流。')
      const parser = new StreamingItemsParser()
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let sseBuffer = ''
      let emittedItems = 0
      let finalFinishReason = ''
      const consumeEvent = (rawEvent: string) => {
        const data = rawEvent.split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
          .trim()
        if (!data || data === '[DONE]') return
        const body = JSON.parse(data)
        finalFinishReason = finishReason(body) || finalFinishReason
        const delta = extractDeltaContent(body)
        if (!delta) return
        for (const item of parser.push(delta)) {
          emittedItems += 1
          emittedAny = true
          onItem(item)
        }
      }
      while (true) {
        const { done, value } = await reader.read()
        sseBuffer += decoder.decode(value, { stream: !done })
        const events = sseBuffer.split(/\r?\n\r?\n/)
        sseBuffer = events.pop() || ''
        for (const event of events) consumeEvent(event)
        if (done) break
      }
      if (sseBuffer.trim()) consumeEvent(sseBuffer)
      if (finalFinishReason === 'length') throw lengthLimitError()
      const payload = parser.payload()
      const items = Array.isArray(payload.items) ? payload.items as SplitItem[] : []
      if (!items.length) throw new Error('拆题模型没有返回题目。')
      // Some OpenAI-compatible gateways buffer or omit intermediate deltas. Ensure
      // callers still receive every item exactly once when the completed JSON arrives.
      for (const item of items.slice(emittedItems)) {
        emittedAny = true
        onItem(item)
      }
      return payload
    } catch (error) {
      if (error instanceof RouteError) throw error
      lastError = error instanceof Error ? error.message : String(error)
      if (emittedAny) throw new RouteError(502, `模型辅助拆题流中断：${lastError}`)
    }
  }
  throw new RouteError(502, `模型辅助拆题失败：${lastError}`)
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : []
}

function lineRanges(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return []
  const source = value.length === 2 && value.every((entry) => Number.isFinite(Number(entry))) ? [value] : value
  return source.flatMap((entry) => {
    if (Array.isArray(entry) && entry.length >= 2) {
      const start = Number.parseInt(String(entry[0]), 10)
      const end = Number.parseInt(String(entry[1]), 10)
      return Number.isFinite(start) && Number.isFinite(end) ? [[start, end] as [number, number]] : []
    }
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>
      const start = Number.parseInt(String(record.start_line ?? record.start ?? ''), 10)
      const end = Number.parseInt(String(record.end_line ?? record.end ?? ''), 10)
      return Number.isFinite(start) && Number.isFinite(end) ? [[start, end] as [number, number]] : []
    }
    return []
  })
}

type InlineSpan = {
  segment: SplitSegment
  start: number
  end: number
  text: string
}

type SegmentAllocation = {
  start: number
  end: number
  label: string
}

type SegmentAllocations = Map<string, SegmentAllocation[]>

function lineText(segment: SplitSegment) {
  return segment.text.replace(/\r?\n$/, '')
}

function reserveSegmentRange(
  used: SegmentAllocations,
  segment: SplitSegment,
  start: number,
  end: number,
  diagnostics: string[],
  itemLabel: string,
) {
  const ranges = used.get(segment.id) || []
  if (ranges.some((range) => range.start < end && start < range.end)) {
    diagnostics.push(`${itemLabel}与${ranges.find((range) => range.start < end && start < range.end)?.label || '其他字段'}重复引用了 OCR 行 ${segment.id}。`)
  }
  ranges.push({ start, end, label: itemLabel })
  used.set(segment.id, ranges)
}

function inlineSpans(
  value: unknown,
  segments: SplitSegment[],
  used: SegmentAllocations,
  diagnostics: string[],
  itemLabel: string,
) {
  if (!Array.isArray(value)) return [] as InlineSpan[]
  const spans: InlineSpan[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      diagnostics.push(`${itemLabel}的行内定位格式不正确。`)
      continue
    }
    const record = raw as Record<string, unknown>
    const line = Number.parseInt(String(record.line ?? ''), 10)
    const startColumn = Number.parseInt(String(record.start_column ?? record.startColumn ?? ''), 10)
    const endColumn = Number.parseInt(String(record.end_column ?? record.endColumn ?? ''), 10)
    const exactText = typeof record.exact_text === 'string' ? record.exact_text : ''
    const segment = Number.isFinite(line) ? segments[line - 1] : undefined
    if (!segment || !Number.isFinite(startColumn) || !Number.isFinite(endColumn) || startColumn < 1 || endColumn < startColumn || !exactText) {
      diagnostics.push(`${itemLabel}的行内定位超出 OCR 原文范围。`)
      continue
    }
    const characters = Array.from(lineText(segment))
    if (endColumn > characters.length) {
      diagnostics.push(`${itemLabel}的行内定位超出 OCR 原文范围。`)
      continue
    }
    const start = characters.slice(0, startColumn - 1).join('').length
    const end = characters.slice(0, endColumn).join('').length
    const actual = lineText(segment).slice(start, end)
    if (actual !== exactText) {
      diagnostics.push(`${itemLabel}的行内内容与 OCR 原文不一致，未采用该定位。`)
      continue
    }
    reserveSegmentRange(used, segment, start, end, diagnostics, itemLabel)
    spans.push({ segment, start, end, text: actual })
  }
  return spans.sort((left, right) => left.segment.start + left.start - (right.segment.start + right.start))
}

function sourceAfterQuestionMarker(value: string) {
  return String(value || '').replace(/^\s*(?:#{1,6}\s*)?(?:第\s*)?[0-9０-９]{1,3}\s*(?:题)?\s*[.．、·•:：]\s*/u, '')
}

function segmentIdsForRanges(value: unknown, segments: SplitSegment[]) {
  const ids: string[] = []
  for (const [start, end] of lineRanges(value)) {
    if (start < 1 || end < start || end > segments.length) {
      ids.push(`invalid_line_range_${start}_${end}`)
      continue
    }
    for (let line = start; line <= end; line += 1) ids.push(segments[line - 1].id)
  }
  return [...new Set(ids)]
}

function materializeLineRangeItem(item: SplitItem, segments: SplitSegment[]): SplitItem {
  const directSourceIds = item.source_line_ranges === undefined ? undefined : segmentIdsForRanges(item.source_line_ranges, segments)
  return {
    ...item,
    stem_segment_ids: item.stem_line_ranges === undefined
      ? (directSourceIds || item.stem_segment_ids)
      : segmentIdsForRanges(item.stem_line_ranges, segments),
    solution_segment_ids: item.solution_line_ranges === undefined ? item.solution_segment_ids : segmentIdsForRanges(item.solution_line_ranges, segments),
    answer_segment_ids: item.answer_line_ranges === undefined ? item.answer_segment_ids : segmentIdsForRanges(item.answer_line_ranges, segments),
    analysis_segment_ids: item.analysis_line_ranges === undefined ? item.analysis_segment_ids : segmentIdsForRanges(item.analysis_line_ranges, segments),
  }
}

function attachAdjacentFigureMarkers(items: SplitItem[], segments: SplitSegment[]) {
  const byId = new Map(segments.map((segment, index) => [segment.id, index]))
  const assigned = new Set(items.flatMap((item) => SEGMENT_FIELDS.flatMap((field) => stringList(item[field]))))
  for (const item of items) {
    for (const field of SEGMENT_FIELDS) {
      const ids = stringList(item[field])
      const indexes = ids.map((id) => byId.get(id)).filter((index): index is number => index !== undefined)
      if (!indexes.length) continue
      let cursor = Math.max(...indexes) + 1
      while (cursor < segments.length && !segments[cursor].text.trim()) cursor += 1
      while (cursor < segments.length && figureMarkerIds(segments[cursor].text).length > 0 && !assigned.has(segments[cursor].id)) {
        ids.push(segments[cursor].id)
        assigned.add(segments[cursor].id)
        cursor += 1
        while (cursor < segments.length && !segments[cursor].text.trim()) cursor += 1
      }
      item[field] = ids
    }
  }
  return items
}

const SEGMENT_FIELDS = ['stem_segment_ids', 'solution_segment_ids', 'answer_segment_ids', 'analysis_segment_ids'] as const

function sanitizeSharedAggregateSegments(items: SplitItem[]) {
  const normalized = items.map((item) => ({
    ...item,
    stem_segment_ids: [...new Set(stringList(item.stem_segment_ids))],
    solution_segment_ids: [...new Set(stringList(item.solution_segment_ids))],
    answer_segment_ids: [...new Set(stringList(item.answer_segment_ids))],
    analysis_segment_ids: [...new Set(stringList(item.analysis_segment_ids))],
  }))
  const uses = new Map<string, Array<{ index: number; field: typeof SEGMENT_FIELDS[number] }>>()
  normalized.forEach((item, index) => {
    for (const field of SEGMENT_FIELDS) {
      for (const id of stringList(item[field])) uses.set(id, [...(uses.get(id) || []), { index, field }])
    }
  })
  const sharedAggregateIds = new Set<string>()
  for (const [id, references] of uses) {
    const questionIndexes = new Set(references.map((reference) => reference.index))
    if (questionIndexes.size > 1 && references.every((reference) => reference.field !== 'stem_segment_ids')) sharedAggregateIds.add(id)
  }
  if (!sharedAggregateIds.size) return { items: normalized, warnings: [] as string[] }
  for (const item of normalized) {
    item.solution_segment_ids = stringList(item.solution_segment_ids).filter((id) => !sharedAggregateIds.has(id))
    item.answer_segment_ids = stringList(item.answer_segment_ids).filter((id) => !sharedAggregateIds.has(id))
    item.analysis_segment_ids = stringList(item.analysis_segment_ids).filter((id) => !sharedAggregateIds.has(id))
  }
  return {
    items: normalized,
    warnings: [`检测到 ${sharedAggregateIds.size} 个跨题答案或解析片段被重复引用，已保留为未分配内容，未强行归入某一道题。`],
  }
}

function normalizeQuestionNo(value: unknown) {
  const text = String(value || '').replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - '０'.charCodeAt(0))).replace(/\D/g, '')
  return text ? String(Number.parseInt(text, 10)) : ''
}

function selectedSegments(ids: string[], byId: Map<string, SplitSegment>, used: SegmentAllocations, diagnostics: string[], itemLabel: string) {
  const selected: SplitSegment[] = []
  for (const id of ids) {
    const segment = byId.get(id)
    if (!segment) {
      diagnostics.push(`${itemLabel}引用了不存在的片段 ${id}。`)
      continue
    }
    reserveSegmentRange(used, segment, 0, segment.text.length, diagnostics, itemLabel)
    selected.push(segment)
  }
  return selected.sort((left, right) => left.start - right.start)
}

function reconstruct(segments: SplitSegment[]) {
  return segments.map((segment) => segment.text).join('').trim()
}

function reconstructField(segments: SplitSegment[], spans: InlineSpan[]) {
  const pieces = [
    ...segments.map((segment) => ({ start: segment.start, end: segment.end, text: segment.text })),
    ...spans.map((span) => ({ start: span.segment.start + span.start, end: span.segment.start + span.end, text: span.text })),
  ].sort((left, right) => left.start - right.start || left.end - right.end)
  let value = ''
  let previousEnd = -1
  for (const piece of pieces) {
    if (value && piece.start > previousEnd && !value.endsWith('\n')) value += '\n'
    value += piece.text
    previousEnd = Math.max(previousEnd, piece.end)
  }
  return value.trim()
}

function modelAnswerDraft(item: SplitItem) {
  // `answer_source_text` is accepted only for previews created with the former
  // contract. It is now a draft answer rather than a source-slicing instruction:
  // answers may appear at the beginning, middle, or end of an explanation.
  const answerText = typeof item.answer_text === 'string'
    ? item.answer_text.trim()
    : typeof item.answer_source_text === 'string' ? item.answer_source_text.trim() : ''
  const evidenceText = typeof item.answer_evidence_text === 'string'
    ? item.answer_evidence_text.trim()
    : answerText
  return { answerText, evidenceText }
}

type CleanupField = 'stem' | 'answer' | 'analysis'
type CleanupOperation = {
  field: CleanupField
  action: 'trim_prefix' | 'remove'
  exactText: string
  reason: string
}

function cleanupOperations(item: SplitItem): CleanupOperation[] {
  const operations: CleanupOperation[] = []
  if (Array.isArray(item.cleanup_operations)) {
    for (const raw of item.cleanup_operations) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const record = raw as Record<string, unknown>
      const field = String(record.field || '').trim()
      const action = String(record.action || '').trim()
      const exactText = typeof record.exact_text === 'string' ? record.exact_text : ''
      if (!['stem', 'answer', 'analysis'].includes(field) || !['trim_prefix', 'remove'].includes(action) || !exactText) continue
      operations.push({
        field: field as CleanupField,
        action: action as CleanupOperation['action'],
        exactText,
        reason: typeof record.reason === 'string' ? record.reason.trim() : '',
      })
    }
  }
  // Backwards compatibility for previews generated with the first v4 contract.
  if (typeof item.analysis_trim_prefix === 'string' && item.analysis_trim_prefix) {
    operations.push({ field: 'analysis', action: 'trim_prefix', exactText: item.analysis_trim_prefix, reason: '解析行首题号或答案标识' })
  }
  return operations
}

export function cleanupFieldDraft(field: CleanupField, value: string, operations: CleanupOperation[]) {
  let draft = String(value || '').trim()
  const notes: string[] = []
  for (const operation of operations) {
    if (operation.field !== field || !draft) continue
    // A figure marker is a source asset reference, never presentation noise.
    if (figureMarkerIds(operation.exactText).length > 0) continue
    if (operation.action === 'trim_prefix') {
      if (!draft.startsWith(operation.exactText)) continue
      const next = draft.slice(operation.exactText.length).trimStart()
      if (!next) continue
      draft = next
    } else {
      const first = draft.indexOf(operation.exactText)
      if (first < 0 || draft.indexOf(operation.exactText, first + operation.exactText.length) >= 0) continue
      draft = `${draft.slice(0, first)}${draft.slice(first + operation.exactText.length)}`
    }
    const label = operation.action === 'trim_prefix' ? '剥离行首内容' : '移除内部内容'
    notes.push(`${label}${operation.reason ? `：${operation.reason}` : ''}`)
  }
  return { value: draft.trim(), notes }
}

type ModelQuestionType = 'single_choice' | 'multiple_choice' | 'fill_blank' | 'short_answer' | 'proof' | 'other'
type VerifiedChoiceOption = { label: 'A' | 'B' | 'C' | 'D'; content: string; sourceText: string }

function modelQuestionType(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  const allowed: ModelQuestionType[] = ['single_choice', 'multiple_choice', 'fill_blank', 'short_answer', 'proof', 'other']
  if (!allowed.includes(normalized as ModelQuestionType)) return ''
  switch (normalized as ModelQuestionType) {
    case 'single_choice': return '单选题'
    case 'multiple_choice': return '多选题'
    case 'fill_blank': return '填空题'
    case 'short_answer':
    case 'proof': return '解答题'
    default: return ''
  }
}

function countExactOccurrences(source: string, fragment: string) {
  if (!fragment) return 0
  let count = 0
  let offset = 0
  while (true) {
    const found = source.indexOf(fragment, offset)
    if (found < 0) return count
    count += 1
    offset = found + fragment.length
  }
}

function sourceOptionContent(label: string, sourceText: string) {
  return sourceText.replace(new RegExp(`^\\s*${label}\\s*[.．、:：)）]\\s*`, 'i'), '').trim()
}

/**
 * The model may recognize inline A-D options, but is never trusted to rewrite
 * them. We only convert the editor draft when every option can be located once
 * in the selected OCR source and in the post-cleanup draft, in A-D order.
 */
function verifiedChoiceOptions(item: SplitItem, sourceStem: string, draftStem: string) {
  if (!Array.isArray(item.options) || item.options.length !== 4) return null
  const options: VerifiedChoiceOption[] = []
  for (const [index, raw] of item.options.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const record = raw as Record<string, unknown>
    const label = String(record.label || '').trim().toUpperCase()
    const expectedLabel = String.fromCharCode(65 + index) as VerifiedChoiceOption['label']
    const sourceText = typeof record.source_text === 'string' ? record.source_text.trim() : ''
    const content = typeof record.content_markdown === 'string' ? record.content_markdown.trim() : ''
    const exactContent = sourceOptionContent(expectedLabel, sourceText)
    if (label !== expectedLabel || !sourceText || !exactContent || content !== exactContent) return null
    if (countExactOccurrences(sourceStem, sourceText) !== 1 || countExactOccurrences(draftStem, sourceText) !== 1) return null
    options.push({ label: expectedLabel, content: exactContent, sourceText })
  }

  const positions = options.map((option) => draftStem.indexOf(option.sourceText))
  if (positions.some((position) => position < 0) || positions.some((position, index) => index > 0 && position <= positions[index - 1])) return null
  let previousEnd = positions[0]
  for (const option of options) {
    const position = draftStem.indexOf(option.sourceText)
    if (!/^\s*$/.test(draftStem.slice(previousEnd, position))) return null
    previousEnd = position + option.sourceText.length
  }
  return { options, firstStart: positions[0], finalEnd: previousEnd }
}

function structureVerifiedChoiceOptions(item: SplitItem, sourceStem: string, draftStem: string) {
  const verified = verifiedChoiceOptions(item, sourceStem, draftStem)
  if (!verified) return { stemMarkdown: draftStem, applied: false }
  const before = draftStem.slice(0, verified.firstStart).trimEnd()
  const after = draftStem.slice(verified.finalEnd).trim()
  const choices = verified.options.map((option) => `${option.label}. ${option.content}`).join('\n')
  return {
    stemMarkdown: [before, choices, after].filter(Boolean).join('\n\n').trim(),
    applied: true,
  }
}

function structureDirectChoiceOptions(item: SplitItem, sourceStem: string, draftStem: string) {
  if (!Array.isArray(item.options) || item.options.length !== 4) return { stemMarkdown: draftStem, applied: false }
  const options: VerifiedChoiceOption[] = []
  for (const [index, raw] of item.options.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { stemMarkdown: draftStem, applied: false }
    const record = raw as Record<string, unknown>
    const label = String(record.label || '').trim().toUpperCase()
    const expectedLabel = String.fromCharCode(65 + index) as VerifiedChoiceOption['label']
    const sourceText = typeof record.source_text === 'string' ? record.source_text.trim() : ''
    const content = typeof record.content_markdown === 'string' ? record.content_markdown.trim() : ''
    const exactContent = sourceOptionContent(expectedLabel, sourceText)
    if (label !== expectedLabel || !sourceText || !exactContent || content !== exactContent || countExactOccurrences(sourceStem, sourceText) !== 1) {
      return { stemMarkdown: draftStem, applied: false }
    }
    options.push({ label: expectedLabel, content: exactContent, sourceText })
  }
  // Models occasionally keep the original inline options in stem_markdown as
  // well as returning `options`. Remove only those exact, source-verified
  // strings, then append the canonical editor representation once.
  let body = draftStem
  for (const option of options) {
    const index = body.indexOf(option.sourceText)
    if (index >= 0) body = `${body.slice(0, index)}${body.slice(index + option.sourceText.length)}`
  }
  return {
    stemMarkdown: [body.trim(), options.map((option) => `${option.label}. ${option.content}`).join('\n')].filter(Boolean).join('\n\n'),
    applied: true,
  }
}

function directModelIssues(value: unknown): QuestionCandidate['issues'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const record = raw as Record<string, unknown>
    const message = typeof record.message === 'string' ? record.message.trim() : ''
    return message ? [{ code: 'manual_review_required' as const, severity: 'warning' as const, message }] : []
  })
}

type ModelSuggestedReplacement = ModelSplitPreviewItem['suggestedReplacements'][number]

function suggestedReplacements(value: unknown): ModelSuggestedReplacement[] {
  if (!Array.isArray(value)) return []
  const fieldMap: Record<string, ModelSuggestedReplacement['field']> = {
    stem: 'stemMarkdown',
    answer: 'answerText',
    analysis: 'analysisMarkdown',
  }
  const seen = new Set<string>()
  const replacements: ModelSuggestedReplacement[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const record = raw as Record<string, unknown>
    const field = fieldMap[String(record.field || '').trim()]
    const exactText = typeof record.exact_text === 'string' ? record.exact_text.trim() : ''
    const replacementText = typeof record.replacement_text === 'string' ? record.replacement_text.trim() : ''
    const reason = typeof record.reason === 'string' ? record.reason.trim() : ''
    // Suggestions are only a compact, field-local manual action. They cannot
    // introduce a giant rewritten answer or silently remove a whole field.
    if (!field || !exactText || !replacementText || exactText === replacementText || exactText.length > 800 || replacementText.length > 800) continue
    const key = `${field}\u0000${exactText}\u0000${replacementText}`
    if (seen.has(key)) continue
    seen.add(key)
    replacements.push({ field, exactText, replacementText, reason: reason || '模型建议替换 OCR 疑似误识别文本' })
  }
  return replacements.slice(0, 8)
}

function isAnswerEvidenceInSource(answerText: string, evidenceText: string, sourceMarkdown: string) {
  if (!answerText || !sourceMarkdown) return true
  const source = compactEvidenceText(sourceMarkdown)
  const evidence = compactEvidenceText(evidenceText || answerText)
  return Boolean(evidence) && source.includes(evidence)
}

function figureMarkerIds(value: string) {
  return Array.from(String(value || '').matchAll(/<!--[ \t]*DOC2X_FIGURE:([^>\s]+)[ \t]*-->/gi), (match) => match[1])
}

function rangesForSegments(document: OCRDocument, segments: SplitSegment[], kind: CandidateSourceRef['kind']) {
  return segments.flatMap((segment) => sourceRefsForRange(document, { start: segment.start, end: segment.end }, kind))
}

function removeLeadingQuestionMarker(value: string) {
  return sourceAfterQuestionMarker(value).trim()
}

function candidateFromModelItem(
  item: SplitItem,
  role: ModelSplitRole,
  document: OCRDocument,
  segments: SplitSegment[],
  metadata: ReturnType<typeof normalizeImportMetadata>,
  used: SegmentAllocations,
  diagnostics: string[],
) {
  const byId = new Map(segments.map((segment) => [segment.id, segment]))
  const label = `第 ${String(item.normalized_question_no || item.question_no || item.raw_question_no || '?')} 题`
  const stemSegments = selectedSegments(stringList(item.stem_segment_ids), byId, used, diagnostics, `${label}题干`)
  const solutionSegments = selectedSegments(stringList(item.solution_segment_ids), byId, used, diagnostics, `${label}答案解析`)
  const answerSegments = selectedSegments(stringList(item.answer_segment_ids), byId, used, diagnostics, `${label}答案`)
  const analysisSegments = selectedSegments(stringList(item.analysis_segment_ids), byId, used, diagnostics, `${label}解析`)
  // Keep reading the former span shape so previews created before this request
  // contract change remain reviewable.
  const answerSpans = inlineSpans(item.answer_inline_spans, segments, used, diagnostics, `${label}答案`)
  const analysisSpans = inlineSpans(item.analysis_inline_spans, segments, used, diagnostics, `${label}解析`)
  const questionNo = normalizeQuestionNo(item.normalized_question_no || item.question_no || item.raw_question_no)
  const rawQuestionNo = normalizeQuestionNo(item.raw_question_no || item.question_no)
  const repair = item.number_repair && item.number_repair.applied === true && rawQuestionNo && questionNo && rawQuestionNo !== questionNo
    ? { reason: String(item.number_repair.reason || '模型修复题号'), confidence: Math.max(0, Math.min(1, Number(item.number_repair.confidence || 0))) }
    : undefined
  // In direct mode `source_line_ranges` are materialized into stem segments
  // for every document role. Keep that OCR slice separately from its semantic
  // destination: in a solutions document it is source *solution*, not stem.
  const directSourceMarkdown = reconstructField(stemSegments, [])
  const sourceStemMarkdown = role === 'solutions' ? '' : directSourceMarkdown
  const directQuestionDraft = role === 'questions' && typeof item.stem_markdown === 'string'
  const directSolutionDraft = role === 'solutions' && typeof item.analysis_markdown === 'string'
  const directFullDraft = role === 'full' && typeof item.stem_markdown === 'string' && typeof item.analysis_markdown === 'string'
  const usesDirectDraft = directQuestionDraft || directSolutionDraft || directFullDraft
  const operations = cleanupOperations(item)
  // Stem cleanup runs after the project's standard question-number removal, so
  // the model can quote only a score label such as `(5分)` instead of guessing
  // how the OCR encoded the question number.
  const stemCleanup = cleanupFieldDraft('stem', role === 'solutions' ? '' : removeLeadingQuestionMarker(sourceStemMarkdown), operations)
  const structuredChoices = role === 'solutions'
    ? { stemMarkdown: '', applied: false }
    : (directQuestionDraft || directFullDraft)
      ? structureDirectChoiceOptions(item, sourceStemMarkdown, String(item.stem_markdown || '').trim())
      : structureVerifiedChoiceOptions(item, sourceStemMarkdown, stemCleanup.value)
  const stemMarkdown = structuredChoices.stemMarkdown
  // The model identifies complete source ranges and may mark exact source text
  // for presentation cleanup. The raw source stays intact for comparison.
  const sourceSolutionMarkdown = role === 'questions' ? '' : usesDirectDraft ? directSourceMarkdown : reconstructField(solutionSegments, [])
  const answerDraft = role === 'questions' ? { answerText: '', evidenceText: '' } : modelAnswerDraft(item)
  const rawAnswerText = role === 'questions'
    ? ''
    : answerDraft.answerText || reconstructField(answerSegments, answerSpans)
  const answerCleanup = cleanupFieldDraft('answer', rawAnswerText, operations)
  const answerText = answerCleanup.value
  const analysisCleanup = cleanupFieldDraft('analysis', role === 'questions'
    ? ''
    : (directSolutionDraft || directFullDraft) ? String(item.analysis_markdown || '').trim() : sourceSolutionMarkdown || reconstructField(analysisSegments, analysisSpans), operations)
  const analysisMarkdown = role === 'questions'
    ? ''
    : analysisCleanup.value
  const cleanupNotes = [
    ...stemCleanup.notes,
    ...(usesDirectDraft ? [role === 'questions'
      ? '模型已直接生成可编辑题干与选项；右侧保留完整 OCR 原稿对照'
      : role === 'solutions'
        ? '模型已直接生成可编辑答案与解析；右侧保留完整 OCR 原稿对照'
        : '模型已直接生成可编辑题干、答案与解析；右侧保留完整 OCR 原稿对照'] : []),
    ...(structuredChoices.applied ? ['已根据 OCR 原文核验并结构化 A、B、C、D 选项'] : []),
    ...answerCleanup.notes,
    ...analysisCleanup.notes,
  ]
  const answerEvidenceVerified = usesDirectDraft || isAnswerEvidenceInSource(answerText, answerDraft.evidenceText, sourceSolutionMarkdown)
  const sourceRefs = [
    ...rangesForSegments(document, stemSegments, role === 'solutions' ? 'analysis' : 'stem'),
    ...rangesForSegments(document, solutionSegments, 'answer'),
    ...rangesForSegments(document, solutionSegments, 'analysis'),
    ...rangesForSegments(document, answerSegments, 'answer'),
    ...rangesForSegments(document, analysisSegments, 'analysis'),
    ...rangesForSegments(document, answerSpans.map((span) => span.segment), 'answer'),
    ...rangesForSegments(document, analysisSpans.map((span) => span.segment), 'analysis'),
  ]
  const figures = [
    ...stemSegments.flatMap((segment) => figuresForRange(document, { start: segment.start, end: segment.end }, role === 'solutions' ? 'analysis' : 'stem')),
    ...solutionSegments.flatMap((segment) => figuresForRange(document, { start: segment.start, end: segment.end }, 'analysis')),
    ...answerSegments.flatMap((segment) => figuresForRange(document, { start: segment.start, end: segment.end }, 'analysis')),
    ...analysisSegments.flatMap((segment) => figuresForRange(document, { start: segment.start, end: segment.end }, 'analysis')),
    ...answerSpans.flatMap((span) => figuresForRange(document, { start: span.segment.start, end: span.segment.end }, 'analysis')),
    ...analysisSpans.flatMap((span) => figuresForRange(document, { start: span.segment.start, end: span.segment.end }, 'analysis')),
  ]
  const issues: QuestionCandidate['issues'] = directModelIssues(item.issues)
  const modelSuggestedReplacements = suggestedReplacements(item.suggested_replacements)
  if (!questionNo) issues.push({ code: 'missing_question_no', severity: 'error', message: `${label}缺少题号。` })
  if (!stemMarkdown && role !== 'solutions') issues.push({ code: 'missing_stem', severity: 'error', message: `${label}缺少题干。` })
  if (!answerEvidenceVerified) {
    issues.push({
      code: 'model_source_fragment_unverified',
      severity: 'warning',
      message: `${label}的模型答案草稿未在所选 OCR 原稿中找到完整证据。结果已保留，请在右侧原稿对照后确认。`,
    })
  }
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
    questionType: normalizeQuestionType(modelQuestionType(item.question_type), stemMarkdown, answerText),
    knowledgePoints: [],
    solutionMethods: [],
    ...DEFAULT_IMPORT_METADATA,
    ...metadata,
    figures,
    sourceRefs,
    status: 'needs_review',
    issues,
    parseDiagnostics: [
      ...(repair ? [{ code: 'model_repaired_question_no', severity: repair.confidence >= 0.8 ? 'info' as const : 'warning' as const, questionNo, message: `模型根据上下文将 OCR 题号「${rawQuestionNo}」修复为「${questionNo}」：${repair.reason}` }] : []),
      ...(!answerEvidenceVerified ? [{ code: 'model_source_fragment_unverified', severity: 'warning' as const, questionNo, message: `${label}的模型答案草稿未在所选 OCR 原稿中找到完整证据。已保留草稿，需人工确认。` }] : []),
    ],
    // This field is reserved for the public parser configuration schema. Model
    // split provenance belongs in diagnostics so candidate response validation
    // stays compatible with ordinary parser-created candidates.
    parserConfigSnapshot: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const filled = fillDoc2xFigures(document, candidate.stemMarkdown, candidate.answerText, candidate.analysisMarkdown, candidate.figures)
  candidate.figures = filled.figures
  candidate.status = statusForIssues(candidate.issues)
  return {
    candidate,
    preview: {
      questionNo,
      questionType: candidate.questionType,
      rawQuestionNo: rawQuestionNo || undefined,
      numberRepair: repair,
      stemMarkdown,
      answerText,
      analysisMarkdown,
      sourceStemMarkdown,
      sourceSolutionMarkdown,
      cleanupNotes,
      suggestedReplacements: modelSuggestedReplacements,
      sourceRefs,
      issues: candidate.issues,
    },
  }
}

function compactEvidenceText(value: string) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, '')
}

function plainTableCell(value: string) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .trim()
}

function answerFromTableRows(rows: string[][], questionNo: string) {
  const questionRow = rows.find((row) => /题号/.test(row[0] || ''))
  const answerRow = rows.find((row) => /答案/.test(row[0] || ''))
  if (!questionRow || !answerRow) return { recognized: false as const }
  const column = questionRow.findIndex((cell, index) => index > 0 && normalizeQuestionNo(cell) === questionNo)
  return { recognized: true as const, answerText: column > 0 ? String(answerRow[column] || '').trim() : '' }
}

function answerEvidenceForQuestion(evidenceText: string, questionNo: string) {
  const htmlRows = Array.from(evidenceText.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi), (rowMatch) =>
    Array.from(rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi), (cellMatch) => plainTableCell(cellMatch[1])),
  ).filter((row) => row.length > 0)
  if (htmlRows.length > 0) return answerFromTableRows(htmlRows, questionNo)

  const markdownRows = evidenceText.split(/\r?\n/)
    .filter((line) => line.includes('|'))
    .map((line) => line.split('|').map(plainTableCell).filter((cell, index, cells) => cell || (index > 0 && index < cells.length - 1)))
    .filter((row) => row.length > 1 && !row.every((cell) => /^:?-{2,}:?$/.test(cell)))
  if (markdownRows.length > 0) return answerFromTableRows(markdownRows, questionNo)
  return { recognized: false as const }
}

function segmentsForEvidenceRanges(value: unknown, segments: SplitSegment[]) {
  const ranges = lineRanges(value)
  if (!ranges.length || ranges.some(([start, end]) => start < 1 || end < start || end > segments.length)) return []
  const ids = segmentIdsForRanges(ranges, segments)
  const byId = new Map(segments.map((segment) => [segment.id, segment]))
  return ids.map((id) => byId.get(id)).filter((segment): segment is SplitSegment => Boolean(segment))
}

function applyAnswerTableEntries(
  rawEntries: unknown,
  document: OCRDocument,
  segments: SplitSegment[],
  candidates: QuestionCandidate[],
  previews: ModelSplitPreviewItem[],
) {
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) return [] as string[]
  const verified = new Map<string, { answerText: string; evidenceSegments: SplitSegment[] }>()
  const conflicts = new Set<string>()
  let rejectedCount = 0

  for (const rawEntry of rawEntries) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      rejectedCount += 1
      continue
    }
    const entry = rawEntry as AnswerTableEntry
    const questionNo = normalizeQuestionNo(entry.question_no)
    const answerText = String(entry.answer_text || '').trim()
    const evidenceSegments = segmentsForEvidenceRanges(entry.source_line_ranges, segments)
    const evidenceText = reconstruct(evidenceSegments)
    const tableEvidence = answerEvidenceForQuestion(evidenceText, questionNo)
    const evidenceMatches = tableEvidence.recognized
      ? Boolean(tableEvidence.answerText) && compactEvidenceText(tableEvidence.answerText) === compactEvidenceText(answerText)
      : compactEvidenceText(evidenceText).includes(compactEvidenceText(answerText))
    if (!questionNo || !answerText || !evidenceSegments.length || !evidenceMatches) {
      rejectedCount += 1
      continue
    }
    const existing = verified.get(questionNo)
    if (existing && compactEvidenceText(existing.answerText) !== compactEvidenceText(answerText)) {
      conflicts.add(questionNo)
      verified.delete(questionNo)
      continue
    }
    if (!conflicts.has(questionNo)) verified.set(questionNo, { answerText, evidenceSegments })
  }

  const warnings: string[] = []
  let filledCount = 0
  for (const [questionNo, entry] of verified) {
    const candidate = candidates.find((item) => item.questionNo === questionNo)
    const preview = previews.find((item) => item.questionNo === questionNo)
    if (!candidate || !preview) {
      rejectedCount += 1
      continue
    }
    if (candidate.answerText.trim()) {
      if (compactEvidenceText(candidate.answerText) !== compactEvidenceText(entry.answerText)) {
        warnings.push(`第 ${questionNo} 题的独立答案与汇总答案表不一致，已保留独立答案，请人工复核。`)
      }
      continue
    }
    const sourceRefs = rangesForSegments(document, entry.evidenceSegments, 'answer')
    candidate.answerText = entry.answerText
    candidate.sourceRefs.push(...sourceRefs)
    candidate.issues = candidate.issues.filter((issue) => issue.code !== 'missing_answer')
    candidate.parseDiagnostics.push({
      code: 'model_answer_table_match',
      severity: 'info',
      questionNo,
      message: `已从 OCR 汇总答案表提取并核验第 ${questionNo} 题答案。`,
    })
    candidate.status = statusForIssues(candidate.issues)
    candidate.updatedAt = nowIso()
    preview.answerText = entry.answerText
    preview.sourceRefs.push(...sourceRefs)
    preview.issues = preview.issues.filter((issue) => issue.code !== 'missing_answer')
    filledCount += 1
  }

  if (filledCount > 0) warnings.unshift(`已从汇总答案表识别并填入 ${filledCount} 道题的答案，答案均通过 OCR 原文行号核验。`)
  if (conflicts.size > 0) warnings.push(`汇总答案表中有 ${conflicts.size} 道题出现互相冲突的答案，未自动填入，请人工复核。`)
  if (rejectedCount > 0) warnings.push(`有 ${rejectedCount} 条答案表映射缺少有效原文证据，未自动填入。`)
  return warnings
}

function mergeSeparatedCandidates(
  questionCandidates: QuestionCandidate[],
  solutionCandidates: QuestionCandidate[],
  questionPreviews?: ModelSplitPreviewItem[],
  solutionPreviews?: ModelSplitPreviewItem[],
) {
  const solutions = new Map(solutionCandidates.map((candidate) => [candidate.questionNo, candidate]))
  const solutionPreviewByQuestionNo = new Map((solutionPreviews || []).map((preview) => [preview.questionNo, preview]))
  const questionPreviewByQuestionNo = new Map((questionPreviews || []).map((preview) => [preview.questionNo, preview]))
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
    for (const issue of solution.issues) {
      if (!question.issues.some((existing) => existing.code === issue.code && existing.message === issue.message)) question.issues.push(issue)
    }
    for (const diagnostic of solution.parseDiagnostics) {
      if (!question.parseDiagnostics.some((existing) => existing.code === diagnostic.code && existing.message === diagnostic.message)) question.parseDiagnostics.push(diagnostic)
    }
    if (question.parseDiagnostics.length === 0 && solution.parseDiagnostics.length > 0) question.parseDiagnostics = solution.parseDiagnostics
    const questionPreview = questionPreviewByQuestionNo.get(question.questionNo)
    const solutionPreview = solutionPreviewByQuestionNo.get(question.questionNo)
    if (questionPreview && solutionPreview) {
      // The final review dialog must compare the cleaned solution draft with
      // the solution OCR, not with an already-cleaned candidate field.
      questionPreview.sourceSolutionMarkdown = solutionPreview.sourceSolutionMarkdown
      questionPreview.cleanupNotes = [...questionPreview.cleanupNotes, ...solutionPreview.cleanupNotes]
      questionPreview.suggestedReplacements = [...questionPreview.suggestedReplacements, ...solutionPreview.suggestedReplacements]
    }
  }
  for (const solution of solutionCandidates) {
    if (!questionCandidates.some((question) => question.questionNo === solution.questionNo)) diagnostics.push(`解析文档中的第 ${solution.questionNo || '未知'} 题未匹配到原卷题干。`)
  }
  return diagnostics
}

function finalizeCandidatePreviews(candidates: QuestionCandidate[], previewSeeds: ModelSplitPreviewItem[]) {
  const counts = new Map<string, number>()
  for (const candidate of candidates) {
    if (candidate.questionNo) counts.set(candidate.questionNo, (counts.get(candidate.questionNo) || 0) + 1)
  }
  const duplicateQuestionNos = new Set([...counts].filter(([, count]) => count > 1).map(([questionNo]) => questionNo))
  const diagnostics = [...duplicateQuestionNos].map((questionNo) => `检测到重复题号 ${questionNo}，请人工确认。`)

  const previews = candidates.map((candidate, index) => {
    candidate.issues = validateQuestionCandidate(candidate, duplicateQuestionNos)
    if (candidate.questionNo && duplicateQuestionNos.has(candidate.questionNo)) {
      const message = `检测到重复题号 ${candidate.questionNo}，请人工确认。`
      if (!candidate.parseDiagnostics.some((item) => item.code === 'model_duplicate_question_no' && item.questionNo === candidate.questionNo)) {
        candidate.parseDiagnostics.push({ code: 'model_duplicate_question_no', severity: 'error', questionNo: candidate.questionNo, message })
      }
    }
    candidate.status = statusForIssues(candidate.issues)
    const seed = previewSeeds[index]
    return {
      questionNo: candidate.questionNo,
      questionType: candidate.questionType,
      rawQuestionNo: seed?.rawQuestionNo,
      numberRepair: seed?.numberRepair,
      stemMarkdown: candidate.stemMarkdown,
      answerText: candidate.answerText,
      analysisMarkdown: candidate.analysisMarkdown,
      sourceStemMarkdown: seed?.sourceStemMarkdown || candidate.stemMarkdown,
      sourceSolutionMarkdown: seed?.sourceSolutionMarkdown || candidate.analysisMarkdown,
      cleanupNotes: seed?.cleanupNotes || [],
      suggestedReplacements: seed?.suggestedReplacements || [],
      sourceRefs: candidate.sourceRefs,
      issues: candidate.issues,
    }
  })
  return { previews, diagnostics }
}

async function splitDocument(role: ModelSplitRole, document: OCRDocument, metadata: ReturnType<typeof normalizeImportMetadata>, options: ModelSplitOptions) {
  const segments = segmentsForDocument(document)
  const result = await callModel(role, segments, options)
  const sanitized = sanitizeSharedAggregateSegments(attachAdjacentFigureMarkers((Array.isArray(result.items) ? result.items as SplitItem[] : []).map((item) => materializeLineRangeItem(item, segments)), segments))
  const items = sanitized.items
  if (!items.length) throw new RouteError(502, '拆题模型没有返回题目。')
  const used: SegmentAllocations = new Map()
  const diagnostics: string[] = []
  const candidates: QuestionCandidate[] = []
  const previews: ModelSplitPreviewItem[] = []
  for (const item of items) {
    const built = candidateFromModelItem(item, role, document, segments, metadata, used, diagnostics)
    candidates.push(built.candidate)
    previews.push(built.preview)
  }
  const answerTableWarnings = applyAnswerTableEntries(result.answer_table_entries, document, segments, candidates, previews)
  const finalized = role === 'solutions' ? { previews, diagnostics: [] as string[] } : finalizeCandidatePreviews(candidates, previews)
  diagnostics.push(...finalized.diagnostics)
  const sourceMarkerIds = new Set(figureMarkerIds(document.markdown))
  const assignedMarkerIds = new Set(candidates.flatMap((candidate) => figureMarkerIds(`${candidate.stemMarkdown}\n${candidate.answerText}\n${candidate.analysisMarkdown}`)))
  const markerWarnings: string[] = []
  for (const markerId of sourceMarkerIds) {
    if (!assignedMarkerIds.has(markerId)) markerWarnings.push(`图片标识符 ${markerId} 未被模型分配到单题，已原样保留在 OCR 识别稿中，请按需人工确认归属。`)
  }
  return { candidates, previews: finalized.previews, diagnostics, warnings: [...answerTableWarnings, ...(Array.isArray(result.warnings) ? result.warnings.map((value) => String(value || '')).filter(Boolean) : []), ...sanitized.warnings, ...markerWarnings] }
}

async function splitDocumentStream(
  role: ModelSplitRole,
  document: OCRDocument,
  segments: SplitSegment[],
  metadata: ReturnType<typeof normalizeImportMetadata>,
  options: ModelSplitOptions,
  onItem: (index: number, item: ModelSplitPreviewItem) => void,
  signal?: AbortSignal,
) {
  const used: SegmentAllocations = new Map()
  const diagnostics: string[] = []
  const candidates: QuestionCandidate[] = []
  const itemPreviews: ModelSplitPreviewItem[] = []
  const result = await callModelStream(role, segments, options, (item) => {
    const materialized = attachAdjacentFigureMarkers([materializeLineRangeItem(item, segments)], segments)[0]
    const built = candidateFromModelItem(materialized, role, document, segments, metadata, used, diagnostics)
    const index = itemPreviews.length
    candidates.push(built.candidate)
    itemPreviews.push(built.preview)
    onItem(index, built.preview)
  }, signal)
  const sanitized = sanitizeSharedAggregateSegments(attachAdjacentFigureMarkers((Array.isArray(result.items) ? result.items as SplitItem[] : []).map((item) => materializeLineRangeItem(item, segments)), segments))
  if (!sanitized.items.length) throw new RouteError(502, '拆题模型没有返回题目。')
  const finalUsed: SegmentAllocations = new Map()
  const finalDiagnostics: string[] = []
  const finalCandidates: QuestionCandidate[] = []
  const finalPreviews: ModelSplitPreviewItem[] = []
  for (const item of sanitized.items) {
    const built = candidateFromModelItem(item, role, document, segments, metadata, finalUsed, finalDiagnostics)
    finalCandidates.push(built.candidate)
    finalPreviews.push(built.preview)
  }
  diagnostics.splice(0, diagnostics.length, ...finalDiagnostics)
  candidates.splice(0, candidates.length, ...finalCandidates)
  itemPreviews.splice(0, itemPreviews.length, ...finalPreviews)
  const answerTableWarnings = applyAnswerTableEntries(result.answer_table_entries, document, segments, candidates, itemPreviews)
  const finalized = role === 'solutions' ? { previews: itemPreviews, diagnostics: [] as string[] } : finalizeCandidatePreviews(candidates, itemPreviews)
  diagnostics.push(...finalized.diagnostics)
  const sourceMarkerIds = new Set(figureMarkerIds(document.markdown))
  const assignedMarkerIds = new Set(candidates.flatMap((candidate) => figureMarkerIds(`${candidate.stemMarkdown}\n${candidate.answerText}\n${candidate.analysisMarkdown}`)))
  const markerWarnings: string[] = []
  for (const markerId of sourceMarkerIds) {
    if (!assignedMarkerIds.has(markerId)) markerWarnings.push(`图片标识符 ${markerId} 未被模型分配到单题，已原样保留在 OCR 识别稿中，请按需人工确认归属。`)
  }
  return {
    candidates,
    previews: finalized.previews,
    diagnostics,
    warnings: [...answerTableWarnings, ...(Array.isArray(result.warnings) ? result.warnings.map((value) => String(value || '')).filter(Boolean) : []), ...sanitized.warnings, ...markerWarnings],
  }
}

export async function createModelSplitPreviewStream(jobId: string, body: unknown, emit: (event: ModelSplitStreamEvent) => void, signal?: AbortSignal) {
  const job = requireImportJob(jobId)
  const options = normalizeModelSplitOptions(body)
  const documents = importJobRepo.listImportJobDocuments(jobId)
  if (documents.length === 0) throw new RouteError(400, '导入批次没有关联资料。')
  const committed = documents.some((document) => (sourceRepo.getSourceDocument(document.sourceDocumentId)?.importStats?.committedCount || 0) > 0)
  if (committed) throw new RouteError(409, '该批次已有题目入库，暂不支持模型辅助拆题。')
  const questionDocument = firstDocumentByRole(documents, job.mode === 'single_document' ? 'full' : 'questions')
  if (!questionDocument) throw new RouteError(400, '导入批次缺少原卷 OCR 文档。')
  const questionSource = requireSourceDocument(questionDocument.sourceDocumentId)
  const questionOcr = loadOcrDocument(latestOcrDocumentForSource(questionSource.id).id)
  const questionRole = roleForJobDocument(job, questionDocument)
  const questionSegments = segmentsForDocument(questionOcr)
  const metadata = metadataForCandidates(job, questionSource)

  if (job.mode === 'single_document') {
    emit({ event: 'started', data: { mode: job.mode, documents: [{ role: questionRole, totalLines: questionSegments.length }] } })
    const result = await splitDocumentStream(questionRole, questionOcr, questionSegments, metadata, options, (index, item) => {
      emit({ event: 'item', data: { role: questionRole, index, item } })
    }, signal)
    for (const message of result.warnings) emit({ event: 'warning', data: { role: questionRole, message } })
    const preview: ModelSplitPreview = { id: randomUUID(), importJobId: job.id, mode: job.mode, items: result.previews, diagnostics: result.diagnostics, warnings: result.warnings, candidates: result.candidates, createdAt: nowIso() }
    previews.set(preview.id, preview)
    emit({ event: 'done', data: preview })
    return preview
  }

  const solutionDocument = firstDocumentByRole(documents, 'solutions')
  if (!solutionDocument) throw new RouteError(400, '导入批次缺少解析 OCR 文档。')
  const solutionSource = requireSourceDocument(solutionDocument.sourceDocumentId)
  const solutionOcr = loadOcrDocument(latestOcrDocumentForSource(solutionSource.id).id)
  const solutionSegments = segmentsForDocument(solutionOcr)
  emit({
    event: 'started',
    data: {
      mode: job.mode,
      documents: [
        { role: questionRole, totalLines: questionSegments.length },
        { role: 'solutions', totalLines: solutionSegments.length },
      ],
    },
  })
  const parallelController = new AbortController()
  const parallelSignal = signal ? AbortSignal.any([signal, parallelController.signal]) : parallelController.signal
  let results: [Awaited<ReturnType<typeof splitDocumentStream>>, Awaited<ReturnType<typeof splitDocumentStream>>]
  try {
    results = await Promise.all([
      splitDocumentStream(questionRole, questionOcr, questionSegments, metadata, options, (index, item) => {
        emit({ event: 'item', data: { role: questionRole, index, item } })
      }, parallelSignal),
      splitDocumentStream('solutions', solutionOcr, solutionSegments, metadata, options, (index, item) => {
        emit({ event: 'item', data: { role: 'solutions', index, item } })
      }, parallelSignal),
    ])
  } catch (error) {
    parallelController.abort()
    throw error
  }
  const [questionResult, solutionResult] = results
  for (const message of questionResult.warnings) emit({ event: 'warning', data: { role: questionRole, message } })
  for (const message of solutionResult.warnings) emit({ event: 'warning', data: { role: 'solutions', message } })
  const mergeDiagnostics = mergeSeparatedCandidates(questionResult.candidates, solutionResult.candidates, questionResult.previews, solutionResult.previews)
  const finalized = finalizeCandidatePreviews(questionResult.candidates, questionResult.previews)
  const preview: ModelSplitPreview = { id: randomUUID(), importJobId: job.id, mode: job.mode, items: finalized.previews, diagnostics: [...questionResult.diagnostics, ...solutionResult.diagnostics, ...mergeDiagnostics, ...finalized.diagnostics], warnings: [...questionResult.warnings, ...solutionResult.warnings], candidates: questionResult.candidates, createdAt: nowIso() }
  previews.set(preview.id, preview)
  emit({ event: 'done', data: preview })
  return preview
}

export async function createModelSplitPreview(jobId: string, body?: unknown) {
  const job = requireImportJob(jobId)
  const options = normalizeModelSplitOptions(body)
  const documents = importJobRepo.listImportJobDocuments(jobId)
  if (documents.length === 0) throw new RouteError(400, '导入批次没有关联资料。')
  const committed = documents.some((document) => (sourceRepo.getSourceDocument(document.sourceDocumentId)?.importStats?.committedCount || 0) > 0)
  if (committed) throw new RouteError(409, '该批次已有题目入库，暂不支持模型辅助拆题。')
  const questionDocument = firstDocumentByRole(documents, job.mode === 'single_document' ? 'full' : 'questions')
  if (!questionDocument) throw new RouteError(400, '导入批次缺少原卷 OCR 文档。')
  const questionSource = requireSourceDocument(questionDocument.sourceDocumentId)
  const questionOcr = loadOcrDocument(latestOcrDocumentForSource(questionSource.id).id)
  const metadata = metadataForCandidates(job, questionSource)
  const questionPromise = splitDocument(roleForJobDocument(job, questionDocument), questionOcr, metadata, options)
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
  const [questionResult, solutionResult] = await Promise.all([questionPromise, splitDocument('solutions', solutionOcr, metadata, options)])
  const mergeDiagnostics = mergeSeparatedCandidates(questionResult.candidates, solutionResult.candidates, questionResult.previews, solutionResult.previews)
  const finalized = finalizeCandidatePreviews(questionResult.candidates, questionResult.previews)
  const preview: ModelSplitPreview = { id: randomUUID(), importJobId: job.id, mode: job.mode, items: finalized.previews, diagnostics: [...questionResult.diagnostics, ...solutionResult.diagnostics, ...mergeDiagnostics, ...finalized.diagnostics], warnings: [...questionResult.warnings, ...solutionResult.warnings], candidates: questionResult.candidates, createdAt: nowIso() }
  previews.set(preview.id, preview)
  return preview
}

type ModelSplitApplyEdit = {
  questionNo?: unknown
  stemMarkdown?: unknown
  answerText?: unknown
  analysisMarkdown?: unknown
}

function editableItemsFromRequest(body: unknown, preview: ModelSplitPreview) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return preview.items.map((item) => ({
    questionNo: item.questionNo,
    stemMarkdown: item.stemMarkdown,
    answerText: item.answerText,
    analysisMarkdown: item.analysisMarkdown,
  }))
  const rawItems = (body as { items?: unknown }).items
  if (rawItems === undefined) return preview.items.map((item) => ({
    questionNo: item.questionNo,
    stemMarkdown: item.stemMarkdown,
    answerText: item.answerText,
    analysisMarkdown: item.analysisMarkdown,
  }))
  if (!Array.isArray(rawItems) || rawItems.length !== preview.items.length) throw new RouteError(400, '模型拆题编辑结果数量已变化，请重新生成预览。')
  return rawItems.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RouteError(400, `第 ${index + 1} 题编辑结果格式不正确。`)
    const item = value as ModelSplitApplyEdit
    const questionNo = normalizeQuestionNo(item.questionNo)
    if (!questionNo) throw new RouteError(400, `第 ${index + 1} 题缺少有效题号。`)
    const text = (field: keyof Pick<ModelSplitApplyEdit, 'stemMarkdown' | 'answerText' | 'analysisMarkdown'>) => {
      if (typeof item[field] !== 'string') throw new RouteError(400, `第 ${index + 1} 题的内容字段不正确。`)
      return item[field] as string
    }
    const edited = { questionNo, stemMarkdown: text('stemMarkdown'), answerText: text('answerText'), analysisMarkdown: text('analysisMarkdown') }
    const originalMarkers = new Set(figureMarkerIds(`${preview.items[index].stemMarkdown}\n${preview.items[index].answerText}\n${preview.items[index].analysisMarkdown}`))
    const editedMarkers = new Set(figureMarkerIds(`${edited.stemMarkdown}\n${edited.answerText}\n${edited.analysisMarkdown}`))
    if (originalMarkers.size !== editedMarkers.size || [...originalMarkers].some((marker) => !editedMarkers.has(marker))) {
      throw new RouteError(400, `第 ${index + 1} 题的图片标识符被修改，请保留 OCR 图片标识符后再应用。`)
    }
    return edited
  })
}

export function applyModelSplitPreview(jobId: string, previewId: string, body?: unknown) {
  const preview = previews.get(previewId)
  if (!preview) throw new RouteError(404, '模型拆题预览已过期，请重新生成。')
  if (preview.importJobId !== jobId) throw new RouteError(404, '模型拆题预览不属于当前导入批次。')
  // Diagnostics describe imperfect model structure (such as overlapping ranges or
  // duplicate numbers). They are deliberately review signals, not an automatic
  // veto: this workflow is a human comparison surface and the user may edit the
  // draft before applying it to the ordinary candidate-review queue.
  const edits = editableItemsFromRequest(body, preview)
  const job = requireImportJob(preview.importJobId)
  const documents = importJobRepo.listImportJobDocuments(job.id)
  const committed = documents.some((document) => (sourceRepo.getSourceDocument(document.sourceDocumentId)?.importStats?.committedCount || 0) > 0)
  if (committed) throw new RouteError(409, '该批次已有题目入库，不能应用模型拆题结果。')
  const questionDocument = firstDocumentByRole(documents, job.mode === 'single_document' ? 'full' : 'questions')
  if (!questionDocument) throw new RouteError(400, '导入批次缺少原卷资料。')
  const questionSource = requireSourceDocument(questionDocument.sourceDocumentId)
  const candidates = preview.candidates.map((candidate, index) => {
    const edit = edits[index]
    if (!edit) return candidate
    return { ...candidate, questionNo: edit.questionNo, stemMarkdown: edit.stemMarkdown, answerText: edit.answerText, analysisMarkdown: edit.analysisMarkdown, updatedAt: nowIso() }
  })
  const result = saveParsedCandidates(job, questionSource, latestOcrDocumentForSource(questionSource.id).id, candidates)
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

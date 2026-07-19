import type { OCRDocument } from '../../types/ocr-document.js'
import type { QuestionCandidate } from '../../types/question-candidate.js'
import {
  defaultParserConfig,
  type ImportFlowV2ParserConfig,
  type SolutionBindingStrategy,
} from './default-parser-config.js'
import { splitMarkdownByQuestionNumbers } from './markdown-question-splitter.js'
import { normalizeParserConfig } from './parser-config.js'
import { detectSolutionQuestionNumbers } from './question-number-detector.js'
import {
  extractInlineAnswerTableBlocks,
  extractInlineAnswerTableEntries,
  firstAnswerTableStart,
  findSolutionSections,
  maskNonSolutionBlocks,
  metadataBlockRanges,
  metadataOnlySolutionBlock,
  splitQuestionFields,
  type MarkdownRange,
  type SolutionMatch,
} from './solution-matcher.js'
import { parseSolutionDocument } from './solution-document.parser.js'

export type MarkdownPreviewResponse = {
  ocrDocumentId: string
  sourceDocumentId: string
  provider: string
  markdown: string
  lineOffsets: Array<{ lineNo: number; start: number; end: number }>
  pageMarkers: Array<{ pageNo: number; offset: number; lineNo: number }>
}

export type MarkdownStructureTokenKind =
  | 'page_marker'
  | 'question_no'
  | 'sub_question_no'
  | 'answer_table'
  | 'solution_heading'
  | 'metadata_heading'
  | 'stem_range'
  | 'answer_range'
  | 'analysis_range'

export type MarkdownStructureToken = {
  id: string
  kind: MarkdownStructureTokenKind
  questionNo?: string
  start: number
  end: number
  lineStart: number
  lineEnd: number
  label: string
  severity?: 'info' | 'warning' | 'error'
}

export type ParserDiagnostic = {
  code:
    | 'solution_heading_without_following_question'
    | 'question_before_solution_heading'
    | 'metadata_used_as_answer'
    | 'table_answer_blocked_by_existing_answer'
    | 'missing_analysis'
    | 'unmatched_solution'
  severity: 'info' | 'warning' | 'error'
  questionNo?: string
  message: string
  start?: number
  end?: number
  suggestedConfigPatch?: Partial<ImportFlowV2ParserConfig>
}

export type CandidateParsePreview = {
  questionNo: string
  stemPreview: string
  answerPreview: string
  analysisPreview: string
  sourceRanges: {
    stem?: MarkdownRange
    answer?: MarkdownRange
    analysis?: MarkdownRange
  }
  issues: ParserDiagnostic[]
}

export type ParserPreviewRequest = {
  config?: Partial<ImportFlowV2ParserConfig>
  focusQuestionNo?: string
  candidateId?: string
  candidateIds?: string[]
}

export type ParserPreviewResponse = {
  config: ImportFlowV2ParserConfig
  strategyRecommendation?: {
    strategy: SolutionBindingStrategy
    reason: string
    confidence: number
  }
  structures: MarkdownStructureToken[]
  candidatePreviews: CandidateParsePreview[]
  diagnostics: ParserDiagnostic[]
}

type LineOffset = MarkdownPreviewResponse['lineOffsets'][number]
type TableAnswerEntry = { questionNo: string; answerText: string; range: MarkdownRange }
type PreviewSolutionMatch = SolutionMatch & {
  stemMarkdown?: string
  stemRange?: MarkdownRange
}

const PAGE_MARKER_RE = /<!--\s*(?:GLM|DOC2X)_PAGE:(\d+)\s*-->/g

function lineOffsetsFor(markdown: string): LineOffset[] {
  const source = String(markdown || '')
  if (!source) return [{ lineNo: 1, start: 0, end: 0 }]
  const lines = source.split(/(?<=\n)/)
  const offsets: LineOffset[] = []
  let cursor = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    offsets.push({ lineNo: index + 1, start: cursor, end: cursor + line.length })
    cursor += line.length
  }
  return offsets
}

function lineNoForOffset(lines: LineOffset[], offset: number) {
  if (!lines.length) return 1
  const last = lines[lines.length - 1]
  const bounded = Math.max(0, Math.min(offset, last.end))
  const found = lines.find((line) => bounded >= line.start && (bounded < line.end || (line.lineNo === last.lineNo && bounded === line.end)))
  return found?.lineNo || last.lineNo
}

function tokenFor(
  lines: LineOffset[],
  input: Omit<MarkdownStructureToken, 'lineStart' | 'lineEnd'>,
): MarkdownStructureToken | null {
  const start = Math.max(0, input.start)
  const end = Math.max(start, input.end)
  if (end <= start) return null
  return {
    ...input,
    start,
    end,
    lineStart: lineNoForOffset(lines, start),
    lineEnd: lineNoForOffset(lines, Math.max(start, end - 1)),
  }
}

function markdownPreviewBase(document: OCRDocument): MarkdownPreviewResponse {
  const markdown = String(document.markdown || '')
  const lineOffsets = lineOffsetsFor(markdown)
  const pageMarkers: MarkdownPreviewResponse['pageMarkers'] = []
  for (const match of markdown.matchAll(PAGE_MARKER_RE)) {
    const offset = match.index || 0
    pageMarkers.push({
      pageNo: Number(match[1] || 0),
      offset,
      lineNo: lineNoForOffset(lineOffsets, offset),
    })
  }
  return {
    ocrDocumentId: document.id,
    sourceDocumentId: document.sourceDocumentId,
    provider: document.provider,
    markdown,
    lineOffsets,
    pageMarkers,
  }
}

export function buildMarkdownPreview(document: OCRDocument): MarkdownPreviewResponse {
  return markdownPreviewBase(document)
}

function cleanPreviewText(value: string, limit = 220) {
  const text = String(value || '')
    .replace(PAGE_MARKER_RE, '')
    .replace(/<table\b[\s\S]*?<\/table>/gi, '[答案表]')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > limit ? `${text.slice(0, limit).trim()}...` : text
}

function textForRange(markdown: string, range?: MarkdownRange) {
  if (!range) return ''
  return cleanPreviewText(markdown.slice(range.start, range.end))
}

function normalizeHeadingLine(line: string) {
  return String(line || '')
    .replace(/^\s*(?:#{1,6}\s*)?/, '')
    .replace(/^\s*【\s*/, '')
    .replace(/\s*】\s*$/, '')
    .replace(/\s*[:：]?\s*$/, '')
    .replace(/\s+/g, '')
}

function metadataKeywordForLine(line: string, config: ImportFlowV2ParserConfig) {
  const title = normalizeHeadingLine(line)
  return config.metadataBlockKeywords.find((keyword) => {
    const normalizedKeyword = keyword.replace(/\s+/g, '')
    return title === normalizedKeyword || title.startsWith(normalizedKeyword)
  })
}

function isMetadataLike(value: string | undefined, config: ImportFlowV2ParserConfig) {
  const normalized = cleanPreviewText(String(value || ''), 80).replace(/\s+/g, '')
  if (!normalized) return false
  return config.metadataBlockKeywords.some((keyword) => {
    const key = keyword.replace(/\s+/g, '')
    return normalized.startsWith(key) || normalized.includes(`【${key}】`)
  })
}

const CHINESE_SECTION_PREFIX_RE = /^[一二三四五六七八九十百千万]+[、.．]/

function titleMatchesConfiguredSection(title: string, config: ImportFlowV2ParserConfig) {
  const strippedTitle = title.replace(CHINESE_SECTION_PREFIX_RE, '')
  return config.sectionHeadings.some((heading) => {
    const normalized = heading.replace(/\s+/g, '').replace(CHINESE_SECTION_PREFIX_RE, '')
    return Boolean(normalized) && (
      title === normalized
      || title.startsWith(normalized)
      || strippedTitle === normalized
      || strippedTitle.startsWith(normalized)
    )
  })
}

function containsQuestionSectionHeading(markdown: string, config: ImportFlowV2ParserConfig) {
  return String(markdown || '').split(/\r?\n/).some((line) => titleMatchesConfiguredSection(normalizeHeadingLine(line), config))
}

function containsAnswerTable(markdown: string, config: ImportFlowV2ParserConfig) {
  return extractAnswerTableEntries(markdown, config).length > 0
}

function extractAnswerTableEntries(markdown: string, config: ImportFlowV2ParserConfig): TableAnswerEntry[] {
  if (config.answerTablePolicy === 'disabled') return []
  const entries: TableAnswerEntry[] = []
  const tablePattern = /<table\b[^>]*>([\s\S]*?)<\/table>/gi
  for (const tableMatch of markdown.matchAll(tablePattern)) {
    const tableStart = tableMatch.index || 0
    const tableEnd = tableStart + tableMatch[0].length
    const tableContent = tableMatch[1]
    const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
    const rows: string[][] = []
    for (const rowMatch of tableContent.matchAll(rowPattern)) {
      const cellPattern = /<td\b[^>]*>([\s\S]*?)<\/td>/gi
      const cells = Array.from(rowMatch[1].matchAll(cellPattern)).map((cellMatch) => cellMatch[1].replace(/<[^>]+>/g, '').trim())
      if (cells.length) rows.push(cells)
    }

    const headerRowIndex = rows.findIndex((row) => row.some((cell) => /题号|序号/.test(cell)))
    if (headerRowIndex < 0) continue
    const answerRowIndex = rows.findIndex((row, rowIndex) => rowIndex !== headerRowIndex && row.some((cell) => /答案/.test(cell)))
    if (answerRowIndex < 0) continue

    const headerRow = rows[headerRowIndex]
    const answerRow = rows[answerRowIndex]
    const labelColIndex = headerRow.findIndex((cell) => /题号|序号/.test(cell))
    const answerLabelColIndex = answerRow.findIndex((cell) => /答案/.test(cell))
    const startCol = Math.max(labelColIndex + 1, answerLabelColIndex + 1)
    for (let col = startCol; col < Math.min(headerRow.length, answerRow.length); col += 1) {
      const questionNo = headerRow[col].replace(/[^\d０-９]/g, '').replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - '０'.charCodeAt(0))).trim()
      const answerText = answerRow[col].trim()
      if (questionNo && answerText) entries.push({ questionNo, answerText, range: { start: tableStart, end: tableEnd } })
    }
  }
  for (const entry of extractInlineAnswerTableEntries(markdown)) {
    entries.push(entry)
  }
  return entries
}

function simpleChoiceAnswer(value: string) {
  return /^[A-D]{1,4}$/i.test(String(value || '').replace(/\s+/g, '').replace(/[;；。,.，、]$/g, ''))
}

function cloneMatches(matches: Map<string, SolutionMatch>) {
  const result = new Map<string, PreviewSolutionMatch>()
  for (const [questionNo, match] of matches) result.set(questionNo, { ...match })
  return result
}

function applyAnswerTablePolicy(
  matches: Map<string, PreviewSolutionMatch>,
  entries: TableAnswerEntry[],
  config: ImportFlowV2ParserConfig,
): ParserDiagnostic[] {
  if (config.answerTablePolicy === 'disabled') return []
  const diagnostics: ParserDiagnostic[] = []
  for (const entry of entries) {
    const existing = matches.get(entry.questionNo)
    if (!existing || !String(existing.answerText || '').trim()) {
      matches.set(entry.questionNo, { ...(existing || {}), answerText: entry.answerText, answerRange: entry.range })
      continue
    }

    if (String(existing.answerText || '').trim() === entry.answerText.trim()) {
      matches.set(entry.questionNo, { ...existing, answerRange: existing.answerRange || entry.range })
      continue
    }

    const shouldOverride =
      (config.answerTablePolicy === 'override_metadata_like_answer' && isMetadataLike(existing.answerText, config))
      || (config.answerTablePolicy === 'prefer_table_for_choice_questions' && simpleChoiceAnswer(entry.answerText))

    if (shouldOverride) {
      matches.set(entry.questionNo, { ...existing, answerText: entry.answerText, answerRange: entry.range })
      continue
    }

    diagnostics.push({
      code: 'table_answer_blocked_by_existing_answer',
      severity: 'info',
      questionNo: entry.questionNo,
      message: `答案表识别到第 ${entry.questionNo} 题答案为「${entry.answerText}」，但当前策略不会覆盖已有答案。`,
      start: entry.range.start,
      end: entry.range.end,
      suggestedConfigPatch: { answerTablePolicy: 'override_metadata_like_answer' },
    })
  }
  return diagnostics
}

function mergePreviewMatch(target: PreviewSolutionMatch | undefined, patch: PreviewSolutionMatch): PreviewSolutionMatch {
  return {
    ...(target || {}),
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined && value !== '')),
  }
}

function extractQuestionThenHeadingMatches(markdown: string, config: ImportFlowV2ParserConfig) {
  const questionMatches = detectSolutionQuestionNumbers(maskNonSolutionBlocks(markdown, config), config)
  const chunks = splitMarkdownByQuestionNumbers(markdown, questionMatches)
  const sections = findSolutionSections(markdown, config)
  const matches = new Map<string, PreviewSolutionMatch>()

  for (const chunk of chunks) {
    const chunkSections = sections
      .filter((section) => section.start >= chunk.contentStart && section.start < chunk.end)
      .sort((left, right) => left.start - right.start)
    const firstSection = chunkSections[0]
    const metadataStart = firstMetadataHeadingStart(markdown, chunk.contentStart, firstSection?.start || chunk.end, config)

    if (firstSection) {
      const stemEnd = Math.min(firstSection.start, metadataStart ?? firstSection.start)
      const rawStem = markdown.slice(chunk.contentStart, stemEnd)
      const bodyStart = firstSection.contentStart
      const bodyEnd = chunk.end
      const body = markdown.slice(bodyStart, bodyEnd)
      const fields = splitQuestionFields(body, bodyStart)
      let patch: PreviewSolutionMatch

      if (fields.hasFieldMarkers) {
        patch = {
          stemMarkdown: cleanPreviewText(rawStem),
          stemRange: rawStem.trim() ? { start: chunk.contentStart, end: stemEnd } : undefined,
          answerText: fields.answerText,
          analysisMarkdown: fields.analysisMarkdown,
          answerRange: fields.answerRange,
          analysisRange: fields.analysisRange,
        }
      } else {
        const bodyText = cleanPreviewText(body, 2000)
        const bodyLooksLikeAnalysis = /^(?:解|证明|分析|详解)\s*[:：]/.test(bodyText) || bodyText.length > 20 || firstSection.kind !== 'answer'
        patch = {
          stemMarkdown: cleanPreviewText(rawStem),
          stemRange: rawStem.trim() ? { start: chunk.contentStart, end: stemEnd } : undefined,
          answerText: bodyLooksLikeAnalysis ? undefined : bodyText,
          analysisMarkdown: bodyLooksLikeAnalysis ? bodyText : undefined,
          answerRange: bodyLooksLikeAnalysis ? undefined : { start: bodyStart, end: bodyEnd },
          analysisRange: bodyLooksLikeAnalysis ? { start: bodyStart, end: bodyEnd } : undefined,
        }
      }
      matches.set(chunk.questionNo, mergePreviewMatch(matches.get(chunk.questionNo), patch))
      continue
    }

    const body = markdown.slice(chunk.contentStart, chunk.end)
    const tableStart = firstAnswerTableStart(body, config)
    const trimmedBody = tableStart === undefined ? body : body.slice(0, tableStart).trimEnd()
    if (config.metadataBlockPolicy === 'ignore' && metadataOnlySolutionBlock(trimmedBody, config)) continue
    const fields = splitQuestionFields(trimmedBody, chunk.contentStart)
    matches.set(chunk.questionNo, mergePreviewMatch(matches.get(chunk.questionNo), {
      stemMarkdown: fields.stemMarkdown,
      stemRange: fields.stemRange,
      answerText: fields.answerText,
      analysisMarkdown: fields.analysisMarkdown,
      answerRange: fields.answerRange,
      analysisRange: fields.analysisRange,
    }))
  }

  return matches
}

function firstMetadataHeadingStart(markdown: string, start: number, end: number, config: ImportFlowV2ParserConfig) {
  const source = markdown.slice(start, end)
  const lines = source.split(/(?<=\n)/)
  let offset = start
  for (const lineWithNewline of lines) {
    const line = lineWithNewline.replace(/\n$/, '')
    if (metadataKeywordForLine(line, config)) return offset
    offset += lineWithNewline.length
  }
  return undefined
}

function sourceRangeForCandidateKind(document: OCRDocument, candidate: QuestionCandidate, kind: 'stem' | 'answer' | 'analysis'): MarkdownRange | undefined {
  const candidateText = String({
    stem: candidate.stemMarkdown,
    answer: candidate.answerText,
    analysis: candidate.analysisMarkdown,
  }[kind] || '')
  if (candidateText && (kind !== 'answer' || candidateText.length >= 8)) {
    const exactStart = String(document.markdown || '').indexOf(candidateText)
    if (exactStart >= 0) return { start: exactStart, end: exactStart + candidateText.length }
  }

  const blockIds = new Set(
    candidate.sourceRefs
      .filter((ref) => ref.kind === kind)
      .flatMap((ref) => ref.blockIds || [])
      .map(String),
  )
  if (!blockIds.size) return undefined
  const ranges = document.pages
    .flatMap((page) => page.blocks)
    .filter((block) => blockIds.has(block.id) && typeof block.markdownStart === 'number' && typeof block.markdownEnd === 'number')
    .map((block) => ({ start: block.markdownStart!, end: block.markdownEnd! }))
    .filter((range) => range.end > range.start)
  if (!ranges.length) return undefined
  return {
    start: Math.min(...ranges.map((range) => range.start)),
    end: Math.max(...ranges.map((range) => range.end)),
  }
}

function collectStructureTokens(markdown: string, lines: LineOffset[], config: ImportFlowV2ParserConfig): MarkdownStructureToken[] {
  const tokens: MarkdownStructureToken[] = []
  for (const match of markdown.matchAll(PAGE_MARKER_RE)) {
    const start = match.index || 0
    const token = tokenFor(lines, {
      id: `page:${start}`,
      kind: 'page_marker',
      start,
      end: start + match[0].length,
      label: `第 ${match[1]} 页`,
      severity: 'info',
    })
    if (token) tokens.push(token)
  }

  const questionDetectionMarkdown = maskNonSolutionBlocks(markdown, config)
  for (const match of detectSolutionQuestionNumbers(questionDetectionMarkdown, config)) {
    const token = tokenFor(lines, {
      id: `question:${match.start}:${match.questionNo}`,
      kind: 'question_no',
      questionNo: match.questionNo,
      start: match.start,
      end: match.contentStart,
      label: `第 ${match.questionNo} 题`,
      severity: 'info',
    })
    if (token) tokens.push(token)
  }

  if (config.answerTablePolicy !== 'disabled') {
    for (const tableMatch of markdown.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
      const start = tableMatch.index || 0
      if (!/题号|序号/.test(tableMatch[0]) || !/答案/.test(tableMatch[0])) continue
      const token = tokenFor(lines, {
        id: `answer-table:${start}`,
        kind: 'answer_table',
        start,
        end: start + tableMatch[0].length,
        label: '答案表',
        severity: 'info',
      })
      if (token) tokens.push(token)
    }

    for (const block of extractInlineAnswerTableBlocks(markdown)) {
      const token = tokenFor(lines, {
        id: `inline-answer-table:${block.start}`,
        kind: 'answer_table',
        start: block.start,
        end: block.end,
        label: '答案表',
        severity: 'info',
      })
      if (token) tokens.push(token)
    }
  }

  for (const section of findSolutionSections(markdown, config)) {
    const token = tokenFor(lines, {
      id: `solution-heading:${section.start}`,
      kind: 'solution_heading',
      start: section.start,
      end: section.contentStart,
      label: section.title,
      severity: 'info',
    })
    if (token) tokens.push(token)
  }

  for (const range of metadataBlockRanges(markdown, config)) {
    const firstLineEnd = markdown.indexOf('\n', range.start)
    const line = markdown.slice(range.start, firstLineEnd >= 0 && firstLineEnd < range.end ? firstLineEnd : range.end)
    const keyword = metadataKeywordForLine(line, config) || '说明块'
    if (keyword) {
      const token = tokenFor(lines, {
        id: `metadata:${range.start}`,
        kind: 'metadata_heading',
        start: range.start,
        end: range.end,
        label: keyword,
        severity: 'warning',
      })
      if (token) tokens.push(token)
    }
  }

  return tokens
}

function candidatePreviewsFromMatches(markdown: string, matches: Map<string, PreviewSolutionMatch>, diagnostics: ParserDiagnostic[]): CandidateParsePreview[] {
  const diagnosticsByQuestion = new Map<string, ParserDiagnostic[]>()
  for (const diagnostic of diagnostics) {
    if (!diagnostic.questionNo) continue
    const items = diagnosticsByQuestion.get(diagnostic.questionNo) || []
    items.push(diagnostic)
    diagnosticsByQuestion.set(diagnostic.questionNo, items)
  }
  return Array.from(matches.entries())
    .sort(([left], [right]) => Number(left) - Number(right) || left.localeCompare(right))
    .map(([questionNo, match]) => {
      const issues = [...(diagnosticsByQuestion.get(questionNo) || [])]
      if (!String(match.analysisMarkdown || '').trim()) {
        issues.push({
          code: 'missing_analysis',
          severity: 'warning',
          questionNo,
          message: `第 ${questionNo} 题当前试运行结果缺少解析。`,
          suggestedConfigPatch: { solutionBindingStrategy: 'question_then_heading' },
        })
      }
      return {
        questionNo,
        stemPreview: match.stemRange ? textForRange(markdown, match.stemRange) : cleanPreviewText(match.stemMarkdown || ''),
        answerPreview: match.answerRange ? textForRange(markdown, match.answerRange) : cleanPreviewText(match.answerText || ''),
        analysisPreview: match.analysisRange ? textForRange(markdown, match.analysisRange) : cleanPreviewText(match.analysisMarkdown || ''),
        sourceRanges: {
          stem: match.stemRange,
          answer: match.answerRange,
          analysis: match.analysisRange,
        },
        issues,
      } satisfies CandidateParsePreview
    })
}

function strategyDiagnostics(markdown: string, config: ImportFlowV2ParserConfig): ParserDiagnostic[] {
  const diagnostics: ParserDiagnostic[] = []
  const shouldSuggestQuestionThenHeading = config.solutionBindingStrategy !== 'question_then_heading'
  const sections = findSolutionSections(markdown, config)
  const questionMatches = detectSolutionQuestionNumbers(maskNonSolutionBlocks(markdown, config), config)
  const chunks = splitMarkdownByQuestionNumbers(markdown, questionMatches)

  if (shouldSuggestQuestionThenHeading) {
    for (const section of sections) {
      const content = markdown.slice(section.contentStart, section.end)
      const followingQuestions = detectSolutionQuestionNumbers(maskNonSolutionBlocks(content, config), config)
      if (!followingQuestions.length && section.kind === 'answer' && containsAnswerTable(content, config)) continue
      if (!followingQuestions.length) {
        const previousQuestion = [...questionMatches].reverse().find((match) => match.start < section.start)
        diagnostics.push({
          code: 'solution_heading_without_following_question',
          severity: 'warning',
          questionNo: previousQuestion?.questionNo,
          message: previousQuestion
            ? `检测到「${section.title}」，但标题后没有新的题号；它可能应该绑定到前面的第 ${previousQuestion.questionNo} 题。`
            : `检测到「${section.title}」，但标题后没有新的题号。`,
          start: section.start,
          end: section.contentStart,
          suggestedConfigPatch: { solutionBindingStrategy: 'question_then_heading' },
        })
      }
    }

    for (const chunk of chunks) {
      const section = sections.find((item) => item.start >= chunk.contentStart && item.start < chunk.end)
      if (!section) continue
      const between = markdown.slice(chunk.contentStart, section.start)
      if (containsAnswerTable(between, config) || containsQuestionSectionHeading(between, config)) continue
      diagnostics.push({
        code: 'question_before_solution_heading',
        severity: 'info',
        questionNo: chunk.questionNo,
        message: `第 ${chunk.questionNo} 题的题号出现在「${section.title}」之前，可试用“题号在参考答案前”策略。`,
        start: chunk.start,
        end: section.contentStart,
        suggestedConfigPatch: { solutionBindingStrategy: 'question_then_heading' },
      })
    }
  }

  return diagnostics
}

function buildStrategyPreview(
  document: OCRDocument,
  config: ImportFlowV2ParserConfig,
  strategy: Exclude<SolutionBindingStrategy, 'auto'>,
) {
  const markdown = String(document.markdown || '')
  const nextConfig = { ...config, solutionBindingStrategy: strategy }
  const matches = strategy === 'question_then_heading'
    ? extractQuestionThenHeadingMatches(markdown, nextConfig)
    : cloneMatches(parseSolutionDocument(document, { config: nextConfig }))
  const tableDiagnostics = applyAnswerTablePolicy(matches, extractAnswerTableEntries(markdown, nextConfig), nextConfig)
  const diagnostics = [...strategyDiagnostics(markdown, nextConfig), ...tableDiagnostics]

  for (const [questionNo, match] of matches) {
    if (isMetadataLike(match.answerText, nextConfig)) {
      diagnostics.push({
        code: 'metadata_used_as_answer',
        severity: 'warning',
        questionNo,
        message: `第 ${questionNo} 题的答案看起来像说明块内容，建议忽略说明块或允许答案表覆盖。`,
        start: match.answerRange?.start,
        end: match.answerRange?.end,
        suggestedConfigPatch: { metadataBlockPolicy: 'ignore', answerTablePolicy: 'override_metadata_like_answer' },
      })
    }
  }

  const candidatePreviews = candidatePreviewsFromMatches(markdown, matches, diagnostics)
  const score = candidatePreviews.reduce((total, preview) => {
    const answerScore = preview.answerPreview ? 2 : 0
    const analysisScore = preview.analysisPreview ? 3 : 0
    const issuePenalty = preview.issues.filter((issue) => issue.severity !== 'info').length
    return total + answerScore + analysisScore - issuePenalty
  }, 0) - diagnostics.filter((diagnostic) => diagnostic.severity !== 'info').length

  return { candidatePreviews, diagnostics, score }
}

function rangeTokensForPreviews(lines: LineOffset[], previews: CandidateParsePreview[], focusQuestionNo?: string) {
  const tokens: MarkdownStructureToken[] = []
  for (const preview of previews) {
    for (const kind of ['stem', 'answer', 'analysis'] as const) {
      const range = preview.sourceRanges[kind]
      if (!range) continue
      const token = tokenFor(lines, {
        id: `${kind}-range:${preview.questionNo}:${range.start}`,
        kind: `${kind}_range` as MarkdownStructureTokenKind,
        questionNo: preview.questionNo,
        start: range.start,
        end: range.end,
        label: `第 ${preview.questionNo} 题${kind === 'stem' ? '题干' : kind === 'answer' ? '答案' : '解析'}范围`,
        severity: focusQuestionNo && preview.questionNo === focusQuestionNo ? 'warning' : 'info',
      })
      if (token) tokens.push(token)
    }
  }
  return tokens
}

function currentCandidatePreview(document: OCRDocument, candidate: QuestionCandidate): CandidateParsePreview {
  const sourceRanges = {
    stem: sourceRangeForCandidateKind(document, candidate, 'stem'),
    answer: sourceRangeForCandidateKind(document, candidate, 'answer'),
    analysis: sourceRangeForCandidateKind(document, candidate, 'analysis'),
  }
  return {
    questionNo: candidate.questionNo,
    stemPreview: cleanPreviewText(candidate.stemMarkdown),
    answerPreview: cleanPreviewText(candidate.answerText),
    analysisPreview: cleanPreviewText(candidate.analysisMarkdown),
    sourceRanges,
    issues: [],
  }
}

function candidateHasSourceRange(preview: CandidateParsePreview) {
  return Boolean(preview.sourceRanges.stem || preview.sourceRanges.answer || preview.sourceRanges.analysis)
}

function recognizedQuestionTokensForPreviews(lines: LineOffset[], previews: CandidateParsePreview[]) {
  const tokens: MarkdownStructureToken[] = []
  for (const preview of previews) {
    for (const [kind, range] of Object.entries(preview.sourceRanges) as Array<[keyof CandidateParsePreview['sourceRanges'], MarkdownRange | undefined]>) {
      if (!range) continue
      const token = tokenFor(lines, {
        id: `recognized-question:${preview.questionNo}:${kind}:${range.start}`,
        kind: 'question_no',
        questionNo: preview.questionNo,
        start: range.start,
        end: Math.min(range.end, range.start + 1),
        label: `第 ${preview.questionNo} 题`,
        severity: 'info',
      })
      if (token) tokens.push(token)
    }
  }
  return tokens
}

function recognizedCandidateDiagnostics(candidates: QuestionCandidate[]) {
  const diagnostics: ParserDiagnostic[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    for (const diagnostic of candidate.parseDiagnostics || []) {
      const item = diagnostic as ParserDiagnostic
      const key = `${item.code}:${item.questionNo || candidate.questionNo}:${item.start || ''}:${item.end || ''}:${item.message}`
      if (seen.has(key)) continue
      seen.add(key)
      diagnostics.push({ ...item, questionNo: item.questionNo || candidate.questionNo })
    }
  }
  return diagnostics
}

function diagnosticsForCandidate(candidate: QuestionCandidate | undefined, config: ImportFlowV2ParserConfig): ParserDiagnostic[] {
  if (!candidate) return []
  const diagnostics: ParserDiagnostic[] = []
  if (isMetadataLike(candidate.answerText, config)) {
    diagnostics.push({
      code: 'metadata_used_as_answer',
      severity: 'warning',
      questionNo: candidate.questionNo,
      message: `当前候选题答案疑似来自「${config.metadataBlockKeywords.join(' / ')}」等说明块。`,
      suggestedConfigPatch: { metadataBlockPolicy: 'ignore', answerTablePolicy: 'override_metadata_like_answer' },
    })
  }
  if (!String(candidate.analysisMarkdown || '').trim()) {
    diagnostics.push({
      code: 'missing_analysis',
      severity: 'warning',
      questionNo: candidate.questionNo,
      message: `当前候选题第 ${candidate.questionNo || '未知'} 题缺少解析。`,
      suggestedConfigPatch: { solutionBindingStrategy: 'question_then_heading' },
    })
  }
  return diagnostics
}

export function buildParserPreview(
  document: OCRDocument,
  request: ParserPreviewRequest = {},
  candidate?: QuestionCandidate,
  recognizedCandidates: QuestionCandidate[] = [],
): ParserPreviewResponse {
  const config = normalizeParserConfig({ ...defaultParserConfig, ...(request.config || {}) })
  const markdown = String(document.markdown || '')
  const lines = lineOffsetsFor(markdown)
  const focusQuestionNo = request.focusQuestionNo || candidate?.questionNo || ''

  const headingPreview = buildStrategyPreview(document, config, 'heading_then_question')
  const questionPreview = buildStrategyPreview(document, config, 'question_then_heading')
  const selectedStrategy = config.solutionBindingStrategy === 'auto'
    ? questionPreview.score > headingPreview.score ? 'question_then_heading' : 'heading_then_question'
    : config.solutionBindingStrategy
  const selected = selectedStrategy === 'question_then_heading' ? questionPreview : headingPreview

  const constrainedCandidates = recognizedCandidates.length ? recognizedCandidates : candidate ? [candidate] : []
  const constrainedPreviews = constrainedCandidates
    .map((item) => currentCandidatePreview(document, item))
    .filter(candidateHasSourceRange)
  const candidateDiagnostics = diagnosticsForCandidate(candidate, config)
  let candidatePreviews = recognizedCandidates.length ? constrainedPreviews : selected.candidatePreviews
  if (candidate && !candidatePreviews.some((preview) => preview.questionNo === candidate.questionNo)) {
    const currentPreview = currentCandidatePreview(document, candidate)
    if (candidateHasSourceRange(currentPreview)) candidatePreviews = [currentPreview, ...candidatePreviews]
  }

  const collectedStructures = collectStructureTokens(markdown, lines, config)
  const structures = [
    ...(recognizedCandidates.length
      ? collectedStructures.filter((token) => token.kind !== 'question_no')
      : collectedStructures),
    ...(recognizedCandidates.length ? recognizedQuestionTokensForPreviews(lines, candidatePreviews) : []),
    ...rangeTokensForPreviews(lines, candidatePreviews, focusQuestionNo),
  ].sort((left, right) => left.start - right.start || left.end - right.end)

  const scoreDelta = Math.abs(questionPreview.score - headingPreview.score)
  const strategyRecommendation = config.solutionBindingStrategy === 'auto' || scoreDelta > 0
    ? {
        strategy: selectedStrategy,
        reason: selectedStrategy === 'question_then_heading'
          ? '检测到题号后接说明块或参考答案标题，试运行结果能绑定更多解析内容。'
          : '检测到参考答案标题后继续出现题号，当前标题后切题策略更匹配。',
        confidence: Math.min(0.95, 0.55 + scoreDelta / Math.max(10, Math.abs(questionPreview.score) + Math.abs(headingPreview.score) + 1)),
      }
    : undefined

  return {
    config,
    strategyRecommendation,
    structures,
    candidatePreviews: candidatePreviews.slice(0, 200),
    diagnostics: recognizedCandidates.length
      ? recognizedCandidateDiagnostics(recognizedCandidates)
      : [...selected.diagnostics, ...candidateDiagnostics],
  }
}

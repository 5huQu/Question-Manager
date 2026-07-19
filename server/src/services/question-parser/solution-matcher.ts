import { detectSolutionQuestionNumbers } from './question-number-detector.js'
import { splitMarkdownByQuestionNumbers } from './markdown-question-splitter.js'
import { getParserConfig } from './parser-config.js'
import type { ImportFlowV2ParserConfig } from './default-parser-config.js'

export type MarkdownRange = {
  start: number
  end: number
}

export type ParsedQuestionFields = {
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  stemRange?: MarkdownRange
  answerRange?: MarkdownRange
  analysisRange?: MarkdownRange
  hasFieldMarkers: boolean
}

export type SolutionSectionKind = 'answer' | 'analysis' | 'both'

export type SolutionSection = {
  kind: SolutionSectionKind
  title: string
  start: number
  contentStart: number
  end: number
}

export type SolutionMatch = {
  answerText?: string
  analysisMarkdown?: string
  answerRange?: MarkdownRange
  analysisRange?: MarkdownRange
  warnings?: string[]
}

export type InlineAnswerTableEntry = {
  questionNo: string
  answerText: string
  range: MarkdownRange
}

export type InlineAnswerTableBlock = {
  start: number
  end: number
  entries: InlineAnswerTableEntry[]
}

const PAGE_MARKER_RE = /<!--\s*(?:GLM|DOC2X)_PAGE:\d+\s*-->/g
const ANSWER_MARKER_RE = /【\s*答案\s*】|答案\s*[:：]/
const ANALYSIS_MARKER_RE = /【\s*(?:解析|分析|详解)\s*】|(?:解析|分析|详解)\s*[:：]/
const ANSWER_TABLE_RE = /<table\b[^>]*>[\s\S]*?<\/table>/gi
const INLINE_ANSWER_MARKER_RE = /(?:^|\s)([0-9０-９]{1,3})\s*(?:\\cdot|[、:：]|[.．](?![0-9０-９]))\s*/g
const COMPACT_NUMERIC_INLINE_ANSWER_MARKER_RE = /(?:^|\s)([0-9０-９]{1,3})\s*[.．]\s*/g

function cleanField(value: string) {
  return String(value || '').replace(PAGE_MARKER_RE, '').trim()
}

function firstMarker(pattern: RegExp, source: string) {
  const match = pattern.exec(source)
  return match ? { index: match.index, end: match.index + match[0].length } : null
}

function rangeFor(source: string, offset: number, start: number, end: number): MarkdownRange | undefined {
  let rangeStart = Math.max(0, start)
  let rangeEnd = Math.min(source.length, end)
  while (rangeStart < rangeEnd && /\s/.test(source[rangeStart])) rangeStart += 1
  while (rangeEnd > rangeStart && /\s/.test(source[rangeEnd - 1])) rangeEnd -= 1
  return rangeEnd > rangeStart ? { start: offset + rangeStart, end: offset + rangeEnd } : undefined
}

function normalizeDigits(value: string) {
  return value.replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - '０'.charCodeAt(0)))
}

function unwrapLatexCommand(value: string, command: string) {
  const source = String(value || '')
  const pattern = new RegExp(`\\\\${command}\\s*\\{`, 'g')
  let result = ''
  let cursor = 0

  while (cursor < source.length) {
    pattern.lastIndex = cursor
    const match = pattern.exec(source)
    if (!match) break

    const contentStart = pattern.lastIndex
    let depth = 1
    let index = contentStart
    while (index < source.length && depth > 0) {
      if (source[index] === '{') depth += 1
      else if (source[index] === '}') depth -= 1
      index += 1
    }
    if (depth !== 0) break

    result += source.slice(cursor, match.index)
    result += source.slice(contentStart, index - 1)
    cursor = index
  }

  return result + source.slice(cursor)
}

function normalizeInlineAnswer(value: string) {
  let text = String(value || '')
    .replace(PAGE_MARKER_RE, '')
    .replace(/[;；,，、]\s*$/g, '')
    .trim()
  text = unwrapLatexCommand(text, 'underline')
  text = text.replace(/\$\s+/g, '$').replace(/\s+\$/g, '$')
  text = text.replace(/\$([^$]+)\$/g, (_match, inner: string) => {
    const clean = inner.trim()
    const compact = /^[0-9０-９\s+\-*/=.]+$/.test(clean) ? clean.replace(/\s+/g, '') : clean
    return `$${normalizeDigits(compact)}$`
  })
  return text
}

function normalizeInlineQuestionNo(value: string) {
  const normalized = normalizeDigits(value).trim()
  const parsed = Number.parseInt(normalized, 10)
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : ''
}

function trimmedRange(offset: number, source: string, start: number, end: number): MarkdownRange {
  let rangeStart = Math.max(0, start)
  let rangeEnd = Math.min(source.length, end)
  while (rangeStart < rangeEnd && /\s/.test(source[rangeStart])) rangeStart += 1
  while (rangeEnd > rangeStart && /\s/.test(source[rangeEnd - 1])) rangeEnd -= 1
  return { start: offset + rangeStart, end: offset + rangeEnd }
}

function isEscaped(source: string, index: number) {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) slashCount += 1
  return slashCount % 2 === 1
}

function isInsideInlineMath(source: string, index: number) {
  let inside = false
  for (let cursor = 0; cursor < index && cursor < source.length; cursor += 1) {
    if (source[cursor] === '$' && !isEscaped(source, cursor)) inside = !inside
  }
  return inside
}

function inlineAnswerMarkerStart(match: RegExpMatchArray) {
  const digitIndex = match[0].search(/[0-9０-９]/)
  return (match.index || 0) + Math.max(0, digitIndex)
}

function inlineAnswerMarkerHasCompactNumericDot(line: string, match: RegExpMatchArray) {
  const dotIndex = match[0].search(/[.．]/)
  if (dotIndex < 0) return false
  return /^[0-9０-９]/.test(line.slice((match.index || 0) + dotIndex + 1))
}

function inlineQuestionNoValue(match: RegExpMatchArray) {
  const questionNo = normalizeInlineQuestionNo(match[1] || '')
  const parsed = Number.parseInt(questionNo, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function inlineAnswerMarkerMatches(line: string, pattern: RegExp) {
  pattern.lastIndex = 0
  return Array.from(line.matchAll(pattern)).filter((match) => {
    if (!normalizeInlineQuestionNo(match[1] || '')) return false
    return !isInsideInlineMath(line, inlineAnswerMarkerStart(match))
  })
}

function looksLikeCompactNumericAnswerTable(line: string, matches: RegExpMatchArray[]) {
  if (matches.length < 3) return false
  if (!matches.some((match) => inlineAnswerMarkerHasCompactNumericDot(line, match))) return false
  const numbers = matches.map(inlineQuestionNoValue)
  if (numbers.some((value) => value === undefined)) return false
  if ((numbers[0] || 0) < 9) return false
  return numbers.every((value, index) => index === 0 || value === (numbers[index - 1] || 0) + 1)
}

function inlineAnswerLooksShort(value: string) {
  const compact = String(value || '')
    .replace(/\$[^$]*\$/g, 'M')
    .replace(/\\[a-zA-Z]+/g, 'M')
    .replace(/\s+/g, '')
  if (!compact || compact.length > 40) return false
  return !/(教材题源|高考题源|课标要求|命题说明|本小题|解析|分析|证明|详解|答案为|故选|解[:：])/.test(compact)
}

function inlineAnswerEntriesFromMatches(line: string, offset: number, matches: RegExpMatchArray[]) {
  const entries: InlineAnswerTableEntry[] = []
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const questionNo = normalizeInlineQuestionNo(match[1] || '')
    if (!questionNo) continue
    const next = matches[index + 1]
    const answerStart = (match.index || 0) + match[0].length
    const answerEnd = next ? (next.index || 0) : line.length
    const answerText = normalizeInlineAnswer(line.slice(answerStart, answerEnd))
    if (!answerText || !inlineAnswerLooksShort(answerText)) continue
    entries.push({
      questionNo,
      answerText,
      range: trimmedRange(offset, line, answerStart, answerEnd),
    })
  }
  return entries
}

export function extractInlineAnswerTableBlocks(markdown: string): InlineAnswerTableBlock[] {
  const source = String(markdown || '')
  const blocks: InlineAnswerTableBlock[] = []
  const lines = source.split(/(?<=\n)/)
  let offset = 0

  for (const lineWithNewline of lines) {
    const line = lineWithNewline.replace(/\r?\n$/, '')
    let matches = inlineAnswerMarkerMatches(line, INLINE_ANSWER_MARKER_RE)
    let entries = inlineAnswerEntriesFromMatches(line, offset, matches)

    if (entries.length < 2) {
      const compactMatches = inlineAnswerMarkerMatches(line, COMPACT_NUMERIC_INLINE_ANSWER_MARKER_RE)
      if (looksLikeCompactNumericAnswerTable(line, compactMatches)) {
        matches = compactMatches
        entries = inlineAnswerEntriesFromMatches(line, offset, matches)
      }
    }

    if (entries.length < 2) {
      offset += lineWithNewline.length
      continue
    }

    blocks.push({
      start: offset,
      end: offset + line.length,
      entries,
    })
    offset += lineWithNewline.length
  }

  return blocks
}

export function extractInlineAnswerTableEntries(markdown: string) {
  return extractInlineAnswerTableBlocks(markdown).flatMap((block) => block.entries)
}

export function answerTableDetectionEnabled(config: ImportFlowV2ParserConfig = getParserConfig()) {
  return config.answerTablePolicy !== 'disabled'
}

export function firstAnswerTableStart(source: string, config: ImportFlowV2ParserConfig = getParserConfig()) {
  if (!answerTableDetectionEnabled(config)) return undefined
  const text = String(source || '')
  let first: number | undefined
  for (const match of text.matchAll(ANSWER_TABLE_RE)) {
    if (!/题号|序号/.test(match[0]) || !/答案/.test(match[0])) continue
    first = Math.min(first ?? Number.POSITIVE_INFINITY, match.index || 0)
  }
  for (const block of extractInlineAnswerTableBlocks(text)) {
    first = Math.min(first ?? Number.POSITIVE_INFINITY, block.start)
  }
  return first === undefined || !Number.isFinite(first) ? undefined : first
}

function answerTableRanges(source: string, config: ImportFlowV2ParserConfig = getParserConfig()): MarkdownRange[] {
  if (!answerTableDetectionEnabled(config)) return []
  const ranges: MarkdownRange[] = []
  for (const match of source.matchAll(ANSWER_TABLE_RE)) {
    if (!/题号|序号/.test(match[0]) || !/答案/.test(match[0])) continue
    const start = match.index || 0
    ranges.push({ start, end: start + match[0].length })
  }
  for (const block of extractInlineAnswerTableBlocks(source)) {
    ranges.push({ start: block.start, end: block.end })
  }
  return ranges
}

function maskRanges(source: string, ranges: MarkdownRange[]) {
  if (!ranges.length) return source
  const chars = source.split('')
  for (const range of ranges) {
    for (let index = range.start; index < range.end && index < chars.length; index += 1) {
      if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' '
    }
  }
  return chars.join('')
}

export function maskAnswerTableBlocks(markdown: string, config: ImportFlowV2ParserConfig = getParserConfig()) {
  const source = String(markdown || '')
  return maskRanges(source, answerTableRanges(source, config))
}

const CHINESE_SECTION_PREFIX_RE = /^[一二三四五六七八九十百千万]+[、.．]/

function normalizedConfigTitle(value: string) {
  return cleanHeadingLine(value).replace(CHINESE_SECTION_PREFIX_RE, '')
}

function sectionHeadingForLine(line: string, config: ImportFlowV2ParserConfig) {
  const title = cleanHeadingLine(line)
  const strippedTitle = title.replace(CHINESE_SECTION_PREFIX_RE, '')
  return config.sectionHeadings.find((heading) => {
    const normalized = normalizedConfigTitle(heading)
    return Boolean(normalized) && (title === normalized || title.startsWith(normalized) || strippedTitle === normalized || strippedTitle.startsWith(normalized))
  })
}

function solutionHeadingForLine(line: string, config: ImportFlowV2ParserConfig) {
  const title = cleanHeadingLine(line)
  return config.solutionSectionKeywords.find((keyword) => {
    const normalized = keyword.replace(/\s+/g, '')
    return title === normalized || title.endsWith(normalized)
  })
}

function isMetadataBlockBoundaryLine(line: string, config: ImportFlowV2ParserConfig) {
  const trimmed = String(line || '').trim()
  if (!trimmed) return false
  if (metadataKeywordForLine(line, config)) return false
  if (/^<table\b/i.test(trimmed)) return true
  return Boolean(sectionHeadingForLine(line, config) || solutionHeadingForLine(line, config))
}

export function metadataBlockRanges(markdown: string, config: ImportFlowV2ParserConfig = getParserConfig()): MarkdownRange[] {
  const source = String(markdown || '')
  const lines = source.split(/(?<=\n)/)
  const ranges: MarkdownRange[] = []
  let offset = 0

  for (let index = 0; index < lines.length; index += 1) {
    const lineWithNewline = lines[index]
    const line = lineWithNewline.replace(/\r?\n$/, '')
    if (!metadataKeywordForLine(line, config)) {
      offset += lineWithNewline.length
      continue
    }

    const start = offset
    const headingEnd = offset + lineWithNewline.length
    let cursor = headingEnd
    let boundaryFound = false
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLineWithNewline = lines[nextIndex]
      const nextLine = nextLineWithNewline.replace(/\r?\n$/, '')
      if (isMetadataBlockBoundaryLine(nextLine, config)) {
        boundaryFound = true
        break
      }
      cursor += nextLineWithNewline.length
    }

    ranges.push({ start, end: boundaryFound ? cursor : headingEnd })
    offset = headingEnd
  }
  return ranges
}

export function maskNonSolutionBlocks(markdown: string, config: ImportFlowV2ParserConfig = getParserConfig()) {
  const source = String(markdown || '')
  return maskRanges(source, [
    ...answerTableRanges(source, config),
    ...metadataBlockRanges(source, config),
  ])
}

function cleanHeadingLine(line: string) {
  return String(line || '')
    .replace(/^\s*(?:#{1,6}\s*)?/, '')
    .replace(/^\s*【\s*/, '')
    .replace(/\s*】\s*$/, '')
    .replace(/\s*[:：]?\s*$/, '')
    .replace(/\s+/g, '')
}

function metadataKeywordForLine(line: string, config: ImportFlowV2ParserConfig) {
  const title = cleanHeadingLine(line)
  return config.metadataBlockKeywords.find((keyword) => {
    const normalizedKeyword = keyword.replace(/\s+/g, '')
    return title === normalizedKeyword || title.startsWith(normalizedKeyword)
  })
}

export function metadataOnlySolutionBlock(value: string, config: ImportFlowV2ParserConfig = getParserConfig()) {
  const raw = String(value || '').replace(PAGE_MARKER_RE, '')
  const source = maskRanges(raw, answerTableRanges(raw, config))
    .replace(/^\s*#{1,6}\s*(?:[一二三四五六七八九十]+[、.．]\s*)?(?:选择题|填空题|解答题|选做题).*$/gm, '')
    .trim()
  if (!source) return true
  const lines = source.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return true
  return lines.every((line) => {
    if (metadataKeywordForLine(line, config)) return true
    return /^(?:[（(]\s*\d+\s*[)）]\s*)?(?:教材题源|高考题源|课标要求)\s*[:：]/.test(line)
  })
}

function trimBodyBeforeAnswerTable(body: string, config: ImportFlowV2ParserConfig) {
  const tableStart = firstAnswerTableStart(body, config)
  return tableStart === undefined ? body : body.slice(0, tableStart).trimEnd()
}

export function splitQuestionFields(body: string, offset = 0): ParsedQuestionFields {
  const source = String(body || '')
  const answer = firstMarker(ANSWER_MARKER_RE, source)
  const analysis = firstMarker(ANALYSIS_MARKER_RE, source)

  if (answer && analysis && answer.index < analysis.index) {
    return {
      stemMarkdown: cleanField(source.slice(0, answer.index)),
      answerText: cleanField(source.slice(answer.end, analysis.index)),
      analysisMarkdown: cleanField(source.slice(analysis.end)),
      stemRange: rangeFor(source, offset, 0, answer.index),
      answerRange: rangeFor(source, offset, answer.end, analysis.index),
      analysisRange: rangeFor(source, offset, analysis.end, source.length),
      hasFieldMarkers: true,
    }
  }

  if (analysis && answer && analysis.index < answer.index) {
    return {
      stemMarkdown: cleanField(source.slice(0, analysis.index)),
      answerText: cleanField(source.slice(answer.end)),
      analysisMarkdown: cleanField(source.slice(analysis.end, answer.index)),
      stemRange: rangeFor(source, offset, 0, analysis.index),
      answerRange: rangeFor(source, offset, answer.end, source.length),
      analysisRange: rangeFor(source, offset, analysis.end, answer.index),
      hasFieldMarkers: true,
    }
  }

  if (answer) {
    return {
      stemMarkdown: cleanField(source.slice(0, answer.index)),
      answerText: cleanField(source.slice(answer.end)),
      analysisMarkdown: '',
      stemRange: rangeFor(source, offset, 0, answer.index),
      answerRange: rangeFor(source, offset, answer.end, source.length),
      hasFieldMarkers: true,
    }
  }

  if (analysis) {
    return {
      stemMarkdown: cleanField(source.slice(0, analysis.index)),
      answerText: '',
      analysisMarkdown: cleanField(source.slice(analysis.end)),
      stemRange: rangeFor(source, offset, 0, analysis.index),
      analysisRange: rangeFor(source, offset, analysis.end, source.length),
      hasFieldMarkers: true,
    }
  }

  return {
    stemMarkdown: cleanField(source),
    answerText: '',
    analysisMarkdown: '',
    stemRange: rangeFor(source, offset, 0, source.length),
    hasFieldMarkers: false,
  }
}

function solutionKind(title: string): SolutionSectionKind {
  if (/答案/.test(title) && /解析|分析|详解/.test(title)) return 'both'
  if (/答案/.test(title)) return 'answer'
  return 'analysis'
}

export function findSolutionSections(markdown: string, config: ImportFlowV2ParserConfig = getParserConfig()): SolutionSection[] {
  const source = String(markdown || '')
  const headings: SolutionSection[] = []
  const lines = source.split(/(?<=\n)/)
  let offset = 0
  for (const lineWithNewline of lines) {
    const line = lineWithNewline.replace(/\n$/, '')
    const clean = line
      .replace(/^\s*(?:#{1,6}\s*)?/, '')
      .replace(/^\s*【\s*/, '')
      .replace(/\s*】\s*$/, '')
      .replace(/\s*[:：]?\s*$/, '')
    const title = config.solutionSectionKeywords.find((keyword) => clean === keyword || clean.endsWith(keyword))
    if (!title) { offset += lineWithNewline.length; continue }
    const start = offset
    const contentStart = offset + lineWithNewline.length
    headings.push({
      kind: solutionKind(title),
      title,
      start,
      contentStart,
      end: source.length,
    })
    offset += lineWithNewline.length
  }
  for (let index = 0; index < headings.length; index += 1) {
    headings[index].end = index + 1 < headings.length ? headings[index + 1].start : source.length
  }
  return headings
}

function mergeSolutionMatch(target: SolutionMatch | undefined, patch: SolutionMatch): SolutionMatch {
  return {
    ...(target || {}),
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined && value !== '')),
  }
}

function solutionPatchForSection(section: SolutionSection, fields: ParsedQuestionFields, fallbackRange: MarkdownRange): SolutionMatch {
  if (section.kind === 'answer') {
    return {
      answerText: fields.answerText || fields.stemMarkdown,
      analysisMarkdown: fields.analysisMarkdown || undefined,
      answerRange: fields.answerRange || fields.stemRange || fallbackRange,
      analysisRange: fields.analysisRange,
    }
  }
  if (section.kind === 'analysis') {
    return {
      analysisMarkdown: fields.analysisMarkdown || fields.stemMarkdown,
      analysisRange: fields.analysisRange || fields.stemRange || fallbackRange,
    }
  }
  const inferredLeadingAnswer = !fields.answerText && fields.analysisMarkdown ? fields.stemMarkdown : ''
  return {
    answerText: fields.answerText || inferredLeadingAnswer,
    analysisMarkdown: fields.analysisMarkdown || (!fields.answerText ? fields.stemMarkdown : ''),
    answerRange: fields.answerRange || (inferredLeadingAnswer ? fields.stemRange : undefined),
    analysisRange: fields.analysisRange || (!fields.answerText ? fields.stemRange : undefined),
  }
}

export function extractSolutionMatches(markdown: string, sections: SolutionSection[] = findSolutionSections(markdown), config: ImportFlowV2ParserConfig = getParserConfig()) {
  const source = String(markdown || '')
  const matches = new Map<string, SolutionMatch>()
  for (const section of sections) {
    const content = source.slice(section.contentStart, section.end)
    const matchingContent = maskNonSolutionBlocks(content, config)
    const offset = section.contentStart
    const starts = detectSolutionQuestionNumbers(matchingContent, config)
    const chunks = splitMarkdownByQuestionNumbers(content, starts)
    for (const chunk of chunks) {
      const body = trimBodyBeforeAnswerTable(chunk.body, config)
      if (config.metadataBlockPolicy === 'ignore' && metadataOnlySolutionBlock(body, config)) continue
      const fields = splitQuestionFields(body, offset + chunk.contentStart)
      const fallbackRange = { start: offset + chunk.contentStart, end: offset + chunk.contentStart + body.length }
      const patch = solutionPatchForSection(section, fields, fallbackRange)
      matches.set(chunk.questionNo, mergeSolutionMatch(matches.get(chunk.questionNo), patch))
    }
  }
  return matches
}

import type { OCRDocument } from '../../types/ocr-document.js'
import { detectSolutionQuestionNumbers } from './question-number-detector.js'
import { splitMarkdownByQuestionNumbers } from './markdown-question-splitter.js'
import { getParserConfig } from './parser-config.js'
import type { ImportFlowV2ParserConfig } from './default-parser-config.js'
import {
  answerTableDetectionEnabled,
  extractHtmlAnswerTableBlocks,
  extractSolutionMatches,
  extractInlineAnswerTableEntries,
  firstAnswerTableStart,
  findSolutionSections,
  maskNonSolutionBlocks,
  metadataOnlySolutionBlock,
  splitQuestionFields,
  type MarkdownRange,
  type SolutionMatch,
} from './solution-matcher.js'

const PAGE_MARKER_RE = /<!--\s*(?:GLM|DOC2X)_PAGE:\d+\s*-->/g

export type ParseSolutionDocumentOptions = {
  config?: ImportFlowV2ParserConfig
}

function nonEmpty(value: string | undefined) {
  const text = String(value || '').trim()
  return text || undefined
}

function looksLikeStandaloneAnswer(value: string) {
  const text = String(value || '').trim()
  if (!text || text.length > 80 || /[。！？；]/.test(text)) return false
  if (/^(?:无解|不存在|空集|任意实数|任意实数解)$/.test(text)) return true
  if (/[\u4e00-\u9fff]/.test(text)) return false
  return !/^(?:[（(]\s*\d+\s*[)）]|解|证明|因为|由|设|当|若|故|所以|分析|详解)/.test(text)
}

function onlyQuestionSectionHeading(value: string) {
  const lines = String(value || '').replace(PAGE_MARKER_RE, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return lines.length > 0 && lines.every((line) => /^(?:#{1,6}\s*)?[一二三四五六七八九十]+[、.．](?:(?:单项|多项|单选|多选|非)?选择题|填空题|解答题|计算题|实验题|选做题)(?:[:： （(].*)?$/.test(line))
}

/**
 * A separated answer document can contain only a final result for a small
 * question, followed immediately by the next question-type heading. Treat
 * the result as an answer, not as analysis; an empty analysis is valid.
 */
function inferUnmarkedStandaloneAnswer(body: string, offset: number): SolutionMatch | undefined {
  const source = String(body || '')
  const lines = source.split(/(?<=\n)/)
  let lineOffset = 0

  for (const lineWithNewline of lines) {
    const line = lineWithNewline.replace(/\r?\n$/, '')
    const text = line.trim()
    const textStart = lineOffset + line.indexOf(text)
    const textEnd = textStart + text.length
    lineOffset += lineWithNewline.length
    if (!text || PAGE_MARKER_RE.test(text)) {
      PAGE_MARKER_RE.lastIndex = 0
      continue
    }
    if (!looksLikeStandaloneAnswer(text)) return undefined
    const trailing = source.slice(textEnd).replace(PAGE_MARKER_RE, '').trim()
    if (trailing && !onlyQuestionSectionHeading(trailing)) return undefined
    return {
      answerText: text,
      answerRange: { start: offset + textStart, end: offset + textEnd },
    }
  }
  return undefined
}

function solutionMatchFromWholeDocumentChunk(body: string, offset: number, fallbackRange: MarkdownRange): SolutionMatch {
  const fields = splitQuestionFields(body, offset)
  const inferredStandaloneAnswer = !fields.hasFieldMarkers ? inferUnmarkedStandaloneAnswer(body, offset) : undefined
  if (inferredStandaloneAnswer) return inferredStandaloneAnswer
  const inferredLeadingAnswer = !fields.answerText && fields.analysisMarkdown ? nonEmpty(fields.stemMarkdown) : undefined
  const answerText = nonEmpty(fields.answerText) || inferredLeadingAnswer
  const analysisMarkdown = nonEmpty(fields.analysisMarkdown) || (!answerText ? nonEmpty(fields.stemMarkdown) : undefined)
  return {
    answerText,
    analysisMarkdown,
    answerRange: fields.answerRange || (inferredLeadingAnswer ? fields.stemRange : undefined),
    analysisRange: fields.analysisRange || (!answerText ? fields.stemRange : undefined) || fallbackRange,
  }
}

function mergeSolutionMatch(target: SolutionMatch | undefined, patch: SolutionMatch): SolutionMatch {
  return {
    ...(target || {}),
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined && value !== '')),
  }
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

function isMetadataLikeAnswer(value: string | undefined, config: ImportFlowV2ParserConfig) {
  const compact = String(value || '')
    .replace(PAGE_MARKER_RE, '')
    .replace(/\s+/g, '')
    .slice(0, 120)
  if (!compact) return false
  return config.metadataBlockKeywords.some((keyword) => {
    const key = keyword.replace(/\s+/g, '')
    return compact.startsWith(key) || compact.includes(`【${key}】`)
  })
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

function nonEmptyRange(source: string, start: number, end: number): MarkdownRange | undefined {
  let rangeStart = Math.max(0, start)
  let rangeEnd = Math.max(rangeStart, end)
  while (rangeStart < rangeEnd && /\s/.test(source[rangeStart])) rangeStart += 1
  while (rangeEnd > rangeStart && /\s/.test(source[rangeEnd - 1])) rangeEnd -= 1
  return rangeEnd > rangeStart ? { start: rangeStart, end: rangeEnd } : undefined
}

function questionThenHeadingSolutionMatch(markdown: string, chunkBodyStart: number, chunkEnd: number, config: ImportFlowV2ParserConfig): SolutionMatch {
  const sections = findSolutionSections(markdown.slice(chunkBodyStart, chunkEnd), config)
    .map((section) => ({
      ...section,
      start: section.start + chunkBodyStart,
      contentStart: section.contentStart + chunkBodyStart,
      end: section.end + chunkBodyStart,
    }))
    .sort((left, right) => left.start - right.start)
  const section = sections[0]
  if (!section) {
    const rawBody = markdown.slice(chunkBodyStart, chunkEnd)
    const tableStart = firstAnswerTableStart(rawBody, config)
    const body = tableStart === undefined ? rawBody : rawBody.slice(0, tableStart).trimEnd()
    if (config.metadataBlockPolicy === 'ignore' && metadataOnlySolutionBlock(body, config)) return {}
    return solutionMatchFromWholeDocumentChunk(body, chunkBodyStart, { start: chunkBodyStart, end: chunkBodyStart + body.length })
  }

  const metadataStart = firstMetadataHeadingStart(markdown, chunkBodyStart, section.start, config)
  const leadingStart = metadataStart === undefined ? chunkBodyStart : Math.min(metadataStart, section.start)
  const leading = markdown.slice(chunkBodyStart, leadingStart)
  const body = markdown.slice(section.contentStart, chunkEnd)
  const fields = splitQuestionFields(body, section.contentStart)
  if (fields.hasFieldMarkers) {
    return {
      answerText: nonEmpty(fields.answerText) || undefined,
      analysisMarkdown: nonEmpty(fields.analysisMarkdown) || undefined,
      answerRange: fields.answerRange,
      analysisRange: fields.analysisRange,
    }
  }

  const bodyText = body.replace(PAGE_MARKER_RE, '').trim()
  const looksLikeAnalysis = /^(?:解|证明|分析|详解)\s*[:：]/.test(bodyText)
    || section.kind !== 'answer'
    || bodyText.length > 20
  return {
    answerText: looksLikeAnalysis ? undefined : nonEmpty(bodyText),
    analysisMarkdown: looksLikeAnalysis ? nonEmpty(bodyText) : undefined,
    answerRange: looksLikeAnalysis ? undefined : nonEmptyRange(markdown, section.contentStart, chunkEnd),
    analysisRange: looksLikeAnalysis ? nonEmptyRange(markdown, section.contentStart, chunkEnd) : undefined,
  }
}

export function extractQuestionThenHeadingSolutionMatches(markdown: string, config: ImportFlowV2ParserConfig, start = 0) {
  const source = markdown.slice(start)
  const starts = detectSolutionQuestionNumbers(maskNonSolutionBlocks(source, config), config)
  const chunks = splitMarkdownByQuestionNumbers(source, starts)
  const matches = new Map<string, SolutionMatch>()
  for (const chunk of chunks) {
    matches.set(chunk.questionNo, mergeSolutionMatch(
      matches.get(chunk.questionNo),
      questionThenHeadingSolutionMatch(markdown, start + chunk.contentStart, start + chunk.end, config),
    ))
  }
  return { matches, chunkCount: chunks.length, chunksWithFieldMarkers: 0 }
}

function matchScore(matches: Map<string, SolutionMatch>, config: ImportFlowV2ParserConfig) {
  let score = 0
  for (const match of matches.values()) {
    if (String(match.answerText || '').trim()) score += isMetadataLikeAnswer(match.answerText, config) ? -2 : 2
    if (String(match.analysisMarkdown || '').trim()) score += 3
  }
  return score
}

function extractWholeDocumentSolutionMatches(markdown: string, config: ImportFlowV2ParserConfig) {
  const questionMatches = detectSolutionQuestionNumbers(maskNonSolutionBlocks(markdown, config), config)
  const chunks = splitMarkdownByQuestionNumbers(markdown, questionMatches)
  const matches = new Map<string, SolutionMatch>()
  let chunksWithFieldMarkers = 0

  for (const chunk of chunks) {
    const tableStart = firstAnswerTableStart(chunk.body, config)
    const body = tableStart === undefined ? chunk.body : chunk.body.slice(0, tableStart).trimEnd()
    if (config.metadataBlockPolicy === 'ignore' && metadataOnlySolutionBlock(body, config)) continue
    const fields = splitQuestionFields(body, chunk.contentStart)
    if (fields.hasFieldMarkers) chunksWithFieldMarkers += 1
    matches.set(chunk.questionNo, mergeSolutionMatch(matches.get(chunk.questionNo), solutionMatchFromWholeDocumentChunk(
      body,
      chunk.contentStart,
      { start: chunk.contentStart, end: chunk.contentStart + body.length },
    )))
  }

  return { matches, chunkCount: chunks.length, chunksWithFieldMarkers }
}

/**
 * Parse HTML <table> blocks that map question numbers to answers.
 * Expected structure:
 *   <table ...>
 *     <tr><td>题号</td><td>1</td><td>2</td>...</tr>
 *     <tr><td>答案</td><td>A</td><td>C</td>...</tr>
 *   </table>
 * Returns entries with source ranges so answer tables do not get treated as analysis text.
 */
export type AnswerTableEntry = {
  questionNo: string
  answerText: string
  range?: MarkdownRange
}

export function extractAnswerTableEntries(
  markdown: string,
  config: ImportFlowV2ParserConfig = getParserConfig(),
): AnswerTableEntry[] {
  if (!answerTableDetectionEnabled(config)) return []
  const entries: AnswerTableEntry[] = []
  const source = String(markdown || '')
  for (const block of extractHtmlAnswerTableBlocks(source)) entries.push(...block.entries)
  for (const entry of extractInlineAnswerTableEntries(source)) {
    entries.push(entry)
  }
  return entries
}

export function extractAnswerTable(
  markdown: string,
  config: ImportFlowV2ParserConfig = getParserConfig(),
): Map<string, string> {
  const result = new Map<string, string>()
  for (const entry of extractAnswerTableEntries(markdown, config)) {
    result.set(entry.questionNo, entry.answerText)
  }
  return result
}

export function parseSolutionDocument(
  document: OCRDocument,
  options: ParseSolutionDocumentOptions = {},
): Map<string, SolutionMatch> {
  const config = options.config || getParserConfig()
  const markdown = String(document.markdown || '')

  // Step 1: Extract answers from HTML tables (e.g. answer key tables)
  const tableAnswers = new Map<string, AnswerTableEntry>()
  for (const entry of extractAnswerTableEntries(markdown, config)) tableAnswers.set(entry.questionNo, entry)

  // Step 2: Run normal section-based or fallback extraction
  const solutionSections = findSolutionSections(markdown, config)
  const wholeDocumentMatches = extractWholeDocumentSolutionMatches(markdown, config)
  const headingThenQuestionMatches =
    wholeDocumentMatches.chunkCount > 0
      && wholeDocumentMatches.chunksWithFieldMarkers >= Math.ceil(wholeDocumentMatches.chunkCount / 2)
      ? wholeDocumentMatches.matches
      : solutionSections.length
        ? extractSolutionMatches(markdown, solutionSections, config)
        : wholeDocumentMatches.matches
  const questionThenHeadingMatches = extractQuestionThenHeadingSolutionMatches(markdown, config).matches
  let matches: Map<string, SolutionMatch>

  if (config.solutionBindingStrategy === 'question_then_heading') {
    matches = questionThenHeadingMatches
  } else if (config.solutionBindingStrategy === 'auto') {
    matches = matchScore(questionThenHeadingMatches, config) > matchScore(headingThenQuestionMatches, config)
      ? questionThenHeadingMatches
      : headingThenQuestionMatches
  } else {
    matches = headingThenQuestionMatches
  }

  // Step 3: Merge table-based answers according to the configured policy.
  for (const [questionNo, entry] of tableAnswers) {
    const existing = matches.get(questionNo)
    const answerText = entry.answerText
    const shouldOverride = Boolean(existing?.answerText) && (
      (config.answerTablePolicy === 'override_metadata_like_answer' && isMetadataLikeAnswer(existing?.answerText, config))
      || (config.answerTablePolicy === 'prefer_table_for_choice_questions' && /^[A-D]{1,4}$/i.test(answerText.replace(/\s+/g, '')))
    )
    if (!existing || !existing.answerText || shouldOverride) {
      matches.set(questionNo, { ...(existing || {}), answerText, answerRange: entry.range })
    } else if (String(existing.answerText || '').trim() === answerText.trim() && entry.range && !existing.answerRange) {
      matches.set(questionNo, { ...existing, answerRange: entry.range })
    }
  }

  return matches
}

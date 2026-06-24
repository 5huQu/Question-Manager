import { detectQuestionNumbers } from './question-number-detector.js'
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
}

const PAGE_MARKER_RE = /<!--\s*(?:GLM|DOC2X)_PAGE:\d+\s*-->/g
const ANSWER_MARKER_RE = /【\s*答案\s*】|答案\s*[:：]/
const ANALYSIS_MARKER_RE = /【\s*(?:解析|分析|详解)\s*】|(?:解析|分析|详解)\s*[:：]/

function cleanField(value: string) {
  return String(value || '').replace(PAGE_MARKER_RE, '').trim()
}

function firstMarker(pattern: RegExp, source: string) {
  const match = pattern.exec(source)
  return match ? { index: match.index, end: match.index + match[0].length } : null
}

function rangeFor(offset: number, start: number, end: number): MarkdownRange | undefined {
  return end > start ? { start: offset + start, end: offset + end } : undefined
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
      stemRange: rangeFor(offset, 0, answer.index),
      answerRange: rangeFor(offset, answer.end, analysis.index),
      analysisRange: rangeFor(offset, analysis.end, source.length),
      hasFieldMarkers: true,
    }
  }

  if (analysis && answer && analysis.index < answer.index) {
    return {
      stemMarkdown: cleanField(source.slice(0, analysis.index)),
      answerText: cleanField(source.slice(answer.end)),
      analysisMarkdown: cleanField(source.slice(analysis.end, answer.index)),
      stemRange: rangeFor(offset, 0, analysis.index),
      answerRange: rangeFor(offset, answer.end, source.length),
      analysisRange: rangeFor(offset, analysis.end, answer.index),
      hasFieldMarkers: true,
    }
  }

  if (answer) {
    return {
      stemMarkdown: cleanField(source.slice(0, answer.index)),
      answerText: cleanField(source.slice(answer.end)),
      analysisMarkdown: '',
      stemRange: rangeFor(offset, 0, answer.index),
      answerRange: rangeFor(offset, answer.end, source.length),
      hasFieldMarkers: true,
    }
  }

  if (analysis) {
    return {
      stemMarkdown: cleanField(source.slice(0, analysis.index)),
      answerText: '',
      analysisMarkdown: cleanField(source.slice(analysis.end)),
      stemRange: rangeFor(offset, 0, analysis.index),
      analysisRange: rangeFor(offset, analysis.end, source.length),
      hasFieldMarkers: true,
    }
  }

  return {
    stemMarkdown: cleanField(source),
    answerText: '',
    analysisMarkdown: '',
    stemRange: rangeFor(offset, 0, source.length),
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
    const clean = line.replace(/^\s*(?:#{1,6}\s*)?/, '').replace(/\s*[:：]?\s*$/, '')
    const title = config.solutionSectionKeywords.find((keyword) => clean === keyword)
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
      answerRange: fields.answerRange || fields.stemRange || fallbackRange,
    }
  }
  if (section.kind === 'analysis') {
    return {
      analysisMarkdown: fields.analysisMarkdown || fields.stemMarkdown,
      analysisRange: fields.analysisRange || fields.stemRange || fallbackRange,
    }
  }
  return {
    answerText: fields.answerText,
    analysisMarkdown: fields.analysisMarkdown || (!fields.answerText ? fields.stemMarkdown : ''),
    answerRange: fields.answerRange,
    analysisRange: fields.analysisRange || (!fields.answerText ? fields.stemRange : undefined),
  }
}

export function extractSolutionMatches(markdown: string, sections: SolutionSection[] = findSolutionSections(markdown), config: ImportFlowV2ParserConfig = getParserConfig()) {
  const source = String(markdown || '')
  const matches = new Map<string, SolutionMatch>()
  for (const section of sections) {
    const content = source.slice(section.contentStart, section.end)
    const offset = section.contentStart
    const starts = detectQuestionNumbers(content, config)
    const chunks = splitMarkdownByQuestionNumbers(content, starts)
    for (const chunk of chunks) {
      const fields = splitQuestionFields(chunk.body, offset + chunk.contentStart)
      const fallbackRange = { start: offset + chunk.contentStart, end: offset + chunk.end }
      const patch = solutionPatchForSection(section, fields, fallbackRange)
      matches.set(chunk.questionNo, mergeSolutionMatch(matches.get(chunk.questionNo), patch))
    }
  }
  return matches
}

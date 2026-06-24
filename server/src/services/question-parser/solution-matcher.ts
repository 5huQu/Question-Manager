import { detectQuestionNumbers } from './question-number-detector.js'
import { splitMarkdownByQuestionNumbers } from './markdown-question-splitter.js'

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
const SOLUTION_SECTION_RE = /(^|\n)([ \t]*(?:#{1,6}\s*)?(参考答案|答案与解析|答案解析|参考解析|解析|分析|详解|答案)\s*[:：]?\s*)(?=\n|$)/g

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

export function findSolutionSections(markdown: string): SolutionSection[] {
  const source = String(markdown || '')
  const headings: SolutionSection[] = []
  SOLUTION_SECTION_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SOLUTION_SECTION_RE.exec(source))) {
    const leading = match[1] || ''
    const marker = match[2] || ''
    const title = match[3] || ''
    const start = match.index + leading.length
    headings.push({
      kind: solutionKind(title),
      title,
      start,
      contentStart: start + marker.length,
      end: source.length,
    })
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

export function extractSolutionMatches(markdown: string, sections: SolutionSection[] = findSolutionSections(markdown)) {
  const source = String(markdown || '')
  const matches = new Map<string, SolutionMatch>()
  for (const section of sections) {
    const content = source.slice(section.contentStart, section.end)
    const offset = section.contentStart
    const starts = detectQuestionNumbers(content)
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

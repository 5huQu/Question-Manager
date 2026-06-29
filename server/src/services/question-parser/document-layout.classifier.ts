import { detectQuestionNumbers, detectSolutionQuestionNumbers, type QuestionNumberMatch } from './question-number-detector.js'
import { findSolutionSections, maskNonSolutionBlocks, type SolutionSection } from './solution-matcher.js'
import { getParserConfig } from './parser-config.js'
import type { ImportFlowV2ParserConfig } from './default-parser-config.js'

export type QuestionDocumentLayout =
  | 'inline_solution'
  | 'appendix_solution'
  | 'questions_only'
  | 'solution_only'
  | 'unknown'

export type QuestionDocumentCleaningRule =
  | 'same_document_inline'
  | 'same_document_appendix'
  | 'question_document_only'
  | 'solution_document_only'
  | 'fallback'

export type QuestionDocumentLayoutEvidence = {
  questionCount: number
  answerMarkerCount: number
  analysisMarkerCount: number
  firstQuestionOffset?: number
  firstAnswerOffset?: number
  firstAnalysisOffset?: number
  firstAnswerPage?: number
  firstAnalysisPage?: number
  globalSolutionHeadingOffset?: number
  globalSolutionHeadingTitle?: string
  repeatedQuestionNosAfterHeading: string[]
  firstQuestionNoAfterHeading?: string
}

export type QuestionDocumentLayoutClassification = {
  layout: QuestionDocumentLayout
  cleaningRule: QuestionDocumentCleaningRule
  confidence: number
  solutionStart?: number
  evidence: QuestionDocumentLayoutEvidence
}

type PageMarker = {
  offset: number
  pageNo: number
}

const PAGE_MARKER_RE = /<!--\s*(?:GLM|DOC2X)_PAGE:\s*(\d+)\s*-->/g
const ANSWER_MARKER_RE = /【\s*答案\s*】|答案\s*[:：]/g
const ANALYSIS_MARKER_RE = /【\s*(?:解析|分析|详解)\s*】|(?:解析|分析|详解)\s*[:：]/g

function collectRegexOffsets(pattern: RegExp, source: string) {
  const matches: number[] = []
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  for (const match of source.matchAll(re)) matches.push(match.index || 0)
  return matches
}

function collectPageMarkers(source: string): PageMarker[] {
  const markers: PageMarker[] = []
  for (const match of source.matchAll(PAGE_MARKER_RE)) {
    markers.push({ offset: match.index || 0, pageNo: Number(match[1]) || 1 })
  }
  return markers.sort((left, right) => left.offset - right.offset)
}

function pageForOffset(markers: PageMarker[], offset: number | undefined) {
  if (offset === undefined || !markers.length) return undefined
  let pageNo = markers[0].pageNo
  for (const marker of markers) {
    if (marker.offset > offset) break
    pageNo = marker.pageNo
  }
  return pageNo
}

function numberValue(value: string | undefined) {
  const parsed = Number.parseInt(String(value || '').replace(/[^\d]/g, ''), 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function lineAt(source: string, offset: number) {
  const bounds = lineBoundsAt(source, offset)
  return source.slice(bounds.start, bounds.end)
}

function lineBoundsAt(source: string, offset: number) {
  const start = Math.max(0, source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1)
  const end = source.indexOf('\n', offset)
  return { start, end: end < 0 ? source.length : end }
}

function isBracketFieldMarkerLine(line: string) {
  return /^\s*(?:#{1,6}\s*)?【\s*(?:答案|解析|分析|详解)\s*】/.test(line)
}

function isStrongSolutionHeading(title: string) {
  return /参考|答案与解析|答案解析|试题解析|评分标准/.test(title)
}

function isLikelySolutionLeadAnswerLine(source: string, match: QuestionNumberMatch, markerOffset: number) {
  const lineBounds = lineBoundsAt(source, match.lineStart)
  if (lineBounds.start > markerOffset) return false
  const answerText = source.slice(match.contentStart, Math.min(lineBounds.end, markerOffset)).trim()
  if (!answerText || answerText.length > 80) return false
  if (/^\s*(?:#{1,6}\s*)?$/.test(answerText)) return false
  return !/[。？！?？；]|(?:如图|已知|下列|求|证明|设|若|关于)/.test(answerText)
}

function strictGlobalSolutionSection(
  markdown: string,
  sections: SolutionSection[],
  questionMatches: QuestionNumberMatch[],
  config: ImportFlowV2ParserConfig,
): { section: SolutionSection; repeatedQuestionNos: string[]; firstQuestionNoAfterHeading?: string } | undefined {
  for (const section of sections) {
    const before = questionMatches.filter((item) => item.start < section.start)
    const sectionContent = markdown.slice(section.contentStart)
    const after = detectSolutionQuestionNumbers(maskNonSolutionBlocks(sectionContent, config), config).map((item) => ({
      ...item,
      start: item.start + section.contentStart,
      contentStart: item.contentStart + section.contentStart,
      lineStart: item.lineStart + section.contentStart,
    }))
    if (!after.length) continue

    const beforeNos = new Set(before.map((item) => item.questionNo).filter(Boolean))
    const repeatedQuestionNos = Array.from(new Set(after.map((item) => item.questionNo).filter((questionNo) => beforeNos.has(questionNo))))
    const firstAfterNo = after[0]?.questionNo
    const firstAfterValue = numberValue(firstAfterNo)
    const lastBeforeValue = numberValue(before[before.length - 1]?.questionNo)
    const line = lineAt(markdown, section.start)
    const bracketFieldMarker = isBracketFieldMarkerLine(line)
    const strongHeading = isStrongSolutionHeading(section.title)
    const startsRepeatedList = Boolean(firstAfterNo && beforeNos.has(firstAfterNo))
    const restartsNumbering = firstAfterValue !== undefined && lastBeforeValue !== undefined && firstAfterValue < lastBeforeValue

    if (!before.length && strongHeading) {
      return { section, repeatedQuestionNos, firstQuestionNoAfterHeading: firstAfterNo }
    }

    if (before.length && strongHeading && (startsRepeatedList || restartsNumbering || repeatedQuestionNos.length >= 2)) {
      return { section, repeatedQuestionNos, firstQuestionNoAfterHeading: firstAfterNo }
    }

    if (before.length && !bracketFieldMarker && startsRepeatedList && repeatedQuestionNos.length >= Math.min(2, before.length)) {
      return { section, repeatedQuestionNos, firstQuestionNoAfterHeading: firstAfterNo }
    }
  }
  return undefined
}

function markerDrivenAppendixStart(
  source: string,
  questionMatches: QuestionNumberMatch[],
  markerOffsets: number[],
): { start: number; repeatedQuestionNos: string[]; firstQuestionNoAfterHeading?: string } | undefined {
  if (questionMatches.length < 2 || !markerOffsets.length) return undefined
  const firstMarker = markerOffsets[0]
  if (firstMarker < source.length * 0.35) return undefined
  const beforeMarker = questionMatches.filter((item) => item.start < firstMarker)
  const after = questionMatches.filter((item) => item.start > firstMarker)
  if (beforeMarker.length < 2) return undefined

  const lastBeforeMarker = beforeMarker[beforeMarker.length - 1]
  const earlierBeforeNos = new Set(beforeMarker.slice(0, -1).map((item) => item.questionNo))
  const leadAnswerLine = lastBeforeMarker
    && earlierBeforeNos.has(lastBeforeMarker.questionNo)
    && isLikelySolutionLeadAnswerLine(source, lastBeforeMarker, firstMarker)
    ? lastBeforeMarker
    : undefined
  if (!leadAnswerLine && after.length < 2) return undefined
  if (leadAnswerLine && after.length < 1) return undefined

  const beforeQuestions = leadAnswerLine ? beforeMarker.slice(0, -1) : beforeMarker
  if (beforeQuestions.length < 2) return undefined
  const beforeNos = new Set(beforeQuestions.map((item) => item.questionNo))
  const repeatedAfterNos = after.map((item) => item.questionNo).filter((questionNo) => beforeNos.has(questionNo))
  const repeatedQuestionNos = Array.from(new Set([
    ...(leadAnswerLine ? [leadAnswerLine.questionNo] : []),
    ...repeatedAfterNos,
  ]))
  const firstAfterNo = leadAnswerLine?.questionNo || after[0]?.questionNo
  if (!firstAfterNo || !beforeNos.has(firstAfterNo) || repeatedQuestionNos.length < 2) return undefined
  const start = leadAnswerLine?.lineStart ?? Math.max(0, source.lastIndexOf('\n', Math.max(0, firstMarker - 1)) + 1)
  return { start, repeatedQuestionNos, firstQuestionNoAfterHeading: firstAfterNo }
}

export function classifyQuestionDocumentLayout(
  markdown: string,
  config: ImportFlowV2ParserConfig = getParserConfig(),
  options: { detectionMarkdown?: string } = {},
): QuestionDocumentLayoutClassification {
  const source = String(markdown || '')
  const detectionMarkdown = options.detectionMarkdown || source
  const questionMatches = detectQuestionNumbers(detectionMarkdown, config)
  const answerMarkers = collectRegexOffsets(ANSWER_MARKER_RE, source)
  const analysisMarkers = collectRegexOffsets(ANALYSIS_MARKER_RE, source)
  const pageMarkers = collectPageMarkers(source)
  const solutionSections = findSolutionSections(source, config)
  const globalSection = strictGlobalSolutionSection(source, solutionSections, questionMatches, config)
  const markerAppendix = globalSection ? undefined : markerDrivenAppendixStart(
    source,
    questionMatches,
    [...answerMarkers, ...analysisMarkers].sort((left, right) => left - right),
  )
  const firstAnswerOffset = answerMarkers[0]
  const firstAnalysisOffset = analysisMarkers[0]
  const evidence: QuestionDocumentLayoutEvidence = {
    questionCount: questionMatches.length,
    answerMarkerCount: answerMarkers.length,
    analysisMarkerCount: analysisMarkers.length,
    firstQuestionOffset: questionMatches[0]?.start,
    firstAnswerOffset,
    firstAnalysisOffset,
    firstAnswerPage: pageForOffset(pageMarkers, firstAnswerOffset),
    firstAnalysisPage: pageForOffset(pageMarkers, firstAnalysisOffset),
    globalSolutionHeadingOffset: globalSection?.section.start ?? markerAppendix?.start,
    globalSolutionHeadingTitle: globalSection?.section.title,
    repeatedQuestionNosAfterHeading: globalSection?.repeatedQuestionNos || markerAppendix?.repeatedQuestionNos || [],
    firstQuestionNoAfterHeading: globalSection?.firstQuestionNoAfterHeading || markerAppendix?.firstQuestionNoAfterHeading,
  }

  if (!questionMatches.length) {
    if (answerMarkers.length || analysisMarkers.length || solutionSections.length) {
      return { layout: 'solution_only', cleaningRule: 'solution_document_only', confidence: 0.74, evidence }
    }
    return { layout: 'unknown', cleaningRule: 'fallback', confidence: 0.2, evidence }
  }

  if (globalSection && globalSection.section.start <= questionMatches[0].start) {
    return {
      layout: 'solution_only',
      cleaningRule: 'solution_document_only',
      confidence: 0.86,
      solutionStart: globalSection.section.start,
      evidence,
    }
  }

  if (globalSection) {
    return {
      layout: 'appendix_solution',
      cleaningRule: 'same_document_appendix',
      confidence: 0.9,
      solutionStart: globalSection.section.start,
      evidence,
    }
  }

  if (markerAppendix) {
    return {
      layout: 'appendix_solution',
      cleaningRule: 'same_document_appendix',
      confidence: 0.78,
      solutionStart: markerAppendix.start,
      evidence,
    }
  }

  if (answerMarkers.length || analysisMarkers.length) {
    return { layout: 'inline_solution', cleaningRule: 'same_document_inline', confidence: 0.82, evidence }
  }

  return { layout: 'questions_only', cleaningRule: 'question_document_only', confidence: 0.8, evidence }
}

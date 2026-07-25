import type { ImportFlowV2ParserConfig } from './default-parser-config.js'
import type { QuestionNumberMatch } from './question-number-detector.js'
import { detectSolutionQuestionNumbers } from './question-number-detector.js'
import { splitMarkdownByQuestionNumbers, type QuestionMarkdownChunk } from './markdown-question-splitter.js'
import {
  extractSolutionMatches,
  firstAnswerTableStart,
  maskNonSolutionBlocks,
  splitQuestionFields,
  type MarkdownRange,
  type SolutionMatch,
  type SolutionSection,
} from './solution-matcher.js'
import { extractAnswerTable, extractAnswerTableEntries, extractQuestionThenHeadingSolutionMatches } from './solution-document.parser.js'
import type { QuestionDocumentLayoutClassification } from './document-layout.classifier.js'
import { containsSectionHeading, hasAnswerOrAnalysisMarkerTextExported } from './structural-detection.js'
import { numberValue } from './chunk-processing.js'

export function solutionValue(fieldsValue: string, matchValue: string | undefined) {
  return fieldsValue.trim() || String(matchValue || '').trim()
}

export function solutionRange(fieldsRange: MarkdownRange | undefined, matchRange: MarkdownRange | undefined) {
  return fieldsRange || matchRange
}

export function nonEmpty(value: string | undefined) {
  const text = String(value || '').trim()
  return text || undefined
}

export function mergeSolutionMatch(target: SolutionMatch | undefined, patch: SolutionMatch): SolutionMatch {
  return {
    ...(target || {}),
    ...Object.fromEntries(Object.entries(patch).filter(([key, value]) => key !== 'warnings' && value !== undefined && value !== '')),
    warnings: [
      ...(target?.warnings || []),
      ...(patch.warnings || []),
    ],
  }
}

export function compactForCheck(value: string) {
  return String(value || '').replace(/\s+/g, '').replace(/[，。；、,.:：]/g, '')
}

export function isMetadataLikeAnswer(value: string | undefined, config: ImportFlowV2ParserConfig) {
  const compact = compactForCheck(String(value || '')).slice(0, 120)
  if (!compact) return false
  return config.metadataBlockKeywords.some((keyword) => {
    const key = compactForCheck(keyword)
    return compact.startsWith(key) || compact.includes(`【${key}】`)
  })
}

export function simpleChoiceAnswer(value: string) {
  const compact = compactForCheck(value).replace(/[;；]$/g, '').toUpperCase()
  return /^[A-D]{1,4}$/.test(compact) ? compact : ''
}

function hasConclusionForAnswer(value: string, answerText: string | undefined) {
  const answer = simpleChoiceAnswer(answerText || '')
  if (!answer) return true
  const compact = compactForCheck(value).toUpperCase()
  return compact.includes(`故选${answer}`) || compact.includes(`选${answer}`)
}

function hasCompletedSolutionBeforeOrphan(value: string) {
  return /(?:故选|故答案|故填|故答案为|答案为|综上|证毕|得证)/.test(value.slice(-800))
}

function findTrailingUnnumberedSolutionBlock(body: string, answerText: string | undefined) {
  const source = String(body || '')
  const marker = /(?:\n\s*(?:<!--\s*(?:GLM|DOC2X)_PAGE:\d+\s*-->\s*)*)\n?\s*(?:【\s*(?:分析|解析)\s*】|(?:分析|解析)\s*[:：])/g
  const matches = Array.from(source.matchAll(marker))
  for (let index = 1; index < matches.length; index += 1) {
    const start = matches[index].index || 0
    const before = source.slice(0, start).trim()
    const orphan = source.slice(start).trim()
    if (before.length < 20 || orphan.length < 30) continue
    if (!hasCompletedSolutionBeforeOrphan(before)) continue
    if (!hasConclusionForAnswer(orphan, answerText)) continue
    return { splitIndex: start, before, orphan }
  }
  return null
}

function shouldInferMissingSolutionNo(currentNo: number | undefined, nextNo: number | undefined, expectedNos: Set<string>, tableAnswers: Map<string, string>) {
  if (currentNo === undefined || nextNo === undefined) return ''
  if (nextNo !== currentNo + 2) return ''
  const missingNo = String(currentNo + 1)
  if (!expectedNos.has(missingNo)) return ''
  if (!tableAnswers.has(missingNo)) return ''
  return missingNo
}

function trimBodyBeforeAnswerTable(body: string, config: ImportFlowV2ParserConfig) {
  const tableStart = firstAnswerTableStart(body, config)
  return tableStart === undefined ? body : body.slice(0, tableStart).trimEnd()
}

function inferUnmarkedStandaloneAnswer(body: string, offset: number): SolutionMatch | undefined {
  const source = String(body || '')
  const lines = source.split(/(?<=\n)/)
  let lineOffset = 0
  let answerStart = -1
  let answerEnd = -1
  let answerText = ''

  for (const lineWithNewline of lines) {
    const line = lineWithNewline.replace(/\n$/, '')
    const trimmed = line.trim()
    if (trimmed && !/^<!--\s*(?:GLM|DOC2X)_PAGE:\s*\d+\s*-->$/.test(trimmed)) {
      answerStart = lineOffset + line.indexOf(trimmed)
      answerEnd = answerStart + trimmed.length
      answerText = trimmed
      break
    }
    lineOffset += lineWithNewline.length
  }

  if (!answerText || answerText.length > 80) return undefined
  if (/[。！？；]/.test(answerText)) return undefined
  if (/^(?:[（(]\s*\d+\s*[)）]|解|证明|因为|由|设|当|若|故|所以|分析|详解)/.test(answerText)) return undefined

  const restStart = answerEnd
  const analysisMarkdown = source.slice(restStart)
    .replace(/<!--\s*(?:GLM|DOC2X)_PAGE:\s*\d+\s*-->/g, '')
    .trim()
  return {
    answerText,
    analysisMarkdown: analysisMarkdown || undefined,
    answerRange: { start: offset + answerStart, end: offset + answerEnd },
    analysisRange: analysisMarkdown ? { start: offset + restStart, end: offset + source.length } : undefined,
  }
}

function solutionMatchFromWholeDocumentChunk(body: string, offset: number, fallbackRange: MarkdownRange): SolutionMatch {
  const fields = splitQuestionFields(body, offset)
  if (!fields.hasFieldMarkers) {
    const inferred = inferUnmarkedStandaloneAnswer(body, offset)
    if (inferred) return inferred
  }
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

export function extractWholeDocumentSolutionMatches(markdown: string, start: number, config: ImportFlowV2ParserConfig, expectedQuestionNos: string[] = []) {
  const source = markdown.slice(start)
  const starts = detectSolutionQuestionNumbers(maskNonSolutionBlocks(source, config), config)
  const chunks = splitMarkdownByQuestionNumbers(source, starts)
  const matches = new Map<string, SolutionMatch>()
  let chunksWithFieldMarkers = 0
  const expectedNos = new Set(expectedQuestionNos)
  const tableAnswers = extractAnswerTable(source, config)

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    const nextChunk = chunks[index + 1]
    const currentNo = numberValue(chunk.questionNo)
    const nextNo = numberValue(nextChunk?.questionNo)
    const missingNo = shouldInferMissingSolutionNo(currentNo, nextNo, expectedNos, tableAnswers)
    const inferred = missingNo ? findTrailingUnnumberedSolutionBlock(chunk.body, tableAnswers.get(missingNo)) : null
    const currentBody = trimBodyBeforeAnswerTable(inferred?.before || chunk.body, config)
    const fields = splitQuestionFields(currentBody, start + chunk.contentStart)
    if (fields.hasFieldMarkers) chunksWithFieldMarkers += 1
    matches.set(chunk.questionNo, mergeSolutionMatch(matches.get(chunk.questionNo), solutionMatchFromWholeDocumentChunk(
      currentBody,
      start + chunk.contentStart,
      { start: start + chunk.contentStart, end: start + chunk.contentStart + currentBody.length },
    )))

    if (inferred && missingNo) {
      const orphanStart = start + chunk.contentStart + inferred.splitIndex
      const orphanPatch = solutionMatchFromWholeDocumentChunk(
        inferred.orphan,
        orphanStart,
        { start: orphanStart, end: start + chunk.end },
      )
      matches.set(missingNo, mergeSolutionMatch(matches.get(missingNo), {
        ...orphanPatch,
        answerText: orphanPatch.answerText || tableAnswers.get(missingNo),
        warnings: [`第 ${missingNo} 题解析区缺失题号，已按前后题号和答案表自动归位，请核对。`],
      }))
    }
  }

  return { matches, chunkCount: chunks.length, chunksWithFieldMarkers }
}

function offsetRange(range: MarkdownRange | undefined, offset: number): MarkdownRange | undefined {
  return range ? { start: range.start + offset, end: range.end + offset } : undefined
}

export function mergeTableAnswers(matches: Map<string, SolutionMatch>, markdown: string, config: ImportFlowV2ParserConfig, offset = 0) {
  if (config.answerTablePolicy === 'disabled') return matches
  const entries = new Map<string, { questionNo: string; answerText: string; range?: MarkdownRange }>()
  for (const entry of extractAnswerTableEntries(markdown, config)) entries.set(entry.questionNo, entry)
  for (const [questionNo, entry] of entries) {
    const existing = matches.get(questionNo)
    const answerText = entry.answerText
    const answerRange = offsetRange(entry.range, offset)
    const shouldOverride = Boolean(existing?.answerText) && (
      (config.answerTablePolicy === 'override_metadata_like_answer' && isMetadataLikeAnswer(existing?.answerText, config))
      || (config.answerTablePolicy === 'prefer_table_for_choice_questions' && Boolean(simpleChoiceAnswer(answerText)))
    )
    if (!existing || !existing.answerText || shouldOverride) {
      matches.set(questionNo, { ...(existing || {}), answerText, answerRange })
    } else if (String(existing.answerText || '').trim() === answerText.trim() && answerRange && !existing.answerRange) {
      matches.set(questionNo, { ...existing, answerRange })
    }
  }
  return matches
}

export function extractAppendixSolutionMatches(
  markdown: string,
  start: number,
  sections: SolutionSection[],
  config: ImportFlowV2ParserConfig,
  expectedQuestionNos: string[] = [],
) {
  const scopedSections = sections.filter((section) => section.start >= start)
  const wholeDocument = extractWholeDocumentSolutionMatches(markdown, start, config, expectedQuestionNos)
  const headingThenQuestionMatches = (
    wholeDocument.chunkCount > 0
    && wholeDocument.chunksWithFieldMarkers >= Math.ceil(wholeDocument.chunkCount / 2)
  )
    ? wholeDocument.matches
    : scopedSections.length
      ? extractSolutionMatches(markdown, scopedSections, config)
      : wholeDocument.matches
  const questionThenHeadingMatches = extractQuestionThenHeadingSolutionMatches(markdown, config, start).matches

  if (config.solutionBindingStrategy === 'question_then_heading') {
    return mergeTableAnswers(questionThenHeadingMatches, markdown.slice(start), config, start)
  }
  if (config.solutionBindingStrategy === 'auto') {
    const score = (matches: Map<string, SolutionMatch>) => Array.from(matches.values()).reduce((total, match) => {
      return total + (String(match.answerText || '').trim() ? 2 : 0) + (String(match.analysisMarkdown || '').trim() ? 3 : 0)
    }, 0)
    return mergeTableAnswers(
      score(questionThenHeadingMatches) > score(headingThenQuestionMatches) ? questionThenHeadingMatches : headingThenQuestionMatches,
      markdown.slice(start),
      config,
      start,
    )
  }
  if (
    wholeDocument.chunkCount > 0
    && wholeDocument.chunksWithFieldMarkers >= Math.ceil(wholeDocument.chunkCount / 2)
  ) {
    return mergeTableAnswers(wholeDocument.matches, markdown.slice(start), config, start)
  }
  if (scopedSections.length) return mergeTableAnswers(extractSolutionMatches(markdown, scopedSections, config), markdown.slice(start), config, start)
  return mergeTableAnswers(wholeDocument.matches, markdown.slice(start), config, start)
}

export function cleanQuestionMatchesForLayout(
  markdown: string,
  matches: QuestionNumberMatch[],
  classification: QuestionDocumentLayoutClassification,
  config: ImportFlowV2ParserConfig,
) {
  if (classification.cleaningRule !== 'same_document_inline') return matches
  const chunks = splitMarkdownByQuestionNumbers(markdown, matches)
  const result: QuestionNumberMatch[] = []
  let skippedAnalysisNumbering = false

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const chunk = chunks[index]
    const previous = result[result.length - 1]
    if (!previous || !chunk) {
      result.push(match)
      skippedAnalysisNumbering = false
      continue
    }

    const currentNo = numberValue(match.questionNo)
    const previousNo = numberValue(previous.questionNo)
    const textSincePreviousQuestion = markdown.slice(previous.contentStart, match.start)
    const afterAnswerOrAnalysis = hasAnswerOrAnalysisMarkerTextExported(textSincePreviousQuestion)
    const bodyHasAnswerOrAnalysis = hasAnswerOrAnalysisMarkerTextExported(chunk.body)
    const crossedSectionHeading = containsSectionHeading(textSincePreviousQuestion, config)
    const resetOrDuplicate = currentNo !== undefined && previousNo !== undefined && currentNo <= previousNo
    const looksLikeContinuedAnalysisSteps = skippedAnalysisNumbering
      && currentNo !== undefined
      && previousNo !== undefined
      && currentNo <= Math.max(5, previousNo + 1)

    if (
      afterAnswerOrAnalysis
      && !bodyHasAnswerOrAnalysis
      && !crossedSectionHeading
      && (resetOrDuplicate || looksLikeContinuedAnalysisSteps)
    ) {
      skippedAnalysisNumbering = true
      continue
    }

    result.push(match)
    skippedAnalysisNumbering = false
  }

  return result
}

import type { ImportFlowV2ParserConfig } from './default-parser-config.js'
import { detectQuestionNumbers } from './question-number-detector.js'
import { splitMarkdownByQuestionNumbers } from './markdown-question-splitter.js'

export function normalizedLine(value: string) {
  return value.replace(/^\s*(?:#{1,6}\s*)?/, '').replace(/\s+/g, '')
}

export function normalizedStructuralLine(value: string) {
  return normalizedLine(value).replace(/^(?:第[0-9０-９]{1,3}题|[0-9０-９]{1,3}[.．、·•]|[一二三四五六七八九十百]+、)/, '')
}

export const CHINESE_SECTION_PREFIX_RE = /^[一二三四五六七八九十百千万]+[、.．]/

export function normalizedSectionHeadingTitle(value: string) {
  const normalized = normalizedLine(value)
  if (!CHINESE_SECTION_PREFIX_RE.test(normalized)) return ''
  return normalized.replace(CHINESE_SECTION_PREFIX_RE, '')
}

export function normalizedConfiguredSectionHeading(value: string) {
  return normalizedLine(value).replace(CHINESE_SECTION_PREFIX_RE, '')
}

export function sectionHeadingMatches(lineTitle: string, configuredHeading: string) {
  if (!lineTitle || !configuredHeading) return false
  if (lineTitle === configuredHeading) return true
  if (!lineTitle.startsWith(configuredHeading)) return false
  return /^[:：（(本]/.test(lineTitle.slice(configuredHeading.length))
}

export function isSectionHeading(line: string, config: ImportFlowV2ParserConfig) {
  const normalized = normalizedSectionHeadingTitle(line)
  if (!normalized) return false
  return config.sectionHeadings.some((item) => {
    const heading = normalizedConfiguredSectionHeading(item)
    return sectionHeadingMatches(normalized, heading)
  })
}

export function isStructuralLine(line: string, config: ImportFlowV2ParserConfig) {
  const normalized = normalizedStructuralLine(line)
  if (!normalized) return false
  if (isSectionHeading(line, config)) return true
  return config.documentNoteKeywords.some((item) => {
    const keyword = normalizedLine(item)
    return normalized.startsWith(keyword)
  })
}

export function findFirstSectionHeadingStart(value: string, config: ImportFlowV2ParserConfig) {
  const source = String(value || '')
  const lines = source.split(/(?<=\n)/)
  let offset = 0
  for (const lineWithNewline of lines) {
    const line = lineWithNewline.replace(/\n$/, '')
    if (isSectionHeading(line, config)) return offset
    offset += lineWithNewline.length
  }
  return -1
}

export function hasPrimaryQuestionMarker(line: string, config: ImportFlowV2ParserConfig) {
  return config.primaryQuestionPatterns.some((pattern) => {
    const match = new RegExp(pattern, 'i').exec(line)
    return Boolean(match && /^[ \t#]*$/.test(line.slice(0, match.index)))
  })
}

export function isReferenceFormulaHeading(line: string, config: ImportFlowV2ParserConfig) {
  const normalized = normalizedStructuralLine(line)
  return config.documentNoteKeywords.some((item) => normalized.startsWith(normalizedLine(item)) && normalizedLine(item).includes('参考公式'))
}

export function isAnswerOrAnalysisMarker(line: string) {
  return /^\s*(?:【\s*)?(?:参考答案|答案与解析|答案|解析|分析|详解)(?:\s*】)?\s*[:：]?/.test(line)
}

export function blankPreservingNewlines(value: string) {
  return value.replace(/[^\n]/g, ' ')
}

export function isLectureNonQuestionHeading(line: string, config: ImportFlowV2ParserConfig) {
  const title = normalizedLine(line)
  return config.lectureNonQuestionSectionKeywords.some((item) => {
    const keyword = normalizedLine(item)
    return Boolean(keyword) && (title === keyword || title === `点${keyword}` || title.endsWith(keyword))
  })
}

export function isLikelyLectureQuestionBody(value: string) {
  const body = String(value || '')
  return hasAnswerOrAnalysisMarkerText(body)
    || hasChoiceOptionLines(body)
    || /(?:_{2,}|（\s*）|\(\s*\))/.test(body)
    || /^\s*(?:【\s*(?:单选|多选|填空|解答)[^】]*】|[（(](?:20\d{2}|高[一二三]|初[一二三]))/m.test(body)
}

function hasAnswerOrAnalysisMarkerText(value: string) {
  return /【\s*(?:答案|解析|分析|详解)\s*】|(?:答案|解析|分析|详解)\s*[:：]/.test(value)
}

function hasChoiceOptionLines(value: string) {
  return /(?:^|\n)\s*[A-D]\s*[.．、]/.test(value)
}

/**
 * A lecture often places a numbered knowledge/tips list immediately before the
 * exercises in each topic. Mask that prelude (without changing offsets) until
 * the first chunk with strong question evidence.
 */
export function maskLectureNonQuestionSections(value: string, config: ImportFlowV2ParserConfig) {
  const source = String(value || '')
  const lines = Array.from(source.matchAll(/.*(?:\n|$)/g))
    .filter((match) => String(match[0] || '').length)
    .map((match) => ({
      start: match.index || 0,
      end: (match.index || 0) + String(match[0] || '').length,
      text: String(match[0] || '').replace(/\n$/, ''),
    }))
  const ranges: Array<{ start: number; end: number }> = []

  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index]
    if (!isLectureNonQuestionHeading(heading.text, config)) continue
    const nextHeading = lines.slice(index + 1).find((line) => /^\s*#{1,6}\s+/.test(line.text))
    const sectionEnd = nextHeading?.start ?? source.length
    const section = source.slice(heading.end, sectionEnd)
    const matches = detectQuestionNumbers(section, config)
    const chunks = splitMarkdownByQuestionNumbers(section, matches)
    const firstQuestionIndex = chunks.findIndex((chunk) => isLikelyLectureQuestionBody(chunk.body))
    const firstQuestionStart = firstQuestionIndex >= 0 ? matches[firstQuestionIndex]?.start : undefined
    ranges.push({
      start: heading.start,
      end: firstQuestionStart === undefined ? sectionEnd : heading.end + firstQuestionStart,
    })
  }

  let masked = source
  for (const range of ranges.sort((left, right) => right.start - left.start)) {
    masked = masked.slice(0, range.start) + blankPreservingNewlines(masked.slice(range.start, range.end)) + masked.slice(range.end)
  }
  return masked
}

export function maskPreludeBeforeFirstSectionHeading(value: string, config: ImportFlowV2ParserConfig) {
  const headingStart = findFirstSectionHeadingStart(value, config)
  if (headingStart <= 0) return value
  const beforeHeading = value.slice(0, headingStart)
  const afterHeading = value.slice(headingStart)
  if (!detectQuestionNumbers(afterHeading, config).length) return value
  return blankPreservingNewlines(beforeHeading) + afterHeading
}

/**
 * Hide non-question material before detecting question numbers while preserving
 * every offset.
 */
export function maskStructuralMarkdown(value: string, config: ImportFlowV2ParserConfig) {
  const markdown = maskPreludeBeforeFirstSectionHeading(String(value || ''), config)
  let inReferenceFormula = false
  let sawQuestion = false
  return markdown.split(/(?<=\n)/).map((lineWithNewline) => {
    const line = lineWithNewline.replace(/\n$/, '')
    const startsSubstantialQuestion = /^\s*(?:#{1,6}\s*)?[0-9０-９]{1,3}\s*[.．、·•]\s*[（(]\s*[0-9０-９]+\s*分/u.test(line)
    if (inReferenceFormula && sawQuestion && startsSubstantialQuestion && hasPrimaryQuestionMarker(line, config)) {
      inReferenceFormula = false
    }
    if (inReferenceFormula && isAnswerOrAnalysisMarker(line)) {
      inReferenceFormula = false
      return lineWithNewline
    }
    if (inReferenceFormula && !sawQuestion && isSectionHeading(line, config)) {
      inReferenceFormula = false
    }
    if (inReferenceFormula) return blankPreservingNewlines(lineWithNewline)
    if (!isStructuralLine(line, config)) {
      if (hasPrimaryQuestionMarker(line, config)) sawQuestion = true
      return lineWithNewline
    }
    if (isReferenceFormulaHeading(line, config)) inReferenceFormula = true
    return blankPreservingNewlines(lineWithNewline)
  }).join('')
}

export function maskStructuralText(value: string, config: ImportFlowV2ParserConfig) {
  return maskStructuralMarkdown(value, config)
}

export function containsSectionHeading(value: string, config: ImportFlowV2ParserConfig) {
  return String(value || '').split(/\n/).some((line) => isSectionHeading(line, config))
}

export function hasAnswerOrAnalysisMarkerTextExported(value: string) {
  return hasAnswerOrAnalysisMarkerText(value)
}

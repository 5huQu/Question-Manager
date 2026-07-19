import { normalizeHtmlImageTags, stripDoc2xMediaComments } from '../ocr-providers/ocr-document.normalizer.js'
import { getParserConfig } from './parser-config.js'
import type { ImportFlowV2ParserConfig } from './default-parser-config.js'

const DOC2X_FIGURE_MARKER_RE = /<!--\s*DOC2X_FIGURE:[^>\s]+\s*-->/g
const PAGE_MARKER_RE = /<!--\s*(?:GLM|DOC2X)_PAGE:\d+\s*-->/g
const PRINTED_PAGE_COUNTER_RE = /(^|\n)[ \t]*(?:#{1,6}[ \t]*)?第[ \t]*[0-9０-９]+[ \t]*页[ \t]*[,，、/／]?[ \t]*共[ \t]*[0-9０-９]+[ \t]*页[ \t]*/g
const PAPER_VOLUME_HEADING_RE = /^第(?:I{1,4}|IV|V|[一二三四五六七八九十]+)卷(?:[（(].*?[）)])?$/i
const GENERIC_QUESTION_SECTION_RE = /^[一二三四五六七八九十百千万]+[、.．](?:(?:单项|多项|单选|多选|非)?选择题|填空题|解答题|计算题|实验题|选做题)(?:[:： （(].*)?$/

function rewriteTrailingImageChoiceLabels(value: string) {
  const markerPattern = DOC2X_FIGURE_MARKER_RE.source
  const pairPattern = new RegExp(`(${markerPattern})[ \\t]*\\n+\\s*([A-H])\\s*(?=\\n|$)`, 'g')
  const matches = Array.from(value.matchAll(pairPattern))
  if (matches.length < 2) return value

  const groups: Array<typeof matches> = []
  let current: typeof matches = []
  for (const match of matches) {
    const label = String(match[2] || '').toUpperCase()
    const expected = String.fromCharCode(65 + current.length)
    const previous = current.at(-1)
    const between = previous
      ? value.slice((previous.index || 0) + previous[0].length, match.index || 0)
      : ''
    const hasOnlyFigureNotes = !between.replace(/<!--\s*figureText\s*:[\s\S]*?-->/gi, '').trim()
    if (!current.length || (label === expected && hasOnlyFigureNotes)) {
      current.push(match)
    } else {
      if (current.length >= 2) groups.push(current)
      current = label === 'A' ? [match] : []
    }
  }
  if (current.length >= 2) groups.push(current)
  if (!groups.length) return value

  let next = value
  for (const group of groups.reverse()) {
    for (const match of [...group].reverse()) {
      const start = match.index || 0
      next = `${next.slice(0, start)}${match[2]}.\n${match[1]}${next.slice(start + match[0].length)}`
    }
  }
  return next
}

function normalizedLine(value: string) {
  return String(value || '').replace(/^\s*(?:#{1,6}\s*)?/, '').replace(/\s+/g, '')
}

function normalizedStructuralLine(value: string) {
  return normalizedLine(value).replace(/^(?:第[0-9０-９]{1,3}题|[0-9０-９]{1,3}[.．、]|[一二三四五六七八九十百]+[、.．])/, '')
}

const CHINESE_SECTION_PREFIX_RE = /^[一二三四五六七八九十百千万]+[、.．]/

function normalizedSectionHeadingTitle(value: string) {
  const normalized = normalizedLine(value)
  if (!CHINESE_SECTION_PREFIX_RE.test(normalized)) return ''
  return normalized.replace(CHINESE_SECTION_PREFIX_RE, '')
}

function normalizedConfiguredSectionHeading(value: string) {
  return normalizedLine(value).replace(CHINESE_SECTION_PREFIX_RE, '')
}

function sectionHeadingMatches(lineTitle: string, configuredHeading: string) {
  if (!lineTitle || !configuredHeading) return false
  if (lineTitle === configuredHeading) return true
  if (!lineTitle.startsWith(configuredHeading)) return false
  return /^[:：（(本]/.test(lineTitle.slice(configuredHeading.length))
}

function isCarryoverSectionHeading(line: string, config: ImportFlowV2ParserConfig) {
  const normalized = normalizedSectionHeadingTitle(line)
  if (PAPER_VOLUME_HEADING_RE.test(normalizedLine(line))) return true
  if (GENERIC_QUESTION_SECTION_RE.test(normalizedLine(line))) return true
  if (!normalized) return false
  return config.sectionHeadings.some((item) => {
    const heading = normalizedConfiguredSectionHeading(item)
    return sectionHeadingMatches(normalized, heading)
  })
}

function isDocumentInstructionLine(line: string, config: ImportFlowV2ParserConfig) {
  const normalized = normalizedLine(line).replace(/^[【\[]|[】\]]$/g, '')
  return /^(?:请)?在答题卡上作答/.test(normalized)
    || config.documentNoteKeywords.some((item) => normalized.startsWith(normalizedLine(item)))
}

function stripCarryoverStructuralLines(value: string, config: ImportFlowV2ParserConfig) {
  return String(value || '').split(/(?<=\n)/).map((lineWithNewline) => {
    const line = lineWithNewline.replace(/\n$/, '')
    return isCarryoverSectionHeading(line, config) || isDocumentInstructionLine(line, config) ? '\n' : lineWithNewline
  }).join('')
}

export function cleanOcrPresentationMarkdown(value: string, config: ImportFlowV2ParserConfig = getParserConfig()) {
  const markerPattern = DOC2X_FIGURE_MARKER_RE.source
  const normalized = rewriteTrailingImageChoiceLabels(stripDoc2xMediaComments(normalizeHtmlImageTags(String(value || ''))))
    .replace(PRINTED_PAGE_COUNTER_RE, '$1')
  return stripCarryoverStructuralLines(normalized, config)
    .replace(PAGE_MARKER_RE, '\n')
    .replace(new RegExp(`(${markerPattern})\\s*(?:[图室]|figure)\\s*\\d+\\s*`, 'gi'), '$1\n')
    .replace(new RegExp(`(${markerPattern})\\s*[A-H]\\s*(?=\\n|$)`, 'gi'), '$1\n')
    .replace(/^\s*第\s*[0-9０-９]{1,3}\s*题\s*[图圖]\s*$/gim, '\n')
    .replace(/^\s*(?:[图室]|figure)\s*\d+\s*$/gim, '\n')
    .replace(/<div\b[^>]*>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

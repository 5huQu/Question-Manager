import { normalizeHtmlImageTags, stripDoc2xMediaComments } from '../ocr-providers/ocr-document.normalizer.js'
import { getParserConfig } from './parser-config.js'
import type { ImportFlowV2ParserConfig } from './default-parser-config.js'

const DOC2X_FIGURE_MARKER_RE = /<!--\s*DOC2X_FIGURE:[^>\s]+\s*-->/g
const PAGE_MARKER_RE = /<!--\s*(?:GLM|DOC2X)_PAGE:\d+\s*-->/g

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
  if (!normalized) return false
  return config.sectionHeadings.some((item) => {
    const heading = normalizedConfiguredSectionHeading(item)
    return sectionHeadingMatches(normalized, heading)
  })
}

function stripCarryoverStructuralLines(value: string, config: ImportFlowV2ParserConfig) {
  return String(value || '').split(/(?<=\n)/).map((lineWithNewline) => {
    const line = lineWithNewline.replace(/\n$/, '')
    return isCarryoverSectionHeading(line, config) ? '\n' : lineWithNewline
  }).join('')
}

export function cleanOcrPresentationMarkdown(value: string, config: ImportFlowV2ParserConfig = getParserConfig()) {
  const markerPattern = DOC2X_FIGURE_MARKER_RE.source
  const normalized = stripDoc2xMediaComments(normalizeHtmlImageTags(String(value || '')))
  return stripCarryoverStructuralLines(normalized, config)
    .replace(PAGE_MARKER_RE, '\n')
    .replace(new RegExp(`(${markerPattern})\\s*(?:[图室]|figure)\\s*\\d+\\s*`, 'gi'), '$1\n')
    .replace(new RegExp(`(${markerPattern})\\s*[A-D]\\s*(?=\\n|$)`, 'gi'), '$1\n')
    .replace(/^\s*第\s*[0-9０-９]{1,3}\s*题\s*[图圖]\s*$/gim, '\n')
    .replace(/^\s*(?:[图室]|figure)\s*\d+\s*$/gim, '\n')
    .replace(/<div\b[^>]*>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

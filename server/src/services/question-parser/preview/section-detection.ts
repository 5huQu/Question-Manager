import type { ImportFlowV2ParserConfig } from '../default-parser-config.js'
import { extractHtmlAnswerTableBlocks, extractInlineAnswerTableEntries } from '../solution-matcher.js'
import { cleanPreviewText } from './markdown-utils.js'
import type { TableAnswerEntry } from './types.js'

export function normalizeHeadingLine(line: string) {
  return String(line || '')
    .replace(/^\s*(?:#{1,6}\s*)?/, '')
    .replace(/^\s*【\s*/, '')
    .replace(/\s*】\s*$/, '')
    .replace(/\s*[:：]?\s*$/, '')
    .replace(/\s+/g, '')
}

export function metadataKeywordForLine(line: string, config: ImportFlowV2ParserConfig) {
  const title = normalizeHeadingLine(line)
  return config.metadataBlockKeywords.find((keyword) => {
    const normalizedKeyword = keyword.replace(/\s+/g, '')
    return title === normalizedKeyword || title.startsWith(normalizedKeyword)
  })
}

export function isMetadataLike(value: string | undefined, config: ImportFlowV2ParserConfig) {
  const normalized = cleanPreviewText(String(value || ''), 80).replace(/\s+/g, '')
  if (!normalized) return false
  return config.metadataBlockKeywords.some((keyword) => {
    const key = keyword.replace(/\s+/g, '')
    return normalized.startsWith(key) || normalized.includes(`【${key}】`)
  })
}

const CHINESE_SECTION_PREFIX_RE = /^[一二三四五六七八九十百千万]+[、.．]/

export function titleMatchesConfiguredSection(title: string, config: ImportFlowV2ParserConfig) {
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

export function containsQuestionSectionHeading(markdown: string, config: ImportFlowV2ParserConfig) {
  return String(markdown || '').split(/\r?\n/).some((line) => titleMatchesConfiguredSection(normalizeHeadingLine(line), config))
}

export function containsAnswerTable(markdown: string, config: ImportFlowV2ParserConfig) {
  return extractAnswerTableEntries(markdown, config).length > 0
}

export function extractAnswerTableEntries(markdown: string, config: ImportFlowV2ParserConfig): TableAnswerEntry[] {
  if (config.answerTablePolicy === 'disabled') return []
  const entries: TableAnswerEntry[] = []
  for (const block of extractHtmlAnswerTableBlocks(markdown)) entries.push(...block.entries)
  for (const entry of extractInlineAnswerTableEntries(markdown)) {
    entries.push(entry)
  }
  return entries
}

export function simpleChoiceAnswer(value: string) {
  return /^[A-D]{1,4}$/i.test(String(value || '').replace(/\s+/g, '').replace(/[;；。,.，、]$/g, ''))
}

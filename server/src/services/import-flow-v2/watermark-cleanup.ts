import type { OCRDocument, OCRPage } from '../../types/ocr-document.js'

export type WatermarkCleanupConfig = {
  enabled: boolean
  terms: string[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function normalizeTerms(value: unknown) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n/)
      : []
  return Array.from(new Set(raw.map((item) => String(item || '').trim()).filter(Boolean))).slice(0, 200)
}

export function watermarkConfigFromMetadata(metadata: Record<string, unknown> | undefined): WatermarkCleanupConfig {
  const watermark = asRecord(metadata?.watermark)
  const terms = normalizeTerms(watermark.terms ?? watermark.dictionary ?? watermark.words)
  return {
    enabled: Boolean(watermark.enabled) && terms.length > 0,
    terms,
  }
}

function stripLineForWatermarkCheck(value: string) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*(?:#{1,6}\s*)?/, '')
    .replace(/^\s*(?:>\s*)?/, '')
    .replace(/\s+/g, '')
}

function removeTerms(value: string, terms: string[]) {
  let next = value
  for (const term of terms) next = next.split(term).join('')
  return next
}

export function cleanWatermarkText(value: string, terms: string[]) {
  const source = String(value || '')
  if (!source || !terms.length) return { text: source, removedCount: 0 }
  let removedCount = 0
  const text = source.split(/(?<=\n)/).map((lineWithNewline) => {
    const newline = lineWithNewline.endsWith('\n') ? '\n' : ''
    const line = newline ? lineWithNewline.slice(0, -1) : lineWithNewline
    const compact = stripLineForWatermarkCheck(line)
    const compactAfterRemoval = removeTerms(compact, terms)
    if (compact && !compactAfterRemoval) {
      removedCount += 1
      return newline
    }

    const next = removeTerms(line, terms)
    if (next !== line) removedCount += 1
    const nextCompact = stripLineForWatermarkCheck(next).replace(/[:：_\-—|·•]/g, '')
    if (compact && !nextCompact) return newline
    return `${next}${newline}`
  }).join('').replace(/\n{3,}/g, '\n\n')
  return { text, removedCount }
}

function cleanPages(pages: OCRPage[], terms: string[]) {
  let removedCount = 0
  const cleaned = pages.map((page) => ({
    ...page,
    blocks: page.blocks.map((block) => {
      const result = cleanWatermarkText(String(block.content || ''), terms)
      removedCount += result.removedCount
      return { ...block, content: result.text.trim() }
    }),
  }))
  return { pages: cleaned, removedCount }
}

export function applyWatermarkCleanup(document: OCRDocument, metadata: Record<string, unknown> | undefined) {
  const config = watermarkConfigFromMetadata(metadata)
  if (!config.enabled) return { document, removedCount: 0, terms: config.terms }

  const markdownResult = cleanWatermarkText(document.markdown, config.terms)
  const pagesResult = cleanPages(document.pages, config.terms)
  const next: OCRDocument = {
    ...document,
    markdown: markdownResult.text,
    pages: pagesResult.pages,
    metadata: {
      ...document.metadata,
      watermarkCleanup: {
        enabled: true,
        termCount: config.terms.length,
        removedCount: markdownResult.removedCount + pagesResult.removedCount,
      },
    },
  }
  return { document: next, removedCount: markdownResult.removedCount + pagesResult.removedCount, terms: config.terms }
}

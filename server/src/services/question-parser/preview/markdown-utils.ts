import type { OCRDocument } from '../../../types/ocr-document.js'
import type { MarkdownRange } from '../solution-matcher.js'
import type { LineOffset, MarkdownPreviewResponse, MarkdownStructureToken } from './types.js'

export const PAGE_MARKER_RE = /<!--\s*(?:GLM|DOC2X)_PAGE:(\d+)\s*-->/g

export function lineOffsetsFor(markdown: string): LineOffset[] {
  const source = String(markdown || '')
  if (!source) return [{ lineNo: 1, start: 0, end: 0 }]
  const lines = source.split(/(?<=\n)/)
  const offsets: LineOffset[] = []
  let cursor = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    offsets.push({ lineNo: index + 1, start: cursor, end: cursor + line.length })
    cursor += line.length
  }
  return offsets
}

export function lineNoForOffset(lines: LineOffset[], offset: number) {
  if (!lines.length) return 1
  const last = lines[lines.length - 1]
  const bounded = Math.max(0, Math.min(offset, last.end))
  const found = lines.find((line) => bounded >= line.start && (bounded < line.end || (line.lineNo === last.lineNo && bounded === line.end)))
  return found?.lineNo || last.lineNo
}

export function tokenFor(
  lines: LineOffset[],
  input: Omit<MarkdownStructureToken, 'lineStart' | 'lineEnd'>,
): MarkdownStructureToken | null {
  const start = Math.max(0, input.start)
  const end = Math.max(start, input.end)
  if (end <= start) return null
  return {
    ...input,
    start,
    end,
    lineStart: lineNoForOffset(lines, start),
    lineEnd: lineNoForOffset(lines, Math.max(start, end - 1)),
  }
}

function markdownPreviewBase(document: OCRDocument): MarkdownPreviewResponse {
  const markdown = String(document.markdown || '')
  const lineOffsets = lineOffsetsFor(markdown)
  const pageMarkers: MarkdownPreviewResponse['pageMarkers'] = []
  for (const match of markdown.matchAll(PAGE_MARKER_RE)) {
    const offset = match.index || 0
    pageMarkers.push({
      pageNo: Number(match[1] || 0),
      offset,
      lineNo: lineNoForOffset(lineOffsets, offset),
    })
  }
  return {
    ocrDocumentId: document.id,
    sourceDocumentId: document.sourceDocumentId,
    provider: document.provider,
    markdown,
    lineOffsets,
    pageMarkers,
  }
}

export function buildMarkdownPreview(document: OCRDocument): MarkdownPreviewResponse {
  return markdownPreviewBase(document)
}

export function cleanPreviewText(value: string, limit = 220) {
  const text = String(value || '')
    .replace(PAGE_MARKER_RE, '')
    .replace(/<table\b[\s\S]*?<\/table>/gi, '[答案表]')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > limit ? `${text.slice(0, limit).trim()}...` : text
}

export function textForRange(markdown: string, range?: MarkdownRange) {
  if (!range) return ''
  return cleanPreviewText(markdown.slice(range.start, range.end))
}

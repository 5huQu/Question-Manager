import type { OCRBlockType, OCRDocument } from '../../types/ocr-document.js'
import {
  asArray,
  asRecord,
  createNormalizedOCRDocument,
  normalizeBBox,
  numberFrom,
  type OCRDocumentNormalizerOptions,
  type NormalizedBlockDraft,
  type NormalizedPageDraft,
  stableNormalizerId,
  stringFrom,
} from './ocr-document.normalizer.js'

function mapDoc2xBlockType(value: string): OCRBlockType {
  const normalized = value.toLowerCase()
  if (normalized.includes('formula') || normalized.includes('equation')) return 'formula'
  if (normalized.includes('figure') || normalized.includes('image')) return 'image'
  if (normalized.includes('table')) return 'table'
  if (normalized.includes('text') || normalized.includes('title') || normalized.includes('paragraph')) return 'text'
  return normalized ? 'text' : 'unknown'
}

function doc2xPages(payload: Record<string, unknown>) {
  const data = asRecord(payload.data)
  const result = asRecord(data.result)
  const nestedPages = asArray(result.pages)
  return nestedPages.length ? nestedPages : asArray(payload.pages)
}

function doc2xPageNo(page: Record<string, unknown>, fallback: number) {
  const explicit = numberFrom(page.page_no ?? page.pageNo, 0)
  if (explicit > 0) return Math.floor(explicit)
  const pageIdx = numberFrom(page.page_idx ?? page.pageIndex, Number.NaN)
  return Number.isFinite(pageIdx) ? Math.max(1, Math.floor(pageIdx) + 1) : fallback
}

function markdownForDoc2xBlock(type: OCRBlockType, content: string, src: string) {
  if (type === 'image' && src) return '<img src="' + src + '">'
  if (type === 'table' && src) return '<img src="' + src + '">'
  return content
}

function normalizeDoc2xBlock(
  rawBlock: unknown,
  pageNo: number,
  blockIndex: number,
  sourceDocumentId: string,
): NormalizedBlockDraft {
  const block = asRecord(rawBlock)
  const rawType = stringFrom(block.type ?? block.label ?? block.category)
  const type = mapDoc2xBlockType(rawType)
  const src = stringFrom(block.src ?? block.image_url ?? block.imageUrl ?? block.url)
  const content = stringFrom(block.text ?? block.content ?? block.markdown ?? block.md ?? block.latex ?? src)
  const bbox = normalizeBBox(block.bbox ?? block.position ?? block.rect)
  const blockId = stringFrom(block.id ?? block.block_id ?? block.uid) || stableNormalizerId('doc2x_block', [
    sourceDocumentId,
    pageNo,
    blockIndex,
    rawType,
    content,
    src,
  ])
  const confidence = numberFrom(block.confidence ?? block.score, Number.NaN)
  const draft: NormalizedBlockDraft = {
    id: blockId,
    type,
    content,
    bbox,
    markdown: markdownForDoc2xBlock(type, content, src),
  }
  if (Number.isFinite(confidence)) draft.confidence = confidence
  if ((type === 'image' || type === 'table') && src) {
    draft.assetPath = src
    draft.assetType = type === 'table' ? 'table_image' : 'image'
  }
  return draft
}

function normalizeDoc2xPage(rawPage: unknown, pageIndex: number, sourceDocumentId: string): NormalizedPageDraft {
  const page = asRecord(rawPage)
  const layout = asRecord(page.layout)
  const pageNo = doc2xPageNo(page, pageIndex + 1)
  const markdown = stringFrom(page.md ?? page.markdown ?? page.content)
  const rawBlocks = asArray(layout.blocks ?? page.blocks)
  const blocks = rawBlocks.length
    ? rawBlocks.map((block, blockIndex) => normalizeDoc2xBlock(block, pageNo, blockIndex, sourceDocumentId))
    : [{
        id: stableNormalizerId('doc2x_page_text', [sourceDocumentId, pageNo, markdown]),
        type: 'text' as const,
        content: markdown,
        markdown,
      }]
  return {
    pageNo,
    width: numberFrom(page.width ?? page.page_width ?? layout.width ?? layout.page_width),
    height: numberFrom(page.height ?? page.page_height ?? layout.height ?? layout.page_height),
    markdown,
    blocks,
  }
}

export function normalizeDoc2xOCRDocument(payload: unknown, options: OCRDocumentNormalizerOptions): OCRDocument {
  const root = asRecord(payload)
  const pages = doc2xPages(root).map((page, pageIndex) => normalizeDoc2xPage(page, pageIndex, options.sourceDocumentId))
  const data = asRecord(root.data)
  const result = asRecord(data.result)
  return createNormalizedOCRDocument('doc2x', options, pages, {
    source: 'doc2x_json',
    code: root.code ?? '',
    taskId: stringFrom(root.task_id ?? root.taskId ?? result.task_id ?? result.taskId),
  })
}

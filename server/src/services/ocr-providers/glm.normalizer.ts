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

function mapGlmBlockType(label: string): OCRBlockType {
  const normalized = label.toLowerCase()
  if (normalized.includes('formula') || normalized.includes('equation')) return 'formula'
  if (normalized.includes('image') || normalized.includes('figure')) return 'image'
  if (normalized.includes('table')) return 'table'
  if (normalized.includes('text') || normalized.includes('title') || normalized.includes('paragraph')) return 'text'
  return normalized ? 'text' : 'unknown'
}

function pageSizeFromInfo(info: Record<string, unknown>, fallback: Record<string, unknown>) {
  return {
    width: numberFrom(info.width ?? info.page_width ?? fallback.width ?? fallback.page_width),
    height: numberFrom(info.height ?? info.page_height ?? fallback.height ?? fallback.page_height),
  }
}

function markdownForGlmBlock(type: OCRBlockType, content: string) {
  if (!content) return ''
  if (type === 'image') return '<img src="' + content + '">'
  return content
}

function normalizeGlmBlock(
  rawBlock: unknown,
  pageNo: number,
  blockIndex: number,
  sourceDocumentId: string,
): NormalizedBlockDraft {
  const block = asRecord(rawBlock)
  const label = stringFrom(block.label || block.type || block.native_label)
  const type = mapGlmBlockType(label)
  const content = stringFrom(block.content ?? block.text ?? block.value ?? block.markdown)
  const bbox = normalizeBBox(block.bbox_2d ?? block.bbox ?? block.position)
  const blockId = stringFrom(block.id || block.block_id || block.index) || stableNormalizerId('glm_block', [
    sourceDocumentId,
    pageNo,
    blockIndex,
    label,
    content,
  ])
  const confidence = numberFrom(block.confidence, Number.NaN)
  const draft: NormalizedBlockDraft = {
    id: blockId,
    type,
    content,
    bbox,
    markdown: markdownForGlmBlock(type, content),
  }
  if (Number.isFinite(confidence)) draft.confidence = confidence
  if (type === 'image' && content) {
    draft.assetPath = content
    draft.assetType = 'image'
  }
  if (type === 'table' && content && /^https?:\/\//i.test(content)) {
    draft.assetPath = content
    draft.assetType = 'table_image'
  }
  return draft
}

function normalizeGlmPages(payload: Record<string, unknown>, sourceDocumentId: string): NormalizedPageDraft[] {
  const layoutPages = asArray(payload.layout_details ?? payload.pages)
  const dataInfo = asRecord(payload.data_info)
  const pageInfos = asArray(dataInfo.pages)

  return layoutPages.map((rawPage, pageIndex) => {
    const pageBlocks = asArray(rawPage)
    const pageRecord = asRecord(rawPage)
    const pageInfo = asRecord(pageInfos[pageIndex])
    const pageNo = Math.max(1, Math.floor(numberFrom(pageInfo.page_no ?? pageInfo.pageNo ?? pageRecord.page_no ?? pageRecord.pageNo, pageIndex + 1)))
    const size = pageSizeFromInfo(pageInfo, pageRecord)
    const blocks = pageBlocks.map((block, blockIndex) => normalizeGlmBlock(block, pageNo, blockIndex, sourceDocumentId))
    return {
      pageNo,
      width: size.width,
      height: size.height,
      blocks,
    }
  })
}

export function normalizeGlmOCRDocument(payload: unknown, options: OCRDocumentNormalizerOptions): OCRDocument {
  const root = asRecord(payload)
  const pages = normalizeGlmPages(root, options.sourceDocumentId)
  return createNormalizedOCRDocument('glm', options, pages, {
    source: 'glm_layout_parsing',
    model: stringFrom(root.model),
    requestId: stringFrom(root.request_id ?? root.requestId ?? root.id),
    rawStatus: root.status ?? root.code ?? '',
  })
}

import { createHash } from 'node:crypto'
import type {
  OCRAsset,
  OCRAssetType,
  OCRBBox,
  OCRBlock,
  OCRBlockType,
  OCRDocument,
  OCRDocumentProvider,
  OCRPage,
} from '../../types/ocr-document.js'
import { createId, nowIso } from '../../utils/ids.js'

export type OCRDocumentNormalizerOptions = {
  id?: string
  sourceDocumentId: string
  rawResultPath: string
  createdAt?: string
  metadata?: Record<string, unknown>
}

export type NormalizedBlockDraft = {
  id?: string
  type?: OCRBlockType
  content?: string
  bbox?: OCRBBox
  markdown?: string
  assetId?: string
  assetPath?: string
  assetType?: OCRAssetType
  confidence?: number
}

export type NormalizedPageDraft = {
  pageNo: number
  width?: number
  height?: number
  markdown?: string
  blocks: NormalizedBlockDraft[]
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function stringFrom(value: unknown, fallback = '') {
  return value === undefined || value === null ? fallback : String(value)
}

export function numberFrom(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

export function normalizeBBox(value: unknown): OCRBBox | undefined {
  if (Array.isArray(value) && value.length >= 4) {
    const values = value.slice(0, 4).map((item) => Number(item))
    if (values.every(Number.isFinite)) return values as OCRBBox
  }

  const record = asRecord(value)
  const x = Number(record.x)
  const y = Number(record.y)
  const width = Number(record.width)
  const height = Number(record.height)
  if ([x, y, width, height].every(Number.isFinite)) {
    return [x, y, x + width, y + height]
  }

  const left = Number(record.left ?? record.x0)
  const top = Number(record.top ?? record.y0)
  const right = Number(record.right ?? record.x1)
  const bottom = Number(record.bottom ?? record.y1)
  if ([left, top, right, bottom].every(Number.isFinite)) {
    return [left, top, right, bottom]
  }

  return undefined
}

export function stableNormalizerId(prefix: string, parts: unknown[]) {
  const digest = createHash('sha1')
    .update(parts.map((part) => stringFrom(part)).join('|'))
    .digest('hex')
    .slice(0, 12)
  return prefix + '_' + digest
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function markdownForBlock(block: NormalizedBlockDraft) {
  if (block.markdown !== undefined) return block.markdown
  const content = stringFrom(block.content).trim()
  if (!content) return ''
  if (block.type === 'image') return '<img src="' + escapeHtmlAttribute(content) + '">'
  return content
}

function normalizePageNo(value: number, fallback: number) {
  const pageNo = Math.floor(Number(value))
  return Number.isFinite(pageNo) && pageNo > 0 ? pageNo : fallback
}

export function createNormalizedOCRDocument(
  provider: OCRDocumentProvider,
  options: OCRDocumentNormalizerOptions,
  pageDrafts: NormalizedPageDraft[],
  providerMetadata: Record<string, unknown> = {},
): OCRDocument {
  const pages: OCRPage[] = []
  const assets: OCRAsset[] = []
  let markdown = ''

  for (let pageIndex = 0; pageIndex < pageDrafts.length; pageIndex += 1) {
    const draft = pageDrafts[pageIndex]
    const pageNo = normalizePageNo(draft.pageNo, pageIndex + 1)
    if (markdown) markdown += '\n\n'
    markdown += '<!-- ' + provider.toUpperCase() + '_PAGE:' + pageNo + ' -->\n'

    const pageMarkdown = draft.markdown !== undefined
      ? stringFrom(draft.markdown).trim()
      : draft.blocks.map(markdownForBlock).filter(Boolean).join('\n\n')
    const pageContentStart = markdown.length
    markdown += pageMarkdown

    const blocks: OCRBlock[] = []
    let searchCursor = 0
    for (let blockIndex = 0; blockIndex < draft.blocks.length; blockIndex += 1) {
      const blockDraft = draft.blocks[blockIndex]
      const type = blockDraft.type || 'unknown'
      const content = stringFrom(blockDraft.content)
      const blockMarkdown = markdownForBlock(blockDraft)
      let markdownStart: number | undefined
      let markdownEnd: number | undefined
      if (blockMarkdown) {
        const localStart = pageMarkdown.indexOf(blockMarkdown, searchCursor)
        if (localStart >= 0) {
          markdownStart = pageContentStart + localStart
          markdownEnd = markdownStart + blockMarkdown.length
          searchCursor = localStart + blockMarkdown.length
        }
      }

      const blockId = blockDraft.id || stableNormalizerId(provider + '_block', [
        options.sourceDocumentId,
        pageNo,
        blockIndex,
        type,
        content,
      ])
      const block: OCRBlock = {
        id: blockId,
        pageNo,
        type,
        content,
      }
      if (blockDraft.bbox) block.bbox = blockDraft.bbox
      if (markdownStart !== undefined) block.markdownStart = markdownStart
      if (markdownEnd !== undefined) block.markdownEnd = markdownEnd
      if (blockDraft.confidence !== undefined) block.confidence = blockDraft.confidence

      const assetPath = stringFrom(blockDraft.assetPath)
      if (assetPath) {
        const assetId = blockDraft.assetId || stableNormalizerId(provider + '_asset', [
          options.sourceDocumentId,
          pageNo,
          blockId,
          assetPath,
        ])
        block.assetId = assetId
        assets.push({
          id: assetId,
          type: blockDraft.assetType || (type === 'table' ? 'table_image' : 'image'),
          path: assetPath,
          pageNo,
          bbox: blockDraft.bbox,
          sourceBlockId: blockId,
        })
      }

      blocks.push(block)
    }

    pages.push({
      pageNo,
      width: Math.max(0, numberFrom(draft.width)),
      height: Math.max(0, numberFrom(draft.height)),
      blocks,
    })
  }

  return {
    id: options.id || createId('ocrdoc', options.sourceDocumentId),
    sourceDocumentId: options.sourceDocumentId,
    provider,
    rawResultPath: options.rawResultPath,
    markdown,
    pages,
    assets,
    metadata: {
      ...(options.metadata || {}),
      ...providerMetadata,
      provider,
      pageCount: pages.length,
    },
    createdAt: options.createdAt || nowIso(),
  }
}

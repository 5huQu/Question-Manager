import type { OCRBBox, OCRBlock, OCRDocument } from '../../types/ocr-document.js'
import type { CandidateFigure, CandidateFigureUsage, CandidateSourceRef, CandidateSourceRefKind } from '../../types/question-candidate.js'
import type { MarkdownRange } from './solution-matcher.js'

function rangesOverlap(left?: MarkdownRange, right?: MarkdownRange) {
  if (!left || !right) return false
  return left.start < right.end && right.start < left.end
}

function blockRange(block: OCRBlock): MarkdownRange | undefined {
  if (block.markdownStart === undefined || block.markdownEnd === undefined) return undefined
  return { start: block.markdownStart, end: block.markdownEnd }
}

function unionBBox(boxes: OCRBBox[]): OCRBBox | undefined {
  if (!boxes.length) return undefined
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ]
}

function blockAsset(document: OCRDocument, block: OCRBlock) {
  return block.assetId ? document.assets.find((item) => item.id === block.assetId) : undefined
}

function blockBBox(document: OCRDocument, block: OCRBlock) {
  return blockAsset(document, block)?.bbox || block.bbox
}

function normalizedBox(document: OCRDocument, pageNo: number | undefined, bbox: OCRBBox | undefined) {
  if (!pageNo || !bbox) return null
  const page = document.pages.find((item) => item.pageNo === pageNo)
  if (!page || page.width <= 0 || page.height <= 0) return null
  const width = (bbox[2] - bbox[0]) / page.width
  const height = (bbox[3] - bbox[1]) / page.height
  if (width <= 0 || height <= 0) return null
  return {
    left: bbox[0] / page.width,
    top: bbox[1] / page.height,
    right: bbox[2] / page.width,
    bottom: bbox[3] / page.height,
    width,
    height,
  }
}

function isInHeaderFooterBand(box: NonNullable<ReturnType<typeof normalizedBox>>) {
  const inTopBand = box.top < 0.12 && box.bottom <= 0.13 && box.height <= 0.06
  const inBottomBand = (box.top >= 0.9 || box.bottom >= 0.97) && box.height <= 0.08
  return inTopBand || inBottomBand
}

function repeatedPageChromeCount(document: OCRDocument, block: OCRBlock) {
  const target = normalizedBox(document, block.pageNo, blockBBox(document, block))
  if (!target || !isInHeaderFooterBand(target)) return 0
  const blocks = document.pages.flatMap((page) => page.blocks)
  return blocks.filter((item) => {
    if (item === block) return true
    if (item.type !== 'image' && item.type !== 'table' && !item.assetId) return false
    const box = normalizedBox(document, item.pageNo, blockBBox(document, item))
    if (!box || !isInHeaderFooterBand(box)) return false
    return Math.abs(box.top - target.top) <= 0.015
      && Math.abs(box.height - target.height) <= 0.02
      && Math.abs(box.left - target.left) <= 0.035
      && Math.abs(box.width - target.width) <= 0.08
  }).length
}

export function isLikelyPageChromeBlock(document: OCRDocument, block: OCRBlock) {
  if (block.type !== 'image' && block.type !== 'table' && !block.assetId) return false
  const box = normalizedBox(document, block.pageNo, blockBBox(document, block))
  if (!box || !isInHeaderFooterBand(box)) return false
  const asset = blockAsset(document, block)
  const visibleWatermarkText = `${block.content || ''}\n${asset?.path || ''}`
  if (/学科网|组卷网|zxxk|zujuan/i.test(visibleWatermarkText)) return true
  return repeatedPageChromeCount(document, block) >= 2
}

export function isLikelyPageChromeFigureId(document: OCRDocument, figureId: string) {
  const block = document.pages.flatMap((page) => page.blocks).find((item) => item.id === figureId || item.assetId === figureId)
  if (block) return isLikelyPageChromeBlock(document, block)
  const asset = document.assets.find((item) => item.id === figureId)
  if (!asset) return false
  const box = normalizedBox(document, asset.pageNo, asset.bbox)
  if (!box || !isInHeaderFooterBand(box)) return false
  return document.assets.filter((item) => {
    const candidate = normalizedBox(document, item.pageNo, item.bbox)
    if (!candidate || !isInHeaderFooterBand(candidate)) return false
    return Math.abs(candidate.top - box.top) <= 0.015
      && Math.abs(candidate.height - box.height) <= 0.02
      && Math.abs(candidate.left - box.left) <= 0.035
      && Math.abs(candidate.width - box.width) <= 0.08
  }).length >= 2
}

function blocksInRange(document: OCRDocument, range?: MarkdownRange) {
  if (!range) return []
  return document.pages
    .flatMap((page) => page.blocks)
    .filter((block) => rangesOverlap(blockRange(block), range))
}

export function figureForBlock(document: OCRDocument, block: OCRBlock, usage: CandidateFigureUsage = 'unknown'): CandidateFigure | undefined {
  const asset = blockAsset(document, block)
  const path = asset?.path || block.content || ''
  if (!path) return undefined
  return {
    id: asset?.id || block.assetId || block.id,
    usage,
    path,
    sourceDocumentId: document.sourceDocumentId,
    sourceBlockId: block.id,
    pageNo: block.pageNo,
    bbox: asset?.bbox || block.bbox,
    inlineMarker: block.markdownStart !== undefined ? String(block.markdownStart) : undefined,
  }
}

export function sourceRefsForRange(document: OCRDocument, range: MarkdownRange | undefined, kind: CandidateSourceRefKind): CandidateSourceRef[] {
  const blocks = blocksInRange(document, range).filter((block) => !isLikelyPageChromeBlock(document, block))
  const byPage = new Map<number, OCRBlock[]>()
  for (const block of blocks) {
    byPage.set(block.pageNo, [...(byPage.get(block.pageNo) || []), block])
  }
  return Array.from(byPage.entries()).map(([pageNo, pageBlocks]) => ({
    sourceDocumentId: document.sourceDocumentId,
    pageNo,
    blockIds: pageBlocks.map((block) => block.id),
    bbox: unionBBox(pageBlocks.map((block) => block.bbox).filter(Boolean) as OCRBBox[]),
    kind,
  }))
}

export function figuresForRange(document: OCRDocument, range: MarkdownRange | undefined, usage: CandidateFigureUsage): CandidateFigure[] {
  return blocksInRange(document, range)
    .filter((block) => block.assetId || block.type === 'image' || block.type === 'table')
    .filter((block) => !isLikelyPageChromeBlock(document, block))
    .flatMap((block) => figureForBlock(document, block, usage) || [])
}

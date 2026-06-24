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

function blocksInRange(document: OCRDocument, range?: MarkdownRange) {
  if (!range) return []
  return document.pages
    .flatMap((page) => page.blocks)
    .filter((block) => rangesOverlap(blockRange(block), range))
}

export function figureForBlock(document: OCRDocument, block: OCRBlock, usage: CandidateFigureUsage = 'unknown'): CandidateFigure | undefined {
  const asset = block.assetId ? document.assets.find((item) => item.id === block.assetId) : undefined
  const path = asset?.path || block.content || ''
  if (!path) return undefined
  return {
    id: asset?.id || block.assetId || block.id,
    usage,
    path,
    sourceBlockId: block.id,
    pageNo: block.pageNo,
    bbox: asset?.bbox || block.bbox,
    inlineMarker: block.markdownStart !== undefined ? String(block.markdownStart) : undefined,
  }
}

export function sourceRefsForRange(document: OCRDocument, range: MarkdownRange | undefined, kind: CandidateSourceRefKind): CandidateSourceRef[] {
  const blocks = blocksInRange(document, range)
  const byPage = new Map<number, OCRBlock[]>()
  for (const block of blocks) {
    byPage.set(block.pageNo, [...(byPage.get(block.pageNo) || []), block])
  }
  return Array.from(byPage.entries()).map(([pageNo, pageBlocks]) => ({
    pageNo,
    blockIds: pageBlocks.map((block) => block.id),
    bbox: unionBBox(pageBlocks.map((block) => block.bbox).filter(Boolean) as OCRBBox[]),
    kind,
  }))
}

export function figuresForRange(document: OCRDocument, range: MarkdownRange | undefined, usage: CandidateFigureUsage): CandidateFigure[] {
  return blocksInRange(document, range)
    .filter((block) => block.assetId || block.type === 'image' || block.type === 'table')
    .flatMap((block) => figureForBlock(document, block, usage) || [])
}

import type { OCRDocument } from '../../types/ocr-document.js'
import type { CandidateFigure, CandidateSourceRef, QuestionCandidate } from '../../types/question-candidate.js'
import type { ImportFlowV2ParserConfig } from './default-parser-config.js'
import type { QuestionMarkdownChunk } from './markdown-question-splitter.js'
import { createId } from '../../utils/ids.js'
import { normalizeHtmlImageTags } from '../ocr-providers/ocr-document.normalizer.js'
import { figureForBlock, figuresForRange, isLikelyPageChromeBlock, sourceRefsForRange } from './figure-linker.js'
import { statusForIssues } from './candidate-validator.js'
import { dedupeFigures } from './chunk-processing.js'

export function figuresForMarkdown(markdown: string, usage: CandidateFigure['usage'], sourceDocumentId = ''): CandidateFigure[] {
  const figures: CandidateFigure[] = []
  const pattern = /!\[[^\]]*]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))\s*\)/g
  for (const match of normalizeHtmlImageTags(markdown).matchAll(pattern)) {
    const path = String(match[1] || match[2] || '').replace(/\\\)/g, ')').trim()
    if (!path) continue
    figures.push({
      id: `inline_${usage}_${createId('image', path)}`,
      usage,
      path,
      sourceDocumentId: sourceDocumentId || undefined,
      inlineMarker: String(match.index ?? path),
    })
  }
  return figures
}

export function dedupeSourceRefs(refs: CandidateSourceRef[]) {
  const grouped = new Map<string, CandidateSourceRef>()
  for (const ref of refs) {
    const key = `${ref.sourceDocumentId || ''}:${ref.kind}:${ref.pageNo}`
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, ref)
      continue
    }
    grouped.set(key, {
      ...existing,
      blockIds: Array.from(new Set([...existing.blockIds, ...ref.blockIds])),
      bbox: existing.bbox || ref.bbox,
    })
  }
  return Array.from(grouped.values())
}

function figureBelongsToRef(block: OCRDocument['pages'][number]['blocks'][number], ref: CandidateSourceRef) {
  if (block.pageNo !== ref.pageNo) return false
  if (!block.bbox || !ref.bbox) return false
  const centerY = (block.bbox[1] + block.bbox[3]) / 2
  return centerY >= ref.bbox[1] && centerY <= ref.bbox[3]
}

function bboxSize(bbox?: [number, number, number, number]) {
  if (!bbox) return { width: 0, height: 0, area: 0 }
  const width = Math.max(0, bbox[2] - bbox[0])
  const height = Math.max(0, bbox[3] - bbox[1])
  return { width, height, area: width * height }
}

function isLikelyStandaloneFigureBlock(document: OCRDocument, block: OCRDocument['pages'][number]['blocks'][number]) {
  if (isLikelyPageChromeBlock(document, block)) return false
  if (block.type === 'image' && !block.assetId) return true
  if (!block.assetId) return false
  const asset = document.assets.find((item) => item.id === block.assetId)
  if (asset?.type === 'table_image' || block.type === 'table') return true
  const box = bboxSize(asset?.bbox || block.bbox)
  const page = document.pages.find((item) => item.pageNo === block.pageNo)
  const pageHeight = page?.height || 0
  const top = (asset?.bbox || block.bbox)?.[1] || 0
  const bottom = (asset?.bbox || block.bbox)?.[3] || 0
  const content = `${block.content || ''}\n${asset?.path || ''}`
  if (/学科网|组卷网|zxxk|zujuan/i.test(content)) return false
  if (pageHeight > 0 && (top < pageHeight * 0.08 || bottom > pageHeight * 0.94) && box.height < 160) return false
  if (!box.area) return block.type === 'image'
  if (box.height < 96) return false
  if (box.width / Math.max(box.height, 1) > 8) return false
  return block.type === 'image' || box.area >= 80_000
}

export function attachImageBlocks(document: OCRDocument, chunks: QuestionMarkdownChunk[], candidates: QuestionCandidate[], config: ImportFlowV2ParserConfig) {
  const imageBlocks = document.pages.flatMap((page) => page.blocks)
    .filter((block) => block.type === 'image' || block.assetId)
  const attached = new Set(candidates.flatMap((candidate) => candidate.figures.map((figure) => figure.sourceBlockId).filter(Boolean)))
  const unplaced: Array<{ blockId: string; figure?: CandidateFigure }> = []
  for (const block of imageBlocks) {
    if (!isLikelyStandaloneFigureBlock(document, block)) continue
    if (attached.has(block.id)) continue
    let index = candidates.findIndex((candidate) => candidate.sourceRefs.some((ref) => figureBelongsToRef(block, ref)))
    if (index < 0 && block.markdownStart !== undefined) {
      index = chunks.findIndex((chunk) => block.markdownStart! >= chunk.start && block.markdownStart! < chunk.end)
    }
    if (index < 0 && block.bbox) {
      const samePage = candidates.map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .filter(({ candidate }) => candidate.sourceRefs.some((ref) => ref.pageNo === block.pageNo && ref.bbox))
        .map(({ candidate, candidateIndex }) => ({
          candidateIndex,
          bottom: Math.max(...candidate.sourceRefs.filter((ref) => ref.pageNo === block.pageNo && ref.bbox).map((ref) => ref.bbox![3])),
        }))
        .filter((item) => item.bottom <= block.bbox![1])
      if (samePage.length) index = samePage.sort((left, right) => right.bottom - left.bottom)[0].candidateIndex
    }
    if (index < 0) {
      const likelyFigureCandidates = candidates.map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .filter(({ candidate }) => candidate.sourceRefs.some((ref) => ref.pageNo === block.pageNo))
        .filter(({ candidate }) => config.figureKeywords.some((keyword) => candidate.stemMarkdown.includes(keyword)))
      if (likelyFigureCandidates.length) index = likelyFigureCandidates[likelyFigureCandidates.length - 1].candidateIndex
    }
    if (index < 0) {
      const relatedFigure = figureForBlock(document, block, 'unknown')
      unplaced.push({ blockId: block.id, figure: relatedFigure || undefined })
      continue
    }
    const figure = figureForBlock(document, block, 'stem')
    if (!figure) continue
    candidates[index].figures = dedupeFigures([...candidates[index].figures, figure])
    candidates[index].sourceRefs = dedupeSourceRefs([...candidates[index].sourceRefs, {
      sourceDocumentId: document.sourceDocumentId,
      pageNo: block.pageNo,
      blockIds: [block.id],
      bbox: block.bbox,
      kind: 'figure',
    }])
    attached.add(block.id)
  }

  if (!unplaced.length || !candidates.length) return
  const fallback = candidates[candidates.length - 1]
  const figures = unplaced.flatMap((item) => item.figure ? [item.figure] : [])
  const pages = figures.map((figure) => figure.pageNo).filter((pageNo): pageNo is number => pageNo !== undefined)
  const firstPage = pages.length ? Math.min(...pages) : undefined
  const lastPage = pages.length ? Math.max(...pages) : undefined
  const pageSpan = firstPage !== undefined && lastPage !== undefined ? lastPage - firstPage : 0
  const unsafeOverflow = unplaced.length > 5 || pageSpan > 2
  const pageLabel = firstPage === undefined
    ? ''
    : firstPage === lastPage
      ? `，位于第 ${firstPage} 页`
      : `，跨第 ${firstPage}-${lastPage} 页`
  fallback.issues.push({
    code: 'unplaced_figure',
    severity: unsafeOverflow ? 'error' : 'warning',
    message: unsafeOverflow
      ? `文档级图片归属异常：有 ${unplaced.length} 张图片${pageLabel}未能可靠归属。解析结果已阻止直接入库，请先核对题目边界。`
      : unplaced.length === 1
        ? `有一张图片（${unplaced[0].blockId}）未能可靠归属到题目，请核对。`
        : `有 ${unplaced.length} 张图片${pageLabel}未能可靠归属到题目，请核对。`,
    relatedBlockIds: unplaced.map((item) => item.blockId),
    relatedFigures: figures,
  })
  fallback.status = statusForIssues(fallback.issues)
}

type OCRBlock = OCRDocument['pages'][number]['blocks'][number]

function unionBBox(boxes: NonNullable<OCRBlock['bbox']>[]) {
  if (!boxes.length) return undefined
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ] as NonNullable<OCRBlock['bbox']>
}

function figureIdsForBlock(block: OCRBlock) {
  return new Set([block.id, block.assetId].filter(Boolean).map(String))
}

function figureMatchesBlock(figure: CandidateFigure, block: OCRBlock) {
  if (block.assetId && (figure.id === block.assetId || figure.blockId === block.assetId)) return true
  if (figure.pageNo !== undefined && figure.pageNo !== block.pageNo) return false
  const ids = figureIdsForBlock(block)
  return [figure.blockId, figure.sourceBlockId].filter(Boolean).some((id) => ids.has(String(id)))
}

function removeFigureMarker(markdown: string, figureId: string) {
  const escaped = figureId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return String(markdown || '')
    .replace(new RegExp(`\\n?\\s*<!--\\s*DOC2X_FIGURE:${escaped}\\s*-->\\s*\\n?`, 'g'), '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function appendFigureMarker(markdown: string, figureId: string) {
  const escaped = figureId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`<!--\\s*DOC2X_FIGURE:${escaped}\\s*-->`).test(markdown)) return markdown
  return `${String(markdown || '').trim()}\n\n<!-- DOC2X_FIGURE:${figureId} -->`.trim()
}

function candidatePageTop(document: OCRDocument, candidate: QuestionCandidate, pageNo: number) {
  const refs = candidate.sourceRefs.filter((ref) => ref.pageNo === pageNo && ref.bbox)
  if (!refs.length) return undefined
  const stemRefs = refs.filter((ref) => ref.kind === 'stem')
  const selected = stemRefs.length ? stemRefs : refs
  const blocksById = new Map((document.pages.find((page) => page.pageNo === pageNo)?.blocks || []).map((block) => [block.id, block]))
  const textBoxes = selected.flatMap((ref) => ref.blockIds
    .map((id) => blocksById.get(id))
    .filter((block): block is OCRBlock => Boolean(block && block.bbox && block.type !== 'image' && !block.assetId))
    .map((block) => block.bbox!))
  return Math.min(...(textBoxes.length ? textBoxes : selected.map((ref) => ref.bbox!)).map((bbox) => bbox[1]))
}

function candidateIndexForFigure(document: OCRDocument, candidates: QuestionCandidate[], block: OCRBlock) {
  if (!block.bbox) return -1
  const samePage = candidates
    .map((candidate, candidateIndex) => ({ candidate, candidateIndex, top: candidatePageTop(document, candidate, block.pageNo) }))
    .filter((item): item is { candidate: QuestionCandidate; candidateIndex: number; top: number } => item.top !== undefined)
  if (!samePage.length) return -1
  const preceding = samePage.filter((item) => item.top <= block.bbox![1])
  if (preceding.length) return preceding.sort((left, right) => right.top - left.top)[0].candidateIndex
  return samePage.sort((left, right) => left.top - right.top)[0].candidateIndex
}

function removeFigureFromSourceRefs(document: OCRDocument, candidate: QuestionCandidate, block: OCRBlock) {
  candidate.sourceRefs = dedupeSourceRefs(candidate.sourceRefs.flatMap((ref) => {
    const blockIds = ref.blockIds.filter((id) => id !== block.id)
    if (!blockIds.length) return []
    const bbox = unionBBox((document.pages.find((page) => page.pageNo === ref.pageNo)?.blocks || [])
      .filter((item) => blockIds.includes(item.id))
      .map((item) => item.bbox)
      .filter(Boolean) as NonNullable<OCRBlock['bbox']>[])
    return [{ ...ref, blockIds, bbox }]
  }))
}

/**
 * Corrects provider reading-order mistakes for standalone figures. Some OCR
 * providers emit a figure marker after the next text block even though the
 * figure is visually beside the preceding question. Assign by the nearest
 * same-page question top boundary and move the marker/figure together.
 */
export function reassignStandaloneFigureBlocks(document: OCRDocument, candidates: QuestionCandidate[]) {
  const figureBlocks = document.pages.flatMap((page) => page.blocks)
    .filter((block) => (block.type === 'image' || block.assetId) && !isLikelyPageChromeBlock(document, block))
  for (const block of figureBlocks) {
    const targetIndex = candidateIndexForFigure(document, candidates, block)
    if (targetIndex < 0) continue
    const currentOwners = candidates
      .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
      .filter(({ candidate }) => candidate.figures.some((figure) => figureMatchesBlock(figure, block)))
    const targetAlreadyOwns = currentOwners.some(({ candidateIndex }) => candidateIndex === targetIndex)
    if (targetAlreadyOwns && currentOwners.length === 1) continue

    const figure = figureForBlock(document, block, 'stem')
    if (!figure) continue
    for (const { candidate } of currentOwners) {
      candidate.figures = candidate.figures.filter((item) => !figureMatchesBlock(item, block))
      removeFigureFromSourceRefs(document, candidate, block)
      const figureId = figure.id
      candidate.stemMarkdown = removeFigureMarker(candidate.stemMarkdown, figureId)
      candidate.answerText = removeFigureMarker(candidate.answerText, figureId)
      candidate.analysisMarkdown = removeFigureMarker(candidate.analysisMarkdown, figureId)
    }
    const target = candidates[targetIndex]
    target.figures = dedupeFigures([...target.figures, figure])
    target.sourceRefs = dedupeSourceRefs([...target.sourceRefs, {
      sourceDocumentId: document.sourceDocumentId,
      pageNo: block.pageNo,
      blockIds: [block.id],
      bbox: block.bbox,
      kind: 'figure',
    }])
    target.stemMarkdown = appendFigureMarker(target.stemMarkdown, figure.id)
  }
}

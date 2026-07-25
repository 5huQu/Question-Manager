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
      const fallback = candidates[candidates.length - 1]
      const relatedFigure = figureForBlock(document, block, 'unknown')
      fallback.issues.push({
        code: 'unplaced_figure',
        severity: 'warning',
        message: `有一张图片（${block.id}）未能可靠归属到题目，请核对。`,
        relatedBlockIds: [block.id],
        relatedFigures: relatedFigure ? [relatedFigure] : [],
      })
      fallback.status = statusForIssues(fallback.issues)
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
}

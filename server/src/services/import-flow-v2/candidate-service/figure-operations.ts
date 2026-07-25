import type { OCRBBox, OCRDocument } from '../../../types/ocr-document.js'
import type { CandidateFigure, CandidateFigureUsage, CandidateSourceRef, QuestionCandidate } from '../../../types/question-candidate.js'
import { RouteError } from '../../../utils/http-error.js'

export function escapedPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function figureIdentifiers(figure: CandidateFigure, block?: OCRDocument['pages'][number]['blocks'][number]) {
  return Array.from(new Set([
    figure.id,
    figure.blockId,
    figure.sourceBlockId,
    block?.id,
    block?.assetId,
  ].filter(Boolean).map(String)))
}

export function sameFigure(left: CandidateFigure, identifiers: string[]) {
  return [left.id, left.blockId, left.sourceBlockId].filter(Boolean).some((value) => identifiers.includes(String(value)))
}

export function removeFigureMarkup(value: string, identifiers: string[], path: string) {
  let next = String(value || '')
  for (const identifier of identifiers) {
    const markerPattern = new RegExp(`<!--\\s*DOC2X_FIGURE:${escapedPattern(identifier)}\\s*-->`, 'gi')
    let match = markerPattern.exec(next)
    while (match) {
      let removeStart = match.index
      const before = next.slice(0, match.index)
      const commentStart = before.lastIndexOf('<!--')
      if (commentStart >= 0 && /^<!--\s*figureText\s*:[\s\S]*?-->\s*$/i.test(before.slice(commentStart))) {
        removeStart = commentStart
      }
      next = `${next.slice(0, removeStart)}\n${next.slice(match.index + match[0].length)}`
      markerPattern.lastIndex = 0
      match = markerPattern.exec(next)
    }
  }
  if (path) {
    next = next.replace(/!\[[^\]]*]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))\s*\)/g, (marker, anglePath, plainPath) => {
      const markerPath = String(anglePath || plainPath || '').replace(/\\\)/g, ')').trim()
      return markerPath === path ? '' : marker
    })
  }
  return next.replace(/\n{3,}/g, '\n\n').trim()
}

export function insertFigureMarker(value: string, markerId: string, usage: CandidateFigureUsage, optionLabel?: string) {
  const source = String(value || '').trim()
  const marker = `<!-- DOC2X_FIGURE:${markerId} -->`
  if (usage === 'analysis') return source ? `${source}\n\n${marker}` : marker

  const optionPattern = /^\s*([A-DＡ-Ｄ])\s*[.．、:：]\s*/gm
  const matches = Array.from(source.matchAll(optionPattern))
  if (usage === 'options' && optionLabel) {
    const normalizedLabel = optionLabel.toUpperCase()
    const optionIndex = matches.findIndex((match) => String(match[1] || '').toUpperCase() === normalizedLabel)
    if (optionIndex >= 0) {
      const insertAt = matches[optionIndex + 1]?.index ?? source.length
      return `${source.slice(0, insertAt).trimEnd()}\n\n${marker}\n\n${source.slice(insertAt).trimStart()}`.trim()
    }
  }
  const firstOptionAt = matches[0]?.index
  if (firstOptionAt !== undefined) {
    return `${source.slice(0, firstOptionAt).trimEnd()}\n\n${marker}\n\n${source.slice(firstOptionAt).trimStart()}`.trim()
  }
  return source ? `${source}\n\n${marker}` : marker
}

export function unionBBoxes(boxes: OCRBBox[]) {
  if (!boxes.length) return undefined
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ] as OCRBBox
}

export function sourceRefsWithoutFigure(refs: CandidateSourceRef[], identifiers: string[], document?: OCRDocument) {
  const blockById = new Map((document?.pages.flatMap((page) => page.blocks) || []).map((block) => [block.id, block]))
  return refs.flatMap((ref) => {
    const blockIds = ref.blockIds.filter((blockId) => !identifiers.includes(blockId))
    if (blockIds.length === ref.blockIds.length) return [ref]
    if (!blockIds.length) return []
    const boxes = blockIds.map((blockId) => blockById.get(blockId)?.bbox).filter(Boolean) as OCRBBox[]
    return [{ ...ref, blockIds, bbox: boxes.length === blockIds.length ? unionBBoxes(boxes) : ref.bbox }]
  })
}

export function sourceRefsWithFigure(refs: CandidateSourceRef[], figure: CandidateFigure, blockId: string) {
  const matchingRef = refs.find((ref) =>
    ref.kind === 'figure'
    && ref.sourceDocumentId === figure.sourceDocumentId
    && ref.pageNo === figure.pageNo,
  )
  if (!matchingRef) {
    return [...refs, {
      sourceDocumentId: figure.sourceDocumentId,
      pageNo: figure.pageNo || 1,
      blockIds: [blockId],
      bbox: figure.bbox,
      kind: 'figure' as const,
    }]
  }
  return refs.map((ref) => ref === matchingRef ? {
    ...ref,
    blockIds: Array.from(new Set([...ref.blockIds, blockId])),
    bbox: ref.bbox || figure.bbox,
  } : ref)
}

export function assertContentRevision(candidate: QuestionCandidate, expected: unknown) {
  if (expected === undefined) return
  if (Number(expected) === Number(candidate.contentRevision || 1)) return
  throw new RouteError(409, '内容已在其他页面更新，请刷新后重试。', undefined, {
    error: 'content_revision_conflict',
    message: '内容已在其他页面更新，请刷新后重试。',
    expectedContentRevision: Number(expected),
    actualContentRevision: Number(candidate.contentRevision || 1),
    current: candidate,
  })
}

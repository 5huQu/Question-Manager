import type { ParagraphBlock, TeachingInline } from '@/types/teachingDocument'
import { graphemeBoundaries } from './grapheme'
import { TEACHING_DOM, TEACHING_DOM_SELECTORS } from './domContract'
import {
  blockSourcePathKey,
  type BlockSourcePath,
  type InlineCursor,
} from './fragment'
import type { BlockGeometry, RenderDiagnostic } from './types'

export interface ParagraphLineMeasurement {
  lineIndex: number
  top: number
  bottom: number
  height: number
  start: InlineCursor
  end: InlineCursor
}

export interface ParagraphMeasurement {
  blockId: string
  sourceIndex: number
  sourcePath: BlockSourcePath
  lines: ParagraphLineMeasurement[]
  marginTop: number
  marginBottom: number
  diagnostics: RenderDiagnostic[]
  measurementVersion: string
}

export interface ParagraphRangeGeometryAdapter {
  measureText(
    inlineElement: HTMLElement,
    startOffset: number,
    endOffset: number,
    root: HTMLElement,
  ): BlockGeometry[]
  measureAtomic(inlineElement: HTMLElement, root: HTMLElement): BlockGeometry[]
  margins(paragraphElement: HTMLElement): { marginTop: number; marginBottom: number }
}

function relativeRect(rect: DOMRect, root: HTMLElement): BlockGeometry {
  const rootRect = root.getBoundingClientRect()
  const top = rect.top - rootRect.top
  return { width: rect.width, height: rect.height, top, bottom: top + rect.height }
}

function textNodes(container: HTMLElement) {
  const result: Text[] = []
  const walker = container.ownerDocument.createTreeWalker(container, 4)
  let node = walker.nextNode()
  while (node) {
    result.push(node as Text)
    node = walker.nextNode()
  }
  return result
}

function boundaryForOffset(nodes: Text[], offset: number) {
  let remaining = offset
  for (const node of nodes) {
    const length = node.data.length
    if (remaining <= length) return { node, offset: remaining }
    remaining -= length
  }
  const last = nodes[nodes.length - 1]
  return last ? { node: last, offset: last.data.length } : null
}

export const browserParagraphRangeGeometryAdapter: ParagraphRangeGeometryAdapter = {
  measureText(inlineElement, startOffset, endOffset, root) {
    const content = inlineElement.querySelector<HTMLElement>(`[${TEACHING_DOM.inlineContent}]`)
    if (!content) return []
    const nodes = textNodes(content)
    const localStart = startOffset - Number(inlineElement.getAttribute(TEACHING_DOM.inlineTextStart) || 0)
    const localEnd = endOffset - Number(inlineElement.getAttribute(TEACHING_DOM.inlineTextStart) || 0)
    const start = boundaryForOffset(nodes, localStart)
    const end = boundaryForOffset(nodes, localEnd)
    if (!start || !end) return []
    try {
      const range = inlineElement.ownerDocument.createRange()
      range.setStart(start.node, start.offset)
      range.setEnd(end.node, end.offset)
      return Array.from(range.getClientRects(), (rect) => relativeRect(rect, root))
    } catch {
      return []
    }
  },
  measureAtomic(inlineElement, root) {
    return Array.from(inlineElement.getClientRects(), (rect) => relativeRect(rect, root))
  },
  margins(paragraphElement) {
    const style = paragraphElement.ownerDocument.defaultView?.getComputedStyle(paragraphElement)
    return {
      marginTop: Number.parseFloat(style?.marginTop || '0') || 0,
      marginBottom: Number.parseFloat(style?.marginBottom || '0') || 0,
    }
  },
}

function cursorAfterAtomic(inlineIndex: number): InlineCursor {
  return { inlineIndex: inlineIndex + 1 }
}

function paragraphVersion(blockId: string, lines: ParagraphLineMeasurement[], marginTop: number, marginBottom: number) {
  const source = [
    blockId,
    marginTop,
    marginBottom,
    ...lines.flatMap((line) => [
      line.top,
      line.bottom,
      line.start.inlineIndex,
      line.start.textOffset ?? '',
      line.end.inlineIndex,
      line.end.textOffset ?? '',
    ]),
  ].join('|')
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `p-${(hash >>> 0).toString(16)}`
}

function hasSourceContent(inlines: TeachingInline[]) {
  return inlines.some((inline) => inline.type === 'text'
    ? inline.text.trim().length > 0
    : inline.type === 'inlineMath' || inline.type === 'unknown')
}

export function measureParagraphLines(
  root: HTMLElement,
  block: ParagraphBlock,
  sourceIndex: number,
  blockElement: HTMLElement,
  adapter: ParagraphRangeGeometryAdapter = browserParagraphRangeGeometryAdapter,
  sourcePath: BlockSourcePath = {
    sourceIndex,
    topLevelBlockId: block.id,
    childPath: [],
  },
): ParagraphMeasurement {
  const diagnostics: RenderDiagnostic[] = []
  const paragraphElement = blockElement.querySelector<HTMLElement>('.td-paragraph') || blockElement
  const margins = adapter.margins(paragraphElement)
  const inlineElements = new Map<number, HTMLElement>()
  blockElement.querySelectorAll<HTMLElement>(TEACHING_DOM_SELECTORS.inline).forEach((element) => {
    const index = Number(element.getAttribute(TEACHING_DOM.inlineIndex))
    if (!Number.isInteger(index) || inlineElements.has(index)) {
      diagnostics.push({
        code: 'paragraph-range-invalid',
        severity: 'warning',
        blockId: block.id,
        message: `段落 ${block.id} 的 inline DOM index ${String(index)} 无效或重复。`,
      })
      return
    }
    inlineElements.set(index, element)
  })

  const lines: ParagraphLineMeasurement[] = []
  let current: Omit<ParagraphLineMeasurement, 'lineIndex'> | null = null
  let pendingStart: InlineCursor | null = null
  const flush = () => {
    if (!current) return
    lines.push({ ...current, lineIndex: lines.length })
    current = null
    pendingStart = null
  }
  const appendGeometry = (start: InlineCursor, end: InlineCursor, geometry: BlockGeometry) => {
    if (![geometry.top, geometry.bottom, geometry.height, geometry.width].every(Number.isFinite)
      || geometry.height <= 0 || geometry.width < 0 || geometry.bottom < geometry.top) {
      diagnostics.push({
        code: 'paragraph-range-invalid',
        severity: 'warning',
        blockId: block.id,
        lineIndex: lines.length,
        message: `段落 ${block.id} 的 Range 返回零高度或异常 rect。`,
      })
      return
    }
    const sameLine = current
      && (Math.abs(current.top - geometry.top) <= 1.5
        || (geometry.top < current.bottom && geometry.bottom > current.top))
    if (!sameLine) flush()
    if (!current) {
      current = {
        top: geometry.top,
        bottom: geometry.bottom,
        height: geometry.bottom - geometry.top,
        start: pendingStart || start,
        end,
      }
    } else {
      current.top = Math.min(current.top, geometry.top)
      current.bottom = Math.max(current.bottom, geometry.bottom)
      current.height = current.bottom - current.top
      current.end = end
    }
  }

  block.content.forEach((inline, inlineIndex) => {
    const element = inlineElements.get(inlineIndex)
    const before: InlineCursor = { inlineIndex }
    const after = cursorAfterAtomic(inlineIndex)
    if (!element) {
      diagnostics.push({
        code: 'paragraph-measurement-missing',
        severity: 'warning',
        blockId: block.id,
        message: `段落 ${block.id} 缺少 inline ${inlineIndex} 的测量 DOM。`,
      })
      return
    }

    if (inline.type === 'text') {
      const boundaries = graphemeBoundaries(inline.text)
      for (let boundaryIndex = 0; boundaryIndex < boundaries.length - 1; boundaryIndex += 1) {
        const startOffset = boundaries[boundaryIndex]
        const endOffset = boundaries[boundaryIndex + 1]
        const start = startOffset === 0 ? before : { inlineIndex, textOffset: startOffset }
        const end = endOffset === inline.text.length ? after : { inlineIndex, textOffset: endOffset }
        const rects = adapter.measureText(element, startOffset, endOffset, root)
        if (!rects.length) {
          if (!current && !pendingStart) pendingStart = start
          if (current) current.end = end
          continue
        }
        rects.forEach((rect) => appendGeometry(start, end, rect))
      }
      return
    }

    const rects = adapter.measureAtomic(element, root)
    if (inline.type === 'hardBreak') {
      rects.forEach((rect) => appendGeometry(before, after, rect))
      if (current) current.end = after
      flush()
      return
    }
    if (!rects.length) {
      diagnostics.push({
        code: 'paragraph-measurement-missing',
        severity: 'warning',
        blockId: block.id,
        message: `段落 ${block.id} 的原子 inline ${inlineIndex} 没有可用 rect。`,
      })
      if (!pendingStart) pendingStart = before
      return
    }
    rects.forEach((rect) => appendGeometry(before, after, rect))
  })
  flush()

  if (!lines.length && hasSourceContent(block.content)) {
    diagnostics.push({
      code: 'paragraph-range-invalid',
      severity: 'warning',
      blockId: block.id,
      message: `段落 ${block.id} 含可见内容，但未获得任何有效行盒。`,
    })
  }
  return {
    blockId: block.id,
    sourceIndex,
    sourcePath,
    lines,
    marginTop: margins.marginTop,
    marginBottom: margins.marginBottom,
    diagnostics,
    measurementVersion: paragraphVersion(block.id, lines, margins.marginTop, margins.marginBottom),
  }
}

export function measureTeachingDocumentParagraphs(
  root: HTMLElement,
  document: { content: import('@/types/teachingDocument').TeachingBlock[] },
  adapter: ParagraphRangeGeometryAdapter = browserParagraphRangeGeometryAdapter,
  /** 编排器传入已查询的段落块元素，避免同轮重复 querySelectorAll。 */
  paragraphElements?: HTMLElement[],
) {
  const paragraphElementsResolved = paragraphElements ?? Array.from(root.querySelectorAll<HTMLElement>(
    `${TEACHING_DOM_SELECTORS.block}[${TEACHING_DOM.blockType}="paragraph"]`,
  ))
  const queues = new Map<string, HTMLElement[]>()
  paragraphElementsResolved.forEach((element) => {
    const sourceIndex = Number(element.getAttribute(TEACHING_DOM.sourceIndex))
    const childIndexValue = element.getAttribute(TEACHING_DOM.childIndex)
    const childIndex = childIndexValue === null ? undefined : Number(childIndexValue)
    if (!Number.isInteger(sourceIndex) || (childIndex !== undefined && !Number.isInteger(childIndex))) return
    const key = childIndex === undefined ? `${sourceIndex}` : `${sourceIndex}/${childIndex}`
    queues.set(key, [...(queues.get(key) || []), element])
  })

  const measurements: ParagraphMeasurement[] = []
  const measureOne = (
    block: ParagraphBlock,
    sourceIndex: number,
    topLevelBlockId: string,
    childIndex?: number,
  ) => {
    const sourcePath: BlockSourcePath = {
      sourceIndex,
      topLevelBlockId,
      childPath: childIndex === undefined ? [] : [{ childIndex, blockId: block.id }],
    }
    const key = childIndex === undefined ? `${sourceIndex}` : `${sourceIndex}/${childIndex}`
    const element = queues.get(key)?.shift()
    if (!element) {
      measurements.push({
        blockId: block.id,
        sourceIndex,
        sourcePath,
        lines: [],
        marginTop: 0,
        marginBottom: 0,
        diagnostics: [{
          code: 'paragraph-measurement-missing',
          severity: 'warning',
          blockId: block.id,
          message: `段落 ${block.id}（${blockSourcePathKey(sourcePath)}）缺少测量 DOM。`,
        }],
        measurementVersion: `p-missing-${blockSourcePathKey(sourcePath)}`,
      })
      return
    }
    measurements.push(measureParagraphLines(root, block, sourceIndex, element, adapter, sourcePath))
  }

  document.content.forEach((block, sourceIndex) => {
    if (block.type === 'paragraph') {
      measureOne(block, sourceIndex, block.id)
      return
    }
    if (block.type !== 'box') return
    block.children.forEach((child, childIndex) => {
      if (child.type === 'paragraph') measureOne(child, sourceIndex, block.id, childIndex)
    })
  })
  return measurements
}

export function paragraphMeasurementsVersion(measurements: ParagraphMeasurement[]) {
  return measurements.map((measurement) => measurement.measurementVersion).join('.')
}

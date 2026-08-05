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
  /**
   * 批量读取一段文本的全部行盒。未实现时保留逐字素测量路径，兼容测试和外部适配器。
   */
  measureTextRange?(
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

function measureBrowserTextRange(
  inlineElement: HTMLElement,
  startOffset: number,
  endOffset: number,
  root: HTMLElement,
) {
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
}

export const browserParagraphRangeGeometryAdapter: ParagraphRangeGeometryAdapter = {
  measureText: measureBrowserTextRange,
  measureTextRange: measureBrowserTextRange,
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

export interface ParagraphRangeGeometryCallStats {
  textProbeCalls: number
  textRangeCalls: number
  atomicCalls: number
}

export function createCountingParagraphRangeGeometryAdapter(
  source: ParagraphRangeGeometryAdapter = browserParagraphRangeGeometryAdapter,
) {
  const stats: ParagraphRangeGeometryCallStats = {
    textProbeCalls: 0,
    textRangeCalls: 0,
    atomicCalls: 0,
  }
  const adapter: ParagraphRangeGeometryAdapter = {
    measureText(...args) {
      stats.textProbeCalls += 1
      return source.measureText(...args)
    },
    measureTextRange: source.measureTextRange
      ? (...args) => {
          stats.textRangeCalls += 1
          return source.measureTextRange!(...args)
        }
      : undefined,
    measureAtomic(...args) {
      stats.atomicCalls += 1
      return source.measureAtomic(...args)
    },
    margins: (...args) => source.margins(...args),
  }
  return { adapter, stats }
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

const LINE_TOP_TOLERANCE = 1.5

function validGeometry(geometry: BlockGeometry) {
  return [geometry.top, geometry.bottom, geometry.height, geometry.width].every(Number.isFinite)
    && geometry.height > 0
    && geometry.width >= 0
    && geometry.bottom >= geometry.top
}

function geometriesShareLine(
  left: Pick<BlockGeometry, 'top' | 'bottom'>,
  right: Pick<BlockGeometry, 'top' | 'bottom'>,
) {
  return Math.abs(left.top - right.top) <= LINE_TOP_TOLERANCE
    || (right.top < left.bottom && right.bottom > left.top)
}

function mergeRangeLineGeometries(rects: BlockGeometry[]) {
  if (!rects.length || rects.some((rect) => !validGeometry(rect))) return []
  const lines: BlockGeometry[] = []
  rects.forEach((rect) => {
    const current = lines[lines.length - 1]
    if (!current || !geometriesShareLine(current, rect)) {
      lines.push({ ...rect })
      return
    }
    current.top = Math.min(current.top, rect.top)
    current.bottom = Math.max(current.bottom, rect.bottom)
    current.height = current.bottom - current.top
    current.width += rect.width
  })
  return lines
}

function geometryLineIndex(rects: BlockGeometry[], lines: BlockGeometry[]) {
  if (!rects.length || rects.some((rect) => !validGeometry(rect))) return null
  const matches = new Set<number>()
  rects.forEach((rect) => {
    const index = lines.findIndex((line) => geometriesShareLine(line, rect))
    if (index >= 0) matches.add(index)
  })
  return matches.size === 1 ? [...matches][0] : null
}

function textCursor(inlineIndex: number, offset: number, textLength: number, edge: 'start' | 'end'): InlineCursor {
  if (offset === 0) return { inlineIndex }
  if (offset === textLength && edge === 'end') return cursorAfterAtomic(inlineIndex)
  return { inlineIndex, textOffset: offset }
}

interface BatchedTextLine {
  geometry: BlockGeometry
  startOffset: number
  endOffset: number
}

function measureTextLinesBatched(
  root: HTMLElement,
  element: HTMLElement,
  text: string,
  boundaries: number[],
  adapter: ParagraphRangeGeometryAdapter,
): BatchedTextLine[] | null {
  if (!adapter.measureTextRange || boundaries.length <= 1) return null
  const lineGeometries = mergeRangeLineGeometries(adapter.measureTextRange(element, 0, text.length, root))
  if (!lineGeometries.length) return null
  if (lineGeometries.length === 1) {
    return [{ geometry: lineGeometries[0], startOffset: 0, endOffset: text.length }]
  }

  const graphemeCount = boundaries.length - 1
  const probeCache = new Map<number, number | null>()
  const probeLine = (graphemeIndex: number, refresh = false) => {
    if (!refresh && probeCache.has(graphemeIndex)) return probeCache.get(graphemeIndex) ?? null
    const rects = adapter.measureText(
      element,
      boundaries[graphemeIndex],
      boundaries[graphemeIndex + 1],
      root,
    )
    const lineIndex = geometryLineIndex(rects, lineGeometries)
    probeCache.set(graphemeIndex, lineIndex)
    return lineIndex
  }

  const transitions = [0]
  for (let lineIndex = 0; lineIndex < lineGeometries.length - 1; lineIndex += 1) {
    const searchStart = transitions[transitions.length - 1]
    let low = searchStart
    let high = graphemeCount
    let binarySearchValid = true
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      const measuredLine = probeLine(middle)
      if (measuredLine === null) {
        binarySearchValid = false
        break
      }
      if (measuredLine <= lineIndex) low = middle + 1
      else high = middle
    }

    let transition = binarySearchValid ? low : -1
    if (transition <= searchStart || transition >= graphemeCount) {
      transition = -1
      // 浏览器对空白或复杂字形的单字素 Range 偶尔不稳定，仅线性回退当前行边界。
      for (let graphemeIndex = searchStart + 1; graphemeIndex < graphemeCount; graphemeIndex += 1) {
        const measuredLine = probeLine(graphemeIndex, true)
        if (measuredLine !== null && measuredLine > lineIndex) {
          transition = graphemeIndex
          break
        }
      }
    }
    if (transition < 0) return null
    transitions.push(transition)
  }
  transitions.push(graphemeCount)
  if (transitions.length !== lineGeometries.length + 1) return null

  return lineGeometries.map((geometry, lineIndex) => ({
    geometry,
    startOffset: boundaries[transitions[lineIndex]],
    endOffset: boundaries[transitions[lineIndex + 1]],
  }))
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
    if (!validGeometry(geometry)) {
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
      && geometriesShareLine(current, geometry)
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
      const batchedLines = measureTextLinesBatched(root, element, inline.text, boundaries, adapter)
      if (batchedLines) {
        batchedLines.forEach((line) => {
          appendGeometry(
            textCursor(inlineIndex, line.startOffset, inline.text.length, 'start'),
            textCursor(inlineIndex, line.endOffset, inline.text.length, 'end'),
            line.geometry,
          )
        })
        return
      }
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

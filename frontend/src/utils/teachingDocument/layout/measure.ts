import type { TeachingBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import { parseBreakBehavior, TEACHING_DOM, TEACHING_DOM_SELECTORS } from './domContract'
import type {
  BlockGeometry,
  BlockMeasurement,
  RenderDiagnostic,
  TeachingDocumentMeasurement,
} from './types'

export interface GeometryAdapter {
  measure(element: HTMLElement, root: HTMLElement): BlockGeometry
}

export const browserGeometryAdapter: GeometryAdapter = {
  measure(element, root) {
    const rect = element.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    const top = rect.top - rootRect.top
    return {
      width: rect.width,
      height: rect.height,
      top,
      bottom: top + rect.height,
    }
  },
}

function allDocumentBlocks(document: TeachingDocumentV1) {
  const blocks: TeachingBlock[] = []
  for (const block of document.content) {
    blocks.push(block)
    if (block.type === 'box') blocks.push(...block.children)
  }
  return blocks
}

/** rawMarkdown 块内最大表格高度；无表格时返回 undefined。 */
function maxTableHeightIn(
  element: HTMLElement,
  root: HTMLElement,
  geometry: GeometryAdapter,
): number | undefined {
  const tables = element.querySelectorAll<HTMLElement>('table')
  if (!tables.length) return undefined
  let max = 0
  for (const table of tables) {
    const rect = geometry.measure(table, root)
    if (Number.isFinite(rect.height) && rect.height > max) max = rect.height
  }
  return max
}

function measurementVersion(blocks: BlockMeasurement[], headerHeight: number) {
  const flatten = (block: BlockMeasurement): Array<string | number> => [
    block.blockId,
    block.blockType,
    block.width,
    block.height,
    block.top,
    block.bottom,
    block.sourceIndex ?? '',
    block.childIndex ?? '',
    block.maxTableHeight ?? '',
    ...block.childMeasurements.flatMap(flatten),
  ]
  const source = [headerHeight, ...blocks.flatMap(flatten)].join('|')
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `m-${(hash >>> 0).toString(16)}`
}

export function measureTeachingDocument(
  root: HTMLElement,
  document: TeachingDocumentV1,
  geometry: GeometryAdapter = browserGeometryAdapter,
): TeachingDocumentMeasurement {
  const diagnostics: RenderDiagnostic[] = []
  const elements = Array.from(root.querySelectorAll<HTMLElement>(TEACHING_DOM_SELECTORS.block))
  const measuredByElement = new Map<HTMLElement, BlockMeasurement>()
  const idCounts = new Map<string, number>()

  for (const element of elements) {
    const blockId = element.getAttribute(TEACHING_DOM.blockId) || ''
    const blockType = element.getAttribute(TEACHING_DOM.blockType) || 'unknown'
    const splitPolicy = element.getAttribute(TEACHING_DOM.splitPolicy) || 'unknown'
    const parent = element.parentElement?.closest<HTMLElement>(TEACHING_DOM_SELECTORS.block)
    const parentBlockId = parent?.getAttribute(TEACHING_DOM.blockId) || undefined
    const sourceIndexValue = element.getAttribute(TEACHING_DOM.sourceIndex)
    const childIndexValue = element.getAttribute(TEACHING_DOM.childIndex)
    const sourceIndex = sourceIndexValue === null ? undefined : Number(sourceIndexValue)
    const childIndex = childIndexValue === null ? undefined : Number(childIndexValue)
    const rect = geometry.measure(element, root)
    idCounts.set(blockId, (idCounts.get(blockId) || 0) + 1)

    if (!blockId) {
      diagnostics.push({
        code: 'measurement-missing',
        severity: 'error',
        message: `类型为 ${blockType} 的渲染块缺少稳定 ID。`,
      })
    }
    if (![rect.width, rect.height, rect.top, rect.bottom].every(Number.isFinite) || rect.width < 0 || rect.height < 0 || rect.bottom < rect.top) {
      diagnostics.push({
        code: 'invalid-measurement',
        severity: 'error',
        blockId: blockId || undefined,
        message: `块 ${blockId || blockType} 的测量结果包含 NaN、负数或倒置边界。`,
      })
    } else if (rect.height === 0) {
      diagnostics.push({
        code: 'invalid-measurement',
        severity: 'warning',
        blockId: blockId || undefined,
        message: `块 ${blockId || blockType} 的测量高度为 0。`,
      })
    }

    measuredByElement.set(element, {
      blockId,
      blockType,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      bottom: rect.bottom,
      splitPolicy: splitPolicy === 'never' || splitPolicy === 'paragraph' || splitPolicy === 'children'
        || splitPolicy === 'forced-break' || splitPolicy === 'unknown'
        ? splitPolicy
        : 'unknown',
      breakBehavior: parseBreakBehavior(element.getAttribute(TEACHING_DOM.breakBehavior)),
      parentBlockId,
      sourceIndex: Number.isInteger(sourceIndex) ? sourceIndex : undefined,
      childIndex: Number.isInteger(childIndex) ? childIndex : undefined,
      depth: parent ? 1 : 0,
      childMeasurements: [],
      maxTableHeight: blockType === 'rawMarkdown'
        ? maxTableHeightIn(element, root, geometry)
        : undefined,
    })
  }

  for (const [id, count] of idCounts) {
    if (id && count > 1) {
      diagnostics.push({
        code: 'duplicate-block-id',
        severity: 'error',
        blockId: id,
        message: `DOM 中发现 ${count} 个 ID 为 ${id} 的块，测量结果不会静默合并。`,
      })
    }
  }

  for (const block of allDocumentBlocks(document)) {
    if ((idCounts.get(block.id) || 0) === 0) {
      diagnostics.push({
        code: 'measurement-missing',
        severity: 'error',
        blockId: block.id,
        message: `文档块 ${block.id} 在渲染 DOM 中不存在。`,
      })
    }
  }

  const topLevel: BlockMeasurement[] = []
  for (const element of elements) {
    const measurement = measuredByElement.get(element)
    if (!measurement) continue
    const parent = element.parentElement?.closest<HTMLElement>(TEACHING_DOM_SELECTORS.block)
    const parentMeasurement = parent ? measuredByElement.get(parent) : undefined
    if (parentMeasurement) {
      measurement.depth = parentMeasurement.depth + 1
      parentMeasurement.childMeasurements.push(measurement)
    } else {
      topLevel.push(measurement)
    }
  }

  const header = root.querySelector<HTMLElement>(TEACHING_DOM_SELECTORS.documentHeader)
  const headerHeight = header ? geometry.measure(header, root).height : 0
  if (!Number.isFinite(headerHeight) || headerHeight < 0) {
    diagnostics.push({
      code: 'invalid-measurement',
      severity: 'error',
      message: '文档标题区域的测量结果无效。',
    })
  }

  return {
    blocks: topLevel,
    headerHeight: Number.isFinite(headerHeight) && headerHeight >= 0 ? headerHeight : 0,
    diagnostics,
    measurementVersion: measurementVersion(topLevel, headerHeight),
  }
}

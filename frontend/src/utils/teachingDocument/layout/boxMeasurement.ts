import type { BoxBlock, BoxChildBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import { TEACHING_DOM, TEACHING_DOM_SELECTORS } from './domContract'
import type { BlockSourcePath } from './fragment'
import type {
  BlockMeasurement,
  RenderDiagnostic,
  SplitPolicy,
  TeachingDocumentMeasurement,
} from './types'

export interface BoxFragmentChromeMeasurement {
  single: number
  start: number
  middle: number
  end: number
}

export interface BoxChildMeasurement {
  childBlockId: string
  childIndex: number
  blockType: BoxChildBlock['type']
  height: number
  splitPolicy: SplitPolicy
  sourcePath: BlockSourcePath
}

export interface BoxMeasurement {
  blockId: string
  sourceIndex: number
  totalHeight: number
  headerHeight: number
  bodyPaddingTop: number
  bodyPaddingBottom: number
  fragmentChrome: BoxFragmentChromeMeasurement
  children: BoxChildMeasurement[]
  diagnostics: RenderDiagnostic[]
  measurementVersion: string
}

export interface BoxChromeGeometryAdapter {
  boxChrome(
    boxElement: HTMLElement,
    headerElement: HTMLElement | null,
    bodyElement: HTMLElement,
  ): {
    headerHeight: number
    marginTop: number
    marginBottom: number
    borderTop: number
    borderBottom: number
    bodyPaddingTop: number
    bodyPaddingBottom: number
  }
}

function cssPixels(value: string | undefined) {
  return Number.parseFloat(value || '0') || 0
}

function outerHeight(element: HTMLElement | null) {
  if (!element) return 0
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  return element.getBoundingClientRect().height
    + cssPixels(style?.marginTop)
    + cssPixels(style?.marginBottom)
}

export const browserBoxChromeGeometryAdapter: BoxChromeGeometryAdapter = {
  boxChrome(boxElement, headerElement, bodyElement) {
    const view = boxElement.ownerDocument.defaultView
    const boxStyle = view?.getComputedStyle(boxElement)
    const bodyStyle = view?.getComputedStyle(bodyElement)
    return {
      headerHeight: headerElement?.getBoundingClientRect().height || 0,
      marginTop: cssPixels(boxStyle?.marginTop),
      marginBottom: cssPixels(boxStyle?.marginBottom),
      borderTop: cssPixels(boxStyle?.borderTopWidth),
      borderBottom: cssPixels(boxStyle?.borderBottomWidth),
      bodyPaddingTop: cssPixels(bodyStyle?.paddingTop),
      bodyPaddingBottom: cssPixels(bodyStyle?.paddingBottom),
    }
  },
}

function versionForBox(measurement: Omit<BoxMeasurement, 'measurementVersion'>) {
  const source = [
    measurement.blockId,
    measurement.sourceIndex,
    measurement.totalHeight,
    measurement.headerHeight,
    measurement.bodyPaddingTop,
    measurement.bodyPaddingBottom,
    measurement.fragmentChrome.single,
    measurement.fragmentChrome.start,
    measurement.fragmentChrome.middle,
    measurement.fragmentChrome.end,
    ...measurement.children.flatMap((child) => [
      child.childIndex,
      child.childBlockId,
      child.blockType,
      child.height,
      child.splitPolicy,
    ]),
  ].join('|')
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `b-${(hash >>> 0).toString(16)}`
}

function finiteNonNegative(values: number[]) {
  return values.every((value) => Number.isFinite(value) && value >= 0)
}

export function measureTeachingDocumentBoxes(
  root: HTMLElement,
  document: TeachingDocumentV1,
  documentMeasurement: TeachingDocumentMeasurement,
  adapter: BoxChromeGeometryAdapter = browserBoxChromeGeometryAdapter,
  /** 编排器传入已查询的顶层块元素，避免同轮重复 querySelectorAll。 */
  topLevelElements?: HTMLElement[],
): BoxMeasurement[] {
  const topLevelElementsResolved = topLevelElements ?? Array.from(
    root.querySelectorAll<HTMLElement>(TEACHING_DOM_SELECTORS.block),
  ).filter((element) => !element.parentElement?.closest(TEACHING_DOM_SELECTORS.block))
  const elementsBySource = new Map<number, HTMLElement[]>()
  topLevelElementsResolved.forEach((element) => {
    const sourceIndex = Number(element.getAttribute(TEACHING_DOM.sourceIndex))
    if (!Number.isInteger(sourceIndex)) return
    elementsBySource.set(sourceIndex, [...(elementsBySource.get(sourceIndex) || []), element])
  })
  const measurementsBySource = new Map<number, BlockMeasurement[]>()
  documentMeasurement.blocks.forEach((measurement) => {
    if (measurement.sourceIndex === undefined) return
    measurementsBySource.set(measurement.sourceIndex, [
      ...(measurementsBySource.get(measurement.sourceIndex) || []),
      measurement,
    ])
  })

  const result: BoxMeasurement[] = []
  document.content.forEach((block, sourceIndex) => {
    if (block.type !== 'box') return
    const diagnostics: RenderDiagnostic[] = []
    const topLevel = elementsBySource.get(sourceIndex)?.shift()
    const blockMeasurement = measurementsBySource.get(sourceIndex)?.shift()
    const boxElement = topLevel?.querySelector<HTMLElement>(`[${TEACHING_DOM.boxRoot}]`) || null
    const headerElement = boxElement?.querySelector<HTMLElement>(`[${TEACHING_DOM.boxHeader}]`) || null
    const bodyElement = boxElement?.querySelector<HTMLElement>(`[${TEACHING_DOM.boxBody}]`) || null
    const continuationHeaderProbe = boxElement?.querySelector<HTMLElement>(
      `[${TEACHING_DOM.boxContinuationHeaderProbe}]`,
    ) || null
    const continuationLabelProbe = boxElement?.querySelector<HTMLElement>(
      `[${TEACHING_DOM.boxContinuationLabelProbe}]`,
    ) || null

    if (!topLevel || !blockMeasurement || !boxElement || !bodyElement) {
      diagnostics.push({
        code: 'box-measurement-missing',
        severity: 'error',
        blockId: block.id,
        message: `盒子 ${block.id} 缺少根节点、body 或顶层测量结果，不能安全拆分。`,
      })
    }
    const chrome = boxElement && bodyElement
      ? adapter.boxChrome(boxElement, headerElement, bodyElement)
      : {
          headerHeight: 0,
          marginTop: 0,
          marginBottom: 0,
          borderTop: 0,
          borderBottom: 0,
          bodyPaddingTop: 0,
          bodyPaddingBottom: 0,
        }
    if (!finiteNonNegative(Object.values(chrome))) {
      diagnostics.push({
        code: 'invalid-measurement',
        severity: 'error',
        blockId: block.id,
        message: `盒子 ${block.id} 的 header、边框、内边距或外边距测量无效。`,
      })
    }
    const safe = Object.fromEntries(
      Object.entries(chrome).map(([key, value]) => [
        key,
        Number.isFinite(value) && value >= 0 ? value : 0,
      ]),
    ) as typeof chrome
    const fixedChrome = safe.headerHeight
      + safe.borderTop
      + safe.borderBottom
      + safe.bodyPaddingTop
      + safe.bodyPaddingBottom
    const continuationHeaderHeight = outerHeight(continuationHeaderProbe)
    const continuationLabelHeight = outerHeight(continuationLabelProbe)
    const childMeasurements: BoxChildMeasurement[] = []
    block.children.forEach((child, childIndex) => {
      const matches = blockMeasurement?.childMeasurements.filter(
        (measurement) => measurement.childIndex === childIndex,
      ) || []
      const childMeasurement = matches[0]
      if (matches.length !== 1 || childMeasurement?.blockId !== child.id) {
        diagnostics.push({
          code: 'box-measurement-missing',
          severity: 'error',
          blockId: child.id,
          message: `盒子 ${block.id} 的子块 ${childIndex}:${child.id} 测量缺失、重复或与 source path 不一致。`,
        })
      }
      const height = childMeasurement?.height ?? 0
      if (!Number.isFinite(height) || height < 0) {
        diagnostics.push({
          code: 'invalid-measurement',
          severity: 'error',
          blockId: child.id,
          message: `盒子 ${block.id} 的子块 ${childIndex}:${child.id} 高度无效。`,
        })
      }
      childMeasurements.push({
        childBlockId: child.id,
        childIndex,
        blockType: child.type,
        height: Number.isFinite(height) && height >= 0 ? height : 0,
        splitPolicy: childMeasurement?.splitPolicy || 'unknown',
        sourcePath: {
          sourceIndex,
          topLevelBlockId: block.id,
          childPath: [{ childIndex, blockId: child.id }],
        },
      })
    })
    const withoutVersion = {
      blockId: block.id,
      sourceIndex,
      totalHeight: blockMeasurement?.height || 0,
      headerHeight: safe.headerHeight,
      bodyPaddingTop: safe.bodyPaddingTop,
      bodyPaddingBottom: safe.bodyPaddingBottom,
      fragmentChrome: {
        single: safe.marginTop + fixedChrome + safe.marginBottom,
        // start/middle 会真实渲染“续下页”标签；middle/end 则使用较短的续页栏。
        // 这两部分必须进入测量，否则贴近页底时会在最终渲染中溢出。
        start: safe.marginTop + fixedChrome + continuationLabelHeight,
        middle: safe.borderTop + safe.borderBottom + safe.bodyPaddingTop + safe.bodyPaddingBottom
          + continuationHeaderHeight + continuationLabelHeight,
        end: safe.borderTop + safe.borderBottom + safe.bodyPaddingTop + safe.bodyPaddingBottom
          + continuationHeaderHeight + safe.marginBottom,
      },
      children: childMeasurements,
      diagnostics,
    }
    result.push({ ...withoutVersion, measurementVersion: versionForBox(withoutVersion) })
  })
  return result
}

export function boxMeasurementsVersion(measurements: BoxMeasurement[]) {
  return measurements.map((measurement) => measurement.measurementVersion).join('.')
}

import type { RawMarkdownBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import { TEACHING_DOM } from './domContract'
import type { BlockSourcePath } from './fragment'
import { rawMarkdownSegments } from './rawMarkdownSegments'
import type { RenderDiagnostic } from './types'

export interface RawMarkdownMeasurement {
  blockId: string
  sourcePath: BlockSourcePath
  segmentHeights: number[]
  marginTop: number
  marginBottom: number
  diagnostics: RenderDiagnostic[]
  measurementVersion: string
}

function cssPixels(value: string | undefined) {
  return Number.parseFloat(value || '0') || 0
}

function versionFor(measurement: Omit<RawMarkdownMeasurement, 'measurementVersion'>) {
  let hash = 2166136261
  const source = [measurement.blockId, measurement.marginTop, measurement.marginBottom, ...measurement.segmentHeights].join('|')
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `rm-${(hash >>> 0).toString(16)}`
}

function findChildElement(root: HTMLElement, path: BlockSourcePath) {
  const child = path.childPath[0]
  return Array.from(root.querySelectorAll<HTMLElement>(`[${TEACHING_DOM.block}]`)).find((element) => (
    element.getAttribute(TEACHING_DOM.blockId) === child.blockId
      && Number(element.getAttribute(TEACHING_DOM.sourceIndex)) === path.sourceIndex
      && element.getAttribute(TEACHING_DOM.parentBlockId) === path.topLevelBlockId
      && Number(element.getAttribute(TEACHING_DOM.childIndex)) === child.childIndex
  ))
}

/** Measurements for rawMarkdown children inside boxes. */
export function measureBoxChildRawMarkdowns(
  root: HTMLElement,
  document: TeachingDocumentV1,
  sourceIndexes?: ReadonlySet<number>,
): RawMarkdownMeasurement[] {
  const measurements: RawMarkdownMeasurement[] = []
  document.content.forEach((parent, sourceIndex) => {
    if (sourceIndexes && !sourceIndexes.has(sourceIndex)) return
    if (parent.type !== 'box') return
    parent.children.forEach((child, childIndex) => {
      if (child.type !== 'rawMarkdown') return
      const raw = child as RawMarkdownBlock
      const sourcePath: BlockSourcePath = {
        sourceIndex,
        topLevelBlockId: parent.id,
        childPath: [{ childIndex, blockId: raw.id }],
      }
      const diagnostics: RenderDiagnostic[] = []
      const shell = findChildElement(root, sourcePath)
      const rawElement = shell?.querySelector<HTMLElement>('.td-raw-markdown')
      const expectedSegments = rawMarkdownSegments(raw.markdown)
      const elements = rawElement
        ? Array.from(rawElement.querySelectorAll<HTMLElement>(`[${TEACHING_DOM.rawMarkdownSegment}]`))
        : []
      if (!rawElement || elements.length !== expectedSegments.length) {
        diagnostics.push({
          code: 'rawmarkdown-measurement-missing',
          severity: 'warning',
          blockId: raw.id,
          message: `混合内容 ${raw.id} 缺少完整的安全分段测量，按整体子块保留。`,
        })
      }
      const style = rawElement?.ownerDocument.defaultView?.getComputedStyle(rawElement)
      const withoutVersion = {
        blockId: raw.id,
        sourcePath,
        segmentHeights: elements.map((element) => element.getBoundingClientRect().height),
        marginTop: cssPixels(style?.marginTop),
        marginBottom: cssPixels(style?.marginBottom),
        diagnostics,
      }
      measurements.push({ ...withoutVersion, measurementVersion: versionFor(withoutVersion) })
    })
  })
  return measurements
}

export function rawMarkdownMeasurementsVersion(measurements: RawMarkdownMeasurement[]) {
  return measurements.map((measurement) => measurement.measurementVersion).join('.')
}

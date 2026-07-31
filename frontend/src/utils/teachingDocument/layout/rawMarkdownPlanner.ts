import type { RawMarkdownBlock } from '@/types/teachingDocument'
import type { FragmentContinuation } from './fragment'
import type { RawMarkdownMeasurement } from './rawMarkdownMeasurement'
import type { RenderDiagnostic } from './types'

export interface PlannedRawMarkdownFragment {
  fragmentIndex: number
  pageOffset: number
  segmentStart: number
  segmentEnd: number
  continuation: FragmentContinuation
  height: number
}

export function planRawMarkdownFragments(input: {
  block: RawMarkdownBlock
  measurement: RawMarkdownMeasurement
  firstPageAvailableHeight: number
  pageContentHeight: number
}): { fragments: PlannedRawMarkdownFragment[]; diagnostics: RenderDiagnostic[] } | null {
  const { measurement, pageContentHeight } = input
  if (!measurement.segmentHeights.length || measurement.diagnostics.length) return null
  const diagnostics: RenderDiagnostic[] = []
  const fragments: PlannedRawMarkdownFragment[] = []
  let start = 0
  let offset = 0
  let available = Math.max(0, input.firstPageAvailableHeight)
  while (start < measurement.segmentHeights.length) {
    const first = start === 0 ? measurement.marginTop : 0
    let end = start
    let height = first
    while (end < measurement.segmentHeights.length) {
      const finalMargin = end === measurement.segmentHeights.length - 1 ? measurement.marginBottom : 0
      const next = height + measurement.segmentHeights[end] + finalMargin
      if (next > available + 0.01) break
      height += measurement.segmentHeights[end]
      end += 1
    }
    if (end === start) {
      if (available < pageContentHeight) {
        offset += 1
        available = pageContentHeight
        continue
      }
      const segmentHeight = measurement.segmentHeights[start] + first + (start === measurement.segmentHeights.length - 1 ? measurement.marginBottom : 0)
      diagnostics.push({
        code: 'rawmarkdown-overflow', severity: 'error', blockId: input.block.id,
        message: `混合内容 ${input.block.id} 的第 ${start + 1} 个安全段高 ${segmentHeight.toFixed(1)}px，超过单页内容区，无法继续拆分。`,
      })
      return null
    }
    if (end === measurement.segmentHeights.length) height += measurement.marginBottom
    fragments.push({ fragmentIndex: fragments.length, pageOffset: offset, segmentStart: start, segmentEnd: end, continuation: 'single', height })
    start = end
    offset += 1
    available = pageContentHeight
  }
  fragments.forEach((fragment, index) => {
    fragment.continuation = fragments.length === 1 ? 'single' : index === 0 ? 'start' : index === fragments.length - 1 ? 'end' : 'middle'
  })
  return { fragments, diagnostics }
}

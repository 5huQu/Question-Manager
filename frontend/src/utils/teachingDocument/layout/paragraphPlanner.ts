import type { ParagraphBlock } from '@/types/teachingDocument'
import {
  compareInlineCursors,
  cursorAtWordBoundary,
  inlineRangeHasVisibleContent,
  textAroundInlineCursor,
  type InlineRange,
  type ParagraphContinuation,
} from './fragment'
import type { ParagraphMeasurement } from './paragraphMeasurement'
import type { RenderDiagnostic } from './types'

const CLOSING_PUNCTUATION = new Set(Array.from('，。！？；：）》】」』'))
const OPENING_PUNCTUATION = new Set(Array.from('（《【「『'))

export interface ParagraphSplitOptions {
  minLinesAtPageBottom: number
  minLinesAtPageTop: number
}

export const DEFAULT_PARAGRAPH_SPLIT_OPTIONS: ParagraphSplitOptions = {
  minLinesAtPageBottom: 2,
  minLinesAtPageTop: 2,
}

export interface PlannedParagraphFragment {
  fragmentIndex: number
  lineStart: number
  lineEnd: number
  pageOffset: number
  range: InlineRange
  height: number
  continuation: ParagraphContinuation
}

export type ParagraphFragmentPlan =
  | { mode: 'fragments'; fragments: PlannedParagraphFragment[]; diagnostics: RenderDiagnostic[] }
  | { mode: 'whole-next'; diagnostics: RenderDiagnostic[] }
  | { mode: 'fallback-whole'; diagnostics: RenderDiagnostic[] }

function fragmentHeight(
  measurement: ParagraphMeasurement,
  start: number,
  end: number,
) {
  const lines = measurement.lines
  if (start < 0 || end <= start || end > lines.length) return 0
  return lines[end - 1].bottom - lines[start].top
    + (start === 0 ? measurement.marginTop : 0)
    + (end === lines.length ? measurement.marginBottom : 0)
}

function maxFittingEnd(
  measurement: ParagraphMeasurement,
  start: number,
  availableHeight: number,
) {
  let result = start
  for (let end = start + 1; end <= measurement.lines.length; end += 1) {
    if (fragmentHeight(measurement, start, end) > availableHeight + 0.01) break
    result = end
  }
  return result
}

function unsafeBoundary(block: ParagraphBlock, measurement: ParagraphMeasurement, end: number) {
  if (end <= 0 || end >= measurement.lines.length) return false
  const cursor = measurement.lines[end - 1].end
  const { before, after } = textAroundInlineCursor(block.content, cursor)
  return OPENING_PUNCTUATION.has(before) || CLOSING_PUNCTUATION.has(after)
}

export function planParagraphFragments(input: {
  block: ParagraphBlock
  measurement: ParagraphMeasurement
  firstPageAvailableHeight: number
  pageContentHeight: number
  options?: ParagraphSplitOptions
}): ParagraphFragmentPlan {
  const { block, measurement, pageContentHeight } = input
  const options = input.options || DEFAULT_PARAGRAPH_SPLIT_OPTIONS
  const diagnostics: RenderDiagnostic[] = []
  const lines = measurement.lines
  if (!lines.length) {
    return {
      mode: 'fallback-whole',
      diagnostics: [...diagnostics, {
        code: 'paragraph-measurement-missing',
        severity: 'warning',
        blockId: block.id,
        message: `段落 ${block.id} 没有可用于拆分的行盒，回退为整体块。`,
      }],
    }
  }

  lines.forEach((line) => {
    if (line.height > pageContentHeight) {
      diagnostics.push({
        code: 'paragraph-line-overflow',
        severity: 'error',
        blockId: block.id,
        lineIndex: line.lineIndex,
        message: `段落 ${block.id} 的第 ${line.lineIndex + 1} 行高于整页内容区。`,
      })
    }
  })

  const firstAvailable = Math.max(0, input.firstPageAvailableHeight)
  const totalHeight = fragmentHeight(measurement, 0, lines.length)
  const firstFit = maxFittingEnd(measurement, 0, firstAvailable)
  if (totalHeight <= pageContentHeight
    && firstFit < lines.length
    && firstFit < options.minLinesAtPageBottom) {
    return { mode: 'whole-next', diagnostics }
  }

  const fragments: PlannedParagraphFragment[] = []
  let lineStart = 0
  let pageOffset = 0
  let available = firstAvailable
  let rangeStart = lines[0].start
  let guard = 0

  while (lineStart < lines.length && guard <= lines.length + 2) {
    guard += 1
    let lineEnd = maxFittingEnd(measurement, lineStart, available)
    const remainingBefore = lines.length - lineStart
    const onPartiallyUsedFirstPage = pageOffset === 0 && firstAvailable < pageContentHeight

    if (lineEnd === lineStart) {
      if (available < pageContentHeight) {
        pageOffset += 1
        available = pageContentHeight
        continue
      }
      lineEnd = lineStart + 1
    }

    const fittingCount = lineEnd - lineStart
    const remainingAfter = lines.length - lineEnd
    if (remainingAfter > 0 && fittingCount < options.minLinesAtPageBottom) {
      if (onPartiallyUsedFirstPage) {
        pageOffset += 1
        available = pageContentHeight
        continue
      }
      diagnostics.push({
        code: 'paragraph-orphan-line',
        severity: 'warning',
        blockId: block.id,
        lineIndex: lineStart,
        message: `段落 ${block.id} 无法满足页底至少 ${options.minLinesAtPageBottom} 行的约束。`,
      })
    }

    if (remainingAfter > 0 && remainingAfter < options.minLinesAtPageTop) {
      const adjustedEnd = lineEnd - (options.minLinesAtPageTop - remainingAfter)
      if (adjustedEnd - lineStart >= options.minLinesAtPageBottom) {
        lineEnd = adjustedEnd
      } else if (onPartiallyUsedFirstPage && remainingBefore <= maxFittingEnd(measurement, lineStart, pageContentHeight) - lineStart) {
        pageOffset += 1
        available = pageContentHeight
        continue
      } else {
        diagnostics.push({
          code: 'paragraph-widow-line',
          severity: 'warning',
          blockId: block.id,
          lineIndex: lineEnd,
          message: `段落 ${block.id} 无法满足下一页至少 ${options.minLinesAtPageTop} 行的约束。`,
        })
      }
    }

    if (unsafeBoundary(block, measurement, lineEnd)) {
      const reducedEnd = lineEnd - 1
      if (reducedEnd - lineStart >= options.minLinesAtPageBottom
        && (lines.length - reducedEnd === 0 || lines.length - reducedEnd >= options.minLinesAtPageTop)) {
        lineEnd = reducedEnd
      } else {
        diagnostics.push({
          code: 'unsafe-split-boundary',
          severity: 'warning',
          blockId: block.id,
          lineIndex: lineEnd,
          message: `段落 ${block.id} 的候选分页边界邻近禁则标点，当前无法在不破坏 2/2 行规则的情况下调整。`,
        })
      }
    }

    const measuredEnd = lines[lineEnd - 1].end
    const wordSafeEnd = lineEnd < lines.length
      ? cursorAtWordBoundary(block.content, measuredEnd)
      : measuredEnd
    const rangeEnd = compareInlineCursors(block.content, rangeStart, wordSafeEnd) < 0
      ? wordSafeEnd
      : measuredEnd
    const range: InlineRange = { start: rangeStart, end: rangeEnd }
    if (!inlineRangeHasVisibleContent(block.content, range)) {
      diagnostics.push({
        code: 'paragraph-range-invalid',
        severity: 'warning',
        blockId: block.id,
        lineIndex: lineStart,
        message: `段落 ${block.id} 的候选片段只包含空白，已回退为整体块。`,
      })
      return { mode: 'fallback-whole', diagnostics }
    }
    fragments.push({
      fragmentIndex: fragments.length,
      lineStart,
      lineEnd,
      pageOffset,
      range,
      height: fragmentHeight(measurement, lineStart, lineEnd),
      continuation: 'single',
    })
    rangeStart = rangeEnd
    lineStart = lineEnd
    pageOffset += 1
    available = pageContentHeight
  }

  if (lineStart < lines.length || !fragments.length) {
    return {
      mode: 'fallback-whole',
      diagnostics: [...diagnostics, {
        code: 'paragraph-range-invalid',
        severity: 'error',
        blockId: block.id,
        message: `段落 ${block.id} 未能生成连续完整的安全片段，回退为整体块。`,
      }],
    }
  }

  fragments.forEach((fragment, index) => {
    fragment.fragmentIndex = index
    fragment.continuation = fragments.length === 1
      ? 'single'
      : index === 0
        ? 'start'
        : index === fragments.length - 1
          ? 'end'
          : 'middle'
  })
  return { mode: 'fragments', fragments, diagnostics }
}

import type { BoxChildBlock, TeachingBlock, TeachingInline } from '@/types/teachingDocument'
import { graphemeAfter, graphemeBefore, isGraphemeBoundary } from './grapheme'

/**
 * Cursor semantics:
 * - range is half-open: [start, end)
 * - { inlineIndex } is the boundary before that inline
 * - a text cursor may use textOffset in the source text's UTF-16 offsets
 * - paragraph end is { inlineIndex: inlines.length }
 * - atomic nodes never carry textOffset
 */
export interface InlineCursor {
  inlineIndex: number
  textOffset?: number
}

export interface InlineRange {
  start: InlineCursor
  end: InlineCursor
}

export type FragmentContinuation = 'single' | 'start' | 'middle' | 'end'
export type ParagraphContinuation = FragmentContinuation

export interface BlockSourcePath {
  sourceIndex: number
  topLevelBlockId: string
  childPath: Array<{
    childIndex: number
    blockId: string
  }>
}

export function blockSourcePathKey(path: BlockSourcePath): string {
  return [
    `${path.sourceIndex}:${path.topLevelBlockId}`,
    ...path.childPath.map(({ childIndex, blockId }) => `${childIndex}:${blockId}`),
  ].join('/')
}

export interface WholeBlockPaginationItem {
  kind: 'whole'
  blockId: string
  blockType: TeachingBlock['type']
  sourceIndex: number
}

export interface ParagraphFragmentPaginationItem {
  kind: 'fragment'
  fragmentType: 'paragraph'
  blockId: string
  sourceIndex: number
  fragmentIndex: number
  range: InlineRange
  continuation: FragmentContinuation
  lineStart: number
  lineEnd: number
  height: number
}

export interface WholeBoxChildPaginationItem {
  kind: 'whole-child'
  sourcePath: BlockSourcePath
  parentBlockId: string
  childBlockId: string
  childIndex: number
  blockType: BoxChildBlock['type']
  height: number
}

export interface ParagraphBoxChildFragmentPaginationItem {
  kind: 'paragraph-child-fragment'
  sourcePath: BlockSourcePath
  parentBlockId: string
  childBlockId: string
  childIndex: number
  fragmentIndex: number
  range: InlineRange
  continuation: ParagraphContinuation
  lineStart: number
  lineEnd: number
  height: number
}

export type PaginatedBoxChildItem =
  | WholeBoxChildPaginationItem
  | ParagraphBoxChildFragmentPaginationItem

export interface BoxFragmentPaginationItem {
  kind: 'fragment'
  fragmentType: 'box'
  blockId: string
  sourceIndex: number
  sourcePath: BlockSourcePath
  fragmentIndex: number
  pageOffset: number
  continuation: FragmentContinuation
  childItems: PaginatedBoxChildItem[]
  height: number
}

export interface WholeQuestionRegionPaginationItem {
  kind: 'whole-question-region'
  regionKey: string
  regionType: import('./questionRegions').QuestionRegionType
  regionIndex: number
  height: number
  optionStart?: number
  optionEnd?: number
  rowIndex?: number
}

export interface QuestionParagraphFragmentPaginationItem {
  kind: 'question-paragraph-fragment'
  regionKey: string
  regionType: 'stem' | 'analysis'
  regionIndex: number
  fragmentIndex: number
  range: InlineRange
  continuation: ParagraphContinuation
  lineStart: number
  lineEnd: number
  height: number
}

export type PaginatedQuestionRegionItem =
  | WholeQuestionRegionPaginationItem
  | QuestionParagraphFragmentPaginationItem

export interface QuestionFragmentPaginationItem {
  kind: 'fragment'
  fragmentType: 'question'
  blockId: string
  sourceIndex: number
  questionId: string
  fragmentIndex: number
  pageOffset: number
  continuation: FragmentContinuation
  regionItems: PaginatedQuestionRegionItem[]
  height: number
}

export type PaginatedItem =
  | WholeBlockPaginationItem
  | ParagraphFragmentPaginationItem
  | BoxFragmentPaginationItem
  | QuestionFragmentPaginationItem

export interface SlicedTeachingInline {
  inline: TeachingInline
  sourceInlineIndex: number
  textStartOffset?: number
}

export function normalizeInlineCursor(inlines: TeachingInline[], cursor: InlineCursor): InlineCursor {
  const inlineIndex = Math.max(0, Math.min(inlines.length, Math.trunc(cursor.inlineIndex)))
  if (inlineIndex >= inlines.length) return { inlineIndex: inlines.length }
  const inline = inlines[inlineIndex]
  if (inline.type !== 'text' || cursor.textOffset === undefined) return { inlineIndex }
  const offset = Math.max(0, Math.min(inline.text.length, Math.trunc(cursor.textOffset)))
  if (offset === 0) return { inlineIndex }
  if (offset === inline.text.length) return { inlineIndex: inlineIndex + 1 }
  return { inlineIndex, textOffset: offset }
}

export function isValidInlineCursor(inlines: TeachingInline[], cursor: InlineCursor) {
  if (!Number.isInteger(cursor.inlineIndex) || cursor.inlineIndex < 0 || cursor.inlineIndex > inlines.length) return false
  if (cursor.inlineIndex === inlines.length) return cursor.textOffset === undefined
  const inline = inlines[cursor.inlineIndex]
  if (cursor.textOffset === undefined) return true
  return inline.type === 'text'
    && cursor.textOffset >= 0
    && cursor.textOffset <= inline.text.length
    && isGraphemeBoundary(inline.text, cursor.textOffset)
}

export function compareInlineCursors(inlines: TeachingInline[], left: InlineCursor, right: InlineCursor) {
  const a = normalizeInlineCursor(inlines, left)
  const b = normalizeInlineCursor(inlines, right)
  if (a.inlineIndex !== b.inlineIndex) return a.inlineIndex - b.inlineIndex
  return (a.textOffset || 0) - (b.textOffset || 0)
}

export function isValidInlineRange(inlines: TeachingInline[], range: InlineRange) {
  return isValidInlineCursor(inlines, range.start)
    && isValidInlineCursor(inlines, range.end)
    && compareInlineCursors(inlines, range.start, range.end) <= 0
}

export function fullInlineRange(inlines: TeachingInline[]): InlineRange {
  return { start: { inlineIndex: 0 }, end: { inlineIndex: inlines.length } }
}

export function sliceTeachingInlines(inlines: TeachingInline[], range: InlineRange): SlicedTeachingInline[] {
  if (!isValidInlineRange(inlines, range)) return []
  const start = normalizeInlineCursor(inlines, range.start)
  const end = normalizeInlineCursor(inlines, range.end)
  const result: SlicedTeachingInline[] = []

  inlines.forEach((inline, inlineIndex) => {
    if (inline.type === 'text') {
      const startOffset = start.inlineIndex < inlineIndex
        ? 0
        : start.inlineIndex === inlineIndex
          ? start.textOffset || 0
          : inline.text.length
      const endOffset = end.inlineIndex > inlineIndex
        ? inline.text.length
        : end.inlineIndex === inlineIndex
          ? end.textOffset || 0
          : 0
      if (endOffset <= startOffset) return
      result.push({
        sourceInlineIndex: inlineIndex,
        textStartOffset: startOffset,
        inline: { ...inline, text: inline.text.slice(startOffset, endOffset) },
      })
      return
    }

    const nodeStart = { inlineIndex }
    const nodeEnd = { inlineIndex: inlineIndex + 1 }
    if (compareInlineCursors(inlines, start, nodeStart) <= 0 && compareInlineCursors(inlines, end, nodeEnd) >= 0) {
      result.push({ sourceInlineIndex: inlineIndex, inline })
    }
  })
  return result
}

export function inlineRangeHasVisibleContent(inlines: TeachingInline[], range: InlineRange) {
  return sliceTeachingInlines(inlines, range).some(({ inline }) => {
    if (inline.type === 'text') return inline.text.trim().length > 0
    return inline.type === 'inlineMath' || inline.type === 'unknown'
  })
}

export function textAroundInlineCursor(inlines: TeachingInline[], cursor: InlineCursor) {
  const normalized = normalizeInlineCursor(inlines, cursor)
  let before = ''
  let after = ''
  if (normalized.inlineIndex < inlines.length) {
    const current = inlines[normalized.inlineIndex]
    if (current.type === 'text') {
      const offset = normalized.textOffset || 0
      before = graphemeBefore(current.text, offset)
      after = graphemeAfter(current.text, offset)
    }
  }
  for (let index = normalized.inlineIndex - (before ? 0 : 1); !before && index >= 0; index -= 1) {
    const inline = inlines[index]
    if (inline.type === 'text') before = graphemeBefore(inline.text, inline.text.length)
  }
  for (let index = normalized.inlineIndex + (after ? 0 : normalized.textOffset === undefined ? 0 : 1); !after && index < inlines.length; index += 1) {
    const inline = inlines[index]
    if (inline.type === 'text') after = graphemeAfter(inline.text, 0)
  }
  return { before, after }
}

export function inlineCursorLabel(cursor: InlineCursor) {
  return cursor.textOffset === undefined ? `${cursor.inlineIndex}` : `${cursor.inlineIndex}:${cursor.textOffset}`
}

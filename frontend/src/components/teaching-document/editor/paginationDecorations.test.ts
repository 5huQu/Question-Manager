import { describe, expect, it } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import type { PaginationResult } from '@/utils/teachingDocument'
import { inlineCursorToEditorOffset, paginationGapAnchors } from './paginationDecorations'

const document: TeachingDocumentV1 = {
  version: 1,
  documentType: 'lecture',
  title: '测试讲义',
  metadata: {},
  content: [
    {
      type: 'paragraph',
      id: 'p-1',
      content: [
        { type: 'text', text: 'abc' },
        { type: 'hardBreak' },
        { type: 'text', text: 'de' },
      ],
    },
    { type: 'divider', id: 'd-1' },
  ],
}

function pagination(items: PaginationResult['pages'][number]['items'][]): PaginationResult {
  return {
    pages: items.map((pageItems, index) => ({
      index,
      items: pageItems,
      usedHeight: index === 0 ? 80 : 20,
      overflow: false,
      showDocumentHeader: index === 0,
    })),
    diagnostics: [],
    measurementVersion: 'm',
    paragraphMeasurementVersion: 'p',
    boxMeasurementVersion: 'b',
    questionMeasurementVersion: 'q',
  }
}

describe('paginationDecorations', () => {
  it('maps inline cursor positions to the editor text offset', () => {
    const inlines = document.content[0].type === 'paragraph' ? document.content[0].content : []
    expect(inlineCursorToEditorOffset(inlines, { inlineIndex: 0, textOffset: 2 })).toBe(2)
    expect(inlineCursorToEditorOffset(inlines, { inlineIndex: 1 })).toBe(3)
    expect(inlineCursorToEditorOffset(inlines, { inlineIndex: 2, textOffset: 1 })).toBe(5)
    expect(inlineCursorToEditorOffset(inlines, { inlineIndex: 99 })).toBe(6)
  })

  it('creates a top-level anchor for a whole block on the next page', () => {
    const result = pagination([
      [{ kind: 'whole', blockId: 'p-1', blockType: 'paragraph', sourceIndex: 0 }],
      [{ kind: 'whole', blockId: 'd-1', blockType: 'divider', sourceIndex: 1 }],
    ])
    expect(paginationGapAnchors(document, result, 100)).toEqual([
      { blockId: 'd-1', pageNumber: 2, leadingBlankPx: 20 },
    ])
  })

  it('maps paragraph fragments to an internal content offset', () => {
    const result = pagination([
      [{ kind: 'fragment', fragmentType: 'paragraph', blockId: 'p-1', sourceIndex: 0, fragmentIndex: 0, range: { start: { inlineIndex: 0 }, end: { inlineIndex: 1 } }, continuation: 'start', lineStart: 0, lineEnd: 1, height: 80 }],
      [{ kind: 'fragment', fragmentType: 'paragraph', blockId: 'p-1', sourceIndex: 0, fragmentIndex: 1, range: { start: { inlineIndex: 1 }, end: { inlineIndex: 3 } }, continuation: 'end', lineStart: 1, lineEnd: 3, height: 20 }],
    ])
    expect(paginationGapAnchors(document, result, 100)).toEqual([
      { blockId: 'p-1', pageNumber: 2, contentOffset: 3, leadingBlankPx: 20 },
    ])
  })

  it('does not add an external anchor for continuation fragments', () => {
    const result = pagination([
      [{ kind: 'whole', blockId: 'p-1', blockType: 'paragraph', sourceIndex: 0 }],
      [{ kind: 'fragment', fragmentType: 'question', blockId: 'q-1', sourceIndex: 1, fragmentIndex: 1, questionId: 'q', pageOffset: 0, regionItems: [], continuation: 'middle', height: 20 }],
    ])
    expect(paginationGapAnchors(document, result, 100)).toEqual([])
  })

  it('returns no anchors when pagination is unavailable or single-page', () => {
    expect(paginationGapAnchors(document, null, 100)).toEqual([])
    expect(paginationGapAnchors(document, pagination([[{ kind: 'whole', blockId: 'p-1', blockType: 'paragraph', sourceIndex: 0 }]]), 100)).toEqual([])
  })
})

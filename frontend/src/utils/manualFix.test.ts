import { describe, expect, it } from 'vitest'
import {
  displayRectToSegment,
  isHeaderFooterBbox,
  isHeaderFooterSegment,
  normalizeSegmentForSave,
  regionMatchesFigure,
  removeFigureMarkers,
  segmentToDisplayRect,
} from './manualFix'

describe('manual-fix coordinates', () => {
  it('converts between display pixels and normalized segments', () => {
    const segment = displayRectToSegment({ x: 100, y: 200, width: 300, height: 400 }, { width: 1000, height: 2000 }, 2)
    expect(segment).toEqual({ page: 2, x: 0.1, y: 0.1, width: 0.3, height: 0.2 })
    expect(segmentToDisplayRect(segment!, { width: 1000, height: 2000 })).toEqual({ x: 100, y: 200, width: 300, height: 400 })
  })

  it('rejects unusable drawing and image dimensions', () => {
    expect(displayRectToSegment({ x: 0, y: 0, width: 3, height: 20 }, { width: 100, height: 100 }, 1)).toBeNull()
    expect(segmentToDisplayRect({ page: 1, x: 0, y: 0, width: 1, height: 1 }, { width: 0, height: 100 })).toBeNull()
  })

  it('keeps normalized data and normalizes legacy pixel data', () => {
    const normalized = { page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
    expect(normalizeSegmentForSave(normalized, { width: 1000, height: 2000 })).toBe(normalized)
    expect(normalizeSegmentForSave({ page: 1, x: 100, y: 400, width: 300, height: 800 }, { width: 1000, height: 2000 }))
      .toEqual(normalized)
    expect(normalizeSegmentForSave({ page: 1, x: -1, y: 0, width: 10, height: 10 }, { width: 100, height: 100 })).toBeNull()
  })
})

describe('manual-fix figure matching', () => {
  const region = {
    kind: 'shared_answer_key' as const,
    questionKeys: ['block-42'],
    segments: [{ page: 3, x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
  }

  it('prefers stable figure identifiers', () => {
    expect(regionMatchesFigure(region, { sourceBlockId: 'block-42', pageNo: 99 })).toBe(true)
  })

  it('falls back to page and bbox with tolerance', () => {
    expect(regionMatchesFigure(region, { pageNo: 3, bbox: [0.101, 0.201, 0.399, 0.599] })).toBe(true)
    expect(regionMatchesFigure(region, { pageNo: 4, bbox: [0.1, 0.2, 0.4, 0.6] })).toBe(false)
    expect(regionMatchesFigure({ ...region, kind: 'question' }, { id: 'block-42' })).toBe(false)
  })
})

describe('manual-fix cleanup', () => {
  it('removes every marker alias without damaging surrounding content', () => {
    const markdown = '题干\n\n<!-- DOC2X_FIGURE:fig.1 -->\n\n中间\n<!--DOC2X_FIGURE:block+2-->\n结尾'
    expect(removeFigureMarkers(markdown, { id: 'fig.1', blockId: 'block+2' })).toBe('题干\n中间\n结尾')
  })

  it('detects narrow normalized header and footer segments only', () => {
    expect(isHeaderFooterSegment({ page: 1, x: 0, y: 0.04, width: 1, height: 0.05 })).toBe(true)
    expect(isHeaderFooterSegment({ page: 1, x: 0, y: 0.92, width: 1, height: 0.05 })).toBe(true)
    expect(isHeaderFooterSegment({ page: 1, x: 0, y: 0.05, width: 1, height: 0.2 })).toBe(false)
  })

  it('supports normalized and legacy pixel header/footer bboxes', () => {
    expect(isHeaderFooterBbox([0, 0.02, 1, 0.07])).toBe(true)
    expect(isHeaderFooterBbox([0, 0.4, 1, 0.5])).toBe(false)
    expect(isHeaderFooterBbox([0, 2550, 1200, 2700])).toBe(true)
    expect(isHeaderFooterBbox(['bad', 0, 1, 2])).toBe(false)
  })
})

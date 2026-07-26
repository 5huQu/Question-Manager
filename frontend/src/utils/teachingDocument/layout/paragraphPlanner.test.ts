import { describe, expect, it } from 'vitest'
import type { ParagraphBlock } from '@/types/teachingDocument'
import type { InlineCursor } from './fragment'
import type { ParagraphMeasurement } from './paragraphMeasurement'
import { planParagraphFragments } from './paragraphPlanner'

function cursor(offset: number): InlineCursor {
  return offset === 0 ? { inlineIndex: 0 } : { inlineIndex: 0, textOffset: offset }
}

function paragraph(text = '甲乙丙丁戊己庚辛'): ParagraphBlock {
  return { type: 'paragraph', id: 'long-p', content: [{ type: 'text', text }] }
}

function lineMeasurement(textLength = 8, lineHeight = 20): ParagraphMeasurement {
  return {
    blockId: 'long-p',
    sourceIndex: 0,
    sourcePath: { sourceIndex: 0, topLevelBlockId: 'long-p', childPath: [] },
    marginTop: 10,
    marginBottom: 10,
    diagnostics: [],
    measurementVersion: 'lines-v1',
    lines: Array.from({ length: textLength }, (_, index) => ({
      lineIndex: index,
      top: index * lineHeight,
      bottom: (index + 1) * lineHeight,
      height: lineHeight,
      start: cursor(index),
      end: index + 1 === textLength ? { inlineIndex: 1 } : cursor(index + 1),
    })),
  }
}

describe('planParagraphFragments', () => {
  it('produces deterministic, continuous and non-overlapping fragments', () => {
    const input = {
      block: paragraph(),
      measurement: lineMeasurement(),
      firstPageAvailableHeight: 70,
      pageContentHeight: 100,
    }
    const first = planParagraphFragments(input)
    expect(first).toEqual(planParagraphFragments(input))
    expect(first.mode).toBe('fragments')
    if (first.mode !== 'fragments') return
    expect(first.fragments.map((item) => item.continuation)).toEqual(['start', 'middle', 'end'])
    expect(first.fragments[0].range.start).toEqual({ inlineIndex: 0 })
    expect(first.fragments.at(-1)?.range.end).toEqual({ inlineIndex: 1 })
    first.fragments.slice(1).forEach((fragment, index) => {
      expect(fragment.range.start).toEqual(first.fragments[index].range.end)
      expect(fragment.lineStart).toBe(first.fragments[index].lineEnd)
    })
  })

  it('moves a paragraph when only one line fits at the current page bottom', () => {
    const result = planParagraphFragments({
      block: paragraph('甲乙丙'),
      measurement: lineMeasurement(3),
      firstPageAvailableHeight: 30,
      pageContentHeight: 100,
    })
    expect(result.mode).toBe('whole-next')
  })

  it('moves the first fragment instead of leaving an orphan line', () => {
    const result = planParagraphFragments({
      block: paragraph(),
      measurement: lineMeasurement(),
      firstPageAvailableHeight: 30,
      pageContentHeight: 70,
    })
    expect(result.mode).toBe('fragments')
    if (result.mode !== 'fragments') return
    expect(result.fragments[0].pageOffset).toBe(1)
    expect(result.fragments[0].lineEnd - result.fragments[0].lineStart).toBeGreaterThanOrEqual(2)
  })

  it('reports a line taller than the page without dropping it', () => {
    const result = planParagraphFragments({
      block: paragraph('甲'),
      measurement: lineMeasurement(1, 120),
      firstPageAvailableHeight: 100,
      pageContentHeight: 100,
    })
    expect(result.mode).toBe('fragments')
    expect(result.diagnostics.some((item) => item.code === 'paragraph-line-overflow')).toBe(true)
    if (result.mode === 'fragments') expect(result.fragments).toHaveLength(1)
  })

  it('falls back when no line measurement exists', () => {
    const measurement = { ...lineMeasurement(1), lines: [] }
    const result = planParagraphFragments({
      block: paragraph('甲'),
      measurement,
      firstPageAvailableHeight: 20,
      pageContentHeight: 100,
    })
    expect(result.mode).toBe('fallback-whole')
    expect(result.diagnostics[0].code).toBe('paragraph-measurement-missing')
  })

  it('does not output whitespace-only fragments', () => {
    const result = planParagraphFragments({
      block: paragraph('  '),
      measurement: lineMeasurement(2),
      firstPageAvailableHeight: 30,
      pageContentHeight: 30,
    })
    expect(result.mode).toBe('fallback-whole')
  })

  it.each([
    ['甲乙（丙丁戊己庚', 'opening punctuation at the previous line end'],
    ['甲乙丙，丁戊己庚', 'closing punctuation at the next line start'],
  ])('moves an unsafe %s boundary to the previous safe line (%s)', (text) => {
    const result = planParagraphFragments({
      block: paragraph(text),
      measurement: lineMeasurement(8),
      firstPageAvailableHeight: 70,
      pageContentHeight: 100,
    })
    expect(result.mode).toBe('fragments')
    if (result.mode !== 'fragments') return
    expect(result.fragments[0].range.end).toEqual({ inlineIndex: 0, textOffset: 2 })
  })
})

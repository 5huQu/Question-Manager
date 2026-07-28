import { describe, expect, it } from 'vitest'
import type { TeachingInline } from '@/types/teachingDocument'
import {
  compareInlineCursors,
  fallbackGraphemeBoundaries,
  graphemeBoundaries,
  isValidInlineCursor,
  sliceTeachingInlines,
} from '.'

describe('paragraph fragment cursors', () => {
  const inlines: TeachingInline[] = [
    { type: 'text', text: '甲A👍🏽e\u0301', marks: ['bold'] },
    { type: 'inlineMath', latex: 'x^2' },
    { type: 'unknown', originalType: 'future', rawData: { keep: true } },
    { type: 'text', text: '，乙', unknownMarks: [{ type: 'color', value: 'red' }] },
  ]

  it('uses ordered half-open cursors and rejects unsafe grapheme offsets', () => {
    expect(compareInlineCursors(inlines, { inlineIndex: 0, textOffset: 1 }, { inlineIndex: 1 })).toBeLessThan(0)
    expect(isValidInlineCursor(inlines, { inlineIndex: 0, textOffset: 3 })).toBe(false)
    expect(isValidInlineCursor(inlines, { inlineIndex: 1, textOffset: 0 })).toBe(false)
    expect(isValidInlineCursor(inlines, { inlineIndex: inlines.length })).toBe(true)
  })

  it('slices text safely while retaining marks and atomic inline nodes', () => {
    const sliced = sliceTeachingInlines(inlines, {
      start: { inlineIndex: 0, textOffset: 1 },
      end: { inlineIndex: 3, textOffset: 1 },
    })
    expect(sliced.map(({ inline }) => inline.type)).toEqual(['text', 'inlineMath', 'unknown', 'text'])
    expect(sliced[0].inline).toMatchObject({ type: 'text', text: 'A👍🏽e\u0301', marks: ['bold'] })
    expect(sliced[2].inline).toEqual(inlines[2])
    expect(sliced[3].inline).toMatchObject({
      type: 'text',
      text: '，',
      unknownMarks: [{ type: 'color', value: 'red' }],
    })
  })

  it('never emits a partial atomic node', () => {
    expect(sliceTeachingInlines(inlines, {
      start: { inlineIndex: 1 },
      end: { inlineIndex: 1 },
    })).toEqual([])
    expect(sliceTeachingInlines(inlines, {
      start: { inlineIndex: 1 },
      end: { inlineIndex: 2 },
    }).map(({ inline }) => inline.type)).toEqual(['inlineMath'])
  })
})

describe('grapheme boundaries', () => {
  it.each([
    ['中文', [0, 1, 2]],
    ['A B', [0, 1, 2, 3]],
    ['👍🏽', [0, 4]],
    ['e\u0301', [0, 2]],
    ['👨‍👩‍👧‍👦', [0, 11]],
    ['\r\n', [0, 2]],
  ])('keeps visible characters intact for %s', (text, expected) => {
    expect(graphemeBoundaries(text)).toEqual(expected)
    expect(fallbackGraphemeBoundaries(text)).toEqual(expected)
  })
})

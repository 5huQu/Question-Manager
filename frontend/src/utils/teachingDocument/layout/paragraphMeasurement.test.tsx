import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ParagraphBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import { TeachingDocumentRenderer } from '@/components/teaching-document/TeachingDocumentRenderer'
import { ParagraphBlockContent } from '@/components/teaching-document/blocks/BlockRenderer'
import { TEACHING_DOM } from './domContract'
import {
  measureParagraphLines,
  measureTeachingDocumentParagraphs,
  type ParagraphRangeGeometryAdapter,
} from './paragraphMeasurement'
import { graphemeBoundaries } from './grapheme'

function paragraph(): ParagraphBlock {
  return {
    type: 'paragraph',
    id: 'measured',
    content: [
      { type: 'text', text: '甲乙' },
      { type: 'inlineMath', latex: 'x' },
      { type: 'text', text: '丙' },
    ],
  }
}

function measurementDom(block: ParagraphBlock) {
  const root = document.createElement('div')
  const shell = document.createElement('div')
  shell.innerHTML = `<p class="td-paragraph">${renderToStaticMarkup(<ParagraphBlockContent block={block} />)}</p>`
  root.append(shell)
  return { root, shell }
}

describe('measureParagraphLines', () => {
  it('merges text and atomic rects on the same visual line and maps inline boundaries', () => {
    const block = paragraph()
    const { root, shell } = measurementDom(block)
    const adapter: ParagraphRangeGeometryAdapter = {
      measureText(element, start) {
        const inlineIndex = Number(element.getAttribute(TEACHING_DOM.inlineIndex))
        if (inlineIndex === 0) {
          return [{ width: 10, height: 20, top: start === 0 ? 0 : 20, bottom: start === 0 ? 20 : 40 }]
        }
        return [{ width: 10, height: 20, top: 20, bottom: 40 }]
      },
      measureAtomic: () => [{ width: 15, height: 18, top: 21, bottom: 39 }],
      margins: () => ({ marginTop: 10, marginBottom: 10 }),
    }
    const result = measureParagraphLines(root, block, 0, shell, adapter)
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0]).toMatchObject({
      start: { inlineIndex: 0 },
      end: { inlineIndex: 0, textOffset: 1 },
    })
    expect(result.lines[1].start).toEqual({ inlineIndex: 0, textOffset: 1 })
    expect(result.lines[1].end).toEqual({ inlineIndex: 3 })
    expect(result.diagnostics).toEqual([])
  })

  it('diagnoses invalid rects and missing inline DOM without fabricating layout', () => {
    const block = paragraph()
    const { root, shell } = measurementDom(block)
    shell.querySelector(`[${TEACHING_DOM.inlineIndex}="1"]`)?.remove()
    const adapter: ParagraphRangeGeometryAdapter = {
      measureText: () => [{ width: 10, height: 0, top: 0, bottom: 0 }],
      measureAtomic: () => [],
      margins: () => ({ marginTop: 0, marginBottom: 0 }),
    }
    const result = measureParagraphLines(root, block, 0, shell, adapter)
    expect(result.lines).toEqual([])
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'paragraph-measurement-missing',
      'paragraph-range-invalid',
    ]))
  })

  it('collects full-range line boxes and probes only near line boundaries', () => {
    const text = '甲'.repeat(64)
    const block: ParagraphBlock = {
      type: 'paragraph',
      id: 'batched',
      content: [{ type: 'text', text }],
    }
    const { root, shell } = measurementDom(block)
    let rangeCalls = 0
    let probeCalls = 0
    const adapter: ParagraphRangeGeometryAdapter = {
      measureText(_element, startOffset) {
        probeCalls += 1
        const lineIndex = Math.floor(startOffset / 16)
        const top = lineIndex * 20
        return [{ width: 10, height: 20, top, bottom: top + 20 }]
      },
      measureTextRange() {
        rangeCalls += 1
        return Array.from({ length: 4 }, (_, lineIndex) => {
          const top = lineIndex * 20
          return { width: 160, height: 20, top, bottom: top + 20 }
        })
      },
      measureAtomic: () => [],
      margins: () => ({ marginTop: 0, marginBottom: 0 }),
    }

    const result = measureParagraphLines(root, block, 0, shell, adapter)
    expect(result.lines.map((line) => line.end)).toEqual([
      { inlineIndex: 0, textOffset: 16 },
      { inlineIndex: 0, textOffset: 32 },
      { inlineIndex: 0, textOffset: 48 },
      { inlineIndex: 1 },
    ])
    expect(rangeCalls).toBe(1)
    expect(probeCalls).toBeLessThan(24)
    expect(probeCalls).toBeLessThan(text.length / 2)
  })

  it('keeps every binary-search probe and resulting cursor on grapheme boundaries', () => {
    const text = `甲👩‍👩‍👧‍👦e\u0301乙丁`
    const boundaries = graphemeBoundaries(text)
    const splitOffset = boundaries[2]
    const block: ParagraphBlock = {
      type: 'paragraph',
      id: 'graphemes',
      content: [{ type: 'text', text }],
    }
    const { root, shell } = measurementDom(block)
    const probedOffsets: number[] = []
    const adapter: ParagraphRangeGeometryAdapter = {
      measureText(_element, startOffset, endOffset) {
        probedOffsets.push(startOffset, endOffset)
        const top = startOffset < splitOffset ? 0 : 20
        return [{ width: 10, height: 20, top, bottom: top + 20 }]
      },
      measureTextRange: () => [
        { width: 20, height: 20, top: 0, bottom: 20 },
        { width: 30, height: 20, top: 20, bottom: 40 },
      ],
      measureAtomic: () => [],
      margins: () => ({ marginTop: 0, marginBottom: 0 }),
    }

    const result = measureParagraphLines(root, block, 0, shell, adapter)
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].end).toEqual({ inlineIndex: 0, textOffset: splitOffset })
    expect(result.lines[1].start).toEqual({ inlineIndex: 0, textOffset: splitOffset })
    expect(probedOffsets.every((offset) => boundaries.includes(offset))).toBe(true)
  })

  it('merges multiple full-range rects on one visual line', () => {
    const block: ParagraphBlock = {
      type: 'paragraph',
      id: 'segmented-range',
      content: [{ type: 'text', text: '甲乙丙丁' }],
    }
    const { root, shell } = measurementDom(block)
    const adapter: ParagraphRangeGeometryAdapter = {
      measureText(_element, startOffset) {
        const top = startOffset < 2 ? 0 : 20
        return [{ width: 10, height: 20, top, bottom: top + 20 }]
      },
      measureTextRange: () => [
        { width: 8, height: 20, top: 0, bottom: 20 },
        { width: 12, height: 18, top: 1, bottom: 19 },
        { width: 20, height: 20, top: 20, bottom: 40 },
      ],
      measureAtomic: () => [],
      margins: () => ({ marginTop: 0, marginBottom: 0 }),
    }

    const result = measureParagraphLines(root, block, 0, shell, adapter)
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0]).toMatchObject({
      top: 0,
      bottom: 20,
      start: { inlineIndex: 0 },
      end: { inlineIndex: 0, textOffset: 2 },
    })
  })

  it('falls back only the unstable line boundary to linear grapheme probes', () => {
    const block: ParagraphBlock = {
      type: 'paragraph',
      id: 'boundary-fallback',
      content: [{ type: 'text', text: '甲乙丙丁戊己庚辛' }],
    }
    const { root, shell } = measurementDom(block)
    const probedStarts: number[] = []
    const adapter: ParagraphRangeGeometryAdapter = {
      measureText(_element, startOffset) {
        probedStarts.push(startOffset)
        if (startOffset === 4 && probedStarts.length === 1) return []
        const top = startOffset < 4 ? 0 : 20
        return [{ width: 10, height: 20, top, bottom: top + 20 }]
      },
      measureTextRange: () => [
        { width: 40, height: 20, top: 0, bottom: 20 },
        { width: 40, height: 20, top: 20, bottom: 40 },
      ],
      measureAtomic: () => [],
      margins: () => ({ marginTop: 0, marginBottom: 0 }),
    }

    const result = measureParagraphLines(root, block, 0, shell, adapter)
    expect(result.lines.map((line) => line.end)).toEqual([
      { inlineIndex: 0, textOffset: 4 },
      { inlineIndex: 1 },
    ])
    expect(result.diagnostics).toEqual([])
    expect(probedStarts).toContain(1)
  })

  it('measures top-level and box-child paragraphs by source path', () => {
    const fixture: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '',
      metadata: {},
      content: [
        { type: 'paragraph', id: 'same', content: [{ type: 'text', text: '甲' }] },
        {
          type: 'box',
          id: 'box',
          templateId: 'method',
          breakBehavior: 'auto',
          children: [
            { type: 'paragraph', id: 'same', content: [{ type: 'text', text: '乙' }] },
          ],
        },
      ],
    }
    const root = document.createElement('div')
    root.innerHTML = renderToStaticMarkup(<TeachingDocumentRenderer document={fixture} />)
    const adapter: ParagraphRangeGeometryAdapter = {
      measureText: () => [{ width: 10, height: 20, top: 0, bottom: 20 }],
      measureAtomic: () => [],
      margins: () => ({ marginTop: 10, marginBottom: 10 }),
    }
    const result = measureTeachingDocumentParagraphs(root, fixture, adapter)
    expect(result.map((item) => item.sourcePath)).toEqual([
      { sourceIndex: 0, topLevelBlockId: 'same', childPath: [] },
      {
        sourceIndex: 1,
        topLevelBlockId: 'box',
        childPath: [{ childIndex: 0, blockId: 'same' }],
      },
    ])
    expect(result.every((item) => item.lines.length === 1)).toBe(true)
  })
})

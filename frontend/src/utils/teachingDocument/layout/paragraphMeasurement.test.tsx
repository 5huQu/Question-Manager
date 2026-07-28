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

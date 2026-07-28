import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { TeachingDocumentRenderer } from '@/components/teaching-document/TeachingDocumentRenderer'
import { measureTeachingDocument, TEACHING_DOM_SELECTORS, type GeometryAdapter } from '.'

const documentFixture: TeachingDocumentV1 = {
  version: 1,
  documentType: 'lecture',
  title: '测量测试',
  metadata: {},
  content: [
    { type: 'paragraph', id: 'top', content: [{ type: 'text', text: '正文' }] },
    { type: 'blockMath', id: 'math', latex: 'x^2+y^2=1' },
    {
      type: 'box',
      id: 'box',
      templateId: 'concept',
      breakBehavior: 'allow',
      children: [
        { type: 'paragraph', id: 'child', content: [{ type: 'text', text: '盒子子块' }] },
      ],
    },
  ],
}

function renderFixture(document = documentFixture) {
  const root = window.document.createElement('div')
  root.innerHTML = renderToStaticMarkup(<TeachingDocumentRenderer document={document} />)
  root.querySelectorAll<HTMLElement>(TEACHING_DOM_SELECTORS.block).forEach((element, index) => {
    element.dataset.testHeight = String([120, 80, 260, 60][index] ?? 40)
    element.dataset.testTop = String(index * 100)
  })
  const header = root.querySelector<HTMLElement>(TEACHING_DOM_SELECTORS.documentHeader)
  if (header) header.dataset.testHeight = '72'
  return root
}

const geometry: GeometryAdapter = {
  measure(element) {
    const height = Number(element.dataset.testHeight || 0)
    const top = Number(element.dataset.testTop || 0)
    return { width: 640, height, top, bottom: top + height }
  },
}

describe('measureTeachingDocument', () => {
  it('locates top-level blocks, nested box children, and KaTeX DOM', () => {
    const root = renderFixture()
    expect(root.querySelector('.katex')).not.toBeNull()
    const result = measureTeachingDocument(root, documentFixture, geometry)
    expect(result.blocks.map((block) => block.blockId)).toEqual(['top', 'math', 'box'])
    expect(result.blocks[2].splitPolicy).toBe('children')
    expect(result.blocks[2].childMeasurements.map((block) => block.blockId)).toEqual(['child'])
    expect(result.blocks[2].childMeasurements[0].parentBlockId).toBe('box')
    expect(result.headerHeight).toBe(72)
  })

  it('reports duplicate IDs and zero-height geometry', () => {
    const duplicate: TeachingDocumentV1 = {
      ...documentFixture,
      title: '',
      content: [
        { type: 'divider', id: 'same' },
        { type: 'spacer', id: 'same', heightEm: 1 },
      ],
    }
    const root = renderFixture(duplicate)
    root.querySelectorAll<HTMLElement>(TEACHING_DOM_SELECTORS.block).forEach((element) => {
      element.dataset.testHeight = '0'
    })
    const result = measureTeachingDocument(root, duplicate, geometry)
    expect(result.diagnostics.some((item) => item.code === 'duplicate-block-id')).toBe(true)
    expect(result.diagnostics.filter((item) => item.code === 'invalid-measurement')).toHaveLength(2)
  })

  it('keeps injected internal geometry independent from preview transforms', () => {
    const root = renderFixture()
    const before = measureTeachingDocument(root, documentFixture, geometry)
    root.style.transform = 'scale(0.5)'
    const after = measureTeachingDocument(root, documentFixture, geometry)
    expect(after.blocks.map((block) => block.height)).toEqual(before.blocks.map((block) => block.height))
    expect(after.measurementVersion).toBe(before.measurementVersion)
  })
})

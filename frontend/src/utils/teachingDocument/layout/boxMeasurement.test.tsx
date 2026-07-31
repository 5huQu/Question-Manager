import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { TeachingDocumentRenderer } from '@/components/teaching-document/TeachingDocumentRenderer'
import {
  measureTeachingDocument,
  measureTeachingDocumentBoxes,
  TEACHING_DOM,
  TEACHING_DOM_SELECTORS,
  type BoxChromeGeometryAdapter,
  type GeometryAdapter,
} from '.'

const fixture: TeachingDocumentV1 = {
  version: 1,
  documentType: 'lecture',
  title: '',
  metadata: {},
  content: [{
    type: 'box',
    id: 'box',
    templateId: 'method',
    breakBehavior: 'allow',
    children: [
      { type: 'paragraph', id: 'same', content: [{ type: 'text', text: '一' }] },
      { type: 'paragraph', id: 'same', content: [{ type: 'text', text: '二' }] },
    ],
  }],
}

function renderedRoot() {
  const root = document.createElement('div')
  root.innerHTML = renderToStaticMarkup(<TeachingDocumentRenderer document={fixture} />)
  root.querySelectorAll<HTMLElement>(TEACHING_DOM_SELECTORS.block).forEach((element) => {
    const childIndex = element.getAttribute(TEACHING_DOM.childIndex)
    element.dataset.height = childIndex === null ? '100' : childIndex === '0' ? '30' : '40'
  })
  return root
}

function setMeasuredHeight(element: HTMLElement | null, height: number) {
  if (!element) throw new Error('expected continuation probe')
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 0, height, top: 0, bottom: height, left: 0, right: 0, x: 0, y: 0, toJSON: () => ({}) }),
  })
}

const geometry: GeometryAdapter = {
  measure(element) {
    const height = Number(element.dataset.height || 0)
    return { width: 600, height, top: 0, bottom: height }
  },
}

const chromeGeometry: BoxChromeGeometryAdapter = {
  boxChrome: () => ({
    headerHeight: 12,
    marginTop: 10,
    marginBottom: 10,
    borderTop: 1,
    borderBottom: 1,
    bodyPaddingTop: 3,
    bodyPaddingBottom: 3,
  }),
}

describe('measureTeachingDocumentBoxes', () => {
  it('measures stable chrome and resolves duplicate child IDs by explicit child index', () => {
    const root = renderedRoot()
    setMeasuredHeight(root.querySelector(`[${TEACHING_DOM.boxContinuationHeaderProbe}]`), 11)
    setMeasuredHeight(root.querySelector(`[${TEACHING_DOM.boxContinuationLabelProbe}]`), 7)
    const documentMeasurement = measureTeachingDocument(root, fixture, geometry)
    const [box] = measureTeachingDocumentBoxes(
      root,
      fixture,
      documentMeasurement,
      chromeGeometry,
    )

    expect(box.fragmentChrome).toEqual({
      single: 40,
      start: 37,
      middle: 26,
      end: 29,
    })
    expect(box.children.map((child) => [child.childIndex, child.childBlockId, child.height]))
      .toEqual([[0, 'same', 30], [1, 'same', 40]])
    expect(box.children[1].sourcePath.childPath).toEqual([{ childIndex: 1, blockId: 'same' }])
    expect(box.diagnostics).toEqual([])
    expect(documentMeasurement.diagnostics.some((item) => item.code === 'duplicate-block-id')).toBe(true)
  })

  it('diagnoses a missing body instead of fabricating a splittable box', () => {
    const root = renderedRoot()
    root.querySelector(`[${TEACHING_DOM.boxBody}]`)?.remove()
    const documentMeasurement = measureTeachingDocument(root, fixture, geometry)
    const [box] = measureTeachingDocumentBoxes(
      root,
      fixture,
      documentMeasurement,
      chromeGeometry,
    )
    expect(box.diagnostics.some((item) => item.code === 'box-measurement-missing')).toBe(true)
  })
})

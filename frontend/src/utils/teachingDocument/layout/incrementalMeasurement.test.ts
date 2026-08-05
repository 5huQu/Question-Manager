import { describe, expect, it, vi } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { DEFAULT_A4_PAPER } from './paper'
import { measureTeachingDocumentAll } from './measureAll'
import { paginateTeachingDocument } from './paginate'
import {
  measureTeachingDocumentIncrementally,
  TeachingDocumentIncrementalMeasurementCache,
} from './incrementalMeasurement'
import { TEACHING_DOM } from './domContract'

function spacer(id: string, heightMm: number) {
  return { type: 'spacer' as const, id, heightMm, heightEm: heightMm / 4 }
}

function documentWith(content: TeachingDocumentV1['content']): TeachingDocumentV1 {
  return { version: 1, documentType: 'lecture', title: '', metadata: {}, content }
}

function renderRoot(document: TeachingDocumentV1) {
  const root = window.document.createElement('div')
  const header = window.document.createElement('div')
  header.setAttribute(TEACHING_DOM.documentHeader, '')
  root.appendChild(header)
  document.content.forEach((block, sourceIndex) => {
    if (block.type === 'pageBreak') return
    const element = window.document.createElement('div')
    element.setAttribute(TEACHING_DOM.block, '')
    element.setAttribute(TEACHING_DOM.blockId, block.id)
    element.setAttribute(TEACHING_DOM.blockType, block.type)
    element.setAttribute(TEACHING_DOM.sourceIndex, String(sourceIndex))
    element.setAttribute(TEACHING_DOM.splitPolicy, 'never')
    element.dataset.height = String(block.type === 'spacer' ? (block.heightMm ?? block.heightEm * 4) * 4 : 20)
    root.appendChild(element)
  })
  return root
}

const geometry = {
  measure: vi.fn((element: HTMLElement) => {
    const height = Number(element.dataset.height || 0)
    const sourceIndex = Number(element.getAttribute(TEACHING_DOM.sourceIndex) || 0)
    return { width: 600, height, top: sourceIndex * 100, bottom: sourceIndex * 100 + height }
  }),
}

function incremental(
  root: HTMLElement,
  document: TeachingDocumentV1,
  cache: TeachingDocumentIncrementalMeasurementCache,
  options: {
    layoutStyleSignature?: string
    resourceRevision?: string
    cacheable?: boolean
  } = {},
) {
  return measureTeachingDocumentIncrementally({
    root,
    document,
    cache,
    layoutStyleSignature: options.layoutStyleSignature ?? 'style',
    variant: 'source',
    resourceRevision: options.resourceRevision ?? 'resources',
    adapters: { geometry },
    cacheable: options.cacheable,
  })
}

function paginate(document: TeachingDocumentV1, bundle: ReturnType<typeof measureTeachingDocumentAll>) {
  return paginateTeachingDocument({
    document,
    measurements: bundle.measurement,
    paragraphMeasurements: bundle.paragraphs,
    boxMeasurements: bundle.boxes,
    questionMeasurements: bundle.questions,
    boxChildQuestionMeasurements: bundle.boxChildQuestions,
    boxChildRawMarkdownMeasurements: bundle.boxChildRawMarkdowns,
    paper: DEFAULT_A4_PAPER,
  })
}

describe('measureTeachingDocumentIncrementally', () => {
  it('re-measures only the changed top-level block and matches full pagination', () => {
    const cache = new TeachingDocumentIncrementalMeasurementCache()
    const before = documentWith([spacer('a', 20), spacer('b', 20), spacer('c', 20)])
    incremental(renderRoot(before), before, cache)
    geometry.measure.mockClear()

    const after = documentWith([before.content[0], spacer('b', 80), before.content[2]])
    const root = renderRoot(after)
    const result = incremental(root, after, cache)
    const measuredBlockIds = geometry.measure.mock.calls
      .map(([element]) => element.getAttribute(TEACHING_DOM.blockId))
      .filter(Boolean)
    expect(result.measuredSourceIndexes).toEqual([1])
    expect(result.cacheHitBlockCount).toBe(2)
    expect(measuredBlockIds).toEqual(['b'])

    const full = measureTeachingDocumentAll(root, after, { geometry })
    expect(paginate(after, result.bundle)).toEqual(paginate(after, full))
  })

  it('inserts a page break without measuring any content block', () => {
    const cache = new TeachingDocumentIncrementalMeasurementCache()
    const before = documentWith([spacer('a', 20), spacer('b', 20)])
    incremental(renderRoot(before), before, cache)
    geometry.measure.mockClear()

    const after = documentWith([before.content[0], { type: 'pageBreak', id: 'break' }, before.content[1]])
    const root = renderRoot(after)
    const result = incremental(root, after, cache)
    const measuredBlockIds = geometry.measure.mock.calls
      .map(([element]) => element.getAttribute(TEACHING_DOM.blockId))
      .filter(Boolean)
    expect(result.measuredBlockCount).toBe(0)
    expect(measuredBlockIds).toEqual([])

    const full = measureTeachingDocumentAll(root, after, { geometry })
    expect(paginate(after, result.bundle)).toEqual(paginate(after, full))
  })

  it('invalidates all blocks after global style or resource changes', () => {
    const cache = new TeachingDocumentIncrementalMeasurementCache()
    const source = documentWith([spacer('a', 20), spacer('b', 20)])
    const root = renderRoot(source)
    incremental(root, source, cache)
    geometry.measure.mockClear()

    const styleResult = incremental(root, source, cache, { layoutStyleSignature: 'style-2' })
    expect(styleResult.measuredSourceIndexes).toEqual([0, 1])
    expect(geometry.measure).toHaveBeenCalledTimes(3)
    geometry.measure.mockClear()

    const resourceResult = incremental(root, source, cache, {
      layoutStyleSignature: 'style-2',
      resourceRevision: 'resources-2',
    })
    expect(resourceResult.measuredSourceIndexes).toEqual([0, 1])
    expect(geometry.measure).toHaveBeenCalledTimes(3)
  })

  it('does not retain measurements produced before readiness is stable', () => {
    const cache = new TeachingDocumentIncrementalMeasurementCache()
    const source = documentWith([spacer('a', 20), spacer('b', 20)])
    const root = renderRoot(source)
    const unstable = incremental(root, source, cache, { cacheable: false })
    expect(unstable.measuredBlockCount).toBe(2)
    geometry.measure.mockClear()

    const stable = incremental(root, source, cache)
    expect(stable.measuredSourceIndexes).toEqual([0, 1])
    expect(geometry.measure).toHaveBeenCalledTimes(3)
  })
})

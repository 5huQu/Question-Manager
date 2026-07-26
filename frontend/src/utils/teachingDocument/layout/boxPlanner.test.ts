import { describe, expect, it } from 'vitest'
import type { BoxBlock, BoxChildBlock, ParagraphBlock } from '@/types/teachingDocument'
import type { BoxMeasurement } from './boxMeasurement'
import { blockSourcePathKey } from './fragment'
import type { ParagraphMeasurement } from './paragraphMeasurement'
import { planBoxFragments } from './boxPlanner'

function paragraph(id: string, text = '甲乙丙丁戊己'): ParagraphBlock {
  return { type: 'paragraph', id, content: [{ type: 'text', text }] }
}

function box(children: BoxChildBlock[], breakBehavior: BoxBlock['breakBehavior'] = 'allow'): BoxBlock {
  return {
    type: 'box',
    id: 'box-1',
    templateId: 'method',
    breakBehavior,
    children,
  }
}

function measurement(block: BoxBlock, heights: number[]): BoxMeasurement {
  const fragmentChrome = { single: 25, start: 20, middle: 10, end: 15 }
  return {
    blockId: block.id,
    sourceIndex: 0,
    totalHeight: heights.reduce((sum, height) => sum + height, fragmentChrome.single),
    headerHeight: 8,
    bodyPaddingTop: 1,
    bodyPaddingBottom: 1,
    fragmentChrome,
    diagnostics: [],
    measurementVersion: 'box-v1',
    children: block.children.map((child, childIndex) => ({
      childBlockId: child.id,
      childIndex,
      blockType: child.type,
      height: heights[childIndex],
      splitPolicy: child.type === 'paragraph' ? 'paragraph' : 'never',
      sourcePath: {
        sourceIndex: 0,
        topLevelBlockId: block.id,
        childPath: [{ childIndex, blockId: child.id }],
      },
    })),
  }
}

function paragraphMeasurement(block: ParagraphBlock, childIndex: number): ParagraphMeasurement {
  const sourcePath = {
    sourceIndex: 0,
    topLevelBlockId: 'box-1',
    childPath: [{ childIndex, blockId: block.id }],
  }
  return {
    blockId: block.id,
    sourceIndex: 0,
    sourcePath,
    marginTop: 0,
    marginBottom: 0,
    diagnostics: [],
    measurementVersion: `${block.id}-lines`,
    lines: Array.from({ length: 6 }, (_, index) => ({
      lineIndex: index,
      top: index * 20,
      bottom: (index + 1) * 20,
      height: 20,
      start: index === 0 ? { inlineIndex: 0 } : { inlineIndex: 0, textOffset: index },
      end: index === 5 ? { inlineIndex: 1 } : { inlineIndex: 0, textOffset: index + 1 },
    })),
  }
}

describe('planBoxFragments', () => {
  it('keeps child order and source paths while packing whole children', () => {
    const block = box([paragraph('a'), paragraph('b'), paragraph('c')])
    const plan = planBoxFragments({
      block,
      sourceIndex: 0,
      measurement: measurement(block, [30, 30, 30]),
      paragraphMeasurements: new Map(),
      firstPageAvailableHeight: 70,
      pageContentHeight: 100,
    })

    expect(plan.fragments).toHaveLength(2)
    expect(plan.fragments.map((fragment) => fragment.continuation)).toEqual(['start', 'end'])
    expect(plan.fragments.flatMap((fragment) => fragment.childItems).map((item) => item.childBlockId))
      .toEqual(['a', 'b', 'c'])
    expect(plan.fragments[0].childItems[0].sourcePath.childPath[0]).toEqual({
      childIndex: 0,
      blockId: 'a',
    })
  })

  it('reuses paragraph line fragments inside a box without copying the child block', () => {
    const child = paragraph('long-child')
    const block = box([child])
    const boxMeasurement = measurement(block, [120])
    const childMeasurement = paragraphMeasurement(child, 0)
    const plan = planBoxFragments({
      block,
      sourceIndex: 0,
      measurement: boxMeasurement,
      paragraphMeasurements: new Map([
        [blockSourcePathKey(childMeasurement.sourcePath), childMeasurement],
      ]),
      firstPageAvailableHeight: 80,
      pageContentHeight: 80,
    })

    expect(plan.fragments).toHaveLength(3)
    const childItems = plan.fragments.flatMap((fragment) => fragment.childItems)
    expect(childItems.every((item) => item.kind === 'paragraph-child-fragment')).toBe(true)
    expect(childItems.map((item) => item.childBlockId)).toEqual([
      'long-child',
      'long-child',
      'long-child',
    ])
    if (childItems.every((item) => item.kind === 'paragraph-child-fragment')) {
      expect(childItems[0].range.end).toEqual(childItems[1].range.start)
      expect(childItems[1].range.end).toEqual(childItems[2].range.start)
      expect(childItems[0].continuation).toBe('start')
      expect(childItems[2].continuation).toBe('end')
    }
  })

  it('preserves unknown children as whole runtime references and diagnoses oversize', () => {
    const unknown: BoxChildBlock = {
      type: 'unknown',
      id: 'unknown-child',
      originalType: 'futureWidget',
      rawData: { type: 'futureWidget', secret: { preserved: true } },
    }
    const block = box([unknown])
    const plan = planBoxFragments({
      block,
      sourceIndex: 0,
      measurement: measurement(block, [120]),
      paragraphMeasurements: new Map(),
      firstPageAvailableHeight: 80,
      pageContentHeight: 80,
    })

    expect(plan.fragments[0].childItems[0]).toMatchObject({
      kind: 'whole-child',
      childBlockId: 'unknown-child',
      childIndex: 0,
    })
    expect(plan.diagnostics.some((item) => item.code === 'box-child-overflow')).toBe(true)
  })
})

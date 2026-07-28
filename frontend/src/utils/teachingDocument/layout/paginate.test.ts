import { describe, expect, it } from 'vitest'
import type { QuestionItem } from '@/types'
import type { BoxBlock, ParagraphBlock, QuestionBlock, TeachingBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import {
  A4_MARGIN_PRESETS,
  DEFAULT_A4_PAPER,
  paginateTeachingDocument,
  type BlockMeasurement,
  type BoxMeasurement,
  type ParagraphMeasurement,
  type QuestionMeasurement,
  type TeachingDocumentMeasurement,
} from '.'
import { createQuestionRuntimeModel } from './questionRegions'

function paragraph(id: string): ParagraphBlock {
  return { type: 'paragraph', id, content: [{ type: 'text', text: id }] }
}

function documentWith(content: TeachingBlock[]): TeachingDocumentV1 {
  return { version: 1, documentType: 'lecture', title: '', metadata: {}, content }
}

function measurement(blockId: string, height: number, patch: Partial<BlockMeasurement> = {}): BlockMeasurement {
  return {
    blockId,
    blockType: 'paragraph',
    width: 600,
    height,
    top: 0,
    bottom: height,
    splitPolicy: 'paragraph',
    depth: 0,
    childMeasurements: [],
    ...patch,
  }
}

function measurements(blocks: BlockMeasurement[], headerHeight = 0): TeachingDocumentMeasurement {
  return { blocks, headerHeight, diagnostics: [], measurementVersion: 'fixture-v1' }
}

function paragraphLines(blockId: string, sourceIndex: number, count: number, lineHeight = 20): ParagraphMeasurement {
  return {
    blockId,
    sourceIndex,
    sourcePath: { sourceIndex, topLevelBlockId: blockId, childPath: [] },
    marginTop: 10,
    marginBottom: 10,
    diagnostics: [],
    measurementVersion: `${blockId}-lines`,
    lines: Array.from({ length: count }, (_, index) => ({
      lineIndex: index,
      top: index * lineHeight,
      bottom: (index + 1) * lineHeight,
      height: lineHeight,
      start: index === 0 ? { inlineIndex: 0 } : { inlineIndex: 0, textOffset: index },
      end: index + 1 === count ? { inlineIndex: 1 } : { inlineIndex: 0, textOffset: index + 1 },
    })),
  }
}

function boxMeasurement(block: BoxBlock, sourceIndex: number, childHeights: number[]): BoxMeasurement {
  return {
    blockId: block.id,
    sourceIndex,
    totalHeight: childHeights.reduce((sum, height) => sum + height, 25),
    headerHeight: 8,
    bodyPaddingTop: 1,
    bodyPaddingBottom: 1,
    fragmentChrome: { single: 25, start: 20, middle: 10, end: 15 },
    diagnostics: [],
    measurementVersion: `${block.id}-box`,
    children: block.children.map((child, childIndex) => ({
      childBlockId: child.id,
      childIndex,
      blockType: child.type,
      height: childHeights[childIndex],
      splitPolicy: child.type === 'paragraph' ? 'paragraph' : 'never',
      sourcePath: {
        sourceIndex,
        topLevelBlockId: block.id,
        childPath: [{ childIndex, blockId: child.id }],
      },
    })),
  }
}

function longQuestionMeasurement(
  block: QuestionBlock,
  sourceIndex: number,
): QuestionMeasurement {
  const question: QuestionItem = {
    id: block.questionId,
    serialNo: null,
    questionNo: '',
    stage: '高中',
    questionType: '解答题',
    difficultyScore: 3,
    difficultyScore10: 6,
    difficultyLabel: '中等',
    chapter: '',
    knowledgePoints: [],
    solutionMethods: [],
    sourceTitle: '',
    bankStatus: 'ready',
    stemMarkdown: '甲'.repeat(60),
    answerText: '',
    analysisMarkdown: '',
    totalScore: 10,
    scoringRubric: [],
    sliceImagePath: '',
    figures: [],
    sourceRunId: '',
    updatedAt: '',
    hasFigures: false,
  }
  const model = createQuestionRuntimeModel(block, question)
  return {
    blockId: block.id,
    questionId: block.questionId,
    sourceIndex,
    totalHeight: 1220,
    headingHeight: 0,
    fragmentChrome: { single: 20, start: 10, middle: 0, end: 10 },
    model,
    regions: model.regions.map((region) => ({
      key: region.key,
      type: region.type,
      index: region.index,
      splitPolicy: region.splitPolicy,
      height: 1200,
      top: 0,
      bottom: 1200,
      paragraphMeasurement: region.kind === 'paragraph'
        ? paragraphLines(region.paragraph.id, sourceIndex, 60)
        : undefined,
    })),
    diagnostics: [],
    measurementVersion: 'long-question-v1',
  }
}

describe('paginateTeachingDocument', () => {
  it('returns one deterministic empty page for an empty document', () => {
    const input = { document: documentWith([]), measurements: measurements([]), paper: DEFAULT_A4_PAPER }
    expect(paginateTeachingDocument(input).pages).toHaveLength(1)
    expect(paginateTeachingDocument(input)).toEqual(paginateTeachingDocument(input))
  })

  it('keeps a single-page document together at the exact page boundary', () => {
    const blocks = [paragraph('a'), paragraph('b')]
    const result = paginateTeachingDocument({
      document: documentWith(blocks),
      measurements: measurements([measurement('a', 400), measurement('b', 586)]),
      paper: DEFAULT_A4_PAPER,
    })
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0].items.map((item) => item.blockId)).toEqual(['a', 'b'])
  })

  it('moves an indivisible block to the next page', () => {
    const result = paginateTeachingDocument({
      document: documentWith([paragraph('a'), { type: 'blockMath', id: 'math', latex: 'x' }]),
      measurements: measurements([
        measurement('a', 700),
        measurement('math', 400, { blockType: 'blockMath', splitPolicy: 'never' }),
      ]),
      paper: DEFAULT_A4_PAPER,
    })
    expect(result.pages.map((page) => page.items.map((item) => item.blockId))).toEqual([['a'], ['math']])
  })

  it('reserves a spanning document header in both columns of the first sheet', () => {
    const blocks = [paragraph('left'), paragraph('right')]
    const result = paginateTeachingDocument({
      document: documentWith(blocks),
      measurements: measurements([
        measurement('left', 850, { splitPolicy: 'never' }),
        measurement('right', 850, { splitPolicy: 'never' }),
      ], 100),
      paper: DEFAULT_A4_PAPER,
      documentHeaderSpanColumns: 2,
    })
    expect(result.pages).toHaveLength(2)
    expect(result.pages[0].usedHeight).toBe(950)
    expect(result.pages[1].usedHeight).toBe(950)
    expect(result.pages[0].showDocumentHeader).toBe(true)
    expect(result.pages[1].showDocumentHeader).toBe(false)
  })

  it('defines consecutive and trailing page breaks as explicit empty pages', () => {
    const content: TeachingBlock[] = [
      paragraph('a'),
      { type: 'pageBreak', id: 'break-1' },
      { type: 'pageBreak', id: 'break-2' },
      paragraph('b'),
      { type: 'pageBreak', id: 'break-3' },
    ]
    const result = paginateTeachingDocument({
      document: documentWith(content),
      measurements: measurements([measurement('a', 100), measurement('b', 100)]),
      paper: DEFAULT_A4_PAPER,
    })
    expect(result.pages.map((page) => page.items.map((item) => item.blockId))).toEqual([['a'], [], ['b'], []])
  })

  it('honors avoid and force-before as whole-block semantics', () => {
    const box: TeachingBlock = {
      type: 'box',
      id: 'avoid-box',
      templateId: 'concept',
      breakBehavior: 'avoid',
      children: [],
    }
    const forced: TeachingBlock = {
      type: 'box',
      id: 'forced-box',
      templateId: 'concept',
      breakBehavior: 'force-before',
      children: [],
    }
    const result = paginateTeachingDocument({
      document: documentWith([paragraph('a'), box, forced]),
      measurements: measurements([
        measurement('a', 700),
        measurement('avoid-box', 400, { blockType: 'box', splitPolicy: 'never', breakBehavior: 'avoid' }),
        measurement('forced-box', 100, { blockType: 'box', splitPolicy: 'children', breakBehavior: 'force-before' }),
      ]),
      paper: DEFAULT_A4_PAPER,
    })
    expect(result.pages.map((page) => page.items.map((item) => item.blockId))).toEqual([['a'], ['avoid-box'], ['forced-box']])
  })

  it('does not split an oversized avoid box and reports the violated constraint', () => {
    const block: BoxBlock = {
      type: 'box',
      id: 'avoid-oversized',
      templateId: 'warning',
      breakBehavior: 'avoid',
      children: [paragraph('avoid-child')],
    }
    const result = paginateTeachingDocument({
      document: documentWith([block]),
      measurements: measurements([
        measurement(block.id, 1200, {
          blockType: 'box',
          splitPolicy: 'never',
          breakBehavior: 'avoid',
          sourceIndex: 0,
        }),
      ]),
      boxMeasurements: [boxMeasurement(block, 0, [1175])],
      paper: DEFAULT_A4_PAPER,
    })
    expect(result.pages[0].items[0]).toMatchObject({ kind: 'whole', blockId: block.id })
    expect(result.diagnostics.some((item) => item.code === 'box-overflow')).toBe(true)
  })

  it('lets auto and allow use safe box fragments on the current page', () => {
    const makeBox = (id: string, breakBehavior: 'allow' | 'auto'): BoxBlock => ({
      type: 'box',
      id,
      templateId: 'method',
      breakBehavior,
      children: [paragraph(`${id}-a`), paragraph(`${id}-b`)],
    })
    const allow = makeBox('allow-box', 'allow')
    const auto = makeBox('auto-box', 'auto')
    const run = (block: BoxBlock) => paginateTeachingDocument({
      document: documentWith([paragraph('before'), block]),
      measurements: measurements([
        measurement('before', 300),
        measurement(block.id, 1225, {
          blockType: 'box',
          splitPolicy: 'children',
          breakBehavior: block.breakBehavior,
          sourceIndex: 1,
        }),
      ]),
      boxMeasurements: [boxMeasurement(block, 1, [600, 600])],
      paper: DEFAULT_A4_PAPER,
    })

    const allowResult = run(allow)
    expect(allowResult.pages[0].items.map((item) => item.blockId)).toEqual(['before', 'allow-box'])
    expect(allowResult.pages[0].items[1]).toMatchObject({
      kind: 'fragment',
      fragmentType: 'box',
      continuation: 'start',
    })

    const autoResult = run(auto)
    expect(autoResult.pages[0].items.map((item) => item.blockId)).toEqual(['before', 'auto-box'])
    expect(autoResult.pages[0].items[1]).toMatchObject({
      kind: 'fragment',
      fragmentType: 'box',
      continuation: 'start',
    })
  })

  it('keeps an auto box whole on the next page when it fits there', () => {
    const block: BoxBlock = {
      type: 'box',
      id: 'auto-whole',
      templateId: 'method',
      breakBehavior: 'auto',
      children: [paragraph('child')],
    }
    const result = paginateTeachingDocument({
      document: documentWith([paragraph('before'), block]),
      measurements: measurements([
        measurement('before', 300),
        measurement(block.id, 800, {
          blockType: 'box',
          splitPolicy: 'children',
          breakBehavior: 'auto',
          sourceIndex: 1,
        }),
      ]),
      boxMeasurements: [boxMeasurement(block, 1, [775])],
      paper: DEFAULT_A4_PAPER,
    })
    expect(result.pages.map((page) => page.items.map((item) => item.kind))).toEqual([
      ['whole'],
      ['whole'],
    ])
  })

  it('reports oversized splittable blocks without pretending to split them', () => {
    const result = paginateTeachingDocument({
      document: documentWith([paragraph('huge')]),
      measurements: measurements([measurement('huge', 1200)]),
      paper: DEFAULT_A4_PAPER,
    })
    expect(result.pages[0].overflow).toBe(true)
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'block-overflow',
      'page-overflow',
      'unsupported-split',
    ]))
  })

  it('splits a measured long paragraph without unsupported-split or lost ranges', () => {
    const block: TeachingBlock = {
      type: 'paragraph',
      id: 'long',
      content: [{ type: 'text', text: '甲'.repeat(60) }],
    }
    const result = paginateTeachingDocument({
      document: documentWith([block]),
      measurements: measurements([measurement('long', 1220)]),
      paragraphMeasurements: [paragraphLines('long', 0, 60)],
      paper: DEFAULT_A4_PAPER,
    })
    const fragments = result.pages
      .flatMap((page) => page.items)
      .filter((item) => item.kind === 'fragment' && item.fragmentType === 'paragraph')
    expect(result.pages).toHaveLength(2)
    expect(fragments).toHaveLength(2)
    expect(fragments[0].range.start).toEqual({ inlineIndex: 0 })
    expect(fragments[0].range.end).toEqual(fragments[1].range.start)
    expect(fragments[1].range.end).toEqual({ inlineIndex: 1 })
    expect(result.diagnostics.some((item) => item.code === 'unsupported-split')).toBe(false)
  })

  it('splits a measured long question into deterministic source-backed fragments', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'long-question-block',
      questionId: 'long-question',
    }
    const input = {
      document: documentWith([block]),
      measurements: measurements([
        measurement(block.id, 1220, {
          blockType: 'question',
          splitPolicy: 'children',
          sourceIndex: 0,
        }),
      ]),
      questionMeasurements: [longQuestionMeasurement(block, 0)],
      paper: DEFAULT_A4_PAPER,
    }
    const result = paginateTeachingDocument(input)
    const fragments = result.pages.flatMap((page) => page.items).filter(
      (item) => item.kind === 'fragment' && item.fragmentType === 'question',
    )
    expect(fragments).toHaveLength(2)
    expect(fragments.map((fragment) => fragment.continuation)).toEqual(['start', 'end'])
    expect(fragments[0].regionItems[0].regionType).toBe('stem')
    expect(fragments[1].regionItems.some((region) => region.regionType === 'heading')).toBe(false)
    expect(result.diagnostics.some((item) => item.code === 'unsupported-split')).toBe(false)
    expect(paginateTeachingDocument(input)).toEqual(result)
  })

  it('splits a question that fits a fresh page instead of leaving the current page mostly blank', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'fresh-page-question',
      questionId: 'fresh-page-question',
    }
    const result = paginateTeachingDocument({
      document: documentWith([paragraph('before'), block]),
      measurements: measurements([
        measurement('before', 300),
        measurement(block.id, 1220, {
          blockType: 'question',
          splitPolicy: 'children',
          sourceIndex: 1,
        }),
      ]),
      questionMeasurements: [longQuestionMeasurement(block, 1)],
      paper: DEFAULT_A4_PAPER,
      metrics: {
        pageWidthPx: 800,
        pageHeightPx: 1400,
        contentWidthPx: 700,
        contentHeightPx: 1300,
      },
    })
    expect(result.pages.flatMap((page) => page.items).some((item) => item.kind === 'fragment' && item.blockId === block.id)).toBe(true)
  })

  it('keeps an avoid question whole and moves it to a fresh page', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'keep-question',
      questionId: 'keep-question',
      breakBehavior: 'avoid',
    }
    const result = paginateTeachingDocument({
      document: documentWith([paragraph('before'), block]),
      measurements: measurements([
        measurement('before', 700),
        measurement(block.id, 500, { blockType: 'question', splitPolicy: 'children', sourceIndex: 1 }),
      ]),
      questionMeasurements: [longQuestionMeasurement(block, 1)],
      paper: DEFAULT_A4_PAPER,
      metrics: { pageWidthPx: 800, pageHeightPx: 1400, contentWidthPx: 700, contentHeightPx: 1000 },
    })
    expect(result.pages.map((page) => page.items.map((item) => [item.kind, item.blockId]))).toEqual([
      [['whole', 'before']],
      [['whole', block.id]],
    ])
  })

  it('starts a force-before question on a fresh page even when it fits', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'forced-question',
      questionId: 'forced-question',
      breakBehavior: 'force-before',
    }
    const result = paginateTeachingDocument({
      document: documentWith([paragraph('before'), block]),
      measurements: measurements([
        measurement('before', 100),
        measurement(block.id, 200, { blockType: 'question', splitPolicy: 'children', sourceIndex: 1 }),
      ]),
      paper: DEFAULT_A4_PAPER,
      metrics: { pageWidthPx: 800, pageHeightPx: 1400, contentWidthPx: 700, contentHeightPx: 1000 },
    })
    expect(result.pages.map((page) => page.items.map((item) => item.blockId))).toEqual([
      ['before'],
      [block.id],
    ])
  })

  it('falls back to the whole question when an internal region measurement is missing', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'unsafe-question-block',
      questionId: 'unsafe-question',
    }
    const questionMeasurement = longQuestionMeasurement(block, 0)
    questionMeasurement.regions = questionMeasurement.regions.slice(0, 0)
    const result = paginateTeachingDocument({
      document: documentWith([block]),
      measurements: measurements([
        measurement(block.id, 1220, {
          blockType: 'question',
          splitPolicy: 'children',
          sourceIndex: 0,
        }),
      ]),
      questionMeasurements: [questionMeasurement],
      paper: DEFAULT_A4_PAPER,
    })
    expect(result.pages[0].items[0]).toMatchObject({ kind: 'whole', blockId: block.id })
    expect(result.diagnostics.some((item) => item.code === 'question-fragment-invalid'))
      .toBe(true)
  })

  it('keeps manual page breaks around paragraph fragments', () => {
    const long = {
      type: 'paragraph' as const,
      id: 'long',
      content: [{ type: 'text' as const, text: '甲'.repeat(60) }],
    }
    const content: TeachingBlock[] = [
      paragraph('before'),
      { type: 'pageBreak', id: 'manual' },
      long,
      { type: 'pageBreak', id: 'after' },
      paragraph('tail'),
    ]
    const result = paginateTeachingDocument({
      document: documentWith(content),
      measurements: measurements([
        measurement('before', 50),
        measurement('long', 1220),
        measurement('tail', 50),
      ]),
      paragraphMeasurements: [paragraphLines('long', 2, 60)],
      paper: DEFAULT_A4_PAPER,
    })
    expect(result.pages.map((page) => page.items.map((item) => item.blockId))).toEqual([
      ['before'],
      ['long'],
      ['long'],
      ['tail'],
    ])
  })

  it('preserves blocks with missing measurements and reports them', () => {
    const result = paginateTeachingDocument({
      document: documentWith([paragraph('missing')]),
      measurements: measurements([]),
      paper: DEFAULT_A4_PAPER,
    })
    expect(result.pages[0].items[0].blockId).toBe('missing')
    expect(result.diagnostics.some((item) => item.code === 'measurement-missing' && item.blockId === 'missing')).toBe(true)
  })

  it('does not silently merge duplicate IDs', () => {
    const result = paginateTeachingDocument({
      document: documentWith([paragraph('duplicate'), paragraph('duplicate')]),
      measurements: measurements([measurement('duplicate', 600), measurement('duplicate', 600)]),
      paper: DEFAULT_A4_PAPER,
    })
    expect(result.pages).toHaveLength(2)
    expect(result.diagnostics.some((item) => item.code === 'duplicate-block-id')).toBe(true)
  })

  it('uses the configured margins to change available page height', () => {
    const document = documentWith([paragraph('a'), paragraph('b')])
    const measured = measurements([measurement('a', 500), measurement('b', 500)])
    expect(paginateTeachingDocument({ document, measurements: measured, paper: A4_MARGIN_PRESETS.compact }).pages).toHaveLength(1)
    expect(paginateTeachingDocument({ document, measurements: measured, paper: A4_MARGIN_PRESETS.relaxed }).pages).toHaveLength(2)
  })

  it('rejects an invalid paper spec with a stable diagnostic', () => {
    const result = paginateTeachingDocument({
      document: documentWith([paragraph('a')]),
      measurements: measurements([measurement('a', 10)]),
      paper: { ...DEFAULT_A4_PAPER, marginTopMm: 200, marginBottomMm: 200 },
    })
    expect(result.diagnostics.some((item) => item.code === 'invalid-paper-spec')).toBe(true)
    expect(result.pages).toHaveLength(1)
  })
})

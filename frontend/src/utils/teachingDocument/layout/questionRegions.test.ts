import { describe, expect, it } from 'vitest'
import type { QuestionFigure, QuestionItem } from '@/types'
import type { QuestionBlock } from '@/types/teachingDocument'
import { createQuestionRuntimeModel, type QuestionFigureRegion, type QuestionAnswerSpaceRegion } from './questionRegions'

function question(patch: Partial<QuestionItem> = {}): QuestionItem {
  return {
    id: 'question-1',
    serialNo: null,
    questionNo: '8',
    stage: '高中',
    questionType: '单选题',
    difficultyScore: 3,
    difficultyScore10: 6,
    difficultyLabel: '中等',
    chapter: '',
    knowledgePoints: [],
    solutionMethods: [],
    sourceTitle: '',
    bankStatus: 'ready',
    stemMarkdown: '题干含 $x^2$。\n\nA. 一\nB. 二\nC. 三\nD. 四',
    answerText: 'A',
    analysisMarkdown: '第一段解析。\n\n$$x^2=1$$\n\n第二段解析。',
    totalScore: 5,
    scoringRubric: [],
    sliceImagePath: '',
    figures: [],
    sourceRunId: '',
    updatedAt: '',
    hasFigures: false,
    ...patch,
  }
}

describe('createQuestionRuntimeModel', () => {
  it('creates deterministic semantic regions in display order', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'question-1',
      display: { displayNumber: '练8', showAnswer: true, showAnalysis: true },
    }
    const first = createQuestionRuntimeModel(block, question())
    const second = createQuestionRuntimeModel(block, question())

    expect(first).toEqual(second)
    expect(first.displayNumber).toBe('练8')
    expect(first.regions.map((region) => `${region.type}:${region.kind}`)).toEqual([
      'stem:paragraph',
      'options:options-row',
      'answer:answer',
      'analysis:label',
      'analysis:paragraph',
      'analysis:math',
      'analysis:paragraph',
    ])
    const optionRow = first.regions.find((region) => region.kind === 'options-row')
    expect(optionRow).toMatchObject({
      optionStart: 0,
      optionEnd: 4,
      rowIndex: 0,
      layout: 'quad',
    })
  })

  it('omits answer and analysis regions when display flags are disabled', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'question-1',
      display: { showAnswer: false, showAnalysis: false },
    }
    const model = createQuestionRuntimeModel(block, question())
    expect(model.regions.some((region) => region.type === 'answer')).toBe(false)
    expect(model.regions.some((region) => region.type === 'analysis')).toBe(false)
  })

  it('uses the measured layout override for formula-heavy choices', () => {
    const block: QuestionBlock = { type: 'question', id: 'question-block', questionId: 'question-1' }
    const model = createQuestionRuntimeModel(block, question({
      stemMarkdown: '选择正确结论。\n\nA. $x^2+y^2=1$\nB. $x^2+y^2=4$\nC. $x^2+y^2=9$\nD. $x^2+y^2=16$',
    }), { choiceLayoutOverrides: { 'question-block': 'double' } })
    expect(model.regions.filter((region) => region.kind === 'options-row')).toHaveLength(2)
    expect(model.regions.filter((region) => region.kind === 'options-row').map((region) => [region.optionStart, region.optionEnd]))
      .toEqual([[0, 2], [2, 4]])
  })

  it('normalizes alternate inline math delimiters before passing options to the document editor', () => {
    const block: QuestionBlock = { type: 'question', id: 'question-block', questionId: 'question-1' }
    const model = createQuestionRuntimeModel(block, question({
      stemMarkdown: '选择正确结论。\n\nA. \\(\\frac{3}{5}\\mathrm{i}\\)\nB. \\(-\\frac{4}{5}\\mathrm{i}\\)\nC. \\(\\frac{3}{5}\\)\nD. \\(-\\frac{4}{5}\\)',
    }))
    const optionRegion = model.regions.find((region) => region.kind === 'options-row')

    expect(optionRegion && optionRegion.kind === 'options-row' ? optionRegion.inlineContent?.A : undefined)
      .toEqual([{ type: 'inlineMath', latex: '\\frac{3}{5}\\mathrm{i}' }])
  })

  it('uses the persisted per-question choice layout', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'question-1',
      display: { choiceLayout: 'two' },
    }
    const model = createQuestionRuntimeModel(block, question())
    expect(model.regions.filter((region) => region.kind === 'options-row')).toHaveLength(2)
    expect(model.regions.filter((region) => region.kind === 'options-row').map((region) => region.layout))
      .toEqual(['double', 'double'])
  })

  it('uses document-local inline content for question text and options', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'question-1',
      display: {
        showAnswer: true,
        inlineContent: {
          'question-block:question:stem:0': [{ type: 'text', text: '局部题干', color: '#2563eb', fontSize: 18 }],
          'question-block:question:options:0:option:A': [{ type: 'text', text: '局部选项 A', marks: ['bold'] }],
          'question-block:question:answer:0': [{ type: 'text', text: '局部答案' }],
        },
      },
    }
    const model = createQuestionRuntimeModel(block, question({ stemMarkdown: '原题干。\n\nA. 原选项 A\nB. 原选项 B\nC. 原选项 C\nD. 原选项 D' }))
    const stemContent = (model.regions.find((region) => region.key === 'question-block:question:stem:0') as Extract<typeof model.regions[number], { kind: 'paragraph' }>).paragraph.content
    expect(stemContent).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: '局部题干', color: '#2563eb', fontSize: 18 }),
    ]))
    expect(model.regions.find((region) => region.kind === 'options-row')).toMatchObject({
      inlineContent: { A: [{ type: 'text', text: '局部选项 A', marks: ['bold'] }] },
    })
    expect(model.regions.find((region) => region.kind === 'answer')).toMatchObject({
      inlineContent: [{ type: 'text', text: '局部答案' }],
    })
  })

  it('keeps generated question numbers out of persisted inline content', () => {
    const prefix = { type: 'text' as const, text: '8. ', marks: ['bold' as const] }
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'question-1',
      display: {
        displayNumber: '8',
        inlineContent: {
          'question-block:question:stem:0': [
            { type: 'text', text: '8. 8. 8. ', marks: ['bold'] },
            { type: 'text', text: '局部题干' },
          ],
        },
      },
    }
    const model = createQuestionRuntimeModel(block, question({ stemMarkdown: '原题干。' }))
    const stem = model.regions.find((region) => region.kind === 'paragraph')
    expect(stem && 'paragraph' in stem ? stem.paragraph.content : []).toEqual([
      prefix,
      { type: 'text', text: '局部题干' },
    ])
    expect(stem && 'generatedQuestionNumber' in stem ? stem.generatedQuestionNumber : undefined).toEqual([prefix])
  })

  it('keeps complex markdown whole instead of cutting its source string', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'question-1',
    }
    const model = createQuestionRuntimeModel(block, question({
      stemMarkdown: '**粗体题干**\n\n*斜体* 与 [安全链接](https://example.com)\n\n- 第一项\n- 第二项',
      questionType: '解答题',
    }))
    expect(model.regions.filter((region) => region.type === 'stem').map((region) => region.kind))
      .toEqual(['markdown', 'markdown', 'markdown'])
  })

  it('keeps an unresolved figure marker as an explicit runtime region', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'question-1',
    }
    const model = createQuestionRuntimeModel(block, question({
      stemMarkdown: '图像如下。\n\n<!-- DOC2X_FIGURE:missing-figure -->',
      questionType: '解答题',
    }))
    expect(model.regions.find((region) => region.kind === 'figure')).toMatchObject({
      type: 'figure',
      figures: [],
      missingFigureId: 'missing-figure',
    })
  })

  it('applies figureOverrides to stem figure regions', () => {
    const figures: QuestionFigure[] = [
      { id: 'fig-1', blockId: 'block-1', path: '/assets/fig1.png', usage: 'stem' },
    ]
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'question-1',
      display: {
        figureOverrides: {
          'fig-1': { widthMm: 80, alignment: 'center', textWrap: 'square-left', wrapGapMm: 4 },
        },
      },
    }
    const model = createQuestionRuntimeModel(block, question({
      stemMarkdown: '题干。\n\n<!-- DOC2X_FIGURE:fig-1 -->',
      questionType: '解答题',
      figures,
      hasFigures: true,
    }))
    const figureRegion = model.regions.find((region) => region.kind === 'figure') as QuestionFigureRegion
    expect(figureRegion).toBeDefined()
    expect(figureRegion.widthOverrideMm).toBe(80)
    expect(figureRegion.alignmentOverride).toBe('center')
    expect(figureRegion.textWrap).toBe('square-left')
    expect(figureRegion.wrapGapMm).toBe(4)
  })

  it('anchors a side-wrapped figure at the start of its own stem flow', () => {
    const figures: QuestionFigure[] = [
      { id: 'fig-wrap', blockId: 'block-wrap', path: '/assets/fig-wrap.png', usage: 'stem' },
    ]
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'question-1',
      display: { figureOverrides: { 'fig-wrap': { textWrap: 'square-left', wrapGapMm: 4 } } },
    }
    const model = createQuestionRuntimeModel(block, question({
      stemMarkdown: '图片前的题干。\n\n<!-- DOC2X_FIGURE:fig-wrap -->\n\n图片后的题干。',
      questionType: '解答题', figures, hasFigures: true,
    }))

    expect(model.regions.slice(0, 3).map((region) => region.kind)).toEqual(['figure', 'paragraph', 'paragraph'])
  })

  it('groups up to four consecutive stem figures and preserves their order', () => {
    const figures: QuestionFigure[] = [
      { id: 'fig-1', blockId: 'block-1', path: '/assets/fig1.png', usage: 'stem', width: 120, height: 80 },
      { id: 'fig-2', blockId: 'block-2', path: '/assets/fig2.png', usage: 'stem', width: 80, height: 120 },
      { id: 'fig-3', blockId: 'block-3', path: '/assets/fig3.png', usage: 'stem', width: 100, height: 100 },
    ]
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'question-1',
      display: { figureOverrides: { 'fig-1': { groupWithNext: true, groupColumns: 3, widthMm: 60, groupMatchHeight: true, groupHeightMm: 50 }, 'fig-2': { widthMm: 90 } } },
    }
    const model = createQuestionRuntimeModel(block, question({
      stemMarkdown: '题干。\n\n<!-- DOC2X_FIGURE:fig-1 -->\n<!-- DOC2X_FIGURE:fig-2 -->\n<!-- DOC2X_FIGURE:fig-3 -->',
      questionType: '解答题',
      figures,
      hasFigures: true,
    }))
    const figureRegions = model.regions.filter((region) => region.kind === 'figure') as QuestionFigureRegion[]
    expect(figureRegions).toHaveLength(1)
    expect(figureRegions[0]).toMatchObject({
      figureKey: 'fig-1',
      groupFigureKeys: ['fig-1', 'fig-2', 'fig-3'],
      groupFigureWidthOverrides: { 'fig-1': 60, 'fig-2': 90 },
      groupMatchHeight: true,
      groupHeightMm: 50,
      widthOverrideMm: 60,
    })
    expect(figureRegions[0].figures.map((figure) => figure.id)).toEqual(['fig-1', 'fig-2', 'fig-3'])
  })

  it('does not modify regions when figureOverrides is absent', () => {
    const figures: QuestionFigure[] = [
      { id: 'fig-1', blockId: 'block-1', path: '/assets/fig1.png', usage: 'stem' },
    ]
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'question-1',
    }
    const model = createQuestionRuntimeModel(block, question({
      stemMarkdown: '题干。\n\n<!-- DOC2X_FIGURE:fig-1 -->',
      questionType: '解答题',
      figures,
      hasFigures: true,
    }))
    const figureRegion = model.regions.find((region) => region.kind === 'figure') as QuestionFigureRegion
    expect(figureRegion).toBeDefined()
    expect(figureRegion.widthOverrideMm).toBeUndefined()
    expect(figureRegion.alignmentOverride).toBeUndefined()
  })

  it('allows different overrides for same question in different blocks', () => {
    const figures: QuestionFigure[] = [
      { id: 'fig-1', path: '/assets/fig1.png', usage: 'stem' },
    ]
    const questionItem = question({
      stemMarkdown: '题干。\n\n<!-- DOC2X_FIGURE:fig-1 -->',
      questionType: '解答题',
      figures,
      hasFigures: true,
    })
    const block1: QuestionBlock = {
      type: 'question',
      id: 'block-1',
      questionId: 'question-1',
      display: { figureOverrides: { 'fig-1': { widthMm: 60 } } },
    }
    const block2: QuestionBlock = {
      type: 'question',
      id: 'block-2',
      questionId: 'question-1',
      display: { figureOverrides: { 'fig-1': { widthMm: 120 } } },
    }
    const model1 = createQuestionRuntimeModel(block1, questionItem)
    const model2 = createQuestionRuntimeModel(block2, questionItem)
    const region1 = model1.regions.find((region) => region.kind === 'figure') as QuestionFigureRegion
    const region2 = model2.regions.find((region) => region.kind === 'figure') as QuestionFigureRegion
    expect(region1.widthOverrideMm).toBe(60)
    expect(region2.widthOverrideMm).toBe(120)
  })

  it('applies figureOverrides to analysis figure regions', () => {
    const figures: QuestionFigure[] = [
      { id: 'analysis-fig', path: '/assets/analysis.png', usage: 'analysis' },
    ]
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'question-1',
      display: {
        showAnalysis: true,
        figureOverrides: { 'analysis-fig': { widthMm: 100, alignment: 'right' } },
      },
    }
    const model = createQuestionRuntimeModel(block, question({
      stemMarkdown: '题干。',
      analysisMarkdown: '解析。\n\n<!-- DOC2X_FIGURE:analysis-fig -->',
      questionType: '解答题',
      figures,
      hasFigures: true,
    }))
    const figureRegion = model.regions.find(
      (region) => region.kind === 'figure' && region.owner === 'analysis',
    ) as QuestionFigureRegion
    expect(figureRegion).toBeDefined()
    expect(figureRegion.widthOverrideMm).toBe(100)
    expect(figureRegion.alignmentOverride).toBe('right')
  })

  it('keeps answer figures out of the stem and analysis regions', () => {
    const figures: QuestionFigure[] = [
      { id: 'stem-fig', path: '/assets/stem.png', usage: 'stem' },
      { id: 'answer-fig', path: '/assets/answer.png', usage: 'answer' },
      { id: 'analysis-fig', path: '/assets/analysis.png', usage: 'analysis' },
    ]
    const model = createQuestionRuntimeModel({
      type: 'question', id: 'question-block', questionId: 'question-1', display: { showAnswer: true, showAnalysis: true },
    }, question({
      stemMarkdown: '题干。\n\n<!-- DOC2X_FIGURE:stem-fig -->',
      answerText: '答案。<!-- DOC2X_FIGURE:answer-fig -->',
      analysisMarkdown: '解析。\n\n<!-- DOC2X_FIGURE:analysis-fig -->',
      figures,
    }))
    const answerRegion = model.regions.find((region) => region.kind === 'answer')
    expect(answerRegion?.kind === 'answer' && answerRegion.figures.map((figure) => figure.id)).toEqual(['answer-fig'])
    expect((model.regions.filter((region) => region.kind === 'figure') as QuestionFigureRegion[])
      .flatMap((region) => region.figures.map((figure) => figure.id))).toEqual(['stem-fig', 'analysis-fig'])
  })

  it('applies figureOverrides using blockId when id is absent', () => {
    const figures: QuestionFigure[] = [
      { blockId: 'block-fig-id', path: '/assets/fig.png', usage: 'stem' },
    ]
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'question-1',
      display: {
        figureOverrides: { 'block-fig-id': { widthMm: 70 } },
      },
    }
    const model = createQuestionRuntimeModel(block, question({
      stemMarkdown: '题干。\n\n<!-- DOC2X_FIGURE:block-fig-id -->',
      questionType: '解答题',
      figures,
      hasFigures: true,
    }))
    const figureRegion = model.regions.find((region) => region.kind === 'figure') as QuestionFigureRegion
    expect(figureRegion.widthOverrideMm).toBe(70)
  })

  it('adds answer-space region when answerSpace is configured', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'question-1',
      display: {
        answerSpace: { heightMm: 50, style: 'lines' },
      },
    }
    const model = createQuestionRuntimeModel(block, question())
    const spaceRegion = model.regions.find((region) => region.kind === 'answer-space') as QuestionAnswerSpaceRegion
    expect(spaceRegion).toBeDefined()
    expect(spaceRegion.heightMm).toBe(50)
    expect(spaceRegion.pattern).toBe('lines')
  })

  it('does not add answer-space region when answerSpace is absent', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'question-1',
    }
    const model = createQuestionRuntimeModel(block, question())
    expect(model.regions.some((region) => region.kind === 'answer-space')).toBe(false)
  })

  it('figureOverrides does not modify question_bank_items (pure frontend)', () => {
    const figures: QuestionFigure[] = [
      { id: 'fig-1', path: '/assets/fig1.png', usage: 'stem' },
    ]
    const questionItem = question({
      stemMarkdown: '题干。\n\n<!-- DOC2X_FIGURE:fig-1 -->',
      questionType: '解答题',
      figures,
      hasFigures: true,
    })
    const originalFigures = JSON.parse(JSON.stringify(questionItem.figures))
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'question-1',
      display: { figureOverrides: { 'fig-1': { widthMm: 80 } } },
    }
    createQuestionRuntimeModel(block, questionItem)
    expect(questionItem.figures).toEqual(originalFigures)
  })
})

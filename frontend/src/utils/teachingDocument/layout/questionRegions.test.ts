import { describe, expect, it } from 'vitest'
import type { QuestionItem } from '@/types'
import type { QuestionBlock } from '@/types/teachingDocument'
import { createQuestionRuntimeModel } from './questionRegions'

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
      'heading:heading',
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
})

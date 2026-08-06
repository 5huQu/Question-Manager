import { describe, expect, it } from 'vitest'
import type { QuestionFigure, QuestionItem } from '@/types'
import type { QuestionBlock } from '@/types/teachingDocument'
import type { QuestionMeasurement } from './questionMeasurement'
import type { ParagraphMeasurement } from './paragraphMeasurement'
import { planQuestionFragments } from './questionPlanner'
import { createQuestionRuntimeModel } from './questionRegions'

function question(stemMarkdown: string, patch: Partial<QuestionItem> = {}): QuestionItem {
  return {
    id: 'q1',
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
    stemMarkdown,
    answerText: '',
    analysisMarkdown: '',
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

function paragraphLines(
  blockId: string,
  count: number,
  lineHeight = 20,
): ParagraphMeasurement {
  return {
    blockId,
    sourceIndex: 0,
    sourcePath: { sourceIndex: 0, topLevelBlockId: 'question-block', childPath: [] },
    marginTop: 0,
    marginBottom: 0,
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

function measurement(
  block: QuestionBlock,
  item: QuestionItem,
  heights: Record<string, number>,
  paragraphLineCount = 0,
): QuestionMeasurement {
  const model = createQuestionRuntimeModel(block, item)
  const regions = model.regions.map((region) => ({
    key: region.key,
    type: region.type,
    index: region.index,
    splitPolicy: region.splitPolicy,
    height: heights[region.kind] ?? 20,
    top: 0,
    bottom: heights[region.kind] ?? 20,
    ...(region.kind === 'options-row'
      ? {
          optionStart: region.optionStart,
          optionEnd: region.optionEnd,
          rowIndex: region.rowIndex,
        }
      : {}),
    ...(region.kind === 'paragraph' && paragraphLineCount
      ? { paragraphMeasurement: paragraphLines(region.paragraph.id, paragraphLineCount) }
      : {}),
  }))
  return {
    blockId: block.id,
    questionId: block.questionId,
    sourceIndex: 0,
    totalHeight: regions.reduce((sum, region) => sum + region.height, 0),
    headingHeight: regions[0]?.height || 0,
    fragmentChrome: { single: 0, start: 0, middle: 0, end: 0 },
    model,
    regions,
    diagnostics: [],
    measurementVersion: 'question-v1',
  }
}

describe('planQuestionFragments', () => {
  it('splits the stem paragraph continuously across pages', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'q1',
    }
    const item = question('甲乙丙丁戊己')
    const measured = measurement(block, item, { paragraph: 120 }, 6)
    const plan = planQuestionFragments({
      block,
      measurement: measured,
      firstPageAvailableHeight: 20,
      pageContentHeight: 80,
    })

    expect(plan.fragments).toHaveLength(2)
    expect(plan.fragments[0].pageOffset).toBe(1)
    expect(plan.fragments.map((fragment) => fragment.continuation)).toEqual(['start', 'end'])
    expect(plan.fragments[0].regionItems[0].regionType).toBe('stem')
    const paragraphItems = plan.fragments
      .flatMap((fragment) => fragment.regionItems)
      .filter((region) => region.kind === 'question-paragraph-fragment')
    expect(paragraphItems).toHaveLength(2)
    expect(paragraphItems[0].range.end).toEqual(paragraphItems[1].range.start)
  })

  it('splits choices into indivisible visual rows', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'q1',
    }
    const item = question([
      '选择正确结论。',
      '',
      'A. 这是一个非常长的第一项，必须使用单栏布局',
      'B. 这是一个非常长的第二项，必须使用单栏布局',
      'C. 这是一个非常长的第三项，必须使用单栏布局',
      'D. 这是一个非常长的第四项，必须使用单栏布局',
    ].join('\n'), { questionType: '单选题' })
    const measured = measurement(block, item, {
      heading: 10,
      paragraph: 20,
      'options-row': 30,
    }, 1)
    const plan = planQuestionFragments({
      block,
      measurement: measured,
      firstPageAvailableHeight: 100,
      pageContentHeight: 100,
    })
    const options = plan.fragments
      .flatMap((fragment) => fragment.regionItems)
      .filter((region): region is Extract<typeof region, { kind: 'whole-question-region' }> => (
        region.kind === 'whole-question-region' && region.regionType === 'options'
      ))
    expect(options.map((region) => [region.optionStart, region.optionEnd]))
      .toEqual([[0, 2], [2, 4]])
    expect(planQuestionFragments({
      block,
      measurement: measured,
      firstPageAvailableHeight: 100,
      pageContentHeight: 100,
    })).toEqual(plan)
  })

  it('moves the whole options region to the next page when it does not fit', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'q1',
    }
    const longOption = '这是一个超过双栏阈值的完整长选项，选项字母与正文不可分离，并且需要按视觉行分页。'
    const item = question([
      '选择正确结论。',
      '',
      `A. ${longOption}甲`,
      `B. ${longOption}乙`,
      `C. ${longOption}丙`,
      `D. ${longOption}丁`,
    ].join('\n'), { questionType: '单选题' })
    const measured = measurement(block, item, {
      heading: 10,
      paragraph: 20,
      'options-row': 30,
    }, 1)
    const plan = planQuestionFragments({
      block,
      measurement: measured,
      firstPageAvailableHeight: 55,
      pageContentHeight: 100,
    })
    const optionsPerFragment = plan.fragments.map((fragment) => (
      fragment.regionItems
        .filter((region): region is Extract<typeof region, { kind: 'whole-question-region' }> => (
          region.kind === 'whole-question-region' && region.regionType === 'options'
        ))
        .reduce((total, region) => total + (region.optionEnd! - region.optionStart!), 0)
    )).filter(Boolean)
    expect(optionsPerFragment).toEqual([2, 2])
  })

  it('folds a figure trailing margin when the figure is the last region at a page boundary', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'q1',
    }
    const item = question('题干\n\n<!-- DOC2X_FIGURE:fig-1 -->', {
      figures: [{ id: 'fig-1', path: 'figure.png', usage: 'stem' } as QuestionFigure],
    })
    const measured = measurement(block, item, { paragraph: 20, figure: 40 }, 1)
    const figureRegion = measured.regions.find((region) => region.type === 'figure')
    expect(figureRegion).toBeTruthy()
    figureRegion!.trailingSpacing = 8

    const plan = planQuestionFragments({
      block,
      measurement: measured,
      firstPageAvailableHeight: 52,
      pageContentHeight: 100,
    })

    expect(plan.fragments).toHaveLength(1)
    expect(plan.fragments[0].regionItems.at(-1)).toMatchObject({
      regionType: 'figure',
      height: 32,
      trimTrailingSpacing: true,
    })
  })

  it('diagnoses an indivisible oversized answer without dropping it', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'q1',
      display: { showAnswer: true },
    }
    const item = question('短题干', { answerText: '很长答案' })
    const measured = measurement(block, item, {
      heading: 10,
      paragraph: 20,
      answer: 140,
    }, 1)
    const plan = planQuestionFragments({
      block,
      measurement: measured,
      firstPageAvailableHeight: 80,
      pageContentHeight: 80,
    })
    expect(plan.fragments.flatMap((fragment) => fragment.regionItems)
      .some((region) => region.regionType === 'answer')).toBe(true)
    expect(plan.diagnostics.some((diagnostic) => diagnostic.code === 'question-answer-overflow')).toBe(true)
  })

  it('clips answer space at the current page boundary without continuing it', () => {
    const block: QuestionBlock = {
      type: 'question',
      id: 'question-block',
      questionId: 'q1',
      display: { answerSpace: { heightMm: 100, style: 'blank', splitAcrossPages: true } },
    }
    const item = question('短题干')
    const measured = measurement(block, item, {
      heading: 10,
      paragraph: 20,
      'answer-space': 120,
    }, 1)
    const plan = planQuestionFragments({
      block,
      measurement: measured,
      firstPageAvailableHeight: 80,
      pageContentHeight: 80,
    })
    const spaces = plan.fragments.flatMap((fragment) => fragment.regionItems)
      .filter((region) => region.kind === 'whole-question-region' && region.answerSpaceSegment)
    expect(spaces).toHaveLength(1)
    expect(spaces[0].height).toBe(60)
    expect(plan.fragments).toHaveLength(1)
  })
})

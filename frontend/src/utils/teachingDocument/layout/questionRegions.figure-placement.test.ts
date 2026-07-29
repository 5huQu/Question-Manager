import { describe, expect, it } from 'vitest'
import type { QuestionItem, QuestionFigure } from '@/types'
import type { QuestionBlock } from '@/types/teachingDocument'
import { createQuestionRuntimeModel } from './questionRegions'

const figure = (id: string): QuestionFigure => ({ id, blockId: id, path: `/assets/${id}.png`, usage: 'stem' })
const item = (figures: QuestionFigure[]): QuestionItem => ({
  id: 'q1', serialNo: null, questionNo: '1', stage: '', questionType: '解答题', difficultyScore: 0, difficultyScore10: 0, difficultyLabel: '', chapter: '', knowledgePoints: [], solutionMethods: [], sourceTitle: '', bankStatus: 'ready',
  stemMarkdown: '题干\n\n<!-- DOC2X_FIGURE:a -->\n\n选项内容', answerText: '答案', analysisMarkdown: '解析', totalScore: 1, scoringRubric: [], sliceImagePath: '', figures, sourceRunId: '', updatedAt: '', hasFigures: true,
})

describe('question figure placement runtime', () => {
  it('moves legacy figures into semantic slots and preserves stable keys', () => {
    const block: QuestionBlock = { type: 'question', id: 'qb', questionId: 'q1', display: { figureOverrides: { a: { slot: 'before-options' } } } }
    const model = createQuestionRuntimeModel(block, item([figure('a')]))
    const region = model.regions.find((value) => value.kind === 'figure')
    expect(region?.key).toBe('qb:question:figure:a')
    expect(model.regions.findIndex((value) => value.kind === 'figure')).toBeGreaterThan(model.regions.findIndex((value) => value.type === 'stem'))
  })

  it('renders inserted figures only when their slot is visible', () => {
    const block: QuestionBlock = {
      type: 'question', id: 'qb', questionId: 'q1',
      display: {
        showAnalysis: false,
        insertedFigures: [{ id: 'new-1', asset: { type: 'documentAsset', assetId: 'asset-1' }, slot: 'analysis-end', order: 1 }],
      },
    }
    const hidden = createQuestionRuntimeModel(block, item([]))
    expect(hidden.regions.some((value) => value.key.includes('inserted-figure'))).toBe(false)
    const shown = createQuestionRuntimeModel({ ...block, display: { ...block.display, showAnalysis: true } }, item([]))
    expect(shown.regions.some((value) => value.key === 'qb:question:inserted-figure:new-1')).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import type { QuestionItem } from '@/types'
import { reflowQuestionAfterTypeChange } from './questionTypeReflow'

function question(id: string, type: string, score: number): QuestionItem {
  return {
    id, contentRevision: 1, serialNo: null, questionNo: id, stage: '', questionType: type,
    difficultyScore: 0, difficultyScore10: 0, difficultyLabel: '', chapter: '', knowledgePoints: [], solutionMethods: [],
    sourceTitle: '', bankStatus: 'ready', stemMarkdown: '', answerText: '', analysisMarkdown: '', totalScore: score,
    scoringRubric: [], sliceImagePath: '', figures: [], sourceRunId: '', updatedAt: '', hasFigures: false,
  }
}

describe('reflowQuestionAfterTypeChange', () => {
  it('moves a changed question to the target type section and refreshes headings', () => {
    const questionBlock = (id: string, score: number) => ({ type: 'question' as const, id: `block-${id}`, questionId: id, display: { scoreOverride: score } })
    const document = {
      version: 1 as const, documentType: 'exam' as const, title: '试卷', metadata: {}, content: [
        { type: 'heading' as const, id: 'h1', level: 3 as const, content: [{ type: 'text' as const, text: '一、单选题（共 1 题，共 5 分）' }] },
        questionBlock('q1', 5),
        { type: 'heading' as const, id: 'h2', level: 3 as const, content: [{ type: 'text' as const, text: '二、解答题（共 1 题，共 15 分）' }] },
        questionBlock('q2', 15),
        { type: 'heading' as const, id: 'h3', level: 3 as const, content: [{ type: 'text' as const, text: '三、多选题（共 1 题，共 6 分）' }] },
        questionBlock('q3', 6),
      ],
    }
    const map = {
      q1: question('q1', '单选题', 5),
      q2: question('q2', '多选题', 15),
      q3: question('q3', '多选题', 6),
    }
    const next = reflowQuestionAfterTypeChange(document, map, 'q2', '解答题', '多选题')
    expect(next.content.filter((block) => block.type === 'question').map((block) => block.questionId)).toEqual(['q1', 'q3', 'q2'])
    expect(next.content.filter((block) => block.type === 'heading').map((block) => block.content[0])).toEqual([
      { type: 'text', text: '一、单选题（共 1 题，共 5 分）' },
      { type: 'text', text: '二、多选题（共 2 题，共 21 分）' },
    ])
  })

  it('leaves non-exam documents unchanged', () => {
    const document = { version: 1 as const, documentType: 'lecture' as const, title: '讲义', metadata: {}, content: [] }
    expect(reflowQuestionAfterTypeChange(document, {}, 'q1', '单选题', '多选题')).toBe(document)
  })
})

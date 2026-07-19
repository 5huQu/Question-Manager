import { describe, expect, it } from 'vitest'
import { buildManualQuestionPayload, type Draft } from './QuestionCreatePage'

function draft(patch: Partial<Draft> = {}): Draft {
  return {
    questionNo: '1',
    stage: '高三',
    questionType: '单选题',
    sourceTitle: '',
    problemText: '若 $x=1$，求值。\n\nA. 1\nB. 2\nC. 3\nD. 4',
    answerText: 'A',
    analysisText: '代入即可。',
    ...patch,
  }
}

describe('buildManualQuestionPayload', () => {
  it('keeps Markdown as source of truth and emits structured choice blocks', () => {
    const payload = buildManualQuestionPayload(draft())

    expect(payload.sourceTitle).toBe('手动创建')
    expect(payload.stemMarkdown).toContain('A. 1')
    expect(payload.problemBlocks).toHaveLength(2)
    expect(payload.problemBlocks[0]).toMatchObject({ type: 'paragraph' })
    expect(payload.problemBlocks[1]).toMatchObject({
      type: 'choices',
      options: [
        { label: 'A' },
        { label: 'B' },
        { label: 'C' },
        { label: 'D' },
      ],
    })
    expect(payload.answerBlocks).toHaveLength(1)
    expect(payload.analysisBlocks).toHaveLength(1)
  })

  it('does not turn choice-looking lines into choice blocks for a solution question', () => {
    const payload = buildManualQuestionPayload(draft({ questionType: '解答题' }))

    expect(payload.problemBlocks.some((block) => block.type === 'choices')).toBe(false)
    expect(JSON.stringify(payload.problemBlocks)).toContain('A. 1')
  })
})

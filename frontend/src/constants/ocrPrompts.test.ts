import { describe, expect, it } from 'vitest'
import { buildFullPaperOcrPrompt, singleQuestionOcrPrompt } from './ocrPrompts'

const requiredFields = [
  'question_no',
  'question_type',
  'problem_text',
  'answer',
  'analysis',
  'knowledge_points',
  'solution_methods',
  'difficulty_score_10',
  'difficulty_label',
  'total_score',
  'scoring_rubric',
  'needs_human_review',
]

describe('question-bank AI transcription prompts', () => {
  it('uses the importable question-bank fields for a single question', () => {
    for (const field of requiredFields) expect(singleQuestionOcrPrompt).toContain(`"${field}"`)
    expect(singleQuestionOcrPrompt).toContain('0–8 个')
    expect(singleQuestionOcrPrompt).toContain('0–10 的整数')
  })

  it('uses the same item schema for a full paper and keeps the output limit', () => {
    const prompt = buildFullPaperOcrPrompt()
    expect(prompt).toContain('"questions"')
    for (const field of requiredFields) expect(prompt).toContain(`"${field}"`)
    expect(prompt).toContain('每次最多输出 10 题')
  })
})

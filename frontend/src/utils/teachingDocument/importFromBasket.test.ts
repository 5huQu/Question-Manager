import { describe, expect, it } from 'vitest'
import type { HeadingBlock, QuestionBlock } from '@/types/teachingDocument'
import { buildExamDocumentFromQuestions, groupExamEntriesByType, type ExamImportEntry } from './importFromBasket'

function entry(questionId: string, questionType: string, score: number): ExamImportEntry {
  return { questionId, questionType, score }
}

describe('groupExamEntriesByType', () => {
  it('按固定题型顺序分组，组内保持传入顺序', () => {
    const groups = groupExamEntriesByType([
      entry('q1', '解答题', 15),
      entry('q2', '单选题', 5),
      entry('q3', '单选题', 5),
      entry('q4', '填空题', 5),
    ])
    expect(groups.map(([type]) => type)).toEqual(['单选题', '填空题', '解答题'])
    expect(groups[0][1].map((item) => item.questionId)).toEqual(['q2', 'q3'])
  })

  it('未知题型按首次出现顺序排在已知题型之后，空题型归入未分类', () => {
    const groups = groupExamEntriesByType([
      entry('q1', '判断题', 2),
      entry('q2', '单选题', 5),
      entry('q3', '', 5),
      entry('q4', '操作题', 10),
    ])
    expect(groups.map(([type]) => type)).toEqual(['单选题', '判断题', '未分类', '操作题'])
  })
})

describe('buildExamDocumentFromQuestions', () => {
  it('生成试卷型文档：大题标题 + 连续题号 + 分值覆盖', () => {
    const doc = buildExamDocumentFromQuestions([
      entry('q1', '单选题', 5),
      entry('q2', '单选题', 5),
      entry('q3', '解答题', 15),
    ], '函数与导数测试卷')

    expect(doc.documentType).toBe('exam')
    expect(doc.version).toBe(1)
    expect(doc.title).toBe('函数与导数测试卷')
    expect(doc.content).toHaveLength(5)

    const [section1, q1, q2, section2, q3] = doc.content
    expect((section1 as HeadingBlock).content[0]).toEqual({ type: 'text', text: '一、单选题（共 2 题，共 10 分）' })
    expect((section2 as HeadingBlock).content[0]).toEqual({ type: 'text', text: '二、解答题（共 1 题，共 15 分）' })

    expect((q1 as QuestionBlock).questionId).toBe('q1')
  expect((q1 as QuestionBlock).display).toEqual({ showAnswer: false, showAnalysis: false, scoreOverride: 5 })
  expect((q2 as QuestionBlock).display?.displayNumber).toBeUndefined()
  expect((q3 as QuestionBlock).display?.displayNumber).toBeUndefined()
    expect((q3 as QuestionBlock).display?.scoreOverride).toBe(15)
  })

  it('每个块都有唯一 id', () => {
    const doc = buildExamDocumentFromQuestions([
      entry('q1', '单选题', 5),
      entry('q2', '单选题', 5),
    ], '试卷')
    const ids = doc.content.map((block) => block.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.length > 0)).toBe(true)
  })

  it('空列表生成空文档', () => {
    const doc = buildExamDocumentFromQuestions([], '空卷')
    expect(doc.content).toEqual([])
    expect(doc.title).toBe('空卷')
  })

  it('错题集模式不生成大题标题，仅按顺序排列题目块', () => {
    const doc = buildExamDocumentFromQuestions([
      entry('q1', '单选题', 5),
      entry('q2', '单选题', 5),
      entry('q3', '解答题', 15),
    ], '期中错题集', 'wrong-question-collection')

    expect(doc.documentType).toBe('wrong-question-collection')
    expect(doc.content).toHaveLength(3)
    expect(doc.content.every((block) => block.type === 'question')).toBe(true)
    expect((doc.content[0] as QuestionBlock).questionId).toBe('q1')
    expect((doc.content[1] as QuestionBlock).questionId).toBe('q2')
    expect((doc.content[2] as QuestionBlock).display?.scoreOverride).toBe(15)
  })
})

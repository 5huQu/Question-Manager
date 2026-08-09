import { describe, expect, it } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { documentForPrintVariant } from './printVariant'

describe('documentForPrintVariant', () => {
  it('uses document-order numbers instead of source question-bank numbers', () => {
    const document: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '测试文档',
      metadata: {},
      content: [
        { type: 'question', id: 'block-1', questionId: 'q-1' },
        { type: 'question', id: 'block-2', questionId: 'q-2', display: { displayNumber: '例 1' } },
        { type: 'question', id: 'block-3', questionId: 'q-3' },
      ],
    }

    const printed = documentForPrintVariant(document, 'student')
    const questions = printed.content.filter((block) => block.type === 'question')

    expect(questions.map((block) => block.display?.displayNumber)).toEqual(['1', '例 1', '3'])
    expect(questions.map((block) => block.display?.displayNumberAuto)).toEqual([true, undefined, true])
  })

  it('keeps the source immutable and reuses each source/variant projection', () => {
    const document: TeachingDocumentV1 = {
      version: 1,
      documentType: 'worksheet',
      title: '',
      metadata: {},
      content: [{ type: 'question', id: 'q', questionId: 'question' }],
    }
    const before = structuredClone(document)
    const student = documentForPrintVariant(document, 'student')
    const teacher = documentForPrintVariant(document, 'teacher')

    expect(document).toEqual(before)
    expect(documentForPrintVariant(document, 'student')).toBe(student)
    expect(documentForPrintVariant(document, 'teacher')).toBe(teacher)
    expect(student).not.toBe(teacher)
  })

  it('removes answer space from the teacher projection while retaining it for students', () => {
    const document: TeachingDocumentV1 = {
      version: 1,
      documentType: 'worksheet',
      title: '',
      metadata: {},
      content: [{
        type: 'question', id: 'q', questionId: 'question',
        display: { answerSpace: { heightMm: 24, style: 'lines' } },
      }],
    }
    const student = documentForPrintVariant(document, 'student').content[0]
    const teacher = documentForPrintVariant(document, 'teacher').content[0]
    expect(student.type === 'question' && student.display?.answerSpace).toEqual({ heightMm: 24, style: 'lines' })
    expect(teacher.type === 'question' && teacher.display?.answerSpace).toBeUndefined()
  })
})

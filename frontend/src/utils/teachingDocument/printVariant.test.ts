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
})

import { describe, expect, it } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { questionOnlyDocument, showsDocumentTitle } from './wrongQuestionCollection'

function documentOfType(documentType: TeachingDocumentV1['documentType'], content: TeachingDocumentV1['content']): TeachingDocumentV1 {
  return { version: 1, documentType, title: '测试文档', metadata: {}, content }
}

describe('showsDocumentTitle', () => {
  it('hides the document title for wrong-question-collection documents', () => {
    expect(showsDocumentTitle({ documentType: 'wrong-question-collection', title: '错题集' })).toBe(false)
    expect(showsDocumentTitle({ documentType: 'exam', title: '试卷' })).toBe(true)
  })

  it('returns false when the document has no title', () => {
    expect(showsDocumentTitle({ documentType: 'exam', title: '' })).toBe(false)
  })
})

describe('questionOnlyDocument', () => {
  it('keeps only question blocks and question children inside cards for wrong-question-collection', () => {
    const source = documentOfType('wrong-question-collection', [
      { type: 'heading', id: 'h-1', level: 1, content: [{ type: 'text', text: '第一章' }] },
      { type: 'paragraph', id: 'p-1', content: [{ type: 'text', text: '说明文字' }] },
      { type: 'question', id: 'q-1', questionId: 'bank-1' },
      {
        type: 'box', id: 'box-1', templateId: 'knowledge', breakBehavior: 'auto',
        children: [
          { type: 'paragraph', id: 'box-p', content: [{ type: 'text', text: '卡片正文' }] },
          { type: 'question', id: 'q-2', questionId: 'bank-2' },
        ],
      },
      { type: 'pageBreak', id: 'pb-1' },
    ])

    const filtered = questionOnlyDocument(source)

    expect(filtered.content.map((block) => block.type)).toEqual(['question', 'box'])
    const box = filtered.content[1]
    expect(box.type === 'box' && box.children.map((child) => child.type)).toEqual(['question'])
  })

  it('drops empty cards and keeps the source immutable', () => {
    const source = documentOfType('wrong-question-collection', [
      { type: 'heading', id: 'h-1', level: 1, content: [{ type: 'text', text: '第一章' }] },
      {
        type: 'box', id: 'box-1', templateId: 'knowledge', breakBehavior: 'auto',
        children: [{ type: 'paragraph', id: 'box-p', content: [{ type: 'text', text: '无题目卡片' }] }],
      },
      { type: 'question', id: 'q-1', questionId: 'bank-1' },
    ])
    const before = structuredClone(source)

    const filtered = questionOnlyDocument(source)

    expect(filtered.content.map((block) => block.type)).toEqual(['question'])
    expect(source).toEqual(before)
  })

  it('returns the source unchanged for other document types', () => {
    const source = documentOfType('exam', [
      { type: 'heading', id: 'h-1', level: 1, content: [{ type: 'text', text: '第一章' }] },
      { type: 'question', id: 'q-1', questionId: 'bank-1' },
    ])

    expect(questionOnlyDocument(source)).toBe(source)
  })
})

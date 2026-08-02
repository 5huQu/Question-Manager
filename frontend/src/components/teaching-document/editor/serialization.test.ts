import { describe, expect, it } from 'vitest'
import type { TeachingBlock } from '@/types/teachingDocument'
import { blockToEditorNode, editorNodeToBlock } from './serialization'

describe('teaching document editor serialization', () => {
  it('round-trips constrained text layout, font size, and box appearance', () => {
    const paragraph: TeachingBlock = {
      type: 'paragraph',
      id: 'paragraph-1',
      alignment: 'justify',
      listStyle: 'ordered',
      indentLevel: 2,
      content: [{ type: 'text', text: '函数单调性', fontSize: 18, marks: ['bold'] }],
    }
    const box: TeachingBlock = {
      type: 'box',
      id: 'box-1',
      templateId: 'concept',
      breakBehavior: 'auto',
      appearance: {
        background: 'blue', borderColor: 'zinc', borderWidth: 2, cornerRadius: 8,
        padding: { top: 20, right: 16, bottom: 12, left: 16 },
      },
      children: [],
    }

    expect(editorNodeToBlock(blockToEditorNode(paragraph))).toEqual(paragraph)
    expect(editorNodeToBlock(blockToEditorNode(box))).toEqual(box)
  })
})

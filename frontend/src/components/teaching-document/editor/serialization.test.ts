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

  it('round-trips heading and box skin refs without adding a default skin to legacy blocks', () => {
    const heading: TeachingBlock = {
      type: 'heading', id: 'heading-skin', level: 2, content: [{ type: 'text', text: '标题' }],
      skin: { id: 'custom.heading.missing', version: 4, variant: 'futureVariant', settings: { density: 'compact' } },
    }
    const box: TeachingBlock = {
      type: 'box', id: 'box-skin', templateId: 'concept', breakBehavior: 'auto', children: [],
      skin: { id: 'custom.box.missing', version: 2, variant: 'green' },
    }
    const legacy: TeachingBlock = { type: 'heading', id: 'legacy-heading', level: 3, content: [{ type: 'text', text: '旧标题' }] }

    expect(editorNodeToBlock(blockToEditorNode(heading))).toEqual(heading)
    expect(editorNodeToBlock(blockToEditorNode(box))).toEqual(box)
    expect(editorNodeToBlock(blockToEditorNode(legacy))).toEqual(legacy)
  })

  it('round-trips figure text wrapping and its gap', () => {
    const figure: TeachingBlock = {
      type: 'figure',
      id: 'figure-wrap-1',
      asset: { type: 'documentAsset', assetId: 'asset-1' },
      alignment: 'left',
      widthMm: 72,
      lockAspectRatio: true,
      textWrap: 'square-left',
      wrapGapMm: 4,
    }

    expect(editorNodeToBlock(blockToEditorNode(figure))).toEqual(figure)
  })
})

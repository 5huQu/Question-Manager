import { Editor } from '@tiptap/core'
import { AllSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { createDocumentEditorExtensions } from './schema'
import { editorDocToTeachingDocument, teachingDocumentToEditorDoc } from './serialization'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'

const editors: Editor[] = []

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
})

describe('document editor manual page break', () => {
  it('inserts a persistent page-break node with Mod-Enter', () => {
    const editor = new Editor({
      extensions: createDocumentEditorExtensions(),
      content: {
        type: 'doc',
        content: [{
          type: 'docParagraph',
          attrs: { blockId: 'p-1' },
          content: [{ type: 'text', text: '第一页内容' }],
        }],
      },
    })
    editors.push(editor)
    editor.commands.setTextSelection(6)

    expect(editor.commands.keyboardShortcut('Mod-Enter')).toBe(true)

    const content = editor.getJSON().content || []
    expect(content.some((node) => node.type === 'docPageBreak')).toBe(true)
    const pageBreak = content.find((node) => node.type === 'docPageBreak')
    expect(String(pageBreak?.attrs?.blockId)).toMatch(/^pageBreak_/)
  })
})

describe('document editor heading serialization', () => {
  it('keeps the heading id and object after typing', () => {
    const document: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '测试讲义',
      metadata: {},
      content: [{
        type: 'heading',
        id: 'heading-1',
        level: 3,
        content: [{ type: 'text', text: '新标题' }],
      }],
    }
    const editor = new Editor({
      extensions: createDocumentEditorExtensions(),
      content: teachingDocumentToEditorDoc(document),
    })
    editors.push(editor)
    editor.commands.setTextSelection(4)
    editor.commands.insertContent('内容')

    const serialized = editorDocToTeachingDocument(editor.getJSON(), {
      documentType: document.documentType,
      title: document.title,
      metadata: document.metadata,
      style: document.style,
    })

    expect(serialized.content).toHaveLength(1)
    expect(serialized.content[0]).toMatchObject({
      type: 'heading',
      id: 'heading-1',
    })
  })

  it('keeps a valid block after select-all replacement', () => {
    const document: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '测试讲义',
      metadata: {},
      content: [{
        type: 'heading',
        id: 'heading-1',
        level: 3,
        content: [{ type: 'text', text: '新标题' }],
      }],
    }
    const editor = new Editor({
      extensions: createDocumentEditorExtensions(),
      content: teachingDocumentToEditorDoc(document),
    })
    editors.push(editor)
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)))
    editor.commands.insertContent('1.1')

    const serialized = editorDocToTeachingDocument(editor.getJSON(), {
      documentType: document.documentType,
      title: document.title,
      metadata: document.metadata,
    })

    expect(serialized.content).toHaveLength(1)
    expect(serialized.content[0].id).not.toBe('')
  })

  it('Mod+A replaces only the current heading text and keeps its identity', () => {
    const document: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '测试讲义',
      metadata: {},
      content: [{
        type: 'heading',
        id: 'heading-1',
        level: 3,
        content: [{ type: 'text', text: '新标题' }],
      }],
    }
    const editor = new Editor({
      extensions: createDocumentEditorExtensions(),
      content: teachingDocumentToEditorDoc(document),
    })
    editors.push(editor)
    editor.commands.setTextSelection(2)
    const event = new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true })
    let handled = false
    editor.view.someProp('handleKeyDown', (handler) => {
      if (!handled) handled = handler(editor.view, event) === true
    })
    expect(handled).toBe(true)
    editor.commands.insertContent('1.1 解析几何')

    const serialized = editorDocToTeachingDocument(editor.getJSON(), {
      documentType: document.documentType,
      title: document.title,
      metadata: document.metadata,
    })

    expect(serialized.content).toEqual([{
      type: 'heading',
      id: 'heading-1',
      level: 3,
      content: [{ type: 'text', text: '1.1 解析几何' }],
    }])
  })

  it('changes paragraph hierarchy without losing the stable block id', () => {
    const editor = new Editor({
      extensions: createDocumentEditorExtensions(),
      content: {
        type: 'doc',
        content: [{
          type: 'docParagraph',
          attrs: { blockId: 'text-1' },
          content: [{ type: 'text', text: '正文内容' }],
        }],
      },
    })
    editors.push(editor)
    editor.commands.setTextSelection(2)
    expect(editor.chain().setNode('docHeading', { blockId: 'text-1', level: 2 }).run()).toBe(true)

    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'docHeading',
      attrs: { blockId: 'text-1', level: 2 },
      content: [{ type: 'text', text: '正文内容' }],
    })
  })

  it('accepts a custom RGB text color but rejects arbitrary CSS', () => {
    const editor = new Editor({
      extensions: createDocumentEditorExtensions(),
      content: {
        type: 'doc',
        content: [{
          type: 'docParagraph',
          attrs: { blockId: 'text-1' },
          content: [{ type: 'text', text: '颜色文本' }],
        }],
      },
    })
    editors.push(editor)
    editor.commands.setTextSelection({ from: 1, to: 5 })

    expect(editor.commands.setTextColor('#2d6cdf')).toBe(true)
    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks).toContainEqual({
      type: 'textColor', attrs: { color: '#2d6cdf' },
    })
    expect(editor.commands.setTextColor('url(javascript:alert(1))')).toBe(false)
  })
})

describe('document editor figure group serialization', () => {
  it('keeps columns, spacing, assets and per-image captions across editor round-trip', () => {
    const document: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '图片组',
      metadata: {},
      content: [{
        type: 'figure',
        id: 'group-1',
        asset: { type: 'documentAsset', assetId: 'asset-1' },
        alignment: 'center',
        widthMm: 140,
        groupColumns: 2,
        groupGapMm: 4,
        groupItems: [
          { id: 'left', asset: { type: 'documentAsset', assetId: 'asset-1' }, caption: '左图' },
          { id: 'right', asset: { type: 'documentAsset', assetId: 'asset-2' }, caption: '右图' },
        ],
      }],
    }
    const serialized = editorDocToTeachingDocument(teachingDocumentToEditorDoc(document), {
      documentType: document.documentType,
      title: document.title,
      metadata: document.metadata,
    })
    expect(serialized.content[0]).toMatchObject({
      type: 'figure',
      groupColumns: 2,
      groupGapMm: 4,
      groupItems: [
        { id: 'left', caption: '左图' },
        { id: 'right', caption: '右图' },
      ],
    })
  })
})

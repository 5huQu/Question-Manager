import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { createDocumentEditorExtensions } from './schema'
import { editorDocToTeachingDocument, teachingDocumentToEditorDoc } from './serialization'
import {
  DOCUMENT_LAYOUT_CHANGE_SET_META,
  deleteTopLevelTeachingBlock,
  insertTopLevelTeachingBlock,
  mergeStructuralChangeSets,
} from './structuralActions'

const editors: Editor[] = []

function documentWith(ids: string[]): TeachingDocumentV1 {
  return {
    version: 1,
    documentType: 'lecture',
    title: '测试讲义',
    metadata: {},
    content: ids.map((id) => ({
      type: 'paragraph',
      id,
      content: [{ type: 'text', text: id }],
    })),
  }
}

function createEditor(document: TeachingDocumentV1) {
  const editor = new Editor({
    extensions: createDocumentEditorExtensions(),
    content: teachingDocumentToEditorDoc(document),
  })
  editors.push(editor)
  return editor
}

function blockIds(editor: Editor) {
  return (editor.getJSON().content || []).map((node) => String(node.attrs?.blockId || ''))
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
})

describe('ProseMirror structural actions', () => {
  it('inserts a page break in one undo step and exposes its dirty range', () => {
    const editor = createEditor(documentWith(['a', 'b']))
    const changeSets: unknown[] = []
    editor.on('transaction', ({ transaction }) => {
      const changeSet = transaction.getMeta(DOCUMENT_LAYOUT_CHANGE_SET_META)
      if (changeSet) changeSets.push(changeSet)
    })

    expect(insertTopLevelTeachingBlock(editor, { type: 'pageBreak', id: 'break' }, 'a')).toBe(true)
    expect(blockIds(editor)).toEqual(['a', 'break', 'b'])
    expect(changeSets.at(-1)).toMatchObject({
      dirtyBlockIds: ['break'],
      firstDirtyTopLevelIndex: 1,
      structureChanged: true,
    })

    expect(editor.commands.undo()).toBe(true)
    expect(blockIds(editor)).toEqual(['a', 'b'])
    expect(editor.commands.redo()).toBe(true)
    expect(blockIds(editor)).toEqual(['a', 'break', 'b'])
  })

  it('deletes a page break directly and restores it with undo', () => {
    const source: TeachingDocumentV1 = {
      ...documentWith(['a', 'b']),
      content: [
        documentWith(['a']).content[0],
        { type: 'pageBreak', id: 'break' },
        documentWith(['b']).content[0],
      ],
    }
    const editor = createEditor(source)

    expect(deleteTopLevelTeachingBlock(editor, 'break')).toBe(true)
    expect(blockIds(editor)).toEqual(['a', 'b'])
    expect(editor.commands.undo()).toBe(true)
    expect(blockIds(editor)).toEqual(['a', 'break', 'b'])
  })

  it('round-trips a fast-path insert through the saved domain document', () => {
    const source = documentWith(['a', 'b'])
    const editor = createEditor(source)
    insertTopLevelTeachingBlock(editor, { type: 'divider', id: 'divider' }, 'a')
    const saved = editorDocToTeachingDocument(editor.getJSON(), {
      documentType: source.documentType,
      title: source.title,
      metadata: source.metadata,
    })
    const reopened = createEditor(saved)

    expect(saved.content.map((block) => [block.type, block.id])).toEqual([
      ['paragraph', 'a'],
      ['divider', 'divider'],
      ['paragraph', 'b'],
    ])
    expect(blockIds(reopened)).toEqual(['a', 'divider', 'b'])
  })

  it('marks ordinary text edits dirty without reporting a structure change', () => {
    const editor = createEditor(documentWith(['a', 'b']))
    let changeSet: Record<string, unknown> | undefined
    editor.on('transaction', ({ transaction }) => {
      changeSet = transaction.getMeta(DOCUMENT_LAYOUT_CHANGE_SET_META)
    })
    editor.commands.setTextSelection(2)
    editor.commands.insertContent('changed')

    expect(changeSet).toMatchObject({
      dirtyBlockIds: ['a'],
      firstDirtyTopLevelIndex: 0,
      structureChanged: false,
    })
  })

  it('merges typing and structure dirty ranges within one model-sync window', () => {
    const merged = mergeStructuralChangeSets(
      {
        dirtyBlockIds: ['a'],
        firstDirtyTopLevelIndex: 0,
        structureChanged: false,
        paperOrGlobalStyleChanged: false,
        resourceIdsChanged: [],
      },
      {
        dirtyBlockIds: ['break'],
        firstDirtyTopLevelIndex: 3,
        structureChanged: true,
        paperOrGlobalStyleChanged: false,
        resourceIdsChanged: [],
      },
    )
    expect(merged).toMatchObject({
      dirtyBlockIds: ['a', 'break'],
      firstDirtyTopLevelIndex: 0,
      structureChanged: true,
    })
  })
})

import { Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { createDocumentEditorExtensions } from './schema'
import {
  BOX_CHILD_SELECT_EVENT,
  DOCUMENT_EXTERNAL_SYNC_META,
  blockIdFromEditorSelection,
  emitBoxChildSelect,
  isExternalDocumentSync,
} from './selection'

const editors: Editor[] = []

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
})

function createEditor() {
  const editor = new Editor({
    extensions: createDocumentEditorExtensions(),
    content: {
      type: 'doc',
      content: [
        {
          type: 'docQuestion',
          attrs: {
            blockId: 'previous-question',
            questionId: 'q-1',
            breakBehavior: 'auto',
            display: '{}',
            localContent: '',
          },
        },
        {
          type: 'docBox',
          attrs: {
            blockId: 'clicked-box',
            templateId: 'concept',
            title: '测试卡片',
            icon: '',
            breakBehavior: 'auto',
            children: '[]',
          },
        },
        {
          type: 'docParagraph',
          attrs: { blockId: 'paragraph-after' },
          content: [{ type: 'text', text: '正文' }],
        },
      ],
    },
  })
  editors.push(editor)
  return editor
}

describe('blockIdFromEditorSelection', () => {
  it('emits the source child id for nested box content selection', () => {
    let detail: unknown
    const listener = (event: Event) => {
      detail = (event as CustomEvent).detail
    }
    window.addEventListener(BOX_CHILD_SELECT_EVENT, listener)
    emitBoxChildSelect({ blockId: 'nested-question', parentBlockId: 'clicked-box' })
    window.removeEventListener(BOX_CHILD_SELECT_EVENT, listener)

    expect(detail).toEqual({ blockId: 'nested-question', parentBlockId: 'clicked-box' })
  })

  it('identifies programmatic document sync transactions', () => {
    const editor = createEditor()
    expect(isExternalDocumentSync(editor.state.tr)).toBe(false)
    expect(isExternalDocumentSync(
      editor.state.tr.setMeta(DOCUMENT_EXTERNAL_SYNC_META, true),
    )).toBe(true)
  })

  it('selects the atom at a shared boundary instead of the previous block', () => {
    const editor = createEditor()
    const boxPosition = editor.state.doc.child(0).nodeSize
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, boxPosition)))

    expect(blockIdFromEditorSelection(editor.state)).toBe('clicked-box')
  })

  it('keeps resolving an editable text selection to its containing block', () => {
    const editor = createEditor()
    const paragraphPosition = editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, paragraphPosition + 1)))

    expect(blockIdFromEditorSelection(editor.state)).toBe('paragraph-after')
  })
})

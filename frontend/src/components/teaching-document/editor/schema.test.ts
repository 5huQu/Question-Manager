import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createDocumentEditorExtensions } from './schema'

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

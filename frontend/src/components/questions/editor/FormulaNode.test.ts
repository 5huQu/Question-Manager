import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it } from 'vitest'
import { FormulaInline, inlineFormulaInputRule } from './FormulaNode'

const editors: Editor[] = []

afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
})

function createEditor() {
  const editor = new Editor({
    extensions: [StarterKit.configure({ codeBlock: false }), FormulaInline],
    content: '<p>所以 $p_{2m}=</p>',
  })
  editors.push(editor)
  return editor
}

describe('inlineFormulaInputRule', () => {
  it('renders a formula atom as soon as the closing dollar sign is typed', () => {
    const editor = createEditor()
    editor.commands.focus('end')
    const { from, to } = editor.state.selection

    const handled = editor.view.someProp('handleTextInput', (handler) => handler(editor.view, from, to, '$', () => editor.state.tr))

    expect(handled).toBe(true)
    expect(editor.getJSON().content?.[0]?.content).toEqual([
      { type: 'text', text: '所以 ' },
      { type: 'formulaInline', attrs: { latex: 'p_{2m}=' } },
    ])
  })

  it('does not treat an escaped delimiter as a formula', () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ codeBlock: false }), FormulaInline],
      content: '<p>价格 \\$5</p>',
    })
    editors.push(editor)
    editor.commands.focus('end')
    const { from, to } = editor.state.selection

    const handled = editor.view.someProp('handleTextInput', (handler) => handler(editor.view, from, to, '$', () => editor.state.tr))

    expect(handled).toBeFalsy()
    expect(editor.getJSON().content?.[0]?.content).toEqual([{ type: 'text', text: '价格 \\$5' }])
  })

  it('keeps the input rule attached to the visual formula node', () => {
    const editor = createEditor()
    expect(editor.extensionManager.extensions.find((extension) => extension.name === 'formulaInline')?.config.addInputRules).toBeDefined()
    expect(inlineFormulaInputRule(editor.schema.nodes.formulaInline)).toBeDefined()
  })
})

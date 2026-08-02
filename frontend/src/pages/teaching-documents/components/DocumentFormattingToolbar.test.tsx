import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createDocumentEditorExtensions } from '@/components/teaching-document/editor/schema'
import { DocumentFormattingToolbar } from './DocumentFormattingToolbar'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null
let editor: Editor | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  editor?.destroy()
  editor = null
})

async function renderToolbar() {
  editor = new Editor({
    extensions: createDocumentEditorExtensions(),
    content: {
      type: 'doc',
      content: [{
        type: 'docParagraph',
        attrs: { blockId: 'paragraph-1', alignment: 'left', listStyle: '', indentLevel: 0 },
        content: [{ type: 'text', text: '函数单调性' }],
      }],
    },
  })
  editor.commands.setTextSelection(2)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<DocumentFormattingToolbar editor={editor} />)
  })
}

function button(label: string) {
  const control = Array.from(container!.querySelectorAll<HTMLButtonElement>('button'))
    .find((item) => item.getAttribute('aria-label') === label)
  if (!control) throw new Error(`Missing toolbar button: ${label}`)
  return control
}

describe('DocumentFormattingToolbar', () => {
  it('applies text layout and list controls to the selected document paragraph', async () => {
    await renderToolbar()

    expect(button('居中').disabled).toBe(false)
    expect(button('项目列表').disabled).toBe(false)

    await act(async () => {
      button('居中').click()
      button('项目列表').click()
      button('增加缩进').click()
    })

    expect(editor!.getJSON().content?.[0]).toMatchObject({
      attrs: { alignment: 'center', listStyle: 'bullet', indentLevel: 1 },
    })
  })

  it('routes the unified font-size control to the active paragraph text', async () => {
    await renderToolbar()
    const size = container!.querySelector<HTMLSelectElement>('select[aria-label="字号"]')
    expect(size).not.toBeNull()

    await act(async () => {
      size!.value = '18'
      size!.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(editor!.getJSON().content?.[0]?.content?.[0]?.marks).toContainEqual({
      type: 'fontSize', attrs: { size: 18 },
    })
  })
})

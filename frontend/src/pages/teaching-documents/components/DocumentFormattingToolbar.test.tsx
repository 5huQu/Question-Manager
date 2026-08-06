import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createDocumentEditorExtensions } from '@/components/teaching-document/editor/schema'
import type { QuestionBlock } from '@/types/teachingDocument'
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

  it('routes a selected question block style to the requested scope', async () => {
    const questionBlock: QuestionBlock = { type: 'question', id: 'question-1', questionId: 'q-1', display: { typography: { fontSize: 14 } } }
    const changes: Array<{ patch: Record<string, unknown>; scope: string }> = []
    editor = new Editor({ extensions: createDocumentEditorExtensions(), content: { type: 'doc', content: [{ type: 'docParagraph', attrs: { blockId: 'paragraph-1' }, content: [{ type: 'text', text: '正文' }] }] } })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(<DocumentFormattingToolbar
        editor={editor}
        questionBlock={questionBlock}
        questionGlobalStyle={{ fontSize: 14 }}
        onQuestionStyleChange={(patch, scope) => changes.push({ patch, scope })}
        onQuestionStyleReset={() => undefined}
      />)
    })

    const size = container.querySelector<HTMLSelectElement>('select[aria-label="字号"]')
    const scope = container.querySelector<HTMLSelectElement>('select[aria-label="题目样式范围"]')
    expect(size).not.toBeNull()
    expect(scope).not.toBeNull()
    await act(async () => {
      size!.value = '18'
      size!.dispatchEvent(new Event('change', { bubbles: true }))
      scope!.value = 'document'
      scope!.dispatchEvent(new Event('change', { bubbles: true }))
      size!.value = '20'
      size!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(changes).toEqual([
      { patch: { fontSize: 18 }, scope: 'question' },
      { patch: { fontSize: 20 }, scope: 'document' },
    ])
  })

  it('routes the top toolbar to the selected text inside a question card', async () => {
    editor = new Editor({
      extensions: createDocumentEditorExtensions(),
      content: {
        type: 'doc',
        content: [{ type: 'docParagraph', attrs: { blockId: 'question-text' }, content: [{ type: 'text', text: '题卡局部文字' }] }],
      },
    })
    editor.view.dom.setAttribute('data-question-inline-editor', '')
    editor.commands.setTextSelection({ from: 2, to: 6 })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(<DocumentFormattingToolbar
        editor={editor}
        questionBlock={{ type: 'question', id: 'question-1', questionId: 'q-1' }}
        onQuestionStyleChange={() => undefined}
      />)
      editor!.commands.focus()
    })

    expect(container.querySelector('select[aria-label="题目样式范围"]')).toBeNull()
    expect(container.querySelector('button[aria-label="下划线"]')).not.toBeNull()
    const size = container.querySelector<HTMLSelectElement>('select[aria-label="字号"]')
    expect(size).not.toBeNull()
    await act(async () => {
      size!.value = '18'
      size!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const formattedNode = editor.getJSON().content?.[0]?.content?.find((node) => node.type === 'text' && node.marks?.some((mark) => mark.type === 'fontSize'))
    expect(formattedNode?.marks).toContainEqual({
      type: 'fontSize', attrs: { size: 18 },
    })
  })

  it('routes a selected heading level style to the document-level callback', async () => {
    const changes: Array<{ level: number; patch: Record<string, unknown> }> = []
    editor = new Editor({
      extensions: createDocumentEditorExtensions(),
      content: {
        type: 'doc',
        content: [{ type: 'docHeading', attrs: { blockId: 'heading-1', level: 2, alignment: 'left' }, content: [{ type: 'text', text: '第二级标题' }] }],
      },
    })
    editor.commands.setTextSelection(2)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(<DocumentFormattingToolbar editor={editor} headingStyle={{ fontSize: 20, fontWeight: 600 }} onHeadingStyleChange={(level, patch) => changes.push({ level, patch })} />)
    })
    const size = container.querySelector<HTMLSelectElement>('select[aria-label="字号"]')
    expect(container.textContent).toContain('2级标题（全文）')
    await act(async () => {
      size!.value = '18'
      size!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(changes).toEqual([{ level: 2, patch: { fontSize: 18 } }])
  })
})

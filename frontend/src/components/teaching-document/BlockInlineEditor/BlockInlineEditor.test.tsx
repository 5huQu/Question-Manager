import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createElement, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/react'
import type { TeachingDocumentV1, TeachingInline } from '@/types/teachingDocument'
import {
  createTeachingDocumentHistory,
  executeTeachingDocumentCommand,
  redoTeachingDocument,
  undoTeachingDocument,
  type TeachingDocumentCommand,
  type TeachingDocumentHistory,
} from '@/utils/teachingDocument'
import { BlockInlineEditor } from './BlockInlineEditor'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ─── 测试基础设施 ────────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

async function render(element: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(element)
  })
  return container
}

function editorDom(host: HTMLElement): HTMLElement {
  const element = host.querySelector<HTMLElement>('[data-block-inline-editor]')
  if (!element) throw new Error('未找到 BlockInlineEditor 的 contenteditable 元素')
  return element
}

function visibleText(host: HTMLElement): string {
  return editorDom(host).textContent || ''
}

/** 通过 ProseMirror 事务模拟输入（jsdom 无法可靠模拟 beforeinput） */
async function simulateTyping(editor: Editor, text: string) {
  await act(async () => {
    editor.commands.focus('end')
    editor.commands.insertContent(text)
  })
}

// ─── 基础编辑 ────────────────────────────────────────────────────────────────

describe('BlockInlineEditor: 基础编辑', () => {
  it('渲染初始内容并响应文本输入', async () => {
    const changes: TeachingInline[][] = []
    let editorRef: Editor | undefined
    const host = await renderEditorCapture([{ type: 'text', text: '初始段落' }], (inlines) => changes.push(inlines), (editor) => { editorRef = editor })
    expect(visibleText(host)).toContain('初始段落')
    expect(editorRef).toBeDefined()

    await simulateTyping(editorRef!, '追加文字')
    expect(changes.length).toBeGreaterThan(0)
    const last = changes[changes.length - 1]
    expect(last).toEqual([{ type: 'text', text: '初始段落追加文字' }])
    expect(visibleText(host)).toContain('初始段落追加文字')
  })

  it('空内容保持合法且可输入', async () => {
    let editorRef: Editor | undefined
    const changes: TeachingInline[][] = []
    const host = await renderEditorCapture([], (inlines) => changes.push(inlines), (editor) => { editorRef = editor })
    expect(editorDom(host).querySelector('p')).toBeTruthy()
    await simulateTyping(editorRef!, '新内容')
    expect(changes[changes.length - 1]).toEqual([{ type: 'text', text: '新内容' }])
  })

  it('Enter 不创建新段落，Shift+Enter 插入 hardBreak', async () => {
    let editorRef: Editor | undefined
    const changes: TeachingInline[][] = []
    await renderEditorCapture([{ type: 'text', text: '单行' }], (inlines) => changes.push(inlines), (editor) => { editorRef = editor })
    await act(async () => {
      editorRef!.commands.focus('end')
      editorRef!.commands.setHardBreak()
    })
    await simulateTyping(editorRef!, '换行后')
    const last = changes[changes.length - 1]
    expect(last).toEqual([
      { type: 'text', text: '单行' },
      { type: 'hardBreak' },
      { type: 'text', text: '换行后' },
    ])
  })

  it('工具栏 marks 切换产生正确 inlines', async () => {
    let editorRef: Editor | undefined
    const changes: TeachingInline[][] = []
    const host = await renderEditorCapture([{ type: 'text', text: '加粗我' }], (inlines) => changes.push(inlines), (editor) => { editorRef = editor })
    // 选中全部文本后点击粗体按钮
    await act(async () => { editorRef!.commands.selectAll() })
    const boldButton = host.querySelector<HTMLButtonElement>('button[aria-label="粗体"]')!
    expect(boldButton).toBeTruthy()
    await act(async () => { boldButton.click() })
    expect(changes[changes.length - 1]).toEqual([{ type: 'text', text: '加粗我', marks: ['bold'] }])
    // 再切换斜体
    const italicButton = host.querySelector<HTMLButtonElement>('button[aria-label="斜体"]')!
    await act(async () => { italicButton.click() })
    const last = changes[changes.length - 1]
    expect(last).toEqual([{ type: 'text', text: '加粗我', marks: ['bold', 'italic'] }])
  })

  it('插入行内公式后内容包含 inlineMath', async () => {
    let editorRef: Editor | undefined
    const changes: TeachingInline[][] = []
    await renderEditorCapture([{ type: 'text', text: '设' }], (inlines) => changes.push(inlines), (editor) => { editorRef = editor })
    await act(async () => {
      editorRef!.commands.focus('end')
      editorRef!.commands.insertContent({ type: 'inlineMath', attrs: { latex: 'x^2' } })
    })
    const last = changes[changes.length - 1]
    expect(last).toEqual([
      { type: 'text', text: '设' },
      { type: 'inlineMath', latex: 'x^2' },
    ])
  })
})

// ─── 外部同步与 undo/redo ────────────────────────────────────────────────────

/** 模拟页面级 harness：document history + dispatch + undo/redo */
function HistoryHarness({ initial, onChanges }: { initial: TeachingDocumentV1; onChanges?: (inlines: TeachingInline[]) => void }) {
  const [history, setHistory] = useState<TeachingDocumentHistory>(() => createTeachingDocumentHistory(initial))
  const [selectedId, setSelectedId] = useState(initial.content[0]?.id || '')
  const block = history.document.content.find((item) => item.id === selectedId)
  const dispatch = (command: TeachingDocumentCommand) => setHistory((current) => executeTeachingDocumentCommand(current, command))
  const inlines = block && (block.type === 'paragraph' || block.type === 'heading') ? block.content : []
  return createElement('div', null,
    createElement(BlockInlineEditor, {
      key: selectedId,
      inlines,
      onChange: (content) => {
        onChanges?.(content)
        dispatch({ type: 'updateBlock', blockId: selectedId, patch: { content } })
      },
    }),
    createElement('button', { 'data-testid': 'undo', onClick: () => setHistory(undoTeachingDocument) }),
    createElement('button', { 'data-testid': 'redo', onClick: () => setHistory(redoTeachingDocument) }),
    createElement('button', { 'data-testid': 'select-p2', onClick: () => setSelectedId('p2') }),
    createElement('output', { 'data-testid': 'doc-json' }, JSON.stringify(history.document.content)),
  )
}

const twoParagraphDoc: TeachingDocumentV1 = {
  version: 1,
  documentType: 'lecture',
  title: '测试',
  metadata: {},
  content: [
    { type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '第一段' }] },
    { type: 'paragraph', id: 'p2', content: [{ type: 'text', text: '第二段' }] },
  ],
}

describe('BlockInlineEditor: 外部同步与 undo/redo', () => {
  it('外部文档更新同步到编辑器且不产生回写循环', async () => {
    const onChangeSpy = vi.fn()
    const host = await render(createElement(ExternalSyncHarness, { onChange: onChangeSpy }))
    expect(visibleText(host)).toContain('本地内容')

    // 外部 replaceDocument（模拟 revision reload）
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="external-reload"]')!.click()
    })
    // 编辑器显示新内容
    expect(visibleText(host)).toContain('服务端新版本')
    expect(visibleText(host)).not.toContain('本地内容')
    // 同步过程不触发 onChange（无回写循环）
    expect(onChangeSpy).not.toHaveBeenCalled()
  })

  it('undo/redo 命令链正确恢复编辑器与文档状态', async () => {
    let editorRef: Editor | undefined
    const host = await render(createElement(UndoHarness, { onEditor: (editor) => { editorRef = editor } }))
    expect(visibleText(host)).toContain('原始文本')

    // 输入文字
    await simulateTyping(editorRef!, '甲')
    expect(docJson(host)).toContain('原始文本甲')
    await simulateTyping(editorRef!, '乙')
    expect(docJson(host)).toContain('原始文本甲乙')

    // 撤销两步
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="undo"]')!.click() })
    expect(docJson(host)).toContain('原始文本甲')
    expect(visibleText(host)).toContain('原始文本甲')
    expect(visibleText(host)).not.toContain('乙')
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="undo"]')!.click() })
    expect(docJson(host)).toContain('原始文本')
    expect(visibleText(host)).not.toContain('甲')

    // 重做
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="redo"]')!.click() })
    expect(docJson(host)).toContain('原始文本甲')
    expect(visibleText(host)).toContain('原始文本甲')
  })

  it('切换块不产生串写', async () => {
    const changes: TeachingInline[][] = []
    const host = await render(createElement(HistoryHarness, { initial: twoParagraphDoc, onChanges: (inlines) => changes.push(inlines) }))
    expect(visibleText(host)).toContain('第一段')

    // 切换到 p2
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="select-p2"]')!.click() })
    expect(visibleText(host)).toContain('第二段')
    expect(visibleText(host)).not.toContain('第一段')
    // 切换不应触发 onChange（无串写）
    expect(changes.length).toBe(0)
    // 文档状态中 p1 内容不变
    const docState = JSON.parse(host.querySelector('[data-testid="doc-json"]')!.textContent || '[]') as Array<{ id: string; content: TeachingInline[] }>
    expect(docState.find((block) => block.id === 'p1')?.content).toEqual([{ type: 'text', text: '第一段' }])
  })

  it('autosave 载荷不包含编辑器私有状态', async () => {
    let editorRef: Editor | undefined
    const payloads: TeachingInline[][] = []
    await render(createElement(UndoHarness, { onEditor: (editor) => { editorRef = editor }, onChange: (inlines) => payloads.push(inlines) }))
    await simulateTyping(editorRef!, '检查载荷')
    expect(payloads.length).toBeGreaterThan(0)
    for (const payload of payloads) {
      const serialized = JSON.stringify(payload)
      // 只允许文档模型字段，不允许编辑器私有状态
      expect(serialized).not.toContain('selection')
      expect(serialized).not.toContain('storedMarks')
      expect(serialized).not.toContain('doc":')
      expect(serialized).not.toContain('tiptap')
      for (const inline of payload) {
        expect(['text', 'inlineMath', 'hardBreak', 'unknown']).toContain(inline.type)
        if (inline.type === 'text') {
          for (const key of Object.keys(inline)) expect(['type', 'text', 'marks', 'unknownMarks']).toContain(key)
        }
      }
    }
  })
})

/** 带 undo 按钮与 editor 捕获的 harness（单块、无 mergeKey 以便细粒度 undo） */
function UndoHarness({ onEditor, onChange }: { onEditor?: (editor: Editor) => void; onChange?: (inlines: TeachingInline[]) => void }) {
  const [history, setHistory] = useState<TeachingDocumentHistory>(() => createTeachingDocumentHistory({
    version: 1,
    documentType: 'lecture',
    title: '测试',
    metadata: {},
    content: [{ type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '原始文本' }] }],
  }))
  const block = history.document.content[0]
  const inlines = block.type === 'paragraph' ? block.content : []
  return createElement('div', null,
    createElement(BlockInlineEditor, {
      inlines,
      onEditorReady: onEditor,
      onChange: (content) => {
        onChange?.(content)
        setHistory((current) => executeTeachingDocumentCommand(current, { type: 'updateBlock', blockId: 'p1', patch: { content } }))
      },
    }),
    createElement('button', { 'data-testid': 'undo', onClick: () => setHistory(undoTeachingDocument) }),
    createElement('button', { 'data-testid': 'redo', onClick: () => setHistory(redoTeachingDocument) }),
    createElement('output', { 'data-testid': 'doc-json' }, JSON.stringify(history.document.content)),
  )
}

/** 模拟外部 revision reload 的 harness：点击按钮后整体替换文档内容 */
function ExternalSyncHarness({ onChange }: { onChange?: (inlines: TeachingInline[]) => void }) {
  const [content, setContent] = useState<TeachingInline[]>([{ type: 'text', text: '本地内容' }])
  return createElement('div', null,
    createElement(BlockInlineEditor, {
      inlines: content,
      onChange: (next) => {
        onChange?.(next)
        setContent(next)
      },
    }),
    createElement('button', {
      'data-testid': 'external-reload',
      onClick: () => setContent([{ type: 'text', text: '服务端新版本', marks: ['bold'] as const }]),
    }),
  )
}

function docJson(host: HTMLElement): string {
  return host.querySelector('[data-testid="doc-json"]')!.textContent || ''
}

// ─── 保护模式 ────────────────────────────────────────────────────────────────

describe('BlockInlineEditor: 保护模式', () => {
  it('受保护内容只读且显示原因，内容仍可预览', async () => {
    const inlines: TeachingInline[] = [
      { type: 'text', text: '可见文本' },
      { type: 'unknown', originalType: 'futureWidget', rawData: { version: 9 } },
    ]
    const onChangeSpy = vi.fn()
    const host = await render(createElement(BlockInlineEditor, {
      inlines,
      onChange: onChangeSpy,
      protectedReason: '该块包含未识别的行内节点（futureWidget），为防止数据丢失已进入只读保护模式，原始数据完整保留。',
    }))
    // 原因可见
    expect(host.textContent).toContain('只读保护模式')
    expect(host.textContent).toContain('futureWidget')
    // 内容预览可见
    expect(visibleText(host)).toContain('可见文本')
    expect(host.querySelector('[data-unknown-inline]')).toBeTruthy()
    // 只读
    expect(editorDom(host).getAttribute('contenteditable')).toBe('false')
    // 无格式工具栏
    expect(host.querySelector('[role="toolbar"]')).toBeNull()
    // 不产生任何回写
    expect(onChangeSpy).not.toHaveBeenCalled()
  })
})

// ─── 粘贴安全 ────────────────────────────────────────────────────────────────

describe('BlockInlineEditor: 粘贴 HTML 安全降级', () => {
  it('恶意 HTML 粘贴降级为安全文本与允许 marks', async () => {
    let editorRef: Editor | undefined
    const changes: TeachingInline[][] = []
    const host = await renderEditorCapture([{ type: 'text', text: '' }], (inlines) => changes.push(inlines), (editor) => { editorRef = editor })
    await act(async () => { editorRef!.commands.focus('end') })

    const malicious = '<p><b onmouseover="hack()">粗体</b><script>alert("xss")</script><a href="javascript:alert(1)">链接</a><br><i>斜体</i></p>'
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/html' ? malicious : '') },
    })
    await act(async () => {
      editorDom(host).dispatchEvent(pasteEvent)
    })

    expect(changes.length).toBeGreaterThan(0)
    const last = changes[changes.length - 1]
    const serialized = JSON.stringify(last)
    expect(serialized).not.toContain('script')
    expect(serialized).not.toContain('alert')
    expect(serialized).not.toContain('javascript:')
    expect(serialized).not.toContain('onmouseover')
    // 允许的 marks 保留
    expect(last).toContainEqual({ type: 'text', text: '粗体', marks: ['bold'] })
    expect(last).toContainEqual({ type: 'text', text: '斜体', marks: ['italic'] })
    expect(last).toContainEqual({ type: 'text', text: '链接' })
    expect(last).toContainEqual({ type: 'hardBreak' })
  })
})

// ─── 辅助渲染 ────────────────────────────────────────────────────────────────

async function renderEditorCapture(
  inlines: TeachingInline[],
  onChange: (inlines: TeachingInline[]) => void,
  onEditor: (editor: Editor) => void,
): Promise<HTMLDivElement> {
  return render(createElement(BlockInlineEditor, { inlines, onChange, onEditorReady: onEditor }))
}

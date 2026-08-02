import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import TeachingDocumentEditorPage from './TeachingDocumentEditorPage'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom 未实现 CSS.escape；浮动工具栏/插入锚点按 blockId 查询 DOM 时依赖它。
if (typeof globalThis.CSS === 'undefined' || typeof globalThis.CSS.escape !== 'function') {
  ;(globalThis as typeof globalThis & { CSS: { escape: (value: string) => string } }).CSS = {
    ...globalThis.CSS,
    escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`),
  }
}

const mocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  editor: { current: null as unknown },
}))

vi.mock('@/api/questionBank', () => ({
  questionBankApi: { getItem: mocks.getItem, listItems: vi.fn() },
}))

vi.mock('./useTeachingDocumentEditor', () => ({
  useTeachingDocumentEditor: () => mocks.editor.current,
}))

vi.mock('@/utils/teachingDocument', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/teachingDocument')>()
  return { ...actual, waitForRenderReadiness: vi.fn(() => Promise.resolve({
    ready: true,
    timedOut: false,
    pendingFonts: false,
    pendingImages: [],
    pendingQuestions: [],
    pendingFigures: [],
    failedImages: [],
    diagnostics: [],
  })) }
})

function makeEditor(document: TeachingDocumentV1) {
  return {
    record: { id: 'doc-1', revision: 3, assets: [], title: document.title, content: document },
    history: { past: [], future: [], document },
    document,
    loading: false,
    loadError: '',
    saveState: 'saved',
    saveError: '',
    conflict: null,
    validation: { valid: true, issues: [] },
    dispatch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    saveNow: vi.fn(),
    reload: vi.fn(),
    uploadAsset: vi.fn(),
  }
}

describe('TeachingDocumentEditorPage 选中图片弹出属性面板', () => {
  let root: Root | null = null
  let container: HTMLDivElement

  beforeEach(() => {
    mocks.getItem.mockReset()
    mocks.getItem.mockRejectedValue(new Error('404'))
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    container.remove()
  })

  it('点击卡片内图片打开属性面板（重复点击也有效）', async () => {
    const teachingDoc: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '卡片图片',
      metadata: {},
      content: [{
        type: 'box',
        id: 'box1',
        templateId: 'concept',
        title: '知识卡片',
        breakBehavior: 'auto',
        children: [
          { type: 'paragraph', id: 'child-p1', content: [{ type: 'text', text: '卡片正文' }] },
          { type: 'figure', id: 'child-fig1', asset: { type: 'documentAsset', assetId: 'asset-1' }, alignment: 'center' },
        ],
      }],
    }
    mocks.editor.current = makeEditor(teachingDoc)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/teaching-documents/doc-1']}>
          <Routes><Route path="/teaching-documents/:documentId" element={<TeachingDocumentEditorPage />} /></Routes>
        </MemoryRouter>,
      )
    })
    const figure = container.querySelector<HTMLElement>('[data-block-id="child-fig1"]')
    expect(figure).toBeTruthy()
    // 点击图片：属性面板打开且显示“图片”
    await act(async () => {
      figure!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })
    const aside = container.querySelector('aside')
    expect(aside).toBeTruthy()
    expect(aside?.textContent).toContain('图片')
    // 重复点击（图片已选中，selection 无变化）：直接上报仍保持面板打开
    await act(async () => {
      figure!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })
    expect(container.querySelector('aside')?.textContent).toContain('图片')
  })

  it('Ctrl+点击顶层对象累积多选集合，批量删除一次性生效', async () => {
    const teachingDoc: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '顶层多选',
      metadata: {},
      content: [
        { type: 'figure', id: 'top-fig1', asset: { type: 'documentAsset', assetId: 'a' }, alignment: 'center' },
        { type: 'question', id: 'top-q1', questionId: '', display: {} },
      ],
    }
    mocks.editor.current = makeEditor(teachingDoc)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/teaching-documents/doc-1']}>
          <Routes><Route path="/teaching-documents/:documentId" element={<TeachingDocumentEditorPage />} /></Routes>
        </MemoryRouter>,
      )
    })
    const figure = container.querySelector<HTMLElement>('[data-editing-canvas] [data-block-id="top-fig1"]')
    const question = container.querySelector<HTMLElement>('[data-editing-canvas] [data-block-id="top-q1"]')
    expect(figure).toBeTruthy()
    expect(question).toBeTruthy()
    const click = (element: HTMLElement) => {
      // jsdom 的 PointerEvent 默认 isPrimary=false，会被拖拽钩子按非主指针忽略
      const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, ctrlKey: true })
      Object.defineProperty(event, 'isPrimary', { value: true })
      element.dispatchEvent(event)
    }
    await act(async () => { click(figure!) })
    await act(async () => { click(question!) })
    const bar = container.querySelector<HTMLElement>('[title="取消多选"]')?.closest('div')
    expect(bar?.textContent).toContain('已选 2 项')
    expect(bar?.textContent).toContain('图片')
    expect(bar?.textContent).toContain('题目')
    // 批量删除：一次 dispatch 携带两个 id
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === '删除')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect((mocks.editor.current as ReturnType<typeof makeEditor>).dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'deleteBlocks',
      blockIds: ['top-fig1', 'top-q1'],
    }))
    vi.restoreAllMocks()
  })

  it('拖拽手柄：悬停顶层块显示 grip，按住立即进入拖拽', async () => {
    const teachingDoc: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '拖拽手柄',
      metadata: {},
      content: [
        { type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '第一段' }] },
        { type: 'figure', id: 'top-fig1', asset: { type: 'documentAsset', assetId: 'a' }, alignment: 'center' },
      ],
    }
    mocks.editor.current = makeEditor(teachingDoc)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/teaching-documents/doc-1']}>
          <Routes><Route path="/teaching-documents/:documentId" element={<TeachingDocumentEditorPage />} /></Routes>
        </MemoryRouter>,
      )
    })
    const figure = container.querySelector<HTMLElement>('[data-editing-canvas] [data-block-id="top-fig1"]')
    expect(figure).toBeTruthy()
    // 悬停顶层块 → grip 出现
    const hoverEvent = new PointerEvent('pointermove', { bubbles: true, cancelable: true })
    Object.defineProperty(hoverEvent, 'isPrimary', { value: true })
    await act(async () => { figure!.dispatchEvent(hoverEvent) })
    const grip = container.querySelector<HTMLElement>('[data-block-grip="top-fig1"]')
    expect(grip).toBeTruthy()
    // 按住 grip（无位移阈值）→ 立即进入拖拽：块带 td-block-dragging
    const gripDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
    Object.defineProperty(gripDown, 'isPrimary', { value: true })
    await act(async () => { grip!.dispatchEvent(gripDown) })
    expect(figure!.className.includes('td-block-dragging')).toBe(true)
    // 松开结束拖拽
    const gripUp = new PointerEvent('pointerup', { bubbles: true, cancelable: true })
    Object.defineProperty(gripUp, 'isPrimary', { value: true })
    await act(async () => { grip!.dispatchEvent(gripUp) })
    const fresh = container.querySelector<HTMLElement>('[data-editing-canvas] [data-block-id="top-fig1"]')
    console.log('same element:', figure === fresh, '| figure class:', figure?.className?.slice(0, 60), '| fresh class:', fresh?.className?.slice(0, 60))
    expect(figure!.className.includes('td-block-dragging')).toBe(false)
  })

  it('Esc 上浮：选中卡片内图片后按 Esc 回到父卡片', async () => {
    const teachingDoc: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '卡片图片',
      metadata: {},
      content: [{
        type: 'box',
        id: 'box1',
        templateId: 'concept',
        title: '知识卡片',
        breakBehavior: 'auto',
        children: [
          { type: 'paragraph', id: 'child-p1', content: [{ type: 'text', text: '卡片正文' }] },
          { type: 'figure', id: 'child-fig1', asset: { type: 'documentAsset', assetId: 'asset-1' }, alignment: 'center' },
        ],
      }],
    }
    mocks.editor.current = makeEditor(teachingDoc)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/teaching-documents/doc-1']}>
          <Routes><Route path="/teaching-documents/:documentId" element={<TeachingDocumentEditorPage />} /></Routes>
        </MemoryRouter>,
      )
    })
    const figure = container.querySelector<HTMLElement>('[data-block-id="child-fig1"]')
    await act(async () => {
      figure!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })
    // 面板显示图片对象页（面包屑存在）
    expect(container.querySelector('aside')?.textContent).toContain('图片')
    await act(async () => {
      window.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    // Esc 上浮到父卡片：面板切到“知识卡片”
    expect(container.querySelector('aside')?.textContent).toContain('知识卡片')
  })
})

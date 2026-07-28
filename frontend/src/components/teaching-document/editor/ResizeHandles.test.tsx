/**
 * T4 图片 / 留白拖拽交互单元测试
 *
 * 覆盖：
 * - 图片宽度限制（不超出内容区、不小于最小值）
 * - 留白高度吸附（1mm 步进）与上下限
 * - mergeKey 合并逻辑（纯函数 + 编辑器 undo 步骤集成）
 * - 键盘调整（方向键 ±1mm，Shift ±5mm）
 * - 拖拽手柄 / 尺寸浮层的 data-print-hide 打印隐藏属性
 */
import { act } from 'react'
import { useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { Editor, Node, type JSONContent } from '@tiptap/core'
import { UndoRedo } from '@tiptap/extensions'
import { ResizeCommands } from './resizeCommands'
import {
  KEYBOARD_SHIFT_STEP_MM,
  KEYBOARD_STEP_MM,
  MAX_SPACER_HEIGHT_MM,
  MIN_FIGURE_WIDTH_MM,
  MIN_SPACER_HEIGHT_MM,
  RESIZE_MERGE_WINDOW_MS,
  clampFigureWidthMm,
  clampSpacerHeightMm,
  mmToPx,
  nextResizeMergeState,
  pxToMm,
  roundMm,
  shouldMergeResize,
  snapSpacerHeightMm,
} from './resizeLogic'
import {
  ImageResizeOverlay,
  SpacerResizeHandle,
  useFigureResizeKeyboard,
  useSpacerResizeKeyboard,
} from './ResizeHandles'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ─── 纯逻辑：尺寸限制与吸附 ─────────────────────────────────────────────────

describe('resizeLogic: 图片宽度限制', () => {
  const CONTENT_WIDTH_MM = 178 // A4 portrait normal 内容区宽度

  it('不小于最小值 10mm', () => {
    expect(clampFigureWidthMm(5, CONTENT_WIDTH_MM)).toBe(MIN_FIGURE_WIDTH_MM)
    expect(clampFigureWidthMm(-20, CONTENT_WIDTH_MM)).toBe(MIN_FIGURE_WIDTH_MM)
    expect(clampFigureWidthMm(0, CONTENT_WIDTH_MM)).toBe(MIN_FIGURE_WIDTH_MM)
  })

  it('不超出内容区宽度', () => {
    expect(clampFigureWidthMm(300, CONTENT_WIDTH_MM)).toBe(CONTENT_WIDTH_MM)
    expect(clampFigureWidthMm(CONTENT_WIDTH_MM + 0.5, CONTENT_WIDTH_MM)).toBe(CONTENT_WIDTH_MM)
  })

  it('区间内保持不变', () => {
    expect(clampFigureWidthMm(85, CONTENT_WIDTH_MM)).toBe(85)
    expect(clampFigureWidthMm(MIN_FIGURE_WIDTH_MM, CONTENT_WIDTH_MM)).toBe(MIN_FIGURE_WIDTH_MM)
    expect(clampFigureWidthMm(CONTENT_WIDTH_MM, CONTENT_WIDTH_MM)).toBe(CONTENT_WIDTH_MM)
  })

  it('非有限值回退到最小值', () => {
    expect(clampFigureWidthMm(Number.NaN, CONTENT_WIDTH_MM)).toBe(MIN_FIGURE_WIDTH_MM)
    expect(clampFigureWidthMm(Number.POSITIVE_INFINITY, CONTENT_WIDTH_MM)).toBe(CONTENT_WIDTH_MM)
  })
})

describe('resizeLogic: 留白高度吸附与上下限', () => {
  it('按 1mm 步进吸附（四舍五入）', () => {
    expect(snapSpacerHeightMm(10.3)).toBe(10)
    expect(snapSpacerHeightMm(10.6)).toBe(11)
    expect(snapSpacerHeightMm(10.5)).toBe(11)
    expect(snapSpacerHeightMm(12)).toBe(12)
  })

  it('支持自定义吸附步进（2mm）', () => {
    expect(snapSpacerHeightMm(11, 2)).toBe(12)
    expect(snapSpacerHeightMm(10, 2)).toBe(10)
    expect(snapSpacerHeightMm(13, 2)).toBe(14)
  })

  it('吸附后不低于 2mm、不超过 200mm', () => {
    expect(snapSpacerHeightMm(0)).toBe(MIN_SPACER_HEIGHT_MM)
    expect(snapSpacerHeightMm(1.2)).toBe(MIN_SPACER_HEIGHT_MM) // round→1 → clamp→2
    expect(snapSpacerHeightMm(500)).toBe(MAX_SPACER_HEIGHT_MM)
    expect(snapSpacerHeightMm(199.6)).toBe(MAX_SPACER_HEIGHT_MM) // round→200
  })

  it('clampSpacerHeightMm 直接钳制', () => {
    expect(clampSpacerHeightMm(1)).toBe(MIN_SPACER_HEIGHT_MM)
    expect(clampSpacerHeightMm(201)).toBe(MAX_SPACER_HEIGHT_MM)
    expect(clampSpacerHeightMm(50)).toBe(50)
  })
})

describe('resizeLogic: mm ↔ px 换算与舍入', () => {
  it('mmToPx / pxToMm 互逆', () => {
    expect(pxToMm(mmToPx(85))).toBeCloseTo(85, 6)
    expect(mmToPx(25.4)).toBeCloseTo(96, 6) // 1 inch = 96px
  })

  it('roundMm 保留 0.1mm', () => {
    expect(roundMm(85.234)).toBe(85.2)
    expect(roundMm(85.25)).toBe(85.3)
    expect(roundMm(85)).toBe(85)
  })
})

// ─── 纯逻辑：mergeKey 合并判定 ───────────────────────────────────────────────

describe('resizeLogic: mergeKey 合并判定', () => {
  const KEY = 'resize-figure-fig1'

  it('无历史状态时不合并', () => {
    expect(shouldMergeResize(null, KEY, 1000)).toBe(false)
  })

  it('相同 mergeKey 且在时间窗口内 → 合并', () => {
    const state = nextResizeMergeState(KEY, 1000)
    expect(shouldMergeResize(state, KEY, 1000 + RESIZE_MERGE_WINDOW_MS)).toBe(true)
    expect(shouldMergeResize(state, KEY, 1500)).toBe(true)
  })

  it('相同 mergeKey 但超出时间窗口 → 不合并', () => {
    const state = nextResizeMergeState(KEY, 1000)
    expect(shouldMergeResize(state, KEY, 1000 + RESIZE_MERGE_WINDOW_MS + 1)).toBe(false)
  })

  it('不同 mergeKey → 不合并', () => {
    const state = nextResizeMergeState(KEY, 1000)
    expect(shouldMergeResize(state, 'resize-figure-fig2', 1001)).toBe(false)
    expect(shouldMergeResize(state, 'resize-spacer-sp1', 1001)).toBe(false)
  })

  it('空 mergeKey → 不合并', () => {
    const state = nextResizeMergeState(KEY, 1000)
    expect(shouldMergeResize(state, '', 1001)).toBe(false)
  })
})

// ─── 编辑器集成：commands 与 undo 步骤 ──────────────────────────────────────

/** 最小 doc/text 节点（测试用，避免引入 StarterKit 与 React NodeView） */
const TestDoc = Node.create({ name: 'doc', content: 'block+' })
const TestText = Node.create({ name: 'text', group: 'inline' })

const TestFigure = Node.create({
  name: 'docFigure',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      blockId: { default: '' },
      widthMm: { default: null },
      widthRatio: { default: null },
    }
  },
  parseHTML() {
    return []
  },
  renderHTML() {
    return ['div']
  },
})

const TestSpacer = Node.create({
  name: 'docSpacer',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      blockId: { default: '' },
      heightMm: { default: null },
      heightEm: { default: 2 },
    }
  },
  parseHTML() {
    return []
  },
  renderHTML() {
    return ['div']
  },
})

function figureNode(blockId: string, widthMm: number): JSONContent {
  return { type: 'docFigure', attrs: { blockId, widthMm, widthRatio: null } }
}

function spacerNode(blockId: string, heightMm: number): JSONContent {
  return { type: 'docSpacer', attrs: { blockId, heightMm, heightEm: 2 } }
}

function createTestEditor(content: JSONContent[]): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return new Editor({
    element,
    extensions: [TestDoc, TestText, TestFigure, TestSpacer, UndoRedo, ResizeCommands],
    content: { type: 'doc', content },
  })
}

function findAttrs(editor: Editor, blockId: string, typeName: string): Record<string, unknown> | null {
  let attrs: Record<string, unknown> | null = null
  editor.state.doc.descendants((node) => {
    if (attrs) return false
    if (node.type.name === typeName && node.attrs.blockId === blockId) {
      attrs = { ...node.attrs }
      return false
    }
    return true
  })
  return attrs
}

const editors: Editor[] = []
function track(editor: Editor): Editor {
  editors.push(editor)
  return editor
}

afterEach(() => {
  while (editors.length) {
    const editor = editors.pop()
    editor?.destroy()
  }
  document.body.innerHTML = ''
})

describe('ResizeCommands: setFigureWidth / setSpacerHeight', () => {
  it('setFigureWidth 更新 widthMm 属性', () => {
    const editor = track(createTestEditor([figureNode('fig1', 60)]))
    const ok = editor.commands.setFigureWidth('fig1', 85)
    expect(ok).toBe(true)
    expect(findAttrs(editor, 'fig1', 'docFigure')?.widthMm).toBe(85)
  })

  it('setFigureWidth 对下限做保护（不小于 10mm）', () => {
    const editor = track(createTestEditor([figureNode('fig1', 60)]))
    editor.commands.setFigureWidth('fig1', 3)
    expect(findAttrs(editor, 'fig1', 'docFigure')?.widthMm).toBe(MIN_FIGURE_WIDTH_MM)
  })

  it('setFigureWidth 对不存在的 blockId 返回 false', () => {
    const editor = track(createTestEditor([figureNode('fig1', 60)]))
    expect(editor.commands.setFigureWidth('missing', 85)).toBe(false)
  })

  it('setSpacerHeight 更新 heightMm 属性并钳制范围', () => {
    const editor = track(createTestEditor([spacerNode('sp1', 10)]))
    editor.commands.setSpacerHeight('sp1', 42)
    expect(findAttrs(editor, 'sp1', 'docSpacer')?.heightMm).toBe(42)
    editor.commands.setSpacerHeight('sp1', 999)
    expect(findAttrs(editor, 'sp1', 'docSpacer')?.heightMm).toBe(MAX_SPACER_HEIGHT_MM)
    editor.commands.setSpacerHeight('sp1', 0)
    expect(findAttrs(editor, 'sp1', 'docSpacer')?.heightMm).toBe(MIN_SPACER_HEIGHT_MM)
  })
})

describe('ResizeCommands: mergeKey 合并为一个 undo 步骤', () => {
  it('相同 mergeKey 的连续提交合并，undo 一次恢复原始宽度', () => {
    const editor = track(createTestEditor([figureNode('fig1', 60)]))
    editor.commands.setFigureWidth('fig1', 80, 'resize-figure-fig1')
    editor.commands.setFigureWidth('fig1', 100, 'resize-figure-fig1')
    editor.commands.setFigureWidth('fig1', 120, 'resize-figure-fig1')
    expect(findAttrs(editor, 'fig1', 'docFigure')?.widthMm).toBe(120)

    // 连续拖拽只产生一个 undo 步骤：撤销一次直接回到 60
    editor.commands.undo()
    expect(findAttrs(editor, 'fig1', 'docFigure')?.widthMm).toBe(60)
  })

  it('不同 mergeKey 产生独立 undo 步骤', () => {
    const editor = track(createTestEditor([figureNode('fig1', 60), figureNode('fig2', 50)]))
    editor.commands.setFigureWidth('fig1', 80, 'resize-figure-fig1')
    editor.commands.setFigureWidth('fig2', 70, 'resize-figure-fig2')

    editor.commands.undo() // 仅撤销 fig2
    expect(findAttrs(editor, 'fig2', 'docFigure')?.widthMm).toBe(50)
    expect(findAttrs(editor, 'fig1', 'docFigure')?.widthMm).toBe(80)

    editor.commands.undo() // 再撤销 fig1
    expect(findAttrs(editor, 'fig1', 'docFigure')?.widthMm).toBe(60)
  })

  it('中间插入无关内容变更会重置合并，避免并入无关历史', () => {
    const editor = track(createTestEditor([figureNode('fig1', 60)]))
    editor.commands.setFigureWidth('fig1', 80, 'resize-figure-fig1')

    // 模拟一次无关的内容变更（非尺寸调整事务）
    const extra = editor.schema.nodes.docSpacer.create({ blockId: 'sp-extra', heightMm: 5, heightEm: 2 })
    editor.view.dispatch(editor.state.tr.insert(0, extra))

    editor.commands.setFigureWidth('fig1', 100, 'resize-figure-fig1')

    // 第三次提交未并入第一步：undo 一次回到 80（而非 60）
    editor.commands.undo()
    expect(findAttrs(editor, 'fig1', 'docFigure')?.widthMm).toBe(80)
    // 再 undo 撤销无关插入，再 undo 回到 60
    editor.commands.undo()
    editor.commands.undo()
    expect(findAttrs(editor, 'fig1', 'docFigure')?.widthMm).toBe(60)
  })

  it('留白连续拖拽同样合并为一个 undo 步骤', () => {
    const editor = track(createTestEditor([spacerNode('sp1', 10)]))
    editor.commands.setSpacerHeight('sp1', 20, 'resize-spacer-sp1')
    editor.commands.setSpacerHeight('sp1', 30, 'resize-spacer-sp1')
    expect(findAttrs(editor, 'sp1', 'docSpacer')?.heightMm).toBe(30)
    editor.commands.undo()
    expect(findAttrs(editor, 'sp1', 'docSpacer')?.heightMm).toBe(10)
  })
})

// ─── 键盘调整 ────────────────────────────────────────────────────────────────

function readFigureWidth(editor: Editor, blockId: string): number {
  return Number(findAttrs(editor, blockId, 'docFigure')?.widthMm ?? 0)
}

function readSpacerHeight(editor: Editor, blockId: string): number {
  return Number(findAttrs(editor, blockId, 'docSpacer')?.heightMm ?? 0)
}

function FigureKeyboardHarness({ editor, blockId, contentWidthMm }: { editor: Editor; blockId: string; contentWidthMm: number }) {
  const [widthMm, setWidthMm] = useState(() => readFigureWidth(editor, blockId))
  useEffect(() => {
    const onTr = () => setWidthMm(readFigureWidth(editor, blockId))
    editor.on('transaction', onTr)
    return () => {
      editor.off('transaction', onTr)
    }
  }, [editor, blockId])
  useFigureResizeKeyboard({
    editor,
    blockId,
    selected: true,
    currentWidthMm: widthMm,
    contentWidthMm,
    mergeKey: `resize-figure-${blockId}`,
  })
  return null
}

function SpacerKeyboardHarness({ editor, blockId }: { editor: Editor; blockId: string }) {
  const [heightMm, setHeightMm] = useState(() => readSpacerHeight(editor, blockId))
  useEffect(() => {
    const onTr = () => setHeightMm(readSpacerHeight(editor, blockId))
    editor.on('transaction', onTr)
    return () => {
      editor.off('transaction', onTr)
    }
  }, [editor, blockId])
  useSpacerResizeKeyboard({
    editor,
    blockId,
    selected: true,
    currentHeightMm: heightMm,
    mergeKey: `resize-spacer-${blockId}`,
  })
  return null
}

let root: Root | null = null
afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = null
  }
})

async function mountHarness(element: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(element)
  })
}

function pressKey(target: HTMLElement, key: string, shiftKey = false) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
    )
  })
}

describe('键盘调整（无障碍替代）', () => {
  const CONTENT_WIDTH_MM = 178

  it('图片：方向键 ±1mm', async () => {
    const editor = track(createTestEditor([figureNode('fig1', 60)]))
    await mountHarness(<FigureKeyboardHarness editor={editor} blockId="fig1" contentWidthMm={CONTENT_WIDTH_MM} />)

    pressKey(editor.view.dom, 'ArrowRight')
    expect(readFigureWidth(editor, 'fig1')).toBe(60 + KEYBOARD_STEP_MM)

    pressKey(editor.view.dom, 'ArrowLeft')
    expect(readFigureWidth(editor, 'fig1')).toBe(60)
  })

  it('图片：Shift+方向键 ±5mm，且在内容区内钳制', async () => {
    const editor = track(createTestEditor([figureNode('fig1', 176)]))
    await mountHarness(<FigureKeyboardHarness editor={editor} blockId="fig1" contentWidthMm={CONTENT_WIDTH_MM} />)

    pressKey(editor.view.dom, 'ArrowRight', true) // 176 + 5 = 181 → clamp 178
    expect(readFigureWidth(editor, 'fig1')).toBe(CONTENT_WIDTH_MM)

    pressKey(editor.view.dom, 'ArrowLeft', true) // 178 - 5 = 173
    expect(readFigureWidth(editor, 'fig1')).toBe(CONTENT_WIDTH_MM - KEYBOARD_SHIFT_STEP_MM)
  })

  it('图片：连续键盘调整合并为一个 undo 步骤', async () => {
    const editor = track(createTestEditor([figureNode('fig1', 60)]))
    await mountHarness(<FigureKeyboardHarness editor={editor} blockId="fig1" contentWidthMm={CONTENT_WIDTH_MM} />)

    pressKey(editor.view.dom, 'ArrowRight')
    pressKey(editor.view.dom, 'ArrowRight')
    pressKey(editor.view.dom, 'ArrowRight')
    expect(readFigureWidth(editor, 'fig1')).toBe(63)

    act(() => {
      editor.commands.undo()
    })
    expect(readFigureWidth(editor, 'fig1')).toBe(60)
  })

  it('留白：↑ 减小、↓ 增大，1mm 步进', async () => {
    const editor = track(createTestEditor([spacerNode('sp1', 10)]))
    await mountHarness(<SpacerKeyboardHarness editor={editor} blockId="sp1" />)

    pressKey(editor.view.dom, 'ArrowDown')
    expect(readSpacerHeight(editor, 'sp1')).toBe(11)

    pressKey(editor.view.dom, 'ArrowUp')
    expect(readSpacerHeight(editor, 'sp1')).toBe(10)
  })

  it('键盘事件不劫持编辑器之外的输入', async () => {
    const editor = track(createTestEditor([figureNode('fig1', 60)]))
    await mountHarness(<FigureKeyboardHarness editor={editor} blockId="fig1" contentWidthMm={CONTENT_WIDTH_MM} />)

    const outside = document.createElement('input')
    document.body.appendChild(outside)
    pressKey(outside, 'ArrowRight')
    expect(readFigureWidth(editor, 'fig1')).toBe(60) // 未变化
  })
})

// ─── 打印隐藏属性 ────────────────────────────────────────────────────────────

describe('拖拽手柄与尺寸浮层的打印隐藏', () => {
  it('ImageResizeOverlay 渲染四角手柄与尺寸浮层，且带 data-print-hide', () => {
    const html = renderToStaticMarkup(
      <ImageResizeOverlay
        currentWidthMm={85}
        maxWidthMm={178}
        aspectRatio={85 / 62}
        onPreview={() => {}}
        onCommit={() => {}}
      />,
    )
    const rootEl = document.createElement('div')
    rootEl.innerHTML = html
    expect(rootEl.querySelector('[data-print-hide]')).not.toBeNull()
    expect(rootEl.querySelectorAll('[role="slider"]')).toHaveLength(4)
    expect(html).toContain('85mm × 62mm')
  })

  it('SpacerResizeHandle 渲染底部手柄与高度浮层，且带 data-print-hide', () => {
    const html = renderToStaticMarkup(
      <SpacerResizeHandle currentHeightMm={24} onPreview={() => {}} onCommit={() => {}} />,
    )
    const rootEl = document.createElement('div')
    rootEl.innerHTML = html
    expect(rootEl.querySelector('[data-print-hide]')).not.toBeNull()
    expect(rootEl.querySelector('[role="slider"]')).not.toBeNull()
    expect(html).toContain('24mm')
  })
})

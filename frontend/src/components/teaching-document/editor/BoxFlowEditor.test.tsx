import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoxChildBlock } from '@/types/teachingDocument'
import { BoxFlowEditor } from './BoxFlowEditor'
import { getFocusedCardEditor, insertCardBlockAtCaret } from './cardEditorRegistry'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function paragraph(id: string, text: string): BoxChildBlock {
  return { type: 'paragraph', id, content: [{ type: 'text', text }] }
}

describe('BoxFlowEditor', () => {
  it('将整卡渲染为单一连续编辑区，Enter 创建新段落并保留既有 id', async () => {
    const onChange = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <BoxFlowEditor
          children={[paragraph('p1', '第一段'), { type: 'figure', id: 'fig1', asset: { type: 'documentAsset', assetId: '' }, alignment: 'center' }]}
          onChange={onChange}
        />,
      )
    })
    const editor = container.querySelector<HTMLElement>('[data-box-text-editor]')
    expect(editor).toBeTruthy()
    // 嵌入对象（figure）在流内渲染，段落带业务块 id
    expect(container.querySelector('[data-block-id="fig1"]')).toBeTruthy()
    expect(container.querySelector<HTMLElement>('[data-block-id="p1"]')?.textContent).toContain('第一段')
    expect(container.querySelectorAll('[data-box-flow-item]')).toHaveLength(2)

    await act(async () => {
      editor!.focus()
      editor!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    const latest = onChange.mock.calls.at(-1)?.[0] as BoxChildBlock[]
    expect(latest).toHaveLength(3)
    expect(latest[0]?.id).toBe('p1')
    expect(latest[1]?.type).toBe('figure')
    expect(latest[2]?.type).toBe('paragraph')
    expect(typeof latest[2]?.id).toBe('string')
    // Enter 分段产生的段落必须拥有全新 id，不能与原段落共享
    expect(latest[2]?.id).not.toBe('p1')
    expect(new Set(latest.map((child) => child.id)).size).toBe(latest.length)
    expect(container.querySelectorAll('[data-box-flow-item]')).toHaveLength(3)
  })

  it('为每个连续段落输出业务块 id，供悬停插入锚点定位', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <BoxFlowEditor
          children={[paragraph('p1', '第一段'), paragraph('p2', '第二段')]}
          onChange={vi.fn()}
        />,
      )
    })
    const paragraphNodes = container.querySelectorAll('[data-box-text-editor] p')
    expect(paragraphNodes[0]?.getAttribute('data-block-id')).toBe('p1')
    expect(paragraphNodes[1]?.getAttribute('data-block-id')).toBe('p2')
    expect(paragraphNodes[0]?.hasAttribute('data-box-flow-item')).toBe(true)
    expect(paragraphNodes[1]?.hasAttribute('data-box-flow-item')).toBe(true)
  })

  it('Shift+Enter 仅创建段内换行，不新增流程项', async () => {
    const onChange = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <BoxFlowEditor children={[paragraph('p1', '第一步')]} onChange={onChange} />,
      )
    })
    const editor = container.querySelector<HTMLElement>('[data-box-text-editor]')
    await act(async () => {
      editor!.focus()
      editor!.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }))
    })
    const latest = onChange.mock.calls.at(-1)?.[0] as BoxChildBlock[]
    expect(latest).toHaveLength(1)
    expect(latest[0]?.type).toBe('paragraph')
    expect(container.querySelectorAll('[data-box-flow-item]')).toHaveLength(1)
  })

  it('外部内容变化（undo/redo 回写）时同步编辑器且不产生回写循环', async () => {
    const onChange = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const renderWith = (text: string) => {
      root!.render(
        <BoxFlowEditor
          children={[paragraph('p1', text)]}
          onChange={onChange}
        />,
      )
    }
    await act(async () => renderWith('甲'))
    expect(container.querySelector<HTMLElement>('[data-block-id="p1"]')?.textContent).toContain('甲')

    await act(async () => renderWith('乙'))
    expect(container.querySelector<HTMLElement>('[data-block-id="p1"]')?.textContent).toContain('乙')
    // 外部同步本身不触发 onChange（emitUpdate: false）
    expect(onChange).not.toHaveBeenCalled()
  })

  it('点击流内原子块建立 NodeSelection：对齐修改回写 children', async () => {
    const onChange = vi.fn()
    const onActiveChildChange = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <BoxFlowEditor
          children={[
            paragraph('p1', '第一段'),
            { type: 'figure', id: 'fig1', asset: { type: 'documentAsset', assetId: '' }, alignment: 'center' },
          ]}
          onChange={onChange}
          onActiveChildChange={onActiveChildChange}
        />,
      )
    })
    const figure = container.querySelector<HTMLElement>('[data-block-id="fig1"]')
    expect(figure).toBeTruthy()
    // 点击图片：mousedown 拦截路径手动建立 NodeSelection（选区变化同步上报）
    await act(async () => {
      figure!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })
    expect(onActiveChildChange.mock.calls.at(-1)?.[0]).toBe('fig1')
    // 对齐工具栏随选中出现，点击“居中插图”后修改回写 children
    const toolbar = container.querySelector<HTMLElement>('[data-block-id="fig1"] [data-print-hide]')
    expect(toolbar).toBeTruthy()
    const centerButton = toolbar?.querySelector('button')
    expect(centerButton?.textContent).toBe('居中插图')
    await act(async () => {
      centerButton!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      centerButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const last = onChange.mock.calls.at(-1)?.[0] as BoxChildBlock[]
    const figureChild = last?.find((child) => child.id === 'fig1') as Record<string, unknown> | undefined
    expect(figureChild?.layoutPreset).toBe('block-center')
    // alignment 随排版预设同步，属性面板的“对齐”不会显示过期值
    expect(figureChild?.alignment).toBe('center')
  })

  it('聚焦后通过注册表在光标处插入子块（光标在段首时对象落于段前）', async () => {
    const onChange = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <BoxFlowEditor children={[paragraph('p1', '第一段')]} onChange={onChange} />,
      )
    })
    const editor = container.querySelector<HTMLElement>('[data-box-text-editor]')
    await act(async () => {
      editor!.focus()
    })
    const flowEditor = getFocusedCardEditor()
    expect(flowEditor).toBeTruthy()
    await act(async () => {
      flowEditor!.commands.setTextSelection(1)
      insertCardBlockAtCaret(flowEditor!, 'figure')
    })
    const last = onChange.mock.calls.at(-1)?.[0] as BoxChildBlock[]
    expect(last.map((child) => child.type)).toEqual(['figure', 'paragraph'])
    expect(last[1]?.id).toBe('p1')
  })

  it('段落中间插入对象时自动拆段，文字环绕对象', async () => {
    const onChange = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <BoxFlowEditor children={[paragraph('p1', '第一段')]} onChange={onChange} />,
      )
    })
    const editor = container.querySelector<HTMLElement>('[data-box-text-editor]')
    await act(async () => {
      editor!.focus()
    })
    const flowEditor = getFocusedCardEditor()
    await act(async () => {
      flowEditor!.commands.setTextSelection(2)
      insertCardBlockAtCaret(flowEditor!, 'blockMath')
    })
    const last = onChange.mock.calls.at(-1)?.[0] as BoxChildBlock[]
    expect(last.map((child) => child.type)).toEqual(['paragraph', 'blockMath', 'paragraph'])
    // 原段落 id 保留，新段落获得全新 id
    expect(last[0]?.id).toBe('p1')
    expect(last[2]?.id).not.toBe('p1')
    const firstContent = (last[0] as Extract<BoxChildBlock, { type: 'paragraph' }>).content
      .map((inline) => (inline.type === 'text' ? inline.text : ''))
      .join('')
    const lastContent = (last[2] as Extract<BoxChildBlock, { type: 'paragraph' }>).content
      .map((inline) => (inline.type === 'text' ? inline.text : ''))
      .join('')
    expect(firstContent).toBe('第')
    expect(lastContent).toBe('一段')
  })

  it('全文档单选：点击另一卡片的对象后，前卡片的选中环消失', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const figureA: BoxChildBlock = { type: 'figure', id: 'fig-a', asset: { type: 'documentAsset', assetId: 'a' }, alignment: 'center' }
    const figureB: BoxChildBlock = { type: 'figure', id: 'fig-b', asset: { type: 'documentAsset', assetId: 'b' }, alignment: 'center' }
    await act(async () => {
      root!.render(
        <>
          <BoxFlowEditor children={[{ type: 'paragraph', id: 'a-p1', content: [{ type: 'text', text: 'x' }] }, figureA]} onChange={vi.fn()} />
          <BoxFlowEditor children={[{ type: 'paragraph', id: 'b-p1', content: [{ type: 'text', text: 'y' }] }, figureB]} onChange={vi.fn()} />
        </>,
      )
    })
    const elementA = container.querySelector<HTMLElement>('[data-block-id="fig-a"]')
    const elementB = container.querySelector<HTMLElement>('[data-block-id="fig-b"]')
    const selected = (element: HTMLElement) => element.className.includes('is-selected')
    // 点击卡片一的对象：卡片一选中、卡片二清除
    await act(async () => {
      elementA!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(selected(elementA!)).toBe(true)
    expect(selected(elementB!)).toBe(false)
    // 点击卡片二的对象：卡片二选中、卡片一清除（全文档单选）
    await act(async () => {
      elementB!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(selected(elementB!)).toBe(true)
    expect(selected(elementA!)).toBe(false)
  })

  it('Shift+点击对象切换多选环，普通点击清空', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const figureA: BoxChildBlock = { type: 'figure', id: 'fig-a', asset: { type: 'documentAsset', assetId: 'a' }, alignment: 'center' }
    const figureB: BoxChildBlock = { type: 'figure', id: 'fig-b', asset: { type: 'documentAsset', assetId: 'b' }, alignment: 'center' }
    await act(async () => {
      root!.render(
        <BoxFlowEditor
          boxId="box1"
          children={[
            { type: 'paragraph', id: 'p1', content: [{ type: 'text', text: 'x' }] },
            figureA,
            figureB,
          ]}
          onChange={vi.fn()}
        />,
      )
    })
    const elementA = container.querySelector<HTMLElement>('[data-block-id="fig-a"]')
    const elementB = container.querySelector<HTMLElement>('[data-block-id="fig-b"]')
    // 多选环由 decoration 加到 NodeView 外层元素上
    const multi = (element: HTMLElement) => Boolean(element.closest('.td-block-multi-selected'))
    // Shift+点击 A、B：两者都进入多选集合
    await act(async () => {
      elementA!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: true }))
    })
    await act(async () => {
      elementB!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: true }))
    })
    expect(multi(elementA!)).toBe(true)
    expect(multi(elementB!)).toBe(true)
    // 再次 Shift+点击 A：从集合移除
    await act(async () => {
      elementA!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: true }))
    })
    expect(multi(elementA!)).toBe(false)
    expect(multi(elementB!)).toBe(true)
    // 普通点击 B：清空整个多选集合
    await act(async () => {
      elementB!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })
    expect(multi(elementA!)).toBe(false)
    expect(multi(elementB!)).toBe(false)
  })

  it('与文档编辑器共用同一 schema：全部子块类型无损往返', async () => {
    const onChange = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const allChildren: BoxChildBlock[] = [
      { type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '正文', marks: ['bold'] }] },
      { type: 'blockMath', id: 'm1', latex: 'x^2', label: '(1)' },
      { type: 'table', id: 't1', hasHeader: true, rows: [[{ content: [{ type: 'text', text: 'a' }] }]] },
      { type: 'figure', id: 'f1', asset: { type: 'documentAsset', assetId: 'a' }, alignment: 'center', widthMm: 60, lockAspectRatio: true },
      { type: 'tikz', id: 'k1', source: '\\draw (0,0);', alignment: 'center' },
      { type: 'question', id: 'q1', questionId: 'bank-1', breakBehavior: 'auto', display: { displayNumber: '1' } },
      { type: 'divider', id: 'd1' },
      { type: 'spacer', id: 's1', heightEm: 3 },
      { type: 'rawMarkdown', id: 'r1', markdown: '**混合**内容', reason: 'fallback' },
    ]
    await act(async () => {
      root!.render(<BoxFlowEditor children={allChildren} onChange={onChange} />)
    })
    // 全部类型渲染在单一流内（schema 与文档编辑器一致）
    for (const child of allChildren) {
      expect(container.querySelector(`[data-block-id="${child.id}"]`)).toBeTruthy()
    }
    // 触发一次编辑（段尾回车），校验序列化往返保持所有对象与字段
    const editor = container.querySelector<HTMLElement>('[data-box-text-editor]')
    await act(async () => {
      editor!.focus()
      editor!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))
      editor!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    const latest = onChange.mock.calls.at(-1)?.[0] as BoxChildBlock[]
    expect(latest.length).toBe(allChildren.length + 1)
    for (const original of allChildren) {
      const roundTripped = latest.find((child) => child.id === original.id)
      expect(roundTripped).toEqual(original)
    }
  })

  it('卡片连续编辑区不渲染独立文字快捷条', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(<BoxFlowEditor children={[paragraph('p1', '第一段')]} onChange={vi.fn()} />)
    })
    const editor = container.querySelector<HTMLElement>('[data-box-text-editor]')
    await act(async () => { editor!.focus() })

    expect(container.querySelector('[aria-label="公式键盘"]')).toBeNull()
    expect(container.querySelector('button[aria-label="粗体"]')).toBeNull()
  })

  it('光标变化时上报当前所在子块', async () => {
    const onActiveChildChange = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <BoxFlowEditor
          children={[paragraph('p1', '第一段'), paragraph('p2', '第二段')]}
          onChange={vi.fn()}
          onActiveChildChange={onActiveChildChange}
        />,
      )
    })
    const editor = container.querySelector<HTMLElement>('[data-box-text-editor]')
    await act(async () => {
      editor!.focus()
    })
    // 聚焦时上报当前所在段落
    expect(onActiveChildChange.mock.calls.at(-1)?.[0]).toBe('p1')
    // Enter 后光标进入新段落，上报新段落 id
    await act(async () => {
      editor!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    const newId = onActiveChildChange.mock.calls.at(-1)?.[0]
    expect(typeof newId).toBe('string')
    expect(newId).not.toBe('p1')
  })
})

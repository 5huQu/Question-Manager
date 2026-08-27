import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeachingBlock } from '@/types/teachingDocument'
import { resolveTeachingDocumentSkinPresetContext } from '@/utils/teachingDocument/skins'
import { PropertiesSheet, type SelectedLocation } from './PropertiesSheet'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function renderSheet(
  location: SelectedLocation,
  onUpdate = vi.fn(),
  onUpdateTopLevel = vi.fn(),
  options?: { pageBreakAfter?: boolean; onSetPageBreakAfter?: (blockId: string, enabled: boolean) => void; presetContext?: ReturnType<typeof resolveTeachingDocumentSkinPresetContext> },
) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  return act(async () => {
    root!.render(
      <PropertiesSheet
        open
        selected={location}
        presetContext={options?.presetContext}
        onClose={vi.fn()}
        onUpdate={onUpdate}
        onUpdateTopLevel={onUpdateTopLevel}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onMove={vi.fn()}
        pageBreakAfter={options?.pageBreakAfter}
        onSetPageBreakAfter={options?.onSetPageBreakAfter}
        onInsertChild={vi.fn()}
        onDeleteBoxChildren={vi.fn()}
        onMergeBoxParagraphs={vi.fn()}
        onSelect={vi.fn()}
        onUpload={vi.fn()}
        onInsertImageInRawMarkdown={vi.fn()}
        onRenderTikz={vi.fn()}
        onQuestionLoaded={vi.fn()}
      />,
    )
  })
}

describe('PropertiesSheet 对齐与卡片内容列表', () => {
  it('filters Heading and Box skin selectors and clears the explicit ref for the default option', async () => {
    const skinTiles = () => Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="皮肤"] [role="radio"]'))
    const tileByLabel = (label: string) => skinTiles().find((tile) => tile.getAttribute('aria-label') === label)

    const onHeadingUpdate = vi.fn()
    const heading = { type: 'heading' as const, id: 'heading-skin', level: 2 as const, content: [{ type: 'text' as const, text: '标题' }] }
    await renderSheet({ block: heading, topLevel: heading }, onHeadingUpdate)
    expect(skinTiles().map((tile) => tile.getAttribute('aria-label'))).toContain('圆角标签标题')
    expect(skinTiles().map((tile) => tile.getAttribute('aria-label'))).not.toContain('深色标题带')
    expect(tileByLabel('默认')?.getAttribute('aria-checked')).toBe('true')
    await act(async () => {
      tileByLabel('圆角标签标题')?.click()
    })
    expect(onHeadingUpdate).toHaveBeenCalledWith({ skin: { id: 'builtin.heading.pill', version: 1 } })

    const onBoxUpdate = vi.fn()
    const box = { type: 'box' as const, id: 'box-skin', templateId: 'concept', breakBehavior: 'auto' as const, skin: { id: 'builtin.box.left-accent', version: 1 }, children: [] }
    await renderSheet({ block: box, topLevel: box }, onBoxUpdate)
    const styleTab = Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent === '样式')
    await act(async () => styleTab?.click())
    expect(skinTiles().map((tile) => tile.getAttribute('aria-label'))).toContain('深色标题带')
    expect(skinTiles().map((tile) => tile.getAttribute('aria-label'))).not.toContain('圆角标签标题')
    expect(tileByLabel('左侧强调线')?.getAttribute('aria-checked')).toBe('true')
    await act(async () => {
      tileByLabel('默认')?.click()
    })
    expect(onBoxUpdate).toHaveBeenCalledWith({ skin: undefined })

    const variantBox = { ...box, skin: { ...box.skin!, variant: 'green' } }
    const onVariantSkinUpdate = vi.fn()
    await renderSheet({ block: variantBox, topLevel: variantBox }, onVariantSkinUpdate)
    const variantStyleTab = Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent === '样式')
    await act(async () => variantStyleTab?.click())
    await act(async () => {
      tileByLabel('深色标题带')?.click()
    })
    expect(onVariantSkinUpdate).toHaveBeenCalledWith({ skin: { id: 'builtin.box.header-band', version: 1 } })
  })

  it('offers Follow document and local Variants without persisting a Base sentinel', async () => {
    const onUpdate = vi.fn()
    const box = { type: 'box' as const, id: 'box-variant', templateId: 'concept', breakBehavior: 'auto' as const, skin: { id: 'builtin.box.left-accent', version: 1 }, children: [] }
    await renderSheet({ block: box, topLevel: box }, onUpdate, vi.fn(), { presetContext: resolveTeachingDocumentSkinPresetContext({ id: 'builtin.preset.warm', version: 1 }) })
    const styleTab = Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent === '样式')
    await act(async () => styleTab?.click())
    expect(container!.textContent).toContain('当前：绿色')
    expect(container!.textContent).toContain('来源：Warm · v1')
    const variantGroup = container!.querySelector('[role="radiogroup"][aria-label="局部样式配色"]')
    expect(variantGroup).not.toBeNull()
    const greenSwatch = Array.from(variantGroup!.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.getAttribute('aria-label') === '绿色')
    expect(greenSwatch).toBeDefined()
    await act(async () => {
      greenSwatch!.click()
    })
    expect(onUpdate).toHaveBeenCalledWith({ skin: { id: 'builtin.box.left-accent', version: 1, variant: 'green' } })

    const unknownUpdate = vi.fn()
    const unknownBox = { ...box, skin: { ...box.skin, variant: 'futureVariant' } }
    await renderSheet({ block: unknownBox, topLevel: unknownBox }, unknownUpdate)
    const unknownStyleTab = Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent === '样式')
    await act(async () => unknownStyleTab?.click())
    expect(container!.textContent).toContain('局部样式不可用：futureVariant')
    expect(unknownUpdate).not.toHaveBeenCalled()
    const restore = Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === '跟随整体')
    await act(async () => restore?.click())
    expect(unknownUpdate).toHaveBeenCalledWith({ skin: { id: 'builtin.box.left-accent', version: 1 } })
    for (const call of unknownUpdate.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('"base"')
      expect(JSON.stringify(call)).not.toContain('"default"')
      expect(JSON.stringify(call)).not.toContain('"inherit"')
      expect(JSON.stringify(call)).not.toContain('null')
    }

    const zeroVariantUnknownUpdate = vi.fn()
    const zeroVariantUnknownBox = { ...box, skin: { id: 'builtin.box.header-band', version: 1, variant: 'futureVariant' } }
    await renderSheet({ block: zeroVariantUnknownBox, topLevel: zeroVariantUnknownBox }, zeroVariantUnknownUpdate)
    const zeroVariantUnknownStyleTab = Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent === '样式')
    await act(async () => zeroVariantUnknownStyleTab?.click())
    expect(container!.textContent).toContain('当前：futureVariant')
    expect(container!.textContent).toContain('局部样式不可用：futureVariant')
    expect(container!.querySelector('[role="radiogroup"][aria-label="局部样式配色"]')).toBeNull()
    expect(zeroVariantUnknownUpdate).not.toHaveBeenCalled()
    const zeroVariantRestore = Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === '恢复跟随整体')
    await act(async () => zeroVariantRestore?.click())
    expect(zeroVariantUnknownUpdate).toHaveBeenCalledWith({ skin: { id: 'builtin.box.header-band', version: 1 } })

    const zeroVariantBox = { ...box, skin: { id: 'builtin.box.header-band', version: 1 } }
    await renderSheet({ block: zeroVariantBox, topLevel: zeroVariantBox })
    const zeroVariantStyleTab = Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent === '样式')
    await act(async () => zeroVariantStyleTab?.click())
    expect(container!.textContent).not.toContain('局部样式')
    expect(container!.querySelector('[role="radiogroup"][aria-label="局部样式配色"]')).toBeNull()
  })

  it('在卡片样式页提供可预览的标题图标选择，并保留跟随模板选项', async () => {
    const onUpdate = vi.fn()
    const box = { type: 'box' as const, id: 'box-icon', templateId: 'concept', breakBehavior: 'auto' as const, children: [] }
    await renderSheet({ block: box, topLevel: box }, onUpdate)
    const styleTab = Array.from(container!.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === '样式')
    await act(async () => styleTab?.click())

    const iconGroup = container!.querySelector('[role="radiogroup"][aria-label="卡片标题图标"]')
    expect(iconGroup).not.toBeNull()
    const followTemplate = Array.from(iconGroup!.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
      .find((button) => button.getAttribute('aria-label')?.startsWith('跟随模板'))
    expect(followTemplate?.getAttribute('aria-checked')).toBe('true')
    const practice = Array.from(iconGroup!.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
      .find((button) => button.getAttribute('aria-label') === '练习')
    await act(async () => practice?.click())
    expect(onUpdate).toHaveBeenCalledWith({ icon: 'Pencil' })
  })

  it('将样式标签置于内容之前，并将卡片默认定位到样式页', async () => {
    const box = { type: 'box' as const, id: 'box-style-structure', templateId: 'concept', breakBehavior: 'auto' as const, children: [] }
    await renderSheet({ block: box, topLevel: box })
    expect(Array.from(container!.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent)).toEqual(['样式', '内容', '布局'])
    expect(container!.textContent).toContain('卡片模板')
    expect(container!.querySelector('[role="radiogroup"][aria-label="皮肤"]')).not.toBeNull()
    expect(container!.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('样式')
  })

  it('在布局页用显式标记控制对象后的强制换页', async () => {
    const onSetPageBreakAfter = vi.fn()
    const figure = {
      type: 'figure' as const,
      id: 'fig-page-break',
      asset: { type: 'documentAsset' as const, assetId: 'a' },
      alignment: 'center' as const,
    }
    await renderSheet({ block: figure, topLevel: figure }, vi.fn(), vi.fn(), { pageBreakAfter: true, onSetPageBreakAfter })
    const layoutTab = Array.from(container!.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === '布局')
    await act(async () => layoutTab?.click())
    const input = container!.querySelector<HTMLInputElement>('input[aria-label="在此对象后强制换页"]')
    expect(input?.checked).toBe(true)
    await act(async () => {
      input!.click()
    })
    expect(onSetPageBreakAfter).toHaveBeenCalledWith('fig-page-break', false)
  })

  it('卡片内对象的换页标记写在所属卡片之后', async () => {
    const onSetPageBreakAfter = vi.fn()
    const box: TeachingBlock = {
      type: 'box', id: 'box-page-break', templateId: 'concept', breakBehavior: 'auto', children: [
        { type: 'figure', id: 'child-figure', asset: { type: 'documentAsset', assetId: 'a' }, alignment: 'center' },
      ],
    }
    await renderSheet({ block: box.children[0] as TeachingBlock, topLevel: box, boxId: box.id }, vi.fn(), vi.fn(), { onSetPageBreakAfter })
    const layoutTab = Array.from(container!.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === '布局')
    await act(async () => layoutTab?.click())
    const input = container!.querySelector<HTMLInputElement>('input[aria-label="在此对象后强制换页"]')
    await act(async () => input!.click())
    expect(onSetPageBreakAfter).toHaveBeenCalledWith('box-page-break', true)
  })

  it('图片“对齐”修改同时清除 layoutPreset（否则 preset 优先导致不生效）', async () => {
    const onUpdate = vi.fn()
    const figure = {
      type: 'figure' as const,
      id: 'fig1',
      asset: { type: 'documentAsset' as const, assetId: 'a' },
      alignment: 'center' as const,
      layoutPreset: 'block-center' as const,
      widthMm: 80,
    }
    await renderSheet({ block: figure, topLevel: figure }, onUpdate)
    const alignSelect = Array.from(container!.querySelectorAll<HTMLSelectElement>('select'))
      .find((select) => select.value === 'center' || select.value === 'left' || select.value === 'right')
    expect(alignSelect).toBeTruthy()
    await act(async () => {
      alignSelect!.value = 'left'
      alignSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ alignment: 'left', layoutPreset: undefined }))
  })

  it('TikZ“对齐”修改同时清除 layoutPreset', async () => {
    const onUpdate = vi.fn()
    const tikz = {
      type: 'tikz' as const,
      id: 'tikz1',
      source: '\\draw (0,0);',
      alignment: 'center' as const,
      layoutPreset: 'block-center' as const,
      widthMm: 80,
      alt: '',
      caption: '',
    }
    await renderSheet({ block: tikz, topLevel: tikz }, onUpdate)
    const selects = container!.querySelectorAll<HTMLSelectElement>('select')
    const alignSelect = selects[1]
    expect(alignSelect).toBeTruthy()
    await act(async () => {
      alignSelect.value = 'left'
      alignSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ alignment: 'left', layoutPreset: undefined }),
      expect.any(String),
    )
  })

  it('卡片内容列表把连续段落合并为一项“正文段落”', async () => {
    const box: TeachingBlock = {
      type: 'box',
      id: 'box1',
      templateId: 'concept',
      title: '知识卡片',
      breakBehavior: 'auto',
      children: [
        { type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '一' }] },
        { type: 'paragraph', id: 'p2', content: [{ type: 'text', text: '二' }] },
        { type: 'paragraph', id: 'p3', content: [{ type: 'text', text: '三' }] },
        { type: 'figure', id: 'fig1', asset: { type: 'documentAsset', assetId: 'a' }, alignment: 'center' },
      ],
    }
    await renderSheet({ block: box, topLevel: box })
    const contentTab = Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent === '内容')
    await act(async () => contentTab?.click())
    const list = container!.textContent || ''
    expect(list).toContain('正文段落 ×3')
    expect(list).toContain('图片')
    // 列表条目按“正文段落（合并）+ 图片”呈现，不再逐段落列出独立对象
    const entries = Array.from(container!.querySelectorAll('input[type="checkbox"]'))
      .map((input) => input.getAttribute('aria-label'))
      .filter(Boolean)
    expect(entries).toEqual(['选择第 1 项正文段落 ×3', '选择第 2 项图片'])
  })

  it('卡片内容列表：图片插入两段之间时段落组正确拆分', async () => {
    const box: TeachingBlock = {
      type: 'box',
      id: 'box1',
      templateId: 'concept',
      title: '知识卡片',
      breakBehavior: 'auto',
      children: [
        { type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '一' }] },
        { type: 'figure', id: 'fig1', asset: { type: 'documentAsset', assetId: 'a' }, alignment: 'center' },
        { type: 'paragraph', id: 'p2', content: [{ type: 'text', text: '二' }] },
      ],
    }
    await renderSheet({ block: box, topLevel: box })
    const contentTab = Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent === '内容')
    await act(async () => contentTab?.click())
    const entries = Array.from(container!.querySelectorAll('input[type="checkbox"]'))
      .map((input) => input.getAttribute('aria-label'))
      .filter(Boolean)
    // 图片两侧的段落各自成组，互不合并
    expect(entries).toEqual(['选择第 1 项正文段落', '选择第 2 项图片', '选择第 3 项正文段落'])
  })

  it('选中卡片内段落时显示卡片页而非段落对象页（卡片=文本框对象）', async () => {
    const box: TeachingBlock = {
      type: 'box',
      id: 'box1',
      templateId: 'concept',
      title: '知识卡片',
      breakBehavior: 'auto',
      children: [
        { type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '卡片正文' }] },
      ],
    }
    await renderSheet({ block: box.children[0] as TeachingBlock, topLevel: box, boxId: 'box1' })
    const contentTab = Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent === '内容')
    await act(async () => contentTab?.click())
    const text = container!.textContent || ''
    // 面板标题与内容都是卡片页
    expect(container!.querySelector('aside span')?.textContent).toBe('知识卡片')
    expect(text).toContain('卡片标题')
    expect(text).toContain('正文段落')
    // 不再显示单段文字编辑器（对象页）
    expect(container!.querySelector('[data-block-inline-editor]')).toBeNull()
  })

  it('卡片内段落的卡片设置写回父卡片，覆盖内容、样式和布局页签', async () => {
    const onUpdate = vi.fn()
    const onUpdateTopLevel = vi.fn()
    const box: TeachingBlock = {
      type: 'box',
      id: 'box1',
      templateId: 'concept',
      title: '知识卡片',
      breakBehavior: 'auto',
      children: [{ type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '卡片正文' }] }],
    }
    await renderSheet({ block: box.children[0] as TeachingBlock, topLevel: box, boxId: box.id }, onUpdate, onUpdateTopLevel)

    const styleTab = Array.from(container!.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === '样式')
    await act(async () => styleTab?.click())
    const templateSelect = Array.from(container!.querySelectorAll<HTMLLabelElement>('label'))
      .find((label) => label.textContent?.includes('卡片模板'))
      ?.querySelector<HTMLSelectElement>('select')
    expect(templateSelect).toBeTruthy()
    await act(async () => {
      templateSelect!.value = 'warning'
      templateSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onUpdateTopLevel).toHaveBeenCalledWith({ templateId: 'warning' })
    const backgroundSelect = Array.from(container!.querySelectorAll<HTMLLabelElement>('label'))
      .find((label) => label.textContent?.includes('卡片底色'))
      ?.querySelector<HTMLSelectElement>('select')
    expect(backgroundSelect).toBeTruthy()
    await act(async () => {
      backgroundSelect!.value = 'blue'
      backgroundSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onUpdateTopLevel).toHaveBeenCalledWith({ appearance: { background: 'blue' } }, 'box-appearance:box1')

    const layoutTab = Array.from(container!.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === '布局')
    await act(async () => layoutTab?.click())
    const breakBehavior = Array.from(container!.querySelectorAll<HTMLLabelElement>('label'))
      .find((label) => label.textContent?.includes('跨页方式'))
      ?.querySelector<HTMLSelectElement>('select')
    expect(breakBehavior).toBeTruthy()
    await act(async () => {
      breakBehavior!.value = 'avoid'
      breakBehavior!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onUpdateTopLevel).toHaveBeenCalledWith({ breakBehavior: 'avoid' })
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

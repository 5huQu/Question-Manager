import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { defineTeachingSkinPreset, teachingSkinPresetRegistry } from '@/utils/teachingDocument/skins'
import { DocumentStyleWorkspace, teachingDocumentLocalOverrides, teachingDocumentSkinUsages, teachingDocumentStyleMappings, withTeachingDocumentPreset } from './DocumentStyleWorkspace'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const baseDocument: TeachingDocumentV1 = {
  version: 1,
  documentType: 'lecture',
  title: '函数讲义',
  metadata: {},
  content: [
    { type: 'heading', id: 'heading-1', level: 2, content: [{ type: 'text', text: '函数概念' }], skin: { id: 'builtin.heading.left-accent', version: 1 } },
    { type: 'box', id: 'box-1', templateId: 'concept', title: '提示', breakBehavior: 'auto', skin: { id: 'builtin.box.left-accent', version: 1 }, children: [] },
    { type: 'heading', id: 'plain-heading', level: 2, content: [{ type: 'text', text: '普通标题' }] },
  ],
}

let container: HTMLDivElement | null = null
let root: Root | null = null

async function renderWorkspace(document: TeachingDocumentV1, onDocumentChange = vi.fn()) {
  container = documentGlobal.createElement('div')
  documentGlobal.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root!.render(<DocumentStyleWorkspace document={document} onDocumentChange={onDocumentChange} />))
  return onDocumentChange
}

const documentGlobal = globalThis.document

function warmCard(version: number) {
  return Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('Warm') && button.textContent?.includes(`v${version}`))
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

describe('DocumentStyleWorkspace', () => {
  it('shows Default for an unpinned document and persists only an exact Preset ref after a card click', async () => {
    const onDocumentChange = await renderWorkspace(baseDocument)
    const defaultCard = Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('默认'))
    expect(defaultCard?.getAttribute('aria-pressed')).toBe('true')
    await act(async () => warmCard(1)?.click())
    expect(onDocumentChange).toHaveBeenCalledWith(expect.objectContaining({ design: { preset: { id: 'builtin.preset.warm', version: 1 } } }))
  })

  it('does not replace the document when the already selected Preset card is clicked', async () => {
    const defaultChange = await renderWorkspace(baseDocument)
    const defaultCard = Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('默认'))
    await act(async () => defaultCard?.click())
    expect(defaultChange).not.toHaveBeenCalled()
  })

  it('does not replace the document when the exact current Preset version is clicked', async () => {
    const onDocumentChange = await renderWorkspace({ ...baseDocument, design: { preset: { id: 'builtin.preset.warm', version: 1 } } })
    const currentPreset = Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('Warm') && button.getAttribute('aria-pressed') === 'true')
    await act(async () => currentPreset?.click())
    expect(onDocumentChange).not.toHaveBeenCalled()
  })

  it('only applies recommended Skins after the explicit action, without materializing Variants', async () => {
    const document = structuredClone(baseDocument)
    const heading = document.content[0]
    const box = document.content[1]
    if (heading?.type === 'heading') delete heading.skin
    if (box?.type === 'box') delete box.skin
    const onDocumentChange = await renderWorkspace(document)

    await act(async () => warmCard(2)?.click())
    const afterPresetSelection = onDocumentChange.mock.calls[0]?.[0] as TeachingDocumentV1
    expect(afterPresetSelection.design).toEqual({ preset: { id: 'builtin.preset.warm', version: 2 } })
    expect(afterPresetSelection.content[0]).not.toHaveProperty('skin')
    expect(afterPresetSelection.content[1]).not.toHaveProperty('skin')

    await act(async () => root!.render(<DocumentStyleWorkspace document={afterPresetSelection} onDocumentChange={onDocumentChange} />))
    expect(container!.textContent).toContain('推荐设置')
    expect(container!.textContent).toContain('章节标题')
    expect(container!.textContent).toContain('知识卡')
    expect(container!.textContent).toContain('应用到')
    const apply = Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('应用到'))
    expect(apply).toBeDefined()
    await act(async () => apply!.click())

    expect(onDocumentChange).toHaveBeenCalledTimes(2)
    const afterApply = onDocumentChange.mock.calls[1]?.[0] as TeachingDocumentV1
    expect(afterApply.content[0]).toMatchObject({ skin: { id: 'builtin.heading.left-accent', version: 1 } })
    expect(afterApply.content[1]).toMatchObject({ skin: { id: 'builtin.box.left-accent', version: 1 } })
    expect((afterApply.content[0] as { skin?: { variant?: string } }).skin?.variant).toBeUndefined()
    expect((afterApply.content[1] as { skin?: { variant?: string } }).skin?.variant).toBeUndefined()
  })

  it('lets users apply a recommended target independently', async () => {
    const document = structuredClone(baseDocument)
    const heading = document.content[0]
    const box = document.content[1]
    if (heading?.type === 'heading') delete heading.skin
    if (box?.type === 'box') delete box.skin
    document.design = { preset: { id: 'builtin.preset.warm', version: 2 } }
    const onDocumentChange = await renderWorkspace(document)

    const headingCheckbox = container!.querySelector<HTMLInputElement>('input[aria-label="应用推荐章节标题"]')
    expect(headingCheckbox).toBeDefined()
    await act(async () => headingCheckbox!.click())
    expect(container!.textContent).toContain('应用到')
    const apply = Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('应用到'))
    expect(apply).toBeDefined()
    await act(async () => apply!.click())
    const afterApply = onDocumentChange.mock.calls[0]?.[0] as TeachingDocumentV1
    expect(afterApply.content[0]).not.toHaveProperty('skin')
    expect(afterApply.content[1]).toMatchObject({ skin: { id: 'builtin.box.left-accent', version: 1 } })
  })

  it('clears the Preset without leaving an empty design object and preserves explicit block variants', async () => {
    const document = structuredClone(baseDocument)
    document.design = { preset: { id: 'builtin.preset.warm', version: 1 } }
    const box = document.content[1]
    if (box?.type === 'box') box.skin = { ...box.skin!, variant: 'green' }
    const onDocumentChange = await renderWorkspace(document)
    const defaultCard = Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('默认'))
    await act(async () => defaultCard?.click())
    const next = onDocumentChange.mock.calls.at(-1)?.[0] as TeachingDocumentV1
    expect(next.design).toBeUndefined()
    expect((next.content[1] as Extract<TeachingDocumentV1['content'][number], { type: 'box' }>).skin?.variant).toBe('green')
  })

  it('keeps an unavailable saved Preset visible without mutating it on render', async () => {
    const onDocumentChange = await renderWorkspace({ ...baseDocument, design: { preset: { id: 'plugin.preset.future', version: 3 } } })
    expect(container!.textContent).toContain('当前样式不可用')
    expect(container!.textContent).toContain('plugin.preset.future')
    expect(container!.textContent).not.toContain('推荐设置')
    expect(onDocumentChange).not.toHaveBeenCalled()
  })

  it('replaces or clears an unavailable Preset only after an explicit card choice', async () => {
    const unknown = { ...baseDocument, design: { preset: { id: 'plugin.preset.future', version: 3 } } }
    const onDocumentChange = await renderWorkspace(unknown)
    await act(async () => warmCard(1)?.click())
    expect(onDocumentChange).toHaveBeenLastCalledWith(expect.objectContaining({ design: { preset: { id: 'builtin.preset.warm', version: 1 } } }))
    const defaultCard = Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('默认'))
    await act(async () => defaultCard?.click())
    expect((onDocumentChange.mock.calls.at(-1)?.[0] as TeachingDocumentV1).design).toBeUndefined()
  })

  it('keeps Warm v1 and v2 distinct: only v2 exposes Recommended Style Setup', async () => {
    await renderWorkspace({ ...baseDocument, design: { preset: { id: 'builtin.preset.warm', version: 1 } } })
    expect(warmCard(1)?.getAttribute('aria-pressed')).toBe('true')
    expect(container!.textContent).toContain('v2')
    expect(container!.textContent).not.toContain('推荐设置')

    await act(async () => root!.render(<DocumentStyleWorkspace document={{ ...baseDocument, design: { preset: { id: 'builtin.preset.warm', version: 2 } } }} onDocumentChange={vi.fn()} />))
    expect(warmCard(2)?.getAttribute('aria-pressed')).toBe('true')
    expect(container!.textContent).toContain('推荐设置')
  })

  it('does not infer Recommended Style Setup from bindings when a Preset has no metadata', async () => {
    if (!teachingSkinPresetRegistry.get('builtin.preset.no-recommendation', 1)) {
      teachingSkinPresetRegistry.register(defineTeachingSkinPreset({
        id: 'builtin.preset.no-recommendation', version: 1, label: 'No recommendation',
        bindings: { 'builtin.heading.left-accent': 'amber' },
      }))
    }
    await renderWorkspace({ ...baseDocument, design: { preset: { id: 'builtin.preset.no-recommendation', version: 1 } } })
    expect(container!.textContent).not.toContain('推荐设置')
  })

  it('summarizes inherited Preset contributions and local overrides without styling unskinned blocks', () => {
    const document = structuredClone(baseDocument)
    document.design = { preset: { id: 'builtin.preset.warm', version: 1 } }
    const box = document.content[1]
    if (box?.type === 'box') box.skin = { ...box.skin!, variant: 'green' }
    expect(teachingDocumentStyleMappings(document)).toEqual(expect.arrayContaining([
      expect.objectContaining({ skinId: 'builtin.heading.left-accent', variantId: 'amber', affectedCount: 1 }),
      expect.objectContaining({ skinId: 'builtin.box.left-accent', variantId: 'green', affectedCount: 0 }),
    ]))
    expect(teachingDocumentLocalOverrides(document)).toEqual([expect.objectContaining({ blockId: 'box-1', variantId: 'green' })])
    expect(withTeachingDocumentPreset(document).content).toEqual(document.content)
  })

  it('lists every Skin actually attached to headings and knowledge cards, even without a Preset', async () => {
    const document = structuredClone(baseDocument)
    const box = document.content[1]
    if (box?.type === 'box') box.skin = { id: 'builtin.box.header-band', version: 1 }

    expect(teachingDocumentSkinUsages(document)).toEqual(expect.arrayContaining([
      expect.objectContaining({ blockLabel: '标题', skinId: 'builtin.heading.left-accent', skinLabel: '左侧强调线', source: 'base', count: 1 }),
      expect.objectContaining({ blockLabel: '知识卡片', skinId: 'builtin.box.header-band', skinLabel: '深色标题带', source: 'base', count: 1 }),
    ]))

    await renderWorkspace(document)
    expect(container!.textContent).toContain('文档皮肤')
    expect(container!.textContent).toContain('知识卡片 · 深色标题带')
    expect(container!.textContent).toContain('当前：皮肤基础样式')
  })

  it('reports Preset and local Variant sources separately for used Skins', () => {
    const document = structuredClone(baseDocument)
    document.design = { preset: { id: 'builtin.preset.warm', version: 1 } }
    const box = document.content[1]
    if (box?.type === 'box') box.skin = { ...box.skin!, variant: 'green' }

    expect(teachingDocumentSkinUsages(document)).toEqual(expect.arrayContaining([
      expect.objectContaining({ skinId: 'builtin.heading.left-accent', variantId: 'amber', source: 'preset' }),
      expect.objectContaining({ skinId: 'builtin.box.left-accent', variantId: 'green', source: 'explicit' }),
    ]))
  })
})

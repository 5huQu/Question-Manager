import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { defineTeachingSkinPreset, teachingSkinPresetRegistry } from '@/utils/teachingDocument/skins'
import { DocumentStyleWorkspace, teachingDocumentLocalOverrides, teachingDocumentStyleMappings, withTeachingDocumentPreset } from './DocumentStyleWorkspace'

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
    const warmCard = Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('Warm'))
    await act(async () => warmCard?.click())
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
    expect(onDocumentChange).not.toHaveBeenCalled()
  })

  it('replaces or clears an unavailable Preset only after an explicit card choice', async () => {
    const unknown = { ...baseDocument, design: { preset: { id: 'plugin.preset.future', version: 3 } } }
    const onDocumentChange = await renderWorkspace(unknown)
    const warmCard = Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('Warm'))
    await act(async () => warmCard?.click())
    expect(onDocumentChange).toHaveBeenLastCalledWith(expect.objectContaining({ design: { preset: { id: 'builtin.preset.warm', version: 1 } } }))
    const defaultCard = Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('默认'))
    await act(async () => defaultCard?.click())
    expect((onDocumentChange.mock.calls.at(-1)?.[0] as TeachingDocumentV1).design).toBeUndefined()
  })

  it('keeps exact versions distinct instead of selecting a latest version', async () => {
    if (!teachingSkinPresetRegistry.get('builtin.preset.warm', 2)) {
      teachingSkinPresetRegistry.register(defineTeachingSkinPreset({
        id: 'builtin.preset.warm', version: 2, label: 'Warm', description: '新版暖色组合。',
        bindings: { 'builtin.heading.left-accent': 'amber', 'builtin.box.left-accent': 'green' },
      }))
    }
    await renderWorkspace({ ...baseDocument, design: { preset: { id: 'builtin.preset.warm', version: 1 } } })
    const selected = Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('Warm') && button.getAttribute('aria-pressed') === 'true')
    expect(selected?.textContent).toContain('v1')
    expect(container!.textContent).toContain('v2')
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
})

import { describe, expect, it } from 'vitest'
import { teachingSkinRegistry } from './registryInstance'
import {
  TeachingSkinPresetRegistry,
  isTeachingSkinPresetDefinition,
  parseTeachingSkinPresetRef,
  resolveTeachingSkinPreset,
} from './presets'
import { resolveTeachingDocumentSkinPresetContext, resolveTeachingSkinVariantSelection, teachingDocumentHeadingSkinDesignSignature } from './designRendering'

const warmV1 = {
  apiVersion: 1 as const,
  id: 'builtin.preset.warm',
  version: 1,
  label: 'Warm',
  bindings: {
    'builtin.heading.left-accent': 'amber',
    'builtin.box.left-accent': 'green',
  },
  recommendedSkins: {
    heading: 'builtin.heading.left-accent',
    box: 'builtin.box.left-accent',
  },
}

describe('Teaching Skin Presets', () => {
  it('registers multiple versions and resolves only the exact pinned version', () => {
    const registry = new TeachingSkinPresetRegistry()
    registry.register(warmV1)
    registry.register({ ...warmV1, version: 2, label: 'Warm v2', bindings: { 'builtin.heading.left-accent': 'amber' } })
    expect(resolveTeachingSkinPreset(registry, { id: warmV1.id, version: 1 }, teachingSkinRegistry).status).toBe('resolved')
    expect(resolveTeachingSkinPreset(registry, { id: warmV1.id, version: 3 }, teachingSkinRegistry)).toMatchObject({ status: 'unavailable', issues: [{ code: 'preset-version-missing' }] })
    expect(() => registry.register(warmV1)).toThrow(/already registered/)
  })

  it('validates source and persistence contracts without registry availability', () => {
    expect(isTeachingSkinPresetDefinition(warmV1)).toBe(true)
    expect(isTeachingSkinPresetDefinition({ ...warmV1, bindings: {} })).toBe(false)
    expect(isTeachingSkinPresetDefinition({ ...warmV1, extra: true })).toBe(false)
    expect(isTeachingSkinPresetDefinition({ ...warmV1, recommendedSkins: { paragraph: 'builtin.heading.left-accent' } })).toBe(false)
    expect(parseTeachingSkinPresetRef({ id: 'plugin.preset.future', version: 3 })).toEqual({ id: 'plugin.preset.future', version: 3 })
    expect(parseTeachingSkinPresetRef({ id: 'plugin.preset.future' })).toBeUndefined()
    expect(parseTeachingSkinPresetRef({ id: 'plugin.preset.future', version: 3, bindings: {} })).toBeUndefined()
  })

  it('fails closed when any binding dependency is unavailable', () => {
    const registry = new TeachingSkinPresetRegistry()
    registry.register({ ...warmV1, bindings: { 'builtin.heading.left-accent': 'amber', 'builtin.box.left-accent': 'futureVariant' } })
    expect(resolveTeachingSkinPreset(registry, { id: warmV1.id, version: 1 }, teachingSkinRegistry)).toMatchObject({ status: 'unavailable', bindings: {}, issues: [{ code: 'preset-dependency-missing' }] })
  })

  it('fails closed when a registered source object mutates away from its exact identity', () => {
    for (const mutation of [
      (preset: { id: string; version: number }) => { preset.version = 2 },
      (preset: { id: string; version: number }) => { preset.id = 'builtin.preset.other' },
    ]) {
      const registry = new TeachingSkinPresetRegistry()
      const preset = { ...warmV1, bindings: { ...warmV1.bindings } }
      registry.register(preset)
      mutation(preset)
      expect(resolveTeachingSkinPreset(registry, { id: warmV1.id, version: 1 }, teachingSkinRegistry)).toMatchObject({ status: 'unavailable', issues: [{ code: 'preset-invalid' }] })
    }
  })

  it('keeps Preset rendering available when only a source recommendation becomes unusable', () => {
    const registry = new TeachingSkinPresetRegistry()
    registry.register({ ...warmV1, recommendedSkins: { heading: 'plugin.heading.missing', box: 'builtin.box.left-accent' } })
    expect(resolveTeachingSkinPreset(registry, { id: warmV1.id, version: 1 }, teachingSkinRegistry)).toMatchObject({
      status: 'resolved',
      bindings: warmV1.bindings,
    })
  })

  it('uses preview, explicit Variant, Preset, and Base in the documented order', () => {
    const skin = { id: 'builtin.heading.left-accent' }
    const bindings = { 'builtin.heading.left-accent': 'amber' }
    expect(resolveTeachingSkinVariantSelection(skin, skin.id, undefined, bindings)).toEqual({ requestedVariantId: 'amber', source: 'preset' })
    expect(resolveTeachingSkinVariantSelection({ ...skin, variant: 'futureVariant' }, skin.id, undefined, bindings)).toEqual({ requestedVariantId: 'futureVariant', source: 'explicit' })
    expect(resolveTeachingSkinVariantSelection({ ...skin, variant: 'green' }, skin.id, { [skin.id]: null }, bindings)).toEqual({ source: 'preview-base' })
    expect(resolveTeachingSkinVariantSelection({ ...skin, variant: 'green' }, skin.id, { [skin.id]: undefined }, bindings)).toEqual({ requestedVariantId: 'green', source: 'explicit' })
  })

  it('keeps narrow Preset and Heading design dependencies stable for unrelated document edits', () => {
    const source = {
      version: 1 as const, documentType: 'lecture' as const, title: '标题', metadata: {},
      design: { preset: { id: 'builtin.preset.warm', version: 1 } },
      content: [
        { type: 'paragraph' as const, id: 'p', content: [{ type: 'text' as const, text: '初始正文' }] },
        { type: 'heading' as const, id: 'h', level: 2 as const, content: [{ type: 'text' as const, text: '标题' }], skin: { id: 'builtin.heading.left-accent', variant: undefined as string | undefined } },
      ],
    }
    const paragraphEdited = structuredClone(source)
    paragraphEdited.content[0].content[0].text = '编辑后的正文'
    expect(teachingDocumentHeadingSkinDesignSignature(paragraphEdited)).toBe(teachingDocumentHeadingSkinDesignSignature(source))
    expect(resolveTeachingDocumentSkinPresetContext(paragraphEdited.design.preset).bindings).toEqual(resolveTeachingDocumentSkinPresetContext(source.design.preset).bindings)

    const headingTextEdited = structuredClone(source)
    const headingTextEditedHeading = headingTextEdited.content[1]
    if (headingTextEditedHeading?.type === 'heading') headingTextEditedHeading.content[0].text = '编辑后的标题'
    expect(teachingDocumentHeadingSkinDesignSignature(headingTextEdited)).toBe(teachingDocumentHeadingSkinDesignSignature(source))

    const secondHeading = {
      type: 'heading' as const,
      id: 'h-2',
      level: 2 as const,
      content: [{ type: 'text' as const, text: '第二个标题' }],
      skin: { id: 'builtin.heading.left-accent', variant: undefined as string | undefined },
    }
    const orderedHeadings = { ...source, content: [source.content[0], source.content[1], secondHeading] }
    const reorderedHeadings = { ...orderedHeadings, content: [orderedHeadings.content[0], orderedHeadings.content[2], orderedHeadings.content[1]] }
    expect(teachingDocumentHeadingSkinDesignSignature(reorderedHeadings)).not.toBe(teachingDocumentHeadingSkinDesignSignature(orderedHeadings))

    const paragraphInsertedBeforeHeading = {
      ...source,
      content: [
        { type: 'paragraph' as const, id: 'p-before', content: [{ type: 'text' as const, text: '插入的正文' }] },
        ...source.content,
      ],
    }
    expect(teachingDocumentHeadingSkinDesignSignature(paragraphInsertedBeforeHeading)).not.toBe(teachingDocumentHeadingSkinDesignSignature(source))

    const changedPreset = structuredClone(source)
    changedPreset.design.preset.version = 2
    const changedHeading = structuredClone(source)
    const heading = changedHeading.content[1]
    if (heading?.type === 'heading') heading.skin = { ...heading.skin, variant: 'amber' }
    expect(teachingDocumentHeadingSkinDesignSignature(changedPreset)).not.toBe(teachingDocumentHeadingSkinDesignSignature(source))
    expect(teachingDocumentHeadingSkinDesignSignature(changedHeading)).not.toBe(teachingDocumentHeadingSkinDesignSignature(source))
  })
})

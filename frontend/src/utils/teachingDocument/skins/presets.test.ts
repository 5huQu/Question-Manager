import { describe, expect, it } from 'vitest'
import { teachingSkinRegistry } from './registryInstance'
import {
  TeachingSkinPresetRegistry,
  isTeachingSkinPresetDefinition,
  parseTeachingSkinPresetRef,
  resolveTeachingSkinPreset,
} from './presets'
import { resolveTeachingSkinVariantSelection } from './designRendering'

const warmV1 = {
  apiVersion: 1 as const,
  id: 'builtin.preset.warm',
  version: 1,
  label: 'Warm',
  bindings: {
    'builtin.heading.left-accent': 'amber',
    'builtin.box.left-accent': 'green',
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
    expect(parseTeachingSkinPresetRef({ id: 'plugin.preset.future', version: 3 })).toEqual({ id: 'plugin.preset.future', version: 3 })
    expect(parseTeachingSkinPresetRef({ id: 'plugin.preset.future' })).toBeUndefined()
    expect(parseTeachingSkinPresetRef({ id: 'plugin.preset.future', version: 3, bindings: {} })).toBeUndefined()
  })

  it('fails closed when any binding dependency is unavailable', () => {
    const registry = new TeachingSkinPresetRegistry()
    registry.register({ ...warmV1, bindings: { 'builtin.heading.left-accent': 'amber', 'builtin.box.left-accent': 'futureVariant' } })
    expect(resolveTeachingSkinPreset(registry, { id: warmV1.id, version: 1 }, teachingSkinRegistry)).toMatchObject({ status: 'unavailable', bindings: {}, issues: [{ code: 'preset-dependency-missing' }] })
  })

  it('uses preview, explicit Variant, Preset, and Base in the documented order', () => {
    const skin = { id: 'builtin.heading.left-accent' }
    const bindings = { 'builtin.heading.left-accent': 'amber' }
    expect(resolveTeachingSkinVariantSelection(skin, skin.id, undefined, bindings)).toEqual({ requestedVariantId: 'amber', source: 'preset' })
    expect(resolveTeachingSkinVariantSelection({ ...skin, variant: 'futureVariant' }, skin.id, undefined, bindings)).toEqual({ requestedVariantId: 'futureVariant', source: 'explicit' })
    expect(resolveTeachingSkinVariantSelection({ ...skin, variant: 'green' }, skin.id, { [skin.id]: null }, bindings)).toEqual({ source: 'preview-base' })
    expect(resolveTeachingSkinVariantSelection({ ...skin, variant: 'green' }, skin.id, { [skin.id]: undefined }, bindings)).toEqual({ requestedVariantId: 'green', source: 'explicit' })
  })
})

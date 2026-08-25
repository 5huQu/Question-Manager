import { describe, expect, it } from 'vitest'
import { defineBoxSkin, defineHeadingSkin } from './authoring'
import { createTeachingSkinDesignIndex, createTeachingSkinDesignIndexFromRegistry } from './designIndex'
import { TeachingSkinRegistry } from './registry'
import {
  resolveTeachingSkinDesign,
  serializeTeachingSkinTokenToCssValue,
  teachingSkinIdToCssNamespace,
  teachingSkinSlotCssVariableName,
} from './designResolver'

const heading = defineHeadingSkin({
  id: 'studio.heading.accent',
  label: 'Accent heading',
  version: 1,
  printSafe: true,
  className: 'td-skin-studio-heading-accent',
  design: {
    tokens: [
      { id: 'studio.color.accent.blue-600', kind: 'color', label: 'Blue', printSafe: true, value: { hex: '#2563EB' } },
      { id: 'studio.color.accent.green-600', kind: 'color', label: 'Green', printSafe: true, value: { hex: '#16A34A' } },
      { id: 'studio.spacing.1', kind: 'spacing', label: 'Spacing 1', printSafe: true, value: { px: 4 } },
      { id: 'studio.spacing.2', kind: 'spacing', label: 'Spacing 2', printSafe: true, value: { px: 8 } },
    ],
    slots: [
      { id: 'accentColor', kind: 'color', defaultTokenId: 'studio.color.accent.blue-600', allowedTokenIds: ['studio.color.accent.blue-600', 'studio.color.accent.green-600'] },
      { id: 'accentSpacing', kind: 'spacing', defaultTokenId: 'studio.spacing.2' },
    ],
    variants: [
      { id: 'greenCompact', label: 'Green compact', tokenBindings: { accentColor: 'studio.color.accent.green-600', accentSpacing: 'studio.spacing.1' } },
      { id: 'green', label: 'Green', tokenBindings: { accentColor: 'studio.color.accent.green-600' } },
    ],
  },
})

const box = defineBoxSkin({
  id: 'studio.box.notebook',
  label: 'Notebook',
  version: 1,
  printSafe: true,
  className: 'td-skin-studio-box-notebook',
  design: {
    tokens: [
      { id: 'studio.color.border.neutral-300', kind: 'color', label: 'Border', printSafe: true, value: { hex: '#CBD5E1' } },
      { id: 'studio.radius.card.md', kind: 'radius', label: 'Card radius', printSafe: true, value: { px: 8 } },
      { id: 'studio.border.card.default', kind: 'border', label: 'Card border', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'studio.color.border.neutral-300' } },
    ],
    slots: [
      { id: 'cardRadius', kind: 'radius', defaultTokenId: 'studio.radius.card.md' },
      { id: 'cardBorder', kind: 'border', defaultTokenId: 'studio.border.card.default' },
    ],
  },
})

describe('Teaching Skin design index', () => {
  it('derives deterministically from definitions and retains duplicate Token contributions', () => {
    const duplicate = defineHeadingSkin({
      id: 'studio.heading.duplicate-token', label: 'Duplicate', version: 1, printSafe: true, className: 'duplicate-token',
      design: {
        tokens: [{ id: 'studio.color.accent.blue-600', kind: 'color', label: 'Other blue', printSafe: true, value: { hex: '#1D4ED8' } }],
        slots: [],
      },
    })
    const index = createTeachingSkinDesignIndex([duplicate, box, heading])

    expect([...index.skinsById.keys()]).toEqual(['studio.box.notebook', 'studio.heading.accent', 'studio.heading.duplicate-token'])
    expect(index.tokensById.get('studio.color.accent.blue-600')).toHaveLength(2)
    expect(index.tokensById.get('studio.color.accent.blue-600')?.map(({ skinId }) => skinId)).toEqual([
      'studio.heading.accent',
      'studio.heading.duplicate-token',
    ])
  })

  it('uses the existing TeachingSkinRegistry as its production source', () => {
    const registry = new TeachingSkinRegistry()
    registry.register(heading)
    registry.register(box)

    expect(createTeachingSkinDesignIndexFromRegistry(registry).snapshot()).toEqual(createTeachingSkinDesignIndex(registry).snapshot())
  })
})

describe('Teaching Skin design resolver', () => {
  const index = createTeachingSkinDesignIndex([box, heading])

  it('resolves Base Slot defaults into a deterministic scoped CSS-variable map', () => {
    const resolution = resolveTeachingSkinDesign(index, heading.id)
    expect(resolution).toMatchObject({ status: 'resolved' })
    if (resolution.status !== 'resolved') throw new Error('expected a resolved design')

    expect(resolution.design.variantId).toBeUndefined()
    expect(resolution.design.tokenBindings.map(({ slotId, tokenId }) => ({ slotId, tokenId }))).toEqual([
      { slotId: 'accentColor', tokenId: 'studio.color.accent.blue-600' },
      { slotId: 'accentSpacing', tokenId: 'studio.spacing.2' },
    ])
    expect(resolution.design.cssVariables).toEqual({
      '--td-skin-studio-heading-accent-accent-color': '#2563EB',
      '--td-skin-studio-heading-accent-accent-spacing': '8px',
    })
    expect(Object.isFrozen(resolution.design.cssVariables)).toBe(true)
  })

  it('overlays only the explicitly selected Variant and keeps Base defaults for unbound Slots', () => {
    const compact = resolveTeachingSkinDesign(index, heading.id, 'greenCompact')
    const green = resolveTeachingSkinDesign(index, heading.id, 'green')
    expect(compact).toMatchObject({
      status: 'resolved',
      design: {
        variantId: 'greenCompact',
        cssVariables: {
          '--td-skin-studio-heading-accent-accent-color': '#16A34A',
          '--td-skin-studio-heading-accent-accent-spacing': '4px',
        },
      },
    })
    expect(green).toMatchObject({
      status: 'resolved',
      design: {
        variantId: 'green',
        cssVariables: {
          '--td-skin-studio-heading-accent-accent-color': '#16A34A',
          '--td-skin-studio-heading-accent-accent-spacing': '8px',
        },
      },
    })
  })

  it('serializes every trusted Token kind without accepting arbitrary CSS', () => {
    const border = box.design?.tokens?.find((token) => token.kind === 'border')
    const radius = box.design?.tokens?.find((token) => token.kind === 'radius')
    expect(border && serializeTeachingSkinTokenToCssValue(border, index)).toBe('1px solid #CBD5E1')
    expect(radius && serializeTeachingSkinTokenToCssValue(radius, index)).toBe('8px')
    expect(teachingSkinSlotCssVariableName(box.id, 'cardBorder')).toBe('--td-skin-studio-box-notebook-card-border')
  })

  it('fails closed with no CSS-variable map for missing, ambiguous, incompatible, or unavailable input', () => {
    const duplicate = defineHeadingSkin({
      id: 'studio.heading.duplicate-token', label: 'Duplicate', version: 1, printSafe: true, className: 'duplicate-token',
      design: {
        tokens: [{ id: 'studio.color.accent.blue-600', kind: 'color', label: 'Other blue', printSafe: true, value: { hex: '#1D4ED8' } }],
        slots: [],
      },
    })
    const ambiguousIndex = createTeachingSkinDesignIndex([heading, duplicate])
    const ambiguous = resolveTeachingSkinDesign(ambiguousIndex, heading.id)
    expect(ambiguous).toEqual({
      status: 'unavailable',
      issues: [{
        code: 'token-ambiguous', skinId: heading.id,
        slotId: 'accentColor', tokenId: 'studio.color.accent.blue-600',
      }],
    })
    expect(resolveTeachingSkinDesign(index, heading.id, 'removed')).toMatchObject({
      status: 'resolved',
      design: { cssVariables: { '--td-skin-studio-heading-accent-accent-color': '#2563EB' } },
      issues: [{ code: 'variant-missing', skinId: heading.id, variantId: 'removed' }],
    })
    expect(resolveTeachingSkinDesign(index, 'studio.heading.removed')).toEqual({
      status: 'unavailable', issues: [{ code: 'skin-missing', skinId: 'studio.heading.removed' }],
    })

    const invalidSlot = defineHeadingSkin({
      id: 'studio.heading.invalid-reference', label: 'Invalid', version: 1, printSafe: true, className: 'invalid-reference',
      design: { slots: [{ id: 'accentColor', kind: 'color', defaultTokenId: 'studio.spacing.2' }] },
    })
    expect(resolveTeachingSkinDesign(createTeachingSkinDesignIndex([heading, invalidSlot]), invalidSlot.id)).toEqual({
      status: 'unavailable',
      issues: [{
        code: 'token-kind-mismatch', skinId: invalidSlot.id,
        slotId: 'accentColor', tokenId: 'studio.spacing.2',
      }],
    })
  })

  it('uses a fresh registry snapshot for each resolve instead of retaining stale contributions', () => {
    const registry = new TeachingSkinRegistry()
    registry.register(heading)
    const liveIndex = createTeachingSkinDesignIndexFromRegistry(registry)
    expect(resolveTeachingSkinDesign(liveIndex, box.id)).toMatchObject({
      status: 'unavailable', issues: [{ code: 'skin-missing', skinId: box.id }],
    })

    registry.register(box)
    expect(resolveTeachingSkinDesign(liveIndex, box.id)).toMatchObject({
      status: 'resolved',
      design: { cssVariables: { '--td-skin-studio-box-notebook-card-border': '1px solid #CBD5E1' } },
    })
  })

  it('uses Skin compatibility IDs, rather than className prefixes, for variable namespaces', () => {
    const plainClassName = structuredClone(heading)
    plainClassName.className = 'studio-heading-accent'
    const resolution = resolveTeachingSkinDesign(createTeachingSkinDesignIndex([plainClassName]), plainClassName.id)
    expect(resolution).toMatchObject({
      status: 'resolved',
      design: { cssVariables: { '--td-skin-studio-heading-accent-accent-color': '#2563EB' } },
    })
    expect(teachingSkinIdToCssNamespace('studio.heading.accent')).toBe('studio-heading-accent')
    expect(teachingSkinIdToCssNamespace('studio_heading.accent')).toBe('studio-heading-accent')
  })

  it('treats a legacy Skin without design metadata as a normal no-design result', () => {
    const legacy = defineHeadingSkin({
      id: 'studio.heading.legacy', label: 'Legacy', version: 1, printSafe: true, className: 'legacy-heading',
    })
    expect(resolveTeachingSkinDesign(createTeachingSkinDesignIndex([legacy]), legacy.id)).toEqual({
      status: 'no-design', skinId: legacy.id, issues: [],
    })
  })

  it.each([
    ['a mutated local Token value', (definition: typeof heading) => {
      ;(definition.design?.tokens?.[0] as unknown as { value: unknown }).value = null
    }],
    ['null Slots', (definition: typeof heading) => {
      ;(definition.design as unknown as { slots: unknown }).slots = null
    }],
    ['a malformed allowedTokenIds', (definition: typeof heading) => {
      ;(definition.design?.slots?.[0] as unknown as { allowedTokenIds: unknown }).allowedTokenIds = {}
    }],
  ])('fails closed without throwing for %s', (_label, mutate) => {
    const mutable = structuredClone(heading)
    mutable.id = 'studio.heading.mutated'
    const registry = new TeachingSkinRegistry()
    registry.register(mutable)
    mutate(mutable)
    const index = createTeachingSkinDesignIndexFromRegistry(registry)

    expect(() => resolveTeachingSkinDesign(index, mutable.id)).not.toThrow()
    expect(resolveTeachingSkinDesign(index, mutable.id)).toEqual({
      status: 'unavailable', issues: [{ code: 'design-invalid', skinId: mutable.id }],
    })
  })

  it('fails closed when an external Color Token mutates after registration', () => {
    const provider = defineHeadingSkin({
      id: 'studio.heading.color-provider', label: 'Color provider', version: 1, printSafe: true, className: 'color-provider',
      design: {
        tokens: [{ id: 'studio.color.external', kind: 'color', label: 'External', printSafe: true, value: { hex: '#2563EB' } }],
        slots: [],
      },
    })
    const consumer = defineBoxSkin({
      id: 'studio.box.external-border', label: 'External border', version: 1, printSafe: true, className: 'external-border',
      design: {
        tokens: [{ id: 'studio.border.external', kind: 'border', label: 'External border', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'studio.color.external' } }],
        slots: [{ id: 'cardBorder', kind: 'border', defaultTokenId: 'studio.border.external' }],
      },
    })
    const registry = new TeachingSkinRegistry()
    registry.register(provider)
    registry.register(consumer)
    ;(provider.design?.tokens?.[0] as unknown as { value: unknown }).value = null

    const resolution = resolveTeachingSkinDesign(createTeachingSkinDesignIndexFromRegistry(registry), consumer.id)
    expect(resolution).toMatchObject({
      status: 'unavailable', issues: [{ code: 'token-invalid', skinId: consumer.id }],
    })
  })

  it('never throws when serializing a malformed runtime Token', () => {
    const malformed = { id: 'studio.color.malformed', kind: 'color', label: 'Malformed', printSafe: true, value: null }
    expect(() => serializeTeachingSkinTokenToCssValue(malformed, createTeachingSkinDesignIndex([heading]))).not.toThrow()
    expect(serializeTeachingSkinTokenToCssValue(malformed, createTeachingSkinDesignIndex([heading]))).toBeUndefined()
  })
})

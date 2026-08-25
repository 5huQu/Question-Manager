import { describe, expect, it } from 'vitest'
import { defineBoxSkin, defineHeadingSkin } from './authoring'
import { createTeachingSkinDesignIndex, createTeachingSkinDesignIndexFromRegistry } from './designIndex'
import { TeachingSkinRegistry } from './registry'
import {
  resolveTeachingSkinDesign,
  serializeTeachingSkinTokenToCssValue,
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
    expect(teachingSkinSlotCssVariableName(box.className, 'cardBorder')).toBe('--td-skin-studio-box-notebook-card-border')
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
})

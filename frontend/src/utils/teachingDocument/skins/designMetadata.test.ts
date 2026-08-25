import { describe, expect, it } from 'vitest'
import { defineBoxSkin, defineHeadingSkin } from './authoring'
import { isTeachingSkinDefinition } from './types'

const headingDesign = {
  tokens: [
    { id: 'studio.color.accent.blue-600', kind: 'color', label: 'Blue', printSafe: true, value: { hex: '#2563EB' } },
    { id: 'studio.color.accent.green-600', kind: 'color', label: 'Green', printSafe: true, value: { hex: '#16A34A' } },
    { id: 'studio.spacing.2', kind: 'spacing', label: 'Spacing 2', printSafe: true, value: { px: 8 } },
  ],
  slots: [
    { id: 'accentColor', kind: 'color', defaultTokenId: 'studio.color.accent.blue-600', allowedTokenIds: ['studio.color.accent.blue-600', 'studio.color.accent.green-600'] },
    { id: 'accentSpacing', kind: 'spacing', defaultTokenId: 'studio.spacing.2' },
  ],
  variants: [
    { id: 'green', label: 'Green', tokenBindings: { accentColor: 'studio.color.accent.green-600' } },
  ],
} as const

const heading = defineHeadingSkin({
  id: 'studio.heading.accent', label: 'Accent', version: 1, printSafe: true, className: 'td-skin-studio-heading-accent', design: headingDesign,
})

describe('Teaching Skin design metadata runtime contract', () => {
  it('keeps legacy skins valid and accepts valid Heading, Box, and partial Variant metadata', () => {
    const legacy = defineHeadingSkin({ id: 'studio.heading.legacy', label: 'Legacy', version: 1, printSafe: true, className: 'td-skin-studio-heading-legacy' })
    const box = defineBoxSkin({
      id: 'studio.box.card', label: 'Card', version: 1, printSafe: true, className: 'td-skin-studio-box-card',
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
        variants: [{ id: 'compact', label: 'Compact', tokenBindings: { cardRadius: 'studio.radius.card.md' } }],
      },
    })
    expect(isTeachingSkinDefinition(legacy)).toBe(true)
    expect(isTeachingSkinDefinition(heading)).toBe(true)
    expect(isTeachingSkinDefinition(box)).toBe(true)
    expect(heading.design?.variants?.[0].tokenBindings).toEqual({ accentColor: 'studio.color.accent.green-600' })
  })

  it.each([
    ['unsupported token kind', { ...heading, design: { ...headingDesign, tokens: [{ ...headingDesign.tokens[0], kind: 'shadow' }] } }],
    ['invalid color', { ...heading, design: { ...headingDesign, tokens: [{ ...headingDesign.tokens[0], value: { hex: '#2563eb' } }] } }],
    ['invalid spacing', { ...heading, design: { ...headingDesign, tokens: [{ ...headingDesign.tokens[2], value: { px: -1 } }] } }],
    ['invalid radius', { ...heading, design: { ...headingDesign, tokens: [{ id: 'studio.radius.bad', kind: 'radius', label: 'Bad', printSafe: true, value: { px: 97 } }] } }],
    ['invalid border', { ...heading, design: { ...headingDesign, tokens: [{ id: 'studio.border.bad', kind: 'border', label: 'Bad', printSafe: true, value: { widthPx: 1, style: 'double', colorTokenId: 'studio.color.accent.blue-600' } }] } }],
    ['invalid Slot ID', { ...heading, design: { ...headingDesign, slots: [{ ...headingDesign.slots[0], id: 'accent-color' }] } }],
    ['invalid Variant ID', { ...heading, design: { ...headingDesign, variants: [{ ...headingDesign.variants[0], id: 'compact-ish' }] } }],
    ['duplicate Token', { ...heading, design: { ...headingDesign, tokens: [headingDesign.tokens[0], headingDesign.tokens[0]] } }],
    ['duplicate Slot', { ...heading, design: { ...headingDesign, slots: [headingDesign.slots[0], headingDesign.slots[0]] } }],
    ['duplicate Variant', { ...heading, design: { ...headingDesign, variants: [headingDesign.variants[0], headingDesign.variants[0]] } }],
    ['unknown design key', { ...heading, design: { ...headingDesign, randomField: true } }],
    ['defaultVariantId', { ...heading, design: { ...headingDesign, defaultVariantId: 'green' } }],
  ])('rejects %s', (_label, definition) => {
    expect(isTeachingSkinDefinition(definition)).toBe(false)
  })
})

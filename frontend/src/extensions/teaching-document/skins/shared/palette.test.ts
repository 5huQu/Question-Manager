import { describe, expect, it } from 'vitest'
import { teachingSkinRegistry } from '@/utils/teachingDocument/skins'
import {
  TEACHING_SKIN_PALETTE_HUES,
  teachingSkinBaseSwatchColor,
  teachingSkinPaletteHexValues,
  teachingSkinVariantSwatchColor,
} from './palette'

const HEX_PATTERN = /^#[0-9A-F]{6}$/

describe('共享色板', () => {
  it('色板色系完整且角色值为大写规范十六进制', () => {
    expect(TEACHING_SKIN_PALETTE_HUES.map((hue) => hue.id)).toEqual(['blue', 'green', 'amber', 'red', 'purple', 'teal', 'neutral'])
    for (const hue of TEACHING_SKIN_PALETTE_HUES) {
      for (const hex of Object.values(hue.roles)) {
        expect(hex).toMatch(HEX_PATTERN)
      }
    }
  })

  it('所有带 Design 的皮肤 Token 颜色都取自共享色板', () => {
    const allowed = teachingSkinPaletteHexValues()
    const offenders: string[] = []
    for (const definition of teachingSkinRegistry.list()) {
      for (const token of definition.design?.tokens || []) {
        if (token.kind === 'color' && !allowed.has(token.value.hex)) {
          offenders.push(`${definition.id} → ${token.id} → ${token.value.hex}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('每个带 Design 的内置皮肤都提供完整色系 Variant', () => {
    const hueIds = new Set(TEACHING_SKIN_PALETTE_HUES.map((hue) => hue.id))
    for (const definition of teachingSkinRegistry.list()) {
      if (!definition.id.startsWith('builtin.') || !definition.design?.variants?.length) continue
      const variantIds = new Set(definition.design.variants.map((variant) => variant.id))
      const covered = [...hueIds].filter((hueId) => variantIds.has(hueId))
      // Base 色系不出现在 Variant 列表中时允许缺一个（该色系即默认外观）。
      expect(covered.length, `${definition.id} variants`).toBeGreaterThanOrEqual(hueIds.size - 1)
    }
  })

  it('每个 Variant 和 Base 都能解析出色点颜色', () => {
    for (const definition of teachingSkinRegistry.list()) {
      if (!definition.design?.variants?.length) continue
      expect(teachingSkinBaseSwatchColor(definition), `${definition.id} base swatch`).toMatch(HEX_PATTERN)
      for (const variant of definition.design.variants) {
        expect(teachingSkinVariantSwatchColor(definition, variant.id), `${definition.id} → ${variant.id}`).toMatch(HEX_PATTERN)
      }
    }
  })

  it('强调类皮肤的色点取自强调线而非浅色填充', () => {
    const underline = teachingSkinRegistry.list().find((definition) => definition.id === 'builtin.heading.underline')!
    expect(teachingSkinVariantSwatchColor(underline, 'red')).toBe('#B91C1C')
    const softFill = teachingSkinRegistry.list().find((definition) => definition.id === 'builtin.box.soft-fill')!
    // 软填充卡没有强调线，色点退而取边框颜色。
    expect(teachingSkinVariantSwatchColor(softFill, 'red')).toBe('#FECACA')
  })
})

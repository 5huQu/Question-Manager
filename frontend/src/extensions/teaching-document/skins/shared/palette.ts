import type { TeachingSkinDefinition, TeachingSkinDesignMetadata, TeachingSkinSlotDefinition, TeachingSkinTokenDefinition } from '@/utils/teachingDocument/skins'

/**
 * 共享色板：所有内置皮肤的颜色单一真相源。
 *
 * 皮肤 `skin.ts` 中的 Token 字面量必须取自这里定义的角色值
 * （由色板一致性测试保证）；选择器色点也从这里取展示颜色。
 * 扩充颜色时只需要在这里加色系，再同步各皮肤的静态 Token。
 */
export interface TeachingSkinPaletteHue {
  id: string
  label: string
  roles: {
    /** 强调线 / 标记方块 / 顶线等主视觉 */
    accent: string
    /** 标题文字 */
    title: string
    /** 浅边框 / 分隔线 */
    border: string
    /** 较深填充（标题底） */
    soft: string
    /** 更浅填充（正文底 / 色带） */
    softer: string
  }
}

export const TEACHING_SKIN_PALETTE_HUES: readonly TeachingSkinPaletteHue[] = [
  { id: 'blue', label: '蓝色', roles: { accent: '#2563EB', title: '#1E40AF', border: '#BFDBFE', soft: '#DBEAFE', softer: '#EFF6FF' } },
  { id: 'green', label: '绿色', roles: { accent: '#047857', title: '#065F46', border: '#A7F3D0', soft: '#D1FAE5', softer: '#ECFDF5' } },
  { id: 'amber', label: '琥珀', roles: { accent: '#B45309', title: '#92400E', border: '#FDE68A', soft: '#FEF3C7', softer: '#FFFBEB' } },
  { id: 'red', label: '红色', roles: { accent: '#B91C1C', title: '#991B1B', border: '#FECACA', soft: '#FEE2E2', softer: '#FEF2F2' } },
  { id: 'purple', label: '紫色', roles: { accent: '#7C3AED', title: '#6D28D9', border: '#DDD6FE', soft: '#EDE9FE', softer: '#F5F3FF' } },
  { id: 'teal', label: '青色', roles: { accent: '#0F766E', title: '#115E59', border: '#99F6E4', soft: '#CCFBF1', softer: '#F0FDFA' } },
  { id: 'neutral', label: '中性', roles: { accent: '#3F3F46', title: '#3F3F46', border: '#D4D4D8', soft: '#F4F4F5', softer: '#FAFAFA' } },
]

export function teachingSkinPaletteHue(id: string): TeachingSkinPaletteHue | undefined {
  return TEACHING_SKIN_PALETTE_HUES.find((hue) => hue.id === id)
}

/** 不属于任何色系的中性固定值（纸面白色、极浅分隔线）。 */
export const TEACHING_SKIN_PALETTE_FIXED_HEXES: readonly string[] = [
  '#FFFFFF', '#E4E4E7',
  // Proposal-authored neutral print colors used by the nine built-in skins.
  '#000000', '#18181B', '#1E293B', '#475569', '#64748B', '#CBD5E1', '#E2E8F0', '#F1F5F9', '#EF4444',
]

/** 色板中出现过的全部十六进制值，用于一致性测试校验皮肤 Token 字面量。 */
export function teachingSkinPaletteHexValues(): ReadonlySet<string> {
  const values = new Set<string>()
  for (const hex of TEACHING_SKIN_PALETTE_FIXED_HEXES) values.add(hex)
  for (const hue of TEACHING_SKIN_PALETTE_HUES) {
    for (const hex of Object.values(hue.roles)) values.add(hex)
  }
  return values
}

const VARIANT_SWATCH_SLOT_PRIORITY = ['accent', 'marker', 'top', 'rule', 'frame', 'band', 'pill', 'divider', 'header', 'body', 'title']

function tokenHex(token: TeachingSkinTokenDefinition | undefined, tokensById: Map<string, TeachingSkinTokenDefinition>): string | undefined {
  if (!token) return undefined
  if (token.kind === 'color') return token.value.hex
  if (token.kind === 'border') return tokenHex(tokensById.get(token.value.colorTokenId), tokensById)
  return undefined
}

function slotKindIsColorOrBorder(slot: TeachingSkinSlotDefinition): boolean {
  return slot.kind === 'color' || slot.kind === 'border'
}

function swatchFromBindings(design: TeachingSkinDesignMetadata, tokenIdFor: (slot: TeachingSkinSlotDefinition) => string | undefined): string | undefined {
  const tokensById = new Map((design.tokens || []).map((token) => [token.id, token]))
  const slotsById = new Map(design.slots.map((slot) => [slot.id, slot]))
  const orderedSlots = [...slotsById.values()].sort((left, right) => {
    const leftRank = VARIANT_SWATCH_SLOT_PRIORITY.findIndex((keyword) => left.id.toLowerCase().includes(keyword))
    const rightRank = VARIANT_SWATCH_SLOT_PRIORITY.findIndex((keyword) => right.id.toLowerCase().includes(keyword))
    return (leftRank === -1 ? Number.MAX_SAFE_INTEGER : leftRank) - (rightRank === -1 ? Number.MAX_SAFE_INTEGER : rightRank)
  })
  for (const slot of orderedSlots) {
    if (!slotKindIsColorOrBorder(slot)) continue
    const hex = tokenHex(tokensById.get(tokenIdFor(slot) ?? slot.defaultTokenId), tokensById)
    if (hex) return hex
  }
  return undefined
}

/**
 * 解析一个 Variant 的代表色，用于色点选择器展示。
 * 按语义优先级（强调线 > 标记 > 边框 > 填充 > 标题）取第一个可解析的颜色。
 */
export function teachingSkinVariantSwatchColor(definition: TeachingSkinDefinition, variantId: string): string | undefined {
  const design = definition.design
  if (!design) return undefined
  const variant = (design.variants || []).find((item) => item.id === variantId)
  if (!variant) return undefined
  return swatchFromBindings(design, (slot) => variant.tokenBindings[slot.id])
}

/** 解析 Base（默认 token 绑定）的代表色。 */
export function teachingSkinBaseSwatchColor(definition: TeachingSkinDefinition): string | undefined {
  const design = definition.design
  if (!design) return undefined
  return swatchFromBindings(design, () => undefined)
}

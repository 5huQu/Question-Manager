import type {
  BoxAppearance,
  BoxBorderColor,
  BoxBorderWidth,
  BoxCornerRadius,
  BoxPadding,
  BoxSurfaceColor,
} from '@/types/teachingDocument'
import type { BoxTemplateDefinition } from './boxTemplates'

const SURFACE_COLORS = new Set<BoxSurfaceColor>(['template', 'white', 'blue', 'gray', 'amber', 'green'])
const BORDER_COLORS = new Set<BoxBorderColor>(['template', 'zinc', 'blue', 'amber', 'green'])
const BORDER_WIDTHS = new Set<BoxBorderWidth>([0, 1, 2])
const CORNER_RADII = new Set<BoxCornerRadius>([0, 4, 8, 12])
const PADDING_VALUES = new Set<BoxPadding>([8, 12, 16, 20, 24])

function boxSurface(appearance: BoxAppearance | undefined, template: BoxTemplateDefinition) {
  const surfaces: Record<BoxSurfaceColor, string> = {
    template: `var(--box-${template.tone}-body)`,
    white: '#ffffff',
    blue: '#eef4ff',
    gray: '#f4f4f5',
    amber: '#fffbeb',
    green: '#f0fdf4',
  }
  return surfaces[appearance?.background || 'template']
}

/** Parse persisted card appearance while discarding unsupported style values. */
export function parseBoxAppearance(raw: unknown): BoxAppearance | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const background = SURFACE_COLORS.has(value.background as BoxSurfaceColor) ? value.background as BoxSurfaceColor : undefined
  const borderColor = BORDER_COLORS.has(value.borderColor as BoxBorderColor) ? value.borderColor as BoxBorderColor : undefined
  const borderWidth = BORDER_WIDTHS.has(value.borderWidth as BoxBorderWidth) ? value.borderWidth as BoxBorderWidth : undefined
  const cornerRadius = CORNER_RADII.has(value.cornerRadius as BoxCornerRadius) ? value.cornerRadius as BoxCornerRadius : undefined
  const rawPadding = value.padding && typeof value.padding === 'object' && !Array.isArray(value.padding)
    ? value.padding as Record<string, unknown>
    : undefined
  const padding = rawPadding ? Object.fromEntries(
    (['top', 'right', 'bottom', 'left'] as const)
      .filter((side) => PADDING_VALUES.has(rawPadding[side] as BoxPadding))
      .map((side) => [side, rawPadding[side] as BoxPadding]),
  ) as BoxAppearance['padding'] : undefined
  return background || borderColor || borderWidth !== undefined || cornerRadius !== undefined || (padding && Object.keys(padding).length)
    ? { background, borderColor, borderWidth, cornerRadius, ...(padding && Object.keys(padding).length ? { padding } : {}) }
    : undefined
}

/** Client-side guard for the constrained document appearance contract. */
export function hasValidBoxAppearance(raw: unknown): boolean {
  if (raw === undefined) return true
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const value = raw as Record<string, unknown>
  if (value.background !== undefined && !SURFACE_COLORS.has(value.background as BoxSurfaceColor)) return false
  if (value.borderColor !== undefined && !BORDER_COLORS.has(value.borderColor as BoxBorderColor)) return false
  if (value.borderWidth !== undefined && !BORDER_WIDTHS.has(value.borderWidth as BoxBorderWidth)) return false
  if (value.cornerRadius !== undefined && !CORNER_RADII.has(value.cornerRadius as BoxCornerRadius)) return false
  if (value.padding !== undefined) {
    if (!value.padding || typeof value.padding !== 'object' || Array.isArray(value.padding)) return false
    for (const [key, item] of Object.entries(value.padding as Record<string, unknown>)) {
      if (!['top', 'right', 'bottom', 'left'].includes(key) || !PADDING_VALUES.has(item as BoxPadding)) return false
    }
  }
  return true
}

export function boxFrameStyle(appearance: BoxAppearance | undefined, template: BoxTemplateDefinition) {
  const borders: Record<BoxBorderColor, string> = {
    template: `var(--box-${template.tone}-border)`,
    zinc: '#d4d4d8',
    blue: '#c7dcff',
    amber: '#fde68a',
    green: '#bbf7d0',
  }
  return {
    borderColor: borders[appearance?.borderColor || 'template'],
    borderWidth: appearance?.borderWidth === undefined ? undefined : `${appearance.borderWidth}px`,
    borderRadius: appearance?.cornerRadius === undefined ? undefined : `${appearance.cornerRadius}px`,
    background: boxSurface(appearance, template),
  }
}

/**
 * When a skin is active its CSS owns the base visual. Only explicit per-card
 * appearance values are emitted inline so the existing appearance override
 * remains stronger without masking the skin's default CSS.
 */
export function skinBoxFrameStyle(appearance: BoxAppearance | undefined, template: BoxTemplateDefinition) {
  if (!appearance) return undefined
  const borders: Record<BoxBorderColor, string> = {
    template: `var(--box-${template.tone}-border)`, zinc: '#d4d4d8', blue: '#c7dcff', amber: '#fde68a', green: '#bbf7d0',
  }
  return {
    ...(appearance.borderColor !== undefined ? { borderColor: borders[appearance.borderColor] } : {}),
    ...(appearance.borderWidth !== undefined ? { borderWidth: `${appearance.borderWidth}px` } : {}),
    ...(appearance.cornerRadius !== undefined ? { borderRadius: `${appearance.cornerRadius}px` } : {}),
    ...(appearance.background !== undefined ? { background: boxSurface(appearance, template) } : {}),
  }
}

export function boxBodyPaddingStyle(appearance: BoxAppearance | undefined) {
  if (!appearance?.padding || !Object.keys(appearance.padding).length) return undefined
  return {
    paddingTop: `${appearance.padding.top ?? 12}px`,
    paddingRight: `${appearance.padding.right ?? 16}px`,
    paddingBottom: `${appearance.padding.bottom ?? 12}px`,
    paddingLeft: `${appearance.padding.left ?? 16}px`,
  }
}

/**
 * Keep the body on the same constrained surface as the outer frame. Without it,
 * a template body layer would visually mask a per-card background override.
 */
export function boxBodyStyle(appearance: BoxAppearance | undefined, template: BoxTemplateDefinition) {
  return {
    background: boxSurface(appearance, template),
    ...boxBodyPaddingStyle(appearance),
  }
}

export function skinBoxBodyStyle(appearance: BoxAppearance | undefined, template: BoxTemplateDefinition) {
  if (!appearance) return undefined
  return {
    ...(appearance.background !== undefined ? { background: boxSurface(appearance, template) } : {}),
    ...boxBodyPaddingStyle(appearance),
  }
}

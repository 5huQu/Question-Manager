import type { JsonValue, TeachingSkinRef } from '@/types/teachingDocument'

export type TeachingSkinTarget = 'heading' | 'box'
export type HeadingSkinLevel = 1 | 2 | 3 | 4
export type TeachingSkinTokenKind = 'color' | 'spacing' | 'radius' | 'border'
export type TeachingSkinTokenId = string
export type TeachingSkinSlotId = string
export type TeachingSkinVariantId = string

const STABLE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/
const LOCAL_DESIGN_ID = /^[a-z][A-Za-z0-9]*$/
const CANONICAL_HEX = /^#[0-9A-F]{6}$/
const BORDER_STYLES = new Set(['solid', 'dashed', 'dotted'])
/** Shared source-metadata limits; these are not CSS values persisted in a document. */
export const MAX_TEACHING_SKIN_TOKEN_PX = 96
export const MAX_TEACHING_SKIN_BORDER_WIDTH_PX = 12

interface TeachingSkinTokenDefinitionBase {
  id: TeachingSkinTokenId
  label: string
  printSafe: true
}

export interface TeachingSkinColorTokenDefinition extends TeachingSkinTokenDefinitionBase {
  kind: 'color'
  value: { hex: string }
}

export interface TeachingSkinSpacingTokenDefinition extends TeachingSkinTokenDefinitionBase {
  kind: 'spacing'
  value: { px: number }
}

export interface TeachingSkinRadiusTokenDefinition extends TeachingSkinTokenDefinitionBase {
  kind: 'radius'
  value: { px: number }
}

export interface TeachingSkinBorderTokenDefinition extends TeachingSkinTokenDefinitionBase {
  kind: 'border'
  value: {
    widthPx: number
    style: 'solid' | 'dashed' | 'dotted'
    colorTokenId: TeachingSkinTokenId
  }
}

/** Trusted source metadata only. It is inert until a later resolver phase. */
export type TeachingSkinTokenDefinition =
  | TeachingSkinColorTokenDefinition
  | TeachingSkinSpacingTokenDefinition
  | TeachingSkinRadiusTokenDefinition
  | TeachingSkinBorderTokenDefinition

export interface TeachingSkinSlotDefinition {
  /** Stable identifier local to the owning Skin. */
  id: TeachingSkinSlotId
  kind: TeachingSkinTokenKind
  defaultTokenId: TeachingSkinTokenId
  allowedTokenIds?: readonly TeachingSkinTokenId[]
}

export interface TeachingSkinVariantDefinition {
  /** Stable identifier local to the owning Skin. */
  id: TeachingSkinVariantId
  label: string
  description?: string
  /** A Variant may intentionally override only some declared Slots. */
  tokenBindings: Readonly<Record<TeachingSkinSlotId, TeachingSkinTokenId>>
}

export interface TeachingSkinDesignMetadata {
  tokens?: readonly TeachingSkinTokenDefinition[]
  slots: readonly TeachingSkinSlotDefinition[]
  variants?: readonly TeachingSkinVariantDefinition[]
}

export interface TeachingSkinDefinitionBase {
  apiVersion: 1
  /** Stable, namespaced identifier persisted in TeachingDocument JSON. */
  id: string
  target: TeachingSkinTarget
  label: string
  description?: string
  version: number
  author?: string
  tags?: readonly string[]
  /** Phase 1 skins must work in editor, A4 preview, and print. */
  printSafe: true
  /** CSS class added by the core renderer when this skin resolves. */
  className: string
  /** Optional inert source metadata. It does not affect Phase 1 rendering. */
  design?: TeachingSkinDesignMetadata
}

export interface HeadingSkinDefinition extends TeachingSkinDefinitionBase {
  target: 'heading'
  supportedLevels?: readonly HeadingSkinLevel[]
}

export interface BoxSkinDefinition extends TeachingSkinDefinitionBase {
  target: 'box'
  supportedTemplates?: readonly string[]
}

export type TeachingSkinDefinition = HeadingSkinDefinition | BoxSkinDefinition

export type HeadingSkinInput = Omit<HeadingSkinDefinition, 'apiVersion' | 'target'>
export type BoxSkinInput = Omit<BoxSkinDefinition, 'apiVersion' | 'target'>

/** Define a declarative Heading skin without exposing a renderer API. */
export function defineHeadingSkin(definition: HeadingSkinInput): HeadingSkinDefinition {
  return { apiVersion: 1, target: 'heading', ...definition }
}

/** Define a declarative Box skin without exposing a renderer API. */
export function defineBoxSkin(definition: BoxSkinInput): BoxSkinDefinition {
  return { apiVersion: 1, target: 'box', ...definition }
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value as Record<string, unknown>).every(([key, item]) => Boolean(key) && isJsonValue(item))
}

const SKIN_ID = STABLE_ID
const TEACHING_SKIN_REF_KEYS = new Set(['id', 'version', 'variant', 'settings'])
const UNSAFE_SETTING_KEY = /^(?:css|cssText|html|react|className|class|style|script|component)$/i

function hasSafeSettings(value: unknown): value is Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value as Record<string, unknown>).every(([key, item]) => Boolean(key) && !UNSAFE_SETTING_KEY.test(key) && isSafeSettingsValue(item))
}

function isSafeSettingsValue(value: unknown): value is JsonValue {
  if (!isJsonValue(value)) return false
  if (Array.isArray(value)) return value.every(isSafeSettingsValue)
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).every(([key, item]) => !UNSAFE_SETTING_KEY.test(key) && isSafeSettingsValue(item))
  }
  return true
}

/** Parses only the persisted ref contract; it deliberately does not resolve IDs. */
export function parseTeachingSkinRef(value: unknown): TeachingSkinRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (Object.keys(raw).some((key) => !TEACHING_SKIN_REF_KEYS.has(key))) return undefined
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!SKIN_ID.test(id)) return undefined
  const version = raw.version
  if (version !== undefined && (!Number.isInteger(version) || Number(version) < 1)) return undefined
  const variant = raw.variant
  if (variant !== undefined && !isTeachingSkinLocalDesignId(variant)) return undefined
  if (raw.settings !== undefined && !hasSafeSettings(raw.settings)) return undefined
  return {
    id,
    ...(version !== undefined ? { version: Number(version) } : {}),
    ...(variant !== undefined ? { variant } : {}),
    ...(raw.settings !== undefined ? { settings: raw.settings } : {}),
  }
}

export function hasValidTeachingSkinRef(value: unknown): boolean {
  return value === undefined || parseTeachingSkinRef(value) !== undefined
}

export function isTeachingSkinDefinition(value: unknown): value is TeachingSkinDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const definition = value as Partial<TeachingSkinDefinition>
  if (definition.apiVersion !== 1 || !SKIN_ID.test(String(definition.id || ''))) return false
  if (definition.target !== 'heading' && definition.target !== 'box') return false
  if (!String(definition.label || '').trim() || !Number.isInteger(definition.version) || Number(definition.version) < 1) return false
  if (definition.printSafe !== true || !String(definition.className || '').trim()) return false
  if (definition.design !== undefined && !isTeachingSkinDesignMetadata(definition.design)) return false
  if (definition.target === 'heading' && definition.supportedLevels !== undefined
    && (!Array.isArray(definition.supportedLevels) || definition.supportedLevels.some((level) => ![1, 2, 3, 4].includes(level)))) return false
  if (definition.target === 'box' && definition.supportedTemplates !== undefined
    && (!Array.isArray(definition.supportedTemplates) || definition.supportedTemplates.some((template) => typeof template !== 'string' || !template.trim()))) return false
  return true
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function isStableDesignId(value: unknown): value is string {
  return typeof value === 'string' && STABLE_ID.test(value)
}

function isLocalDesignId(value: unknown): value is string {
  return isTeachingSkinLocalDesignId(value)
}

/** Shared grammar for source and persisted Skin-local Variant IDs. */
export function isTeachingSkinLocalDesignId(value: unknown): value is TeachingSkinVariantId {
  return typeof value === 'string' && LOCAL_DESIGN_ID.test(value)
}

function isBoundedPx(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum
}

/** Runtime-safe Token guard for trusted source definitions after registration. */
export function isTeachingSkinTokenDefinition(value: unknown): value is TeachingSkinTokenDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const token = value as Record<string, unknown>
  if (!hasExactKeys(token, ['id', 'kind', 'label', 'printSafe', 'value'])
    || !isStableDesignId(token.id) || !isNonEmptyString(token.label) || token.printSafe !== true) return false
  if (!token.value || typeof token.value !== 'object' || Array.isArray(token.value)) return false
  const tokenValue = token.value as Record<string, unknown>
  if (token.kind === 'color') {
    return hasExactKeys(tokenValue, ['hex']) && typeof tokenValue.hex === 'string' && CANONICAL_HEX.test(tokenValue.hex)
  }
  if (token.kind === 'spacing' || token.kind === 'radius') {
    return hasExactKeys(tokenValue, ['px']) && isBoundedPx(tokenValue.px, MAX_TEACHING_SKIN_TOKEN_PX)
  }
  if (token.kind === 'border') {
    return hasExactKeys(tokenValue, ['widthPx', 'style', 'colorTokenId'])
      && isBoundedPx(tokenValue.widthPx, MAX_TEACHING_SKIN_BORDER_WIDTH_PX)
      && typeof tokenValue.style === 'string' && BORDER_STYLES.has(tokenValue.style)
      && isStableDesignId(tokenValue.colorTokenId)
  }
  return false
}

/** Runtime-safe Slot guard for trusted source definitions after registration. */
export function isTeachingSkinSlotDefinition(value: unknown): value is TeachingSkinSlotDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const slot = value as Record<string, unknown>
  if (!hasExactKeys(slot, ['id', 'kind', 'defaultTokenId', 'allowedTokenIds'])
    || !isLocalDesignId(slot.id)
    || !['color', 'spacing', 'radius', 'border'].includes(String(slot.kind))
    || !isStableDesignId(slot.defaultTokenId)) return false
  if (slot.allowedTokenIds === undefined) return true
  return Array.isArray(slot.allowedTokenIds)
    && slot.allowedTokenIds.length > 0
    && slot.allowedTokenIds.every(isStableDesignId)
    && new Set(slot.allowedTokenIds).size === slot.allowedTokenIds.length
}

/** Runtime-safe Variant guard for trusted source definitions after registration. */
export function isTeachingSkinVariantDefinition(value: unknown, slotIds: ReadonlySet<string>): value is TeachingSkinVariantDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const variant = value as Record<string, unknown>
  if (!hasExactKeys(variant, ['id', 'label', 'description', 'tokenBindings'])
    || !isLocalDesignId(variant.id)
    || !isNonEmptyString(variant.label)
    || (variant.description !== undefined && !isNonEmptyString(variant.description))
    || !variant.tokenBindings || typeof variant.tokenBindings !== 'object' || Array.isArray(variant.tokenBindings)) return false
  const bindings = variant.tokenBindings as Record<string, unknown>
  const entries = Object.entries(bindings)
  return entries.length > 0 && entries.every(([slotId, tokenId]) => slotIds.has(slotId) && isStableDesignId(tokenId))
}

/** Validates one Skin's inert design shape; cross-Skin Token references are checked by skin:check. */
export function isTeachingSkinDesignMetadata(value: unknown): value is TeachingSkinDesignMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const design = value as Record<string, unknown>
  if (!hasExactKeys(design, ['tokens', 'slots', 'variants']) || !Array.isArray(design.slots)) return false
  if (design.tokens !== undefined && (!Array.isArray(design.tokens) || !design.tokens.every(isTeachingSkinTokenDefinition))) return false
  const tokens = design.tokens ?? []
  if (new Set(tokens.map((token) => token.id)).size !== tokens.length) return false
  const slots = design.slots
  if (!slots.every(isTeachingSkinSlotDefinition) || new Set(slots.map((slot) => slot.id)).size !== slots.length) return false
  const slotIds = new Set(slots.map((slot) => slot.id))
  if (design.variants !== undefined && (!Array.isArray(design.variants) || !design.variants.every((variant) => isTeachingSkinVariantDefinition(variant, slotIds)))) return false
  return design.variants === undefined || new Set(design.variants.map((variant) => variant.id)).size === design.variants.length
}

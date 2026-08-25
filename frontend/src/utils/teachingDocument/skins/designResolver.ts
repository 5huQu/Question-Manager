import {
  MAX_TEACHING_SKIN_BORDER_WIDTH_PX,
  MAX_TEACHING_SKIN_TOKEN_PX,
  type TeachingSkinSlotDefinition,
  type TeachingSkinTokenDefinition,
  type TeachingSkinTokenId,
  type TeachingSkinVariantId,
} from './types'
import type {
  TeachingSkinDesignIndex,
  TeachingSkinDesignIndexSnapshot,
  TeachingSkinTokenContribution,
} from './designIndex'

const CANONICAL_HEX = /^#[0-9A-F]{6}$/
const BORDER_STYLES = new Set(['solid', 'dashed', 'dotted'])
const SAFE_SKIN_CLASS_NAME = /^td-skin-[a-z0-9_-]+$/

export type TeachingSkinDesignIssueCode =
  | 'skin-missing'
  | 'design-missing'
  | 'variant-missing'
  | 'token-missing'
  | 'token-ambiguous'
  | 'token-kind-mismatch'
  | 'token-disallowed'
  | 'token-invalid'
  | 'css-variable-invalid'

/** Structured runtime diagnostic; it never contains document-provided CSS. */
export interface TeachingSkinDesignIssue {
  code: TeachingSkinDesignIssueCode
  skinId: string
  variantId?: TeachingSkinVariantId
  slotId?: string
  tokenId?: TeachingSkinTokenId
}

export interface ResolvedTeachingSkinTokenBinding {
  slotId: string
  tokenId: TeachingSkinTokenId
  token: TeachingSkinTokenDefinition
}

/** A CSS custom-property name emitted only for a Skin-local Slot. */
export type TeachingSkinCssVariableName = `--td-skin-${string}`

export interface ResolvedTeachingSkinDesign {
  skinId: string
  skinVersion: number
  /** Undefined deliberately means the stable Base appearance. */
  variantId?: TeachingSkinVariantId
  tokenBindings: readonly ResolvedTeachingSkinTokenBinding[]
  cssVariables: Readonly<Record<TeachingSkinCssVariableName, string>>
}

export type TeachingSkinDesignResolution =
  | { status: 'resolved'; design: ResolvedTeachingSkinDesign; issues: readonly TeachingSkinDesignIssue[] }
  | { status: 'unavailable'; issues: readonly [TeachingSkinDesignIssue] }

type TokenResolution =
  | { ok: true; contribution: TeachingSkinTokenContribution }
  | { ok: false; code: Exclude<TeachingSkinDesignIssueCode, 'skin-missing' | 'design-missing' | 'variant-missing' | 'css-variable-invalid'> }

function issue(
  code: TeachingSkinDesignIssueCode,
  skinId: string,
  details: Omit<TeachingSkinDesignIssue, 'code' | 'skinId'> = {},
): TeachingSkinDesignIssue {
  return { code, skinId, ...details }
}

function unavailable(value: TeachingSkinDesignIssue): TeachingSkinDesignResolution {
  return { status: 'unavailable', issues: Object.freeze([value]) }
}

function resolveUniqueToken(snapshot: TeachingSkinDesignIndexSnapshot, tokenId: TeachingSkinTokenId): TokenResolution {
  const contributions = snapshot.tokensById.get(tokenId) ?? []
  if (contributions.length === 0) return { ok: false, code: 'token-missing' }
  if (contributions.length !== 1) return { ok: false, code: 'token-ambiguous' }
  return { ok: true, contribution: contributions[0] }
}

function isBoundedPx(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum
}

function serializeFromSnapshot(
  token: TeachingSkinTokenDefinition,
  snapshot: TeachingSkinDesignIndexSnapshot,
): string | undefined {
  if (token.kind === 'color') {
    return CANONICAL_HEX.test(token.value.hex) ? token.value.hex : undefined
  }
  if (token.kind === 'spacing' || token.kind === 'radius') {
    return isBoundedPx(token.value.px, MAX_TEACHING_SKIN_TOKEN_PX) ? `${token.value.px}px` : undefined
  }
  if (!isBoundedPx(token.value.widthPx, MAX_TEACHING_SKIN_BORDER_WIDTH_PX) || !BORDER_STYLES.has(token.value.style)) {
    return undefined
  }
  const color = resolveUniqueToken(snapshot, token.value.colorTokenId)
  if (!color.ok || color.contribution.token.kind !== 'color') return undefined
  const colorValue = serializeFromSnapshot(color.contribution.token, snapshot)
  return colorValue ? `${token.value.widthPx}px ${token.value.style} ${colorValue}` : undefined
}

/**
 * Serializes a source-validated Token into its only allowed CSS value. Border
 * Tokens resolve their color Token through the same fail-closed global index.
 */
export function serializeTeachingSkinTokenToCssValue(
  token: TeachingSkinTokenDefinition,
  index: TeachingSkinDesignIndex,
): string | undefined {
  return serializeFromSnapshot(token, index.snapshot())
}

/**
 * Generates a scoped variable from the trusted Skin class and local Slot ID.
 * Authors cannot supply a variable name independently from those two contracts.
 */
export function teachingSkinSlotCssVariableName(
  className: string,
  slotId: string,
): TeachingSkinCssVariableName | undefined {
  if (!SAFE_SKIN_CLASS_NAME.test(className)) return undefined
  return `--${className}-${slotId.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}` as TeachingSkinCssVariableName
}

function resolveSlotToken(
  slot: TeachingSkinSlotDefinition,
  tokenId: TeachingSkinTokenId,
  snapshot: TeachingSkinDesignIndexSnapshot,
): TokenResolution {
  const resolution = resolveUniqueToken(snapshot, tokenId)
  if (!resolution.ok) return resolution
  if (resolution.contribution.token.kind !== slot.kind) return { ok: false, code: 'token-kind-mismatch' }
  if (slot.allowedTokenIds && !slot.allowedTokenIds.includes(tokenId)) return { ok: false, code: 'token-disallowed' }
  return resolution
}

/**
 * Resolves Base Slot defaults, then overlays one explicit source Variant. This
 * accepts no document data and does not select a Variant implicitly. A missing
 * Variant is observable as an issue but intentionally resolves to stable Base.
 */
export function resolveTeachingSkinDesign(
  index: TeachingSkinDesignIndex,
  skinId: string,
  variantId?: TeachingSkinVariantId,
): TeachingSkinDesignResolution {
  const snapshot = index.snapshot()
  const definition = snapshot.skinsById.get(skinId)
  if (!definition) return unavailable(issue('skin-missing', skinId, { variantId }))
  if (!definition.design) return unavailable(issue('design-missing', skinId, { variantId }))

  const requestedVariant = variantId === undefined
    ? undefined
    : (definition.design.variants ?? []).find((candidate) => candidate.id === variantId)
  const issues: TeachingSkinDesignIssue[] = requestedVariant || variantId === undefined
    ? []
    : [issue('variant-missing', skinId, { variantId })]

  const requestedTokenIds = new Map<string, TeachingSkinTokenId>()
  for (const slot of definition.design.slots) requestedTokenIds.set(slot.id, slot.defaultTokenId)
  for (const [slotId, tokenId] of Object.entries(requestedVariant?.tokenBindings ?? {})) requestedTokenIds.set(slotId, tokenId)

  const slotsById = new Map(definition.design.slots.map((slot) => [slot.id, slot]))
  const tokenBindings: ResolvedTeachingSkinTokenBinding[] = []
  const cssVariables: Record<TeachingSkinCssVariableName, string> = {}

  for (const slotId of [...requestedTokenIds.keys()].sort((left, right) => left.localeCompare(right))) {
    const slot = slotsById.get(slotId)
    const tokenId = requestedTokenIds.get(slotId) as TeachingSkinTokenId
    // Defend the runtime even if an unchecked or mutated source definition gets here.
    if (!slot) return unavailable(issue('token-invalid', skinId, { variantId, slotId, tokenId }))
    const tokenResolution = resolveSlotToken(slot, tokenId, snapshot)
    if (!tokenResolution.ok) return unavailable(issue(tokenResolution.code, skinId, { variantId, slotId, tokenId }))
    const token = tokenResolution.contribution.token
    const cssValue = serializeFromSnapshot(token, snapshot)
    if (!cssValue) return unavailable(issue('token-invalid', skinId, { variantId, slotId, tokenId }))
    const cssVariableName = teachingSkinSlotCssVariableName(definition.className, slotId)
    if (!cssVariableName) return unavailable(issue('css-variable-invalid', skinId, { variantId, slotId, tokenId }))
    tokenBindings.push({ slotId, tokenId, token })
    cssVariables[cssVariableName] = cssValue
  }

  return {
    status: 'resolved',
    design: {
      skinId: definition.id,
      skinVersion: definition.version,
      ...(requestedVariant ? { variantId: requestedVariant.id } : {}),
      tokenBindings: Object.freeze(tokenBindings),
      cssVariables: Object.freeze(cssVariables),
    },
    issues: Object.freeze(issues),
  }
}

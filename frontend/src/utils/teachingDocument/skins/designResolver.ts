import {
  MAX_TEACHING_SKIN_BORDER_WIDTH_PX,
  MAX_TEACHING_SKIN_TOKEN_PX,
  isTeachingSkinDefinition,
  isTeachingSkinTokenDefinition,
  type TeachingSkinDefinition,
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

export type TeachingSkinDesignIssueCode =
  | 'skin-missing'
  | 'design-invalid'
  | 'variant-missing'
  | 'token-missing'
  | 'token-ambiguous'
  | 'token-kind-mismatch'
  | 'token-disallowed'
  | 'token-invalid'

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
  | { status: 'no-design'; skinId: string; issues: readonly [] }
  | { status: 'resolved'; design: ResolvedTeachingSkinDesign; issues: readonly TeachingSkinDesignIssue[] }
  | { status: 'unavailable'; issues: readonly [TeachingSkinDesignIssue] }

type TokenResolution =
  | { ok: true; contribution: TeachingSkinTokenContribution & { token: TeachingSkinTokenDefinition } }
  | { ok: false; code: Exclude<TeachingSkinDesignIssueCode, 'skin-missing' | 'variant-missing'> }

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
  const contribution = contributions[0]
  if (!isTeachingSkinTokenDefinition(contribution.token)) return { ok: false, code: 'design-invalid' }
  return { ok: true, contribution: contribution as TeachingSkinTokenContribution & { token: TeachingSkinTokenDefinition } }
}

function isBoundedPx(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum
}

function serializeFromSnapshot(token: unknown, snapshot: TeachingSkinDesignIndexSnapshot): string | undefined {
  if (!isTeachingSkinTokenDefinition(token)) return undefined
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
 * Serializes a source-validated Token into its only allowed CSS value. Malformed
 * runtime source is rejected as undefined rather than escaping as an exception.
 */
export function serializeTeachingSkinTokenToCssValue(token: unknown, index: TeachingSkinDesignIndex): string | undefined {
  try {
    return serializeFromSnapshot(token, index.snapshot())
  } catch {
    return undefined
  }
}

/** Converts stable Skin and Slot compatibility IDs into one CSS-safe namespace. */
export function teachingSkinIdToCssNamespace(skinId: string): string {
  // Legal Skin IDs use lower-case alphanumerics plus `.`, `_`, and `-`.
  // Only `.` is escaped: `--` cannot occur in the grammar, so this keeps the
  // Skin ID portion injective without depending on implementation class names.
  return skinId.replaceAll('.', '--')
}

/** Generates a deterministic scoped variable from the stable Skin and local Slot IDs. */
export function teachingSkinSlotCssVariableName(skinId: string, slotId: string): TeachingSkinCssVariableName {
  return `--td-skin-${teachingSkinIdToCssNamespace(skinId)}-${slotId.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
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

function resolveValidatedDesign(
  definition: TeachingSkinDefinition,
  snapshot: TeachingSkinDesignIndexSnapshot,
  variantId?: TeachingSkinVariantId,
): TeachingSkinDesignResolution {
  const design = definition.design
  if (!design) return { status: 'no-design', skinId: definition.id, issues: Object.freeze([]) }

  const requestedVariant = variantId === undefined
    ? undefined
    : (design.variants ?? []).find((candidate) => candidate.id === variantId)
  const issues: TeachingSkinDesignIssue[] = requestedVariant || variantId === undefined
    ? []
    : [issue('variant-missing', definition.id, { variantId })]

  const requestedTokenIds = new Map<string, TeachingSkinTokenId>()
  for (const slot of design.slots) requestedTokenIds.set(slot.id, slot.defaultTokenId)
  for (const [slotId, tokenId] of Object.entries(requestedVariant?.tokenBindings ?? {})) requestedTokenIds.set(slotId, tokenId)

  const slotsById = new Map(design.slots.map((slot) => [slot.id, slot]))
  const tokenBindings: ResolvedTeachingSkinTokenBinding[] = []
  const cssVariables: Record<TeachingSkinCssVariableName, string> = {}

  for (const slotId of [...requestedTokenIds.keys()].sort((left, right) => left.localeCompare(right))) {
    const slot = slotsById.get(slotId)
    const tokenId = requestedTokenIds.get(slotId) as TeachingSkinTokenId
    if (!slot) return unavailable(issue('design-invalid', definition.id, { variantId, slotId, tokenId }))
    const tokenResolution = resolveSlotToken(slot, tokenId, snapshot)
    if (!tokenResolution.ok) return unavailable(issue(tokenResolution.code, definition.id, { variantId, slotId, tokenId }))
    const token = tokenResolution.contribution.token
    const cssValue = serializeFromSnapshot(token, snapshot)
    if (!cssValue) return unavailable(issue('token-invalid', definition.id, { variantId, slotId, tokenId }))
    tokenBindings.push({ slotId, tokenId, token })
    cssVariables[teachingSkinSlotCssVariableName(definition.id, slotId)] = cssValue
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

/**
 * Resolves Base Slot defaults, then overlays one explicit source Variant. This
 * accepts no document data and returns structured unavailable results for every
 * malformed runtime source boundary instead of throwing.
 */
export function resolveTeachingSkinDesign(
  index: TeachingSkinDesignIndex,
  skinId: string,
  variantId?: TeachingSkinVariantId,
): TeachingSkinDesignResolution {
  try {
    const snapshot = index.snapshot()
    const definition = snapshot.skinsById.get(skinId)
    if (!definition) return unavailable(issue('skin-missing', skinId, { variantId }))
    if (!isTeachingSkinDefinition(definition)) return unavailable(issue('design-invalid', skinId, { variantId }))
    return resolveValidatedDesign(definition, snapshot, variantId)
  } catch {
    return unavailable(issue('design-invalid', skinId, { variantId }))
  }
}

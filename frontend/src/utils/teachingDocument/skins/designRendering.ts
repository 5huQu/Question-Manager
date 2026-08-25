import type { BoxBlock, HeadingBlock, TeachingBlock, TeachingDocumentV1, TeachingSkinRef } from '@/types/teachingDocument'
import { createTeachingSkinDesignIndexFromRegistry } from './designIndex'
import { resolveTeachingSkinDesign, type TeachingSkinDesignIssue } from './designResolver'
import { teachingSkinRegistry } from './registryInstance'
import { parseTeachingSkinRef, type TeachingSkinDefinition, type TeachingSkinVariantId } from './types'

/** Ephemeral renderer input. It is deliberately not part of TeachingDocument JSON. */
export type TeachingSkinDesignVariantOverrides = Readonly<Partial<Record<string, TeachingSkinVariantId | null>>>
/** @deprecated Prefer the override name: null is an explicit temporary Base choice. */
export type TeachingSkinDesignVariantIds = TeachingSkinDesignVariantOverrides

export interface TeachingSkinDesignRenderState {
  status: 'no-design' | 'resolved' | 'unavailable'
  cssVariables?: Readonly<Record<`--td-skin-${string}`, string>>
  issues: readonly TeachingSkinDesignIssue[]
  /** Stable resolved input for geometry/pagination cache identity. */
  signature: string
}

const designIndex = createTeachingSkinDesignIndexFromRegistry(teachingSkinRegistry)

/**
 * Selects one requested Variant for all renderer and layout paths.
 * An absent override uses the persisted ref; null explicitly previews Base.
 */
export function resolveTeachingSkinVariantRequest(
  skin: TeachingSkinRef,
  skinId: string,
  overrides?: TeachingSkinDesignVariantOverrides,
): TeachingSkinVariantId | undefined {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, skinId)) {
    return overrides[skinId] ?? undefined
  }
  return skin.variant
}

/**
 * The only renderer adapter over the pure Design resolver. It exposes trusted
 * scoped custom properties, never raw metadata or document-provided CSS.
 */
export function resolveTeachingSkinDesignRenderState(
  definition: TeachingSkinDefinition,
  variantId?: TeachingSkinVariantId,
): TeachingSkinDesignRenderState {
  const resolution = resolveTeachingSkinDesign(designIndex, definition.id, variantId)
  if (resolution.status === 'resolved') {
    const bindings = resolution.design.tokenBindings
      .slice()
      .sort((left, right) => left.slotId.localeCompare(right.slotId))
      .map(({ slotId, tokenId }) => `${slotId}:${tokenId}`)
      .join(';')
    return {
      status: 'resolved',
      cssVariables: resolution.design.cssVariables,
      issues: resolution.issues,
      signature: `resolved:${resolution.design.skinId}:v${resolution.design.skinVersion}:requested:${variantId || 'base'}:resolved:${resolution.design.variantId || 'base'}:${bindings}`,
    }
  }
  if (resolution.status === 'no-design') {
    return { status: 'no-design', issues: resolution.issues, signature: `no-design:${definition.id}:v${definition.version}:requested:${variantId || 'base'}` }
  }
  return {
    status: 'unavailable',
    issues: resolution.issues,
    signature: `unavailable:${definition.id}:v${definition.version}:requested:${variantId || 'base'}:${resolution.issues.map((entry) => `${entry.code}:${entry.slotId || ''}:${entry.tokenId || ''}`).join('|')}`,
  }
}

export function teachingSkinDesignStyleAttribute(cssVariables: TeachingSkinDesignRenderState['cssVariables']): string | undefined {
  if (!cssVariables) return undefined
  const value = Object.entries(cssVariables).map(([name, cssValue]) => `${name}: ${cssValue}`).join('; ')
  return value || undefined
}

function visitSkinRoots(blocks: readonly TeachingBlock[], visit: (block: HeadingBlock | BoxBlock) => void) {
  for (const block of blocks) {
    if (block.type === 'heading' || block.type === 'box') visit(block)
    if (block.type === 'box') visitSkinRoots(block.children, visit)
  }
}

/**
 * Includes the resolved, trusted design map of every Skin root. Any change is
 * treated as geometry-affecting so pagination never reuses stale measurements.
 */
export function teachingDocumentSkinDesignSignature(
  document: TeachingDocumentV1,
  variantOverrides?: TeachingSkinDesignVariantOverrides,
): string {
  const entries: string[] = []
  visitSkinRoots(document.content, (block) => {
    const skin = parseTeachingSkinRef(block.skin)
    if (!skin) return
    const requestedVariantId = resolveTeachingSkinVariantRequest(skin, skin.id, variantOverrides)
    const definition = teachingSkinRegistry.get(skin.id)
    if (!definition || definition.target !== block.type) {
      entries.push(`${block.id}:skin-missing:${skin.id}:v${skin.version || 'unversioned'}:requested:${requestedVariantId || 'base'}`)
      return
    }
    entries.push(`${block.id}:${resolveTeachingSkinDesignRenderState(definition, requestedVariantId).signature}`)
  })
  return entries.sort().join('|')
}

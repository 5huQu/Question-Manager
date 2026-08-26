import type { BoxBlock, BoxChildBlock, HeadingBlock, TeachingBlock, TeachingDocumentV1, TeachingSkinRef } from '@/types/teachingDocument'
import { teachingSkinRegistry } from './registryInstance'
import type { TeachingSkinPresetDefinition } from './presets'
import type { TeachingSkinRegistry } from './registry'
import { isTeachingSkinDefinition, type TeachingSkinDefinition } from './types'

export type TeachingPresetRecommendedSkinTarget = 'heading' | 'box'
export type TeachingPresetRecommendedSkinTargetStatus = 'not-configured' | 'available' | 'unavailable'
export type TeachingPresetRecommendedSkinUnavailableReason = 'skin-missing' | 'target-mismatch' | 'binding-missing' | 'binding-variant-missing'

export interface TeachingPresetRecommendedSkinTargetPlan {
  status: TeachingPresetRecommendedSkinTargetStatus
  recommendedSkinId?: string
  recommendedSkinVersion?: number
  eligibleBlockIds: readonly string[]
  alreadyRecommendedCount: number
  existingOtherSkinCount: number
  incompatibleCount: number
  unavailableReason?: TeachingPresetRecommendedSkinUnavailableReason
}

export interface TeachingDocumentPresetRecommendedSkinsPlan {
  status: 'none' | 'available' | 'unavailable'
  heading: TeachingPresetRecommendedSkinTargetPlan
  box: TeachingPresetRecommendedSkinTargetPlan
  totalEligible: number
}

export interface TeachingDocumentRecommendedSkinSelection {
  heading: boolean
  box: boolean
}

const EMPTY_TARGET_PLAN: TeachingPresetRecommendedSkinTargetPlan = Object.freeze({
  status: 'not-configured',
  eligibleBlockIds: Object.freeze([]),
  alreadyRecommendedCount: 0,
  existingOtherSkinCount: 0,
  incompatibleCount: 0,
})

function visitSkinBlocks(blocks: readonly TeachingBlock[], visit: (block: HeadingBlock | BoxBlock) => void) {
  for (const block of blocks) {
    if (block.type === 'heading' || block.type === 'box') visit(block)
    if (block.type === 'box') visitSkinBlocks(block.children as TeachingBlock[], visit)
  }
}

function recommendedDefinition(
  preset: TeachingSkinPresetDefinition,
  target: TeachingPresetRecommendedSkinTarget,
  registry: TeachingSkinRegistry,
): { definition?: TeachingSkinDefinition; skinId?: string; unavailableReason?: TeachingPresetRecommendedSkinUnavailableReason } {
  const skinId = preset.recommendedSkins?.[target]
  if (!skinId) return {}
  const definition = registry.get(skinId)
  if (!definition || !isTeachingSkinDefinition(definition)) return { skinId, unavailableReason: 'skin-missing' }
  if (definition.target !== target) return { skinId, unavailableReason: 'target-mismatch' }
  const variantId = preset.bindings[skinId]
  if (variantId === undefined) return { skinId, unavailableReason: 'binding-missing' }
  if (!definition.design?.variants?.some((variant) => variant.id === variantId)) {
    return { skinId, unavailableReason: 'binding-variant-missing' }
  }
  return { definition, skinId }
}

function isCompatible(block: HeadingBlock | BoxBlock, definition: TeachingSkinDefinition) {
  if (block.type === 'heading') return definition.target === 'heading'
    && (!definition.supportedLevels || definition.supportedLevels.includes(block.level))
  return definition.target === 'box'
    && (!definition.supportedTemplates || definition.supportedTemplates.includes(block.templateId))
}

function planTarget(
  document: TeachingDocumentV1,
  preset: TeachingSkinPresetDefinition,
  target: TeachingPresetRecommendedSkinTarget,
  registry: TeachingSkinRegistry,
): TeachingPresetRecommendedSkinTargetPlan {
  const recommendation = recommendedDefinition(preset, target, registry)
  if (!recommendation.skinId) return EMPTY_TARGET_PLAN
  if (!recommendation.definition) {
    return {
      ...EMPTY_TARGET_PLAN,
      status: 'unavailable',
      recommendedSkinId: recommendation.skinId,
      unavailableReason: recommendation.unavailableReason,
    }
  }

  const eligibleBlockIds: string[] = []
  let alreadyRecommendedCount = 0
  let existingOtherSkinCount = 0
  let incompatibleCount = 0
  visitSkinBlocks(document.content, (block) => {
    if (block.type !== target) return
    if (block.skin !== undefined) {
      if (block.skin.id === recommendation.skinId) alreadyRecommendedCount += 1
      else existingOtherSkinCount += 1
      return
    }
    if (isCompatible(block, recommendation.definition!)) eligibleBlockIds.push(block.id)
    else incompatibleCount += 1
  })
  return {
    status: 'available',
    recommendedSkinId: recommendation.skinId,
    recommendedSkinVersion: recommendation.definition.version,
    eligibleBlockIds,
    alreadyRecommendedCount,
    existingOtherSkinCount,
    incompatibleCount,
  }
}

/**
 * Builds a source-only authoring plan from one exact, resolved Preset definition.
 * Rendering never calls this helper: Preset runtime remains Skin → Variant only.
 */
export function planTeachingDocumentPresetRecommendedSkins(
  document: TeachingDocumentV1,
  preset: TeachingSkinPresetDefinition,
  registry: TeachingSkinRegistry = teachingSkinRegistry,
): TeachingDocumentPresetRecommendedSkinsPlan {
  const heading = planTarget(document, preset, 'heading', registry)
  const box = planTarget(document, preset, 'box', registry)
  const totalEligible = heading.eligibleBlockIds.length + box.eligibleBlockIds.length
  const status = heading.status === 'available' || box.status === 'available'
    ? 'available'
    : heading.status === 'unavailable' || box.status === 'unavailable'
      ? 'unavailable'
      : 'none'
  return { status, heading, box, totalEligible }
}

function eligibleSkinAssignments(
  plan: TeachingDocumentPresetRecommendedSkinsPlan,
  selection: TeachingDocumentRecommendedSkinSelection,
): ReadonlyMap<string, TeachingSkinRef> {
  const assignments = new Map<string, TeachingSkinRef>()
  for (const target of ['heading', 'box'] as const) {
    const targetPlan = plan[target]
    if (!selection[target] || targetPlan.status !== 'available' || !targetPlan.recommendedSkinId || !targetPlan.recommendedSkinVersion) continue
    for (const blockId of targetPlan.eligibleBlockIds) {
      assignments.set(blockId, { id: targetPlan.recommendedSkinId, version: targetPlan.recommendedSkinVersion })
    }
  }
  return assignments
}

function applyAssignments(blocks: readonly TeachingBlock[], assignments: ReadonlyMap<string, TeachingSkinRef>): { blocks: TeachingBlock[]; changed: boolean } {
  let changed = false
  const nextBlocks = blocks.map((block) => {
    const assignedSkin = assignments.get(block.id)
    const nextBlock = assignedSkin && (block.type === 'heading' || block.type === 'box') && block.skin === undefined
      ? { ...block, skin: assignedSkin }
      : block
    if (nextBlock !== block) changed = true
    if (nextBlock.type !== 'box') return nextBlock
    const children = applyAssignments(nextBlock.children as TeachingBlock[], assignments)
    if (!children.changed) return nextBlock
    changed = true
    return { ...nextBlock, children: children.blocks as BoxChildBlock[] }
  })
  return { blocks: nextBlocks, changed }
}

/** Applies one selected plan atomically and writes only a Skin id/version pair. */
export function applyTeachingDocumentRecommendedSkins(
  document: TeachingDocumentV1,
  plan: TeachingDocumentPresetRecommendedSkinsPlan,
  selection: TeachingDocumentRecommendedSkinSelection,
): TeachingDocumentV1 {
  const assignments = eligibleSkinAssignments(plan, selection)
  if (!assignments.size) return document
  const result = applyAssignments(document.content, assignments)
  return result.changed ? { ...document, content: result.blocks } : document
}

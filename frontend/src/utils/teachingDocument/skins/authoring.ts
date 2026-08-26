/**
 * Side-effect-free public API for source-level Teaching Skin authors.
 *
 * This module intentionally does not import discovery, the registry, or the
 * resolver. Definitions can therefore be loaded by discovery without a
 * reverse dependency on the application runtime.
 */
export { defineBoxSkin, defineHeadingSkin } from './types'
export { defineTeachingSkinPreset } from './presets'
export type {
  BoxSkinDefinition,
  BoxSkinInput,
  HeadingSkinDefinition,
  HeadingSkinInput,
  HeadingSkinLevel,
  TeachingSkinBorderTokenDefinition,
  TeachingSkinColorTokenDefinition,
  TeachingSkinDesignMetadata,
  TeachingSkinDefinition,
  TeachingSkinDefinitionBase,
  TeachingSkinRadiusTokenDefinition,
  TeachingSkinSlotDefinition,
  TeachingSkinSlotId,
  TeachingSkinSpacingTokenDefinition,
  TeachingSkinTokenDefinition,
  TeachingSkinTokenId,
  TeachingSkinTokenKind,
  TeachingSkinVariantDefinition,
  TeachingSkinVariantId,
} from './types'
export type { TeachingSkinPresetDefinition, TeachingSkinPresetInput, TeachingSkinPresetRecommendedSkins } from './presets'

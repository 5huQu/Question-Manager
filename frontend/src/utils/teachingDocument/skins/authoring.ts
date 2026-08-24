/**
 * Side-effect-free public API for source-level Teaching Skin authors.
 *
 * This module intentionally does not import discovery, the registry, or the
 * resolver. Definitions can therefore be loaded by discovery without a
 * reverse dependency on the application runtime.
 */
export { defineBoxSkin, defineHeadingSkin } from './types'
export type {
  BoxSkinDefinition,
  BoxSkinInput,
  HeadingSkinDefinition,
  HeadingSkinInput,
  HeadingSkinLevel,
  TeachingSkinDefinitionBase,
} from './types'

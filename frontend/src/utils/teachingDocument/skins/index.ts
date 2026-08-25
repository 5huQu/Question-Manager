export {
  hasValidTeachingSkinRef,
  isJsonValue,
  isTeachingSkinDefinition,
  isTeachingSkinDesignMetadata,
  isTeachingSkinSlotDefinition,
  isTeachingSkinTokenDefinition,
  isTeachingSkinVariantDefinition,
  parseTeachingSkinRef,
} from './types'
export type {
  BoxSkinDefinition,
  HeadingSkinDefinition,
  HeadingSkinLevel,
  TeachingSkinBorderTokenDefinition,
  TeachingSkinColorTokenDefinition,
  TeachingSkinDefinition,
  TeachingSkinDefinitionBase,
  TeachingSkinDesignMetadata,
  TeachingSkinRadiusTokenDefinition,
  TeachingSkinSlotDefinition,
  TeachingSkinSlotId,
  TeachingSkinSpacingTokenDefinition,
  TeachingSkinTokenDefinition,
  TeachingSkinTokenId,
  TeachingSkinTokenKind,
  TeachingSkinTarget,
  TeachingSkinVariantDefinition,
  TeachingSkinVariantId,
} from './types'
export { TeachingSkinRegistry } from './registry'
export { teachingSkinRegistry } from './registryInstance'
export { resolveBoxSkin, resolveHeadingSkin, skinClassName } from './resolver'
export type { TeachingSkinResolution } from './resolver'
export { createTeachingSkinDesignIndex, createTeachingSkinDesignIndexFromRegistry } from './designIndex'
export type { TeachingSkinDesignIndex, TeachingSkinDesignIndexSnapshot, TeachingSkinTokenContribution } from './designIndex'
export {
  resolveTeachingSkinDesign,
  serializeTeachingSkinTokenToCssValue,
  teachingSkinIdToCssNamespace,
  teachingSkinSlotCssVariableName,
} from './designResolver'
export {
  resolveTeachingSkinDesignRenderState,
  resolveTeachingSkinVariantRequest,
  teachingDocumentSkinDesignSignature,
  teachingSkinDesignStyleAttribute,
} from './designRendering'
export type { TeachingSkinDesignRenderState, TeachingSkinDesignVariantIds, TeachingSkinDesignVariantOverrides } from './designRendering'
export type {
  ResolvedTeachingSkinDesign,
  ResolvedTeachingSkinTokenBinding,
  TeachingSkinCssVariableName,
  TeachingSkinDesignIssue,
  TeachingSkinDesignIssueCode,
  TeachingSkinDesignResolution,
} from './designResolver'

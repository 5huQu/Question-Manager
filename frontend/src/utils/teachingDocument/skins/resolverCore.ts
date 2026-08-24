import type { TeachingSkinRef } from '@/types/teachingDocument'
import type { TeachingSkinRegistry } from './registry'
import type { BoxSkinDefinition, HeadingSkinDefinition, HeadingSkinLevel, TeachingSkinDefinition } from './types'

export type TeachingSkinResolution<T extends TeachingSkinDefinition> =
  | { status: 'default'; skin?: undefined; definition?: undefined }
  | { status: 'resolved'; skin: TeachingSkinRef; definition: T }
  | { status: 'missing' | 'incompatible'; skin: TeachingSkinRef; definition?: undefined }

/**
 * Pure resolution helpers for callers that own a registry, including authoring tests.
 * They deliberately do not import auto-discovery or the application registry.
 */
export function resolveHeadingSkinFromRegistry(
  skin: TeachingSkinRef | undefined,
  level: HeadingSkinLevel,
  registry: TeachingSkinRegistry,
): TeachingSkinResolution<HeadingSkinDefinition> {
  if (!skin) return { status: 'default' }
  const definition = registry.get(skin.id)
  if (!definition) return { status: 'missing', skin }
  if (definition.target !== 'heading' || (definition.supportedLevels && !definition.supportedLevels.includes(level))) {
    return { status: 'incompatible', skin }
  }
  return { status: 'resolved', skin, definition }
}

export function resolveBoxSkinFromRegistry(
  skin: TeachingSkinRef | undefined,
  templateId: string,
  registry: TeachingSkinRegistry,
): TeachingSkinResolution<BoxSkinDefinition> {
  if (!skin) return { status: 'default' }
  const definition = registry.get(skin.id)
  if (!definition) return { status: 'missing', skin }
  if (definition.target !== 'box' || (definition.supportedTemplates && !definition.supportedTemplates.includes(templateId))) {
    return { status: 'incompatible', skin }
  }
  return { status: 'resolved', skin, definition }
}

export function skinClassName(resolution: TeachingSkinResolution<TeachingSkinDefinition>): string | undefined {
  return resolution.status === 'resolved' ? resolution.definition.className : undefined
}

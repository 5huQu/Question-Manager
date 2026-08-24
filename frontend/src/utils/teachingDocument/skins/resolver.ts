import type { TeachingSkinRef } from '@/types/teachingDocument'
import { teachingSkinRegistry } from './registryInstance'
import type { BoxSkinDefinition, HeadingSkinDefinition, HeadingSkinLevel, TeachingSkinDefinition } from './types'
import type { TeachingSkinRegistry } from './registry'

export type TeachingSkinResolution<T extends TeachingSkinDefinition> =
  | { status: 'default'; skin?: undefined; definition?: undefined }
  | { status: 'resolved'; skin: TeachingSkinRef; definition: T }
  | { status: 'missing' | 'incompatible'; skin: TeachingSkinRef; definition?: undefined }

export function resolveHeadingSkin(
  skin: TeachingSkinRef | undefined,
  level: HeadingSkinLevel,
  registry: TeachingSkinRegistry = teachingSkinRegistry,
): TeachingSkinResolution<HeadingSkinDefinition> {
  if (!skin) return { status: 'default' }
  const definition = registry.get(skin.id)
  if (!definition) return { status: 'missing', skin }
  if (definition.target !== 'heading' || (definition.supportedLevels && !definition.supportedLevels.includes(level))) {
    return { status: 'incompatible', skin }
  }
  return { status: 'resolved', skin, definition }
}

export function resolveBoxSkin(
  skin: TeachingSkinRef | undefined,
  templateId: string,
  registry: TeachingSkinRegistry = teachingSkinRegistry,
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

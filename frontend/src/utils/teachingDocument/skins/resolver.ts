import { teachingSkinRegistry } from './registryInstance'
import type { TeachingSkinRef } from '@/types/teachingDocument'
import type { BoxSkinDefinition, HeadingSkinDefinition, HeadingSkinLevel } from './types'
import {
  resolveBoxSkinFromRegistry,
  resolveHeadingSkinFromRegistry,
  skinClassName,
  type TeachingSkinResolution,
} from './resolverCore'

export { skinClassName, type TeachingSkinResolution } from './resolverCore'

export function resolveHeadingSkin(
  skin: TeachingSkinRef | undefined,
  level: HeadingSkinLevel,
  registry = teachingSkinRegistry,
): TeachingSkinResolution<HeadingSkinDefinition> {
  return resolveHeadingSkinFromRegistry(skin, level, registry)
}

export function resolveBoxSkin(
  skin: TeachingSkinRef | undefined,
  templateId: string,
  registry = teachingSkinRegistry,
): TeachingSkinResolution<BoxSkinDefinition> {
  return resolveBoxSkinFromRegistry(skin, templateId, registry)
}

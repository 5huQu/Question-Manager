import { TeachingSkinRegistry } from './registry'
import { isTeachingSkinDefinition } from './types'

export const teachingSkinRegistry = new TeachingSkinRegistry()

const discoveredModules = import.meta.glob('/src/extensions/teaching-document/skins/**/skin.ts', { eager: true })

for (const [path, module] of Object.entries(discoveredModules)) {
  const definition = (module as { default?: unknown }).default
  if (!isTeachingSkinDefinition(definition)) {
    throw new Error(`Teaching skin module "${path}" must default-export a valid skin definition.`)
  }
  teachingSkinRegistry.register(definition)
}

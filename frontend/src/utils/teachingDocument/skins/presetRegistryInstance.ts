import { TeachingSkinPresetRegistry, isTeachingSkinPresetDefinition } from './presets'

export const teachingSkinPresetRegistry = new TeachingSkinPresetRegistry()

const discoveredModules = import.meta.glob('/src/extensions/teaching-document/skins/presets/**/preset.ts', { eager: true })
for (const [path, module] of Object.entries(discoveredModules)) {
  const definition = (module as { default?: unknown }).default
  if (!isTeachingSkinPresetDefinition(definition)) throw new Error(`Teaching Skin Preset module "${path}" must default-export a valid preset definition.`)
  teachingSkinPresetRegistry.register(definition)
}

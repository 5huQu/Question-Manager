import { describe, expect, it } from 'vitest'
import type { TeachingSkinDefinition } from '@/utils/teachingDocument/skins/authoring'
import { TeachingSkinRegistry } from '@/utils/teachingDocument/skins/registry'
import { resolveBoxSkinFromRegistry, resolveHeadingSkinFromRegistry } from '@/utils/teachingDocument/skins/resolverCore'
import { isTeachingSkinDefinition } from '@/utils/teachingDocument/skins/types'

/** Test-only baseline checks shared by scaffolded skin tests. */
export function describeTeachingSkinContract(definition: TeachingSkinDefinition) {
  describe(`Teaching Skin contract: ${definition.id}`, () => {
    it('is valid, print-safe, and registers once', () => {
      expect(isTeachingSkinDefinition(definition)).toBe(true)
      expect(definition.printSafe).toBe(true)
      const registry = new TeachingSkinRegistry()
      registry.register(definition)
      expect(registry.get(definition.id)).toBe(definition)
      expect(() => registry.register(definition)).toThrow(/already registered/)
    })

    it('resolves its compatible target and leaves the opposite target incompatible', () => {
      const registry = new TeachingSkinRegistry()
      registry.register(definition)
      const ref = { id: definition.id, version: definition.version }
      if (definition.target === 'heading') {
        const level = definition.supportedLevels?.[0] ?? 1
        expect(resolveHeadingSkinFromRegistry(ref, level, registry)).toMatchObject({ status: 'resolved', definition })
        expect(resolveBoxSkinFromRegistry(ref, 'concept', registry)).toMatchObject({ status: 'incompatible', skin: ref })
      } else {
        const template = definition.supportedTemplates?.[0] ?? 'concept'
        expect(resolveBoxSkinFromRegistry(ref, template, registry)).toMatchObject({ status: 'resolved', definition })
        expect(resolveHeadingSkinFromRegistry(ref, 1, registry)).toMatchObject({ status: 'incompatible', skin: ref })
      }
    })
  })
}

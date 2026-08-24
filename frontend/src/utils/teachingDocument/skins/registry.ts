import type { TeachingSkinDefinition, TeachingSkinTarget } from './types'

/** Small deterministic registry for source-level skin modules. */
export class TeachingSkinRegistry {
  private readonly definitions = new Map<string, TeachingSkinDefinition>()

  register(definition: TeachingSkinDefinition): void {
    if (this.definitions.has(definition.id)) {
      throw new Error(`Teaching skin ID "${definition.id}" is already registered.`)
    }
    this.definitions.set(definition.id, definition)
  }

  get(id: string): TeachingSkinDefinition | undefined {
    return this.definitions.get(id)
  }

  list<T extends TeachingSkinTarget>(target?: T): Extract<TeachingSkinDefinition, { target: T }>[] {
    const definitions = [...this.definitions.values()]
    return (target ? definitions.filter((definition) => definition.target === target) : definitions) as Extract<TeachingSkinDefinition, { target: T }>[]
  }
}

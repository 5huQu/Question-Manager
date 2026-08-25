import type { TeachingSkinRegistry } from './registry'
import type { TeachingSkinDefinition, TeachingSkinTokenDefinition, TeachingSkinTokenId } from './types'

/** A trusted Token contribution made by one currently registered Skin. */
export interface TeachingSkinTokenContribution {
  skinId: string
  token: TeachingSkinTokenDefinition
}

export interface TeachingSkinDesignIndexSnapshot {
  readonly skinsById: ReadonlyMap<string, TeachingSkinDefinition>
  readonly tokensById: ReadonlyMap<TeachingSkinTokenId, readonly TeachingSkinTokenContribution[]>
}

/**
 * Lookup data derived only from the current Skin registry.
 *
 * A registry-backed index is deliberately live: every snapshot reads the current
 * registry definitions, so application callers never resolve from a stale cached
 * Token contribution set. Iterable input remains a fixed pure-test snapshot.
 */
export interface TeachingSkinDesignIndex extends TeachingSkinDesignIndexSnapshot {
  snapshot(): TeachingSkinDesignIndexSnapshot
}

type TeachingSkinDefinitionSource = TeachingSkinRegistry | Iterable<TeachingSkinDefinition>

function snapshotFrom(definitions: Iterable<TeachingSkinDefinition>): TeachingSkinDesignIndexSnapshot {
  const sortedDefinitions = [...definitions].sort((left, right) => left.id.localeCompare(right.id))
  const skinsById = new Map<string, TeachingSkinDefinition>()
  const tokenContributions = new Map<TeachingSkinTokenId, TeachingSkinTokenContribution[]>()

  for (const definition of sortedDefinitions) {
    // TeachingSkinRegistry already prevents this in application use. Keep every
    // source of a duplicate Token, but do not let an iterable overwrite a Skin.
    if (!skinsById.has(definition.id)) skinsById.set(definition.id, definition)
    for (const token of definition.design?.tokens ?? []) {
      const contributions = tokenContributions.get(token.id) ?? []
      contributions.push({ skinId: definition.id, token })
      tokenContributions.set(token.id, contributions)
    }
  }

  const tokensById = new Map<TeachingSkinTokenId, readonly TeachingSkinTokenContribution[]>()
  for (const tokenId of [...tokenContributions.keys()].sort((left, right) => left.localeCompare(right))) {
    const contributions = tokenContributions.get(tokenId) ?? []
    tokensById.set(tokenId, Object.freeze([...contributions].sort((left, right) => left.skinId.localeCompare(right.skinId))))
  }

  return { skinsById, tokensById }
}

/**
 * Creates deterministic Design Index lookup data. Passing the existing registry
 * keeps snapshots current without introducing another discovery mechanism.
 */
export function createTeachingSkinDesignIndex(source: TeachingSkinDefinitionSource): TeachingSkinDesignIndex {
  const getSnapshot = 'list' in source
    ? () => snapshotFrom(source.list())
    : (() => {
        const definitions = [...source]
        return () => snapshotFrom(definitions)
      })()

  return {
    snapshot: getSnapshot,
    get skinsById() {
      return getSnapshot().skinsById
    },
    get tokensById() {
      return getSnapshot().tokensById
    },
  }
}

/** Explicit convenience form for application callers using the singleton registry. */
export function createTeachingSkinDesignIndexFromRegistry(registry: TeachingSkinRegistry): TeachingSkinDesignIndex {
  return createTeachingSkinDesignIndex(registry)
}

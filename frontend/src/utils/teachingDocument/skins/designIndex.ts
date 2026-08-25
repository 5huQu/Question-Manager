import type { TeachingSkinRegistry } from './registry'
import type { TeachingSkinTokenId } from './types'

/** A Token contribution retained for fail-closed runtime validation. */
export interface TeachingSkinTokenContribution {
  skinId: string
  token: unknown
}

export interface TeachingSkinDesignIndexSnapshot {
  readonly skinsById: ReadonlyMap<string, unknown>
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

type TeachingSkinDefinitionSource = TeachingSkinRegistry | Iterable<unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function snapshotFrom(definitions: Iterable<unknown>): TeachingSkinDesignIndexSnapshot {
  const entries: Array<{ skinId: string; definition: unknown }> = []
  for (const definition of definitions) {
    try {
      if (!isRecord(definition) || typeof definition.id !== 'string') continue
      entries.push({ skinId: definition.id, definition })
    } catch {
      // A malformed source contribution is ignored here and cannot break the index.
    }
  }
  entries.sort((left, right) => left.skinId.localeCompare(right.skinId))

  const skinsById = new Map<string, unknown>()
  const tokenContributions = new Map<TeachingSkinTokenId, TeachingSkinTokenContribution[]>()
  for (const { skinId, definition } of entries) {
    if (!skinsById.has(skinId)) skinsById.set(skinId, definition)
    try {
      if (!isRecord(definition) || !isRecord(definition.design) || !Array.isArray(definition.design.tokens)) continue
      for (const token of definition.design.tokens) {
        if (!isRecord(token) || typeof token.id !== 'string') continue
        const contributions = tokenContributions.get(token.id) ?? []
        contributions.push({ skinId, token })
        tokenContributions.set(token.id, contributions)
      }
    } catch {
      // Keep the Skin entry. Resolver validation reports it as design-invalid.
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

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

export type QueryKey = readonly unknown[]

export type QuerySnapshot<T> = {
  data: T | undefined
  error: Error | null
  status: 'idle' | 'loading' | 'success' | 'error'
  stale: boolean
  updatedAt: number
}
type QueryEntry<T = unknown> = {
  snapshot: QuerySnapshot<T>
  promise?: Promise<T>
  listeners: Set<() => void>
}

function serializeKey(key: QueryKey) {
  return JSON.stringify(key)
}

function keyStartsWith(key: QueryKey, prefix: QueryKey) {
  return prefix.every((value, index) => Object.is(key[index], value))
}

export class QueryClient {
  private readonly entries = new Map<string, QueryEntry>()
  private readonly keys = new Map<string, QueryKey>()

  private entry<T>(key: QueryKey): QueryEntry<T> {
    const id = serializeKey(key)
    this.keys.set(id, key)
    let entry = this.entries.get(id)
    if (!entry) {
      entry = {
        snapshot: { data: undefined, error: null, status: 'idle', stale: true, updatedAt: 0 },
        listeners: new Set(),
      }
      this.entries.set(id, entry)
    }
    return entry as QueryEntry<T>
  }

  getSnapshot<T>(key: QueryKey) {
    return this.entry<T>(key).snapshot
  }

  subscribe(key: QueryKey, listener: () => void) {
    const entry = this.entry(key)
    entry.listeners.add(listener)
    return () => entry.listeners.delete(listener)
  }

  private publish<T>(entry: QueryEntry<T>, snapshot: QuerySnapshot<T>) {
    entry.snapshot = snapshot
    entry.listeners.forEach((listener) => listener())
  }

  async fetchQuery<T>(key: QueryKey, queryFn: () => Promise<T>, options: { force?: boolean; staleTime?: number } = {}) {
    const entry = this.entry<T>(key)
    if (entry.promise) return entry.promise
    const age = Date.now() - entry.snapshot.updatedAt
    if (!options.force && entry.snapshot.data !== undefined && !entry.snapshot.stale && age <= (options.staleTime ?? 30_000)) {
      return entry.snapshot.data
    }
    this.publish(entry, { ...entry.snapshot, error: null, status: 'loading' })
    entry.promise = queryFn()
      .then((data) => {
        this.publish(entry, { data, error: null, status: 'success', stale: false, updatedAt: Date.now() })
        return data
      })
      .catch((error) => {
        const normalized = error instanceof Error ? error : new Error(String(error))
        this.publish(entry, { ...entry.snapshot, error: normalized, status: 'error', stale: true })
        throw normalized
      })
      .finally(() => {
        entry.promise = undefined
      })
    return entry.promise
  }

  setQueryData<T>(key: QueryKey, updater: T | ((current: T | undefined) => T)) {
    const entry = this.entry<T>(key)
    const data = typeof updater === 'function'
      ? (updater as (current: T | undefined) => T)(entry.snapshot.data)
      : updater
    this.publish(entry, { data, error: null, status: 'success', stale: false, updatedAt: Date.now() })
    return data
  }

  invalidateQueries(prefix: QueryKey = []) {
    for (const [id, entry] of this.entries) {
      const key = this.keys.get(id) || []
      if (!keyStartsWith(key, prefix)) continue
      this.publish(entry, { ...entry.snapshot, stale: true })
    }
  }

  clear() {
    this.entries.clear()
    this.keys.clear()
  }
}

export const queryClient = new QueryClient()

export function useQuery<T>(options: {
  key: QueryKey
  queryFn: () => Promise<T>
  enabled?: boolean
  staleTime?: number
}) {
  const keyId = serializeKey(options.key)
  const keyRef = useRef(options.key)
  const queryFnRef = useRef(options.queryFn)
  keyRef.current = options.key
  queryFnRef.current = options.queryFn
  const subscribe = useCallback((listener: () => void) => queryClient.subscribe(keyRef.current, listener), [keyId])
  const getSnapshot = useCallback(() => queryClient.getSnapshot<T>(keyRef.current), [keyId])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const refetch = useCallback((force = true) => queryClient.fetchQuery(keyRef.current, queryFnRef.current, {
    force,
    staleTime: options.staleTime,
  }), [keyId, options.staleTime])

  useEffect(() => {
    if (options.enabled === false) return
    if (snapshot.status === 'idle' || snapshot.stale) void refetch(false)
  }, [options.enabled, refetch, snapshot.stale, snapshot.status])

  return {
    ...snapshot,
    refetch,
    setData: (updater: T | ((current: T | undefined) => T)) => queryClient.setQueryData(keyRef.current, updater),
  }
}

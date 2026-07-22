import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from './queryCache'

describe('QueryClient', () => {
  it('deduplicates in-flight requests and reuses fresh data', async () => {
    const client = new QueryClient()
    const fetcher = vi.fn(async () => ({ value: 1 }))
    const first = client.fetchQuery(['job', '1'], fetcher)
    const second = client.fetchQuery(['job', '1'], fetcher)
    expect(await first).toEqual({ value: 1 })
    expect(await second).toEqual({ value: 1 })
    expect(await client.fetchQuery(['job', '1'], fetcher)).toEqual({ value: 1 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('invalidates by key prefix without evicting cached data', async () => {
    const client = new QueryClient()
    await client.fetchQuery(['import-v2', 'documents'], async () => ['a'])
    await client.fetchQuery(['other'], async () => ['b'])
    client.invalidateQueries(['import-v2'])
    expect(client.getSnapshot<string[]>(['import-v2', 'documents']).stale).toBe(true)
    expect(client.getSnapshot<string[]>(['import-v2', 'documents']).data).toEqual(['a'])
    expect(client.getSnapshot<string[]>(['other']).stale).toBe(false)
  })
})

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'

type ReloadOptions = {
  silent?: boolean
}

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const reload = useCallback((options: ReloadOptions = {}) => {
    if (!options.silent) setLoading(true)
    setError('')
    return loader()
      .then((next) => {
        setData(next)
        return next
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
        return null
      })
      .finally(() => {
        if (!options.silent) setLoading(false)
      })
  }, deps)
  useEffect(() => {
    reload()
  }, [reload])
  return { data, error, loading, reload, setData: setData as Dispatch<SetStateAction<T | null>> }
}

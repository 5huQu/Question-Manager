import { useEffect, useRef } from 'react'

type PollingTask = (signal: AbortSignal) => Promise<void> | void

type VisibilityAwarePollingOptions = {
  enabled: boolean
  intervalMs: number
  immediate?: boolean
  onError?: (error: unknown) => void
}

/** Runs one polling request at a time and pauses while the page is hidden. */
export function useVisibilityAwarePolling(
  task: PollingTask,
  { enabled, intervalMs, immediate = false, onError }: VisibilityAwarePollingOptions,
) {
  const taskRef = useRef(task)
  const errorHandlerRef = useRef(onError)
  taskRef.current = task
  errorHandlerRef.current = onError

  useEffect(() => {
    if (!enabled) return undefined

    let disposed = false
    let timer: number | undefined
    let controller: AbortController | undefined

    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = undefined
    }

    const schedule = (delay: number) => {
      clearTimer()
      if (disposed || document.visibilityState === 'hidden') return
      timer = window.setTimeout(run, delay)
    }

    const run = async () => {
      if (disposed || document.visibilityState === 'hidden') return
      controller = new AbortController()
      try {
        await taskRef.current(controller.signal)
      } catch (error) {
        if (!controller.signal.aborted) errorHandlerRef.current?.(error)
      } finally {
        controller = undefined
        schedule(intervalMs)
      }
    }

    const handleVisibilityChange = () => {
      clearTimer()
      controller?.abort()
      if (document.visibilityState !== 'hidden') schedule(0)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    schedule(immediate ? 0 : intervalMs)

    return () => {
      disposed = true
      clearTimer()
      controller?.abort()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enabled, immediate, intervalMs])
}

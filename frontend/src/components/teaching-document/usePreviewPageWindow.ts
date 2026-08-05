import { useCallback, useEffect, useMemo, useRef, useState, type RefCallback } from 'react'

export const PREVIEW_WINDOW_THRESHOLD = 8
export const PREVIEW_WINDOW_BUFFER = 2

interface UsePreviewPageWindowOptions {
  unitCount: number
  active: boolean
  targetUnitIndexes?: Array<number | null | undefined>
  threshold?: number
  buffer?: number
}

function boundedIndex(index: number | null | undefined, unitCount: number) {
  if (index == null || !Number.isFinite(index) || unitCount <= 0) return null
  return Math.min(unitCount - 1, Math.max(0, Math.trunc(index)))
}

function addBufferedIndexes(target: Set<number>, index: number, unitCount: number, buffer: number) {
  const start = Math.max(0, index - buffer)
  const end = Math.min(unitCount - 1, index + buffer)
  for (let next = start; next <= end; next += 1) target.add(next)
}

/**
 * Keeps preview scroll geometry complete while limiting expensive paper content
 * to visible/targeted pages. The observed unit is a page for A4 and a whole
 * physical sheet for A3 spreads.
 */
export function usePreviewPageWindow({
  unitCount,
  active,
  targetUnitIndexes = [],
  threshold = PREVIEW_WINDOW_THRESHOLD,
  buffer = PREVIEW_WINDOW_BUFFER,
}: UsePreviewPageWindowOptions) {
  const [visibleIndexes, setVisibleIndexes] = useState<Set<number>>(() => new Set([0]))
  const nodesRef = useRef(new Map<number, HTMLElement>())
  const observerRef = useRef<IntersectionObserver | null>(null)
  const callbacksRef = useRef(new Map<number, RefCallback<HTMLElement>>())
  const windowed = unitCount > threshold

  useEffect(() => {
    setVisibleIndexes((current) => {
      const next = new Set([...current].filter((index) => index >= 0 && index < unitCount))
      if (unitCount > 0 && next.size === 0) next.add(0)
      return next
    })
  }, [unitCount])

  useEffect(() => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!active || !windowed || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver((entries) => {
      setVisibleIndexes((current) => {
        const next = new Set(current)
        for (const entry of entries) {
          const rawIndex = (entry.target as HTMLElement).dataset.teachingPreviewUnitIndex
          const index = Number(rawIndex)
          if (!Number.isInteger(index)) continue
          if (entry.isIntersecting) next.add(index)
          else next.delete(index)
        }
        return next.size === current.size && [...next].every((index) => current.has(index))
          ? current
          : next
      })
    }, { rootMargin: '100% 0px' })
    observerRef.current = observer
    nodesRef.current.forEach((node) => observer.observe(node))
    return () => {
      observer.disconnect()
      if (observerRef.current === observer) observerRef.current = null
    }
  }, [active, windowed])

  const refForUnit = useCallback((index: number): RefCallback<HTMLElement> => {
    const existing = callbacksRef.current.get(index)
    if (existing) return existing
    const callback: RefCallback<HTMLElement> = (node) => {
      const previous = nodesRef.current.get(index)
      if (previous && previous !== node) observerRef.current?.unobserve(previous)
      if (!node) {
        nodesRef.current.delete(index)
        return
      }
      nodesRef.current.set(index, node)
      observerRef.current?.observe(node)
    }
    callbacksRef.current.set(index, callback)
    return callback
  }, [])

  const mountedUnitIndexes = useMemo(() => {
    if (!windowed) return new Set(Array.from({ length: unitCount }, (_, index) => index))
    const next = new Set<number>()
    const visible = visibleIndexes.size ? visibleIndexes : new Set([0])
    visible.forEach((index) => addBufferedIndexes(next, index, unitCount, buffer))
    targetUnitIndexes.forEach((index) => {
      const bounded = boundedIndex(index, unitCount)
      if (bounded != null) addBufferedIndexes(next, bounded, unitCount, buffer)
    })
    return next
  }, [buffer, targetUnitIndexes, unitCount, visibleIndexes, windowed])

  return {
    windowed,
    mountedUnitIndexes,
    refForUnit,
  }
}

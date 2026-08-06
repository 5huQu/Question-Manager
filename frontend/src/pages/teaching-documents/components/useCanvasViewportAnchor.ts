import { useCallback, useEffect, useRef } from 'react'

const VIEWPORT_INSET_PX = 16
const MIN_TRACKING_MS = 360
const MAX_TRACKING_MS = 1200
const STABLE_FRAME_COUNT = 6

export interface CanvasViewportAnchor {
  element: HTMLElement
  elementRatioY: number
  viewportY: number
}

function visibleBlockElement(scrollRoot: HTMLElement, blockId: string): HTMLElement | null {
  return Array.from(scrollRoot.querySelectorAll<HTMLElement>('[data-block-id]'))
    .find((element) => element.dataset.blockId === blockId
      && !element.closest('[data-teaching-measure-root]')
      && element.getBoundingClientRect().height > 0) ?? null
}

/**
 * 记录当前真正可见的选中对象锚点。大对象使用“可见部分中心”，避免强行把
 * 对象自身中心拉入视口，保持用户正在看的题干、图片或解析位置。
 */
export function captureCanvasViewportAnchor(
  scrollRoot: HTMLElement,
  blockId: string,
): CanvasViewportAnchor | null {
  const element = visibleBlockElement(scrollRoot, blockId)
  if (!element) return null

  const viewport = scrollRoot.getBoundingClientRect()
  const rect = element.getBoundingClientRect()
  const inset = Math.min(VIEWPORT_INSET_PX, viewport.height / 2)
  const visibleTop = Math.max(rect.top, viewport.top + inset)
  const visibleBottom = Math.min(rect.bottom, viewport.bottom - inset)
  if (visibleBottom <= visibleTop || rect.height <= 0) return null

  const viewportY = (visibleTop + visibleBottom) / 2
  return {
    element,
    elementRatioY: (viewportY - rect.top) / rect.height,
    viewportY,
  }
}

/** 用实际 DOM 几何补偿滚动，而非推算 zoom，兼容连续流与分页编辑。 */
export function restoreCanvasViewportAnchor(
  scrollRoot: HTMLElement,
  anchor: CanvasViewportAnchor,
): boolean {
  if (!anchor.element.isConnected || !scrollRoot.contains(anchor.element)) return false
  const rect = anchor.element.getBoundingClientRect()
  if (rect.height <= 0) return false
  const currentY = rect.top + rect.height * anchor.elementRatioY
  const deltaY = currentY - anchor.viewportY
  if (Math.abs(deltaY) >= 0.5) scrollRoot.scrollTop += deltaY
  return true
}

/**
 * 属性栏改变画布宽度时，短时追踪选中对象并保持其屏幕位置。
 * 用户一旦主动操作画布便立即取消，避免与手动滚动争夺控制。
 */
export function useCanvasViewportAnchor(scrollRoot: HTMLElement | null) {
  const anchorRef = useRef<CanvasViewportAnchor | null>(null)
  const frameRef = useRef<number | null>(null)

  const cancelTracking = useCallback(() => {
    anchorRef.current = null
    if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }, [])

  const captureViewportAnchor = useCallback((blockId: string) => {
    if (!scrollRoot || !blockId) return
    const anchor = captureCanvasViewportAnchor(scrollRoot, blockId)
    if (!anchor) return

    cancelTracking()
    anchorRef.current = anchor
    const startedAt = window.performance.now()
    let previousWidth = scrollRoot.clientWidth
    let previousHeight = anchor.element.getBoundingClientRect().height
    let stableFrames = 0

    const track = (now: number) => {
      const current = anchorRef.current
      if (!current || !restoreCanvasViewportAnchor(scrollRoot, current)) {
        cancelTracking()
        return
      }

      const width = scrollRoot.clientWidth
      const height = current.element.getBoundingClientRect().height
      if (Math.abs(width - previousWidth) < 0.25 && Math.abs(height - previousHeight) < 0.25) stableFrames += 1
      else stableFrames = 0
      previousWidth = width
      previousHeight = height

      const elapsed = now - startedAt
      if (elapsed >= MAX_TRACKING_MS || (elapsed >= MIN_TRACKING_MS && stableFrames >= STABLE_FRAME_COUNT)) {
        cancelTracking()
        return
      }
      frameRef.current = window.requestAnimationFrame(track)
    }

    frameRef.current = window.requestAnimationFrame(track)
  }, [cancelTracking, scrollRoot])

  useEffect(() => {
    if (!scrollRoot) return
    const cancelForUserInput = () => cancelTracking()
    scrollRoot.addEventListener('wheel', cancelForUserInput, { passive: true })
    scrollRoot.addEventListener('touchstart', cancelForUserInput, { passive: true })
    scrollRoot.addEventListener('pointerdown', cancelForUserInput, { passive: true })
    return () => {
      scrollRoot.removeEventListener('wheel', cancelForUserInput)
      scrollRoot.removeEventListener('touchstart', cancelForUserInput)
      scrollRoot.removeEventListener('pointerdown', cancelForUserInput)
      cancelTracking()
    }
  }, [cancelTracking, scrollRoot])

  return { captureViewportAnchor, cancelTracking }
}

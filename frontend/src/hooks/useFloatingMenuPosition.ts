import { useLayoutEffect, useState, type RefObject } from 'react'

export type FloatingMenuPosition = {
  top: number
  left: number
  width: number
}

type Options = {
  /** Use a fixed menu width when the floating content is wider than its trigger. */
  width?: number | 'anchor'
  /** Recalculate after the content size changes, for example after filtering. */
  contentKey?: string | number
}

export function useFloatingMenuPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  options: Options = {},
) {
  const [position, setPosition] = useState<FloatingMenuPosition | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }

    function updatePosition() {
      const trigger = triggerRef.current
      if (!trigger) return
      const triggerRect = trigger.getBoundingClientRect()
      const menuRect = menuRef.current?.getBoundingClientRect()
      const menuHeight = menuRect?.height || 320
      const width = options.width === 'anchor' || options.width === undefined
        ? triggerRect.width
        : options.width
      const viewportPadding = 8
      const gap = 4
      const spaceBelow = window.innerHeight - triggerRect.bottom - gap - viewportPadding
      const spaceAbove = triggerRect.top - gap - viewportPadding
      const openAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow
      const rawTop = openAbove
        ? triggerRect.top - menuHeight - gap
        : triggerRect.bottom + gap
      const maxTop = Math.max(viewportPadding, window.innerHeight - menuHeight - viewportPadding)
      const top = Math.min(Math.max(viewportPadding, rawTop), maxTop)
      const left = Math.min(
        Math.max(viewportPadding, triggerRect.left),
        Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
      )

      setPosition((current) => current && current.top === top && current.left === left && current.width === width
        ? current
        : { top, left, width })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [menuRef, options.contentKey, options.width, open, triggerRef])

  return position
}

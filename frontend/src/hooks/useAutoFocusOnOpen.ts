import { useEffect, type RefObject } from 'react'

/** Focus an input after an open panel has been mounted, including portal panels. */
export function useAutoFocusOnOpen(open: boolean, inputRef: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    if (!open) return

    const focusInput = () => {
      const input = inputRef.current
      if (!input) return

      input.focus()
      const cursorPosition = input.value.length
      input.setSelectionRange(cursorPosition, cursorPosition)
    }

    // The panel is rendered through a portal. Waiting one frame ensures that
    // the input is mounted before focus is moved, including after reopening.
    if (typeof window.requestAnimationFrame === 'function') {
      const frame = window.requestAnimationFrame(focusInput)
      return () => window.cancelAnimationFrame(frame)
    }

    const timeout = window.setTimeout(focusInput, 0)
    return () => window.clearTimeout(timeout)
  }, [inputRef, open])
}

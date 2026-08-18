import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SlidersHorizontal } from 'lucide-react'
import { InspectorSlider } from '@/components/ui/InspectorSlider'

export function AnswerSpaceSettingsPopover(props: {
  heightMm: number
  splitAcrossPages: boolean
  onHeightChange: (heightMm: number) => void
  onSplitAcrossPagesChange: (splitAcrossPages: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 8, bottom: 8 })

  useLayoutEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      const panelWidth = 288
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth - 8)),
        bottom: Math.max(8, window.innerHeight - rect.top + 8),
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="设置解答题留空属性"
        aria-expanded={open}
        aria-controls="answer-space-settings-popover"
        title="设置解答题留空属性"
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors ${
          open
            ? 'bg-zinc-200/80 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
            : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-100'
        }`}
      >
        <SlidersHorizontal className="size-3.5" />
      </button>
      {open ? createPortal(
        <div
          ref={panelRef}
          id="answer-space-settings-popover"
          role="dialog"
          aria-label="解答题留空属性"
          data-answer-space-settings-popover
          style={position}
          className="fixed z-[80] w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="mb-3 border-b border-zinc-100 pb-2 dark:border-zinc-900">
            <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">解答题留空属性</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">同步应用到当前文档中的全部解答题。</p>
          </div>
          <div className="space-y-3">
            <InspectorSlider
              label="解答题留空高度"
              value={props.heightMm}
              min={5}
              max={200}
              step={1}
              unit="mm"
              presets={[15, 40, 50, 80, 120]}
              onChange={props.onHeightChange}
            />
            <label className="flex cursor-pointer items-center gap-2 border-t border-zinc-100 pt-3 text-xs font-medium text-zinc-700 dark:border-zinc-900 dark:text-zinc-300">
              <input
                type="checkbox"
                className="size-3.5 rounded border-zinc-300 accent-zinc-900 dark:border-zinc-700 dark:accent-zinc-100"
                checked={props.splitAcrossPages}
                onChange={(event) => props.onSplitAcrossPagesChange(event.target.checked)}
              />
              不跨页
            </label>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}

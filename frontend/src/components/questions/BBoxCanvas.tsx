import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { clampNumber, cropHandles, normalizeDisplayRect, resizeDisplayRect } from '@/utils/crop'
import type { BBox } from '@/types'

export interface BBoxCanvasBox {
  id: string
  x: number // Percent (0 - 1)
  y: number // Percent (0 - 1)
  width: number // Percent (0 - 1)
  height: number // Percent (0 - 1)
  label: string
  boxClass: string
  labelClass: string
  title?: string
}

interface BBoxCanvasProps {
  imageUrl: string
  boxes: BBoxCanvasBox[]
  selectedBoxId?: string
  onSelectBoxId?: (id: string) => void
  rect: BBox // display coordinates
  onRectChange: (rect: BBox) => void
  splitMode?: boolean
  splitRatio?: number
  onSplitRatioChange?: (ratio: number) => void
  onDeleteSelectedBox?: () => void
  naturalSizeReady?: (size: { width: number; height: number }) => void
  imageRef?: React.RefObject<HTMLImageElement | null>
}

export function BBoxCanvas({
  imageUrl,
  boxes,
  selectedBoxId,
  onSelectBoxId,
  rect,
  onRectChange,
  splitMode = false,
  splitRatio = 0.5,
  onSplitRatioChange,
  onDeleteSelectedBox,
  naturalSizeReady,
  imageRef: parentImageRef,
}: BBoxCanvasProps) {
  const localImageRef = useRef<HTMLImageElement | null>(null)
  const imageRef = parentImageRef || localImageRef
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  const [interaction, setInteraction] = useState<{
    mode: 'draw' | 'move' | 'resize'
    start: { x: number; y: number }
    rect: BBox
    corner?: string
  } | null>(null)
  const [splitDragging, setSplitDragging] = useState(false)

  // Notify natural size change
  useEffect(() => {
    if (naturalSize.width > 0 && naturalSize.height > 0) {
      naturalSizeReady?.(naturalSize)
    }
  }, [naturalSize, naturalSizeReady])

  // Reset focus and states when imageUrl changes
  useEffect(() => {
    setInteraction(null)
    setSplitDragging(false)
  }, [imageUrl])

  // Get dynamic image layout size
  function imageSize() {
    const bounds = imageRef.current?.getBoundingClientRect()
    return bounds ? { width: bounds.width, height: bounds.height } : { width: 0, height: 0 }
  }

  // Map pointer coordinates relative to the image
  function getRelativePoint(event: PointerEvent<HTMLElement>) {
    const bounds = imageRef.current?.getBoundingClientRect()
    if (!bounds) return { x: 0, y: 0 }
    return {
      x: clampNumber(event.clientX - bounds.left, 0, bounds.width),
      y: clampNumber(event.clientY - bounds.top, 0, bounds.height),
    }
  }

  // Keyboard navigation & Delete listeners
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (splitMode) return
      // Ignore key events when typing inside inputs/selectors
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') {
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedBoxId) {
          e.preventDefault()
          onDeleteSelectedBox?.()
        }
      }

      // Move BBox with Arrow Keys (fine-tuning)
      const size = imageSize()
      if (size.width > 0 && rect.width > 3) {
        let dx = 0
        let dy = 0
        const step = e.shiftKey ? 5 : 1 // Shift key for larger adjustments
        if (e.key === 'ArrowLeft') dx = -step
        if (e.key === 'ArrowRight') dx = step
        if (e.key === 'ArrowUp') dy = -step
        if (e.key === 'ArrowDown') dy = step

        if (dx !== 0 || dy !== 0) {
          e.preventDefault()
          onRectChange(normalizeDisplayRect({
            ...rect,
            x: clampNumber(rect.x + dx, 0, Math.max(0, size.width - rect.width)),
            y: clampNumber(rect.y + dy, 0, Math.max(0, size.height - rect.height)),
          }, size))
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown as any)
    return () => window.removeEventListener('keydown', handleKeyDown as any)
  }, [selectedBoxId, rect, splitMode, onDeleteSelectedBox, onRectChange])

  // Mouse drag-draw events
  function handleStartDraw(event: PointerEvent<HTMLDivElement>) {
    if (splitMode) return
    if (!imageRef.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    onSelectBoxId?.('')
    const p = getRelativePoint(event)
    setInteraction({
      mode: 'draw',
      start: p,
      rect: { x: p.x, y: p.y, width: 0, height: 0 },
    })
    onRectChange({ x: p.x, y: p.y, width: 0, height: 0 })
  }

  function handleMouseMove(event: PointerEvent<HTMLDivElement>) {
    if (splitMode && splitDragging) {
      event.preventDefault()
      const size = imageSize()
      if (size.height > 0 && onSplitRatioChange) {
        onSplitRatioChange(clampNumber(getRelativePoint(event).y / size.height, 0.01, 0.99))
      }
      return
    }

    if (!interaction) return
    event.preventDefault()
    const p = getRelativePoint(event)
    const size = imageSize()

    if (interaction.mode === 'draw') {
      const nextRect = normalizeDisplayRect({
        x: Math.min(interaction.start.x, p.x),
        y: Math.min(interaction.start.y, p.y),
        width: Math.abs(p.x - interaction.start.x),
        height: Math.abs(p.y - interaction.start.y),
      }, size)
      onRectChange(nextRect)
      return
    }

    if (interaction.mode === 'move') {
      const dx = p.x - interaction.start.x
      const dy = p.y - interaction.start.y
      const nextRect = {
        ...interaction.rect,
        x: clampNumber(interaction.rect.x + dx, 0, Math.max(0, size.width - interaction.rect.width)),
        y: clampNumber(interaction.rect.y + dy, 0, Math.max(0, size.height - interaction.rect.height)),
      }
      onRectChange(nextRect)
      return
    }

    if (interaction.mode === 'resize' && interaction.corner) {
      const nextRect = resizeDisplayRect(interaction.rect, interaction.corner as any, p, size)
      onRectChange(nextRect)
    }
  }

  function handlePointerUp() {
    setInteraction(null)
    setSplitDragging(false)
  }

  // Handle box selection directly from canvas click
  function handleBoxSelect(boxId: string, event: PointerEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    onSelectBoxId?.(boxId)
  }

  function handleStartMove(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setInteraction({
      mode: 'move',
      start: getRelativePoint(event),
      rect,
    })
  }

  function handleStartResize(corner: string, event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setInteraction({
      mode: 'resize',
      corner,
      start: getRelativePoint(event),
      rect,
    })
  }

  function handleStartSplitDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!splitMode) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSplitDragging(true)
    const size = imageSize()
    if (size.height > 0 && onSplitRatioChange) {
      onSplitRatioChange(clampNumber(getRelativePoint(event).y / size.height, 0.01, 0.99))
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative select-none block w-full h-full"
    >
      <div
        className="relative block w-full cursor-crosshair select-none"
        onPointerDown={handleStartDraw}
        onPointerMove={handleMouseMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <img
          ref={imageRef}
          alt="切片原图"
          className="w-full max-w-none rounded-lg border bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          draggable={false}
          onLoad={(event) => {
            setNaturalSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }}
          src={imageUrl}
        />
        {/* Soft background shade over canvas */}
        <div className="pointer-events-none absolute inset-0 bg-zinc-950/10 rounded-lg animate-fade-in" />

        {/* Existing boxes */}
        {boxes.map((box) => {
          const isSelected = selectedBoxId && box.id === selectedBoxId
          return (
            <button
              key={box.id}
              className={`absolute rounded-sm border-2 text-left shadow-[0_0_0_1px_rgba(255,255,255,0.85)] transition-all cursor-pointer ${
                isSelected
                  ? 'border-amber-500 bg-amber-100/25 ring-2 ring-amber-500/25 z-10'
                  : box.boxClass
              }`}
              onPointerDown={(event) => handleBoxSelect(box.id, event)}
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
              }}
              title={box.title}
              type="button"
            >
              <span
                className={`absolute left-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm ${
                  isSelected ? 'bg-amber-500' : box.labelClass
                }`}
              >
                {box.label}
              </span>
            </button>
          )
        })}

        {/* Red active box currently being drawn or edited */}
        {rect.width > 3 && rect.height > 3 ? (
          <div
            className="absolute cursor-move rounded-sm border-2 border-red-500 bg-rose-50/60 shadow-[0_0_0_1px_rgba(255,255,255,0.85)] z-20"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
            }}
            onPointerDown={handleStartMove}
          >
            <div className="absolute -top-6 left-0 rounded bg-red-600 px-2 py-0.5 font-mono text-[9px] font-medium text-white shadow-sm">
              {selectedBoxId ? '编辑选区' : '选区'}
            </div>
            {cropHandles.map((handle) => (
              <button
                key={handle.corner}
                aria-label={handle.label}
                className={`absolute ${handle.position} size-4 rounded-full border-2 border-red-500 bg-white shadow-sm ${handle.cursor}`}
                onPointerDown={(event) => handleStartResize(handle.corner, event)}
                type="button"
              />
            ))}
          </div>
        ) : null}

        {/* Split line for Slice Review splitting */}
        {splitMode ? (
          <button
            aria-label="拖动细分题块位置"
            className="absolute left-0 z-30 h-8 w-full -translate-y-1/2 cursor-ns-resize"
            onPointerDown={handleStartSplitDrag}
            style={{ top: `${splitRatio * 100}%` }}
            type="button"
          >
            <span
              className="absolute left-0 top-1/2 block h-1 w-full -translate-y-1/2 shadow-[0_0_0_1px_rgba(255,255,255,0.9)]"
              style={{
                backgroundImage: 'repeating-linear-gradient(to right, #dc2626 0 16px, transparent 16px 26px)',
              }}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow">
              细分线
            </span>
          </button>
        ) : null}
      </div>
    </div>
  )
}

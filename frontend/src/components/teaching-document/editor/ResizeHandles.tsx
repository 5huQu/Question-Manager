/**
 * 图片 / 留白拖拽调整尺寸交互组件
 *
 * - ImageResizeOverlay：选中图片时的四角等比例拖拽手柄 + 尺寸浮层
 * - SpacerResizeHandle：留白底部拖拽手柄（1mm 吸附）
 * - useFigureResizeKeyboard / useSpacerResizeKeyboard：键盘无障碍替代
 *
 * 交互约束：
 * - 拖拽过程只做「临时视觉更新」（rAF 节流），不写编辑器历史
 * - pointerup 时调用 editor command 一次性提交，配合 mergeKey 合并 undo
 * - 全部 chrome 元素带 data-print-hide，打印时隐藏
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  KEYBOARD_SHIFT_STEP_MM,
  KEYBOARD_STEP_MM,
  MIN_FIGURE_WIDTH_MM,
  SPACER_SNAP_MM,
  clampFigureWidthMm,
  clampSpacerHeightMm,
  pxToMm,
  snapSpacerHeightMm,
} from './resizeLogic'

// ─── requestAnimationFrame 节流（jsdom 无 rAF 时降级为 setTimeout） ──────────

const raf = (cb: FrameRequestCallback): number =>
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(cb)
    : (setTimeout(() => cb(Date.now()), 16) as unknown as number)

const caf = (id: number) => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
  else clearTimeout(id as unknown as ReturnType<typeof setTimeout>)
}

function useRafPreview(onPreview: (mm: number) => void) {
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<number | null>(null)
  const onPreviewRef = useRef(onPreview)
  onPreviewRef.current = onPreview

  const schedule = useCallback((mm: number) => {
    pendingRef.current = mm
    if (rafRef.current == null) {
      rafRef.current = raf(() => {
        rafRef.current = null
        if (pendingRef.current != null) onPreviewRef.current(pendingRef.current)
      })
    }
  }, [])

  const flush = useCallback(() => {
    if (rafRef.current != null) {
      caf(rafRef.current)
      rafRef.current = null
    }
  }, [])

  useEffect(() => flush, [flush])
  return { schedule, flush }
}

// ─── 尺寸格式化 ──────────────────────────────────────────────────────────────

function formatFigureSize(widthMm: number, aspectRatio?: number): string {
  const w = Math.round(widthMm)
  if (aspectRatio && aspectRatio > 0) {
    return `${w}mm × ${Math.round(widthMm / aspectRatio)}mm`
  }
  return `${w}mm`
}

// ─── ImageResizeOverlay ──────────────────────────────────────────────────────

type CornerId = 'nw' | 'ne' | 'sw' | 'se'

/** 每个角手柄对应的水平拖拽方向符号：右侧手柄向右拖增大宽度，左侧手柄相反 */
const CORNERS: Array<{ id: CornerId; sign: 1 | -1; position: string; cursor: string }> = [
  { id: 'nw', sign: -1, position: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'cursor-nwse-resize' },
  { id: 'ne', sign: 1, position: 'right-0 top-0 translate-x-1/2 -translate-y-1/2', cursor: 'cursor-nesw-resize' },
  { id: 'sw', sign: -1, position: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2', cursor: 'cursor-nesw-resize' },
  { id: 'se', sign: 1, position: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2', cursor: 'cursor-nwse-resize' },
]

export interface ImageResizeOverlayProps {
  /** 当前显示宽度 mm（拖拽时应传入实时预览值） */
  currentWidthMm: number
  /** 下限 mm（默认 MIN_FIGURE_WIDTH_MM） */
  minWidthMm?: number
  /** 上限 mm（纸张内容区宽度） */
  maxWidthMm: number
  /** 宽高比 width/height，用于尺寸浮层显示高度 */
  aspectRatio?: number
  /** 拖拽中的实时预览回调（rAF 节流，不写历史） */
  onPreview: (widthMm: number) => void
  /** pointerup 提交回调（写历史） */
  onCommit: (widthMm: number) => void
}

export function ImageResizeOverlay({
  currentWidthMm,
  minWidthMm = MIN_FIGURE_WIDTH_MM,
  maxWidthMm,
  aspectRatio,
  onPreview,
  onCommit,
}: ImageResizeOverlayProps) {
  const [dragWidthMm, setDragWidthMm] = useState<number | null>(null)
  const dragRef = useRef<{ startX: number; startWidthMm: number; lastWidthMm: number; sign: 1 | -1 } | null>(null)
  const { schedule, flush } = useRafPreview(onPreview)

  const displayWidthMm = dragWidthMm ?? currentWidthMm

  const beginDrag = (sign: 1 | -1) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startWidthMm: currentWidthMm, lastWidthMm: currentWidthMm, sign }
    setDragWidthMm(currentWidthMm)
  }

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    const deltaMm = pxToMm(e.clientX - d.startX) * d.sign
    const next = clampFigureWidthMm(d.startWidthMm + deltaMm, maxWidthMm)
    d.lastWidthMm = next
    setDragWidthMm(next)
    schedule(next)
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    flush()
    dragRef.current = null
    setDragWidthMm(null)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer 已被释放 */
    }
    onCommit(d.lastWidthMm)
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10" data-print-hide="" data-resize-overlay="figure">
      {/* 选中框：贴合图片边界 */}
      <div className="absolute -inset-px rounded-md border border-sky-500/70" />
      {CORNERS.map((corner) => (
        <div
          key={corner.id}
          role="slider"
          aria-label="调整图片宽度"
          aria-valuemin={minWidthMm}
          aria-valuemax={Math.round(maxWidthMm)}
          aria-valuenow={Math.round(displayWidthMm)}
          className={`pointer-events-auto absolute size-3 rounded-[3px] border border-sky-600 bg-white shadow-sm dark:bg-zinc-100 ${corner.position} ${corner.cursor}`}
          onPointerDown={beginDrag(corner.sign)}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      ))}
      {/* 尺寸浮层 */}
      <div className="absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900/85 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white dark:bg-zinc-700/90">
        {formatFigureSize(displayWidthMm, aspectRatio)}
      </div>
    </div>
  )
}

// ─── SpacerResizeHandle ──────────────────────────────────────────────────────

export interface SpacerResizeHandleProps {
  /** 当前显示高度 mm（拖拽时应传入实时预览值） */
  currentHeightMm: number
  /** 吸附步进 mm（默认 1mm） */
  snapMm?: number
  /** 拖拽中的实时预览回调（rAF 节流，不写历史） */
  onPreview: (heightMm: number) => void
  /** pointerup 提交回调（写历史） */
  onCommit: (heightMm: number) => void
}

export function SpacerResizeHandle({
  currentHeightMm,
  snapMm = SPACER_SNAP_MM,
  onPreview,
  onCommit,
}: SpacerResizeHandleProps) {
  const [dragHeightMm, setDragHeightMm] = useState<number | null>(null)
  const dragRef = useRef<{ startY: number; startHeightMm: number; lastHeightMm: number } | null>(null)
  const { schedule, flush } = useRafPreview(onPreview)

  const displayHeightMm = dragHeightMm ?? currentHeightMm

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startY: e.clientY, startHeightMm: currentHeightMm, lastHeightMm: currentHeightMm }
    setDragHeightMm(currentHeightMm)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    const deltaMm = pxToMm(e.clientY - d.startY)
    const next = snapSpacerHeightMm(d.startHeightMm + deltaMm, snapMm)
    d.lastHeightMm = next
    setDragHeightMm(next)
    schedule(next)
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    flush()
    dragRef.current = null
    setDragHeightMm(null)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer 已被释放 */
    }
    onCommit(d.lastHeightMm)
  }

  return (
    <div data-print-hide="" data-resize-handle="spacer">
      {/* 底部拖拽手柄 */}
      <div
        role="slider"
        aria-label="调整留白高度"
        aria-valuemin={2}
        aria-valuemax={200}
        aria-valuenow={Math.round(displayHeightMm)}
        className="absolute inset-x-0 -bottom-1.5 z-10 flex h-3 cursor-ns-resize items-center justify-center"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="h-1 w-10 rounded-full bg-sky-500/80" />
      </div>
      {/* 高度浮层 */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-zinc-900/85 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white dark:bg-zinc-700/90">
        {Math.round(displayHeightMm)}mm
      </div>
    </div>
  )
}

// ─── 键盘调整（无障碍替代） ──────────────────────────────────────────────────

const FIGURE_ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
const SPACER_ARROWS = ['ArrowUp', 'ArrowDown']

interface FigureKeyboardOptions {
  editor: Editor | null
  blockId: string
  selected: boolean
  currentWidthMm: number
  contentWidthMm: number
  mergeKey: string
}

/**
 * 图片选中时的键盘调整：方向键 ±1mm，Shift+方向键 ±5mm。
 * Right/Up 增大、Left/Down 减小；在内容区宽度内钳制。
 */
export function useFigureResizeKeyboard({
  editor,
  blockId,
  selected,
  currentWidthMm,
  contentWidthMm,
  mergeKey,
}: FigureKeyboardOptions) {
  useEffect(() => {
    if (!editor || !selected) return
    const onKey = (e: KeyboardEvent) => {
      // 仅拦截来自编辑器内部的按键，避免劫持属性面板等输入框
      if (!editor.view.dom.contains(e.target as globalThis.Node)) return
      if (!FIGURE_ARROWS.includes(e.key)) return
      e.preventDefault()
      e.stopPropagation()
      const step = e.shiftKey ? KEYBOARD_SHIFT_STEP_MM : KEYBOARD_STEP_MM
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1
      const next = clampFigureWidthMm(currentWidthMm + dir * step, contentWidthMm)
      editor.commands.setFigureWidth(blockId, next, mergeKey)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [editor, selected, blockId, currentWidthMm, contentWidthMm, mergeKey])
}

interface SpacerKeyboardOptions {
  editor: Editor | null
  blockId: string
  selected: boolean
  currentHeightMm: number
  mergeKey: string
}

/**
 * 留白选中时的键盘调整：↑ 减小、↓ 增大，步进 1mm（Shift 5mm），1mm 吸附。
 */
export function useSpacerResizeKeyboard({
  editor,
  blockId,
  selected,
  currentHeightMm,
  mergeKey,
}: SpacerKeyboardOptions) {
  useEffect(() => {
    if (!editor || !selected) return
    const onKey = (e: KeyboardEvent) => {
      if (!editor.view.dom.contains(e.target as globalThis.Node)) return
      if (!SPACER_ARROWS.includes(e.key)) return
      e.preventDefault()
      e.stopPropagation()
      const step = e.shiftKey ? KEYBOARD_SHIFT_STEP_MM : KEYBOARD_STEP_MM
      const dir = e.key === 'ArrowDown' ? 1 : -1
      const next = snapSpacerHeightMm(clampSpacerHeightMm(currentHeightMm + dir * step))
      editor.commands.setSpacerHeight(blockId, next, mergeKey)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [editor, selected, blockId, currentHeightMm, mergeKey])
}

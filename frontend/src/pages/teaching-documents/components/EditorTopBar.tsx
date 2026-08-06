/**
 * 编辑器顶栏
 * 左：返回 + 文档类型；中：标题输入；右：状态 / 撤销重做 / 视图切换 / 插入
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import {
  ArrowLeft, Check, ChevronDown, CornerDownRight, FileText, LayoutTemplate,
  LoaderCircle, Minus, Plus, Redo2, Undo2, AlignLeft,
} from 'lucide-react'
import type { TeachingBlock } from '@/types/teachingDocument'
import type { AutosaveState } from '@/utils/teachingDocument'
import { springQuick } from '@/components/teaching-document/motion'
import { InsertMenuPanel, type HeadingLevel } from './BlockInsertMenu'

const SAVE_INDICATOR: Record<AutosaveState, { label: string; dot: string; text: string }> = {
  saved: { label: '已保存', dot: 'bg-emerald-500', text: 'text-zinc-500' },
  dirty: { label: '未保存', dot: 'bg-amber-500', text: 'text-zinc-500' },
  saving: { label: '正在保存…', dot: 'bg-zinc-400 animate-pulse', text: 'text-zinc-400' },
  failed: { label: '保存失败', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  conflict: { label: '版本冲突', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
}

/** 画布视图模式：分页编辑（主）、连续流（备用）、打印预览（只读）。 */
export type TeachingCanvasMode = 'paginated' | 'continuous' | 'a4'

export function EditorTopBar(props: {
  documentTitle: string
  saveState: AutosaveState
  canUndo: boolean
  canRedo: boolean
  canvasMode: TeachingCanvasMode
  zoom: number
  onBack: () => void
  onTitleChange: (title: string) => void
  onUndo: () => void
  onRedo: () => void
  onCanvasModeChange: (mode: TeachingCanvasMode) => void
  onZoomChange: (zoom: number) => void
  onInsert: (type: TeachingBlock['type'], headingLevel?: HeadingLevel) => void
  paperActions?: ReactNode
  printActions?: ReactNode
}) {
  const [insertOpen, setInsertOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const insertRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const indicator = SAVE_INDICATOR[props.saveState]

  // 以"插入"按钮的视口坐标为锚点，供 portal 菜单 fixed 定位（右对齐：x '-100%'）
  const reposition = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setMenuPos({ top: rect.bottom + 6, left: rect.right })
  }, [])

  function toggleInsert() {
    if (!insertOpen) reposition()
    setInsertOpen((value) => !value)
  }

  useEffect(() => {
    if (!insertOpen) return
    function handleClick(event: MouseEvent) {
      const target = event.target as Node
      if (insertRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setInsertOpen(false)
    }
    // 菜单 portal 到 body：header 的 backdrop-blur 会创建层叠上下文，
    // 内部 absolute 下拉会被根层级 fixed z-40 的试题篮按钮遮挡
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [insertOpen, reposition])

  return (
    <header className="question-edit-glass-inner-header flex h-12 shrink-0 items-center gap-2 border-b border-black/6 dark:border-white/8 px-3 backdrop-blur-md">
      <button
        type="button"
        onClick={props.onBack}
        className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-zinc-100"
        title="返回文档列表"
      >
        <ArrowLeft className="size-4" />
      </button>
      <input
        value={props.documentTitle}
        onChange={(event) => props.onTitleChange(event.target.value)}
        className="h-8 min-w-32 flex-1 rounded-md border border-transparent bg-transparent px-2 text-[15px] font-semibold tracking-tight text-zinc-900 outline-none transition-colors hover:border-black/10 focus:border-black/20 dark:text-zinc-100 dark:hover:border-white/15 dark:focus:border-white/25"
        aria-label="文档标题"
        placeholder="未命名文档"
      />

      <div
        className="question-edit-glass-tabs hidden h-7.5 shrink-0 items-center gap-1 rounded-lg px-1.5 lg:flex border border-black/6 dark:border-white/8"
        aria-label="视图缩放"
      >
        <button
          type="button"
          onClick={() => props.onZoomChange(Math.max(0.5, Math.round((props.zoom - 0.05) * 100) / 100))}
          className="flex size-5 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-900 active:scale-95 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100"
          aria-label="缩小视图"
          title="缩小视图"
        >
          <Minus className="size-3" />
        </button>
        <input
          className="apple-slider h-1 w-16 cursor-pointer"
          type="range"
          min={50}
          max={150}
          step={5}
          value={Math.round(props.zoom * 100)}
          onChange={(event) => props.onZoomChange(Number(event.target.value) / 100)}
          aria-label="视图缩放比例"
        />
        <button
          type="button"
          onClick={() => props.onZoomChange(Math.min(1.5, Math.round((props.zoom + 0.05) * 100) / 100))}
          className="flex size-5 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-900 active:scale-95 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100"
          aria-label="放大视图"
          title="放大视图"
        >
          <Plus className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => {
            const nextZooms = [1, 1.25, 1.5, 0.75, 1]
            const currentIdx = nextZooms.findIndex((z) => Math.abs(z - props.zoom) < 0.05)
            props.onZoomChange(nextZooms[(currentIdx + 1) % nextZooms.length])
          }}
          className="rounded px-1.5 py-0.5 text-center text-[11px] font-medium tabular-nums text-zinc-600 transition-colors hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/10"
          title="切换常见比例 (100% / 125% / 150% / 75%)"
        >
          {Math.round(props.zoom * 100)}%
        </button>
      </div>

      <span className={`hidden items-center gap-1.5 text-[11px] font-normal tracking-wide sm:inline-flex ${indicator.text}`}>
        <span className={`size-1.5 rounded-full ${indicator.dot}`} />
        {indicator.label}
      </span>

      <span className="mx-1 hidden h-5 w-px bg-black/6 dark:bg-white/8 sm:block" />

      <button
        type="button"
        disabled={!props.canUndo}
        onClick={props.onUndo}
        className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10"
        title="撤销"
      >
        <Undo2 className="size-4" />
      </button>
      <button
        type="button"
        disabled={!props.canRedo}
        onClick={props.onRedo}
        className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10"
        title="重做"
      >
        <Redo2 className="size-4" />
      </button>

      <span className="mx-1 h-5 w-px bg-black/6 dark:bg-white/8" />

      <div role="tablist" aria-label="视图模式" className="question-edit-glass-tabs inline-flex items-center gap-0.5 rounded-lg p-0.5">
        {([
          { mode: 'paginated' as const, label: '页面编辑', Icon: FileText },
          { mode: 'continuous' as const, label: '连续流', Icon: AlignLeft },
          { mode: 'a4' as const, label: '打印预览', Icon: LayoutTemplate },
        ]).map(({ mode, label, Icon }) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={props.canvasMode === mode}
            onClick={() => props.onCanvasModeChange(mode)}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[11px] font-medium tracking-wide transition-all"
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      {props.paperActions ? (
        <>
          <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
          {props.paperActions}
        </>
      ) : null}

      {props.printActions ? (
        <>
          <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
          {props.printActions}
        </>
      ) : null}

      <button
        type="button"
        onClick={() => props.onInsert('pageBreak')}
        aria-label="在当前位置后换页"
        title="在当前位置后换页（⌘/Ctrl + Enter）"
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 active:scale-[0.97] dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      >
        <CornerDownRight className="size-3.5" />
        <span className="hidden xl:inline">换页</span>
      </button>

      <div ref={insertRef} className="relative">
        <button
          ref={buttonRef}
          type="button"
          onClick={toggleInsert}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-zinc-900 px-3 text-xs font-medium text-zinc-50 transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          <Plus className="size-3.5" />
          插入
          <ChevronDown className="size-3 opacity-60" />
        </button>
        {/* Portal 到 body：脱离 header（backdrop-blur 层叠上下文），z-[70] 高于试题篮 z-40；
            复用块间菜单的双列图标面板；右对齐交给 motion 的 x:'-100%' */}
        {createPortal(
          <AnimatePresence>
            {insertOpen ? (
              <motion.div
                ref={menuRef}
                initial={reduced ? { opacity: 0, x: '-100%' } : { opacity: 0, x: '-100%', scale: 0.95, y: -4 }}
                animate={reduced ? { opacity: 1, x: '-100%' } : { opacity: 1, x: '-100%', scale: 1, y: 0 }}
                exit={reduced ? { opacity: 0, x: '-100%' } : { opacity: 0, x: '-100%', scale: 0.97, y: -2 }}
                transition={springQuick}
                style={{ top: menuPos.top, left: menuPos.left }}
                className="fixed z-[70]"
              >
                <InsertMenuPanel onPick={(type, headingLevel) => { props.onInsert(type, headingLevel); setInsertOpen(false) }} />
              </motion.div>
            ) : null}
          </AnimatePresence>,
          document.body,
        )}
      </div>

      {props.saveState === 'saving' ? <LoaderCircle className="size-3.5 animate-spin text-zinc-400" /> : props.saveState === 'saved' ? <Check className="hidden size-3.5 text-emerald-600 dark:text-emerald-400 sm:block" /> : null}
    </header>
  )
}

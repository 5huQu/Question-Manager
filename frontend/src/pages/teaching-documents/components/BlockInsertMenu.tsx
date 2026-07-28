/**
 * 块间插入菜单
 * hover 时在内容块之间显示 "+" 按钮，点击弹出类型选择面板
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import {
  Box, CornerDownRight, Heading, Image, Minus, Plus, FileQuestion,
  PilcrowLeft, TextCursorInput, FileCode2, ScissorsLineDashed,
} from 'lucide-react'
import type { TeachingBlock } from '@/types/teachingDocument'
import { springQuick } from '@/components/teaching-document/motion'
import { INSERTABLE_TYPES, USER_BLOCK_LABEL } from './blockLabels'

export const TYPE_ICONS: Partial<Record<TeachingBlock['type'], typeof Plus>> = {
  heading: Heading,
  paragraph: PilcrowLeft,
  blockMath: TextCursorInput,
  box: Box,
  question: FileQuestion,
  figure: Image,
  divider: Minus,
  spacer: ScissorsLineDashed,
  pageBreak: CornerDownRight,
  rawMarkdown: FileCode2,
}

/** 共享的插入类型选择面板（双列图标网格）：块间 "+" 与顶栏"插入"下拉复用 */
export function InsertMenuPanel(props: {
  onPick: (type: TeachingBlock['type']) => void
  types?: TeachingBlock['type'][]
}) {
  const insertableTypes = props.types || INSERTABLE_TYPES
  return (
    <div className="w-52 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
      <p className="px-2 py-1 text-[11px] font-normal tracking-wide text-zinc-400">插入内容</p>
      <div className="grid grid-cols-2 gap-0.5">
        {insertableTypes.map((type) => {
          const Icon = TYPE_ICONS[type] || Plus
          return (
            <button
              key={type}
              type="button"
              onClick={() => props.onPick(type)}
              title={type === 'pageBreak' ? '下一项内容从新页开始（⌘/Ctrl + Enter）' : undefined}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              <Icon className="size-3.5 shrink-0 text-zinc-400" />
              {USER_BLOCK_LABEL[type]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function BlockInsertPoint(props: {
  onInsert: (type: TeachingBlock['type']) => void
  types?: TeachingBlock['type'][]
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const anchorRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()

  // 以“+”按钮的视口坐标为锚点，供 portal 菜单 fixed 定位
  const reposition = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setMenuPos({ top: rect.bottom + 6, left: rect.left + rect.width / 2 })
  }, [])

  function toggleOpen() {
    if (!open) reposition()
    setOpen((value) => !value)
  }

  useEffect(() => {
    if (!open) return
    function handleClick(event: MouseEvent) {
      const target = event.target as Node
      if (anchorRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    // 画布滚动容器非 window，用 capture 阶段监听任意滚动；菜单跟随按钮不错位
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open, reposition])

  return (
    <div ref={anchorRef} className="group/insert relative flex h-2 items-center justify-center">
      {/* 悬停时显示的插入线 */}
      <span className="pointer-events-none absolute inset-x-8 top-1/2 h-px -translate-y-1/2 bg-zinc-200 opacity-0 transition-opacity group-hover/insert:opacity-100 dark:bg-zinc-800" />
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        className="relative z-10 flex size-5 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-400 opacity-0 shadow-sm transition-all hover:border-zinc-400 hover:text-zinc-700 group-hover/insert:opacity-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500 dark:hover:border-zinc-500 dark:hover:text-zinc-200"
        title="在此处插入内容"
      >
        <Plus className="size-3" />
      </button>

      {/* Portal 到 body：脱离画布层叠上下文，避免被试题篮 fixed z-40 按钮遮挡；
          水平居中交给 motion 的 x:'-50%'（与 scale/y 合成同一 transform） */}
      {createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div
              ref={menuRef}
              initial={reduced ? { opacity: 0, x: '-50%' } : { opacity: 0, x: '-50%', scale: 0.95, y: -4 }}
              animate={reduced ? { opacity: 1, x: '-50%' } : { opacity: 1, x: '-50%', scale: 1, y: 0 }}
              exit={reduced ? { opacity: 0, x: '-50%' } : { opacity: 0, x: '-50%', scale: 0.97, y: -2 }}
              transition={springQuick}
              style={{ top: menuPos.top, left: menuPos.left }}
              className="fixed z-[70]"
            >
              <InsertMenuPanel types={props.types} onPick={(type) => { props.onInsert(type); setOpen(false) }} />
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}

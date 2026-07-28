/**
 * 浮动块工具栏
 * 选中内容块时紧贴其上方出现，提供常用操作
 */

import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { ArrowDown, ArrowUp, Copy, Pencil, Settings2, Trash2 } from 'lucide-react'
import { springQuick } from '@/components/teaching-document/motion'

export function FloatingBlockToolbar(props: {
  visible: boolean
  isBoxChild: boolean
  onMove: (direction: -1 | 1) => void
  onDuplicate: () => void
  onDelete: () => void
  onOpenProperties: () => void
  onEditQuestion?: () => void
}) {
  const reduced = useReducedMotion()
  return (
    <AnimatePresence>
      {props.visible ? (
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 4 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 2 }}
          transition={springQuick}
          className="absolute -top-10 left-1/2 z-40 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-zinc-200 bg-white px-1 py-0.5 shadow-md dark:border-zinc-700 dark:bg-zinc-900"
          onClick={(event) => event.stopPropagation()}
        >
          <ToolButton label="上移" onClick={() => props.onMove(-1)}><ArrowUp className="size-3.5" /></ToolButton>
          <ToolButton label="下移" onClick={() => props.onMove(1)}><ArrowDown className="size-3.5" /></ToolButton>
          {!props.isBoxChild ? (
            <ToolButton label="复制" onClick={props.onDuplicate}><Copy className="size-3.5" /></ToolButton>
          ) : null}
          <ToolButton label="删除" danger onClick={props.onDelete}><Trash2 className="size-3.5" /></ToolButton>
          {props.onEditQuestion ? (
            <ToolButton label="编辑题目" onClick={props.onEditQuestion}><Pencil className="size-3.5" /></ToolButton>
          ) : null}
          <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
          <ToolButton label="属性" onClick={props.onOpenProperties}><Settings2 className="size-3.5" /></ToolButton>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function ToolButton({ children, label, danger, onClick }: {
  children: React.ReactNode
  label: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={`rounded-md p-1.5 transition-colors ${
        danger
          ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30'
          : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
      }`}
    >
      {children}
    </button>
  )
}

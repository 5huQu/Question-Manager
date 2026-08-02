/**
 * 块间插入菜单
 * hover 时在内容块之间显示 "+" 按钮，点击弹出类型选择面板
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import {
  Box, CornerDownRight, Heading, Image, Minus, Plus, FileQuestion,
  PilcrowLeft, TextCursorInput, FileCode2, ScissorsLineDashed, Spline,
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
  tikz: Spline,
  divider: Minus,
  spacer: ScissorsLineDashed,
  pageBreak: CornerDownRight,
  rawMarkdown: FileCode2,
}

export type HeadingLevel = 1 | 2 | 3 | 4

/**
 * 返回当前对象与下一对象之间的插入基线。
 *
 * 文本块的行盒在一些组合（如标题后紧接正文）会彼此贴合，甚至因为选择态
 * 的视觉边框出现轻微重叠。此时不能继续向下偏移，否则虚线会压到下一行文字；
 * 直接使用两块的结构分界线才是安全的插入位置。
 */
export function insertLineCenterY(currentBottom: number, nextTop?: number): number {
  if (nextTop == null) return currentBottom + 12
  return nextTop > currentBottom
    ? currentBottom + (nextTop - currentBottom) / 2
    : currentBottom
}

const HEADING_LEVELS: Array<{ level: HeadingLevel; label: string }> = [
  { level: 1, label: '一级' },
  { level: 2, label: '二级' },
  { level: 3, label: '三级' },
  { level: 4, label: '四级' },
]

/** 共享的插入类型选择面板（双列图标网格）：块间 "+" 与顶栏"插入"下拉复用 */
export function InsertMenuPanel(props: {
  onPick: (type: TeachingBlock['type'], headingLevel?: HeadingLevel) => void
  types?: TeachingBlock['type'][]
}) {
  const insertableTypes = props.types || INSERTABLE_TYPES
  const supportsHeading = insertableTypes.includes('heading')
  return (
    <div className="w-56 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
      <p className="px-2 py-1 text-[11px] font-normal tracking-wide text-zinc-400">插入内容</p>
      <div className="grid grid-cols-2 gap-0.5">
        {supportsHeading ? (
          <div className="col-span-2 rounded-lg bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900/60">
            <div className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
              <Heading className="size-3.5 shrink-0 text-zinc-400" />
              <span className="font-medium">插入章节</span>
              <span className="text-[10px] text-zinc-400">选择层级</span>
            </div>
            <div className="mt-1.5 grid grid-cols-4 gap-1" role="group" aria-label="章节层级">
              {HEADING_LEVELS.map(({ level, label }) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => props.onPick('heading', level)}
                  title={`插入${label}章节`}
                  className="rounded-md border border-zinc-200 bg-white px-1 py-1 text-[11px] text-zinc-600 transition-colors hover:border-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {insertableTypes.filter((type) => type !== 'heading').map((type) => {
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
  onInsert: (type: TeachingBlock['type'], headingLevel?: HeadingLevel) => void
  types?: TeachingBlock['type'][]
  /** 空文档使用大面积可点击的虚线插入区，复用同一选择菜单。 */
  empty?: boolean
  /** 空盒子使用更紧凑、语义明确的内部插入区。 */
  emptySize?: 'document' | 'box'
  emptyLabel?: string
  emptyDescription?: string
  /** 选中对象后，将插入点贴在该对象下方，而不是放在整份编辑器末尾。 */
  anchorBlockId?: string
  anchorRoot?: HTMLElement | null
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const anchorRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const [blockAnchor, setBlockAnchor] = useState<{ left: number; centerY: number; width: number } | null>(null)

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

  // 文档级编辑器只有一个 ProseMirror 根节点，不能把插入点直接插进每一个
  // 节点之间；因此将轻量的“虚线 +”锚到真实对象的下边缘。
  useLayoutEffect(() => {
    if (!props.anchorBlockId || !props.anchorRoot) {
      setBlockAnchor(null)
      return
    }
    const update = () => {
      const block = props.anchorRoot?.querySelector<HTMLElement>(
        `[data-block-id="${CSS.escape(props.anchorBlockId!)}"]`,
      )
      if (!block) {
        setBlockAnchor(null)
        return
      }
      const rect = block.getBoundingClientRect()
      // 将插入点放到当前块和下一块之间的视觉中点。卡片连续文本和文档正文
      // 都由同一个 ProseMirror 根承载，因此只查该根的直属块，避免命中嵌套对象。
      const flow = block.closest<HTMLElement>('.ProseMirror')
      const siblings = flow
        ? Array.from(flow.children).filter((element): element is HTMLElement => element instanceof HTMLElement && Boolean(element.dataset.blockId))
        : []
      const currentIndex = siblings.indexOf(block)
      const next = currentIndex >= 0 ? siblings[currentIndex + 1] : undefined
      const nextRect = next?.getBoundingClientRect()
      const centerY = insertLineCenterY(rect.bottom, nextRect?.top)
      setBlockAnchor({ left: rect.left, centerY, width: rect.width })
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(props.anchorRoot)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [props.anchorBlockId, props.anchorRoot])

  const menu = createPortal(
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
          <InsertMenuPanel types={props.types} onPick={(type, headingLevel) => { props.onInsert(type, headingLevel); setOpen(false) }} />
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )

  if (props.empty) {
    const compact = props.emptySize === 'box'
    return (
      <div ref={anchorRef} className="relative">
        <button
          ref={buttonRef}
          type="button"
          onClick={toggleOpen}
          className={`group/empty-insert flex w-full flex-col items-center justify-center border border-dashed border-zinc-300 bg-zinc-50/40 text-center text-zinc-500 transition-colors hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/10 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-900/30 dark:hover:text-zinc-200 ${compact ? 'min-h-28 rounded-md px-4 py-5' : 'min-h-72 rounded-xl px-6 py-12'}`}
          title="点击插入内容"
        >
          <span className={`flex items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-400 transition-colors group-hover/empty-insert:border-zinc-400 group-hover/empty-insert:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:group-hover/empty-insert:border-zinc-600 dark:group-hover/empty-insert:text-zinc-200 ${compact ? 'mb-2 size-8' : 'mb-3 size-9'}`}>
            <Plus className={compact ? 'size-3.5' : 'size-4'} />
          </span>
          <span className={`${compact ? 'text-[13px]' : 'text-sm'} font-medium`}>{props.emptyLabel || '点击插入第一块内容'}</span>
          <span className={`${compact ? 'mt-0.5 text-[11px]' : 'mt-1 text-xs'} text-zinc-400 dark:text-zinc-500`}>{props.emptyDescription || '可插入章节、正文、题目、公式、图片等内容'}</span>
        </button>
        {menu}
      </div>
    )
  }

  if (props.anchorBlockId) {
    if (!blockAnchor) return menu
    return (
      <>
        {createPortal(
          <div
            ref={anchorRef}
            className="group/anchored-insert fixed z-40 flex h-7 items-center justify-center"
            style={{ left: blockAnchor.left, top: blockAnchor.centerY - 14, width: blockAnchor.width }}
          >
            <span className="pointer-events-none absolute inset-x-2 top-1/2 border-t border-dashed border-zinc-300 transition-colors group-hover/anchored-insert:border-zinc-400 dark:border-zinc-700 dark:group-hover/anchored-insert:border-zinc-600" />
            <button
              ref={buttonRef}
              type="button"
              onClick={toggleOpen}
              className="relative z-10 flex size-6 items-center justify-center rounded-full border border-dashed border-zinc-300 bg-white text-zinc-500 shadow-sm transition-colors hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
              title="在此对象后插入内容"
            >
              <Plus className="size-3.5" />
            </button>
          </div>,
          document.body,
        )}
        {menu}
      </>
    )
  }

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

      {menu}
    </div>
  )
}

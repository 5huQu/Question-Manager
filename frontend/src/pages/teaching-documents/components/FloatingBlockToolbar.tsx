/**
 * 浮动块工具栏
 * 选中内容块时紧贴其上方出现，提供常用操作
 */

import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { ArrowDown, ArrowUp, Copy, Pencil, Settings2, Trash2 } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { springQuick } from '@/components/teaching-document/motion'
import { InlineFormattingControls } from '@/components/teaching-document/BlockInlineEditor/BlockInlineEditor'

export function FloatingBlockToolbar(props: {
  visible: boolean
  /** 工具栏锚定的实际选中块。 */
  anchorBlockId: string
  /** 限定查询范围，避免命中隐藏的分页测量树。 */
  anchorRoot: HTMLElement | null
  isBoxChild: boolean
  /** 标题/段落对象使用同一组行内格式能力；其他原子对象保留操作按钮。 */
  textEditor?: Editor | null
  showTextFormatting?: boolean
  onMove: (direction: -1 | 1) => void
  onDuplicate: () => void
  onDelete: () => void
  onOpenProperties: () => void
  onEditQuestion?: () => void
}) {
  const reduced = useReducedMotion()
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!props.visible || !props.anchorBlockId || !props.anchorRoot) {
      setPosition(null)
      return
    }

    const updatePosition = () => {
      const anchor = props.anchorRoot?.querySelector<HTMLElement>(
        `[data-block-id="${CSS.escape(props.anchorBlockId)}"]`,
      )
      if (!anchor) {
        setPosition(null)
        return
      }
      const rect = anchor.getBoundingClientRect()
      setPosition({ left: rect.left + rect.width / 2, top: rect.top - 8 })
    }

    updatePosition()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition)
    observer?.observe(props.anchorRoot)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [props.anchorBlockId, props.anchorRoot, props.visible])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {props.visible && position ? (
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 4 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 2 }}
          transition={springQuick}
          className="fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-lg border border-zinc-200 bg-white px-1 py-0.5 shadow-md dark:border-zinc-700 dark:bg-zinc-900"
          style={position}
          onClick={(event) => event.stopPropagation()}
        >
          {props.showTextFormatting && props.textEditor ? (
            <>
              <BlockStyleControl editor={props.textEditor} />
              <InlineFormattingControls
                editor={props.textEditor}
                inheritedFontLabel={selectedTextBlockFontLabel(props.textEditor)}
              />
              <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
            </>
          ) : null}
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
    </AnimatePresence>,
    document.body,
  )
}

/**
 * 工具栏编辑的是文字的“局部覆盖”。没有覆盖时应明确说明会继承文档级的
 * 正文/章节字体，避免与右侧“字体与题距”的全局设置混淆。
 */
function selectedTextBlockFontLabel(editor: Editor) {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name === 'docHeading') return '继承章节字体'
    if (node.type.name === 'docParagraph') return '继承正文字体'
  }
  return '继承文档字体'
}

/** 文本对象的块级样式：对应属性面板里的“章节层级”，不与行内字体混淆。 */
function BlockStyleControl({ editor }: { editor: Editor }) {
  const { $from } = editor.state.selection
  let textBlock: typeof $from.parent | null = null
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name === 'docHeading' || node.type.name === 'docParagraph') {
      textBlock = node
      break
    }
  }
  if (!textBlock) return null
  const value = textBlock.type.name === 'docHeading'
    ? `heading-${Math.min(4, Math.max(1, Number(textBlock.attrs.level) || 3))}`
    : 'paragraph'

  return (
    <select
      aria-label="段落层级"
      title="段落层级"
      value={value}
      onChange={(event) => {
        const next = event.target.value
        const blockId = String(textBlock?.attrs.blockId || '')
        const chain = editor.chain().focus()
        if (next === 'paragraph') chain.setNode('docParagraph', { blockId }).run()
        else chain.setNode('docHeading', { blockId, level: Number(next.replace('heading-', '')) }).run()
      }}
      className="h-7 max-w-20 cursor-pointer rounded bg-transparent px-1 text-[11px] text-zinc-600 outline-none hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-400 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      <option value="paragraph">正文</option>
      <option value="heading-1">一级章节</option>
      <option value="heading-2">二级章节</option>
      <option value="heading-3">三级章节</option>
      <option value="heading-4">四级章节</option>
    </select>
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

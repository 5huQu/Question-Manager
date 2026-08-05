/**
 * 大纲面板
 * 左侧 overlay，translucent material，显示内容摘要列表与待处理问题
 */

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle, Box, FileCode2, Heading, Image, Minus,
  ChevronDown, ChevronRight, FileQuestion, PanelLeft, PilcrowLeft, ScissorsLineDashed, TextCursorInput, X, ArrowDown, ArrowUp,
} from 'lucide-react'
import type { DocumentValidationIssue, TeachingBlock, TeachingDocumentOutlineOptions, TeachingDocumentV1, TeachingInline } from '@/types/teachingDocument'
import { buildDocumentOutline } from '@/utils/teachingDocument'
import { springPanel } from '@/components/teaching-document/motion'
import { USER_BLOCK_LABEL } from './blockLabels'

const BLOCK_ICONS: Partial<Record<TeachingBlock['type'], typeof Heading>> = {
  heading: Heading,
  paragraph: PilcrowLeft,
  blockMath: TextCursorInput,
  box: Box,
  question: FileQuestion,
  figure: Image,
  divider: Minus,
  spacer: ScissorsLineDashed,
  pageBreak: ScissorsLineDashed,
  rawMarkdown: FileCode2,
}

/** 提取块的用户可读摘要 */
function blockSummary(block: TeachingBlock): string {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return inlineText(block.content).slice(0, 24) || '（空）'
    case 'blockMath':
      return block.latex.slice(0, 18) || '（空公式）'
    case 'box':
      return block.title || '知识卡片'
    case 'question':
      return block.display?.displayNumber ? `第 ${block.display.displayNumber} 题` : '题目'
    case 'figure':
      return block.groupItems?.length
        ? `图片组 · ${block.groupItems.length} 张`
        : block.caption || block.alt || '图片'
    case 'rawMarkdown':
      return block.markdown.slice(0, 18) || '（空）'
    case 'spacer':
      return '留白'
    case 'divider':
      return '分隔线'
    case 'pageBreak':
      return '手动换页'
    default:
      return USER_BLOCK_LABEL[block.type] || '内容'
  }
}

function inlineText(inlines: TeachingInline[]): string {
  return inlines
    .map((inline) => (inline.type === 'text' ? inline.text : inline.type === 'inlineMath' ? `$${inline.latex}$` : ''))
    .join('')
    .trim()
}

type DocumentTreeItem = { block: TeachingBlock; children: DocumentTreeItem[] }

/** 将章节与其间的普通块合并为同一棵可导航文档树。 */
function documentTree(content: TeachingBlock[]): DocumentTreeItem[] {
  const roots: DocumentTreeItem[] = []
  const stack: Array<{ level: number; item: DocumentTreeItem }> = []
  for (const block of content) {
    const item: DocumentTreeItem = { block, children: [] }
    if (block.type === 'heading') {
      while (stack.length && stack.at(-1)!.level >= block.level) stack.pop()
      const parent = stack.at(-1)?.item
      ;(parent ? parent.children : roots).push(item)
      stack.push({ level: block.level, item })
    } else {
      const parent = stack.at(-1)?.item
      ;(parent ? parent.children : roots).push(item)
    }
  }
  return roots
}

export function OutlinePanel(props: {
  open: boolean
  variant?: 'overlay' | 'docked'
  document: TeachingDocumentV1
  selectedId: string
  /** 画布视口中心所在块；仅用于导航反馈，不改变编辑器选区。 */
  activeBlockId?: string
  issues: DocumentValidationIssue[]
  onClose: () => void
  onOpen?: () => void
  onSelect: (blockId: string) => void
  onFixIds: () => void
  onOutlineChange?: (patch: Partial<TeachingDocumentOutlineOptions>) => void
  onMoveSection?: (headingId: string, direction: -1 | 1) => void
}) {
  const reduced = useReducedMotion()
  if (props.variant === 'docked') {
    return (
      <motion.aside
        initial={false}
        animate={{ width: props.open ? 256 : 44 }}
        transition={reduced ? { duration: 0.15 } : springPanel}
        className="question-edit-glass-aside hidden h-full shrink-0 flex-col overflow-hidden border-r border-black/6 lg:flex dark:border-white/8 backdrop-blur-md"
      >
        <AnimatePresence mode="wait" initial={false}>
          {props.open ? (
            <motion.div
              key="docked-expanded"
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: -8 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, x: -8 }}
              transition={{ duration: 0.2 }}
              className="flex h-full w-64 flex-col overflow-hidden"
            >
              <OutlinePanelBodyContent {...props} reduced={reduced} />
            </motion.div>
          ) : (
            <motion.div
              key="docked-collapsed"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.15 }}
              className="flex h-full w-11 flex-col items-center pt-3"
            >
              <button
                type="button"
                title="展开大纲"
                aria-label="展开大纲"
                onClick={props.onOpen}
                className="flex size-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100"
              >
                <PanelLeft className="size-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.aside>
    )
  }

  return (
    <AnimatePresence>
      {props.open ? (
        <motion.aside
          key="outline-overlay"
          initial={reduced ? { opacity: 0 } : { x: -280, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { x: 0, opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { x: -280, opacity: 0 }}
          transition={springPanel}
          className="question-edit-glass-dialog absolute inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-black/6 shadow-[6px_0_20px_-6px_rgba(0,0,0,0.06)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/8 dark:shadow-[6px_0_20px_-6px_rgba(0,0,0,0.4)]"
        >
          <OutlinePanelBodyContent {...props} reduced={reduced} />
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}

function OutlinePanelBodyContent(props: {
  document: TeachingDocumentV1
  selectedId: string
  activeBlockId?: string
  issues: DocumentValidationIssue[]
  onClose: () => void
  onSelect: (blockId: string) => void
  onFixIds: () => void
  onOutlineChange?: (patch: Partial<TeachingDocumentOutlineOptions>) => void
  onMoveSection?: (headingId: string, direction: -1 | 1) => void
  reduced: boolean | null
}) {
  const outline = buildDocumentOutline(props.document)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(outline.entries.map((entry) => entry.blockId)))
  const listRef = useRef<HTMLDivElement>(null)
  const documentItems = documentTree(props.document.content)
  useEffect(() => {
    if (!props.activeBlockId) return
    const target = listRef.current?.querySelector<HTMLElement>(`[data-outline-block-id="${CSS.escape(props.activeBlockId)}"]`)
    target?.scrollIntoView({ block: 'nearest' })
  }, [props.activeBlockId])
  const renderTreeItem = (item: DocumentTreeItem, depth = 0): ReactNode => {
    const { block } = item
    const isHeading = block.type === 'heading'
    const hasChildren = item.children.length > 0
    const isExpanded = expanded.has(block.id)
    const isSelected = props.selectedId === block.id
    const isActive = props.activeBlockId === block.id
    const Icon = BLOCK_ICONS[block.type] || PilcrowLeft
    const label = isHeading ? outline.entryByBlockId.get(block.id)?.displayLabel : undefined
    return (
      <div key={block.id} data-outline-block-id={block.id}>
        <div className={`group flex items-center gap-1 rounded-md pr-1 ${isSelected ? 'bg-blue-50 text-blue-900 dark:bg-blue-950/30 dark:text-blue-200' : isActive ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900'}`} style={{ paddingLeft: `${Math.min(depth, 4) * 10}px` }}>
          {isHeading ? (
            <button type="button" className="flex size-5 shrink-0 items-center justify-center" aria-label={isExpanded ? '折叠章节' : '展开章节'} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(block.id)) next.delete(block.id); else next.add(block.id); return next })}>
              {hasChildren ? (isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />) : null}
            </button>
          ) : <span className="w-5 shrink-0" />}
          <button type="button" onClick={() => props.onSelect(block.id)} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-xs">
            <Icon className={`size-3.5 shrink-0 ${isSelected ? 'opacity-80' : 'opacity-50'}`} />
            <span className="truncate">{label ? `${label} ` : ''}{blockSummary(block)}</span>
          </button>
          {isHeading && props.onMoveSection ? <span className="hidden shrink-0 group-hover:flex">
            <button type="button" title="章节上移" onClick={() => props.onMoveSection?.(block.id, -1)} className="rounded p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700"><ArrowUp className="size-3" /></button>
            <button type="button" title="章节下移" onClick={() => props.onMoveSection?.(block.id, 1)} className="rounded p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700"><ArrowDown className="size-3" /></button>
          </span> : null}
        </div>
        {isHeading && hasChildren && isExpanded ? <div className="border-l border-zinc-200 dark:border-zinc-800">{item.children.map((child) => renderTreeItem(child, depth + 1))}</div> : null}
        {block.type === 'box' && block.children.length ? <div className="ml-6 border-l border-zinc-200 pl-1 dark:border-zinc-800">
          {block.children.map((child) => {
            const childBlock = child as TeachingBlock
            const ChildIcon = BLOCK_ICONS[childBlock.type] || PilcrowLeft
            const childSelected = props.selectedId === child.id
            const childActive = props.activeBlockId === child.id
            return <button key={child.id} data-outline-block-id={child.id} type="button" onClick={() => props.onSelect(child.id)} className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] transition-colors ${childSelected ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' : childActive ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800/70 dark:text-zinc-100' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900'}`}><ChildIcon className="size-3 shrink-0 opacity-50" /><span className="truncate">{blockSummary(childBlock)}</span></button>
          })}
        </div> : null}
      </div>
    )
  }
  return (
    <>
      <div className="flex h-14 items-center justify-between border-b border-zinc-200 px-3 dark:border-zinc-800">
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">文档大纲</span>
        <button type="button" onClick={props.onClose} className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" title="收起大纲">
          <X className="size-3.5" />
        </button>
      </div>

      <div className="space-y-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-600 dark:text-zinc-300"><span>自动章节编号</span><input type="checkbox" className="size-4 accent-blue-600" checked={props.document.outline?.numberingEnabled === true} onChange={(event) => props.onOutlineChange?.({ numberingEnabled: event.target.checked })} /></label>
        <select aria-label="章节编号方案" value={props.document.outline?.preset || 'decimal'} disabled={props.document.outline?.numberingEnabled !== true} onChange={(event) => props.onOutlineChange?.({ preset: event.target.value as TeachingDocumentOutlineOptions['preset'] })} className="h-7 w-full rounded-md border border-zinc-200 bg-white px-1.5 text-[11px] dark:border-zinc-700 dark:bg-zinc-950">
          <option value="decimal">1 / 1.1 / 1.1.1</option>
          <option value="chinese">一、/（一）/ 1.</option>
          <option value="paren">（一）/ 1. /（1）</option>
          <option value="textbook">第 X 章 / 第 X 节 / 一、</option>
          <option value="chapter-chinese">第 X 章 / 一、/ 1.</option>
          <option value="chapter-decimal">第 X 章 / 1.1 / 1.1.1</option>
          <option value="chapter-section">第 X 章 / 第 X 节 / 第 X 条</option>
          <option value="roman">I. / A. / 1.</option>
          <option value="exam">试卷式</option>
          <option value="none">不编号</option>
        </select>
      </div>

      <div ref={listRef} className="flex-1 space-y-0.5 overflow-auto p-2">
        {documentItems.map((item) => renderTreeItem(item))}
        {!props.document.content.length ? (
          <p className="px-2 py-4 text-center text-[11px] text-zinc-400">暂无内容</p>
        ) : null}
      </div>

      {props.issues.length ? (
        <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
          <p className="px-2 py-1 text-[11px] font-semibold text-zinc-500">待处理问题（{props.issues.length}）</p>
          <div className="max-h-32 space-y-0.5 overflow-auto">
            {props.issues.slice(0, 8).map((issue, index) => (
              <button
                key={`${issue.code}:${index}`}
                type="button"
                onClick={() => issue.blockId && props.onSelect(issue.blockId)}
                className={`flex w-full items-start gap-1.5 rounded px-2 py-1 text-left text-[10px] transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                  issue.level === 'error' ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                <AlertTriangle className="mt-px size-3 shrink-0" />
                <span className="line-clamp-2">{issue.message}</span>
              </button>
            ))}
          </div>
          {props.issues.some((issue) => issue.code === 'auto-id') ? (
            <button
              type="button"
              onClick={props.onFixIds}
              className="mt-2 w-full rounded-md border border-zinc-200 px-2 py-1.5 text-xs text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              修复文档结构
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

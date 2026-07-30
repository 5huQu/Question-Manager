/**
 * 大纲面板
 * 左侧 overlay，translucent material，显示内容摘要列表与待处理问题
 */

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import {
  AlertTriangle, Box, FileCode2, Heading, Image, Minus,
  ChevronDown, ChevronRight, FileQuestion, PilcrowLeft, ScissorsLineDashed, TextCursorInput, X, ArrowDown, ArrowUp,
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
      return block.caption || block.alt || '图片'
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

export function OutlinePanel(props: {
  open: boolean
  document: TeachingDocumentV1
  selectedId: string
  issues: DocumentValidationIssue[]
  onClose: () => void
  onSelect: (blockId: string) => void
  onFixIds: () => void
  onOutlineChange?: (patch: Partial<TeachingDocumentOutlineOptions>) => void
  onMoveSection?: (headingId: string, direction: -1 | 1) => void
}) {
  const reduced = useReducedMotion()
  return (
    <AnimatePresence>
      {props.open ? <OutlinePanelBody key="outline-panel" {...props} reduced={reduced} /> : null}
    </AnimatePresence>
  )
}

function OutlinePanelBody(props: {
  document: TeachingDocumentV1
  selectedId: string
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
  const headingById = new Map(props.document.content.filter((block): block is Extract<TeachingBlock, { type: 'heading' }> => block.type === 'heading').map((block) => [block.id, block]))
  const renderEntry = (entry: typeof outline.entries[number]) => {
    const heading = headingById.get(entry.blockId)
    if (!heading) return null
    const children = entry.childBlockIds.map((id) => outline.entryByBlockId.get(id)).filter(Boolean) as typeof outline.entries
    const isExpanded = expanded.has(entry.blockId)
    const isSelected = props.selectedId === entry.blockId
    return (
      <div key={entry.blockId}>
        <div className={`group flex items-center gap-1 rounded-md pr-1 ${isSelected ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900'}`}>
          <button type="button" className="flex size-5 shrink-0 items-center justify-center" aria-label={isExpanded ? '折叠章节' : '展开章节'} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(entry.blockId)) next.delete(entry.blockId); else next.add(entry.blockId); return next })}>
            {children.length ? (isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />) : null}
          </button>
          <button type="button" onClick={() => props.onSelect(entry.blockId)} className="min-w-0 flex-1 truncate py-1.5 text-left text-xs">
            {entry.displayLabel ? <span className="mr-1 font-medium">{entry.displayLabel}</span> : null}
            {inlineText(heading.content).slice(0, 24) || '（空标题）'}
          </button>
          {props.onMoveSection ? <span className="hidden shrink-0 group-hover:flex">
            <button type="button" title="章节上移" onClick={() => props.onMoveSection?.(entry.blockId, -1)} className="rounded p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700"><ArrowUp className="size-3" /></button>
            <button type="button" title="章节下移" onClick={() => props.onMoveSection?.(entry.blockId, 1)} className="rounded p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700"><ArrowDown className="size-3" /></button>
          </span> : null}
        </div>
        {isExpanded && children.length ? <div className="ml-3 border-l border-zinc-200 pl-1 dark:border-zinc-800">{children.map(renderEntry)}</div> : null}
      </div>
    )
  }
  return (
    <motion.aside
      initial={props.reduced ? { opacity: 0 } : { x: -260, opacity: 0 }}
      animate={props.reduced ? { opacity: 1 } : { x: 0, opacity: 1 }}
      exit={props.reduced ? { opacity: 0 } : { x: -260, opacity: 0 }}
      transition={springPanel}
      className="absolute inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-zinc-300/40 bg-zinc-100/80 shadow-[6px_0_20px_-6px_rgba(0,0,0,0.06)] backdrop-blur-2xl backdrop-saturate-150 dark:border-zinc-700/40 dark:bg-zinc-900/80 dark:shadow-[6px_0_20px_-6px_rgba(0,0,0,0.4)]"
    >
      <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2.5 dark:border-zinc-900">
        <span className="text-[11px] font-semibold tracking-wide text-zinc-400">大纲</span>
        <button type="button" onClick={props.onClose} className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-300" title="关闭大纲">
          <X className="size-3.5" />
        </button>
      </div>

      <div className="space-y-2 border-b border-zinc-100 px-3 py-2.5 dark:border-zinc-900">
        <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-600 dark:text-zinc-300"><span>自动章节编号</span><input type="checkbox" checked={props.document.outline?.numberingEnabled === true} onChange={(event) => props.onOutlineChange?.({ numberingEnabled: event.target.checked })} /></label>
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

      <div className="flex-1 space-y-0.5 overflow-auto p-2">
        {outline.entries.length ? outline.roots.map(renderEntry) : props.document.content.map((block, index) => {
          const Icon = BLOCK_ICONS[block.type] || PilcrowLeft
          const isSelected = props.selectedId === block.id
          return (
            <div key={`${block.id}:${index}`}>
              <button
                type="button"
                onClick={() => props.onSelect(block.id)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                  isSelected
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900'
                }`}
              >
                <Icon className={`size-3.5 shrink-0 ${isSelected ? 'opacity-80' : 'opacity-50'}`} />
                <span className="truncate">{blockSummary(block)}</span>
              </button>
              {block.type === 'box' && block.children.length ? (
                <div className="ml-6 border-l border-zinc-200 pl-1 dark:border-zinc-800">
                  {block.children.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => props.onSelect(child.id)}
                      className={`block w-full truncate rounded px-2 py-1 text-left text-[11px] transition-colors ${
                        props.selectedId === child.id
                          ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                          : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900'
                      }`}
                    >
                      {blockSummary(child as TeachingBlock)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
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
    </motion.aside>
  )
}

/**
 * 简化块渲染器
 * 复用教学文档样式，但不依赖真实 resolver / API
 * 题目和图片使用占位渲染
 */

import { BookOpen, FileText, HelpCircle, Image, Lightbulb, AlertTriangle, Pencil, ListChecks, PenLine } from 'lucide-react'
import type { MockBlock } from './types'

const BOX_TONE: Record<string, { border: string; header: string; accent: string }> = {
  concept: { border: 'border-blue-200 dark:border-blue-900/50', header: 'bg-blue-50/60 dark:bg-blue-950/20', accent: 'text-blue-700 dark:text-blue-400' },
  method: { border: 'border-violet-200 dark:border-violet-900/50', header: 'bg-violet-50/60 dark:bg-violet-950/20', accent: 'text-violet-700 dark:text-violet-400' },
  example: { border: 'border-green-200 dark:border-green-900/50', header: 'bg-green-50/60 dark:bg-green-950/20', accent: 'text-green-700 dark:text-green-400' },
  warning: { border: 'border-amber-200 dark:border-amber-900/50', header: 'bg-amber-50/60 dark:bg-amber-950/20', accent: 'text-amber-700 dark:text-amber-400' },
  practice: { border: 'border-zinc-200 dark:border-zinc-800', header: 'bg-zinc-50/60 dark:bg-zinc-900/20', accent: 'text-zinc-700 dark:text-zinc-400' },
  summary: { border: 'border-green-200 dark:border-green-900/50', header: 'bg-green-50/60 dark:bg-green-950/20', accent: 'text-green-700 dark:text-green-400' },
}

const BOX_ICON: Record<string, typeof BookOpen> = {
  concept: BookOpen,
  method: Lightbulb,
  example: PenLine,
  warning: AlertTriangle,
  practice: Pencil,
  summary: ListChecks,
}

export function MockBlockRenderer({ block, compact = false }: { block: MockBlock; compact?: boolean }) {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${block.level || 2}` as 'h2' | 'h3' | 'h4'
      const sizes: Record<number, string> = {
        1: 'text-xl font-bold',
        2: 'text-lg font-semibold',
        3: 'text-base font-semibold',
        4: 'text-sm font-semibold',
      }
      return <Tag className={`${sizes[block.level || 2]} text-zinc-900 dark:text-zinc-100 ${compact ? 'my-1' : 'my-3'}`}>{block.text}</Tag>
    }

    case 'paragraph':
      return <p className={`text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300 ${compact ? 'my-0.5' : 'my-2'}`}>{block.text || <span className="text-zinc-300 italic">空段落</span>}</p>

    case 'blockMath':
      return (
        <div className={`flex items-center justify-center rounded-lg border border-zinc-100 bg-zinc-50/50 px-4 font-mono text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-200 ${compact ? 'py-1.5' : 'py-3'}`}>
          <code className="whitespace-pre-wrap text-center text-[13px]">{block.latex || '\\text{empty}'}</code>
        </div>
      )

    case 'figure':
      return (
        <div className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-200 bg-zinc-50/30 dark:border-zinc-700 dark:bg-zinc-900/20 ${compact ? 'py-3' : 'py-6'}`}>
          <Image className="size-6 text-zinc-300 dark:text-zinc-600" />
          <span className="mt-1.5 text-[11px] text-zinc-400">{block.figureLabel || '图片占位'}</span>
        </div>
      )

    case 'question':
      return (
        <div className={`rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900/40 ${compact ? 'p-2' : ''}`}>
          <div className="flex items-center gap-2">
            <span className="flex size-5 items-center justify-center rounded bg-zinc-900 text-[10px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">{block.questionNo || '?'}</span>
            <span className="text-xs text-zinc-500">题目引用（占位渲染）</span>
          </div>
          <div className="mt-2 space-y-1.5">
            <div className="h-3 w-full rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-3 w-4/5 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-3 w-3/5 rounded bg-zinc-100 dark:bg-zinc-800" />
          </div>
        </div>
      )

    case 'box': {
      const tone = BOX_TONE[block.templateId || 'concept'] || BOX_TONE.concept
      const Icon = BOX_ICON[block.templateId || 'concept'] || HelpCircle
      return (
        <div className={`rounded-xl border ${tone.border} overflow-hidden ${compact ? '' : 'my-2'}`}>
          <div className={`flex items-center gap-2 px-3 py-2 ${tone.header}`}>
            <Icon className={`size-3.5 ${tone.accent}`} />
            <span className={`text-xs font-semibold ${tone.accent}`}>{block.boxTitle || '盒子'}</span>
          </div>
          <div className="space-y-2 px-3 py-2.5">
            {(block.children || []).map((child) => (
              <MockBlockRenderer key={child.id} block={child} compact />
            ))}
            {!(block.children || []).length && <p className="text-[11px] text-zinc-400 italic">空盒子</p>}
          </div>
        </div>
      )
    }

    case 'divider':
      return <hr className="border-zinc-200 dark:border-zinc-700" />

    case 'spacer':
      return <div style={{ height: `${(block.heightEm || 2) * 0.75}rem` }} className="flex items-center justify-center"><span className="text-[9px] text-zinc-300 dark:text-zinc-700">↕ 留白</span></div>

    case 'pageBreak':
      return (
        <div className="flex items-center gap-3 py-1">
          <div className="h-px flex-1 border-t border-dashed border-zinc-300 dark:border-zinc-600" />
          <span className="text-[9px] text-zinc-400">分页</span>
          <div className="h-px flex-1 border-t border-dashed border-zinc-300 dark:border-zinc-600" />
        </div>
      )

    case 'rawMarkdown':
      return (
        <div className={`rounded-lg border border-zinc-100 bg-zinc-50/40 px-3 font-mono text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/20 dark:text-zinc-400 ${compact ? 'py-1.5' : 'py-2.5'}`}>
          <div className="flex items-center gap-1.5 mb-1"><FileText className="size-3" /><span className="text-[9px] uppercase tracking-wide text-zinc-400">Markdown</span></div>
          <pre className="whitespace-pre-wrap">{block.markdown || '(empty)'}</pre>
        </div>
      )

    default:
      return <div className="rounded border border-zinc-200 p-2 text-xs text-zinc-400">未知块</div>
  }
}

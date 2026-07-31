/**
 * 属性面板（右侧 overlay sheet）
 * 选中内容后滑入，按"内容 / 高级"分组展示编辑控件
 */

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  ArrowDown, ArrowUp, ChevronDown, Copy, Database, ImagePlus, Pencil, Sigma, Trash2, X,
} from 'lucide-react'
import type { QuestionItem } from '@/types'
import type { BoxBlock, BoxChildBlock, QuestionBlock, TeachingBlock, TeachingInline, TikzBlock } from '@/types/teachingDocument'
import { BlockInlineEditor } from '@/components/teaching-document/BlockInlineEditor/BlockInlineEditor'
import { FormulaLiveInput } from '@/components/questions/editor/FormulaLiveInput'
import { FormulaEditorDialog } from '@/components/questions/editor/FormulaEditorDialog'
import { MarkdownContent } from '@/components/MarkdownContent'
import { springPanel } from '@/components/teaching-document/motion'
import { BUILTIN_BOX_TEMPLATES, hasProtectedInlineContent, protectedInlineReason } from '@/utils/teachingDocument'
import { figureDisplayLabels } from '@/utils/questionDisplay'
import { FIGURE_LAYOUT_PRESETS, resolveFigureLayout } from '@/utils/teachingDocument/figureLayoutPresets'
import { CARD_CHILD_TYPES, USER_BLOCK_LABEL } from './blockLabels'
import { TikzEditorDialog } from './TikzEditorDialog'

export type SelectedLocation = {
  block: TeachingBlock
  topLevel: TeachingBlock
  boxId?: string
}

const ICONS = ['BookOpen', 'Lightbulb', 'PenLine', 'AlertTriangle', 'Pencil', 'ListChecks', 'Box']

function inlineContentOf(block: TeachingBlock): TeachingInline[] {
  if (block.type !== 'heading' && block.type !== 'paragraph') return []
  return block.content
}

export function PropertiesSheet(props: {
  open: boolean
  selected: SelectedLocation | null
  onClose: () => void
  onUpdate: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
  onDelete: () => void
  onDuplicate: () => void
  onMove: (direction: -1 | 1) => void
  onInsertChild: (box: BoxBlock, type: BoxChildBlock['type']) => void
  onDeleteBoxChildren: (boxId: string, childIds: string[]) => boolean
  onMergeBoxParagraphs: (boxId: string, childIds: string[]) => boolean
  onSelect: (id: string) => void
  onUpload: (file: File) => Promise<{ id: string }>
  onInsertImageInRawMarkdown: (block: Extract<TeachingBlock, { type: 'rawMarkdown' }>, markdown: string, cursor: number, file: File, boxId?: string) => Promise<void>
  onRenderTikz: (source: string) => Promise<{ asset: { id: string; url: string }; sourceHash: string; cached: boolean }>
  onQuestionLoaded: (question: QuestionItem) => void
  question?: QuestionItem
  onEditQuestion?: (blockId: string) => void
  onOpenFormula?: (blockId: string) => void
  onOpenQuestionPicker?: (blockId: string, boxId?: string) => void
}) {
  const reduced = useReducedMotion()
  return (
    <AnimatePresence>
      {props.open && props.selected ? (
        <PropertiesSheetPanel key="properties-sheet" {...props} selected={props.selected} reduced={reduced} />
      ) : null}
    </AnimatePresence>
  )
}

function PropertiesSheetPanel(props: {
  selected: SelectedLocation
  onClose: () => void
  onUpdate: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
  onDelete: () => void
  onDuplicate: () => void
  onMove: (direction: -1 | 1) => void
  onInsertChild: (box: BoxBlock, type: BoxChildBlock['type']) => void
  onDeleteBoxChildren: (boxId: string, childIds: string[]) => boolean
  onMergeBoxParagraphs: (boxId: string, childIds: string[]) => boolean
  onSelect: (id: string) => void
  onUpload: (file: File) => Promise<{ id: string }>
  onInsertImageInRawMarkdown: (block: Extract<TeachingBlock, { type: 'rawMarkdown' }>, markdown: string, cursor: number, file: File, boxId?: string) => Promise<void>
  onRenderTikz: (source: string) => Promise<{ asset: { id: string; url: string }; sourceHash: string; cached: boolean }>
  onQuestionLoaded: (question: QuestionItem) => void
  question?: QuestionItem
  onEditQuestion?: (blockId: string) => void
  onOpenFormula?: (blockId: string) => void
  onOpenQuestionPicker?: (blockId: string, boxId?: string) => void
  reduced: boolean | null
}) {
  const block = props.selected.block

  return (
    <motion.aside
      initial={props.reduced ? { opacity: 0 } : { x: 432, opacity: 0 }}
      animate={props.reduced ? { opacity: 1 } : { x: 0, opacity: 1 }}
      exit={props.reduced ? { opacity: 0 } : { x: 432, opacity: 0 }}
      transition={springPanel}
      className="absolute inset-y-0 right-0 z-30 flex w-[min(26rem,calc(100vw-2rem))] flex-col border-l border-zinc-200/50 bg-white/90 shadow-[-8px_0_24px_-6px_rgba(0,0,0,0.08)] backdrop-blur-2xl backdrop-saturate-150 dark:border-zinc-800/50 dark:bg-zinc-950/90 dark:shadow-[-8px_0_24px_-6px_rgba(0,0,0,0.5)]"
    >
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-900">
        <span className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">{USER_BLOCK_LABEL[block.type]}</span>
        <button type="button" onClick={props.onClose} className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-300" title="关闭面板">
          <X className="size-3.5" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-4">
        {/* 操作行 */}
        <div className="flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-zinc-50/50 px-1 py-0.5 dark:border-zinc-800 dark:bg-zinc-900/30">
          <ActionButton label="上移" onClick={() => props.onMove(-1)}><ArrowUp className="size-3.5" /></ActionButton>
          <ActionButton label="下移" onClick={() => props.onMove(1)}><ArrowDown className="size-3.5" /></ActionButton>
          {!props.selected.boxId ? <ActionButton label="复制" onClick={props.onDuplicate}><Copy className="size-3.5" /></ActionButton> : null}
          <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-800" />
          <ActionButton label="删除" danger onClick={props.onDelete}><Trash2 className="size-3.5" /></ActionButton>
        </div>

        <SheetBody {...props} />

        {/* 高级区 */}
        <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800">
          <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-[11px] font-normal tracking-wide text-zinc-400 select-none hover:text-zinc-600 dark:hover:text-zinc-300">
            高级
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t border-zinc-100 px-3 py-3 dark:border-zinc-900">
            <p className="font-mono text-[10px] text-zinc-400 select-all">{block.id}</p>
            {block.type === 'box' ? (
              <Field label="跨页方式">
                <select className={fieldClass} value={block.breakBehavior} onChange={(event) => props.onUpdate({ breakBehavior: event.target.value as BoxBlock['breakBehavior'] })}>
                  <option value="auto">自动</option>
                  <option value="avoid">不拆开</option>
                  <option value="allow">允许拆散</option>
                  <option value="force-before">之前换页</option>
                </select>
              </Field>
            ) : null}
            {block.type === 'question' ? (
              <>
                <Field label="跨页方式">
                  <select className={fieldClass} value={block.breakBehavior || 'auto'} onChange={(event) => props.onUpdate({ breakBehavior: event.target.value as QuestionBlock['breakBehavior'] })}>
                    <option value="auto">自动分页（推荐）</option>
                    <option value="avoid">整题不拆</option>
                    <option value="force-before">题前换页</option>
                  </select>
                </Field>
                <Field label="手动指定题目 ID">
                  <input className={fieldClass} value={block.questionId} onChange={(event) => props.onUpdate({ questionId: event.target.value }, `question-id:${block.id}`)} placeholder="题库 ID" />
                </Field>
              </>
            ) : null}
            {block.type === 'box' ? (
              <Field label="图标">
                <select className={fieldClass} value={block.icon || ''} onChange={(event) => props.onUpdate({ icon: event.target.value || undefined })}>
                  <option value="">跟随模板</option>
                  {ICONS.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
                </select>
              </Field>
            ) : null}
          </div>
        </details>

        {props.selected.boxId ? (
          <p className="rounded-md bg-zinc-50 px-2.5 py-2 text-[10px] text-zinc-500 dark:bg-zinc-900">当前为卡片内内容，不可嵌套卡片。</p>
        ) : null}
      </div>
    </motion.aside>
  )
}

const fieldClass = 'mt-1 h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100'
const areaClass = 'mt-1 min-h-24 w-full rounded-md border border-zinc-200 bg-white p-2 font-mono text-xs text-zinc-900 outline-none transition-colors focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-zinc-500">{label}</span>
      {children}
    </label>
  )
}

function ActionButton({ children, label, danger, onClick }: {
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

/** 按块类型渲染的内容编辑区 */
function SheetBody(props: {
  selected: SelectedLocation | null
  onUpdate: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
  onInsertChild: (box: BoxBlock, type: BoxChildBlock['type']) => void
  onDeleteBoxChildren: (boxId: string, childIds: string[]) => boolean
  onMergeBoxParagraphs: (boxId: string, childIds: string[]) => boolean
  onSelect: (id: string) => void
  onUpload: (file: File) => Promise<{ id: string }>
  onInsertImageInRawMarkdown: (block: Extract<TeachingBlock, { type: 'rawMarkdown' }>, markdown: string, cursor: number, file: File, boxId?: string) => Promise<void>
  onRenderTikz: (source: string) => Promise<{ asset: { id: string; url: string }; sourceHash: string; cached: boolean }>
  onQuestionLoaded: (question: QuestionItem) => void
  question?: QuestionItem
  onEditQuestion?: (blockId: string) => void
  onOpenFormula?: (blockId: string) => void
  onOpenQuestionPicker?: (blockId: string, boxId?: string) => void
}) {
  const selected = props.selected
  if (!selected) return null
  const block = selected.block

  if (block.type === 'heading' || block.type === 'paragraph') {
    return (
      <div className="space-y-3">
        {selected.boxId ? (
          <div className="space-y-1">
            <p className="text-[13px] font-medium text-zinc-500">文字</p>
            <BlockInlineEditor
              inlines={inlineContentOf(block)}
              protectedReason={hasProtectedInlineContent(block.content) ? protectedInlineReason(block.content) : undefined}
              onChange={(content) => props.onUpdate({ content }, `text:${block.id}`)}
              ariaLabel={`${USER_BLOCK_LABEL[block.type]}文字内容`}
            />
          </div>
        ) : (
          <p className="rounded-md bg-zinc-50 px-2.5 py-2 text-[11px] text-zinc-500 dark:bg-zinc-900">文字已支持在画布中直接点击编辑。</p>
        )}
        {block.type === 'heading' ? (
          <>
            <Field label="章节层级">
              <select className={fieldClass} value={block.level} onChange={(event) => props.onUpdate({ level: Number(event.target.value) as 1 | 2 | 3 | 4 })}>
                {[1, 2, 3, 4].map((level) => <option key={level} value={level}>{['一级章节', '二级章节', '三级章节', '四级章节'][level - 1]}</option>)}
              </select>
            </Field>
            <Field label="本章节编号">
              <select className={fieldClass} value={block.numbering?.mode || 'inherit'} onChange={(event) => props.onUpdate({ numbering: { ...block.numbering, mode: event.target.value as 'inherit' | 'none' | 'manual' } })}>
                <option value="inherit">跟随文档设置</option><option value="none">不显示编号</option><option value="manual">手动标签</option>
              </select>
            </Field>
            {block.numbering?.mode === 'manual' ? <Field label="手动标签"><input className={fieldClass} value={block.numbering.manualLabel || ''} maxLength={40} onChange={(event) => props.onUpdate({ numbering: { ...block.numbering, manualLabel: event.target.value } })} placeholder="如：附录 A" /></Field> : null}
          </>
        ) : null}
      </div>
    )
  }

  if (block.type === 'blockMath') {
    return (
      <div className="space-y-3">
        <FormulaLiveInput
          value={block.latex}
          onChange={(latex) => props.onUpdate({ latex }, `math:${block.id}`)}
          onOpenKeyboard={props.onOpenFormula ? () => props.onOpenFormula?.(block.id) : undefined}
          displayMode
        />
        <Field label="编号">
          <input className={fieldClass} value={block.label || ''} onChange={(event) => props.onUpdate({ label: event.target.value }, `math-label:${block.id}`)} placeholder="如 (1)" />
        </Field>
      </div>
    )
  }

  if (block.type === 'tikz') {
    return <TikzSettings block={block} onUpdate={props.onUpdate} onRender={props.onRenderTikz} />
  }

  if (block.type === 'rawMarkdown') {
    return <RichTextMarkdownSettings block={block} boxId={selected.boxId} onUpdate={props.onUpdate} onInsertImage={props.onInsertImageInRawMarkdown} />
  }

  if (block.type === 'spacer') {
    return (
      <Field label={`高度 ${block.heightEm} em`}>
        <input type="range" min={0.5} max={8} step={0.5} className="mt-2 w-full" value={block.heightEm} onChange={(event) => props.onUpdate({ heightEm: Number(event.target.value) })} />
      </Field>
    )
  }

  if (block.type === 'box') {
    return <BoxSettings {...props} block={block} />
  }

  if (block.type === 'question') {
    return <QuestionSettings {...props} block={block} boxId={selected.boxId} question={props.question} />
  }

  if (block.type === 'figure') {
    return <FigureSettings {...props} block={block} />
  }

  if (block.type === 'unknown') {
    return <p className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">此内容暂不支持编辑，原始数据已保留。</p>
  }

  return <p className="text-xs text-zinc-400">该内容没有可编辑的属性。</p>
}

function BoxSettings(props: {
  block: BoxBlock
  onUpdate: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
  onInsertChild: (box: BoxBlock, type: BoxChildBlock['type']) => void
  onDeleteBoxChildren: (boxId: string, childIds: string[]) => boolean
  onMergeBoxParagraphs: (boxId: string, childIds: string[]) => boolean
  onSelect: (id: string) => void
}) {
  const [selectedChildIds, setSelectedChildIds] = useState<Set<string>>(() => new Set())
  const [rangeAnchorId, setRangeAnchorId] = useState<string | null>(null)

  useEffect(() => {
    setSelectedChildIds(new Set())
    setRangeAnchorId(null)
  }, [props.block.id])

  const selectedInOrder = useMemo(
    () => props.block.children.filter((child) => selectedChildIds.has(child.id)),
    [props.block.children, selectedChildIds],
  )
  const canMergeParagraphs = selectedInOrder.length >= 2
    && selectedInOrder.every((child) => child.type === 'paragraph')
    && selectedInOrder.every((child) => child.type === 'paragraph' && child.content.every((inline) => inline.type !== 'unknown' && (inline.type !== 'text' || (!inline.font && !inline.color && !inline.unknownMarks?.length))))
    && selectedInOrder.every((child, index) => index === 0 || props.block.children.indexOf(child) === props.block.children.indexOf(selectedInOrder[index - 1]) + 1)

  function toggleChild(childId: string, shiftKey: boolean) {
    const childIndex = props.block.children.findIndex((child) => child.id === childId)
    if (childIndex < 0) return
    setSelectedChildIds((current) => {
      const next = new Set(current)
      const anchorIndex = rangeAnchorId ? props.block.children.findIndex((child) => child.id === rangeAnchorId) : -1
      if (shiftKey && anchorIndex >= 0) {
        const from = Math.min(anchorIndex, childIndex)
        const to = Math.max(anchorIndex, childIndex)
        for (const child of props.block.children.slice(from, to + 1)) next.add(child.id)
      } else if (next.has(childId)) {
        next.delete(childId)
      } else {
        next.add(childId)
      }
      return next
    })
    setRangeAnchorId(childId)
  }

  const clearSelection = () => {
    setSelectedChildIds(new Set())
    setRangeAnchorId(null)
  }

  return (
    <div className="space-y-3">
      <Field label="卡片模板">
        <select className={fieldClass} value={props.block.templateId} onChange={(event) => props.onUpdate({ templateId: event.target.value })}>
          {BUILTIN_BOX_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
        </select>
      </Field>
      <Field label="卡片标题">
        <input className={fieldClass} value={props.block.title || ''} onChange={(event) => props.onUpdate({ title: event.target.value }, `box-title:${props.block.id}`)} />
      </Field>
      <div className="border-t border-zinc-100 pt-3 dark:border-zinc-900">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-zinc-500">卡片内容</p>
          {props.block.children.length ? (
            <button type="button" onClick={() => selectedChildIds.size === props.block.children.length ? clearSelection() : setSelectedChildIds(new Set(props.block.children.map((child) => child.id)))} className="text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
              {selectedChildIds.size === props.block.children.length ? '取消全选' : '全选'}
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-[11px] leading-4 text-zinc-400">勾选内容后可批量删除；按 Shift 勾选可连续选择。</p>
        <div className="mt-2 space-y-1">
          {props.block.children.map((child, index) => (
            <div key={child.id} className={`flex items-center gap-1 rounded-md border px-1.5 py-1 transition-colors ${selectedChildIds.has(child.id) ? 'border-sky-300 bg-sky-50/60 dark:border-sky-800 dark:bg-sky-950/20' : 'border-zinc-200 dark:border-zinc-800'}`}>
              <input
                type="checkbox"
                aria-label={`选择第 ${index + 1} 项${USER_BLOCK_LABEL[child.type]}`}
                checked={selectedChildIds.has(child.id)}
                readOnly
                onClick={(event) => {
                  event.preventDefault()
                  toggleChild(child.id, event.shiftKey)
                }}
                className="size-3.5 accent-sky-600"
              />
              <button type="button" onClick={() => props.onSelect(child.id)} className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100">
                <span className="text-[10px] tabular-nums text-zinc-400">{index + 1}</span>
                <span className="truncate">{USER_BLOCK_LABEL[child.type]}</span>
              </button>
            </div>
          ))}
        </div>
        {selectedChildIds.size ? (
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={() => { if (props.onDeleteBoxChildren(props.block.id, selectedInOrder.map((child) => child.id))) clearSelection() }} className="h-8 rounded-md border border-red-200 px-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/30">
              删除 {selectedChildIds.size} 项
            </button>
            {canMergeParagraphs ? (
              <button type="button" onClick={() => { if (props.onMergeBoxParagraphs(props.block.id, selectedInOrder.map((child) => child.id))) clearSelection() }} className="h-8 rounded-md border border-zinc-200 px-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900">
                合并为混合内容
              </button>
            ) : null}
          </div>
        ) : null}
        <select
          className={`${fieldClass} mt-2`}
          defaultValue=""
          onChange={(event) => { if (event.target.value) props.onInsertChild(props.block, event.target.value as BoxChildBlock['type']); event.target.value = '' }}
        >
          <option value="">添加内容…</option>
          {CARD_CHILD_TYPES.map((type) => <option key={type} value={type}>{USER_BLOCK_LABEL[type]}</option>)}
        </select>
      </div>
    </div>
  )
}

function RichTextMarkdownSettings({
  block,
  boxId,
  onUpdate,
  onInsertImage,
}: {
  block: Extract<TeachingBlock, { type: 'rawMarkdown' }>
  boxId?: string
  onUpdate: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
  onInsertImage: (block: Extract<TeachingBlock, { type: 'rawMarkdown' }>, markdown: string, cursor: number, file: File, boxId?: string) => Promise<void>
}) {
  const [editorOpen, setEditorOpen] = useState(false)
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[13px] font-medium text-zinc-500">混合内容</p>
        <p className="mt-1 text-xs leading-5 text-zinc-400">适合整段讲义：可混排文字、编号列表、强调样式与 LaTeX 公式。</p>
      </div>
      <button type="button" onClick={() => setEditorOpen(true)} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900">
        <Pencil className="size-3.5" />编辑混合内容…
      </button>
      <div className="max-h-52 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50/50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900/20">
        {block.markdown.trim() ? <MarkdownContent content={block.markdown} /> : <p className="text-xs italic text-zinc-400">尚未添加内容。</p>}
      </div>
      {editorOpen ? (
        <FormulaEditorDialog
          title="编辑混合内容"
          initialLatex={block.markdown}
          initialMixedMarkdown
          onApply={(latex) => {
            onUpdate({ markdown: latex }, `markdown:${block.id}`)
            setEditorOpen(false)
          }}
          onApplyMixedMarkdown={(markdown) => {
            onUpdate({ markdown }, `markdown:${block.id}`)
            setEditorOpen(false)
          }}
          onInsertImageAtCursor={(markdown, cursor, file) => onInsertImage(block, markdown, cursor, file, boxId)}
          onClose={() => setEditorOpen(false)}
        />
      ) : null}
    </div>
  )
}

function QuestionSettings(props: {
  onUpdate: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
  onEditQuestion?: (blockId: string) => void
  onOpenQuestionPicker?: (blockId: string, boxId?: string) => void
  boxId?: string
  onUpload: (file: File) => Promise<{ id: string }>
  block: Extract<TeachingBlock, { type: 'question' }>
  question?: QuestionItem
}) {
  const [uploading, setUploading] = useState(false)
  const { block } = props
  const answerSpace = block.display?.answerSpace
  const figureLabels = figureDisplayLabels(props.question?.figures || [])

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-[13px] font-medium text-zinc-500">从题库选择</p>
        <button
          type="button"
          onClick={() => props.onOpenQuestionPicker?.(block.id, props.boxId)}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          <Database className="size-3.5" />浏览题库…
        </button>
      </div>

      {block.questionId ? (
        <div className="flex items-center justify-between rounded-md bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900">
          <span className="text-[11px] text-zinc-500">已关联题目</span>
          <button type="button" onClick={() => props.onUpdate({ questionId: '' })} className="text-[11px] text-red-600 hover:underline dark:text-red-400">清除关联</button>
        </div>
      ) : null}

      {block.questionId ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => props.onEditQuestion?.(block.id)}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <Pencil className="size-3.5" />编辑题目内容
          </button>
          {block.localContent ? (
            <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50/40 p-2 dark:border-amber-900/50 dark:bg-amber-950/20">
              <p className="text-[11px] leading-4 text-amber-800 dark:text-amber-300">当前显示文档本地版本，修改未回填题库。</p>
              <button type="button" onClick={() => props.onUpdate({ localContent: undefined })} className="text-[11px] font-medium text-red-600 hover:underline dark:text-red-400">恢复题库版本</button>
            </div>
          ) : null}
        </div>
      ) : null}

      <Field label="显示编号">
        <input className={fieldClass} value={block.display?.displayNumberAuto ? '' : (block.display?.displayNumber || '')} onChange={(event) => props.onUpdate({ display: { ...block.display, displayNumber: event.target.value, displayNumberAuto: false } })} placeholder="如 1、例 2" />
      </Field>
      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
        <input type="checkbox" className="size-3.5 rounded border-zinc-300" checked={Boolean(block.display?.showAnswer)} onChange={(event) => props.onUpdate({ display: { ...block.display, showAnswer: event.target.checked } })} />
        显示答案
      </label>
      <div className="space-y-2 rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
        <p className="text-[13px] font-medium text-zinc-500">回答留空</p>
        <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            className="size-3.5 rounded border-zinc-300"
            checked={Boolean(block.display?.answerSpace)}
            onChange={(event) => props.onUpdate({ display: {
              ...block.display,
              answerSpace: event.target.checked
                ? (block.display?.answerSpace || { heightMm: 30, style: 'blank' })
                : undefined,
            } })}
          />
          显示回答区
        </label>
        {answerSpace ? (
          <>
            <Field label={`高度 ${Math.round(answerSpace.heightMm)} mm`}>
              <input
                type="range"
                min={5}
                max={200}
                step={1}
                className="mt-2 w-full"
                value={answerSpace.heightMm}
                onChange={(event) => props.onUpdate({ display: { ...block.display, answerSpace: {
                  heightMm: Number(event.target.value),
                  style: answerSpace.style,
                } } }, `answer-space:${block.id}`)}
              />
            </Field>
            <select
              className={fieldClass}
              value={answerSpace.style}
              onChange={(event) => props.onUpdate({ display: { ...block.display, answerSpace: {
                heightMm: answerSpace.heightMm,
                style: event.target.value as 'blank' | 'lines' | 'grid',
              } } })}
            >
              <option value="blank">空白</option>
              <option value="lines">横线</option>
              <option value="grid">方格</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                className="size-3.5 rounded border-zinc-300"
                checked={Boolean(answerSpace.splitAcrossPages)}
                onChange={(event) => props.onUpdate({ display: { ...block.display, answerSpace: { ...answerSpace, splitAcrossPages: event.target.checked } } })}
              />
              跨页不延续留空（下一页直接开始下一题）
            </label>
          </>
        ) : null}
      </div>
      {props.question?.figures?.length ? (
        <div className="space-y-2 rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
          <p className="text-[13px] font-medium text-zinc-500">题图尺寸</p>
          {props.question.figures.map((figure, index) => {
            const key = figure.id || figure.blockId || `figure-${index + 1}`
            const override = block.display?.figureOverrides?.[key]
            const displayLabel = figureLabels[index]
            return (
              <div key={key} className="space-y-1.5">
                <span className="block truncate text-[11px] text-zinc-500" title={String(key)}>{displayLabel}</span>
                <input
                  type="range"
                  min={20}
                  max={240}
                  step={1}
                  className="w-full"
                  value={override?.widthMm ?? 100}
                  aria-label={`${key} 宽度 mm`}
                  onChange={(event) => props.onUpdate({ display: {
                    ...block.display,
                    figureOverrides: {
                      ...block.display?.figureOverrides,
                      [key]: { ...override, widthMm: Number(event.target.value) },
                    },
                  } }, `figure-override:${block.id}:${key}`)}
                />
                <select
                  className={fieldClass}
                  value={override?.alignment || 'center'}
                  onChange={(event) => props.onUpdate({ display: {
                    ...block.display,
                    figureOverrides: {
                      ...block.display?.figureOverrides,
                      [key]: { ...override, widthMm: override?.widthMm ?? 100, alignment: event.target.value as 'left' | 'center' | 'right' },
                    },
                  } })}
                >
                  <option value="left">左对齐</option>
                  <option value="center">居中</option>
                  <option value="right">右对齐</option>
                </select>
              </div>
            )
          })}
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
        <input type="checkbox" className="size-3.5 rounded border-zinc-300" checked={Boolean(block.display?.showAnalysis)} onChange={(event) => props.onUpdate({ display: { ...block.display, showAnalysis: event.target.checked } })} />
        显示解析
      </label>
      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
        <input type="checkbox" className="size-3.5 rounded border-zinc-300" checked={Boolean(block.display?.showScore)} onChange={(event) => props.onUpdate({ display: { ...block.display, showScore: event.target.checked } })} />
        显示分数
      </label>
      <div className="space-y-1.5 border-t border-zinc-100 pt-3 dark:border-zinc-900">
        <p className="text-[13px] font-medium text-zinc-500">插入文档图片</p>
        <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-zinc-200 px-3 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900">
          <ImagePlus className="size-4" />{uploading ? '上传中…' : '上传并插入'}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" className="hidden" disabled={uploading} onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            setUploading(true)
            try {
              const asset = await props.onUpload(file)
              const inserted = props.block.display?.insertedFigures || []
              const hasOptions = /(?:^|\n)\s*[A-D][.)]\s/.test(props.question?.stemMarkdown || '')
              props.onUpdate({ display: { ...props.block.display, insertedFigures: [...inserted, { id: `inserted-${Date.now().toString(36)}`, asset: { type: 'documentAsset', assetId: asset.id }, slot: hasOptions ? 'before-options' : 'stem-end', order: inserted.length, layoutPreset: 'block-center' }] } })
            } finally {
              setUploading(false)
              event.target.value = ''
            }
          }} />
        </label>
        {(block.display?.insertedFigures || []).length ? (
          <div className="space-y-2 pt-1">
            {(block.display?.insertedFigures || []).map((figure, index, figures) => (
              <div key={figure.id} className="space-y-1.5 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-zinc-500">文档图片 {index + 1}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" aria-label="图片上移" title="上移" disabled={index === 0} onClick={() => props.onUpdate({ display: { ...block.display, insertedFigures: figures.map((item, itemIndex) => itemIndex === index - 1 ? { ...figures[index], order: index - 1 } : itemIndex === index ? { ...figures[index - 1], order: index } : item) } })} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"><ArrowUp className="size-3.5" /></button>
                    <button type="button" aria-label="图片下移" title="下移" disabled={index === figures.length - 1} onClick={() => props.onUpdate({ display: { ...block.display, insertedFigures: figures.map((item, itemIndex) => itemIndex === index ? { ...figures[index + 1], order: index } : itemIndex === index + 1 ? { ...figures[index], order: index + 1 } : item) } })} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"><ArrowDown className="size-3.5" /></button>
                    <button type="button" aria-label="删除图片" title="删除" onClick={() => props.onUpdate({ display: { ...block.display, insertedFigures: figures.filter((item) => item.id !== figure.id).map((item, itemIndex) => ({ ...item, order: itemIndex })) } })} className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
                <select className={fieldClass} value={figure.alignment || 'center'} onChange={(event) => props.onUpdate({ display: { ...block.display, insertedFigures: figures.map((item) => item.id === figure.id ? { ...item, alignment: event.target.value as 'left' | 'center' | 'right' } : item) } })}>
                  <option value="left">左对齐</option>
                  <option value="center">居中</option>
                  <option value="right">右对齐</option>
                </select>
                <select className={fieldClass} value={figure.slot} onChange={(event) => props.onUpdate({ display: { ...block.display, insertedFigures: figures.map((item) => item.id === figure.id ? { ...item, slot: event.target.value as typeof item.slot } : item) } })}>
                  <option value="stem-start">题干开头</option>
                  <option value="stem-end">题干末尾</option>
                  <option value="before-options">选项之前</option>
                  <option value="after-options">选项之后</option>
                  <option value="before-answer">答案之前</option>
                  <option value="after-answer">答案之后</option>
                  <option value="analysis-start">解析开头</option>
                  <option value="analysis-end">解析末尾</option>
                </select>
                <input type="range" min={20} max={240} step={1} className="w-full" aria-label={`文档图片 ${index + 1} 宽度 mm`} value={figure.widthMm || 100} onChange={(event) => props.onUpdate({ display: { ...block.display, insertedFigures: figures.map((item) => item.id === figure.id ? { ...item, widthMm: Number(event.target.value) } : item) } }, `inserted-figure-width:${block.id}:${figure.id}`)} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function FigureSettings(props: {
  onUpdate: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
  onUpload: (file: File) => Promise<{ id: string }>
  block: Extract<TeachingBlock, { type: 'figure' }>
}) {
  const { block } = props
  const [uploading, setUploading] = useState(false)
  const groupItems = block.groupItems || []
  const grouped = groupItems.length > 0
  const updateGroupItems = (items: typeof groupItems, mergeKey?: string) => props.onUpdate({ groupItems: items }, mergeKey)

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-[13px] font-medium text-zinc-500">{grouped ? '图片组' : '图片'}</p>
        <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-zinc-200 px-3 text-xs text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900">
          <ImagePlus className="size-4" />
          {uploading ? '上传中…' : grouped ? '添加图片' : '替换图片'}
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
            className="hidden"
            disabled={uploading}
            onChange={async (event) => {
              const files = Array.from(event.target.files || [])
              if (!files.length) return
              setUploading(true)
              try {
                const assets = await Promise.all(files.map((file) => props.onUpload(file)))
                if (grouped) {
                  updateGroupItems([
                    ...groupItems,
                    ...assets.map((asset, index) => ({
                      id: `figure-item-${Date.now().toString(36)}-${index}`,
                      asset: { type: 'documentAsset' as const, assetId: asset.id },
                    })),
                  ])
                } else if (assets.length === 1) {
                  props.onUpdate({ asset: { type: 'documentAsset', assetId: assets[0].id } })
                } else {
                  props.onUpdate({
                    asset: { type: 'documentAsset', assetId: assets[0].id },
                    groupItems: assets.map((asset, index) => ({
                      id: `figure-item-${Date.now().toString(36)}-${index}`,
                      asset: { type: 'documentAsset' as const, assetId: asset.id },
                    })),
                    groupColumns: Math.min(3, assets.length) as 2 | 3,
                    groupGapMm: 4,
                    widthMm: Math.max(140, block.widthMm || 80),
                    caption: undefined,
                  })
                }
              } finally {
                setUploading(false)
                event.target.value = ''
              }
            }}
          />
        </label>
        {!grouped ? (
          <button
            type="button"
            onClick={() => props.onUpdate({
              groupItems: [{
                id: `figure-item-${Date.now().toString(36)}`,
                asset: block.asset,
                ...(block.caption ? { caption: block.caption } : {}),
              }],
              groupColumns: 2,
              groupGapMm: 4,
              caption: undefined,
              widthMm: Math.max(120, block.widthMm || 80),
            })}
            className="ml-2 inline-flex h-9 items-center rounded-md border border-zinc-200 px-3 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            组合多图
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              const first = groupItems[0]
              props.onUpdate({
                asset: first?.asset || block.asset,
                caption: first?.caption,
                groupItems: undefined,
                groupColumns: undefined,
                groupGapMm: undefined,
              })
            }}
            className="ml-2 inline-flex h-9 items-center rounded-md border border-zinc-200 px-3 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            转为单图
          </button>
        )}
      </div>
      {grouped ? (
        <>
          <Field label="每行图片">
            <div className="mt-1 grid grid-cols-3 gap-1 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-900">
              {([1, 2, 3] as const).map((columns) => (
                <button key={columns} type="button" onClick={() => props.onUpdate({ groupColumns: columns })} className={`h-8 rounded text-xs ${block.groupColumns === columns ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50' : 'text-zinc-500'}`}>{columns} 列</button>
              ))}
            </div>
          </Field>
          <Field label={`图片间距 ${Math.round(block.groupGapMm ?? 4)} mm`}>
            <input type="range" min={0} max={12} step={1} className="mt-2 w-full" value={block.groupGapMm ?? 4} onChange={(event) => props.onUpdate({ groupGapMm: Number(event.target.value) }, `figure-group-gap:${block.id}`)} />
          </Field>
          <div className="space-y-2">
            {groupItems.map((item, index) => (
              <div key={item.id} className="space-y-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-zinc-500">图片 {index + 1}</span>
                  <div className="flex items-center gap-0.5">
                    <button type="button" title="上移" aria-label={`图片 ${index + 1} 上移`} disabled={index === 0} onClick={() => {
                      const next = [...groupItems]
                      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                      updateGroupItems(next)
                    }} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"><ArrowUp className="size-3.5" /></button>
                    <button type="button" title="下移" aria-label={`图片 ${index + 1} 下移`} disabled={index === groupItems.length - 1} onClick={() => {
                      const next = [...groupItems]
                      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
                      updateGroupItems(next)
                    }} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"><ArrowDown className="size-3.5" /></button>
                    <button type="button" title="删除" aria-label={`删除图片 ${index + 1}`} onClick={() => updateGroupItems(groupItems.filter((entry) => entry.id !== item.id))} className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
                <input className={fieldClass} placeholder="图片下方说明" value={item.caption || ''} onChange={(event) => updateGroupItems(groupItems.map((entry) => entry.id === item.id ? { ...entry, caption: event.target.value } : entry), `figure-group-caption:${block.id}:${item.id}`)} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <Field label="图注">
          <input className={fieldClass} value={block.caption || ''} onChange={(event) => props.onUpdate({ caption: event.target.value }, `figure-caption:${block.id}`)} />
        </Field>
      )}
      <Field label="对齐">
        <select className={fieldClass} value={block.alignment} onChange={(event) => props.onUpdate({ alignment: event.target.value as 'left' | 'center' | 'right' })}>
          <option value="left">左对齐</option>
          <option value="center">居中</option>
          <option value="right">右对齐</option>
        </select>
      </Field>
      <Field label={`宽度 ${Math.round(block.widthMm || 80)} mm`}>
        <input type="range" min={10} max={400} step={1} className="mt-2 w-full" value={block.widthMm || 80} onChange={(event) => props.onUpdate({ widthMm: Number(event.target.value), widthRatio: undefined })} />
      </Field>
    </div>
  )
}

function TikzSettings({ block, onUpdate, onRender }: { block: TikzBlock; onUpdate: (patch: Partial<TeachingBlock>, mergeKey?: string) => void; onRender: (source: string) => Promise<{ asset: { id: string; url: string }; sourceHash: string; cached: boolean }> }) {
  const [editorOpen, setEditorOpen] = useState(false)
  const stale = !block.svgAssetId || !block.sourceHash
  return <div className="space-y-3">
    <div className={`rounded-md px-2.5 py-2 text-xs ${stale ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'}`}>{stale ? '预览已过期：编辑源码后点击生成预览。' : '当前 SVG 预览与源码一致。'}</div>
    <button type="button" onClick={() => setEditorOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">编辑 TikZ 绘图</button>
    <Field label="排版方式">
      <select className={fieldClass} value={block.layoutPreset || 'block-center'} onChange={(event) => {
        const layoutPreset = event.target.value as TikzBlock['layoutPreset']
        const layout = resolveFigureLayout({ preset: layoutPreset, legacyAlignment: block.alignment, containerWidthMm: 160 })
        onUpdate({ layoutPreset, alignment: layout.alignment, widthMm: layout.widthMm }, `tikz-layout:${block.id}`)
      }}>
        {FIGURE_LAYOUT_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
      </select>
    </Field>
    <Field label="对齐">
      <select className={fieldClass} value={block.alignment} onChange={(event) => onUpdate({ alignment: event.target.value as TikzBlock['alignment'] }, `tikz-alignment:${block.id}`)}>
        <option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option>
      </select>
    </Field>
    <Field label="图注"><input className={fieldClass} value={block.caption || ''} onChange={(event) => onUpdate({ caption: event.target.value }, `tikz-caption:${block.id}`)} /></Field>
    <Field label={`宽度 ${block.widthMm || 80} mm`}><input type="range" min={20} max={240} step={1} className="mt-2 w-full" value={block.widthMm || 80} onChange={(event) => onUpdate({ widthMm: Number(event.target.value) }, `tikz-width:${block.id}`)} /></Field>
    {editorOpen ? <TikzEditorDialog source={block.source} svgAssetId={block.svgAssetId} sourceHash={block.sourceHash} onRender={onRender} onApply={(value) => onUpdate(value, `tikz-edit:${block.id}`)} onClose={() => setEditorOpen(false)} /> : null}
  </div>
}

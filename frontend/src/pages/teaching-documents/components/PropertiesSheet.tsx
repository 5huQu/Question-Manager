/**
 * 属性面板（右侧 overlay sheet）
 * 选中内容后滑入，按"内容 / 高级"分组展示编辑控件
 */

import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  ArrowDown, ArrowUp, ChevronDown, Copy, Database, ImagePlus, Pencil, Sigma, Trash2, X,
} from 'lucide-react'
import type { QuestionItem } from '@/types'
import type { BoxBlock, BoxChildBlock, QuestionBlock, TeachingBlock, TeachingInline } from '@/types/teachingDocument'
import { BlockInlineEditor } from '@/components/teaching-document/BlockInlineEditor/BlockInlineEditor'
import { FormulaLiveInput } from '@/components/questions/editor/FormulaLiveInput'
import { springPanel } from '@/components/teaching-document/motion'
import { BUILTIN_BOX_TEMPLATES, hasProtectedInlineContent, protectedInlineReason } from '@/utils/teachingDocument'
import { figureDisplayLabels } from '@/utils/questionDisplay'
import { CARD_CHILD_TYPES, USER_BLOCK_LABEL } from './blockLabels'

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
  onSelect: (id: string) => void
  onUpload: (file: File) => Promise<{ id: string }>
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
  onSelect: (id: string) => void
  onUpload: (file: File) => Promise<{ id: string }>
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
      initial={props.reduced ? { opacity: 0 } : { x: 320, opacity: 0 }}
      animate={props.reduced ? { opacity: 1 } : { x: 0, opacity: 1 }}
      exit={props.reduced ? { opacity: 0 } : { x: 320, opacity: 0 }}
      transition={springPanel}
      className="absolute inset-y-0 right-0 z-30 flex w-80 flex-col border-l border-zinc-200/50 bg-white/90 shadow-[-8px_0_24px_-6px_rgba(0,0,0,0.08)] backdrop-blur-2xl backdrop-saturate-150 dark:border-zinc-800/50 dark:bg-zinc-950/90 dark:shadow-[-8px_0_24px_-6px_rgba(0,0,0,0.5)]"
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
  onSelect: (id: string) => void
  onUpload: (file: File) => Promise<{ id: string }>
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
          <Field label="标题级别">
            <select className={fieldClass} value={block.level} onChange={(event) => props.onUpdate({ level: Number(event.target.value) as 1 | 2 | 3 | 4 })}>
              {[1, 2, 3, 4].map((level) => <option key={level} value={level}>H{level}</option>)}
            </select>
          </Field>
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

  if (block.type === 'rawMarkdown') {
    return (
      <Field label="自由文本（Markdown）">
        <textarea className={areaClass} value={block.markdown} onChange={(event) => props.onUpdate({ markdown: event.target.value }, `markdown:${block.id}`)} />
      </Field>
    )
  }

  if (block.type === 'spacer') {
    return (
      <Field label={`高度 ${block.heightEm} em`}>
        <input type="range" min={0.5} max={8} step={0.5} className="mt-2 w-full" value={block.heightEm} onChange={(event) => props.onUpdate({ heightEm: Number(event.target.value) })} />
      </Field>
    )
  }

  if (block.type === 'box') {
    return (
      <div className="space-y-3">
        <Field label="卡片模板">
          <select className={fieldClass} value={block.templateId} onChange={(event) => props.onUpdate({ templateId: event.target.value })}>
            {BUILTIN_BOX_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
          </select>
        </Field>
        <Field label="卡片标题">
          <input className={fieldClass} value={block.title || ''} onChange={(event) => props.onUpdate({ title: event.target.value }, `box-title:${block.id}`)} />
        </Field>
        <div className="border-t border-zinc-100 pt-3 dark:border-zinc-900">
          <p className="text-[13px] font-medium text-zinc-500">卡片内容</p>
          <div className="mt-2 space-y-1">
            {block.children.map((child, index) => (
              <button key={child.id} type="button" onClick={() => props.onSelect(child.id)} className="flex w-full items-center gap-2 rounded-md border border-zinc-200 px-2 py-1.5 text-left text-xs text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900">
                <span className="text-[10px] tabular-nums text-zinc-400">{index + 1}</span>
                {USER_BLOCK_LABEL[child.type]}
              </button>
            ))}
          </div>
          <select
            className={`${fieldClass} mt-2`}
            defaultValue=""
            onChange={(event) => { if (event.target.value) props.onInsertChild(block, event.target.value as BoxChildBlock['type']); event.target.value = '' }}
          >
            <option value="">添加内容…</option>
            {CARD_CHILD_TYPES.map((type) => <option key={type} value={type}>{USER_BLOCK_LABEL[type]}</option>)}
          </select>
        </div>
      </div>
    )
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
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploading} onChange={async (event) => {
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

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-[13px] font-medium text-zinc-500">图片</p>
        <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-zinc-200 px-3 text-xs text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900">
          <ImagePlus className="size-4" />
          {uploading ? '上传中…' : '替换图片'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            disabled={uploading}
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              setUploading(true)
              try {
                const asset = await props.onUpload(file)
                props.onUpdate({ asset: { type: 'documentAsset', assetId: asset.id } })
              } finally {
                setUploading(false)
                event.target.value = ''
              }
            }}
          />
        </label>
      </div>
      <Field label="替代文本">
        <input className={fieldClass} value={block.alt || ''} onChange={(event) => props.onUpdate({ alt: event.target.value }, `figure-alt:${block.id}`)} />
      </Field>
      <Field label="图注">
        <input className={fieldClass} value={block.caption || ''} onChange={(event) => props.onUpdate({ caption: event.target.value }, `figure-caption:${block.id}`)} />
      </Field>
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

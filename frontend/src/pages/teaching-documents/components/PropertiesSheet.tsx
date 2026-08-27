/**
 * 属性面板（右侧 overlay sheet）
 * 选中内容后滑入，按"内容 / 高级"分组展示编辑控件
 */

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Trash2, X } from 'lucide-react'
import type { QuestionItem } from '@/types'
import type { BoxBlock, BoxChildBlock, QuestionBlock, TeachingBlock, TeachingInline, TikzBlock } from '@/types/teachingDocument'
import { BlockInlineEditor } from '@/components/teaching-document/BlockInlineEditor/BlockInlineEditor'
import { FormulaLiveInput } from '@/components/questions/editor/FormulaLiveInput'
import { FormulaEditorDialog } from '@/components/questions/editor/FormulaEditorDialog'
import { MarkdownContent } from '@/components/MarkdownContent'
import { springDock, springPanel } from '@/components/teaching-document/motion'
import { BUILTIN_BOX_TEMPLATES, hasProtectedInlineContent, protectedInlineReason } from '@/utils/teachingDocument'
import { figureDisplayLabels } from '@/utils/questionDisplay'
import { FIGURE_LAYOUT_PRESETS, resolveFigureLayout } from '@/utils/teachingDocument/figureLayoutPresets'
import { InspectorSlider } from '@/components/ui/InspectorSlider'
import { CARD_CHILD_TYPES, USER_BLOCK_LABEL } from './blockLabels'
import { BoxSettings, BoxStyleSettings } from './settings/boxSettings'
import { RichTextMarkdownSettings } from './settings/rawMarkdownSettings'
import { QuestionSettings } from './settings/questionSettings'
import { FigureSettings } from './settings/figureSettings'
import { TikzSettings } from './settings/tikzSettings'
import { TikzEditorDialog } from './TikzEditorDialog'
import { HeadingSkinSelector } from './TeachingSkinSelector'
import type { TeachingSkinPresetResolution } from '@/utils/teachingDocument/skins'

export type SelectedLocation = {
  block: TeachingBlock
  topLevel: TeachingBlock
  boxId?: string
}

function inlineContentOf(block: TeachingBlock): TeachingInline[] {
  if (block.type !== 'heading' && block.type !== 'paragraph') return []
  return block.content
}

export function PropertiesSheet(props: {
  open: boolean
  variant?: 'overlay' | 'docked'
  selected: SelectedLocation | null
  presetContext?: TeachingSkinPresetResolution
  onClose: () => void
  onUpdate: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
  /** 卡片内段落展示卡片设置时，配置必须写回父卡片而不是当前文本子块。 */
  onUpdateTopLevel: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
  onDelete: () => void
  onDuplicate: () => void
  onMove: (direction: -1 | 1) => void
  /** 为当前顶层对象维护紧随其后的显式换页标记。 */
  onSetPageBreakAfter?: (blockId: string, enabled: boolean) => void
  pageBreakAfter?: boolean
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
  onExitComplete?: () => void
}) {
  const reduced = useReducedMotion()
  return (
    <AnimatePresence mode="wait" onExitComplete={props.onExitComplete}>
      {props.open && props.selected ? (
        <PropertiesSheetPanel key={props.selected.block.id || 'properties-sheet'} {...props} selected={props.selected} reduced={reduced} />
      ) : null}
    </AnimatePresence>
  )
}

function PropertiesSheetPanel(props: {
  variant?: 'overlay' | 'docked'
  selected: SelectedLocation
  presetContext?: TeachingSkinPresetResolution
  onClose: () => void
  onUpdate: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
  onUpdateTopLevel: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
  onDelete: () => void
  onDuplicate: () => void
  onMove: (direction: -1 | 1) => void
  onSetPageBreakAfter?: (blockId: string, enabled: boolean) => void
  pageBreakAfter?: boolean
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
  // 卡片内段落：卡片是"一个文本框对象"，文字是框的流——面板显示卡片页而非段落对象页。
  const displayBlock = props.selected.boxId && block.type === 'paragraph' && props.selected.topLevel.type === 'box'
    ? props.selected.topLevel
    : block
  // 卡片通常先调整模板、皮肤与外观；其余对象打开后仍优先显示可编辑内容。
  const [tab, setTab] = useState<'content' | 'style' | 'layout'>(() => displayBlock.type === 'box' || displayBlock.type === 'question' ? 'style' : 'content')
  const updateDisplayBlock = displayBlock.id === block.id ? props.onUpdate : props.onUpdateTopLevel
  const layoutBlock = displayBlock.type === 'box' ? displayBlock : block
  // 换页符只能位于顶层对象之间。卡片内对象的面板仍提供此项，但作用于所属卡片之后。
  const pageBreakTarget = props.selected.topLevel
  const canSetPageBreakAfter = pageBreakTarget.type !== 'pageBreak'

  return (
    <motion.aside
      initial={props.reduced ? { opacity: 0 } : { x: 20, opacity: 0 }}
      animate={props.reduced ? { opacity: 1 } : { x: 0, opacity: 1 }}
      exit={props.reduced ? { opacity: 0 } : { x: 20, opacity: 0 }}
      transition={props.reduced ? { duration: 0.15 } : props.variant === 'docked' ? springDock : springPanel}
      className={props.variant === 'docked'
        ? 'question-edit-glass-aside flex h-full w-[18.75rem] flex-col border-l border-black/6 dark:border-white/8'
        : 'question-edit-glass-dialog absolute inset-y-0 right-0 z-30 flex w-[min(26rem,calc(100vw-2rem))] flex-col border-l border-black/6 dark:border-white/8 shadow-[-8px_0_24px_-6px_rgba(0,0,0,0.08)] backdrop-blur-2xl backdrop-saturate-150'}
    >
      <div className="flex h-12 items-center justify-between border-b border-black/6 px-4 dark:border-white/8">
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{USER_BLOCK_LABEL[displayBlock.type]}</span>
        <button type="button" onClick={props.onClose} className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-zinc-100" title="关闭属性面板">
          <X className="size-3.5" />
        </button>
      </div>

      <div role="tablist" aria-label="属性分组" className="question-edit-glass-tabs flex items-center gap-0.5 p-1 m-3 shrink-0">
        {([['style', '样式'], ['content', '内容'], ['layout', '布局']] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className="flex-1 h-7 rounded-md text-xs font-medium transition-all"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-4">
        {/* 层级面包屑：卡片内子块显示“卡片 › 子块”，点击卡片上浮选中 */}
        {props.selected.boxId && props.selected.topLevel.type === 'box' ? (
          <div className="flex items-center gap-1 rounded-md bg-zinc-50 px-2 py-1.5 text-[11px] text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400">
            <button
              type="button"
              onClick={() => props.onSelect(props.selected.topLevel.id)}
              className="max-w-32 truncate rounded px-1 py-0.5 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              title="选中父卡片（Esc）"
            >
              {props.selected.topLevel.title || '知识卡片'}
            </button>
            <ChevronRight className="size-3 shrink-0" />
            <span className="truncate">{USER_BLOCK_LABEL[props.selected.block.type]}</span>
          </div>
        ) : null}
        {/* 操作行 */}
        <div className="flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-zinc-50/50 px-1 py-0.5 dark:border-zinc-800 dark:bg-zinc-900/30">
          <ActionButton label="上移" onClick={() => props.onMove(-1)}><ArrowUp className="size-3.5" /></ActionButton>
          <ActionButton label="下移" onClick={() => props.onMove(1)}><ArrowDown className="size-3.5" /></ActionButton>
          {!props.selected.boxId ? <ActionButton label="复制" onClick={props.onDuplicate}><Copy className="size-3.5" /></ActionButton> : null}
          <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-800" />
          <ActionButton label="删除" danger onClick={props.onDelete}><Trash2 className="size-3.5" /></ActionButton>
        </div>

        {tab === 'content' ? <SheetBody {...props} onUpdateDisplayBlock={updateDisplayBlock} /> : null}
        {tab === 'style' && displayBlock.type === 'box' ? <BoxStyleSettings block={displayBlock} presetContext={props.presetContext} onUpdate={updateDisplayBlock} /> : null}
        {tab === 'style' && displayBlock.type === 'question' ? <QuestionSettings {...props} mode="style" block={displayBlock} boxId={props.selected.boxId} question={props.question} onUpdate={updateDisplayBlock} /> : null}
        {tab === 'style' && displayBlock.type !== 'box' && displayBlock.type !== 'question' ? <div className="min-h-12" /> : null}

        {/* 高级区 */}
        {tab === 'layout' ? <details open className="group rounded-lg border border-zinc-200 dark:border-zinc-800">
          <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-[11px] font-normal tracking-wide text-zinc-400 select-none hover:text-zinc-600 dark:hover:text-zinc-300">
            高级
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t border-zinc-100 px-3 py-3 dark:border-zinc-900">
            <p className="font-mono text-[10px] text-zinc-400 select-all">{layoutBlock.id}</p>
            {canSetPageBreakAfter ? (
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-200 bg-zinc-50/50 px-2.5 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-200">
                <input
                  type="checkbox"
                  className="mt-0.5 size-3.5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950"
                  checked={props.pageBreakAfter === true}
                  onChange={(event) => props.onSetPageBreakAfter?.(pageBreakTarget.id, event.target.checked)}
                  aria-label="在此对象后强制换页"
                />
                <span><span className="block font-medium">在此对象后强制换页</span><span className="mt-0.5 block text-[10px] text-zinc-500">{props.selected.boxId ? '在所属卡片与下一对象之间插入换页标记。' : '在当前对象与下一对象之间插入换页标记。'}</span></span>
              </label>
            ) : null}
            {layoutBlock.type === 'box' ? (
              <Field label="跨页方式">
                <select className={fieldClass} value={layoutBlock.breakBehavior} onChange={(event) => updateDisplayBlock({ breakBehavior: event.target.value as BoxBlock['breakBehavior'] })}>
                  <option value="auto">自动</option>
                  <option value="avoid">不拆开</option>
                  <option value="allow">允许拆散</option>
                </select>
              </Field>
            ) : null}
            {block.type === 'question' ? (
              <>
                <Field label="跨页方式">
                  <select className={fieldClass} value={block.breakBehavior || 'auto'} onChange={(event) => props.onUpdate({ breakBehavior: event.target.value as QuestionBlock['breakBehavior'] })}>
                    <option value="auto">自动分页（推荐）</option>
                    <option value="avoid">整题不拆</option>
                  </select>
                </Field>
                <Field label="手动指定题目 ID">
                  <input className={fieldClass} value={block.questionId} onChange={(event) => props.onUpdate({ questionId: event.target.value }, `question-id:${block.id}`)} placeholder="题库 ID" />
                </Field>
              </>
            ) : null}
          </div>
        </details> : null}

        {tab === 'content' && props.selected.boxId ? (
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
  presetContext?: TeachingSkinPresetResolution
  onUpdate: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
  onUpdateDisplayBlock: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
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
    // 卡片内文字：不显示段落对象页，回到卡片页（卡片是文本框对象，文字是框的流）
    if (selected.boxId && selected.topLevel.type === 'box') {
      return <BoxSettings {...props} block={selected.topLevel} onUpdate={props.onUpdateDisplayBlock} />
    }
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
            <HeadingSkinSelector skin={block.skin} level={block.level} presetContext={props.presetContext} onChange={(skin) => props.onUpdate({ skin })} />
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
      <InspectorSlider
        label="留空高度"
        value={block.heightEm}
        min={0.5}
        max={8}
        step={0.5}
        unit="em"
        presets={[0.5, 1, 2, 4]}
        onChange={(val) => props.onUpdate({ heightEm: val })}
      />
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

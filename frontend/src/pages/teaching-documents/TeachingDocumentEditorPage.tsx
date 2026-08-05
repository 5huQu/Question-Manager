/**
 * 讲义编辑器页面（Focus Canvas 组装层）
 * 状态协调 + 布局骨架；具体 UI 委托给 components/ 子组件
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Bold, Check, ChevronLeft, ChevronRight, Download, FileUp, Italic, LoaderCircle, RefreshCcw, Settings2, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { springPanel } from '@/components/teaching-document/motion'
import type { QuestionItem } from '@/types'
import type {
  BoxBlock,
  BoxChildBlock,
  FigureAssetRef,
  QuestionBlock,
  TeachingBlock,
  TeachingInline,
  TeachingDocumentV1,
  TeachingMarginPreset,
  TeachingDocumentPrintOptions,
  TeachingDocumentStyle,
  PrintChromeContentType,
  PrintChromeSlot,
  PrintChromeSlotPosition,
  TeachingTextStyle,
} from '@/types/teachingDocument'
import { questionBankApi } from '@/api/questionBank'
import { teachingDocumentsApi } from '@/api/teachingDocuments'
import { ApiError, type PdfExportVariant } from '@/api/client'
import { A4PaginationPreview, type A4PaginationState } from '@/components/teaching-document/A4PaginationPreview'
import { TeachingDocumentCanvas } from '@/components/teaching-document/editor'
import { ExportPdfPanel } from '@/components/teaching-document/ExportPdfPanel'
import { PrintChrome, type PrintChromeSection } from '@/components/teaching-document/PrintChrome'
import { type QuestionResolution } from '@/components/teaching-document/blocks/BlockRenderer'
import {
  resolveDocumentPaper,
  createDocumentPrintLayout,
  logicalPagePaper,
  migrateDocumentIds,
  markdownToTeachingBlocks,
  newTeachingBlock,
  blocksForRawMarkdownFigureInsertion,
  type PaperSpec,
  type PrintLayoutSpec,
} from '@/utils/teachingDocument'
import {
  CJK_FONT_OPTIONS,
  LATIN_FONT_OPTIONS,
  TEXT_FONT_OPTIONS,
  lectureFontFaceCss,
  lectureFontCssVars,
  teachingTypographyCssVars,
  resolveDocumentFonts,
  resolveHeadingStyle,
  resolveQuestionStyle,
  TYPOGRAPHY_PRESETS,
  typographyStyleForPreset,
} from '@/utils/teachingDocument/lectureFonts'
import { assetUrl } from '@/utils/questionDisplay'
import { documentForPrintVariant } from '@/utils/teachingDocument/printVariant'
import type { PrintChromeTemplate } from '@/api/teachingDocuments'
import { useTeachingDocumentEditor } from './useTeachingDocumentEditor'
import { getFocusedCardEditor, insertCardBlockAtCaret, subscribeFocusedCardEditor } from '@/components/teaching-document/editor/cardEditorRegistry'
import {
  BOX_CHILD_MULTI_SELECT_EVENT,
  TOP_LEVEL_MULTI_SELECT_EVENT,
  setTopLevelMultiSelectIds,
  type BoxChildMultiSelectDetail,
  type TopLevelMultiSelectDetail,
} from '@/components/teaching-document/editor/selection'
import { EditorTopBar, type TeachingCanvasMode } from './components/EditorTopBar'
import type { HeadingLevel } from './components/BlockInsertMenu'
import { OutlinePanel } from './components/OutlinePanel'
import { PropertiesSheet, type SelectedLocation } from './components/PropertiesSheet'
import { DocumentFormattingToolbar } from './components/DocumentFormattingToolbar'
import { QuestionEditDialog } from './components/QuestionEditDialog'
import { QuestionPickerDrawer } from './components/QuestionPickerDrawer'
import { FormulaEditorDialog } from '@/components/questions/editor/FormulaEditorDialog'
import { USER_BLOCK_LABEL, CARD_CHILD_TYPES } from './components/blockLabels'
import { activePageFromPageRects, activePageFromPageTransitions } from './pageNavigation'
import '@/components/teaching-document/teaching-document.css'

const CHROME_CONTENT_OPTIONS: Array<{ value: PrintChromeContentType; label: string }> = [
  { value: 'none', label: '留空' },
  { value: 'customText', label: '自定义文字' },
  { value: 'documentTitle', label: '文档标题' },
  { value: 'pageNumber', label: '当前页码' },
  { value: 'totalPages', label: '总页数' },
  { value: 'date', label: '日期' },
]

const PAGE_NUMBER_FORMAT_OPTIONS = [
  { value: 'number', label: '3' },
  { value: 'page', label: '第 3 页' },
  { value: 'fraction', label: '3 / 4' },
  { value: 'page-total', label: '第 3 页，共 4 页' },
  { value: 'dash', label: '- 3 -' },
] as const

const CHROME_FONT_OPTIONS = [
  { id: 'inherit', label: '跟随正文' },
  ...TEXT_FONT_OPTIONS,
] as const

const CHROME_FONT_SIZE_OPTIONS = [8, 9, 10, 11, 12, 14] as const

/** id → 选中位置的缓存索引，避免每次选择/定位都线性扫描整篇文档。 */
function buildSelectedLocationIndex(document: TeachingDocumentV1): Map<string, SelectedLocation> {
  const map = new Map<string, SelectedLocation>()
  for (const block of document.content) {
    map.set(block.id, { block, topLevel: block })
    if (block.type === 'box') {
      for (const child of block.children) {
        map.set(child.id, { block: child as TeachingBlock, topLevel: block, boxId: block.id })
      }
    }
  }
  return map
}

function mergeTextStyle(current: TeachingTextStyle | undefined, patch: Partial<TeachingTextStyle>): TeachingTextStyle | undefined {
  const next = { ...(current || {}), ...patch }
  for (const key of Object.keys(next) as Array<keyof TeachingTextStyle>) {
    if (next[key] === undefined) delete next[key]
  }
  return Object.keys(next).length ? next : undefined
}

function PageSettingsDrawer(props: {
  open: boolean
  onClose: () => void
  printSettings: ReactNode
  fontSettings: ReactNode
  answerSettings: ReactNode
}) {
  const [tab, setTab] = useState<'print' | 'typography' | 'answers'>('print')
  const reduced = useReducedMotion()
  const tabs: Array<{ id: typeof tab; label: string }> = [
    { id: 'print', label: '页眉页脚' },
    { id: 'typography', label: '字体与题距' },
    { id: 'answers', label: '解答题' },
  ]
  return (
    <div className="absolute inset-0 z-40 overflow-hidden" role="dialog" aria-modal="true" aria-label="页面设置">
      <motion.button
        type="button"
        aria-label="关闭页面设置"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-xs"
        onClick={props.onClose}
      />
      <motion.aside
        initial={reduced ? { opacity: 0 } : { x: '100%', opacity: 0.8 }}
        animate={reduced ? { opacity: 1 } : { x: 0, opacity: 1 }}
        exit={reduced ? { opacity: 0 } : { x: '100%', opacity: 0 }}
        transition={reduced ? { duration: 0.15 } : springPanel}
        className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div><h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">页面设置</h2><p className="mt-0.5 text-[11px] text-zinc-500">整份文档同步更新，不按页保存。</p></div>
          <button type="button" onClick={props.onClose} className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900">完成</button>
        </div>
        <div className="border-b border-zinc-200 px-5 py-2 dark:border-zinc-800">
          <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900">
            {tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`rounded-md px-3 py-1.5 text-[11px] transition-colors ${tab === item.id ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}>{item.label}</button>)}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              {tab === 'print' ? props.printSettings : null}
              {tab === 'typography' ? props.fontSettings : null}
              {tab === 'answers' ? props.answerSettings : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.aside>
    </div>
  )
}

function FontSelect(props: {
  label: string
  ariaLabel: string
  value: string
  options: Array<{ id: string; label: string }>
  onChange: (value: string) => void
}) {
  return <label className="block text-[12px] font-medium text-zinc-600 dark:text-zinc-300">{props.label}
    <select aria-label={props.ariaLabel} value={props.value} onChange={(event) => props.onChange(event.target.value)} className={paperFieldClass}>
      {props.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
  </label>
}

function ChromeSettingsPanel(props: {
  printLayout: PrintLayoutSpec
  activeSlot: { section: PrintChromeSection; slot: PrintChromeSlotPosition } | null
  onPrintOptionChange: (patch: Partial<TeachingDocumentPrintOptions>) => void
  onSlotChange: (section: PrintChromeSection, slot: PrintChromeSlotPosition, patch: Partial<PrintChromeSlot>) => void
  onApplyTemplate: (template: PrintChromeTemplate) => void
}) {
  const sectionTitle: Record<PrintChromeSection, string> = { header: '页眉', footer: '页脚' }
  const [templates, setTemplates] = useState<PrintChromeTemplate[]>([])
  const [templateName, setTemplateName] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [templateBusy, setTemplateBusy] = useState(false)
  useEffect(() => { void teachingDocumentsApi.listPrintTemplates().then((response) => setTemplates(response.items)).catch(() => setTemplates([])) }, [])
  async function saveTemplate() {
    const options = {
      headerEnabled: props.printLayout.header.enabled,
      headerShowOnFirstPage: props.printLayout.header.showOnFirstPage,
      footerEnabled: props.printLayout.footer.enabled,
      header: props.printLayout.header.slots,
      footer: props.printLayout.footer.slots,
      pageNumber: props.printLayout.pageNumber,
    }
    const template = selectedTemplateId
      ? await teachingDocumentsApi.updatePrintTemplate(selectedTemplateId, { name: templateName, options })
      : await teachingDocumentsApi.createPrintTemplate({ name: templateName, options })
    setTemplates((current) => selectedTemplateId ? current.map((item) => item.id === template.id ? template : item) : [template, ...current])
    setSelectedTemplateId(template.id)
    setTemplateName(template.name)
  }
  async function removeTemplate() {
    if (!selectedTemplateId) return
    await teachingDocumentsApi.deletePrintTemplate(selectedTemplateId)
    setTemplates((current) => current.filter((item) => item.id !== selectedTemplateId))
    setSelectedTemplateId('')
    setTemplateName('')
  }
  function exportTemplates() {
    const payload = JSON.stringify({ version: 1, templates: templates.map(({ name, options }) => ({ name, options })) }, null, 2)
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = '页眉页脚模板.json'; anchor.click(); URL.revokeObjectURL(url)
  }
  async function importTemplates(file: File | undefined) {
    if (!file) return
    setTemplateBusy(true)
    try {
      const parsed = JSON.parse(await file.text()) as { templates?: Array<{ name?: unknown; options?: unknown }> }
      const incoming = Array.isArray(parsed.templates) ? parsed.templates : []
      const created: PrintChromeTemplate[] = []
      for (const item of incoming) {
        if (typeof item.name !== 'string' || !item.name.trim() || !item.options || typeof item.options !== 'object' || Array.isArray(item.options)) continue
        created.push(await teachingDocumentsApi.createPrintTemplate({ name: item.name, options: item.options as PrintChromeTemplate['options'] }))
      }
      setTemplates((current) => [...created, ...current])
    } catch {
      window.alert('模板文件无效，未能导入。')
    } finally { setTemplateBusy(false) }
  }
  return (
    <div className="space-y-4">

      <div className="grid grid-cols-2 gap-2 border-y border-zinc-100 py-3 text-[11px] dark:border-zinc-800">
        <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200"><input type="checkbox" className="size-3.5" checked={props.printLayout.header.enabled} onChange={(event) => props.onPrintOptionChange({ headerEnabled: event.target.checked })} />显示页眉</label>
        <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200"><input type="checkbox" className="size-3.5" checked={props.printLayout.header.showOnFirstPage} onChange={(event) => props.onPrintOptionChange({ headerShowOnFirstPage: event.target.checked })} />首页显示页眉</label>
        <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200"><input type="checkbox" className="size-3.5" checked={props.printLayout.footer.enabled} onChange={(event) => props.onPrintOptionChange({ footerEnabled: event.target.checked })} />显示页脚</label>
      </div>

      <div className="mt-3 rounded-md border border-dashed border-zinc-200 p-2.5 dark:border-zinc-700">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">页眉页脚模板</p>
          <span className="text-[10px] text-zinc-400">本机复用</span>
        </div>
        <div className="flex gap-1.5">
          <select aria-label="选择页眉页脚模板" value={selectedTemplateId} onChange={(event) => { const id = event.target.value; setSelectedTemplateId(id); const item = templates.find((template) => template.id === id); setTemplateName(item?.name || '') }} className="h-7 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-1.5 text-[11px] dark:border-zinc-700 dark:bg-zinc-950">
            <option value="">选择模板…</option>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
          <button type="button" className="h-7 rounded-md border border-zinc-200 px-2 text-[11px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800" disabled={!selectedTemplateId} onClick={() => { const item = templates.find((template) => template.id === selectedTemplateId); if (item) props.onApplyTemplate(item) }}>应用</button>
          <button type="button" title="删除模板" className="h-7 rounded-md border border-red-200 px-2 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-40" disabled={!selectedTemplateId} onClick={() => void removeTemplate()}>删除</button>
        </div>
        <div className="mt-2 flex gap-1.5">
          <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="模板名称" className="h-7 min-w-0 flex-1 rounded-md border border-zinc-200 px-2 text-[11px] dark:border-zinc-700 dark:bg-zinc-950" />
          <button type="button" className="h-7 rounded-md bg-zinc-900 px-2.5 text-[11px] text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900" onClick={() => void saveTemplate()}>{selectedTemplateId ? '更新模板' : '保存模板'}</button>
        </div>
        <div className="mt-2 flex items-center gap-1.5 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          <button type="button" title="导出模板包" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={exportTemplates}><Download className="size-3.5" />导出</button>
          <label title="导入模板包" className={`inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${templateBusy ? 'pointer-events-none opacity-40' : ''}`}><FileUp className="size-3.5" />导入<input type="file" accept="application/json,.json" className="sr-only" disabled={templateBusy} onChange={(event) => { void importTemplates(event.target.files?.[0]); event.currentTarget.value = '' }} /></label>
          <span className="ml-auto text-[10px] text-zinc-400">可在其他设备导入</span>
        </div>
      </div>

      {(['header', 'footer'] as PrintChromeSection[]).map((section) => (
        <div key={section} className="mt-4">
          <p className="mb-2 text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">{sectionTitle[section]}三栏</p>
          <div className="space-y-2">
            {(['left', 'center', 'right'] as PrintChromeSlotPosition[]).map((position) => {
              const slot = props.printLayout[section].slots[position]
              const active = props.activeSlot?.section === section && props.activeSlot.slot === position
              const positionLabel = { left: '左', center: '中', right: '右' }[position]
              return (
                <div key={position} className={`grid grid-cols-[32px_minmax(0,1fr)_76px] gap-2 rounded-md p-1.5 ${active ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}>
                  <span className="self-center text-[11px] text-zinc-500">{positionLabel}</span>
                  <div className="space-y-1">
                    <select value={slot.type} onChange={(event) => props.onSlotChange(section, position, { type: event.target.value as PrintChromeContentType })} className="h-7 w-full rounded-md border border-zinc-200 bg-white px-1.5 text-[11px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
                      {CHROME_CONTENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    {slot.type === 'customText' ? <input value={slot.text ?? ''} onChange={(event) => props.onSlotChange(section, position, { text: event.target.value })} placeholder="输入文字" className="h-7 w-full rounded-md border border-zinc-200 bg-white px-1.5 text-[11px] text-zinc-700 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200" /> : null}
                    <div className="grid grid-cols-[minmax(0,1fr)_58px_auto_auto] gap-1">
                      <select aria-label={`${sectionTitle[section]}${positionLabel}栏字体`} value={slot.font ?? 'inherit'} onChange={(event) => props.onSlotChange(section, position, { font: event.target.value as PrintChromeSlot['font'] })} className="h-7 min-w-0 rounded-md border border-zinc-200 bg-white px-1.5 text-[11px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
                        {CHROME_FONT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                      </select>
                      <select aria-label={`${sectionTitle[section]}${positionLabel}栏字号`} value={slot.fontSize ?? 9} onChange={(event) => props.onSlotChange(section, position, { fontSize: Number(event.target.value) as PrintChromeSlot['fontSize'] })} className="h-7 rounded-md border border-zinc-200 bg-white px-1 text-[11px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
                        {CHROME_FONT_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}px</option>)}
                      </select>
                      <button type="button" title="粗体" aria-label={`${sectionTitle[section]}${positionLabel}栏粗体`} aria-pressed={Boolean(slot.bold)} onClick={() => props.onSlotChange(section, position, { bold: !slot.bold })} className={`flex size-7 items-center justify-center rounded-md border text-zinc-600 transition-colors dark:border-zinc-700 dark:text-zinc-300 ${slot.bold ? 'border-zinc-400 bg-zinc-100 text-zinc-950 dark:bg-zinc-700 dark:text-zinc-50' : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-800'}`}><Bold className="size-3.5" /></button>
                      <button type="button" title="斜体" aria-label={`${sectionTitle[section]}${positionLabel}栏斜体`} aria-pressed={Boolean(slot.italic)} onClick={() => props.onSlotChange(section, position, { italic: !slot.italic })} className={`flex size-7 items-center justify-center rounded-md border text-zinc-600 transition-colors dark:border-zinc-700 dark:text-zinc-300 ${slot.italic ? 'border-zinc-400 bg-zinc-100 text-zinc-950 dark:bg-zinc-700 dark:text-zinc-50' : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-800'}`}><Italic className="size-3.5" /></button>
                    </div>
                  </div>
                  <select value={slot.align ?? position} onChange={(event) => props.onSlotChange(section, position, { align: event.target.value as PrintChromeSlot['align'] })} className="h-7 self-start rounded-md border border-zinc-200 bg-white px-1 text-[11px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
                    <option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option>
                  </select>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <p className="mb-2 text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">页码格式</p>
        <div className="grid grid-cols-2 gap-2">
          <select value={props.printLayout.pageNumber.format} onChange={(event) => props.onPrintOptionChange({ pageNumber: { ...props.printLayout.pageNumber, format: event.target.value as typeof props.printLayout.pageNumber.format } })} className="h-7 rounded-md border border-zinc-200 bg-white px-1.5 text-[11px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
            {PAGE_NUMBER_FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-[11px] text-zinc-700 dark:text-zinc-200"><input type="checkbox" className="size-3.5" checked={props.printLayout.pageNumber.showTotalPages} onChange={(event) => props.onPrintOptionChange({ pageNumber: { ...props.printLayout.pageNumber, showTotalPages: event.target.checked } })} />显示总页数</label>
          <input value={props.printLayout.pageNumber.prefix} onChange={(event) => props.onPrintOptionChange({ pageNumber: { ...props.printLayout.pageNumber, prefix: event.target.value } })} placeholder="页码前缀" className="h-7 rounded-md border border-zinc-200 bg-white px-1.5 text-[11px] text-zinc-700 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200" />
          <input value={props.printLayout.pageNumber.suffix} onChange={(event) => props.onPrintOptionChange({ pageNumber: { ...props.printLayout.pageNumber, suffix: event.target.value } })} placeholder="页码后缀" className="h-7 rounded-md border border-zinc-200 bg-white px-1.5 text-[11px] text-zinc-700 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200" />
        </div>
      </div>
    </div>
  )
}

function PaperSettingsControl({
  paper,
  marginPreset,
  style,
  onChange,
}: {
  paper: PaperSpec
  marginPreset: TeachingMarginPreset
  style?: TeachingDocumentStyle
  onChange: (patch: Partial<TeachingDocumentStyle>) => void
}) {
  const updateMargins = (key: 'topMm' | 'rightMm' | 'bottomMm' | 'leftMm', value: number) => {
    onChange({
      paper: {
        ...style?.paper,
        margins: {
          topMm: style?.paper?.margins?.topMm ?? paper.marginTopMm,
          rightMm: style?.paper?.margins?.rightMm ?? paper.marginRightMm,
          bottomMm: style?.paper?.margins?.bottomMm ?? paper.marginBottomMm,
          leftMm: style?.paper?.margins?.leftMm ?? paper.marginLeftMm,
          [key]: Math.max(0, Number.isFinite(value) ? value : 0),
        },
      },
    })
  }

  const selectPreset = (preset: TeachingMarginPreset) => {
    const nextPaper = { ...style?.paper }
    delete nextPaper.margins
    onChange({ paper: nextPaper, marginPreset: preset })
  }

  return (
    <details className="relative">
      <summary className="inline-flex h-7 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-[11px] text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
        <span className="font-medium">{paper.size}</span>
        <span className="text-zinc-400">{paper.orientation === 'portrait' ? '纵向' : '横向'}</span>
      </summary>
      <div className="absolute right-0 top-9 z-50 w-64 space-y-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-zinc-500">纸张
            <select
              className={paperFieldClass}
              value={paper.size}
              onChange={(event) => onChange({ paper: { ...style?.paper, size: event.target.value as 'A3' | 'A4' } })}
            >
              <option value="A4">A4</option>
              <option value="A3">A3</option>
            </select>
          </label>
          <label className="text-[11px] text-zinc-500">方向
            <select
              className={paperFieldClass}
              value={paper.orientation}
              onChange={(event) => onChange({ paper: { ...style?.paper, orientation: event.target.value as 'portrait' | 'landscape' } })}
            >
              <option value="portrait">纵向</option>
              <option value="landscape">横向</option>
            </select>
          </label>
        </div>
        <label className="block text-[11px] text-zinc-500">边距预设
          <select className={paperFieldClass} value={style?.paper?.margins ? 'custom' : marginPreset} onChange={(event) => {
            if (event.target.value !== 'custom') selectPreset(event.target.value as TeachingMarginPreset)
          }}>
            <option value="compact">紧凑</option>
            <option value="normal">标准</option>
            <option value="relaxed">宽松</option>
            <option value="custom">自定义</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          {([
            ['topMm', '上'],
            ['rightMm', '右'],
            ['bottomMm', '下'],
            ['leftMm', '左'],
          ] as const).map(([key, label]) => (
            <label key={key} className="text-[11px] text-zinc-500">{label} mm
              <input
                className={paperFieldClass}
                type="number"
                min={0}
                max={100}
                step={1}
                value={paper[`margin${key.slice(0, 1).toUpperCase()}${key.slice(1, -2)}Mm` as 'marginTopMm' | 'marginRightMm' | 'marginBottomMm' | 'marginLeftMm']}
                onChange={(event) => updateMargins(key, Number(event.target.value))}
              />
            </label>
          ))}
        </div>
      </div>
    </details>
  )
}

const paperFieldClass = 'mt-1 h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100'

export default function TeachingDocumentEditorPage() {
  const { documentId = '' } = useParams()
  const navigate = useNavigate()
  const editor = useTeachingDocumentEditor(decodeURIComponent(documentId))
  const [selectedId, setSelectedId] = useState('')
  const [viewportBlockId, setViewportBlockId] = useState('')
  const [canvasScrollRoot, setCanvasScrollRoot] = useState<HTMLElement | null>(null)
  const [questionMap, setQuestionMap] = useState<Record<string, QuestionResolution>>({})
  // 连续流是正文撰写面：卡片正文以一个连续文本区编辑；页面编辑保留给版式核对。
  const [canvasMode, setCanvasMode] = useState<TeachingCanvasMode>('continuous')
  // 编辑画布实际模式：a4 打印预览期间画布保持挂载（隐藏）以保留编辑器与撤销历史。
  const [editCanvasMode, setEditCanvasMode] = useState<'continuous' | 'paginated'>('continuous')
  const sheetPaper = useMemo<PaperSpec>(
    () => resolveDocumentPaper(editor.document?.style),
    [editor.document?.style],
  )
  const paper = useMemo<PaperSpec>(() => logicalPagePaper(sheetPaper), [sheetPaper])
  const [viewZoom, setViewZoom] = useState(1)
  const [paginationState, setPaginationState] = useState<A4PaginationState | null>(null)
  const [printVariant, setPrintVariant] = useState<PdfExportVariant>('student')
  const [paginatedPageCount, setPaginatedPageCount] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  useEffect(() => {
    const count = canvasMode === 'a4'
      ? paginationState?.pagination?.pages.length || 1
      : canvasMode === 'paginated' ? paginatedPageCount : 1
    setCurrentPage((current) => Math.min(current, count))
  }, [canvasMode, paginatedPageCount, paginationState?.pagination?.pages.length])
  const [chromePanelOpen, setChromePanelOpen] = useState(false)
  const [chromePanelMounted, setChromePanelMounted] = useState(false)
  const [editingChromeSlot, setEditingChromeSlot] = useState<{ section: PrintChromeSection; slot: PrintChromeSlotPosition } | null>(null)
  useEffect(() => {
    if (chromePanelOpen) {
      setChromePanelMounted(true)
      return
    }
    const timer = window.setTimeout(() => setChromePanelMounted(false), 180)
    return () => window.clearTimeout(timer)
  }, [chromePanelOpen])
  const printLayout = useMemo<PrintLayoutSpec>(() => {
    return createDocumentPrintLayout(paper, editor.document?.style?.print)
  }, [paper, editor.document?.style?.print])
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [focusedCardEditor, setFocusedCardEditor] = useState<import('@tiptap/react').Editor | null>(null)
  const [lastFocusedCardEditor, setLastFocusedCardEditor] = useState<import('@tiptap/react').Editor | null>(null)
  const [editingQuestionBlockId, setEditingQuestionBlockId] = useState('')
  const [pickerTarget, setPickerTarget] = useState<{ blockId: string; boxId?: string } | null>(null)
  const [formulaBlockId, setFormulaBlockId] = useState('')
  useEffect(() => subscribeFocusedCardEditor((current) => {
    setFocusedCardEditor(current)
    if (current) setLastFocusedCardEditor(current)
  }), [])
  // 卡片内多选集合（Shift+点击对象累积）；批量操作条据此显示。
  const [multiSelect, setMultiSelect] = useState<{ boxId: string; childIds: string[] } | null>(null)
  useEffect(() => {
    const handleMultiSelect = (event: Event) => {
      const detail = (event as CustomEvent<BoxChildMultiSelectDetail>).detail
      if (!detail) return
      if (!detail.shift) {
        setMultiSelect(null)
        return
      }
      setMultiSelect((current) => {
        const base = current?.boxId === detail.parentBlockId ? current.childIds : []
        const next = base.includes(detail.blockId)
          ? base.filter((id) => id !== detail.blockId)
          : [...base, detail.blockId]
        return next.length ? { boxId: detail.parentBlockId, childIds: next } : null
      })
    }
    window.addEventListener(BOX_CHILD_MULTI_SELECT_EVENT, handleMultiSelect)
    return () => window.removeEventListener(BOX_CHILD_MULTI_SELECT_EVENT, handleMultiSelect)
  }, [])

  // 顶层对象多选集合（Ctrl/Cmd+点击顶层对象累积）；集合写入模块存储供
  // 文档级编辑器的多选环 decoration 读取。
  const [topLevelMultiSelect, setTopLevelMultiSelect] = useState<string[]>([])
  const topLevelMultiSelectRef = useRef<string[]>([])
  useEffect(() => {
    const handleTopLevelMultiSelect = (event: Event) => {
      const detail = (event as CustomEvent<TopLevelMultiSelectDetail>).detail
      if (!detail) return
      if (!detail.modifier) {
        topLevelMultiSelectRef.current = []
        setTopLevelMultiSelectIds([])
        setTopLevelMultiSelect([])
        return
      }
      const current = topLevelMultiSelectRef.current
      const next = current.includes(detail.blockId)
        ? current.filter((id) => id !== detail.blockId)
        : [...current, detail.blockId]
      topLevelMultiSelectRef.current = next
      setTopLevelMultiSelectIds(next)
      setTopLevelMultiSelect(next)
    }
    window.addEventListener(TOP_LEVEL_MULTI_SELECT_EVENT, handleTopLevelMultiSelect)
    return () => window.removeEventListener(TOP_LEVEL_MULTI_SELECT_EVENT, handleTopLevelMultiSelect)
  }, [])
  const [batchBlankEnabled, setBatchBlankEnabled] = useState(false)
  const [batchBlankHeightMm, setBatchBlankHeightMm] = useState(30)
  const [batchBlankSplitAcrossPages, setBatchBlankSplitAcrossPages] = useState(false)
  const documentFonts = useMemo(() => resolveDocumentFonts(editor.document?.style), [editor.document?.style])
  const questionSpacing = editor.document?.style?.questionSpacing || 'compact'
  const fontVars = useMemo(() => ({
    ...lectureFontCssVars(documentFonts.body, documentFonts.heading, documentFonts.bodyLatin, documentFonts.headingLatin, documentFonts.bodyNumber, documentFonts.headingNumber),
    ...teachingTypographyCssVars(editor.document?.style),
    '--td-question-gap': {
      compact: '6px',
      normal: '12px',
      relaxed: '18px',
    }[questionSpacing],
  }), [documentFonts, editor.document?.style, questionSpacing])
  const fontFaceCss = useMemo(
    () => lectureFontFaceCss(documentFonts.bodyLatin, documentFonts.bodyNumber, documentFonts.headingLatin, documentFonts.headingNumber),
    [documentFonts],
  )

  const questionIds = useMemo(() => {    const ids = new Set<string>()
    for (const block of editor.document?.content || []) {
      if (block.type === 'question' && block.questionId) ids.add(block.questionId)
      if (block.type === 'box') for (const child of block.children) if (child.type === 'question' && child.questionId) ids.add(child.questionId)
    }
    return [...ids]
  }, [editor.document])

  /** 选中位置索引：id → { block, topLevel, boxId }，随文档变化重建。 */
  const selectedLocationIndex = useMemo(
    () => editor.document ? buildSelectedLocationIndex(editor.document) : new Map<string, SelectedLocation>(),
    [editor.document],
  )
  const findSelected = useCallback(
    (id: string) => selectedLocationIndex.get(id) ?? null,
    [selectedLocationIndex],
  )

  useEffect(() => {
    const missing = questionIds.filter((id) => !questionMap[id])
    if (!missing.length) return
    setQuestionMap((current) => Object.fromEntries([
      ...Object.entries(current),
      ...missing.map((id) => [id, { status: 'loading' as const }]),
    ]))
    for (const id of missing) {
      questionBankApi.getItem(id)
        .then((question) => setQuestionMap((current) => ({ ...current, [id]: question })))
        .catch((error) => setQuestionMap((current) => ({
          ...current,
          [id]: error instanceof ApiError && error.status === 404
            ? { status: 'missing', message: `题目不存在（ID: ${id}）` }
            : { status: 'error', message: error instanceof Error ? error.message : String(error) },
        })))
    }
  }, [questionIds, questionMap])

  // resolver 与回调必须保持稳定引用：A4PaginationPreview 的测量 effect 依赖 resolveQuestion，
  // 若每次 render 重建，会形成 onPaginationState 回写父状态 → 父 render → resolver 引用变化
  // → effect 重跑 → measurement generation 无限增长的循环（实测 g15716 + resource-timeout）。
  // useCallback/useMemo 仅依赖真实数据源（questionMap/assetMap），题目或素材变化仍会正确触发重测。
  const assetMap = useMemo(
    () => new Map((editor.record?.assets ?? []).map((asset) => [asset.id, asset.url])),
    [editor.record?.assets],
  )
  const resolveQuestion = useCallback(
    (id: string) => questionMap[id] || { status: 'missing' as const, message: `题目不可用（ID: ${id || '未设置'}）` },
    [questionMap],
  )
  const resolveFigure = useCallback((asset: FigureAssetRef) => {
    if (asset.type === 'documentAsset') return assetMap.get(asset.assetId) || { status: 'missing' as const }
    if (asset.type === 'legacyPath') return asset.path ? assetUrl(asset.path) : { status: 'missing' as const }
    const question = questionMap[asset.questionId]
    if (!question || ('status' in question && question.status === 'loading')) return { status: 'loading' as const }
    if ('status' in question) return question.status === 'error'
      ? { status: 'error' as const, message: question.message }
      : { status: 'missing' as const, message: question.message }
    const figure = question.figures?.find((item) => String(item.id || item.blockId || '') === asset.figureId)
    return figure?.path ? assetUrl(figure.path) : { status: 'missing' as const }
  }, [assetMap, questionMap])
  const selectBlock = useCallback((blockId: string) => setSelectedId(blockId), [])

  // 键盘快捷键：[ 切换大纲
  // 注意：下方 `const document = editor.document` 会遮蔽全局 document，
  // 且 loading 提前返回时该绑定处于 TDZ，故 DOM 事件必须走 window.document。
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === '[' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLSelectElement) && !(event.target as HTMLElement)?.isContentEditable) {
        setOutlineOpen((value) => !value)
      }
    }
    window.document.addEventListener('keydown', handleKey)
    return () => window.document.removeEventListener('keydown', handleKey)
  }, [])

  // Esc：选中卡片内子块时上浮到父卡片（层级导航）；对话框打开时不劫持。
  const escapeToParentRef = useRef<(() => void) | null>(null)
  escapeToParentRef.current = () => {
    if (pickerTarget || formulaBlockId || editingQuestionBlockId) return
    if (selected?.boxId) selectAndShow(selected.topLevel.id)
  }
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
      escapeToParentRef.current?.()
    }
    window.document.addEventListener('keydown', handleEscape)
    return () => window.document.removeEventListener('keydown', handleEscape)
  }, [])

  // 中间画布的视口中心就是阅读位置。只更新大纲导航态，不修改编辑器选区，
  // 因而滚动阅读不会打断正在编辑的文字或弹出右侧属性面板。
  useEffect(() => {
    if (!canvasScrollRoot || !editor.document) return
    let frame = 0
    const updateCurrentPage = () => {
      const viewport = canvasScrollRoot.getBoundingClientRect()
      const pageCount = canvasMode === 'a4'
        ? paginationState?.pagination?.pages.length || 1
        : canvasMode === 'paginated' ? paginatedPageCount : 1
      let nextPage = 1

      if (canvasMode === 'a4') {
        const pageRects = Array.from(canvasScrollRoot.querySelectorAll<HTMLElement>('[data-teaching-page-index]'))
          .map((node) => ({
            page: Number(node.dataset.teachingPageIndex) + 1,
            rect: node.getBoundingClientRect(),
          }))
          .filter(({ page, rect }) => Number.isFinite(page) && rect.height > 0)
          .map(({ page, rect }) => ({ page, top: rect.top, bottom: rect.bottom }))
        nextPage = activePageFromPageRects(pageRects, viewport.top, viewport.bottom)
      } else if (canvasMode === 'paginated') {
        const transitions = Array.from(canvasScrollRoot.querySelectorAll<HTMLElement>('[data-page-number]'))
          .map((node) => {
            const rect = node.getBoundingClientRect()
            return { page: Number(node.dataset.pageNumber), top: rect.top, height: rect.height }
          })
          .filter(({ page, height }) => Number.isFinite(page) && height > 0)
        nextPage = activePageFromPageTransitions(transitions, viewport.top, viewport.bottom)
      }

      nextPage = Math.min(pageCount, Math.max(1, nextPage))
      setCurrentPage((current) => current === nextPage ? current : nextPage)
    }
    const updateActiveBlock = () => {
      frame = 0
      // A4 预览会隐藏编辑画布，不能依赖 data-block-id 来触发页码更新。
      updateCurrentPage()
      const viewport = canvasScrollRoot.getBoundingClientRect()
      const centerY = viewport.top + viewport.height / 2
      const candidates = Array.from(canvasScrollRoot.querySelectorAll<HTMLElement>('[data-block-id]'))
        .filter((node) => !node.closest('[data-teaching-measure-root]'))
        .map((node) => ({ node, rect: node.getBoundingClientRect() }))
        // 隐藏画布（a4 预览期间）与测量树内的块高度为 0，不参与视口判定
        .filter(({ rect }) => rect.height > 0 && rect.bottom >= viewport.top && rect.top <= viewport.bottom)
      if (!candidates.length) return
      const ranked = candidates
        .map(({ node, rect }) => ({
          id: node.dataset.blockId || '',
          // 中心落在块内时优先最小的块（卡片内段落优先于整张卡片）。
          containsCenter: rect.top <= centerY && rect.bottom >= centerY,
          height: Math.max(1, rect.height),
          distance: Math.abs((rect.top + rect.bottom) / 2 - centerY),
        }))
        .filter((item) => item.id)
        .sort((a, b) => (Number(b.containsCenter) - Number(a.containsCenter)) || (a.containsCenter ? a.height - b.height : a.distance - b.distance))
      const next = ranked[0]?.id || ''
      if (next) setViewportBlockId((current) => current === next ? current : next)
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(updateActiveBlock)
    }
    updateActiveBlock()
    canvasScrollRoot.addEventListener('scroll', schedule, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(canvasScrollRoot)
    return () => {
      canvasScrollRoot.removeEventListener('scroll', schedule)
      observer?.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [canvasMode, canvasScrollRoot, editor.document, paginatedPageCount, paginationState?.pagination?.pages.length])

  // 变体文档只服务于 a4 打印预览；连续流/页面编辑直接使用原始文档，避免无谓的整篇变换。
  const previewDocument = useMemo(
    () => canvasMode === 'a4' && editor.document ? documentForPrintVariant(editor.document, printVariant) : null,
    [canvasMode, editor.document, printVariant],
  )

  if (editor.loading) {
    return <div className="flex h-[60vh] items-center justify-center text-sm text-zinc-500"><LoaderCircle className="mr-2 size-4 animate-spin" />正在读取文档…</div>
  }
  if (!editor.document || !editor.record || !editor.history) {
    return <div className="rounded-lg border border-red-200 bg-red-50/30 p-4 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">{editor.loadError || '文档加载失败或不存在。'}</div>
  }

  const document = editor.document
  const resolvedPreviewDocument = previewDocument ?? document
  const marginPreset = document.style?.marginPreset ?? 'normal'
  const selected = findSelected(selectedId)
  const renderResourceVersion = questionIds
    .map((id) => {
      const resolution = questionMap[id]
      return `${id}:${!resolution ? 'pending' : 'status' in resolution ? resolution.status : resolution.updatedAt || resolution.contentRevision}`
    })
    .join('|')

  const selectedQuestionBlock = selected?.block.type === 'question' ? selected.block : null
  const selectedHeadingStyle = selected?.block.type === 'heading'
    ? resolveHeadingStyle(document.style, selected.block.level)
    : undefined
  const questionGlobalStyle = resolveQuestionStyle(document.style)

  function updateHeadingToolbarStyle(level: 1 | 2 | 3 | 4, patch: Partial<TeachingTextStyle>) {
    const current = document.style?.headingStyles?.[level]
    const next = mergeTextStyle(current, patch)
    const headingStyles = { ...(document.style?.headingStyles || {}) }
    if (next) headingStyles[level] = next
    else delete headingStyles[level]
    editor.dispatch({
      type: 'setStyle',
      patch: {
        headingStyles: Object.keys(headingStyles).length ? headingStyles : undefined,
        typographyPreset: undefined,
      },
      mergeKey: `heading-style:${level}`,
    })
  }

  function updateQuestionToolbarStyle(patch: Partial<TeachingTextStyle>, scope: 'question' | 'document') {
    if (scope === 'document') {
      editor.dispatch({
        type: 'setStyle',
        patch: {
          questionStyle: mergeTextStyle(document.style?.questionStyle, patch),
          typographyPreset: undefined,
        },
        mergeKey: 'question-style:document',
      })
      return
    }
    if (!selectedQuestionBlock) return
    const display = { ...(selectedQuestionBlock.display || {}) }
    const typography = mergeTextStyle(display.typography, patch)
    if (typography) display.typography = typography
    else delete display.typography
    updateSelected({ display }, `question-style:${selectedQuestionBlock.id}`)
  }

  function resetQuestionToolbarStyle() {
    if (!selectedQuestionBlock?.display?.typography) return
    const display = { ...(selectedQuestionBlock.display || {}) }
    delete display.typography
    updateSelected({ display }, `question-style:${selectedQuestionBlock.id}`)
  }

  function selectAndShow(blockId: string) {
    setSelectedId(blockId)
    // 任何普通单选变化都会清空顶层多选集合（Ctrl+点击不经过这里）
    topLevelMultiSelectRef.current = []
    setTopLevelMultiSelectIds([])
    setTopLevelMultiSelect([])
    // 顶层文本块点击即进入画布行内编辑，不自动弹出属性面板遮挡画布；
    // 其他类型保持自动弹出；浮动工具栏"属性"按钮与大纲点击仍显式打开。
    const target = findSelected(blockId)
    const isTopLevelText = Boolean(target && !target.boxId && (target.block.type === 'heading' || target.block.type === 'paragraph'))
    if (!isTopLevelText) setPropertiesOpen(true)
  }

  function selectFromOutline(blockId: string) {
    selectAndShow(blockId)
    // 滚动到对应块（注意：局部 document 为文档数据，DOM 查询须走 window.document）
    requestAnimationFrame(() => {
      window.document
        .querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  function updateSelected(patch: Partial<TeachingBlock>, mergeKey?: string) {
    if (!selected) return
    if (selected.boxId) editor.dispatch({ type: 'updateBoxChild', boxId: selected.boxId, childId: selected.block.id, patch: patch as Partial<BoxChildBlock>, mergeKey })
    else editor.dispatch({ type: 'updateBlock', blockId: selected.block.id, patch, mergeKey })
  }

  function updateSelectedTopLevel(patch: Partial<TeachingBlock>, mergeKey?: string) {
    if (!selected) return
    editor.dispatch({ type: 'updateBlock', blockId: selected.topLevel.id, patch, mergeKey })
  }

  async function insertImageInRawMarkdown(
    block: Extract<TeachingBlock, { type: 'rawMarkdown' }>,
    markdown: string,
    cursor: number,
    file: File,
    boxId?: string,
  ) {
    const asset = await editor.uploadAsset(file)
    const { blocks, figure } = blocksForRawMarkdownFigureInsertion(markdown, cursor, asset.id)
    if (boxId) {
      editor.dispatch({ type: 'replaceBoxChildWithBlocks', boxId, childId: block.id, blocks: blocks as BoxChildBlock[] })
    } else {
      editor.dispatch({ type: 'replaceBlockWithBlocks', blockId: block.id, blocks })
    }
    selectAndShow(figure.id)
    setPropertiesOpen(true)
  }

  function updatePrintOptions(patch: Partial<TeachingDocumentPrintOptions>) {
    editor.dispatch({
      type: 'setStyle',
      patch: { print: { ...document.style?.print, ...patch } },
      mergeKey: 'print-options',
    })
  }

  function applyChromeTemplate(template: PrintChromeTemplate) {
    updatePrintOptions(template.options)
  }

  function updateChromeSlot(section: PrintChromeSection, slot: PrintChromeSlotPosition, patch: Partial<PrintChromeSlot>) {
    const current = printLayout[section].slots[slot]
    updatePrintOptions({
      [section]: {
        ...document.style?.print?.[section],
        [slot]: { ...current, ...patch },
      },
    })
  }

  function openChromeSlot(section: PrintChromeSection, slot: PrintChromeSlotPosition) {
    setEditingChromeSlot({ section, slot })
    setChromePanelOpen(true)
  }

  function deleteSelected() {
    if (!selected) return
    const needsConfirm = selected.block.type === 'box'
      || selected.block.type === 'question'
      || selected.block.type === 'figure'
      || (selected.block.type === 'paragraph' && selected.block.content.some((inline) => inline.type !== 'text' || inline.text.trim()))
    if (needsConfirm && !window.confirm(`确定删除当前${USER_BLOCK_LABEL[selected.block.type]}？`)) return
    if (selected.boxId) editor.dispatch({ type: 'deleteBoxChild', boxId: selected.boxId, childId: selected.block.id })
    else editor.dispatch({ type: 'deleteBlock', blockId: selected.block.id })
    setSelectedId('')
    setPropertiesOpen(false)
  }

  function deleteBoxChildren(boxId: string, childIds: string[]) {
    if (!childIds.length) return false
    if (!window.confirm(`确定删除所选的 ${childIds.length} 项卡片内容？`)) return false
    editor.dispatch({ type: 'deleteBoxChildren', boxId, childIds })
    setSelectedId(boxId)
    setPropertiesOpen(true)
    return true
  }

  function inlineToMarkdown(inline: TeachingInline): string | null {
    if (inline.type === 'inlineMath') return `$${inline.latex}$`
    if (inline.type === 'hardBreak') return '\n'
    if (inline.type === 'unknown') return null
    if (inline.font || inline.color || inline.unknownMarks?.length) return null
    let value = inline.text
    for (const mark of inline.marks || []) {
      if (mark === 'bold') value = `**${value}**`
      else if (mark === 'italic') value = `*${value}*`
      else if (mark === 'underline') value = `<u>${value}</u>`
      else if (mark === 'strikethrough') value = `~~${value}~~`
      else if (mark === 'code') value = `\`${value}\``
    }
    return value
  }

  function mergeBoxParagraphs(boxId: string, childIds: string[]) {
    const box = document.content.find((block): block is BoxBlock => block.id === boxId && block.type === 'box')
    if (!box || childIds.length < 2) return false
    const selectedChildren = box.children.filter((child) => childIds.includes(child.id))
    const firstIndex = box.children.findIndex((child) => child.id === selectedChildren[0]?.id)
    const contiguous = selectedChildren.length === childIds.length
      && selectedChildren.every((child, index) => box.children[firstIndex + index]?.id === child.id)
    if (!contiguous || !selectedChildren.every((child): child is Extract<BoxChildBlock, { type: 'paragraph' }> => child.type === 'paragraph')) return false
    const markdownParts = selectedChildren.map((child) => {
      const parts = child.content.map(inlineToMarkdown)
      return parts.every((part): part is string => part != null) ? parts.join('') : null
    })
    if (markdownParts.some((part) => part == null)) return false
    if (!window.confirm(`确定将 ${selectedChildren.length} 个段落合并为一个“混合内容”块？`)) return false
    const replacement = { ...newTeachingBlock('rawMarkdown'), markdown: markdownParts.join('\n\n') } as Extract<BoxChildBlock, { type: 'rawMarkdown' }>
    editor.dispatch({ type: 'replaceBoxChildRange', boxId, childIds, replacement })
    setSelectedId(replacement.id)
    setPropertiesOpen(true)
    return true
  }

  function moveSelected(direction: -1 | 1) {
    if (!selected) return
    if (selected.boxId) editor.dispatch({ type: 'moveBoxChild', boxId: selected.boxId, childId: selected.block.id, direction })
    else if (selected.block.type === 'heading') editor.dispatch({ type: 'moveSectionByStep', headingId: selected.block.id, direction })
    else editor.dispatch({ type: 'moveBlock', blockId: selected.block.id, direction })
  }

  function insertBlock(type: TeachingBlock['type'], afterBlockId?: string, headingLevel?: HeadingLevel) {
    // 卡片流编辑器聚焦时，插入落在光标处（段落内自动拆段，文字环绕对象，
    // 与 Word 文本框一致）；章节/换页/嵌套卡片等非卡片类型仍走顶层插入。
    const cardEditor = afterBlockId ? null : getFocusedCardEditor()
    if (cardEditor && CARD_CHILD_TYPES.includes(type)) {
      const child = insertCardBlockAtCaret(cardEditor, type)
      if (!child) return
      selectAndShow(child.id)
      // 新建对象后立即给出可见的编辑入口
      setPropertiesOpen(true)
      if (type === 'blockMath') setFormulaBlockId(child.id)
      if (type === 'question') setPickerTarget({ blockId: child.id })
      return
    }
    const insertionAnchor = afterBlockId
      ?? editor.activeTopLevelBlockId()
      ?? selected?.topLevel.id
    const anchorIndex = insertionAnchor ? document.content.findIndex((item) => item.id === insertionAnchor) : document.content.length - 1
    const contextualHeading = document.content.slice(0, anchorIndex + 1).reverse().find((item) => item.type === 'heading')
    const resolvedHeadingLevel = headingLevel
      ?? (contextualHeading?.type === 'heading' ? contextualHeading.level : 1)
    const block = newTeachingBlock(type, type === 'heading' ? { headingLevel: resolvedHeadingLevel } : undefined)
    editor.dispatch({ type: 'insertBlock', block, afterBlockId: insertionAnchor })
    selectAndShow(block.id)
    // 新建对象后立即给出可见的编辑入口；即使是段落或章节，也不让用户再额外寻找属性面板。
    setPropertiesOpen(true)
    // 插入公式块自动弹出可视化公式编辑器（顶栏与块间菜单共用此入口）
    if (type === 'blockMath') setFormulaBlockId(block.id)
    // 插入题目块自动弹出题库筛选抽屉
    if (type === 'question') setPickerTarget({ blockId: block.id })
  }

  function insertBoxChild(type: BoxChildBlock['type'], boxId: string, afterChildId?: string) {
    const child = newTeachingBlock(type) as BoxChildBlock
    editor.dispatch({ type: 'insertBoxChild', boxId, child, afterChildId })
    setSelectedId(child.id)
    setPropertiesOpen(true)
    if (type === 'blockMath') setFormulaBlockId(child.id)
    if (type === 'question') setPickerTarget({ blockId: child.id, boxId })
  }

  function handlePickerPick(question: QuestionItem) {
    if (!pickerTarget) return
    const target = pickerTarget
    // 光标处插入的题目在挑选时可能尚未回写到 children；按选中时刻解析归属，
    // 避免 updateBlock 误伤卡片内题目。
    const location = findSelected(target.blockId)
    const mergeKey = `question-picker:${target.blockId}`
    if (location?.boxId) {
      editor.dispatch({
        type: 'updateBoxChild',
        boxId: location.boxId,
        childId: target.blockId,
        patch: { questionId: question.id },
        mergeKey,
      })
    } else {
      editor.dispatch({
        type: 'updateBlock',
        blockId: target.blockId,
        patch: { questionId: question.id },
        mergeKey,
      })
    }
    setQuestionMap((current) => ({ ...current, [question.id]: question }))
    setPickerTarget(null)
  }

  function patchQuestionBlock(location: SelectedLocation, patch: Partial<QuestionBlock>) {
    if (location.boxId) editor.dispatch({ type: 'updateBoxChild', boxId: location.boxId, childId: location.block.id, patch: patch as Partial<BoxChildBlock> })
    else editor.dispatch({ type: 'updateBlock', blockId: location.block.id, patch })
  }

  function applyBatchAnswerSpace(enabled: boolean, heightMm = batchBlankHeightMm, splitAcrossPages = batchBlankSplitAcrossPages) {
    const update = (block: QuestionBlock, boxId?: string) => {
      const question = questionMap[block.questionId]
      if (!question || 'status' in question || question.questionType !== '解答题') return
      const display = { ...block.display }
      if (enabled) display.answerSpace = { heightMm, style: display.answerSpace?.style || 'blank', splitAcrossPages }
      else delete display.answerSpace
      if (boxId) editor.dispatch({ type: 'updateBoxChild', boxId, childId: block.id, patch: { display }, mergeKey: 'batch-answer-space' })
      else editor.dispatch({ type: 'updateBlock', blockId: block.id, patch: { display }, mergeKey: 'batch-answer-space' })
    }
    for (const topLevel of document.content) {
      if (topLevel.type === 'question') update(topLevel)
      if (topLevel.type === 'box') for (const child of topLevel.children) if (child.type === 'question') update(child, topLevel.id)
    }
    setBatchBlankEnabled(enabled)
  }

  function openQuestionEditor(blockId: string) {
    const location = findSelected(blockId)
    if (!location || location.block.type !== 'question') return
    const resolution = questionMap[location.block.questionId]
    if (!resolution || 'status' in resolution) return
    setEditingQuestionBlockId(blockId)
  }

  const editingLocation = editingQuestionBlockId ? findSelected(editingQuestionBlockId) : null
  const editingBlock = editingLocation && editingLocation.block.type === 'question' ? editingLocation.block : null
  const editingResolution = editingBlock ? questionMap[editingBlock.questionId] : undefined
  const editingQuestion = editingResolution && !('status' in editingResolution) ? editingResolution : undefined

  const formulaLocation = formulaBlockId ? findSelected(formulaBlockId) : null
  const formulaBlock = formulaLocation && formulaLocation.block.type === 'blockMath' ? formulaLocation.block : null

  const selectedQuestionResolution = selected && selected.block.type === 'question' ? questionMap[selected.block.questionId] : undefined
  const editQuestionTargetId = selected && !selected.boxId && selected.block.type === 'question'
    && selectedQuestionResolution && !('status' in selectedQuestionResolution)
    ? selected.block.id
    : ''

  const typographyPreset = document.style?.typographyPreset
  const applyTypographyPreset = (preset: keyof typeof TYPOGRAPHY_PRESETS) => {
    editor.dispatch({ type: 'setStyle', patch: typographyStyleForPreset(preset) })
  }
  const applyCustomTypography = (patch: Partial<TeachingDocumentStyle>) => {
    editor.dispatch({ type: 'setStyle', patch: { ...patch, typographyPreset: undefined } })
  }

  const fontSettings = (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">排版预设</h3>
        <p className="mt-1 text-[11px] text-zinc-500">预设会一次设置字体、页边距和题目间距；继续手动调整后将显示为自定义。</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(Object.entries(TYPOGRAPHY_PRESETS) as Array<[keyof typeof TYPOGRAPHY_PRESETS, typeof TYPOGRAPHY_PRESETS[keyof typeof TYPOGRAPHY_PRESETS]]>).map(([preset, option]) => (
            <button
              key={preset}
              type="button"
              aria-pressed={typographyPreset === preset}
              onClick={() => applyTypographyPreset(preset)}
              className={`rounded-lg border p-3 text-left transition-colors ${typographyPreset === preset
                ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900/40'
                : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/30'}`}
            >
              <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{option.label}</span>
              <span className="mt-1 block text-[11px] leading-4 text-zinc-500">{option.description}</span>
            </button>
          ))}
        </div>
        {!typographyPreset ? <p className="mt-2 text-[11px] text-zinc-500">当前为自定义排版。</p> : null}
      </section>
      <section><h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">正文</h3><p className="mt-1 text-[11px] text-zinc-500">中文、英文和数字分别设置；数字字体覆盖阿拉伯数字。</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FontSelect label="中文字体" ariaLabel="正文中文字体" value={documentFonts.body.id} options={CJK_FONT_OPTIONS} onChange={(value) => applyCustomTypography({ bodyFont: value })} />
          <FontSelect label="英文字体" ariaLabel="正文英文字体" value={documentFonts.bodyLatin.id} options={LATIN_FONT_OPTIONS} onChange={(value) => applyCustomTypography({ bodyLatinFont: value })} />
          <FontSelect label="数字字体" ariaLabel="正文数字字体" value={documentFonts.bodyNumber.id} options={LATIN_FONT_OPTIONS} onChange={(value) => applyCustomTypography({ bodyNumberFont: value })} />
        </div>
      </section>
      <section className="border-t border-zinc-100 pt-5 dark:border-zinc-800"><h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">章节</h3><p className="mt-1 text-[11px] text-zinc-500">章节编号会跟随这里的数字字体。</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FontSelect label="中文字体" ariaLabel="章节中文字体" value={documentFonts.heading.id} options={CJK_FONT_OPTIONS} onChange={(value) => applyCustomTypography({ headingFont: value })} />
          <FontSelect label="英文字体" ariaLabel="章节英文字体" value={documentFonts.headingLatin.id} options={LATIN_FONT_OPTIONS} onChange={(value) => applyCustomTypography({ headingLatinFont: value })} />
          <FontSelect label="数字字体" ariaLabel="章节数字字体" value={documentFonts.headingNumber.id} options={LATIN_FONT_OPTIONS} onChange={(value) => applyCustomTypography({ headingNumberFont: value })} />
        </div>
      </section>
      <section className="border-t border-zinc-100 pt-5 dark:border-zinc-800"><h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">题目间距</h3>
        <select aria-label="题目间距" value={questionSpacing} onChange={(event) => applyCustomTypography({ questionSpacing: event.target.value as 'compact' | 'normal' | 'relaxed' })} className={paperFieldClass}>
          <option value="compact">紧凑</option><option value="normal">标准</option><option value="relaxed">宽松</option>
        </select>
      </section>
    </div>
  )

  const answerSettings = (
    <div className="space-y-5">
      <section><h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">解答题批量留空</h3><p className="mt-1 text-[11px] text-zinc-500">仅作用于当前文档中已加载的解答题。</p>
        <button type="button" onClick={() => applyBatchAnswerSpace(!batchBlankEnabled)} className={`mt-3 inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${batchBlankEnabled ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'border border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900'}`}>{batchBlankEnabled ? <Check className="size-3.5" /> : null}{batchBlankEnabled ? '已启用批量留空' : '启用批量留空'}</button>
      </section>
      {batchBlankEnabled ? <section className="border-t border-zinc-100 pt-5 dark:border-zinc-800"><label className="block text-[12px] font-medium text-zinc-700 dark:text-zinc-200">留空高度 {batchBlankHeightMm} mm<input className="mt-3 w-full" type="range" min={5} max={200} step={1} value={batchBlankHeightMm} onChange={(event) => setBatchBlankHeightMm(Number(event.target.value))} onPointerUp={(event) => applyBatchAnswerSpace(true, Number(event.currentTarget.value))} onKeyUp={(event) => applyBatchAnswerSpace(true, Number(event.currentTarget.value))} /></label><label className="mt-4 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300"><input type="checkbox" checked={batchBlankSplitAcrossPages} onChange={(event) => { const split = event.target.checked; setBatchBlankSplitAcrossPages(split); applyBatchAnswerSpace(true, batchBlankHeightMm, split) }} />跨页时不延续留空</label></section> : null}
    </div>
  )

  const pageCount = canvasMode === 'a4'
    ? paginationState?.pagination?.pages.length || 1
    : canvasMode === 'paginated' ? paginatedPageCount : 1
  const jumpToPage = (page: number) => {
    const targetPage = Math.min(pageCount, Math.max(1, page))
    setCurrentPage(targetPage)
    if (canvasMode === 'continuous') return
    const target = canvasMode === 'a4'
      ? window.document.querySelector<HTMLElement>(`[data-teaching-page-index="${targetPage - 1}"]`)
      : targetPage === 1
        ? window.document.querySelector<HTMLElement>('[data-teaching-page-content]')
        : window.document.querySelector<HTMLElement>(`[data-page-number="${targetPage}"]`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const selectPrintVariant = (variant: PdfExportVariant) => {
    setPrintVariant(variant)
    if (canvasMode !== 'a4') setCanvasMode('a4')
  }
  function deleteTopLevelMulti() {
    if (!topLevelMultiSelect.length) return
    if (!window.confirm(`确定删除所选的 ${topLevelMultiSelect.length} 个对象？`)) return
    editor.dispatch({ type: 'deleteBlocks', blockIds: topLevelMultiSelect })
    topLevelMultiSelectRef.current = []
    setTopLevelMultiSelectIds([])
    setTopLevelMultiSelect([])
  }

  // 顶层对象多选批量操作条（Ctrl/Cmd+点击对象累积集合）
  const topLevelMultiBar = topLevelMultiSelect.length ? (() => {
    const selected = topLevelMultiSelect
      .map((id) => document.content.find((block) => block.id === id))
      .filter((block): block is TeachingBlock => Boolean(block))
    if (!selected.length) return null
    const labels = selected.map((block) => USER_BLOCK_LABEL[block.type])
    return (
      <div className="pointer-events-none sticky bottom-20 z-20 flex justify-center pb-1">
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-sky-300/80 bg-white/95 py-1.5 pl-3.5 pr-1.5 text-[11px] shadow-lg shadow-sky-900/5 backdrop-blur-md dark:border-sky-800 dark:bg-zinc-900/95">
          <span className="text-zinc-700 dark:text-zinc-200">已选 {selected.length} 项{labels.length ? <span className="text-zinc-400 dark:text-zinc-400">（{labels.join('、')}）</span> : null}</span>
          <button
            type="button"
            onClick={deleteTopLevelMulti}
            className="h-7 rounded-full bg-red-600/10 px-2.5 font-medium text-red-700 transition-colors hover:bg-red-600/20 dark:bg-red-500/15 dark:text-red-400 dark:hover:bg-red-500/25"
          >
            删除
          </button>
          <button type="button" onClick={() => { topLevelMultiSelectRef.current = []; setTopLevelMultiSelectIds([]); setTopLevelMultiSelect([]) }} className="rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" title="取消多选">
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    )
  })() : null

  const quickControls = (
    <footer data-teaching-editor-quick-controls className="pointer-events-none absolute bottom-0 inset-x-0 z-20 shrink-0" aria-label="文档快捷操作">
      <div className="pointer-events-auto relative h-10 border-t border-zinc-200/50 bg-white/45 px-3 text-[11px] text-zinc-600 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur-md backdrop-saturate-180 dark:border-zinc-800/50 dark:bg-zinc-900/50 dark:text-zinc-300 dark:shadow-[0_-4px_16px_rgba(0,0,0,0.3)]">
        <div data-quick-controls-side="left" className="absolute inset-y-0 left-3 flex max-w-[calc(50%-5.5rem)] min-w-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex min-w-max items-center gap-1.5 pr-2">
            <span className="shrink-0 font-medium text-zinc-600 dark:text-zinc-300">{canvasMode === 'continuous' ? '连续流' : 'A4'}</span>
            <span className={`inline-flex shrink-0 items-center gap-1 font-medium ${editor.saveState === 'saved' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}><span className={`size-1.5 rounded-full ${editor.saveState === 'saved' ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]' : 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.4)]'}`} />{editor.saveState === 'saved' ? '已保存' : '待保存'}</span>
            <span className="mx-0.5 h-3 w-px shrink-0 bg-zinc-300/70 dark:bg-zinc-700/70" />
            <button type="button" onClick={() => applyBatchAnswerSpace(!batchBlankEnabled)} className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-all ${batchBlankEnabled ? 'bg-zinc-900 text-white shadow-xs dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-600 hover:bg-zinc-200/50 dark:text-zinc-300 dark:hover:bg-zinc-800/50'}`} title="对全部解答题批量设置或取消留空">{batchBlankEnabled ? <Check className="size-3.5" /> : null}解答题留空</button>
          </div>
        </div>

        <nav data-quick-controls-page-nav aria-label="页码导航" className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-lg border border-zinc-200/60 bg-white/50 p-0.5 shadow-xs backdrop-blur-md dark:border-zinc-700/60 dark:bg-zinc-800/60">
          <button type="button" aria-label="上一页" disabled={canvasMode === 'continuous' || currentPage <= 1} onClick={() => jumpToPage(currentPage - 1)} className="flex size-6 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-200/60 disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-700/60"><ChevronLeft className="size-3.5" /></button>
          <button type="button" onClick={() => jumpToPage(currentPage)} title={canvasMode === 'continuous' ? '连续流模式不分页' : '显示当前页'} className="min-w-14 rounded-md px-1.5 py-0.5 text-center text-[11px] font-medium tabular-nums text-zinc-700 transition-colors hover:bg-zinc-200/60 dark:text-zinc-200 dark:hover:bg-zinc-700/60">{currentPage} / {pageCount} 页</button>
          <button type="button" aria-label="下一页" disabled={canvasMode === 'continuous' || currentPage >= pageCount} onClick={() => jumpToPage(currentPage + 1)} className="flex size-6 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-200/60 disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-700/60"><ChevronRight className="size-3.5" /></button>
        </nav>

        <div data-quick-controls-side="right" className="absolute inset-y-0 right-3 flex max-w-[calc(50%-5.5rem)] min-w-0 items-center justify-end overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex min-w-max items-center justify-end gap-1.5 pl-2">
            <button type="button" onClick={() => setChromePanelOpen(true)} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-200/50 dark:text-zinc-300 dark:hover:bg-zinc-800/50"><Settings2 className="size-3.5" />页面设置</button>
            <span className="mx-0.5 h-3 w-px shrink-0 bg-zinc-300/70 dark:bg-zinc-700/70" />
            <div role="group" aria-label="打印版本" className="flex shrink-0 items-center gap-0.5 rounded-lg border border-zinc-200/50 bg-zinc-100/40 p-0.5 backdrop-blur-sm dark:border-zinc-700/40 dark:bg-zinc-800/40"><button type="button" aria-pressed={printVariant === 'student'} onClick={() => selectPrintVariant('student')} className={`h-5 rounded px-2 text-[10px] font-medium transition-all ${printVariant === 'student' ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}`}>学生版</button><button type="button" aria-pressed={printVariant === 'teacher'} onClick={() => selectPrintVariant('teacher')} className={`h-5 rounded px-2 text-[10px] font-medium transition-all ${printVariant === 'teacher' ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}`}>教师版</button></div>
            <ExportPdfPanel documentId={editor.record.id} revision={editor.record.revision} saveState={editor.saveState} hasRevisionConflict={Boolean(editor.conflict)} paginationState={paginationState} variant={printVariant} paper={sheetPaper} />
          </div>
        </div>
      </div>
    </footer>
  )

  // 卡片内多选批量操作条（Shift+点击对象累积集合）
  const multiSelectBar = multiSelect ? (() => {
    const box = document.content.find((block) => block.id === multiSelect.boxId && block.type === 'box') as BoxBlock | undefined
    if (!box) return null
    const labels = multiSelect.childIds
      .map((id) => {
        const child = box.children.find((item) => item.id === id)
        return child ? USER_BLOCK_LABEL[child.type] : ''
      })
      .filter(Boolean)
    return (
      <div className="pointer-events-none sticky bottom-20 z-20 flex justify-center pb-1">
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-sky-300/80 bg-white/95 py-1.5 pl-3.5 pr-1.5 text-[11px] shadow-lg shadow-sky-900/5 backdrop-blur-md dark:border-sky-800 dark:bg-zinc-900/95">
          <span className="text-zinc-700 dark:text-zinc-200">已选 {multiSelect.childIds.length} 项{labels.length ? <span className="text-zinc-400 dark:text-zinc-400">（{labels.join('、')}）</span> : null}</span>
          <button
            type="button"
            onClick={() => { if (deleteBoxChildren(multiSelect.boxId, multiSelect.childIds)) setMultiSelect(null) }}
            className="h-7 rounded-full bg-red-600/10 px-2.5 font-medium text-red-700 transition-colors hover:bg-red-600/20 dark:bg-red-500/15 dark:text-red-400 dark:hover:bg-red-500/25"
          >
            删除
          </button>
          <button
            type="button"
            onClick={() => { if (mergeBoxParagraphs(multiSelect.boxId, multiSelect.childIds)) setMultiSelect(null) }}
            className="h-7 rounded-full bg-zinc-100 px-2.5 font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            合并为混合内容
          </button>
          <button type="button" onClick={() => setMultiSelect(null)} className="rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" title="取消多选">
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    )
  })() : null

  return (
    <main className="-m-4 flex h-screen min-h-0 flex-col overflow-hidden border-t border-zinc-200 bg-white md:-m-6 dark:border-zinc-800 dark:bg-zinc-950">
      {fontFaceCss ? <style>{fontFaceCss}</style> : null}
      <EditorTopBar
        documentTitle={document.title}
        saveState={editor.saveState}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        canvasMode={canvasMode}
        zoom={viewZoom}
        onBack={() => {
          if (['dirty', 'saving', 'failed', 'conflict'].includes(editor.saveState) && !window.confirm('当前文档仍有未保存内容，确定离开吗？')) return
          navigate('/teaching-documents')
        }}
        onTitleChange={(title) => editor.dispatch({ type: 'setTitle', title, mergeKey: 'document-title' })}
        onUndo={editor.undo}
        onRedo={editor.redo}
        onCanvasModeChange={(mode) => {
          setCanvasMode(mode)
          // a4 预览是叠加层：编辑画布保持原模式挂载（隐藏），不销毁编辑器。
          if (mode !== 'a4') setEditCanvasMode(mode)
        }}
        onZoomChange={setViewZoom}
        onInsert={(type, headingLevel) => insertBlock(type, undefined, headingLevel)}
        paperActions={undefined}
      />

      <DocumentFormattingToolbar
        editor={focusedCardEditor ?? (selected?.boxId ? lastFocusedCardEditor : editor.activeEditor)}
        questionBlock={selectedQuestionBlock}
        questionGlobalStyle={questionGlobalStyle}
        onQuestionStyleChange={updateQuestionToolbarStyle}
        onQuestionStyleReset={resetQuestionToolbarStyle}
        headingStyle={selectedHeadingStyle}
        onHeadingStyleChange={updateHeadingToolbarStyle}
      />

      {editor.conflict ? (
        <div className="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50/60 px-4 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          <span className="flex items-center gap-2"><AlertTriangle className="size-4 shrink-0" />文档已在其他地方更新，自动保存已暂停。请重新加载最新版本。</span>
          <button type="button" onClick={() => void editor.reload()} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-red-200 px-2 font-medium transition-colors hover:bg-red-100 dark:border-red-900">
            <RefreshCcw className="size-3.5" />重新加载
          </button>
        </div>
      ) : editor.saveError ? (
        <div className="border-b border-red-200 bg-red-50/50 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">{editor.saveError}</div>
      ) : null}

      <div className="min-h-0 flex flex-1 overflow-hidden bg-zinc-50/80 dark:bg-zinc-950">
        <OutlinePanel
          variant="docked"
          open={outlineOpen}
          document={document}
          selectedId={selectedId}
          activeBlockId={viewportBlockId}
          issues={editor.validation.issues}
          onClose={() => setOutlineOpen(false)}
          onOpen={() => setOutlineOpen(true)}
          onSelect={selectFromOutline}
          onFixIds={() => editor.dispatch({ type: 'replaceDocument', document: migrateDocumentIds(document) })}
          onOutlineChange={(patch) => editor.dispatch({ type: 'setOutline', patch, mergeKey: 'outline-settings' })}
          onMoveSection={(headingId, direction) => editor.dispatch({ type: 'moveSectionByStep', headingId, direction })}
        />

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <section ref={setCanvasScrollRoot} className="min-h-0 flex-1 overflow-auto px-3 pb-16 pt-4 sm:px-5 sm:pb-16 sm:pt-7 md:px-9">
          {/* a4 打印预览（只读叠加层）；编辑画布在预览期间保持挂载（隐藏），
              编辑器与撤销历史不因预览被销毁。 */}
          <div className={canvasMode === 'a4' ? 'p-5' : 'hidden'}>
            <A4PaginationPreview
              document={resolvedPreviewDocument}
              resolveQuestion={resolveQuestion}
              resolveFigure={resolveFigure}
              paper={paper}
              sheetPaper={sheetPaper}
              printLayout={printLayout}
              fontVars={fontVars}
              zoom={viewZoom}
              selectedBlockId={selectedId}
              renderVersion={renderResourceVersion}
              active={canvasMode === 'a4'}
              onBlockSelect={selectBlock}
              onDiagnosticNavigate={(blockId) => {
                // 预览本身只读；修复需回到连续编辑并打开对应卡片的跨页设置。
                setCanvasMode('continuous')
                setEditCanvasMode('continuous')
                window.requestAnimationFrame(() => selectFromOutline(blockId))
              }}
              editingChromeSlot={editingChromeSlot}
              onChromeSlotEdit={openChromeSlot}
              onPaginationState={setPaginationState}
            />
          </div>
          <div className={canvasMode === 'a4' ? 'hidden' : ''} data-editing-canvas="">
            <TeachingDocumentCanvas
              document={document}
              paper={paper}
              printLayout={printLayout}
              fontVars={fontVars}
              zoom={viewZoom}
              renderVersion={renderResourceVersion}
              resolveQuestion={resolveQuestion}
              resolveFigure={resolveFigure}
              selectedId={selectedId}
              selectedTopLevelId={selected?.topLevel.id || ''}
              selectedIsBoxChild={Boolean(selected?.boxId)}
              onSelect={selectAndShow}
              onInsertAfter={(type, afterBlockId, headingLevel) => insertBlock(type, afterBlockId, headingLevel)}
              onInsertBoxChild={insertBoxChild}
              onMove={moveSelected}
              onDuplicate={() => { if (selected && !selected.boxId) editor.dispatch({ type: 'duplicateBlock', blockId: selected.block.id }) }}
              onDelete={deleteSelected}
              onOpenProperties={() => setPropertiesOpen(true)}
              onReorder={(order, mergeKey) => editor.dispatch({ type: 'reorderBlocks', order, mergeKey })}
              onMoveSection={(headingId, targetHeadingId, position, mergeKey) => editor.dispatch({ type: 'moveSection', headingId, targetHeadingId, position, mergeKey })}
              onEditQuestion={editQuestionTargetId ? () => setEditingQuestionBlockId(editQuestionTargetId) : undefined}
              onEditorChange={editor.handleEditorChange}
              onEditorDirty={editor.markEditorDirty}
              onEditorFlushReady={editor.registerEditorFlush}
              onEditorReady={editor.registerEditor}
              mode={editCanvasMode}
              totalPages={paginationState?.pagination?.pages.length || 1}
              onPageCountChange={setPaginatedPageCount}
              editingChromeSlot={editingChromeSlot}
              onChromeSlotEdit={openChromeSlot}
            />
          </div>
          {topLevelMultiBar ?? multiSelectBar}
        </section>

        {quickControls}

        <AnimatePresence>
          {chromePanelOpen && chromePanelMounted ? (
            <PageSettingsDrawer
              key="page-settings-drawer"
              open={chromePanelOpen}
              onClose={() => { setChromePanelOpen(false); setEditingChromeSlot(null) }}
              printSettings={<div className="space-y-5"><section><h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">纸张与边距</h3><div className="mt-2"><PaperSettingsControl paper={sheetPaper} marginPreset={marginPreset} style={document.style} onChange={applyCustomTypography} /></div></section><section className="border-t border-zinc-100 pt-5 dark:border-zinc-800"><ChromeSettingsPanel printLayout={printLayout} activeSlot={editingChromeSlot} onPrintOptionChange={updatePrintOptions} onSlotChange={updateChromeSlot} onApplyTemplate={applyChromeTemplate} /></section></div>}
              fontSettings={fontSettings}
              answerSettings={answerSettings}
            />
          ) : null}
        </AnimatePresence>

        {editingBlock && editingLocation && editingQuestion ? (
          <QuestionEditDialog
            block={editingBlock}
            question={editingQuestion}
            onClose={() => setEditingQuestionBlockId('')}
            onWrittenBack={(item) => {
              setQuestionMap((current) => ({ ...current, [item.id]: item }))
              patchQuestionBlock(editingLocation, { localContent: undefined })
              setEditingQuestionBlockId('')
            }}
            onFiguresChanged={(figures) => {
              setQuestionMap((current) => {
                const currentQuestion = current[editingQuestion.id]
                if (!currentQuestion || 'status' in currentQuestion) return current
                return {
                  ...current,
                  [editingQuestion.id]: {
                    ...currentQuestion,
                    figures,
                    hasFigures: figures.length > 0,
                  },
                }
              })
            }}
            onKeepLocal={(localContent) => {
              patchQuestionBlock(editingLocation, { localContent })
              setEditingQuestionBlockId('')
            }}
          />
        ) : null}

        {formulaBlock && formulaLocation ? (
          <FormulaEditorDialog
            title="编辑公式"
            displayMode
            initialLatex={formulaBlock.latex}
            onApplyMixedMarkdown={(markdown) => {
              const conversion = markdownToTeachingBlocks(markdown)
              if (!conversion.blocks.length) return
              const blocks = conversion.blocks.map((block, index) => index === 0
                ? { ...block, id: formulaBlock.id } as TeachingBlock
                : block)
              if (formulaLocation.boxId) {
                editor.dispatch({
                  type: 'replaceBoxChildWithBlocks',
                  boxId: formulaLocation.boxId,
                  childId: formulaBlock.id,
                  blocks: blocks as BoxChildBlock[],
                })
              } else {
                editor.dispatch({ type: 'replaceBlockWithBlocks', blockId: formulaBlock.id, blocks })
              }
              setFormulaBlockId('')
            }}
            onApply={(latex) => {
              if (formulaLocation.boxId) editor.dispatch({ type: 'updateBoxChild', boxId: formulaLocation.boxId, childId: formulaBlock.id, patch: { latex } as Partial<BoxChildBlock> })
              else editor.dispatch({ type: 'updateBlock', blockId: formulaBlock.id, patch: { latex } })
              setFormulaBlockId('')
            }}
            onClose={() => setFormulaBlockId('')}
          />
        ) : null}

        <QuestionPickerDrawer
          open={Boolean(pickerTarget)}
          onClose={() => setPickerTarget(null)}
          onPick={handlePickerPick}
          excludeIds={questionIds}
        />
      </div>

        <motion.aside
          data-teaching-properties-dock
          initial={false}
          animate={{ width: propertiesOpen && selected ? 300 : 0 }}
          transition={springPanel}
          className={`h-full shrink-0 overflow-hidden border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${propertiesOpen && selected ? 'w-[300px]' : 'w-0'}`}
        >
          <PropertiesSheet
            variant="docked"
            open={propertiesOpen}
            selected={selected}
            onClose={() => setPropertiesOpen(false)}
            onUpdate={updateSelected}
            onUpdateTopLevel={updateSelectedTopLevel}
            onDelete={deleteSelected}
            onDuplicate={() => selected && !selected.boxId && editor.dispatch({ type: 'duplicateBlock', blockId: selected.block.id })}
            onMove={moveSelected}
            onInsertChild={(box, type) => {
              insertBoxChild(type as BoxChildBlock['type'], box.id)
            }}
            onDeleteBoxChildren={deleteBoxChildren}
            onMergeBoxParagraphs={mergeBoxParagraphs}
            onSelect={setSelectedId}
            onUpload={editor.uploadAsset}
            onInsertImageInRawMarkdown={insertImageInRawMarkdown}
            onRenderTikz={editor.renderTikz}
            question={selectedQuestionResolution && !('status' in selectedQuestionResolution) ? selectedQuestionResolution : undefined}
            onQuestionLoaded={(question: QuestionItem) => setQuestionMap((current) => ({ ...current, [question.id]: question }))}
            onEditQuestion={openQuestionEditor}
            onOpenFormula={(blockId) => setFormulaBlockId(blockId)}
            onOpenQuestionPicker={(blockId, boxId) => setPickerTarget({ blockId, boxId })}
          />
        </motion.aside>
      </div>
    </main>
  )
}

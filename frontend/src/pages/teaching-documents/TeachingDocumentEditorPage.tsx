/**
 * 讲义编辑器页面（Focus Canvas 组装层）
 * 状态协调 + 布局骨架；具体 UI 委托给 components/ 子组件
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Bold, Italic, LoaderCircle, Minus, PanelLeft, Plus, RefreshCcw } from 'lucide-react'
import type { QuestionItem } from '@/types'
import type {
  BoxBlock,
  BoxChildBlock,
  FigureAssetRef,
  QuestionBlock,
  TeachingBlock,
  TeachingDocumentV1,
  TeachingMarginPreset,
  TeachingDocumentPrintOptions,
  TeachingDocumentStyle,
  PrintChromeContentType,
  PrintChromeSlot,
  PrintChromeSlotPosition,
} from '@/types/teachingDocument'
import { questionBankApi } from '@/api/questionBank'
import { ApiError } from '@/api/client'
import { A4PaginationPreview, type A4PaginationState } from '@/components/teaching-document/A4PaginationPreview'
import { PaginatedCanvas } from '@/components/teaching-document/editor'
import { ExportPdfPanel } from '@/components/teaching-document/ExportPdfPanel'
import { PrintChrome, type PrintChromeSection } from '@/components/teaching-document/PrintChrome'
import { type QuestionResolution } from '@/components/teaching-document/blocks/BlockRenderer'
import {
  MARGIN_PRESETS,
  resolveDocumentPaper,
  createDocumentPrintLayout,
  logicalPagePaper,
  migrateDocumentIds,
  newTeachingBlock,
  type PaperSpec,
  type PrintLayoutSpec,
} from '@/utils/teachingDocument'
import {
  BODY_FONT_OPTIONS,
  HEADING_FONT_OPTIONS,
  TEXT_FONT_OPTIONS,
  lectureFontCssVars,
  resolveDocumentFonts,
} from '@/utils/teachingDocument/lectureFonts'
import { assetUrl } from '@/utils/questionDisplay'
import { useTeachingDocumentEditor } from './useTeachingDocumentEditor'
import { EditorTopBar, type TeachingCanvasMode } from './components/EditorTopBar'
import { EditorCanvas } from './components/EditorCanvas'
import { OutlinePanel } from './components/OutlinePanel'
import { PropertiesSheet, type SelectedLocation } from './components/PropertiesSheet'
import { QuestionEditDialog } from './components/QuestionEditDialog'
import { QuestionPickerDrawer } from './components/QuestionPickerDrawer'
import { FormulaEditorDialog } from '@/components/questions/editor/FormulaEditorDialog'
import { USER_BLOCK_LABEL } from './components/blockLabels'
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

function findSelected(document: TeachingDocumentV1, id: string): SelectedLocation | null {
  for (const block of document.content) {
    if (block.id === id) return { block, topLevel: block }
    if (block.type === 'box') {
      const child = block.children.find((item) => item.id === id)
      if (child) return { block: child as TeachingBlock, topLevel: block, boxId: block.id }
    }
  }
  return null
}

function ChromeSettingsPanel(props: {
  printLayout: PrintLayoutSpec
  activeSlot: { section: PrintChromeSection; slot: PrintChromeSlotPosition } | null
  onClose: () => void
  onPrintOptionChange: (patch: Partial<TeachingDocumentPrintOptions>) => void
  onSlotChange: (section: PrintChromeSection, slot: PrintChromeSlotPosition, patch: Partial<PrintChromeSlot>) => void
}) {
  const sectionTitle: Record<PrintChromeSection, string> = { header: '页眉', footer: '页脚' }
  return (
    <div className="absolute right-5 top-4 z-30 w-[30rem] max-h-[calc(100%-2rem)] overflow-auto rounded-lg border border-zinc-200 bg-white p-4 shadow-xl shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/30">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">页眉页脚</p>
          <p className="text-[11px] text-zinc-500">整份文档同步更新，不按页保存</p>
        </div>
        <button type="button" onClick={props.onClose} className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">完成</button>
      </div>

      <div className="grid grid-cols-2 gap-2 border-y border-zinc-100 py-3 text-[11px] dark:border-zinc-800">
        <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200"><input type="checkbox" className="size-3.5" checked={props.printLayout.header.enabled} onChange={(event) => props.onPrintOptionChange({ headerEnabled: event.target.checked })} />显示页眉</label>
        <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200"><input type="checkbox" className="size-3.5" checked={props.printLayout.header.showOnFirstPage} onChange={(event) => props.onPrintOptionChange({ headerShowOnFirstPage: event.target.checked })} />首页显示页眉</label>
        <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200"><input type="checkbox" className="size-3.5" checked={props.printLayout.footer.enabled} onChange={(event) => props.onPrintOptionChange({ footerEnabled: event.target.checked })} />显示页脚</label>
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
  const [questionMap, setQuestionMap] = useState<Record<string, QuestionResolution>>({})
  const [canvasMode, setCanvasMode] = useState<TeachingCanvasMode>('paginated')
  const sheetPaper = useMemo<PaperSpec>(
    () => resolveDocumentPaper(editor.document?.style),
    [editor.document?.style],
  )
  const paper = useMemo<PaperSpec>(() => logicalPagePaper(sheetPaper), [sheetPaper])
  const [paperZoom, setPaperZoom] = useState(0.75)
  const [paginationState, setPaginationState] = useState<A4PaginationState | null>(null)
  const [chromePanelOpen, setChromePanelOpen] = useState(false)
  const [editingChromeSlot, setEditingChromeSlot] = useState<{ section: PrintChromeSection; slot: PrintChromeSlotPosition } | null>(null)
  const printLayout = useMemo<PrintLayoutSpec>(() => {
    return createDocumentPrintLayout(paper, editor.document?.style?.print)
  }, [paper, editor.document?.style?.print])
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [editingQuestionBlockId, setEditingQuestionBlockId] = useState('')
  const [pickerTarget, setPickerTarget] = useState<{ blockId: string } | null>(null)
  const [formulaBlockId, setFormulaBlockId] = useState('')
  const documentFonts = useMemo(() => resolveDocumentFonts(editor.document?.style), [editor.document?.style])
  const questionSpacing = editor.document?.style?.questionSpacing || 'compact'
  const fontVars = useMemo(() => ({
    ...lectureFontCssVars(documentFonts.body, documentFonts.heading),
    '--td-question-gap': {
      compact: '6px',
      normal: '12px',
      relaxed: '18px',
    }[questionSpacing],
  }), [documentFonts, questionSpacing])

  const questionIds = useMemo(() => {
    const ids = new Set<string>()
    for (const block of editor.document?.content || []) {
      if (block.type === 'question' && block.questionId) ids.add(block.questionId)
      if (block.type === 'box') for (const child of block.children) if (child.type === 'question' && child.questionId) ids.add(child.questionId)
    }
    return [...ids]
  }, [editor.document])

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

  if (editor.loading) {
    return <div className="flex h-[60vh] items-center justify-center text-sm text-zinc-500"><LoaderCircle className="mr-2 size-4 animate-spin" />正在读取文档…</div>
  }
  if (!editor.document || !editor.record || !editor.history) {
    return <div className="rounded-lg border border-red-200 bg-red-50/30 p-4 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">{editor.loadError || '文档加载失败或不存在。'}</div>
  }

  const document = editor.document
  const marginPreset = document.style?.marginPreset ?? 'normal'
  const selected = findSelected(document, selectedId)
  const renderResourceVersion = questionIds
    .map((id) => {
      const resolution = questionMap[id]
      return `${id}:${!resolution ? 'pending' : 'status' in resolution ? resolution.status : resolution.updatedAt || resolution.contentRevision}`
    })
    .join('|')

  function selectAndShow(blockId: string) {
    setSelectedId(blockId)
    // 顶层文本块点击即进入画布行内编辑，不自动弹出属性面板遮挡画布；
    // 其他类型保持自动弹出；浮动工具栏"属性"按钮与大纲点击仍显式打开。
    const target = findSelected(document, blockId)
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

  function updatePrintOptions(patch: Partial<TeachingDocumentPrintOptions>) {
    editor.dispatch({
      type: 'setStyle',
      patch: { print: { ...document.style?.print, ...patch } },
      mergeKey: 'print-options',
    })
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

  function moveSelected(direction: -1 | 1) {
    if (!selected) return
    if (selected.boxId) editor.dispatch({ type: 'moveBoxChild', boxId: selected.boxId, childId: selected.block.id, direction })
    else editor.dispatch({ type: 'moveBlock', blockId: selected.block.id, direction })
  }

  function insertBlock(type: TeachingBlock['type'], afterBlockId?: string) {
    const block = newTeachingBlock(type)
    const insertionAnchor = afterBlockId
      ?? editor.activeTopLevelBlockId()
      ?? selected?.topLevel.id
    editor.dispatch({ type: 'insertBlock', block, afterBlockId: insertionAnchor })
    selectAndShow(block.id)
    // 插入公式块自动弹出可视化公式编辑器（顶栏与块间菜单共用此入口）
    if (type === 'blockMath') setFormulaBlockId(block.id)
    // 插入题目块自动弹出题库筛选抽屉
    if (type === 'question') setPickerTarget({ blockId: block.id })
  }

  function handlePickerPick(question: QuestionItem) {
    if (!pickerTarget) return
    const target = pickerTarget
    editor.dispatch({ type: 'updateBlock', blockId: target.blockId, patch: { questionId: question.id } })
    setQuestionMap((current) => ({ ...current, [question.id]: question }))
    setPickerTarget(null)
  }

  function patchQuestionBlock(location: SelectedLocation, patch: Partial<QuestionBlock>) {
    if (location.boxId) editor.dispatch({ type: 'updateBoxChild', boxId: location.boxId, childId: location.block.id, patch: patch as Partial<BoxChildBlock> })
    else editor.dispatch({ type: 'updateBlock', blockId: location.block.id, patch })
  }

  function openQuestionEditor(blockId: string) {
    const location = findSelected(document, blockId)
    if (!location || location.block.type !== 'question') return
    const resolution = questionMap[location.block.questionId]
    if (!resolution || 'status' in resolution) return
    setEditingQuestionBlockId(blockId)
  }

  const editingLocation = editingQuestionBlockId ? findSelected(document, editingQuestionBlockId) : null
  const editingBlock = editingLocation && editingLocation.block.type === 'question' ? editingLocation.block : null
  const editingResolution = editingBlock ? questionMap[editingBlock.questionId] : undefined
  const editingQuestion = editingResolution && !('status' in editingResolution) ? editingResolution : undefined

  const formulaLocation = formulaBlockId ? findSelected(document, formulaBlockId) : null
  const formulaBlock = formulaLocation && formulaLocation.block.type === 'blockMath' ? formulaLocation.block : null

  const selectedQuestionResolution = selected && selected.block.type === 'question' ? questionMap[selected.block.questionId] : undefined
  const editQuestionTargetId = selected && !selected.boxId && selected.block.type === 'question'
    && selectedQuestionResolution && !('status' in selectedQuestionResolution)
    ? selected.block.id
    : ''

  // 字体控制条：分页编辑与连续流视图共用（存入文档 style，与打印共享）。
  const fontControls = (
    <div className="pointer-events-none sticky bottom-4 z-20 flex justify-center pb-1">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-zinc-200/80 bg-white/90 py-1.5 pl-3 pr-1.5 shadow-lg shadow-zinc-900/5 backdrop-blur-md dark:border-zinc-700/80 dark:bg-zinc-900/90 dark:shadow-black/20">
        <select
          aria-label="正文字体"
          value={documentFonts.body.id}
          onChange={(event) => editor.dispatch({ type: 'setStyle', patch: { bodyFont: event.target.value } })}
          className="h-7 max-w-28 cursor-pointer rounded-full border-0 bg-transparent px-1.5 text-[11px] text-zinc-600 outline-none transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {BODY_FONT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>正文·{option.label}</option>
          ))}
        </select>
        <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
        <select
          aria-label="标题字体"
          value={documentFonts.heading.id}
          onChange={(event) => editor.dispatch({ type: 'setStyle', patch: { headingFont: event.target.value } })}
          className="h-7 max-w-28 cursor-pointer rounded-full border-0 bg-transparent px-1.5 text-[11px] text-zinc-600 outline-none transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {HEADING_FONT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>标题·{option.label}</option>
          ))}
        </select>
        <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
        <select
          aria-label="题目间距"
          value={questionSpacing}
          onChange={(event) => editor.dispatch({ type: 'setStyle', patch: { questionSpacing: event.target.value as 'compact' | 'normal' | 'relaxed' } })}
          className="h-7 max-w-28 cursor-pointer rounded-full border-0 bg-transparent px-1.5 text-[11px] text-zinc-600 outline-none transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          title="调整相邻题目的垂直间距"
        >
          <option value="compact">题距·紧凑</option>
          <option value="normal">题距·标准</option>
          <option value="relaxed">题距·宽松</option>
        </select>
        <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
        <button type="button" onClick={() => setChromePanelOpen((value) => !value)} className="h-7 rounded-full px-2 text-[11px] text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">页眉页脚</button>
      </div>
    </div>
  )

  const paperActions = (
    <PaperSettingsControl
      paper={sheetPaper}
      marginPreset={marginPreset}
      style={document.style}
      onChange={(patch) => editor.dispatch({ type: 'setStyle', patch })}
    />
  )

  return (
    <main className="-m-4 flex h-screen flex-col overflow-hidden border-t border-zinc-200 bg-zinc-50/30 md:-m-6 dark:border-zinc-800 dark:bg-zinc-950">
      {/* 顶栏弹出控件（纸张设置、插入菜单）必须覆盖下方状态条与画布。 */}
      <div className="relative z-[60] flex items-center">
        <button
          type="button"
          onClick={() => setOutlineOpen((value) => !value)}
          className={`ml-2 rounded-md p-2 transition-colors ${outlineOpen ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900'}`}
          title="大纲"
        >
          <PanelLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <EditorTopBar
            documentTitle={document.title}
            saveState={editor.saveState}
            canUndo={editor.canUndo}
            canRedo={editor.canRedo}
            canvasMode={canvasMode}
            onBack={() => {
              if (['dirty', 'saving', 'failed', 'conflict'].includes(editor.saveState) && !window.confirm('当前文档仍有未保存内容，确定离开吗？')) return
              navigate('/teaching-documents')
            }}
            onTitleChange={(title) => editor.dispatch({ type: 'setTitle', title, mergeKey: 'document-title' })}
            onUndo={editor.undo}
            onRedo={editor.redo}
            onCanvasModeChange={setCanvasMode}
            onInsert={(type) => insertBlock(type)}
            paperActions={paperActions}
            printActions={canvasMode === 'a4' ? (
              <ExportPdfPanel
                documentId={editor.record.id}
                documentTitle={document.title}
                revision={editor.record.revision}
                saveState={editor.saveState}
                hasRevisionConflict={Boolean(editor.conflict)}
                paginationState={paginationState}
                paper={sheetPaper}
              />
            ) : undefined}
          />
        </div>
      </div>

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

      <div className="relative min-h-0 flex-1">
        <section className="h-full overflow-auto">
          {canvasMode === 'a4' ? (
            <div className="p-5">
              <A4PaginationPreview
                document={document}
                resolveQuestion={resolveQuestion}
                resolveFigure={resolveFigure}
                paper={paper}
                sheetPaper={sheetPaper}
                printLayout={printLayout}
                fontVars={fontVars}
                zoom={paperZoom}
                selectedBlockId={selectedId}
                renderVersion={renderResourceVersion}
                onBlockSelect={selectBlock}
                editingChromeSlot={editingChromeSlot}
                onChromeSlotEdit={openChromeSlot}
                onPaginationState={setPaginationState}
              />
              {/* 浮动预览控制条 */}
              <div className="pointer-events-none sticky bottom-4 z-20 flex flex-col items-center gap-2">
                <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-zinc-200/80 bg-white/90 py-1.5 pl-1.5 pr-3 shadow-lg shadow-zinc-900/5 backdrop-blur-md dark:border-zinc-700/80 dark:bg-zinc-900/90 dark:shadow-black/20">
                  <div className="flex items-center rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800">
                    {(Object.entries(MARGIN_PRESETS[sheetPaper.size === 'A3' ? 'A3' : 'A4']) as [string, unknown][]).map(([key]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => editor.dispatch({ type: 'setStyle', patch: { marginPreset: key as TeachingMarginPreset } })}
                        className={`h-7 rounded-full px-2.5 text-[11px] font-normal tracking-wide transition-colors ${
                          marginPreset === key
                            ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50'
                            : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                        }`}
                      >
                        {{ compact: '紧凑', normal: '标准', relaxed: '宽松' }[key] || key}
                      </button>
                    ))}
                  </div>
                  <span className="mx-1.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
                  <select
                    aria-label="题目间距"
                    value={questionSpacing}
                    onChange={(event) => editor.dispatch({ type: 'setStyle', patch: { questionSpacing: event.target.value as 'compact' | 'normal' | 'relaxed' } })}
                    className="h-7 cursor-pointer rounded-full border-0 bg-transparent px-2 text-[11px] text-zinc-600 outline-none transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    title="调整相邻题目的垂直间距"
                  >
                    <option value="compact">题距·紧凑</option>
                    <option value="normal">题距·标准</option>
                    <option value="relaxed">题距·宽松</option>
                  </select>
                  <span className="mx-1.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
                  <button
                    type="button"
                    onClick={() => setPaperZoom((zoom) => Math.max(0.45, Math.round((zoom - 0.05) * 100) / 100))}
                    className="flex size-7 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    title="缩小"
                  >
                    <Minus className="size-3.5" />
                  </button>
                  <input
                    className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-zinc-200 accent-zinc-900 dark:bg-zinc-700 dark:accent-zinc-100"
                    type="range"
                    min={45}
                    max={110}
                    step={5}
                    value={paperZoom * 100}
                    onChange={(event) => setPaperZoom(Number(event.target.value) / 100)}
                    aria-label="缩放比例"
                  />
                  <button
                    type="button"
                    onClick={() => setPaperZoom((zoom) => Math.min(1.1, Math.round((zoom + 0.05) * 100) / 100))}
                    className="flex size-7 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    title="放大"
                  >
                    <Plus className="size-3.5" />
                  </button>
                  <span className="w-9 text-center text-[11px] font-medium tabular-nums text-zinc-600 dark:text-zinc-300">
                    {Math.round(paperZoom * 100)}%
                  </span>
                  <span className="mx-1.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
                  <button
                    type="button"
                    onClick={() => setChromePanelOpen((value) => !value)}
                    className={`h-7 rounded-full px-2.5 text-[11px] font-normal tracking-wide transition-colors ${
                      chromePanelOpen
                        ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900'
                        : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
                    }`}
                    title="编辑页眉页脚"
                  >
                    页眉页脚
                  </button>
                </div>
              </div>
            </div>
          ) : canvasMode === 'paginated' ? (
            <div className="p-5">
              <PaginatedCanvas
                document={document}
                paper={paper}
                printLayout={printLayout}
                fontVars={fontVars}
                renderVersion={renderResourceVersion}
                resolveQuestion={resolveQuestion}
                resolveFigure={resolveFigure}
                selectedId={selectedId}
                selectedTopLevelId={selected?.topLevel.id || ''}
                selectedIsBoxChild={Boolean(selected?.boxId)}
                onSelect={selectAndShow}
                onInsertAfter={(type, afterBlockId) => insertBlock(type, afterBlockId)}
                onMove={moveSelected}
                onDuplicate={() => { if (selected && !selected.boxId) editor.dispatch({ type: 'duplicateBlock', blockId: selected.block.id }) }}
                onDelete={deleteSelected}
                onOpenProperties={() => setPropertiesOpen(true)}
                onEditQuestion={editQuestionTargetId ? () => setEditingQuestionBlockId(editQuestionTargetId) : undefined}
                onEditorChange={editor.handleEditorChange}
                onEditorReady={editor.registerEditor}
                editingChromeSlot={editingChromeSlot}
                onChromeSlotEdit={openChromeSlot}
              />
              {fontControls}
            </div>
          ) : (
            <>
            <div
              className="td-editor-fonts td-paper-page td-editor-chrome rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950 mx-auto my-5 max-w-3xl lg:max-w-4xl"
              style={fontVars as CSSProperties}
            >
              {printLayout.header.enabled ? <PrintChrome section="header" slots={printLayout.header.slots} documentTitle={document.title} documentType={document.documentType} pageNumber={1} totalPages={paginationState?.pagination?.pages.length || 1} printLayout={printLayout} activeSlot={editingChromeSlot?.section === 'header' ? editingChromeSlot.slot : undefined} onSlotEdit={openChromeSlot} /> : null}
              <div data-teaching-page-content="">
                <EditorCanvas
                  document={document}
                  selectedId={selectedId}
                  selectedTopLevelId={selected?.topLevel.id || ''}
                  selectedIsBoxChild={Boolean(selected?.boxId)}
                  resolveQuestion={resolveQuestion}
                  resolveFigure={resolveFigure}
                  onSelect={selectAndShow}
                  onEditContent={(blockId, content) => editor.dispatch({ type: 'updateBlock', blockId, patch: { content }, mergeKey: `text:${blockId}` })}
                  onEditBoxTitle={(boxId, title) => editor.dispatch({ type: 'updateBlock', blockId: boxId, patch: { title }, mergeKey: `box-title:${boxId}` })}
                  onInsertAfter={(type, afterBlockId) => insertBlock(type, afterBlockId)}
                  onMove={moveSelected}
                  onDuplicate={() => selected && !selected.boxId && editor.dispatch({ type: 'duplicateBlock', blockId: selected.block.id })}
                  onDelete={deleteSelected}
                  onOpenProperties={() => setPropertiesOpen(true)}
                  onReorder={(order, mergeKey) => editor.dispatch({ type: 'reorderBlocks', order, mergeKey })}
                  onEditQuestion={editQuestionTargetId ? () => setEditingQuestionBlockId(editQuestionTargetId) : undefined}
                  onEditorChange={editor.handleEditorChange}
                  onEditorReady={editor.registerEditor}
                />
              </div>
              {printLayout.footer.enabled ? <PrintChrome section="footer" slots={printLayout.footer.slots} documentTitle={document.title} documentType={document.documentType} pageNumber={1} totalPages={paginationState?.pagination?.pages.length || 1} printLayout={printLayout} activeSlot={editingChromeSlot?.section === 'footer' ? editingChromeSlot.slot : undefined} onSlotEdit={openChromeSlot} /> : null}
            </div>
            {/* 编辑视图独占：正文/标题字体（存入文档 style，与打印共享） */}
            {fontControls}
            </>
          )}
        </section>

        {chromePanelOpen ? (
          <ChromeSettingsPanel
            printLayout={printLayout}
            activeSlot={editingChromeSlot}
            onClose={() => { setChromePanelOpen(false); setEditingChromeSlot(null) }}
            onPrintOptionChange={updatePrintOptions}
            onSlotChange={updateChromeSlot}
          />
        ) : null}

        <OutlinePanel
          open={outlineOpen}
          document={document}
          selectedId={selectedId}
          issues={editor.validation.issues}
          onClose={() => setOutlineOpen(false)}
          onSelect={selectFromOutline}
          onFixIds={() => editor.dispatch({ type: 'replaceDocument', document: migrateDocumentIds(document) })}
        />

        <PropertiesSheet
          open={propertiesOpen && Boolean(selected)}
          selected={selected}
          onClose={() => setPropertiesOpen(false)}
          onUpdate={updateSelected}
          onDelete={deleteSelected}
          onDuplicate={() => selected && !selected.boxId && editor.dispatch({ type: 'duplicateBlock', blockId: selected.block.id })}
          onMove={moveSelected}
          onInsertChild={(box, type) => {
            const child = newTeachingBlock(type) as BoxChildBlock
            editor.dispatch({ type: 'insertBoxChild', boxId: box.id, child })
            setSelectedId(child.id)
            if (type === 'question') setPickerTarget({ blockId: child.id })
          }}
          onSelect={setSelectedId}
          onUpload={editor.uploadAsset}
          question={selectedQuestionResolution && !('status' in selectedQuestionResolution) ? selectedQuestionResolution : undefined}
          onQuestionLoaded={(question: QuestionItem) => setQuestionMap((current) => ({ ...current, [question.id]: question }))}
          onEditQuestion={openQuestionEditor}
          onOpenFormula={(blockId) => setFormulaBlockId(blockId)}
          onOpenQuestionPicker={(blockId) => setPickerTarget({ blockId })}
        />

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
    </main>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Box, Check, Copy, ImagePlus,
  FileText, LayoutTemplate, LoaderCircle, Plus, Redo2, RefreshCcw, Save, Trash2, Undo2,
} from 'lucide-react'
import type { QuestionItem } from '@/types'
import type {
  BoxBlock,
  BoxChildBlock,
  FigureAssetRef,
  TeachingBlock,
  TeachingDocumentV1,
} from '@/types/teachingDocument'
import { questionBankApi } from '@/api/questionBank'
import { ApiError } from '@/api/client'
import { A4PaginationPreview, type A4PaginationState } from '@/components/teaching-document/A4PaginationPreview'
import { ExportPdfPanel } from '@/components/teaching-document/ExportPdfPanel'
import { BlockRenderer, type QuestionResolution } from '@/components/teaching-document/blocks/BlockRenderer'
import {
  A4_MARGIN_PRESETS,
  BUILTIN_BOX_TEMPLATES,
  migrateDocumentIds,
  newTeachingBlock,
  type PaperSpec,
} from '@/utils/teachingDocument'
import { assetUrl } from '@/utils/questionDisplay'
import { useTeachingDocumentEditor } from './useTeachingDocumentEditor'
import '@/components/teaching-document/teaching-document.css'

const BLOCK_LABEL: Record<TeachingBlock['type'], string> = {
  heading: '标题',
  paragraph: '段落',
  blockMath: '块公式',
  figure: '图片',
  question: '题目',
  box: '盒子',
  divider: '分隔线',
  spacer: '留白',
  pageBreak: '分页标记',
  rawMarkdown: 'Markdown',
  unknown: '未知块',
}
const INSERTABLE: TeachingBlock['type'][] = [
  'heading', 'paragraph', 'blockMath', 'box', 'question', 'figure',
  'divider', 'spacer', 'pageBreak', 'rawMarkdown',
]
const BOX_CHILD_TYPES: BoxChildBlock['type'][] = ['paragraph', 'blockMath', 'question', 'figure', 'divider', 'spacer']
const ICONS = ['BookOpen', 'Lightbulb', 'PenLine', 'AlertTriangle', 'Pencil', 'ListChecks', 'Box']

type SelectedLocation = {
  block: TeachingBlock
  topLevel: TeachingBlock
  boxId?: string
}

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

function canEditInline(block: TeachingBlock) {
  if (block.type !== 'heading' && block.type !== 'paragraph') return false
  return block.content.length === 1
    && block.content[0].type === 'text'
    && !block.content[0].marks?.length
    && !block.content[0].unknownMarks?.length
}

export default function TeachingDocumentEditorPage() {
  const { documentId = '' } = useParams()
  const navigate = useNavigate()
  const editor = useTeachingDocumentEditor(decodeURIComponent(documentId))
  const [selectedId, setSelectedId] = useState('')
  const [insertType, setInsertType] = useState<TeachingBlock['type']>('paragraph')
  const [questionMap, setQuestionMap] = useState<Record<string, QuestionResolution>>({})
  const [canvasMode, setCanvasMode] = useState<'continuous' | 'a4'>('continuous')
  const [paper, setPaper] = useState<PaperSpec>(A4_MARGIN_PRESETS.normal)
  const [paperZoom, setPaperZoom] = useState(0.75)
  const [paginationState, setPaginationState] = useState<A4PaginationState | null>(null)

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

  if (editor.loading) return <div className="flex h-[60vh] items-center justify-center text-sm text-zinc-500"><LoaderCircle className="mr-2 size-4 animate-spin" />正在读取讲义文档…</div>
  if (!editor.document || !editor.record || !editor.history) {
    return <div className="rounded-lg border border-red-200 bg-red-50/30 p-4 text-sm text-red-700">{editor.loadError || '讲义文档加载失败或不存在。'}</div>
  }

  const document = editor.document
  const selected = findSelected(document, selectedId)
  const renderResourceVersion = questionIds
    .map((id) => {
      const resolution = questionMap[id]
      return `${id}:${!resolution ? 'pending' : 'status' in resolution ? resolution.status : resolution.updatedAt || resolution.contentRevision}`
    })
    .join('|')

  function updateSelected(patch: Partial<TeachingBlock>, mergeKey?: string) {
    if (!selected) return
    if (selected.boxId) editor.dispatch({ type: 'updateBoxChild', boxId: selected.boxId, childId: selected.block.id, patch: patch as Partial<BoxChildBlock>, mergeKey })
    else editor.dispatch({ type: 'updateBlock', blockId: selected.block.id, patch, mergeKey })
  }

  function deleteSelected() {
    if (!selected) return
    const needsConfirm = selected.block.type === 'box'
      || selected.block.type === 'question'
      || selected.block.type === 'figure'
      || (selected.block.type === 'paragraph' && selected.block.content.some((inline) => inline.type !== 'text' || inline.text.trim()))
    if (needsConfirm && !window.confirm(`确定删除当前${BLOCK_LABEL[selected.block.type]}块？`)) return
    if (selected.boxId) editor.dispatch({ type: 'deleteBoxChild', boxId: selected.boxId, childId: selected.block.id })
    else editor.dispatch({ type: 'deleteBlock', blockId: selected.block.id })
    setSelectedId('')
  }

  function selectFromCanvas(event: React.MouseEvent) {
    const target = event.target as HTMLElement
    const node = target.closest<HTMLElement>('[data-block-id]')
    if (node?.dataset.blockId) setSelectedId(node.dataset.blockId)
  }

  const saveLabel = {
    saved: '已保存',
    dirty: '未保存',
    saving: '正在保存',
    failed: '保存失败',
    conflict: '发生冲突',
  }[editor.saveState]

  return (
    <main className="-m-4 flex min-h-[calc(100vh-7.5rem)] flex-col overflow-hidden border-y border-zinc-200 bg-zinc-50/30 md:-m-6 dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex min-h-14 flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <button type="button" onClick={() => {
          if (['dirty', 'saving', 'failed', 'conflict'].includes(editor.saveState) && !window.confirm('当前文档仍有未保存内容，确定离开吗？')) return
          navigate('/teaching-documents')
        }} className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900" title="返回文档列表"><ArrowLeft className="size-4" /></button>
        <input
          value={document.title}
          onChange={(event) => editor.dispatch({ type: 'setTitle', title: event.target.value, mergeKey: 'document-title' })}
          className="h-9 min-w-48 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm font-semibold outline-none hover:border-zinc-200 focus:border-zinc-300 dark:hover:border-zinc-800"
          aria-label="文档标题"
        />
        <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
          editor.saveState === 'saved' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400'
            : editor.saveState === 'failed' || editor.saveState === 'conflict' ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400'
              : 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300'
        }`}>{editor.saveState === 'saving' ? <LoaderCircle className="size-3 animate-spin" /> : editor.saveState === 'saved' ? <Check className="size-3" /> : null}{saveLabel} · r{editor.record.revision}</span>
        <button type="button" disabled={!editor.history.past.length} onClick={editor.undo} className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-900" title="撤销"><Undo2 className="size-4" /></button>
        <button type="button" disabled={!editor.history.future.length} onClick={editor.redo} className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-900" title="重做"><Redo2 className="size-4" /></button>
        <select value={insertType} onChange={(event) => setInsertType(event.target.value as TeachingBlock['type'])} className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
          {INSERTABLE.map((type) => <option key={type} value={type}>{BLOCK_LABEL[type]}</option>)}
        </select>
        <button type="button" onClick={() => {
          const block = newTeachingBlock(insertType)
          editor.dispatch({ type: 'insertBlock', block, afterBlockId: selected?.topLevel.id })
          setSelectedId(block.id)
        }} className="inline-flex h-9 items-center gap-1 rounded-md border border-zinc-200 px-3 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"><Plus className="size-4" />插入</button>
        <button type="button" onClick={() => void editor.saveNow()} className="inline-flex h-9 items-center gap-1 rounded-md bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"><Save className="size-4" />保存</button>
      </header>

      {editor.conflict ? (
        <div className="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50/60 px-4 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          <span className="flex items-center gap-2"><AlertTriangle className="size-4" />文档已在其他位置更新：本地基于 revision {editor.conflict.expectedRevision}，服务端为 revision {editor.conflict.actualRevision}。自动保存已暂停。</span>
          <button type="button" onClick={() => void editor.reload()} className="inline-flex h-8 items-center gap-1 rounded-md border border-red-200 px-2 font-medium hover:bg-red-100 dark:border-red-900"><RefreshCcw className="size-3.5" />重新加载服务端版本</button>
        </div>
      ) : editor.saveError ? (
        <div className="border-b border-red-200 bg-red-50/50 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">{editor.saveError}</div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(420px,1fr)_300px]">
        <aside className="overflow-auto border-r border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">文档大纲</p>
          <div className="space-y-1">
            {document.content.map((block, index) => (
              <div key={`${block.id}:${index}`}>
                <button type="button" onClick={() => setSelectedId(block.id)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${selectedId === block.id ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900'}`}>
                  <span className="w-5 shrink-0 text-right font-mono text-[10px] opacity-60">{index + 1}</span><span className="truncate">{BLOCK_LABEL[block.type]}{block.type === 'box' && block.title ? ` · ${block.title}` : ''}</span>
                </button>
                {block.type === 'box' && block.children.length ? (
                  <div className="ml-7 border-l border-zinc-200 pl-1 dark:border-zinc-800">
                    {block.children.map((child) => (
                      <button key={child.id} type="button" onClick={() => setSelectedId(child.id)} className={`block w-full truncate rounded px-2 py-1 text-left text-[11px] ${selectedId === child.id ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900'}`}>{BLOCK_LABEL[child.type]}</button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {editor.validation.issues.length ? (
            <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <p className="px-2 text-[11px] font-semibold text-zinc-500">校验问题（{editor.validation.issues.length}）</p>
              {editor.validation.issues.slice(0, 8).map((issue, index) => <button key={`${issue.code}:${index}`} type="button" onClick={() => issue.blockId && setSelectedId(issue.blockId)} className={`mt-1 block w-full rounded px-2 py-1 text-left text-[10px] ${issue.level === 'error' ? 'text-red-600' : 'text-amber-700'}`}>{issue.message}</button>)}
              {editor.validation.issues.some((issue) => issue.code === 'auto-id') ? <button type="button" onClick={() => editor.dispatch({ type: 'replaceDocument', document: migrateDocumentIds(document) })} className="mt-2 w-full rounded-md border border-zinc-200 px-2 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-800">迁移自动 ID</button> : null}
            </div>
          ) : null}
        </aside>

        <section className="overflow-auto p-5">
          <div className="mx-auto mb-3 flex max-w-3xl flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="inline-flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
              <button type="button" onClick={() => setCanvasMode('continuous')} className={`inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] ${canvasMode === 'continuous' ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-500'}`}><FileText className="size-3.5" />连续画布</button>
              <button type="button" onClick={() => setCanvasMode('a4')} className={`inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] ${canvasMode === 'a4' ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-500'}`}><LayoutTemplate className="size-3.5" />A4 分页实验</button>
            </div>
            {canvasMode === 'a4' ? (
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-zinc-500">页边距
                  <select
                    className="ml-1 h-7 rounded border border-zinc-200 bg-white px-1 dark:border-zinc-800 dark:bg-zinc-950"
                    value={Object.entries(A4_MARGIN_PRESETS).find(([, value]) => value.marginTopMm === paper.marginTopMm && value.marginLeftMm === paper.marginLeftMm)?.[0] || 'normal'}
                    onChange={(event) => setPaper(A4_MARGIN_PRESETS[event.target.value as keyof typeof A4_MARGIN_PRESETS])}
                  >
                    <option value="compact">紧凑</option><option value="normal">标准</option><option value="relaxed">宽松</option>
                  </select>
                </label>
                <label className="text-[11px] text-zinc-500">缩放 {Math.round(paperZoom * 100)}%
                  <input className="ml-1 w-20 align-middle" type="range" min={45} max={110} step={5} value={paperZoom * 100} onChange={(event) => setPaperZoom(Number(event.target.value) / 100)} />
                </label>
              </div>
            ) : null}
          </div>
          {canvasMode === 'a4' ? (
            <>
            <A4PaginationPreview
              document={document}
              resolveQuestion={resolveQuestion}
              resolveFigure={resolveFigure}
              paper={paper}
              zoom={paperZoom}
              selectedBlockId={selectedId}
              renderVersion={renderResourceVersion}
              onBlockSelect={selectBlock}
              onPaginationState={setPaginationState}
            />
            <div className="mx-auto mt-3 max-w-3xl">
              <ExportPdfPanel
                documentId={editor.record.id}
                documentTitle={document.title}
                revision={editor.record.revision}
                saveState={editor.saveState}
                hasRevisionConflict={Boolean(editor.conflict)}
                paginationState={paginationState}
              />
            </div>
            </>
          ) : (
            <div className="mx-auto max-w-3xl rounded-xl border border-zinc-200 bg-white px-6 py-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <h1 className="mb-8 text-center text-2xl font-bold">{document.title}</h1>
              {document.content.map((block, index) => (
                <div
                  key={`${block.id}:${index}`}
                  onClick={selectFromCanvas}
                  className={`group relative rounded-md px-2 ring-offset-2 transition ${selected?.topLevel.id === block.id ? 'ring-2 ring-zinc-900 dark:ring-zinc-100' : 'hover:ring-1 hover:ring-zinc-300 dark:hover:ring-zinc-700'}`}
                >
                  <BlockRenderer block={block} resolvers={{ resolveQuestion, resolveFigure }} />
                </div>
              ))}
              {!document.content.length ? <div className="rounded-lg border border-dashed border-zinc-200 p-12 text-center text-sm text-zinc-400">文档为空，请从顶部插入内容块。</div> : null}
            </div>
          )}
        </section>

        <aside className="overflow-auto border-l border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <PropertiesPanel
            selected={selected}
            questionMap={questionMap}
            onQuestionLoaded={(question) => setQuestionMap((current) => ({ ...current, [question.id]: question }))}
            onUpdate={updateSelected}
            onDelete={deleteSelected}
            onDuplicate={() => selected && !selected.boxId && editor.dispatch({ type: 'duplicateBlock', blockId: selected.block.id })}
            onMove={(direction) => {
              if (!selected) return
              if (selected.boxId) editor.dispatch({ type: 'moveBoxChild', boxId: selected.boxId, childId: selected.block.id, direction })
              else editor.dispatch({ type: 'moveBlock', blockId: selected.block.id, direction })
            }}
            onInsertChild={(box, type) => {
              const child = newTeachingBlock(type) as BoxChildBlock
              editor.dispatch({ type: 'insertBoxChild', boxId: box.id, child })
              setSelectedId(child.id)
            }}
            onSelect={setSelectedId}
            onUpload={editor.uploadAsset}
          />
        </aside>
      </div>
    </main>
  )
}

function PropertiesPanel(props: {
  selected: SelectedLocation | null
  questionMap: Record<string, QuestionResolution>
  onQuestionLoaded: (question: QuestionItem) => void
  onUpdate: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
  onDelete: () => void
  onDuplicate: () => void
  onMove: (direction: -1 | 1) => void
  onInsertChild: (box: BoxBlock, type: BoxChildBlock['type']) => void
  onSelect: (id: string) => void
  onUpload: (file: File) => Promise<{ id: string }>
}) {
  const [questionQuery, setQuestionQuery] = useState('')
  const [questionResults, setQuestionResults] = useState<QuestionItem[]>([])
  const [searching, setSearching] = useState(false)
  const [uploading, setUploading] = useState(false)
  const selected = props.selected
  if (!selected) return <div className="flex h-full items-center justify-center text-center text-xs text-zinc-400">选择一个内容块以编辑属性。</div>
  const block = selected.block
  const fieldClass = 'mt-1 h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950'
  const areaClass = 'mt-1 min-h-24 w-full rounded-md border border-zinc-200 bg-white p-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950'

  async function searchQuestions() {
    setSearching(true)
    try {
      const response = await questionBankApi.listItems({ q: questionQuery, pageSize: 10 })
      setQuestionResults(response.items)
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><p className="text-sm font-semibold">{BLOCK_LABEL[block.type]}</p><p className="mt-0.5 max-w-44 truncate font-mono text-[10px] text-zinc-400">{block.id}</p></div>
        <div className="flex gap-0.5">
          <button type="button" onClick={() => props.onMove(-1)} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900" title="上移"><ArrowUp className="size-3.5" /></button>
          <button type="button" onClick={() => props.onMove(1)} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900" title="下移"><ArrowDown className="size-3.5" /></button>
          {!selected.boxId ? <button type="button" onClick={props.onDuplicate} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900" title="复制"><Copy className="size-3.5" /></button> : null}
          <button type="button" onClick={props.onDelete} className="rounded p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20" title="删除"><Trash2 className="size-3.5" /></button>
        </div>
      </div>

      {(block.type === 'heading' || block.type === 'paragraph') ? canEditInline(block) ? (
        <label className="block text-xs font-medium text-zinc-500">文字
          <textarea className={areaClass} value={block.content[0].type === 'text' ? block.content[0].text : ''} onChange={(event) => props.onUpdate({ content: [{ type: 'text', text: event.target.value }] }, `text:${block.id}`)} />
        </label>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">该文字块包含公式、marks 或未知行内数据，当前保持只读，避免编辑时丢失结构。</div>
      ) : null}
      {block.type === 'heading' ? <label className="block text-xs font-medium text-zinc-500">标题级别<select className={fieldClass} value={block.level} onChange={(event) => props.onUpdate({ level: Number(event.target.value) as 1 | 2 | 3 | 4 })}>{[1, 2, 3, 4].map((level) => <option key={level} value={level}>H{level}</option>)}</select></label> : null}
      {block.type === 'blockMath' ? <>
        <label className="block text-xs font-medium text-zinc-500">LaTeX<textarea className={areaClass} value={block.latex} onChange={(event) => props.onUpdate({ latex: event.target.value }, `math:${block.id}`)} /></label>
        <label className="block text-xs font-medium text-zinc-500">编号<input className={fieldClass} value={block.label || ''} onChange={(event) => props.onUpdate({ label: event.target.value }, `math-label:${block.id}`)} /></label>
      </> : null}
      {block.type === 'rawMarkdown' ? <label className="block text-xs font-medium text-zinc-500">Markdown<textarea className={areaClass} value={block.markdown} onChange={(event) => props.onUpdate({ markdown: event.target.value }, `markdown:${block.id}`)} /></label> : null}
      {block.type === 'spacer' ? <label className="block text-xs font-medium text-zinc-500">高度（em）<input type="number" min={0.5} max={8} step={0.5} className={fieldClass} value={block.heightEm} onChange={(event) => props.onUpdate({ heightEm: Number(event.target.value) })} /></label> : null}
      {block.type === 'box' ? <>
        <label className="block text-xs font-medium text-zinc-500">模板<select className={fieldClass} value={block.templateId} onChange={(event) => props.onUpdate({ templateId: event.target.value })}>{BUILTIN_BOX_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}</select></label>
        <label className="block text-xs font-medium text-zinc-500">标题<input className={fieldClass} value={block.title || ''} onChange={(event) => props.onUpdate({ title: event.target.value }, `box-title:${block.id}`)} /></label>
        <label className="block text-xs font-medium text-zinc-500">语义图标<select className={fieldClass} value={block.icon || ''} onChange={(event) => props.onUpdate({ icon: event.target.value || undefined })}><option value="">跟随模板</option>{ICONS.map((icon) => <option key={icon} value={icon}>{icon}</option>)}</select></label>
        <label className="block text-xs font-medium text-zinc-500">断开行为<select className={fieldClass} value={block.breakBehavior} onChange={(event) => props.onUpdate({ breakBehavior: event.target.value as BoxBlock['breakBehavior'] })}><option value="auto">自动</option><option value="avoid">尽量不断开</option><option value="allow">允许按子块拆分（实验）</option><option value="force-before">块前强制断开</option></select></label>
        <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <p className="text-xs font-medium text-zinc-500">盒子子块</p>
          <div className="mt-2 space-y-1">{block.children.map((child, index) => <button key={child.id} type="button" onClick={() => props.onSelect(child.id)} className="flex w-full items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-left text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"><span className="text-[10px] text-zinc-400">{index + 1}</span>{BLOCK_LABEL[child.type]}</button>)}</div>
          <select className={`${fieldClass} mt-2`} defaultValue="" onChange={(event) => { if (event.target.value) props.onInsertChild(block, event.target.value as BoxChildBlock['type']); event.target.value = '' }}><option value="">插入盒子子块…</option>{BOX_CHILD_TYPES.map((type) => <option key={type} value={type}>{BLOCK_LABEL[type]}</option>)}</select>
        </div>
      </> : null}
      {block.type === 'question' ? <>
        <label className="block text-xs font-medium text-zinc-500">题目 ID<input className={fieldClass} value={block.questionId} onChange={(event) => props.onUpdate({ questionId: event.target.value }, `question-id:${block.id}`)} /></label>
        {block.questionId ? <button type="button" onClick={() => props.onUpdate({ questionId: '' })} className="h-8 rounded-md border border-zinc-200 px-2 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900">清除题目引用</button> : null}
        <label className="block text-xs font-medium text-zinc-500">显示编号<input className={fieldClass} value={block.display?.displayNumber || ''} onChange={(event) => props.onUpdate({ display: { ...block.display, displayNumber: event.target.value } })} /></label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(block.display?.showAnswer)} onChange={(event) => props.onUpdate({ display: { ...block.display, showAnswer: event.target.checked } })} />显示答案</label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(block.display?.showAnalysis)} onChange={(event) => props.onUpdate({ display: { ...block.display, showAnalysis: event.target.checked } })} />显示解析</label>
        <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <div className="flex gap-1"><input className={`${fieldClass} mt-0`} placeholder="搜索题库" value={questionQuery} onChange={(event) => setQuestionQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchQuestions() }} /><button type="button" onClick={() => void searchQuestions()} className="h-9 shrink-0 rounded-md border border-zinc-200 px-2 text-xs dark:border-zinc-800">{searching ? '搜索中' : '搜索'}</button></div>
          <div className="mt-2 max-h-52 space-y-1 overflow-auto">{questionResults.map((question) => <button key={question.id} type="button" onClick={() => { props.onQuestionLoaded(question); props.onUpdate({ questionId: question.id }) }} className="block w-full rounded-md border border-zinc-200 p-2 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"><span className="block text-xs font-medium">{question.questionNo || question.id}</span><span className="mt-0.5 line-clamp-2 text-[10px] text-zinc-500">{question.stemMarkdown}</span></button>)}</div>
        </div>
      </> : null}
      {block.type === 'figure' ? <>
        <label className="block text-xs font-medium text-zinc-500">替换图片
          <span className="mt-1 flex items-center gap-2"><label className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md border border-zinc-200 px-3 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"><ImagePlus className="size-4" />{uploading ? '上传中…' : '选择图片'}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploading} onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setUploading(true); try { const asset = await props.onUpload(file); props.onUpdate({ asset: { type: 'documentAsset', assetId: asset.id } }) } finally { setUploading(false); event.target.value = '' } }} /></label></span>
        </label>
        <label className="block text-xs font-medium text-zinc-500">替代文本<input className={fieldClass} value={block.alt || ''} onChange={(event) => props.onUpdate({ alt: event.target.value }, `figure-alt:${block.id}`)} /></label>
        <label className="block text-xs font-medium text-zinc-500">图注<input className={fieldClass} value={block.caption || ''} onChange={(event) => props.onUpdate({ caption: event.target.value }, `figure-caption:${block.id}`)} /></label>
        <label className="block text-xs font-medium text-zinc-500">对齐<select className={fieldClass} value={block.alignment} onChange={(event) => props.onUpdate({ alignment: event.target.value as 'left' | 'center' | 'right' })}><option value="left">左</option><option value="center">中</option><option value="right">右</option></select></label>
        <label className="block text-xs font-medium text-zinc-500">宽度 {Math.round((block.widthRatio || 0.8) * 100)}%<input type="range" min={10} max={100} step={5} className="mt-2 w-full" value={(block.widthRatio || 0.8) * 100} onChange={(event) => props.onUpdate({ widthRatio: Number(event.target.value) / 100 })} /></label>
      </> : null}
      {block.type === 'unknown' ? <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">UnknownBlock 保持只读。原始数据不会被普通属性编辑覆盖。</div> : null}
      {['divider', 'pageBreak'].includes(block.type) ? <p className="text-xs text-zinc-400">该块没有额外属性。</p> : null}
      {selected.boxId ? <p className="rounded-md bg-zinc-50 p-2 text-[10px] text-zinc-500 dark:bg-zinc-900">当前为盒子子块；不允许插入嵌套盒子。</p> : null}
    </div>
  )
}

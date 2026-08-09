import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { keymap } from '@codemirror/view'
import { Check, ChevronRight, Clipboard, Code2, ImagePlus, Link2, LoaderCircle, Plus, Trash2, WandSparkles, X } from 'lucide-react'
import { questionBankApi } from '@/api/questionBank'
import { Button, Empty } from '@/components/ui'
import type { QuestionFigure, QuestionItem } from '@/types'
import { assetUrl, choiceLabelsForQuestion, figureCaption } from '@/utils/questionDisplay'
import { FigureUploadDialog } from './FigureDialogs'

const defaultTikz = `\\begin{tikzpicture}
  \\draw[->] (-0.2,0) -- (4.2,0) node[right] {$x$};
  \\draw[->] (0,-0.2) -- (0,3.2) node[above] {$y$};
  \\draw[thick, blue] (0,0.4) .. controls (1.1,2.7) and (2.9,2.7) .. (4,0.4);
\\end{tikzpicture}`

type Usage = 'stem' | 'analysis' | 'options'
type FigureManagerSurface = 'solid' | 'glass'
type MarkerReference = { id: string; label: string; field: 'stem' | 'answer' | 'analysis'; kind: 'doc2x' | 'ocr' }

function usageLabel(value: string) {
  return value === 'analysis' ? '解析图' : value === 'options' ? '选项图' : '题干图'
}

function figurePath(figure: QuestionFigure) {
  const path = String(figure.path || '').trim()
  return path ? assetUrl(path) : ''
}

function figureMarker(figure: QuestionFigure) {
  return `<!-- DOC2X_FIGURE:${String(figure.blockId || figure.id || '').trim()} -->`
}

function markerReferences(question: QuestionItem, figures: QuestionFigure[]) {
  const doc2xMarkerPattern = /<!--\s*DOC2X_FIGURE:([^>\s]+)\s*-->/gi
  const ocrMarkerPattern = /<!--\s*OCR_IMAGE_REFERENCE:(stem|answer|analysis):(\d+)\s*-->/gi
  const knownIds = new Set(figures.flatMap((figure) => [figure.id, figure.blockId]).filter(Boolean).map(String))
  const fields = [
    ['stemMarkdown', '题干与选项', 'stem'],
    ['answerText', '答案', 'answer'],
    ['analysisMarkdown', '解析', 'analysis'],
  ] as const satisfies ReadonlyArray<[keyof QuestionItem, string, MarkerReference['field']]>
  const seen = new Set<string>()
  return fields.flatMap(([key, label, field]) => {
    const value = String(question[key] || '')
    doc2xMarkerPattern.lastIndex = 0
    ocrMarkerPattern.lastIndex = 0
    const doc2xMarkers = Array.from(value.matchAll(doc2xMarkerPattern), (match) => ({ id: match[1], label, field, kind: 'doc2x' as const, index: match.index || 0 }))
    const ocrMarkers = Array.from(value.matchAll(ocrMarkerPattern), (match) => ({ id: `OCR_IMAGE_REFERENCE:${match[1]}:${match[2]}`, label, field, kind: 'ocr' as const, index: match.index || 0 }))
    return [...doc2xMarkers, ...ocrMarkers].sort((left, right) => left.index - right.index)
  }).filter((marker) => (marker.kind === 'ocr' || !knownIds.has(marker.id)) && !seen.has(marker.id) && Boolean(seen.add(marker.id))) as MarkerReference[]
}

function inlineDoc2xFigureIds(question: QuestionItem) {
  const markerPattern = /<!--\s*DOC2X_FIGURE:([^>\s]+)\s*-->/gi
  return new Set(['stemMarkdown', 'answerText', 'analysisMarkdown'].flatMap((key) => {
    markerPattern.lastIndex = 0
    return Array.from(String(question[key as keyof QuestionItem] || '').matchAll(markerPattern), (match) => match[1])
  }))
}

function dataSvg(result: { svgBase64: string }) {
  return `data:image/svg+xml;base64,${result.svgBase64}`
}

function FigurePreview({ figure, fallback }: { figure?: QuestionFigure; fallback?: string }) {
  const [failed, setFailed] = useState(false)
  const src = fallback || (figure ? figurePath(figure) : '')
  if (!src || failed) return <div className="flex h-full min-h-64 items-center justify-center text-xs text-zinc-400">暂无可预览图像</div>
  return <img src={src} alt={figure ? figureCaption(figure, 0) : 'TikZ 预览'} className="max-h-full max-w-full object-contain" onError={() => setFailed(true)} />
}

function TikzComposer({
  questionId,
  optionLabels,
  existingFigure,
  surface = 'solid',
  onCancel,
  onSaved,
}: {
  questionId: string
  optionLabels: string[]
  existingFigure?: QuestionFigure
  surface?: FigureManagerSurface
  onCancel: () => void
  onSaved: (figure: QuestionFigure) => void
}) {
  const glass = surface === 'glass'
  const [source, setSource] = useState(existingFigure?.tikzSource || defaultTikz)
  const [usage, setUsage] = useState<Usage>((existingFigure?.usage || 'stem') as Usage)
  const [optionLabel, setOptionLabel] = useState(existingFigure?.optionLabel || optionLabels[0] || 'A')
  const [preview, setPreview] = useState<{ svgBase64: string; sourceHash: string } | null>(null)
  const [rendering, setRendering] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const latestSource = useRef(source)
  latestSource.current = source

  const render = async (value = latestSource.current) => {
    if (!value.trim() || rendering) return
    setRendering(true)
    setError('')
    try {
      const result = await questionBankApi.previewTikz(questionId, value)
      if (latestSource.current === value) setPreview({ svgBase64: result.svgBase64, sourceHash: result.sourceHash })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRendering(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void render() }, 700)
    return () => window.clearTimeout(timer)
  }, [source])

  const save = async () => {
    if (!source.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      const figure = existingFigure?.id
        ? await questionBankApi.updateTikzFigure(questionId, existingFigure.id, { source, usage, optionLabel: usage === 'options' ? optionLabel : undefined })
        : await questionBankApi.createTikzFigure(questionId, { source, usage, optionLabel: usage === 'options' ? optionLabel : undefined })
      onSaved(figure)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={`${glass ? 'question-edit-glass-inner' : 'flex overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950'} flex min-h-[520px] min-w-0 flex-col motion-safe:transition-[opacity,transform] motion-safe:duration-200`}>
      <header className={`${glass ? 'question-edit-glass-inner-header' : 'border-b border-zinc-100 bg-zinc-50/60 dark:border-zinc-900 dark:bg-zinc-900/20'} flex items-center justify-between gap-3 px-4 py-3`}>
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={onCancel} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800" aria-label="返回题图列表"><ChevronRight className="size-4 rotate-180" /></button>
          <div className="min-w-0"><h3 className="truncate text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{existingFigure ? '编辑 TikZ 题图' : '新建 TikZ 题图'}</h3><p className="truncate text-xs text-zinc-500">源码与预览分离，保存后成为题库独立资源。</p></div>
        </div>
        <button type="button" onClick={onCancel} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="取消"><X className="size-4" /></button>
      </header>
      <div className={`${glass ? 'question-edit-glass-split' : 'divide-y divide-zinc-200 dark:divide-zinc-800'} grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-y-0`}>
        <div className={`${glass ? 'question-edit-glass-code' : 'bg-zinc-50/40 dark:bg-zinc-900/20'} flex min-h-0 flex-col`}>
          <div className={`${glass ? 'question-edit-glass-toolbar' : 'border-b border-zinc-200 dark:border-zinc-800'} flex items-center justify-between px-3 py-2 text-xs font-medium text-zinc-500`}><span>源码</span><Button size="sm" variant="outline" icon={rendering ? LoaderCircle : Code2} disabled={rendering || !source.trim()} onClick={() => void render()}>{rendering ? '生成中' : '生成预览'}</Button></div>
          <CodeMirror value={source} height="100%" basicSetup={{ lineNumbers: true, foldGutter: false }} onChange={setSource} extensions={[keymap.of([{ key: 'Mod-Enter', run: () => { void render(); return true } }])]} className="min-h-[300px] flex-1 overflow-auto text-sm" />
        </div>
        <div className="flex min-h-0 flex-col">
          <div className={`${glass ? 'question-edit-glass-toolbar' : 'border-b border-zinc-200 dark:border-zinc-800'} px-3 py-2 text-xs font-medium text-zinc-500`}>预览</div>
          <div className={`${glass ? 'question-edit-glass-preview' : 'bg-white dark:bg-zinc-950'} flex min-h-[260px] flex-1 items-center justify-center overflow-auto p-6`}>{preview ? <FigurePreview fallback={dataSvg(preview)} /> : <Empty text="输入源码后将显示预览" />}</div>
        </div>
      </div>
      {error ? <div role="alert" className="border-t border-red-200 bg-red-50/40 px-4 py-2 text-xs text-red-700 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">{error}</div> : null}
      <footer className={`${glass ? 'question-edit-glass-footer' : 'border-t border-zinc-100 bg-zinc-50/40 dark:border-zinc-900 dark:bg-zinc-900/10'} flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
        <div className="flex items-center gap-2">
          <label className="text-[13px] text-zinc-500">用途</label>
          <select className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-800 dark:bg-zinc-950" value={usage} onChange={(event) => setUsage(event.target.value as Usage)}><option value="stem">题干图</option><option value="analysis">解析图</option>{optionLabels.length ? <option value="options">选项图</option> : null}</select>
          {usage === 'options' ? <select className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-800 dark:bg-zinc-950" value={optionLabel} onChange={(event) => setOptionLabel(event.target.value)}>{optionLabels.map((label) => <option key={label}>{label}</option>)}</select> : null}
        </div>
        <div className="flex items-center gap-2"><Button variant="outline" icon={X} onClick={onCancel}>取消</Button><Button icon={saving ? LoaderCircle : Check} disabled={saving || !preview || !source.trim()} onClick={() => void save()}>{saving ? '保存中...' : '保存题图'}</Button></div>
      </footer>
    </section>
  )
}

export function QuestionFigureManager({
  question,
  onFiguresChange,
  onClose,
  surface = 'solid',
}: {
  question: QuestionItem
  onFiguresChange?: (figures: QuestionFigure[]) => void
  onClose?: () => void
  surface?: FigureManagerSurface
}) {
  const optionLabels = useMemo(() => choiceLabelsForQuestion(question), [question.stemMarkdown, question.answerText])
  const [figures, setFigures] = useState<QuestionFigure[]>(question.figures || [])
  const [selectedId, setSelectedId] = useState(String(question.figures?.[0]?.id || ''))
  const [usage, setUsage] = useState<Usage>('stem')
  const [optionLabel, setOptionLabel] = useState(optionLabels[0] || 'A')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tikzOpen, setTikzOpen] = useState(false)
  const [tikzFigure, setTikzFigure] = useState<QuestionFigure | undefined>()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [bindingMarkerId, setBindingMarkerId] = useState('')
  const [autoBindingPreview, setAutoBindingPreview] = useState(false)
  const [copyNotice, setCopyNotice] = useState('')

  useEffect(() => {
    setFigures(question.figures || [])
    if (!selectedId || !(question.figures || []).some((figure) => String(figure.id) === selectedId)) setSelectedId(String(question.figures?.[0]?.id || ''))
  }, [question.id, question.figures])

  const selected = figures.find((figure) => String(figure.id || '') === selectedId)
  const unboundMarkers = useMemo(() => markerReferences(question, figures), [question.stemMarkdown, question.answerText, question.analysisMarkdown, figures])
  const inlineFigureIds = useMemo(() => inlineDoc2xFigureIds(question), [question.stemMarkdown, question.answerText, question.analysisMarkdown])
  const unboundFigures = useMemo(() => figures.filter((figure) => figure.id && ![figure.id, figure.blockId].filter(Boolean).map(String).some((value) => inlineFigureIds.has(value))), [figures, inlineFigureIds])
  const automaticBindings = useMemo(() => {
    const remaining = [...unboundFigures]
    return unboundMarkers.flatMap((marker) => {
      const usage = marker.field === 'stem' ? 'stem' : marker.field
      const index = remaining.findIndex((figure) => String(figure.usage || 'stem') === usage)
      const figure = remaining.splice(index >= 0 ? index : 0, 1)[0]
      return figure ? [{ marker, figure }] : []
    })
  }, [unboundMarkers, unboundFigures])
  useEffect(() => {
    if (!selected) return
    setUsage((selected.usage || 'stem') as Usage)
    setOptionLabel(selected.optionLabel || optionLabels[0] || 'A')
  }, [selectedId, selected?.usage, selected?.optionLabel, optionLabels.join('|')])

  const commit = (next: QuestionFigure[]) => {
    setFigures(next)
    onFiguresChange?.(next)
  }

  const updateSelected = async () => {
    if (!selected?.id) return
    setBusy(true); setError('')
    try {
      const next = await questionBankApi.updateFigure(question.id, selected.id, { usage, optionLabel: usage === 'options' ? optionLabel : undefined, pageNumber: 1, bbox: selected.bbox || {} })
      commit(figures.map((figure) => figure.id === next.id ? next : figure))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  const deleteSelected = async () => {
    if (!selected?.id || !window.confirm('删除这张题图？此操作不可撤销。')) return
    setBusy(true); setError('')
    try {
      await questionBankApi.deleteFigure(question.id, selected.id)
      const next = figures.filter((figure) => figure.id !== selected.id)
      commit(next); setSelectedId(String(next[0]?.id || ''))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  const bindSelected = async () => {
    if (!selected?.id || !bindingMarkerId) return
    setBusy(true); setError('')
    try {
      const next = await questionBankApi.bindFigureToMarker(question.id, selected.id, bindingMarkerId)
      commit(figures.map((figure) => figure.id === next.id ? next : figure))
      setBindingMarkerId('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  const confirmAutomaticBindings = async () => {
    if (!automaticBindings.length) return
    setBusy(true); setError('')
    try {
      const result = await questionBankApi.bindFiguresToMarkers(question.id, automaticBindings.map(({ figure, marker }) => ({ figureId: String(figure.id), markerId: marker.id })))
      commit(result.figures)
      setAutoBindingPreview(false)
      setCopyNotice(`已按题干、答案、解析的顺序确认绑定 ${automaticBindings.length} 张图片。`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  const copyMarker = async (figure: QuestionFigure, index: number) => {
    const marker = figureMarker(figure)
    if (!figure.id || !navigator.clipboard?.writeText) {
      setCopyNotice('当前浏览器无法写入剪贴板，请在 Markdown 源码中手动输入标签。')
      return
    }
    try {
      await navigator.clipboard.writeText(marker)
      setCopyNotice(`已复制图 ${index + 1} 标签；切到 Markdown 源码后粘贴到需要的位置。`)
    } catch (cause) {
      setCopyNotice(cause instanceof Error ? cause.message : '复制失败，请在 Markdown 源码中手动输入标签。')
    }
  }

  if (tikzOpen) return <TikzComposer questionId={question.id} optionLabels={optionLabels} existingFigure={tikzFigure} surface={surface} onCancel={() => { setTikzOpen(false); setTikzFigure(undefined) }} onSaved={(figure) => { const next = tikzFigure?.id ? figures.map((item) => item.id === figure.id ? figure : item) : [...figures, figure]; commit(next); setSelectedId(String(figure.id || '')); setTikzOpen(false); setTikzFigure(undefined) }} />

  return (
    <section className={`${surface === 'glass' ? 'question-edit-glass-inner' : 'flex overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950'} flex min-h-[520px] min-w-0 flex-col motion-safe:transition-[opacity,transform] motion-safe:duration-200`}>
      <header className={`${surface === 'glass' ? 'question-edit-glass-inner-header' : 'border-b border-zinc-100 bg-zinc-50/60 dark:border-zinc-900 dark:bg-zinc-900/20'} flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
        <div><h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">题图管理</h3><p className="mt-0.5 text-xs text-zinc-500">维护题干、解析和选项图片；资源独立保存，不依赖原始 PDF。</p></div>
        <div className="flex items-center gap-2"><Button size="sm" variant="outline" icon={WandSparkles} disabled={busy || !figures.length} onClick={() => setAutoBindingPreview(true)}>自动匹配标签</Button><Button size="sm" variant="outline" icon={ImagePlus} disabled={busy} onClick={() => setUploadOpen(true)}>上传图片</Button><Button size="sm" icon={Plus} disabled={busy} onClick={() => setTikzOpen(true)}>新建 TikZ</Button>{onClose ? <Button size="sm" variant="outline" icon={X} onClick={onClose}>关闭</Button> : null}</div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(9rem,0.8fr)_minmax(0,1.7fr)] divide-x divide-zinc-200/70 dark:divide-zinc-800/70">
        <aside className={`${surface === 'glass' ? 'question-edit-glass-aside' : 'bg-zinc-50/35 dark:bg-zinc-900/15'} min-h-0 overflow-y-auto p-2`}>
          <div className="flex items-center justify-between px-2 py-2 text-[11px] font-semibold tracking-wide text-zinc-400"><span>已保存题图</span><span>{figures.length}</span></div>
          <div className="space-y-1">
            {figures.map((figure, index) => <button key={figure.id || index} type="button" onClick={() => setSelectedId(String(figure.id || ''))} className={`group flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left motion-safe:transition-colors ${String(figure.id || '') === selectedId ? (surface === 'glass' ? 'border-white/70 bg-white/35 text-zinc-900 shadow-sm dark:border-white/20 dark:bg-zinc-700/60 dark:text-zinc-50' : 'border-zinc-900 bg-white text-zinc-900 shadow-sm dark:border-zinc-100 dark:bg-zinc-950 dark:text-zinc-50') : 'border-transparent text-zinc-500 hover:border-zinc-200 hover:bg-white/40 dark:hover:border-zinc-800 dark:hover:bg-zinc-900/50'}`}><span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">{figure.path ? <img src={figurePath(figure)} alt="" className="size-full object-contain" /> : <ImagePlus className="size-3.5 text-zinc-300" />}</span><span className="min-w-0 flex-1 truncate text-xs font-medium">{figureCaption(figure, index)}</span><span className="text-[10px] text-zinc-400">{figure.origin === 'tikz' ? 'TikZ' : usageLabel(String(figure.usage || 'stem'))}</span></button>)}
          </div>
          {!figures.length ? <div className="px-2 py-8 text-center text-xs leading-5 text-zinc-400">还没有题图<br />从上传或 TikZ 开始</div> : null}
        </aside>
        <div className={`${surface === 'glass' ? 'question-edit-glass-content' : ''} min-h-0 overflow-y-auto p-4`}>
          {selected ? <div className="space-y-4">
            <div className={`${surface === 'glass' ? 'question-edit-glass-preview' : 'border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/20'} flex min-h-64 items-center justify-center overflow-hidden rounded-xl border p-4`}><FigurePreview figure={selected} /></div>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50/50 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/30">
              <label className="flex items-center gap-2"><span className="shrink-0 text-xs font-medium text-zinc-500">图片用途</span><select className="h-8 min-w-28 rounded-md border border-zinc-200 bg-white px-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-950" value={usage} onChange={(event) => setUsage(event.target.value as Usage)}><option value="stem">题干图</option><option value="analysis">解析图</option>{optionLabels.length ? <option value="options">选项图</option> : null}</select></label>
              {usage === 'options' ? <label className="flex items-center gap-2"><span className="shrink-0 text-xs font-medium text-zinc-500">对应选项</span><select className="h-8 min-w-20 rounded-md border border-zinc-200 bg-white px-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-950" value={optionLabel} onChange={(event) => setOptionLabel(event.target.value)}>{optionLabels.map((label) => <option key={label}>{label}</option>)}</select></label> : null}
              <div className="ml-auto flex items-center gap-2"><Button size="sm" variant="outline" icon={Trash2} disabled={busy} onClick={() => void deleteSelected()}>删除</Button><Button size="sm" icon={busy ? LoaderCircle : Check} disabled={busy} onClick={() => void updateSelected()}>{busy ? '保存中...' : '保存属性'}</Button></div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/30">
              <p className="font-medium text-zinc-700 dark:text-zinc-200">插入位置</p>
              <p className="mt-1 leading-5 text-zinc-500">复制图标签后，在“直观修改”中切换到 Markdown 源码，将它粘贴到图片应出现的位置。</p>
              <button type="button" onClick={() => void copyMarker(selected, figures.indexOf(selected))} className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 font-medium text-zinc-700 transition-colors hover:bg-zinc-100 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"><Clipboard className="size-3.5" />图 {figures.indexOf(selected) + 1} · 复制图片标签</button>
            </div>
            {autoBindingPreview ? <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/30">
              {automaticBindings.length ? <><p className="font-medium text-zinc-800 dark:text-zinc-100">请确认自动匹配</p>
                <p className="mt-1 leading-5 text-zinc-500">已按题干、答案、解析中标签出现的顺序，依次匹配尚未绑定的题图；确认后会同步图片用途到目标字段。</p>
                <div className="mt-2 space-y-1.5">{automaticBindings.map(({ figure, marker }) => <div key={`${figure.id}-${marker.id}`} className="flex items-center gap-2 rounded border border-zinc-200 bg-white px-2 py-1.5 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"><span className="shrink-0 font-medium">图 {figures.indexOf(figure) + 1} · {usageLabel(String(figure.usage || 'stem'))}</span><ChevronRight className="size-3.5 shrink-0 text-zinc-400" /><span className="min-w-0 truncate">{marker.label} · {marker.id}</span></div>)}</div>
                {unboundMarkers.length !== unboundFigures.length ? <p className="mt-2 text-amber-800/80 dark:text-amber-300/80">发现 {unboundMarkers.length} 个标签、{unboundFigures.length} 张未绑定题图；本次只匹配前 {automaticBindings.length} 项，其余请手动处理。</p> : null}
                <div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setAutoBindingPreview(false)}>取消</Button><Button size="sm" icon={busy ? LoaderCircle : Check} disabled={busy} onClick={() => void confirmAutomaticBindings()}>{busy ? '绑定中' : `确认绑定 ${automaticBindings.length} 项`}</Button></div>
              </> : <><p className="font-medium text-zinc-800 dark:text-zinc-100">没有可自动匹配的标签</p><p className="mt-1 leading-5 text-zinc-500">已解析题干、答案和解析：当前有 {unboundMarkers.length} 个未绑定标签、{unboundFigures.length} 张未绑定题图。请确认文本中已保留图片标签，或使用下方手动绑定。</p><div className="mt-3 flex justify-end"><Button size="sm" variant="outline" onClick={() => setAutoBindingPreview(false)}>知道了</Button></div></>}
            </div> : null}
            {unboundMarkers.length ? <div className="rounded-lg border border-amber-200 bg-amber-50/45 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
              <p className="font-medium">手动绑定现有图片标签</p>
              <p className="mt-1 leading-5 text-amber-800/80 dark:text-amber-300/80">这个题目的文本中有未绑定标签。选择一项后，将当前图片明确绑定到它；不会移动或改写其他图片。</p>
              <div className="mt-2 flex flex-wrap items-center gap-2"><select aria-label="选择未绑定图片标签" className="h-8 min-w-0 flex-1 rounded-md border border-amber-200 bg-white px-2 text-xs text-zinc-800 dark:border-amber-900/60 dark:bg-zinc-950 dark:text-zinc-100" value={bindingMarkerId} onChange={(event) => setBindingMarkerId(event.target.value)}><option value="">选择一个未绑定标签</option>{unboundMarkers.map((marker) => <option key={marker.id} value={marker.id}>{marker.label} · {marker.id}</option>)}</select><Button size="sm" icon={Link2} disabled={busy || !bindingMarkerId} onClick={() => void bindSelected()}>{busy ? '绑定中' : '绑定当前图片'}</Button></div>
            </div> : null}
            {selected.origin === 'tikz' ? <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50/50 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/30"><span>这是一张 TikZ 题图，可重新编辑源码与预览。</span><Button size="sm" variant="outline" icon={Code2} disabled={busy} onClick={() => { setTikzFigure(selected); setTikzOpen(true) }}>编辑 TikZ</Button></div> : null}
          </div> : <div className="flex min-h-64 items-center justify-center"><Empty text="选择一张题图进行管理" /></div>}
          {error ? <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50/40 px-3 py-2 text-xs text-red-700 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">{error}</div> : null}
          {copyNotice ? <div role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300">{copyNotice}</div> : null}
        </div>
      </div>
      {uploadOpen ? <FigureUploadDialog question={question} optionLabels={optionLabels} usageOptions={[{ value: 'stem', label: '题干图' }, { value: 'analysis', label: '解析图' }, ...(optionLabels.length ? [{ value: 'options', label: '选项图' }] : [])]} onClose={() => setUploadOpen(false)} onUploaded={(figure) => { const next = [...figures, figure]; commit(next); setSelectedId(String(figure.id || '')); setCopyNotice(`图 ${next.length} 已上传。复制图片标签并粘贴到文本即可确定位置。`) }} /> : null}
    </section>
  )
}

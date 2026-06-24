import { useEffect, useRef, useState } from 'react'
import { FileUp, ImagePlus, LoaderCircle, RotateCcw, Trash2, X } from 'lucide-react'
import { questionBankApi } from '@/api/questionBank'
import { Modal } from '@/components/dialogs/Modal'
import { Button, Empty } from '@/components/ui'
import type { QuestionFigure, QuestionItem } from '@/types'
import { assetUrl, choiceLabelsForQuestion, figureCaption, isFormulaSuspectFigure } from '@/utils/questionDisplay'
import { parseBBox, displayRectFromFigure } from '@/utils/crop'
import { BBoxCanvas, type BBoxCanvasBox } from './BBoxCanvas'

export function FigureCropDialog({ question, onClose, onDelete, onSave, onUpdate }: { question: QuestionItem; onClose: (changed?: boolean) => void; onDelete: (figureId: string) => Promise<void>; onSave: (payload: { usage: string; optionLabel?: string; bbox: Record<string, number>; sourcePath?: string }) => Promise<QuestionFigure>; onUpdate: (figureId: string, payload: { usage: string; optionLabel?: string; bbox: Record<string, number>; sourcePath?: string }) => Promise<QuestionFigure> }) {
  const imageRef = useRef<HTMLImageElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const [usage, setUsage] = useState('stem')
  const [optionLabel, setOptionLabel] = useState('A')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [sourceKey, setSourceKey] = useState('stem')
  const [localFigures, setLocalFigures] = useState<QuestionFigure[]>(question.figures)
  const [selectedFigureId, setSelectedFigureId] = useState('')
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  const [rect, setRect] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const [hasChanges, setHasChanges] = useState(false)
  const [saving, setSaving] = useState(false)
  // Provider images are OCR references, not user-drawn boxes on this slice.
  // They must never appear as editable/positionable crop rectangles.
  const cleanPath = (value: string) => String(value || '').replace(/^question_assets\//, '').replace(/^\/+/, '')
  const sourceOptions = [
    ...(question.sliceImagePath ? [{ key: 'stem', label: '题干切片', path: cleanPath(question.sliceImagePath), defaultUsage: 'stem' }] : []),
    ...(question.solutionImagePath ? [{ key: 'solution', label: '解析裁图', path: cleanPath(question.solutionImagePath), defaultUsage: 'analysis' }] : []),
    ...((question.ocrSegmentImages ?? [])
      .map((segment, index) => ({
        key: `segment-${segment.kind}-${index}`,
        label: segment.label || `${segment.kind === 'analysis' ? '解析' : segment.kind === 'answer' ? '答案' : '题干'}分块 ${index + 1}`,
        path: cleanPath(segment.path),
        defaultUsage: segment.kind === 'analysis' || segment.kind === 'answer' ? 'analysis' : 'stem',
      }))),
  ]
  const activeSource = sourceOptions.find((source) => source.key === sourceKey) ?? sourceOptions[0]
  const activeSourcePath = cleanPath(activeSource?.path || '')
  const activeSourceIsStem = activeSource?.key === 'stem'
  const localCropFigures = localFigures.filter((figure) => {
    if (String(figure.origin || '') === 'glm_ocr') return false
    const figureSource = cleanPath(String(figure.sourcePath || ''))
    if (!figureSource) return activeSourceIsStem
    return figureSource === activeSourcePath
  })

  function scrollToRect(r: { y: number; height: number }) {
    const container = scrollContainerRef.current
    if (!container) return
    const containerHeight = container.clientHeight
    const targetScrollTop = r.y - containerHeight / 2 + r.height / 2
    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: 'smooth',
    })
  }
  const imageUrl = activeSourcePath ? assetUrl(activeSourcePath) : ''
  const optionLabels = choiceLabelsForQuestion(question)
  const usageOptions = [
    { value: 'stem', label: '题干图' },
    { value: 'analysis', label: '解析图' },
    ...(optionLabels.length ? [{ value: 'options', label: '选项图' }] : []),
  ]
  useEffect(() => {
    if (usage === 'options' && !optionLabels.length) setUsage('stem')
    if (usage === 'options' && optionLabels.length && !optionLabels.includes(optionLabel)) setOptionLabel(optionLabels[0])
  }, [usage, optionLabels.join(''), optionLabel])

  function naturalRect() {
    const img = imageRef.current
    if (!img) return rect
    const bounds = img.getBoundingClientRect()
    const sx = img.naturalWidth / bounds.width
    const sy = img.naturalHeight / bounds.height
    return {
      x: Math.round(rect.x * sx),
      y: Math.round(rect.y * sy),
      width: Math.round(rect.width * sx),
      height: Math.round(rect.height * sy),
    }
  }

  const canvasBoxes = localCropFigures.map((fig, idx) => {
    const bbox = parseBBox(fig.bbox)
    const normalized = bbox && bbox.x >= 0 && bbox.y >= 0 && bbox.width > 0 && bbox.height > 0 &&
      bbox.x <= 1 && bbox.y <= 1 && bbox.width <= 1 && bbox.height <= 1
    const x = bbox ? (normalized ? bbox.x : bbox.x / naturalSize.width) : 0
    const y = bbox ? (normalized ? bbox.y : bbox.y / naturalSize.height) : 0
    const w = bbox ? (normalized ? bbox.width : bbox.width / naturalSize.width) : 0
    const h = bbox ? (normalized ? bbox.height : bbox.height / naturalSize.height) : 0

    const isSelected = selectedFigureId && fig.id === selectedFigureId
    return {
      id: fig.id || String(idx),
      x,
      y,
      width: w,
      height: h,
      label: `图 ${idx + 1}`,
      boxClass: isSelected ? 'border-amber-500 bg-amber-100/25' : 'border-red-500 bg-rose-100/15',
      labelClass: isSelected ? 'bg-amber-500' : 'bg-red-500',
    } satisfies BBoxCanvasBox
  })
  function selectExistingFigure(figure: QuestionFigure, event?: { preventDefault: () => void; stopPropagation: () => void }) {
    event?.preventDefault()
    event?.stopPropagation()
    if (figure.id) setSelectedFigureId(figure.id)
    const nextRect = displayRectFromFigure(figure, naturalSize, imageSize())
    if (nextRect) {
      setRect(nextRect)
      setTimeout(() => {
        scrollToRect(nextRect)
      }, 50)
    }
    if (figure.usage) setUsage(figure.usage)
    if (figure.optionLabel) setOptionLabel(String(figure.optionLabel).toUpperCase())
  }
  async function saveFigure() {
    setSaving(true)
    try {
      const payload = { usage, optionLabel: usage === 'options' ? optionLabel : undefined, bbox: savedRect, sourcePath: activeSourcePath }
      if (selectedFigureId) {
        const figure = await onUpdate(selectedFigureId, payload)
        setLocalFigures((current) => current.map((item) => item.id === selectedFigureId ? figure : item))
        setSelectedFigureId(figure.id || selectedFigureId)
      } else {
        const figure = await onSave(payload)
        setLocalFigures((current) => [...current, figure])
        setSelectedFigureId(figure.id || '')
      }
      setHasChanges(true)
    } finally {
      setSaving(false)
    }
  }
  function addUploadedFigure(figure: QuestionFigure) {
    setLocalFigures((current) => [...current, figure])
    setSelectedFigureId(figure.id || '')
    setHasChanges(true)
  }
  async function deleteLocalFigure(figure: QuestionFigure) {
    if (!figure.id) return
    await onDelete(figure.id)
    setLocalFigures((current) => current.filter((item) => item.id !== figure.id))
    if (selectedFigureId === figure.id) setSelectedFigureId('')
    setHasChanges(true)
  }
  async function clearAllFigures() {
    if (!localCropFigures.length) return
    if (!window.confirm(`确定要清空当前题目的 ${localCropFigures.length} 个图框吗？`)) return
    try {
      await Promise.all(
        localCropFigures.map(async (fig) => {
          if (fig.id) await onDelete(fig.id)
        })
      )
      setLocalFigures([])
      setSelectedFigureId('')
      setRect({ x: 0, y: 0, width: 0, height: 0 })
      setHasChanges(true)
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }
  }
  async function deleteSuspectFormulaFigures() {
    const suspects = localFigures.filter(isFormulaSuspectFigure)
    if (!suspects.length) return
    if (!window.confirm(`确定要删除当前题目的 ${suspects.length} 个疑似公式图吗？`)) return
    try {
      await Promise.all(
        suspects.map(async (fig) => {
          if (fig.id) await onDelete(fig.id)
        })
      )
      setLocalFigures((current) => current.filter((fig) => !isFormulaSuspectFigure(fig)))
      if (selectedFigureId && suspects.some((fig) => fig.id === selectedFigureId)) {
        setSelectedFigureId('')
        setRect({ x: 0, y: 0, width: 0, height: 0 })
      }
      setHasChanges(true)
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }
  }
  const savedRect = naturalRect()
  useEffect(() => {
    if (!sourceOptions.length) return
    if (!sourceOptions.some((source) => source.key === sourceKey)) setSourceKey(sourceOptions[0].key)
  }, [sourceOptions.map((source) => source.key).join('|'), sourceKey])
  useEffect(() => {
    setSelectedFigureId('')
    setRect({ x: 0, y: 0, width: 0, height: 0 })
    setUsage(activeSource?.defaultUsage || 'stem')
    setNaturalSize({ width: 0, height: 0 })
  }, [activeSource?.key])
  return (
    <div className="fixed inset-0 z-50 flex select-none items-center justify-center bg-black/40 backdrop-blur-sm p-4 text-left">
      <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-none items-center justify-between gap-4 border-b border-zinc-100 bg-zinc-50/50 px-5 py-3.5 dark:border-zinc-900 dark:bg-zinc-900/10">
          <div className="min-w-0">
            <span className="block truncate text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">框选题图</span>
            <span className="mt-0.5 block truncate text-[13px] text-zinc-500 dark:text-zinc-400">
              从当前题目的题干切片或解析分块里框选图形，提取并保存为题干、解析或选项插图资源。
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" icon={FileUp} onClick={() => setUploadOpen(true)}>上传题图</Button>
            <button
              className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              onClick={() => onClose(hasChanges)}
              type="button"
            >
              <X className="size-4.5" />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-zinc-50/30 p-4 dark:bg-zinc-950">
          <div ref={scrollContainerRef} className="relative mx-auto max-h-full min-h-[480px] w-full overflow-auto rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            {imageUrl ? (
              <BBoxCanvas
                imageUrl={imageUrl}
                boxes={canvasBoxes}
                selectedBoxId={selectedFigureId}
                onSelectBoxId={(id) => {
                  const fig = localCropFigures.find(f => f.id === id)
                  if (fig) selectExistingFigure(fig)
                  else {
                    setSelectedFigureId('')
                    setRect({ x: 0, y: 0, width: 0, height: 0 })
                  }
                }}
                rect={rect}
                onRectChange={setRect}
                onDeleteSelectedBox={() => {
                  const fig = localCropFigures.find(f => f.id === selectedFigureId)
                  if (fig) deleteLocalFigure(fig)
                }}
                naturalSizeReady={setNaturalSize}
                imageRef={imageRef}
              />
            ) : <Empty text="当前题目没有切片原图，无法框选题图。" />}
          </div>
        </div>
        <aside className="flex min-h-0 w-80 shrink-0 flex-col border-l border-zinc-200 bg-zinc-50/20 dark:border-zinc-800">
          <div className="border-b border-zinc-100 bg-zinc-50/50 p-4 dark:border-zinc-900 dark:bg-zinc-900/10">
            <span className="block text-[13px] font-medium text-zinc-500 dark:text-zinc-400">截图插图提取</span>
            <p className="mt-1 text-[10px] text-zinc-400">设置选区插图的用途属性，并保存到当前题目。</p>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {sourceOptions.length > 1 ? (
            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-zinc-500">框选来源</label>
              <select className="w-full h-9 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-100 dark:focus:ring-zinc-100 transition-colors" value={activeSource?.key || ''} onChange={(event) => setSourceKey(event.target.value)}>
                {sourceOptions.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}
              </select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <label className="block text-[13px] font-medium text-zinc-500">保存为图片用途</label>
            <select className="w-full h-9 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-100 dark:focus:ring-zinc-100 transition-colors" value={usage} onChange={(event) => setUsage(event.target.value)}>
              {usageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {usage === 'options' ? (
              <label className="mt-3 block space-y-1.5">
                <span className="block text-[13px] font-medium text-zinc-500">对应选项</span>
                <select className="w-full h-9 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-100 dark:focus:ring-zinc-100 transition-colors" value={optionLabel} onChange={(event) => setOptionLabel(event.target.value)}>
                  {optionLabels.map((labelText) => <option key={labelText} value={labelText}>{labelText}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          <Button
            className="w-full justify-start"
            disabled={saving || !imageUrl || savedRect.width < 5 || savedRect.height < 5 || (usage === 'options' && !optionLabel)}
            icon={ImagePlus}
            onClick={saveFigure}
          >
            {saving ? '保存中...' : selectedFigureId ? '更新选中题图' : usage === 'options' ? `保存为选项 ${optionLabel} 图` : `保存为${usage === 'stem' ? '题干' : '解析'}图`}
          </Button>
          <Button
            className="w-full justify-start"
            variant="outline"
            icon={RotateCcw}
            disabled={!imageUrl}
            onClick={() => {
              setSelectedFigureId('')
              setRect({ x: 0, y: 0, width: 0, height: 0 })
            }}
          >
            重置选区
          </Button>
          <Button
            className="w-full justify-start"
            variant="outline"
            disabled={!localFigures.filter(isFormulaSuspectFigure).length}
            icon={Trash2}
            onClick={deleteSuspectFormulaFigures}
          >
            删除疑似公式图（{localFigures.filter(isFormulaSuspectFigure).length}）
          </Button>
          <Button
            className="w-full justify-start"
            variant="outline"
            disabled={!localCropFigures.length}
            icon={X}
            onClick={clearAllFigures}
          >
            清空所有图片
          </Button>
          {localCropFigures.length ? (
            <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">已录入题图 ({localCropFigures.length})</p>
              </div>
              <div className="mt-2 max-h-56 space-y-2 overflow-auto">
                {localCropFigures.map((figure, index) => {
                  const bbox = parseBBox(figure.bbox)
                  const normalized = bbox && bbox.x >= 0 && bbox.y >= 0 && bbox.width > 0 && bbox.height > 0 &&
                    bbox.x <= 1 && bbox.y <= 1 && bbox.width <= 1 && bbox.height <= 1
                  const bx = bbox ? (normalized ? bbox.x : bbox.x / naturalSize.width) : 0
                  const by = bbox ? (normalized ? bbox.y : bbox.y / naturalSize.height) : 0
                  const bw = bbox ? (normalized ? bbox.width : bbox.width / naturalSize.width) : 0
                  const bh = bbox ? (normalized ? bbox.height : bbox.height / naturalSize.height) : 0

                  const imgStyle = bw > 0 && bh > 0 ? {
                    left: `-${(bx / bw) * 100}%`,
                    top: `-${(by / bh) * 100}%`,
                    width: `${100 / bw}%`,
                    height: `${100 / bh}%`,
                  } : {}

                  return (
                    <div key={figure.id || index} className={`flex items-center gap-2 rounded-lg border p-1.5 transition-all ${selectedFigureId && figure.id === selectedFigureId ? 'border-zinc-900 bg-zinc-50 shadow-sm ring-1 ring-zinc-900 dark:border-zinc-100 dark:bg-zinc-900/40 dark:ring-zinc-100' : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950'}`}>
                      {/* Micro visual thumbnail crop offset preview */}
                      <div className="size-10 shrink-0 overflow-hidden rounded border border-zinc-150 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 relative">
                        {imageUrl && bw > 0 && bh > 0 ? (
                          <img src={imageUrl} className="absolute max-w-none grayscale opacity-80" style={imgStyle} />
                        ) : null}
                      </div>
                      <button className="text-left text-xs font-semibold truncate flex-1 hover:text-zinc-600 dark:hover:text-zinc-400 cursor-pointer" onClick={() => selectExistingFigure(figure)} type="button">
                        {figureCaption(figure, index)}
                      </button>
                      {figure.id ? (
                        <button
                          className="flex size-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 hover:border-red-200 dark:hover:border-red-900/30 transition-all cursor-pointer active:scale-95"
                          onClick={() => deleteLocalFigure(figure)}
                          title="删除此图"
                          type="button"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
          <Button className="w-full justify-start" icon={X} variant="outline" onClick={() => onClose(hasChanges)}>取消</Button>
          </div>
        </aside>
      </div>
      {uploadOpen ? (
        <FigureUploadDialog
          question={question}
          optionLabels={optionLabels}
          usageOptions={usageOptions}
          onClose={() => setUploadOpen(false)}
          onUploaded={addUploadedFigure}
        />
      ) : null}
      </div>
    </div>
  )
}

export function FigureUploadDialog({ question, optionLabels, usageOptions, onClose, onUploaded }: { question: QuestionItem; optionLabels: string[]; usageOptions: Array<{ value: string; label: string }>; onClose: () => void; onUploaded: (figure: QuestionFigure) => void }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pasteTargetRef = useRef<HTMLDivElement | null>(null)
  const [usage, setUsage] = useState('stem')
  const [optionLabel, setOptionLabel] = useState(optionLabels[0] || 'A')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (usage === 'options' && optionLabels.length && !optionLabels.includes(optionLabel)) setOptionLabel(optionLabels[0])
    if (usage === 'options' && !optionLabels.length) setUsage('stem')
  }, [usage, optionLabels.join(''), optionLabel])

  useEffect(() => {
    pasteTargetRef.current?.focus()
    const handlePaste = (event: ClipboardEvent) => {
      if (acceptClipboardData(event.clipboardData)) event.preventDefault()
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [])

  function acceptFileList(files: FileList | File[]) {
    const list = Array.from(files)
    if (list.length !== 1) {
      setError('每次只能上传一个图片文件。')
      setFile(null)
      return
    }
    const nextFile = list[0]
    if (!nextFile.type.startsWith('image/')) {
      setError('只能上传图片文件。')
      setFile(null)
      return
    }
    setError('')
    setFile(nextFile)
  }

  function acceptClipboardData(clipboardData: DataTransfer | null) {
    if (!clipboardData) return false
    const itemFiles = Array.from(clipboardData.items || [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean) as File[]
    const files = itemFiles.length ? itemFiles : Array.from(clipboardData.files || []).filter((item) => item.type.startsWith('image/'))
    if (!files.length) return false
    acceptFileList(files)
    return true
  }

  async function uploadFigure() {
    if (!file) {
      setError('请先选择、拖入或粘贴一张图片。')
      return
    }
    if (usage === 'options' && !optionLabel) {
      setError('请选择对应选项。')
      return
    }
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('usage', usage)
      if (usage === 'options') form.append('optionLabel', optionLabel)
      const figure = await questionBankApi.uploadFigure(question.id, form)
      onUploaded(figure)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-100 bg-zinc-50/50 px-4 py-3 dark:border-zinc-900 dark:bg-zinc-900/10">
          <div>
            <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">上传题图</h3>
            <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">支持拖拽、粘贴或点击上传；每次只保存一张图片。</p>
          </div>
          <button className="rounded-md border p-2 hover:bg-zinc-50" onClick={onClose} type="button"><X className="size-4" /></button>
        </div>
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-zinc-500">图片类型</span>
              <select className="w-full h-9 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-100 dark:focus:ring-zinc-100 transition-colors" value={usage} onChange={(event) => setUsage(event.target.value)}>
                {usageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            {usage === 'options' ? (
              <label className="space-y-1">
                <span className="text-xs font-medium text-zinc-500">对应选项</span>
                <select className="w-full h-9 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-100 dark:focus:ring-zinc-100 transition-colors" value={optionLabel} onChange={(event) => setOptionLabel(event.target.value)}>
                  {optionLabels.map((labelText) => <option key={labelText} value={labelText}>{labelText}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          <div
            ref={pasteTargetRef}
            className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50 px-4 py-8 text-center outline-none transition-colors hover:bg-white dark:border-zinc-800 dark:bg-zinc-950/20 dark:hover:bg-zinc-950 focus:border-zinc-900 dark:focus:border-zinc-100"
            contentEditable
            onClick={() => fileInputRef.current?.click()}
            onInput={(event) => {
              event.currentTarget.textContent = ''
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={(event) => {
              event.preventDefault()
              acceptFileList(event.dataTransfer.files)
            }}
            onPaste={(event) => {
              if (acceptClipboardData(event.clipboardData)) event.preventDefault()
            }}
            role="button"
            suppressContentEditableWarning
            tabIndex={0}
          >
            <input
              ref={fileInputRef}
              accept="image/*"
              className="hidden"
              onChange={(event) => event.target.files && acceptFileList(event.target.files)}
              type="file"
            />
            <FileUp className="size-8 text-zinc-400" />
            <p className="mt-3 text-sm font-semibold text-zinc-800">{file ? file.name : '拖拽、粘贴或点击选择图片'}</p>
            <p className="mt-1 text-xs text-zinc-500">仅支持单张图片文件</p>
          </div>
          {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" icon={X} onClick={onClose}>取消</Button>
            <Button icon={uploading ? LoaderCircle : ImagePlus} disabled={uploading || !file || (usage === 'options' && !optionLabel)} onClick={uploadFigure}>{uploading ? '上传中...' : '保存为题图'}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { FileUp, ImagePlus, LoaderCircle, Trash2, X } from 'lucide-react'
import { api } from '@/api/client'
import { Modal } from '@/components/dialogs/Modal'
import { Button, Empty } from '@/components/ui'
import type { CropCorner, CropInteraction, QuestionFigure, QuestionItem } from '@/types'
import { assetUrl, choiceLabelsForQuestion, figureCaption, isFormulaSuspectFigure } from '@/utils/questionDisplay'
import { clampNumber, cropHandles, displayRectFromFigure, figureOverlayStyle, normalizeDisplayRect, resizeDisplayRect } from '@/utils/crop'

export function FigureCropDialog({ question, onClose, onDelete, onSave, onUpdate }: { question: QuestionItem; onClose: (changed?: boolean) => void; onDelete: (figureId: string) => Promise<void>; onSave: (payload: { usage: string; optionLabel?: string; bbox: Record<string, number> }) => Promise<QuestionFigure>; onUpdate: (figureId: string, payload: { usage: string; optionLabel?: string; bbox: Record<string, number> }) => Promise<QuestionFigure> }) {
  const imageRef = useRef<HTMLImageElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const [usage, setUsage] = useState('stem')
  const [optionLabel, setOptionLabel] = useState('A')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [interaction, setInteraction] = useState<CropInteraction | null>(null)
  const [localFigures, setLocalFigures] = useState<QuestionFigure[]>(question.figures)
  const [selectedFigureId, setSelectedFigureId] = useState('')
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  const [rect, setRect] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const [hasChanges, setHasChanges] = useState(false)
  const [saving, setSaving] = useState(false)

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
  const imageUrl = question.sliceImagePath ? assetUrl(question.sliceImagePath) : ''
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
  function point(event: PointerEvent<HTMLElement>) {
    const img = imageRef.current
    if (!img) return { x: 0, y: 0 }
    const bounds = img.getBoundingClientRect()
    const x = Math.max(0, Math.min(event.clientX - bounds.left, bounds.width))
    const y = Math.max(0, Math.min(event.clientY - bounds.top, bounds.height))
    return { x, y }
  }
  function imageSize() {
    const img = imageRef.current
    if (!img) return { width: 0, height: 0 }
    const bounds = img.getBoundingClientRect()
    return { width: bounds.width, height: bounds.height }
  }
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
  function startDraw(event: PointerEvent<HTMLDivElement>) {
    if (!imageRef.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedFigureId('')
    const p = point(event)
    setInteraction({ mode: 'draw', start: p })
    setRect({ x: p.x, y: p.y, width: 0, height: 0 })
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!interaction) return
    event.preventDefault()
    const p = point(event)
    const size = imageSize()
    if (interaction.mode === 'draw') {
      setRect(normalizeDisplayRect({
        x: Math.min(interaction.start.x, p.x),
        y: Math.min(interaction.start.y, p.y),
        width: Math.abs(p.x - interaction.start.x),
        height: Math.abs(p.y - interaction.start.y),
      }, size))
      return
    }
    if (interaction.mode === 'move') {
      const dx = p.x - interaction.start.x
      const dy = p.y - interaction.start.y
      setRect({
        ...interaction.rect,
        x: clampNumber(interaction.rect.x + dx, 0, Math.max(0, size.width - interaction.rect.width)),
        y: clampNumber(interaction.rect.y + dy, 0, Math.max(0, size.height - interaction.rect.height)),
      })
      return
    }
    setRect(resizeDisplayRect(interaction.rect, interaction.corner, p, size))
  }
  function end() {
    setInteraction(null)
  }
  function startMove(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setInteraction({ mode: 'move', start: point(event), rect })
  }
  function startResize(corner: CropCorner, event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setInteraction({ mode: 'resize', corner, start: point(event), rect })
  }
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
      const payload = { usage, optionLabel: usage === 'options' ? optionLabel : undefined, bbox: savedRect }
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
    if (!localFigures.length) return
    if (!window.confirm(`确定要清空当前题目的 ${localFigures.length} 个图框吗？`)) return
    try {
      await Promise.all(
        localFigures.map(async (fig) => {
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
  return (
    <Modal
      title="框选题图"
      desc="从当前题目的切片图里框选图形，保存为 stem/analysis 等题目图片资源。"
      onClose={() => onClose(hasChanges)}
      wide
      locked
      actions={<Button size="sm" variant="outline" icon={FileUp} onClick={() => setUploadOpen(true)}>上传题图</Button>}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-h-[520px] rounded-2xl border bg-zinc-100 p-4">
          <div ref={scrollContainerRef} className="relative mx-auto max-h-[72vh] min-h-[480px] w-full overflow-auto rounded-xl border bg-zinc-50 p-4 shadow-sm">
            {imageUrl ? (
              <div className="relative block w-full cursor-crosshair select-none" onPointerDown={startDraw} onPointerMove={move} onPointerUp={end} onPointerLeave={end}>
                <img ref={imageRef} alt="切片原图" className="w-full max-w-none rounded-lg border bg-white shadow-sm" draggable={false} onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} src={imageUrl} />
                <div className="pointer-events-none absolute inset-0 bg-zinc-950/10" />
                {localFigures.map((figure, index) => {
                  const style = figureOverlayStyle(figure, naturalSize)
                  if (!style) return null
                  const isSelected = selectedFigureId && figure.id === selectedFigureId
                  return (
                    <button
                      key={figure.id || index}
                      className={`absolute rounded-sm border-2 text-left shadow-sm ${isSelected ? 'border-amber-500 bg-amber-200/20' : 'border-red-500 bg-rose-100/15'}`}
                      onPointerDown={(event) => selectExistingFigure(figure, event)}
                      style={style}
                      type="button"
                    >
                      <span className={`absolute left-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${isSelected ? 'bg-amber-500' : 'bg-red-500'}`}>图 {index + 1}</span>
                    </button>
                  )
                })}
                {rect.width > 3 && rect.height > 3 ? (
                  <div className="absolute cursor-move rounded-sm border-2 border-red-500 bg-rose-50/70" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} onPointerDown={startMove}>
                    <div className="absolute left-2 top-2 rounded bg-red-500 px-2 py-0.5 text-[11px] font-medium text-white">{selectedFigureId ? '编辑选区' : '新图'}</div>
                    {cropHandles.map((handle) => (
                      <button
                        key={handle.corner}
                        aria-label={handle.label}
                        className={`absolute ${handle.position} size-4 rounded-full border-2 border-red-500 bg-white shadow-sm ${handle.cursor}`}
                        onPointerDown={(event) => startResize(handle.corner, event)}
                        type="button"
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : <Empty text="当前题目没有切片原图，无法框选题图。" />}
          </div>
        </div>
        <aside className="space-y-3 rounded-2xl border bg-zinc-50 p-3">
          <div className="rounded-xl border bg-white p-3">
            <p className="text-xs font-medium text-zinc-500">保存为</p>
            <select className="mt-2 w-full rounded-md border px-2 py-2 text-sm" value={usage} onChange={(event) => setUsage(event.target.value)}>
              {usageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {usage === 'options' ? (
              <label className="mt-3 block space-y-1">
                <span className="text-xs font-medium text-zinc-500">对应选项</span>
                <select className="w-full rounded-md border px-2 py-2 text-sm" value={optionLabel} onChange={(event) => setOptionLabel(event.target.value)}>
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
            disabled={!localFigures.filter(isFormulaSuspectFigure).length}
            icon={Trash2}
            onClick={deleteSuspectFormulaFigures}
          >
            删除疑似公式图（{localFigures.filter(isFormulaSuspectFigure).length}）
          </Button>
          <Button
            className="w-full justify-start"
            variant="outline"
            disabled={!localFigures.length}
            icon={X}
            onClick={clearAllFigures}
          >
            清空所有图片
          </Button>
          {localFigures.length ? (
            <div className="rounded-xl border bg-white p-3">
              <p className="text-xs font-medium text-zinc-500">已框图片</p>
              <div className="mt-2 max-h-56 space-y-2 overflow-auto">
                {localFigures.map((figure, index) => (
                  <div key={figure.id || index} className={`flex items-center justify-between gap-2 rounded-lg border p-1.5 pl-2.5 transition-all ${selectedFigureId && figure.id === selectedFigureId ? 'border-amber-400 bg-amber-50' : 'bg-zinc-50'}`}>
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
                ))}
              </div>
            </div>
          ) : null}
          <Button className="w-full justify-start" icon={X} variant="outline" onClick={() => onClose(hasChanges)}>取消</Button>
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
    </Modal>
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
      const figure = await api<QuestionFigure>(`/api/question-bank/items/${encodeURIComponent(question.id)}/figures/upload`, {
        method: 'POST',
        body: form,
      })
      onUploaded(figure)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b px-4 py-3">
          <div>
            <h3 className="text-base font-semibold">上传题图</h3>
            <p className="mt-1 text-xs text-zinc-500">支持拖拽、粘贴或点击上传；每次只保存一张图片。</p>
          </div>
          <button className="rounded-md border p-2 hover:bg-zinc-50" onClick={onClose} type="button"><X className="size-4" /></button>
        </div>
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-zinc-500">图片类型</span>
              <select className="w-full rounded-md border px-2 py-2 text-sm" value={usage} onChange={(event) => setUsage(event.target.value)}>
                {usageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            {usage === 'options' ? (
              <label className="space-y-1">
                <span className="text-xs font-medium text-zinc-500">对应选项</span>
                <select className="w-full rounded-md border px-2 py-2 text-sm" value={optionLabel} onChange={(event) => setOptionLabel(event.target.value)}>
                  {optionLabels.map((labelText) => <option key={labelText} value={labelText}>{labelText}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          <div
            ref={pasteTargetRef}
            className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center outline-none transition-colors hover:bg-white focus:border-zinc-500"
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

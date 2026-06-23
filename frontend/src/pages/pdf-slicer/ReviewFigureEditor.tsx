import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { ImagePlus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui'
import type { BBox, CropCorner, CropInteraction, SliceReviewItem } from '@/types'
import { clampNumber, cropHandles, normalizeDisplayRect, resizeDisplayRect } from '@/utils/crop'
import { displayRectFromReviewFigure, figureBoxesForReviewItem, formulaSuspectTitle, isFormulaSuspectFigure, reviewFigureFromDisplayRect, reviewFigureUsage, reviewFigureUsageInfo } from '@/utils/reviewFigures'

export function ReviewFigureEditor({
  item,
  splitMode = false,
  splitSaving = false,
  defaultUsage = 'stem',
  onCancelSplit,
  onConfirmSplit,
  onPreview,
  onSave,
}: {
  item: SliceReviewItem
  splitMode?: boolean
  splitSaving?: boolean
  defaultUsage?: string
  onCancelSplit?: () => void
  onConfirmSplit?: (splitRatio: number) => Promise<void>
  onPreview: () => void
  onSave: (figures: Array<Record<string, unknown>>) => Promise<void>
}) {
  const imageRef = useRef<HTMLImageElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [figures, setFigures] = useState<Array<Record<string, unknown>>>(item.figures ?? [])
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [rect, setRect] = useState<BBox>({ x: 0, y: 0, width: 0, height: 0 })
  const [interaction, setInteraction] = useState<CropInteraction | null>(null)
  const [saving, setSaving] = useState(false)
  const [usage, setUsage] = useState(defaultUsage)
  const [optionLabel, setOptionLabel] = useState('A')
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  const [viewportWidth, setViewportWidth] = useState(0)
  const [splitRatio, setSplitRatio] = useState(0.5)
  const [splitDragging, setSplitDragging] = useState(false)
  const previousSplitMode = useRef(splitMode)

  useEffect(() => {
    const nextFigures = item.figures ?? []
    setFigures(nextFigures)
    setSelectedIndex((current) => current >= nextFigures.length ? -1 : current)
  }, [item.figures])

  useEffect(() => {
    setFigures(item.figures ?? [])
    setSelectedIndex(-1)
    setRect({ x: 0, y: 0, width: 0, height: 0 })
    setInteraction(null)
    setUsage(defaultUsage)
    setOptionLabel('A')
    setSplitRatio(0.5)
    setSplitDragging(false)
    const image = imageRef.current
    if (image?.complete && image.naturalWidth && image.naturalHeight) {
      setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight })
    } else {
      setNaturalSize({ width: 0, height: 0 })
    }
  }, [item.resultId, defaultUsage])

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const updateWidth = () => setViewportWidth(Math.floor(node.clientWidth))
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(node)
    return () => observer.disconnect()
  }, [item.resultId])

  useEffect(() => {
    if (!splitMode || previousSplitMode.current === splitMode) {
      previousSplitMode.current = splitMode
      return
    }
    previousSplitMode.current = splitMode
    window.requestAnimationFrame(() => {
      const viewportBounds = viewportRef.current?.getBoundingClientRect()
      const imageBounds = imageRef.current?.getBoundingClientRect()
      if (!viewportBounds || !imageBounds || imageBounds.height <= 0) return
      const visibleMiddleY = viewportBounds.top + viewportBounds.height / 2
      const middleInImage = visibleMiddleY - imageBounds.top
      setSplitRatio(clampNumber(middleInImage / imageBounds.height, 0.01, 0.99))
    })
  }, [splitMode])

  function imageSize() {
    const bounds = imageRef.current?.getBoundingClientRect()
    return bounds ? { width: bounds.width, height: bounds.height } : { width: 0, height: 0 }
  }
  function point(event: PointerEvent<HTMLElement>) {
    const bounds = imageRef.current?.getBoundingClientRect()
    if (!bounds) return { x: 0, y: 0 }
    return {
      x: clampNumber(event.clientX - bounds.left, 0, bounds.width),
      y: clampNumber(event.clientY - bounds.top, 0, bounds.height),
    }
  }
  function startDraw(event: PointerEvent<HTMLDivElement>) {
    if (splitMode) return
    if (!imageRef.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const p = point(event)
    setSelectedIndex(-1)
    setInteraction({ mode: 'draw', start: p })
    setRect({ x: p.x, y: p.y, width: 0, height: 0 })
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (splitMode && splitDragging) {
      event.preventDefault()
      const size = imageSize()
      if (size.height > 0) setSplitRatio(clampNumber(point(event).y / size.height, 0.01, 0.99))
      return
    }
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
    setSplitDragging(false)
  }
  function startSplitDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!splitMode) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSplitDragging(true)
    const size = imageSize()
    if (size.height > 0) setSplitRatio(clampNumber(point(event).y / size.height, 0.01, 0.99))
  }
  function selectFigure(index: number, event?: PointerEvent<HTMLElement>, beginMove = false) {
    event?.preventDefault()
    event?.stopPropagation()
    const nextRect = displayRectFromReviewFigure(item, figures[index], imageSize())
    if (!nextRect) return
    setSelectedIndex(index)
    setRect(nextRect)
    setUsage(reviewFigureUsage(figures[index]))
    const option = String(figures[index]?.optionLabel || 'A').toUpperCase()
    setOptionLabel(option)
    if (beginMove && event) {
      event.currentTarget.setPointerCapture(event.pointerId)
      setInteraction({ mode: 'move', start: point(event), rect: nextRect })
    }
  }
  function scrollToFigure(index: number) {
    const viewport = viewportRef.current
    const nextRect = displayRectFromReviewFigure(item, figures[index], imageSize())
    if (!viewport || !nextRect) return
    const topPadding = 48
    const left = clampNumber(nextRect.x + nextRect.width / 2 - viewport.clientWidth / 2, 0, Math.max(0, viewport.scrollWidth - viewport.clientWidth))
    const top = clampNumber(nextRect.y - topPadding, 0, Math.max(0, viewport.scrollHeight - viewport.clientHeight))
    viewport.scrollTo({ left, top, behavior: 'smooth' })
  }
  function selectFigureFromTray(index: number) {
    selectFigure(index)
    window.requestAnimationFrame(() => scrollToFigure(index))
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
  async function saveRect() {
    const nextFigure = reviewFigureFromDisplayRect(item, rect, imageSize(), selectedIndex >= 0 ? figures[selectedIndex] : undefined)
    if (!nextFigure) return
    nextFigure.usage = usage
    nextFigure.category = usage
    if (usage === 'options') {
      nextFigure.optionLabel = optionLabel
    } else {
      delete nextFigure.optionLabel
    }
    const nextFigures = selectedIndex >= 0 ? figures.map((figure, index) => index === selectedIndex ? nextFigure : figure) : [...figures, nextFigure]
    setSaving(true)
    try {
      await onSave(nextFigures)
      setFigures(nextFigures)
      setSelectedIndex(selectedIndex >= 0 ? selectedIndex : nextFigures.length - 1)
    } finally {
      setSaving(false)
    }
  }
  async function deleteSelectedFigure() {
    if (selectedIndex < 0) return
    const nextFigures = figures.filter((_, index) => index !== selectedIndex)
    setSaving(true)
    try {
      await onSave(nextFigures)
      setFigures(nextFigures)
      setSelectedIndex(-1)
      setRect({ x: 0, y: 0, width: 0, height: 0 })
    } finally {
      setSaving(false)
    }
  }
  async function clearFigures() {
    if (!figures.length) return
    if (!window.confirm(`确定清空当前题块的 ${figures.length} 个图框？`)) return
    setSaving(true)
    try {
      await onSave([])
      setFigures([])
      setSelectedIndex(-1)
      setRect({ x: 0, y: 0, width: 0, height: 0 })
    } finally {
      setSaving(false)
    }
  }
  const boxes = figureBoxesForReviewItem({ ...item, figures })
  const hasSelectionRect = rect.width > 3 && rect.height > 3
  const showFigureToolbar = figures.length > 0 || selectedIndex >= 0 || (hasSelectionRect && interaction?.mode !== 'draw')
  const showToolbar = showFigureToolbar || splitMode
  const isWideFit = naturalSize.width > 0
  const wideImageWidth = isWideFit && viewportWidth > 0 ? viewportWidth : undefined
  const wideImageStyle = wideImageWidth ? { width: wideImageWidth, maxWidth: 'none' } : undefined
  const imageClassName = isWideFit
    ? 'w-full max-w-none rounded-xl border bg-white shadow-sm'
    : 'max-h-[500px] max-w-full rounded-xl border bg-white shadow-sm'
  return (
    <div className="flex h-full min-h-0 w-full flex-col items-stretch">
      {showToolbar ? (
        <div className="z-20 flex w-full flex-none flex-wrap items-center justify-between gap-1.5 border-b border-zinc-200 bg-white/75 px-2 py-1 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/75">
          {splitMode ? (
            <>
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                <span>拖动虚线调整细分位置</span>
                <span className="rounded-md border border-zinc-200 bg-zinc-50/50 px-2 py-0.5 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50">{Math.round(splitRatio * 100)}%</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button className="h-8 px-2" size="sm" variant="outline" disabled={splitSaving} onClick={onCancelSplit}>取消</Button>
                <Button className="h-8 px-2" size="sm" disabled={splitSaving} onClick={() => onConfirmSplit?.(splitRatio)}>{splitSaving ? '细分中...' : '确认细分'}</Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <select className="h-8 rounded-md border border-zinc-200 bg-white/95 px-2 text-xs font-semibold text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950/95 dark:text-zinc-50" value={usage} onChange={(event) => setUsage(event.target.value)}>
                  <option value="stem">题干图</option>
                  <option value="analysis">解析图</option>
                  <option value="options">选项图</option>
                </select>
                {usage === 'options' ? (
                  <select className="h-8 rounded-md border border-zinc-200 bg-white/95 px-2 text-xs font-semibold text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950/95 dark:text-zinc-50" value={optionLabel} onChange={(event) => setOptionLabel(event.target.value)}>
                    {['A', 'B', 'C', 'D'].map((labelText) => <option key={labelText} value={labelText}>选项 {labelText}</option>)}
                  </select>
                ) : null}
                <Button className="h-8 bg-white/85 px-2" size="sm" variant="outline" onClick={onPreview}>预览</Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button className="h-8 px-2" size="sm" variant="outline" disabled={saving || !figures.length} icon={X} onClick={clearFigures}>清空</Button>
                <Button className="h-8 px-2" size="sm" disabled={saving || rect.width < 5 || rect.height < 5} icon={ImagePlus} onClick={saveRect}>保存</Button>
                <Button className="h-8 px-2" size="sm" variant="danger" disabled={saving || selectedIndex < 0} icon={Trash2} onClick={deleteSelectedFigure}>删除</Button>
              </div>
            </>
          )}
        </div>
      ) : null}
      <div ref={viewportRef} className={`min-h-0 flex-1 overflow-auto ${isWideFit ? 'p-0' : 'grid place-items-center p-4'}`}>
        <div className={`relative select-none ${isWideFit ? 'block' : 'inline-block'}`} style={wideImageStyle} onPointerDown={startDraw} onPointerMove={move} onPointerUp={end} onPointerLeave={end}>
          <img
            ref={imageRef}
            alt="切题预览"
            className={imageClassName}
            draggable={false}
            onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            src={item.imageUrl}
            style={wideImageStyle}
          />
          <div className="pointer-events-none absolute inset-0 bg-zinc-950/5" />
          {splitMode ? (
            <button
              aria-label="拖动细分题块位置"
              className="absolute left-0 z-30 h-8 w-full -translate-y-1/2 cursor-ns-resize"
              onPointerDown={startSplitDrag}
              style={{ top: `${splitRatio * 100}%` }}
              type="button"
            >
              <span
                className="absolute left-0 top-1/2 block h-1 w-full -translate-y-1/2 shadow-[0_0_0_1px_rgba(255,255,255,0.9)]"
                style={{ backgroundImage: 'repeating-linear-gradient(to right, #dc2626 0 16px, transparent 16px 26px)' }}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow">细分线</span>
            </button>
          ) : null}
          {boxes.map((box, index) => {
            const isSelected = index === selectedIndex
            const usageInfo = reviewFigureUsageInfo(figures[index])
            const formulaSuspect = isFormulaSuspectFigure(figures[index])
            const boxClass = formulaSuspect && !isSelected ? 'border-orange-500 bg-orange-100/30' : usageInfo.boxClass
            const labelClass = formulaSuspect && !isSelected ? 'bg-orange-600' : usageInfo.labelClass
            const labelText = formulaSuspect ? '疑似公式' : usageInfo.label
            return (
              <button
                key={`${box.pageNumber}-${index}`}
                className={`absolute rounded-sm border-2 text-left shadow-[0_0_0_1px_rgba(255,255,255,0.85)] ${isSelected ? 'border-amber-500 bg-amber-100/25' : boxClass}`}
                onPointerDown={(event) => selectFigure(index, event, true)}
                style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}
                title={formulaSuspect ? formulaSuspectTitle(figures[index]) : undefined}
                type="button"
              >
                <span className={`absolute left-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${isSelected ? 'bg-amber-500' : labelClass}`}>{labelText} {index + 1}</span>
              </button>
            )
          })}
          {rect.width > 3 && rect.height > 3 ? (
            <div className="absolute cursor-move rounded-sm border-2 border-red-500 bg-rose-50/70" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} onPointerDown={startMove}>
              <span className="absolute left-2 top-2 rounded bg-red-500 px-2 py-0.5 text-[11px] font-medium text-white">{selectedIndex >= 0 ? '编辑选区' : '新图'}</span>
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
      </div>
      {figures.length ? (
        <div className="grid w-full flex-none gap-2 border-t border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40 md:grid-cols-2">
          {figures.map((figure, index) => {
            const isSelected = index === selectedIndex
            return (
              <button
                key={String(figure.id || index)}
                className={`rounded-lg border px-3 py-2 text-left text-xs transition cursor-pointer ${
                  isSelected
                    ? 'border-zinc-900 bg-zinc-50/40 shadow-sm ring-1 ring-zinc-900 dark:border-zinc-100 dark:bg-zinc-900/40 dark:ring-zinc-100 font-semibold'
                    : 'border-zinc-200 bg-white hover:bg-zinc-50/50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50 dark:text-zinc-300'
                }`}
                onClick={() => selectFigureFromTray(index)}
                type="button"
              >
                <span className="font-semibold">{reviewFigureUsageInfo(figure).label} {index + 1}</span>
                <span className="ml-2 text-zinc-500 dark:text-zinc-400">P{Number(figure.page_number ?? figure.pageNumber ?? item.pageStart)}</span>
                {isFormulaSuspectFigure(figure) ? (
                  <span className="ml-2 inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700" title={formulaSuspectTitle(figure)}>
                    疑似公式
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, BadgeCheck, Check, Combine, FileJson, Pencil, RefreshCcw, Split, Trash2, X } from 'lucide-react'
import { pdfSlicerApi } from '@/api/pdfSlicer'
import { ImagePreviewDialog } from '@/components/dialogs/Modal'
import { Badge, Button, Empty, Panel } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { ApiRun, SliceReviewItem } from '@/types'
import { isFormulaSuspectFigure, label } from '@/utils/questionDisplay'
import { ReviewFigureEditor } from './ReviewFigureEditor'

export function SliceReviewDialog({ run, readonly = false, onClose, onSubmitted }: { run: ApiRun; readonly?: boolean; onClose: () => void; onSubmitted: () => void }) {
  const navigate = useNavigate()
  const { data, loading, error, reload } = useAsync<{ summary: Record<string, number>; items: SliceReviewItem[] }>(() => pdfSlicerApi.getSliceReviewItems(run.runId), [run.runId])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState('')
  const [reviewNotice, setReviewNotice] = useState('')
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set())
  const [previewImage, setPreviewImage] = useState<SliceReviewItem | null>(null)
  const [figureOverrides, setFigureOverrides] = useState<Record<string, Array<Record<string, unknown>>>>({})
  const [solutionFigureOverrides, setSolutionFigureOverrides] = useState<Record<string, Array<Record<string, unknown>>>>({})
  const [labelOverrides, setLabelOverrides] = useState<Record<string, string>>({})
  const [batchFigureSaving, setBatchFigureSaving] = useState(false)
  const [splitMode, setSplitMode] = useState(false)
  const [splitSaving, setSplitSaving] = useState(false)
  const [mergeSaving, setMergeSaving] = useState(false)
  const [previewPane, setPreviewPane] = useState<'stem' | 'solution'>('stem')
  const selectionInitialized = useRef(false)
  const visibleItems = (data?.items ?? [])
    .filter((item) => !deletedIds.has(item.resultId))
    .map((item) => ({
      ...item,
      questionLabel: labelOverrides[item.resultId] ?? item.questionLabel,
      figures: figureOverrides[item.resultId] ?? item.figures,
      solutionFigures: solutionFigureOverrides[item.resultId] ?? item.solutionFigures,
    }))
  useEffect(() => {
    if (data?.items.length) {
      setSelected((current) => {
        const validIds = new Set(visibleItems.map((item) => item.resultId))
        if (!selectionInitialized.current) {
          selectionInitialized.current = true
          return new Set(visibleItems.filter((item) => item.reviewStatus !== 'rejected').map((item) => item.resultId))
        }
        return new Set(Array.from(current).filter((id) => validIds.has(id)))
      })
      setActiveId((current) => visibleItems.some((item) => item.resultId === current) ? current : (visibleItems[0]?.resultId ?? ''))
    }
  }, [data, deletedIds])
  const active = visibleItems.find((item) => item.resultId === activeId) ?? visibleItems[0]
  const activeSolutionItem = active?.solutionImageUrl ? {
    ...active,
    resultId: `${active.resultId}__solution`,
    imageUrl: active.solutionImageUrl,
    solutionImageUrl: '',
    solutionImagePath: '',
    hasSolutionSlice: false,
    autoImagePath: active.solutionImagePath || '',
    pageImagePath: active.solutionImagePath || '',
    bbox: active.solutionBbox && Object.keys(active.solutionBbox).length ? active.solutionBbox : active.bbox,
    segments: active.solutionSegments?.length ? active.solutionSegments : active.segments,
    figures: solutionFigureOverrides[active.resultId] ?? active.solutionFigures ?? [],
  } satisfies SliceReviewItem : null
  const totalItems = visibleItems.length
  const allSelected = totalItems > 0 && selected.size === totalItems
  const suspectFormulaTotal = visibleItems.reduce((sum, item) => {
    const stemCount = (item.figures ?? []).filter(isFormulaSuspectFigure).length
    const solutionCount = (item.solutionFigures ?? []).filter(isFormulaSuspectFigure).length
    return sum + stemCount + solutionCount
  }, 0)
  useEffect(() => {
    setSplitMode(false)
    setPreviewPane('stem')
  }, [activeId])
  useEffect(() => {
    if (!activeSolutionItem && previewPane === 'solution') {
      setPreviewPane('stem')
    }
  }, [activeSolutionItem, previewPane])
  async function submit() {
    if (readonly) return
    setReviewNotice('已提交复核，正在启动 OCR...')
    await pdfSlicerApi.quickReview({ runId: run.runId, approvedResultIds: Array.from(selected) })
    onSubmitted()
  }
  async function submitReviewOnly() {
    if (readonly) return
    setReviewNotice('已提交复核。')
    await pdfSlicerApi.quickReview({ runId: run.runId, approvedResultIds: Array.from(selected), autoStartOcr: false })
    onSubmitted()
  }
  async function submitForJsonImport() {
    if (readonly) return
    setReviewNotice('已提交复核，正在跳转到 JSON 导入...')
    await pdfSlicerApi.quickReview({ runId: run.runId, approvedResultIds: Array.from(selected), autoStartOcr: false })
    onClose()
    navigate(`/questions/new?target=paper&method=direct&source=slices&runId=${encodeURIComponent(run.runId)}&prompt=paper`)
  }
  function selectAll() {
    const ids = visibleItems.map((item) => item.resultId)
    setSelected(new Set(ids))
    setReviewNotice(`已选择 ${ids.length} 个题块`)
  }
  function clearAll() {
    setSelected(new Set())
    setReviewNotice('已取消全部选择')
  }
  async function deleteSelected() {
    const deleteIds = Array.from(selected).filter((id) => visibleItems.some((item) => item.resultId === id))
    if (!deleteIds.length) return
    if (!window.confirm(`确定删除已选择的 ${deleteIds.length} 个题块？`)) return
    const deleteSet = new Set(deleteIds)
    const nextItems = visibleItems.filter((item) => !deleteSet.has(item.resultId))
    const nextActive = active && !deleteSet.has(active.resultId) ? active : (nextItems[0] ?? null)
    setDeletedIds((current) => new Set([...current, ...deleteIds]))
    setSelected((current) => {
      const next = new Set(current)
      for (const id of deleteIds) next.delete(id)
      return next
    })
    setActiveId(nextActive?.resultId ?? '')
    setReviewNotice('')
    try {
      await Promise.all(deleteIds.map((id) => pdfSlicerApi.deleteSliceReviewItem(run.runId, id)))
      reload()
    } catch (error) {
      setDeletedIds((current) => {
        const next = new Set(current)
        for (const id of deleteIds) next.delete(id)
        return next
      })
      setSelected((current) => new Set([...current, ...deleteIds]))
      setActiveId(active?.resultId ?? deleteIds[0] ?? '')
      alert(error instanceof Error ? error.message : String(error))
    }
  }
  async function mergeSelected() {
    if (readonly || mergeSaving) return
    const mergeIds = visibleItems.filter((item) => selected.has(item.resultId)).map((item) => item.resultId)
    if (mergeIds.length < 2) return
    if (!window.confirm(`将按左侧列表顺序合并 ${mergeIds.length} 个题块，并保留第一个题块作为合并结果。是否继续？`)) return
    setMergeSaving(true)
    try {
      const payload = await pdfSlicerApi.mergeSliceReviewItems(run.runId, mergeIds)
      const mergedId = payload.mergedId || mergeIds[0]
      const removedIds = new Set(payload.removedIds ?? mergeIds.slice(1))
      setDeletedIds((current) => {
        const next = new Set(current)
        for (const id of removedIds) next.delete(id)
        return next
      })
      setSelected((current) => {
        const next = new Set(current)
        for (const id of removedIds) next.delete(id)
        next.add(mergedId)
        return next
      })
      setActiveId(mergedId)
      setReviewNotice(`已按顺序合并 ${mergeIds.length} 个题块`)
      await reload({ silent: true })
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      setMergeSaving(false)
    }
  }
  async function deleteAllSuspectFormulaFigures() {
    const affectedItems = visibleItems
      .map((item) => {
        const figures = item.figures ?? []
        const solutionFigures = item.solutionFigures ?? []
        const stemSuspectCount = figures.filter(isFormulaSuspectFigure).length
        const solutionSuspectCount = solutionFigures.filter(isFormulaSuspectFigure).length
        return {
          item,
          nextFigures: figures.filter((figure) => !isFormulaSuspectFigure(figure)),
          nextSolutionFigures: solutionFigures.filter((figure) => !isFormulaSuspectFigure(figure)),
          stemSuspectCount,
          solutionSuspectCount,
          suspectCount: stemSuspectCount + solutionSuspectCount,
        }
      })
      .filter((entry) => entry.suspectCount > 0)
    const totalSuspects = affectedItems.reduce((sum, entry) => sum + entry.suspectCount, 0)
    if (!totalSuspects) return
    const solutionSuspects = affectedItems.reduce((sum, entry) => sum + entry.solutionSuspectCount, 0)
    const stemSuspects = totalSuspects - solutionSuspects
    if (!window.confirm(`确定删除本批次 ${affectedItems.length} 个题块中的 ${totalSuspects} 个疑似公式图？其中题干 ${stemSuspects} 个，解析 ${solutionSuspects} 个。`)) return
    setBatchFigureSaving(true)
    try {
      const savedEntries = await Promise.all(affectedItems.map(async ({ item, nextFigures, nextSolutionFigures, stemSuspectCount, solutionSuspectCount }) => {
        const stemPayload = stemSuspectCount > 0
          ? await pdfSlicerApi.updateSliceReviewItemFigures(run.runId, item.resultId, nextFigures)
          : null
        const solutionPayload = solutionSuspectCount > 0 && item.hasSolutionSlice
          ? await pdfSlicerApi.updateSliceReviewItemSolutionFigures(run.runId, item.resultId, nextSolutionFigures)
          : null
        return {
          resultId: item.resultId,
          figures: stemPayload?.item?.figures ?? nextFigures,
          solutionFigures: solutionPayload?.item?.solutionFigures ?? nextSolutionFigures,
          stemSuspectCount,
          solutionSuspectCount,
        }
      }))
      setFigureOverrides((current) => {
        const next = { ...current }
        for (const entry of savedEntries) {
          if (entry.stemSuspectCount > 0) next[entry.resultId] = entry.figures
        }
        return next
      })
      setSolutionFigureOverrides((current) => {
        const next = { ...current }
        for (const entry of savedEntries) {
          if (entry.solutionSuspectCount > 0) next[entry.resultId] = entry.solutionFigures
        }
        return next
      })
      setReviewNotice(`已删除 ${affectedItems.length} 个题块中的 ${totalSuspects} 个疑似公式图（题干 ${stemSuspects}，解析 ${solutionSuspects}）`)
      reload({ silent: true })
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      setBatchFigureSaving(false)
    }
  }
  function toggle(id: string) {
    if (readonly) return
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
    setReviewNotice('')
  }
  async function saveReviewFigures(item: SliceReviewItem, figures: Array<Record<string, unknown>>) {
    const payload = await pdfSlicerApi.updateSliceReviewItemFigures(run.runId, item.resultId, figures)
    const nextFigures = payload.item?.figures ?? figures
    setFigureOverrides((current) => ({ ...current, [item.resultId]: nextFigures }))
    setReviewNotice(`已保存第 ${item.questionLabel || '?'} 题的 ${nextFigures.length} 个图框`)
  }
  async function saveSolutionFigures(item: SliceReviewItem, figures: Array<Record<string, unknown>>) {
    const sourceResultId = item.resultId.replace(/__solution$/, '')
    const payload = await pdfSlicerApi.updateSliceReviewItemSolutionFigures(run.runId, sourceResultId, figures)
    const nextFigures = payload.item?.solutionFigures ?? figures
    setSolutionFigureOverrides((current) => ({ ...current, [sourceResultId]: nextFigures }))
    setReviewNotice(`已保存第 ${item.questionLabel || '?'} 题解析裁图的 ${nextFigures.length} 个图框`)
    reload({ silent: true })
  }
  async function renameItem(item: SliceReviewItem) {
    if (readonly) return
    const nextLabel = window.prompt('编辑题块名称', item.questionLabel || '')
    if (nextLabel === null) return
    const cleaned = nextLabel.trim()
    if (!cleaned) return
    const payload = await pdfSlicerApi.updateSliceReviewItem(run.runId, item.resultId, { questionLabel: cleaned })
    setLabelOverrides((current) => ({ ...current, [item.resultId]: payload.item?.questionLabel ?? cleaned }))
    setReviewNotice(`已更新题块名称：${payload.item?.questionLabel ?? cleaned}`)
    reload({ silent: true })
  }
  async function splitActive(splitRatio: number) {
    if (!active || readonly) return
    setSplitSaving(true)
    try {
      const payload = await pdfSlicerApi.splitSliceReviewItem(run.runId, active.resultId, splitRatio)
      setSplitMode(false)
      setReviewNotice(`已将第 ${active.questionLabel || '?'} 题细分为两个题块`)
      const next = await reload({ silent: true })
      const bottomId = payload.bottomId
      if (bottomId && next?.items.some((item) => item.resultId === bottomId)) {
        setActiveId(bottomId)
        setSelected((current) => new Set([...current, bottomId]))
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      setSplitSaving(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex select-none items-center justify-center bg-black/40 p-4 text-left">
      <div className="flex h-[90vh] w-full max-w-[88rem] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-none items-center justify-between gap-4 border-b border-zinc-200 bg-zinc-50/70 px-5 py-3.5 dark:border-zinc-800 dark:bg-zinc-900/10">
          <div className="min-w-0">
            <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{readonly ? '题块查看' : '切题人工复核控制台'}</span>
            <span className="mt-0.5 block truncate text-[11px] text-zinc-400 dark:text-zinc-500">
              来源：{run.paperTitle || run.pdfName} · 共 {totalItems} 个题块 · 当前选中 {readonly ? (run.approvedQuestions ?? 0) : selected.size} 项
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {readonly ? null : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  icon={Trash2}
                  disabled={batchFigureSaving || !suspectFormulaTotal}
                  onClick={deleteAllSuspectFormulaFigures}
                >
                  {batchFigureSaving ? '删除中...' : `疑似公式图 ${suspectFormulaTotal}`}
                </Button>
                <Button
                  size="sm"
                  variant={splitMode ? 'default' : 'outline'}
                  icon={Split}
                  disabled={!active || splitSaving}
                  onClick={() => {
                    setPreviewPane('stem')
                    setSplitMode((value) => !value)
                  }}
                >
                  {splitMode ? '取消拆分' : '在此处拆分题块'}
                </Button>
              </>
            )}
            <button
              className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              onClick={onClose}
              type="button"
            >
              <X className="size-4.5" />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex min-h-0 w-80 shrink-0 flex-col overflow-hidden border-r border-zinc-200 bg-zinc-50/20 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-none items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">切片队列</p>
            <div className="flex items-center gap-1.5">
              {readonly ? null : (
                <>
                  <button className="text-[10px] font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300" onClick={selectAll} type="button">全选</button>
                  <span className="text-zinc-200 dark:text-zinc-800">|</span>
                  <button className="text-[10px] font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300" onClick={clearAll} type="button">清空</button>
                </>
              )}
              <button className="ml-1 inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-2 py-1 text-[10px] font-semibold text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" onClick={() => reload()} type="button">
                <RefreshCcw className="size-3" /> 刷新
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
            {loading ? <Empty text="读取中..." /> : error ? <Empty text={error} /> : visibleItems.length ? visibleItems.map((item) => {
              const isActive = active?.resultId === item.resultId
              const isSelected = selected.has(item.resultId)
              const figureCount = (item.figures?.length ?? 0) + (item.solutionFigures?.length ?? 0)
              const itemClass = isActive
                ? 'border-zinc-900 bg-zinc-50/40 shadow-sm ring-1 ring-zinc-900 dark:border-zinc-100 dark:bg-zinc-900/40 dark:ring-zinc-100'
                : isSelected
                  ? 'border-zinc-400 bg-white dark:border-zinc-700 dark:bg-zinc-950/60'
                  : 'border-zinc-200 bg-white hover:bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50'
              return (
              <button key={item.resultId} className={`w-full rounded-lg border p-2.5 text-left transition cursor-pointer ${itemClass}`} onClick={() => setActiveId(item.resultId)} type="button">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-semibold text-zinc-900 dark:text-zinc-50 text-sm">第 {item.questionLabel || '?'} 题</span>
                    {readonly ? null : (
                      <span
                        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                        onClick={(event) => {
                          event.stopPropagation()
                          renameItem(item)
                        }}
                        role="button"
                        title="编辑题块名称"
                      >
                        <Pencil className="size-3.5" />
                      </span>
                    )}
                  </span>
                  {readonly ? null : (
                    <input
                      checked={selected.has(item.resultId)}
                      onChange={() => toggle(item.resultId)}
                      onClick={(event) => event.stopPropagation()}
                      type="checkbox"
                      className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 cursor-pointer"
                    />
                  )}
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="min-w-0 text-xs text-zinc-500 dark:text-zinc-400">P{item.pageStart}{item.pageEnd !== item.pageStart ? `-P${item.pageEnd}` : ''} · {label(item.reviewStatus)}</p>
                  <span className="flex shrink-0 items-center gap-1">
                    {item.hasSolutionSlice ? (
                      <Badge variant="success" className="text-[10px] px-1.5 py-0">
                        含解析
                      </Badge>
                    ) : null}
                    {figureCount ? (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        题图 {figureCount} 张
                      </Badge>
                    ) : null}
                  </span>
                </div>
              </button>
            )}) : <Empty text="暂无切题结果，上传后系统会自动切题。" />}
          </div>
        </aside>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-zinc-100 dark:bg-zinc-900">
          <div className="flex min-h-11 flex-none items-center justify-between border-b border-zinc-200 bg-zinc-50/50 px-4 dark:border-zinc-800 dark:bg-zinc-950/40">
            <p className="font-semibold text-zinc-900 dark:text-zinc-50 text-sm">{active ? `第 ${active.questionLabel || '?'} 题预览` : '切片预览'}</p>
            <div className="flex items-center gap-2">
              {activeSolutionItem ? (
                <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                  <button
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${previewPane === 'stem' ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-950' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100'}`}
                    onClick={() => setPreviewPane('stem')}
                    type="button"
                  >
                    题干图 {active.figures?.length ?? 0}
                  </button>
                  <button
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${previewPane === 'solution' ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-950' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100'}`}
                    onClick={() => {
                      setSplitMode(false)
                      setPreviewPane('solution')
                    }}
                    type="button"
                  >
                    解析图 {activeSolutionItem.figures?.length ?? 0}
                  </button>
                </div>
              ) : null}
              <Badge variant="outline">{active ? `P${active.pageStart}` : '未选择'}</Badge>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {active?.imageUrl ? (
              <div className="flex h-full min-h-0 flex-col">
                {previewPane === 'stem' || !activeSolutionItem ? (
                  <ReviewFigureEditor
                    item={active}
                    splitMode={splitMode}
                    splitSaving={splitSaving}
                    onCancelSplit={() => setSplitMode(false)}
                    onConfirmSplit={splitActive}
                    onPreview={() => setPreviewImage(active)}
                    onSave={(figures) => saveReviewFigures(active, figures)}
                  />
                ) : (
                  <ReviewFigureEditor
                    item={activeSolutionItem}
                    defaultUsage="analysis"
                    onPreview={() => setPreviewImage(activeSolutionItem)}
                    onSave={(figures) => saveSolutionFigures(activeSolutionItem, figures)}
                  />
                )}
              </div>
            ) : <Empty text="没有可预览图片。" />}
          </div>
        </section>
        <aside className="flex min-h-0 w-80 shrink-0 flex-col border-l border-zinc-200 dark:border-zinc-800">
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          <section className="space-y-3">
            <h3 className="px-1 text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">复核信息</h3>
            <div className="space-y-3">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">当前题块</p>
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <p className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">{active ? `第 ${active.questionLabel || '?'} 题` : '未选择'}</p>
                  <Badge variant={active?.reviewStatus === 'rejected' ? 'danger' : active?.reviewStatus === 'approved' ? 'success' : 'default'}>
                    {active ? label(active.reviewStatus) : '-'}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-900/30">
                    <p className="text-zinc-400 dark:text-zinc-50">页码</p>
                    <p className="mt-0.5 font-semibold text-zinc-800 dark:text-zinc-200">{active ? `P${active.pageStart}-${active.pageEnd}` : '-'}</p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-900/30">
                    <p className="text-zinc-400 dark:text-zinc-50">图框</p>
                    <p className="mt-0.5 font-semibold text-zinc-800 dark:text-zinc-200">{active?.figures?.length ? `${active.figures.length} 个` : '无'}</p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-900/30">
                    <p className="text-zinc-400 dark:text-zinc-50">解析裁图</p>
                    <p className="mt-0.5 font-semibold text-zinc-800 dark:text-zinc-200">{active?.hasSolutionSlice ? '已匹配' : '无'}</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
          {active && suspectFormulaTotal ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/30 p-3 text-[11px] leading-normal text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
              <div className="mb-1 flex items-center gap-1.5 font-bold">
                <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400" />
                <span>OCR 切题提醒</span>
              </div>
              <p>检测到 {suspectFormulaTotal} 个疑似公式图，可按需删除后再提交复核。</p>
            </div>
          ) : null}
          {readonly ? null : <Panel title="操作">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Button className="w-full" icon={Check} disabled={!totalItems || allSelected} onClick={selectAll}>全选</Button>
                <Button className="w-full" variant="outline" icon={X} disabled={!selected.size} onClick={clearAll}>清空</Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button className="w-full" variant="outline" icon={Combine} disabled={mergeSaving || selected.size < 2} onClick={mergeSelected}>
                  {mergeSaving ? '合并中...' : `合并 (${selected.size})`}
                </Button>
                <Button className="w-full" variant="danger" icon={Trash2} disabled={!selected.size} onClick={deleteSelected}>
                  丢弃 ({selected.size})
                </Button>
              </div>
              <div className="space-y-2.5 border-t border-zinc-200 dark:border-zinc-800 pt-4">
                <Button className="w-full justify-start" variant="outline" icon={Check} disabled={!selected.size} onClick={submitReviewOnly}>仅提交复核（{selected.size}/{totalItems}）</Button>
                <Button className="w-full justify-start" variant="outline" icon={FileJson} disabled={!selected.size} onClick={submitForJsonImport}>提交复核并手动导入（{selected.size}/{totalItems}）</Button>
                <Button className="w-full justify-start" icon={BadgeCheck} disabled={!selected.size} onClick={submit}>提交复核并开始 OCR（{selected.size}/{totalItems}）</Button>
              </div>
              {reviewNotice ? <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">{reviewNotice}</p> : null}
            </div>
          </Panel>}
          </div>
        </aside>
      </div>
      {previewImage ? <ImagePreviewDialog item={previewImage} onClose={() => setPreviewImage(null)} /> : null}
      </div>
    </div>
  )
}

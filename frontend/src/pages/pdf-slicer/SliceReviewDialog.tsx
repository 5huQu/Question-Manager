import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BadgeCheck, Check, Combine, FileJson, Pencil, RefreshCcw, Scissors, Trash2, X } from 'lucide-react'
import { pdfSlicerApi } from '@/api/pdfSlicer'
import { ImagePreviewDialog, Modal } from '@/components/dialogs/Modal'
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
  const [labelOverrides, setLabelOverrides] = useState<Record<string, string>>({})
  const [batchFigureSaving, setBatchFigureSaving] = useState(false)
  const [splitMode, setSplitMode] = useState(false)
  const [splitSaving, setSplitSaving] = useState(false)
  const [mergeSaving, setMergeSaving] = useState(false)
  const selectionInitialized = useRef(false)
  const visibleItems = (data?.items ?? [])
    .filter((item) => !deletedIds.has(item.resultId))
    .map((item) => ({
      ...item,
      questionLabel: labelOverrides[item.resultId] ?? item.questionLabel,
      figures: figureOverrides[item.resultId] ?? item.figures,
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
  const totalItems = visibleItems.length
  const allSelected = totalItems > 0 && selected.size === totalItems
  const suspectFormulaTotal = visibleItems.reduce((sum, item) => sum + (item.figures ?? []).filter(isFormulaSuspectFigure).length, 0)
  useEffect(() => {
    setSplitMode(false)
  }, [activeId])
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
        return {
          item,
          nextFigures: figures.filter((figure) => !isFormulaSuspectFigure(figure)),
          suspectCount: figures.filter(isFormulaSuspectFigure).length,
        }
      })
      .filter((entry) => entry.suspectCount > 0)
    const totalSuspects = affectedItems.reduce((sum, entry) => sum + entry.suspectCount, 0)
    if (!totalSuspects) return
    if (!window.confirm(`确定删除本批次 ${affectedItems.length} 个题块中的 ${totalSuspects} 个疑似公式图？`)) return
    setBatchFigureSaving(true)
    try {
      const savedEntries = await Promise.all(affectedItems.map(async ({ item, nextFigures }) => {
        const payload = await pdfSlicerApi.updateSliceReviewItemFigures(run.runId, item.resultId, nextFigures)
        return { resultId: item.resultId, figures: payload.item?.figures ?? nextFigures }
      }))
      setFigureOverrides((current) => {
        const next = { ...current }
        for (const entry of savedEntries) {
          next[entry.resultId] = entry.figures
        }
        return next
      })
      setReviewNotice(`已删除 ${affectedItems.length} 个题块中的 ${totalSuspects} 个疑似公式图`)
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
    <Modal
      title={readonly ? '题块查看' : '切题复核'}
      desc={readonly ? `来源：${run.paperTitle || run.pdfName}。` : `来源：${run.paperTitle || run.pdfName}。可仅提交复核，也可继续手动导入或开始 OCR。`}
      actions={readonly ? null : (
        <>
          <Button
            size="sm"
            variant="outline"
            icon={Trash2}
            disabled={batchFigureSaving || !suspectFormulaTotal}
            onClick={deleteAllSuspectFormulaFigures}
          >
            {batchFigureSaving ? '删除中...' : `删除疑似公式图（${suspectFormulaTotal}）`}
          </Button>
          <Button size="sm" variant={splitMode ? 'default' : 'outline'} icon={Scissors} disabled={!active || splitSaving} onClick={() => setSplitMode((value) => !value)}>
            细分题块
          </Button>
        </>
      )}
      onClose={onClose}
      wide
      locked
    >
      <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)_300px]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-zinc-50">
          <div className="flex flex-none items-center justify-between border-b px-3 py-2">
            <p className="font-semibold">切片列表</p>
            <Button size="sm" variant="outline" icon={RefreshCcw} onClick={reload}>刷新</Button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
            {loading ? <Empty text="读取中..." /> : error ? <Empty text={error} /> : visibleItems.length ? visibleItems.map((item) => {
              const isActive = active?.resultId === item.resultId
              const isSelected = selected.has(item.resultId)
              return (
              <button key={item.resultId} className={`w-full rounded-xl border p-3 text-left transition ${isActive ? 'border-blue-600 bg-blue-50 shadow-sm ring-2 ring-blue-200' : isSelected ? 'border-sky-300 bg-sky-50/60' : 'bg-white hover:bg-zinc-50'}`} onClick={() => setActiveId(item.resultId)} type="button">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-semibold">第 {item.questionLabel || '?'} 题</span>
                    {readonly ? null : (
                      <span
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border bg-white text-zinc-500 hover:border-blue-300 hover:text-blue-700"
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
                  {readonly ? null : <input checked={selected.has(item.resultId)} onChange={() => toggle(item.resultId)} onClick={(event) => event.stopPropagation()} type="checkbox" />}
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="min-w-0 text-xs text-zinc-500">P{item.pageStart}{item.pageEnd !== item.pageStart ? `-P${item.pageEnd}` : ''} · {label(item.reviewStatus)}</p>
                  {item.figures?.length ? (
                    <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                      题图{item.figures.length}张
                    </span>
                  ) : null}
                </div>
              </button>
            )}) : <Empty text="暂无切题结果，上传后系统会自动切题。" />}
          </div>
        </aside>
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-zinc-100">
          <div className="flex min-h-11 flex-none items-center justify-between border-b bg-white px-4">
            <p className="font-semibold">{active ? `第 ${active.questionLabel || '?'} 题预览` : '切片预览'}</p>
            <Badge>{active ? `P${active.pageStart}` : '未选择'}</Badge>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {active?.imageUrl ? (
              <ReviewFigureEditor
                item={active}
                splitMode={splitMode}
                splitSaving={splitSaving}
                onCancelSplit={() => setSplitMode(false)}
                onConfirmSplit={splitActive}
                onPreview={() => setPreviewImage(active)}
                onSave={(figures) => saveReviewFigures(active, figures)}
              />
            ) : <Empty text="没有可预览图片。" />}
          </div>
        </section>
        <aside className="min-h-0 space-y-3 overflow-auto pr-1">
          <section className="space-y-3">
            <h3 className="px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">复核信息</h3>
            <div className="space-y-3">
              <div className="rounded-xl border bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
                <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">当前题块</p>
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <p className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">{active ? `第 ${active.questionLabel || '?'} 题` : '未选择'}</p>
                  <Badge>{active ? label(active.reviewStatus) : '-'}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border bg-white px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-950/60">
                    <p className="text-zinc-400 dark:text-zinc-500">页码</p>
                    <p className="mt-0.5 font-semibold text-zinc-800 dark:text-zinc-200">{active ? `P${active.pageStart}-${active.pageEnd}` : '-'}</p>
                  </div>
                  <div className="rounded-lg border bg-white px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-950/60">
                    <p className="text-zinc-400 dark:text-zinc-500">图框</p>
                    <p className="mt-0.5 font-semibold text-zinc-800 dark:text-zinc-200">{active?.figures?.length ? `${active.figures.length} 个` : '无'}</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/60">
                  <p className="text-[11px] text-zinc-500">总切片</p>
                  <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{totalItems}</p>
                </div>
                <div className="rounded-xl border bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/60">
                  <p className="text-[11px] text-zinc-500">{readonly ? '通过数' : '已选择'}</p>
                  <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{readonly ? (run.approvedQuestions ?? 0) : selected.size}</p>
                </div>
              </div>
            </div>
          </section>
          {readonly ? null : <Panel title="操作">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Button className="w-full" icon={Check} disabled={!totalItems || allSelected} onClick={selectAll}>全选</Button>
                <Button className="w-full" variant="outline" icon={X} disabled={!selected.size} onClick={clearAll}>清空</Button>
              </div>
              <Button className="w-full justify-start" variant="outline" icon={Combine} disabled={mergeSaving || selected.size < 2} onClick={mergeSelected}>
                {mergeSaving ? '合并中...' : `按顺序合并已选择题块（${selected.size}）`}
              </Button>
              <Button className="w-full justify-start" variant="danger" icon={Trash2} disabled={!selected.size} onClick={deleteSelected}>删除已选择题块（{selected.size}）</Button>
              <div className="space-y-2.5 border-t pt-4">
                <Button className="w-full justify-start" variant="outline" icon={Check} disabled={!selected.size} onClick={submitReviewOnly}>仅提交复核（{selected.size}/{totalItems}）</Button>
                <Button className="w-full justify-start" variant="outline" icon={FileJson} disabled={!selected.size} onClick={submitForJsonImport}>提交复核并手动导入（{selected.size}/{totalItems}）</Button>
                <Button className="w-full justify-start" icon={BadgeCheck} disabled={!selected.size} onClick={submit}>提交复核并开始 OCR（{selected.size}/{totalItems}）</Button>
              </div>
              {reviewNotice ? <p className="rounded-lg border bg-zinc-50 px-2.5 py-2 text-xs text-zinc-500">{reviewNotice}</p> : null}
            </div>
          </Panel>}
        </aside>
      </div>
      {previewImage ? <ImagePreviewDialog item={previewImage} onClose={() => setPreviewImage(null)} /> : null}
    </Modal>
  )
}

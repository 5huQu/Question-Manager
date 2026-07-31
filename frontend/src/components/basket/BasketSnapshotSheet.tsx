import { useMemo, useState } from 'react'
import { ChevronRight, FileText, Search, Trash2 } from 'lucide-react'
import type { CollectionSummary } from '../../types'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet'
import type { BasketState } from './useBasketState'

interface BasketSnapshotSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: BasketState
}

/** 已加载试题篮状态上的快照面板；打开时不触发路由切换或重新拉取列表。 */
export function BasketSnapshotSheet({ open, onOpenChange, state }: BasketSnapshotSheetProps) {
  const [query, setQuery] = useState('')
  const snapshots = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase()
    if (!keyword) return state.savedPapers
    return state.savedPapers.filter((paper) => (
      `${paper.title || ''} ${paper.subtitle || ''}`.toLocaleLowerCase().includes(keyword)
    ))
  }, [query, state.savedPapers])

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (!nextOpen) setQuery('')
  }

  function openSnapshot(paperId: string) {
    handleOpenChange(false)
    state.openPaper(paperId)
  }

  function renderSnapshotRow(paper: CollectionSummary) {
    const isActive = state.editingPaperId === paper.id
    return (
      <div key={paper.id} className={`group relative overflow-hidden rounded-lg border transition-all duration-150 ${isActive ? 'border-zinc-900 bg-zinc-50 shadow-sm dark:border-zinc-100 dark:bg-zinc-900/70' : 'border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700'}`}>
        {isActive ? <span className="absolute inset-y-0 left-0 w-[3px] bg-zinc-900 dark:bg-zinc-100" /> : null}
        <div className="flex items-center">
          <button type="button" onClick={() => openSnapshot(paper.id)} title="打开并编辑这份组卷快照" className={`flex min-w-0 flex-1 items-center gap-2.5 py-2.5 pr-2 text-left ${isActive ? 'pl-4' : 'pl-3.5'}`}>
            <FileText className={`size-4 shrink-0 ${isActive ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-500'}`} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[13px] font-semibold leading-snug ${isActive ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-700 dark:text-zinc-300'}`}>{paper.title}</span>
              <span className="block text-[10px] text-zinc-400 dark:text-zinc-500">{paper.questionCount} 题 · {paper.totalScore || 0} 分{paper.updatedAt ? ` · ${new Date(paper.updatedAt).toLocaleDateString()}` : ''}</span>
            </span>
            {isActive ? (
              <span className="shrink-0 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-zinc-600 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">编辑中</span>
            ) : (
              <ChevronRight className="size-4 shrink-0 text-zinc-300 opacity-0 transition-opacity duration-150 group-hover:opacity-100 dark:text-zinc-600" />
            )}
          </button>
          <button type="button" onClick={() => void state.deletePaper(paper)} title="删除组卷快照" className="mr-2 shrink-0 rounded p-1.5 text-zinc-300 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-zinc-600 dark:hover:bg-red-950/30 dark:hover:text-red-400">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        overlayClassName="basket-snapshot-sheet-overlay"
        className="basket-snapshot-sheet w-full gap-0 border-zinc-200 bg-white p-0 dark:border-zinc-800 dark:bg-zinc-950 sm:max-w-lg"
      >
        <SheetHeader className="border-b border-zinc-100 px-5 py-4 pr-14 text-left dark:border-zinc-800">
          <SheetTitle className="text-base">组卷快照</SheetTitle>
          <SheetDescription className="text-xs">恢复、重命名或删除已保存的题目组合。</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-5">
          <label className="relative shrink-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              aria-label="搜索组卷快照"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索快照标题"
              className="h-9 w-full rounded-md border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
            />
          </label>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {snapshots.length ? snapshots.map(renderSnapshotRow) : (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-200 px-4 py-12 text-center dark:border-zinc-800">
                <FileText className="size-7 text-zinc-300 dark:text-zinc-700" />
                <p className="mt-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">{state.savedPapers.length ? '没有匹配的组卷快照' : '还没有保存的组卷快照'}</p>
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">整理好题目后，可在下方保存为快照。</p>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

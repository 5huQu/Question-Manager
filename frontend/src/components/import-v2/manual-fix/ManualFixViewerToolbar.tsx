import { ChevronLeft, ChevronRight } from 'lucide-react'

interface SourceProfile { pageCount?: number; pdfName?: string }
interface Props {
  pageBrowseMode: 'manual' | 'continuous'
  regionView: 'all' | 'question' | 'solution'
  sourceProfiles: Array<[string, SourceProfile]>
  activeSourceDocumentId: string
  currentPage: number
  maxPages: number
  onBrowseModeChange: (mode: 'manual' | 'continuous') => void
  onRegionViewChange: (view: 'all' | 'question' | 'solution') => void
  onSourceChange: (sourceId: string) => void
  onPageChange: (page: number) => void
}

const selectorClass = 'flex rounded-lg border border-zinc-200/50 bg-zinc-100/80 p-0.5 dark:border-zinc-800/50 dark:bg-zinc-900/80'
const optionClass = (active: boolean) => `rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${active ? 'border border-zinc-200/20 bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`

export function ManualFixViewerToolbar(props: Props) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold text-zinc-700 dark:text-zinc-300">文档与选区</span>
        <div className={selectorClass}>{(['manual', 'continuous'] as const).map((value) => <button key={value} type="button" onClick={() => props.onBrowseModeChange(value)} className={optionClass(props.pageBrowseMode === value)}>{value === 'manual' ? '手动翻页' : '连续翻页'}</button>)}</div>
        <div className={selectorClass}>{(['all', 'question', 'solution'] as const).map((value) => <button key={value} type="button" onClick={() => props.onRegionViewChange(value)} className={optionClass(props.regionView === value)}>{value === 'all' ? '全部' : value === 'question' ? '题干' : '解析'}</button>)}</div>
        {props.sourceProfiles.length > 1 && <div className={selectorClass}>{props.sourceProfiles.map(([sourceId, profile], index) => <button key={sourceId} type="button" onClick={() => props.onSourceChange(sourceId)} className={`${optionClass(props.activeSourceDocumentId === sourceId)} max-w-36 truncate`} title={profile.pdfName || sourceId}>{index === 0 ? '原卷' : '答案'}</button>)}</div>}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="上一页" disabled={props.currentPage <= 1 || props.pageBrowseMode === 'continuous'} onClick={() => props.onPageChange(props.currentPage - 1)} className="rounded-md p-1 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"><ChevronLeft className="size-4" /></button>
        <span className="font-mono">{props.currentPage} / {props.maxPages} 页</span>
        <button type="button" aria-label="下一页" disabled={props.currentPage >= props.maxPages || props.pageBrowseMode === 'continuous'} onClick={() => props.onPageChange(props.currentPage + 1)} className="rounded-md p-1 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"><ChevronRight className="size-4" /></button>
      </div>
    </div>
  )
}

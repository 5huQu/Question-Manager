import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

export function BankPagination({
  page,
  totalItems,
  pageSize = 20,
  setPage,
}: {
  page: number
  totalItems: number
  pageSize?: number
  setPage: (value: number | ((value: number) => number)) => void
}) {
  const totalPages = Math.ceil(totalItems / pageSize)
  if (totalPages <= 1) return null

  const startPage = Math.max(1, page - 2)
  const endPage = Math.min(totalPages, page + 2)
  const pages: number[] = []
  for (let i = startPage; i <= endPage; i++) {
    pages.push(i)
  }

  return (
    <div className="question-edit-glass-tabs flex items-center gap-1 p-0.5 rounded-lg border border-black/6 dark:border-white/8">
      <button
        type="button"
        onClick={() => setPage(1)}
        disabled={page === 1}
        className="flex size-6.5 items-center justify-center rounded text-zinc-500 hover:bg-black/5 hover:text-zinc-900 disabled:opacity-30 disabled:pointer-events-none dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100 cursor-pointer transition-colors"
        title="第一页"
        aria-label="第一页"
      >
        <ChevronsLeft className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={() => setPage((p: number) => Math.max(1, p - 1))}
        disabled={page === 1}
        className="flex size-6.5 items-center justify-center rounded text-zinc-500 hover:bg-black/5 hover:text-zinc-900 disabled:opacity-30 disabled:pointer-events-none dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100 cursor-pointer transition-colors"
        title="上一页"
        aria-label="上一页"
      >
        <ChevronLeft className="size-3.5" />
      </button>

      {pages.map((p) => {
        const isActive = p === page
        return (
          <button
            key={p}
            type="button"
            onClick={() => setPage(p)}
            aria-label={`第 ${p} 页`}
            className={`flex size-6.5 items-center justify-center rounded text-xs font-medium transition-all cursor-pointer ${
              isActive
                ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-950 shadow-xs"
                : "text-zinc-600 hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100"
            }`}
          >
            {p}
          </button>
        )
      })}

      <button
        type="button"
        onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))}
        disabled={page === totalPages}
        className="flex size-6.5 items-center justify-center rounded text-zinc-500 hover:bg-black/5 hover:text-zinc-900 disabled:opacity-30 disabled:pointer-events-none dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100 cursor-pointer transition-colors"
        title="下一页"
        aria-label="下一页"
      >
        <ChevronRight className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={() => setPage(totalPages)}
        disabled={page === totalPages}
        className="flex size-6.5 items-center justify-center rounded text-zinc-500 hover:bg-black/5 hover:text-zinc-900 disabled:opacity-30 disabled:pointer-events-none dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100 cursor-pointer transition-colors"
        title="最后一页"
        aria-label="最后一页"
      >
        <ChevronsRight className="size-3.5" />
      </button>
    </div>
  )
}

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
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setPage(1)}
        disabled={page === 1}
        className="size-7 rounded border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-40 disabled:pointer-events-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 cursor-pointer transition-colors flex items-center justify-center"
        title="第一页"
      >
        <ChevronsLeft className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={() => setPage((p: number) => Math.max(1, p - 1))}
        disabled={page === 1}
        className="size-7 rounded border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-40 disabled:pointer-events-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 cursor-pointer transition-colors flex items-center justify-center"
        title="上一页"
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
            className={`size-7 rounded border text-xs font-semibold transition-all cursor-pointer flex items-center justify-center ${
              isActive
                ? "bg-zinc-900 border-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-950 shadow-xs"
                : "border-zinc-200 bg-white text-zinc-650 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900"
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
        className="size-7 rounded border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-40 disabled:pointer-events-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 cursor-pointer transition-colors flex items-center justify-center"
        title="下一页"
      >
        <ChevronRight className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={() => setPage(totalPages)}
        disabled={page === totalPages}
        className="size-7 rounded border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-40 disabled:pointer-events-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 cursor-pointer transition-colors flex items-center justify-center"
        title="最后一页"
      >
        <ChevronsRight className="size-3.5" />
      </button>
    </div>
  )
}

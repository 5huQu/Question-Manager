import { BookOpenCheck, CheckCircle2, Download, Plus, Trash2 } from 'lucide-react'
import { Badge, Button, Empty } from '@/components/ui'
import type { LearningTagsController } from './useLearningTags'
import { stageLabel, stats, typeMeta } from './utils'

export function LibraryListPanel({ controller }: { controller: LearningTagsController }) {
  const {
    libraries,
    selectedId,
    loading,
    activeLibrary,
    activeMeta,
    activeStats,
    validationError,
    saveState,
    statusLabel,
    selectLibrary,
    openAddDialog,
    exportLibrary,
    deleteLibrary,
  } = controller

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-zinc-200 bg-white p-4 text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-muted-foreground" />
            <h2 className="font-semibold">已安装标签库</h2>
          </div>
          <Button size="sm" variant="outline" icon={Plus} onClick={openAddDialog}>新增</Button>
        </div>
        <div className="mt-3 grid max-h-[480px] gap-2 overflow-y-auto pr-1">
          {loading ? <Empty text="正在加载标签库..." /> : null}
          {!loading && !libraries.length ? <Empty text="还没有标签库，先新增一个。" /> : null}
          {libraries.map((library) => {
            const selected = library.id === selectedId
            const itemStats = stats(library)
            const meta = typeMeta(library.libraryType)
            return (
              <article key={library.id} className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl border p-3 transition ${selected ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900' : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900'}`}>
                <button className="min-w-0 text-left" onClick={() => selectLibrary(library)} type="button">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="break-words text-sm font-semibold">{library.name}</span>
                    <Badge>{meta.label}</Badge>
                    {library.isDefault ? <Badge variant="success">默认</Badge> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{library.subject}</span>
                    <span>{stageLabel(library.stage)}</span>
                    <span>{itemStats.sections} {meta.sectionLabel}</span>
                    <span>{itemStats.points} {meta.pointLabel}</span>
                  </div>
                </button>
                <Button size="sm" icon={Download} onClick={() => exportLibrary(library)}>导出</Button>
                <button
                  aria-label={`删除${library.name}`}
                  className="flex size-9 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-600 transition hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300"
                  disabled={library.isDefault || libraries.length <= 1}
                  onClick={() => void deleteLibrary(library)}
                  title={library.isDefault ? '默认标签库不可删除' : '删除标签库'}
                  type="button"
                >
                  <Trash2 className="size-4" />
                </button>
              </article>
            )
          })}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
        <div className="flex items-center gap-2">
          <BookOpenCheck className="size-4 text-muted-foreground" />
          <h2 className="font-semibold">当前模板</h2>
        </div>
        <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
          <div className="font-semibold text-foreground">{activeLibrary?.name ?? '未选择'}</div>
          <div>科目：{activeLibrary?.subject ?? '-'}</div>
          <div>{activeMeta.sectionLabel}：{activeStats.sections}</div>
          <div>{activeMeta.pointLabel}：{activeStats.points}</div>
          <div className={validationError || saveState === 'error' ? 'text-red-600' : 'text-emerald-600'}>{statusLabel}</div>
        </div>
      </section>
    </div>
  )
}

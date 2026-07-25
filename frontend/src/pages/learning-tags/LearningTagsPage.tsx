import { AddLibraryDialog } from './AddLibraryDialog'
import { LibraryEditor } from './LibraryEditor'
import { LibraryListPanel } from './LibraryListPanel'
import { useLearningTags } from './useLearningTags'

export default function LearningTagsPage() {
  const controller = useLearningTags()
  const { error, addDialogOpen } = controller

  return (
    <div className="mock-page-root flex min-h-[calc(100vh-6rem)] select-none flex-col gap-6 overflow-y-auto bg-zinc-50/10 p-6 text-zinc-950 dark:bg-zinc-950/20 dark:text-zinc-50">
      <div className="flex flex-col gap-1 border-b border-zinc-200 pb-4 text-left dark:border-zinc-800">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">学习标签库</h1>
        <p className="text-[13px] text-zinc-500 dark:text-zinc-400">维护题目入库、薄弱点分析和方法题型识别使用的标签模板。</p>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-950 dark:bg-red-950/40 dark:text-red-300">{error}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(340px,0.85fr)_minmax(520px,1.15fr)]">
        <LibraryListPanel controller={controller} />
        <LibraryEditor controller={controller} />
      </div>

      {addDialogOpen ? <AddLibraryDialog controller={controller} /> : null}
    </div>
  )
}

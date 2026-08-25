import { useMemo } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { DocumentStyleWorkspace } from './components/DocumentStyleWorkspace'
import { useTeachingDocumentEditor } from './useTeachingDocumentEditor'
import { useTeachingDocumentQuestions } from './useTeachingDocumentQuestions'

export default function TeachingDocumentStylePage() {
  const { documentId = '' } = useParams()
  const editor = useTeachingDocumentEditor(decodeURIComponent(documentId))
  const { resolveQuestion, resolveFigure } = useTeachingDocumentQuestions({ document: editor.document, assets: editor.record?.assets })
  const returnPath = useMemo(() => `/teaching-documents/${encodeURIComponent(decodeURIComponent(documentId))}`, [documentId])

  if (editor.loading) return <div className="flex h-full items-center justify-center text-sm text-zinc-500">正在加载文档…</div>
  if (!editor.document) return <div className="rounded-xl border border-red-200 bg-red-50/40 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">{editor.loadError || '无法加载文档。'}</div>

  return (
    <main className="-m-4 flex h-screen min-h-0 flex-col overflow-hidden border-t border-zinc-200 bg-white md:-m-6 dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-200 px-3 dark:border-zinc-800">
        <Link to={returnPath} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"><ArrowLeft className="size-3.5" />返回文档</Link>
        <span className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />
        <div className="min-w-0"><h1 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">文档样式</h1><p className="truncate text-[11px] text-zinc-500">{editor.document.title}</p></div>
        <span className={`ml-auto text-xs ${editor.saveState === 'saved' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>{editor.saveState === 'saved' ? '已保存' : editor.saveState === 'saving' ? '正在保存…' : '待保存'}</span>
      </header>
      {editor.saveError ? <div className="border-b border-red-200 bg-red-50/50 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">{editor.saveError}</div> : null}
      <DocumentStyleWorkspace document={editor.document} onDocumentChange={(document) => editor.dispatch({ type: 'replaceDocument', document })} resolveQuestion={resolveQuestion} resolveFigure={resolveFigure} />
    </main>
  )
}

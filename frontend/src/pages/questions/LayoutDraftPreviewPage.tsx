import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Download, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react'
import { layoutDraftsApi, type LayoutDraft } from '@/api/layoutDrafts'
import { PdfPreviewCanvas } from '@/components/questions/PdfPreviewCanvas'

export default function LayoutDraftPreviewPage() {
  const { draftId = '' } = useParams()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<LayoutDraft | null>(null)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(80)
  const [busy, setBusy] = useState(false)
  const [variant, setVariant] = useState<'student' | 'teacher'>('student')
  const [activePage, setActivePage] = useState<number>()

  const load = () => layoutDraftsApi.get(draftId).then(response => { setDraft(response.draft); setError('') }).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
  useEffect(() => { void load() }, [draftId])
  useEffect(() => {
    if (!draft || !['queued', 'rendering'].includes(draft.preview.status)) return
    const timer = window.setInterval(() => void load(), 750)
    return () => window.clearInterval(timer)
  }, [draft?.preview.status, draftId])

  async function preview() {
    if (!draft) return
    setBusy(true)
    try {
      const synced = await layoutDraftsApi.refreshContent(draft.id, draft.revision)
      const response = await layoutDraftsApi.preview(synced.draft.id, synced.draft.revision)
      setDraft({ ...synced.draft, preview: response.preview })
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  async function exportPdf() {
    if (!draft) return
    setBusy(true)
    try { const result = await layoutDraftsApi.export(draft.id, draft.revision, variant); if (result.url) window.open(result.url, '_blank') }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  const warnings = draft?.preview.warnings.filter(warning => !warning.variant || warning.variant === variant) || []
  function locatePage(page?: number) {
    if (!page) return
    setActivePage(page)
    requestAnimationFrame(() => document.getElementById(`preview-page-${page}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return <div className="space-y-4">
    <div className="flex items-center justify-between">
      <div><button className="mb-2 inline-flex items-center gap-1 text-xs text-zinc-500" onClick={() => navigate('/questions/basket')}><ArrowLeft className="size-3.5"/>返回试题篮</button><h1 className="text-lg font-semibold">{draft?.name || 'PDF 预览'}</h1><p className="text-xs text-zinc-500">版本 {draft?.revision || '-'} · 学生版与教师版均由最终导出引擎生成</p></div>
      <div className="flex gap-2"><div className="flex rounded-md border bg-zinc-100 p-0.5 dark:bg-zinc-900" role="tablist" aria-label="预览版本"><button role="tab" aria-selected={variant === 'student'} className={`rounded px-3 py-1.5 text-xs ${variant === 'student' ? 'bg-white font-medium shadow-sm dark:bg-zinc-800' : ''}`} onClick={() => setVariant('student')}>学生版</button><button role="tab" aria-selected={variant === 'teacher'} className={`rounded px-3 py-1.5 text-xs ${variant === 'teacher' ? 'bg-white font-medium shadow-sm dark:bg-zinc-800' : ''}`} onClick={() => setVariant('teacher')}>教师版</button></div><button className="rounded-md border px-3 py-2 text-xs" title="缩小" onClick={() => setZoom(Math.max(40, zoom - 10))}><ZoomOut className="size-4"/></button><button className="rounded-md border px-3 py-2 text-xs" title="放大" onClick={() => setZoom(Math.min(140, zoom + 10))}><ZoomIn className="size-4"/></button><button disabled={busy} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs" onClick={() => void preview()}><RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`}/>生成 PDF</button><button disabled={busy || !draft} className="inline-flex items-center gap-2 rounded-md bg-zinc-950 px-3 py-2 text-xs text-white dark:bg-zinc-100 dark:text-zinc-950" onClick={() => void exportPdf()}><Download className="size-4"/>导出{variant === 'student' ? '学生版' : '教师版'}</button></div>
    </div>
    {error ? <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="size-4 shrink-0"/>{error}</div> : null}
    {warnings.length ? <section className="border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><b>排版诊断（{warnings.length}）</b><div className="mt-2 space-y-1">{warnings.map((warning, index) => <button key={`${warning.code}-${warning.questionId}-${index}`} className="block w-full text-left hover:underline" onClick={() => locatePage(warning.page)}>{warning.questionNo ? `第 ${warning.questionNo} 题 · ` : ''}{warning.page ? `第 ${warning.page} 页 · ` : ''}{warning.message}{warning.suggestion ? ` 建议：${warning.suggestion}` : ''}</button>)}</div></section> : null}
    <div className="min-h-[60vh] overflow-auto rounded-lg border bg-zinc-100 p-6 dark:bg-zinc-950">{draft ? <PdfPreviewCanvas preview={draft.preview} variant={variant} zoom={zoom} activePage={activePage} pageIdPrefix="preview-page" onRetry={() => void preview()}/> : <div className="flex h-80 items-center justify-center text-sm text-zinc-500">正在载入 PDF 预览…</div>}</div>
  </div>
}

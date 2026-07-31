import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import CodeMirror from '@uiw/react-codemirror'
import { keymap } from '@codemirror/view'
import { Check, LoaderCircle, Play, X } from 'lucide-react'
import { teachingDocumentsApi } from '@/api/teachingDocuments'

type RenderResult = { asset: { id: string; url: string }; sourceHash: string; cached: boolean }

export function TikzEditorDialog(props: {
  source: string
  svgAssetId?: string
  sourceHash?: string
  onRender: (source: string) => Promise<RenderResult>
  onApply: (value: { source: string; svgAssetId?: string; sourceHash?: string }) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(props.source)
  const [preview, setPreview] = useState<{ source: string; asset: RenderResult['asset']; sourceHash: string } | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(Boolean(props.svgAssetId))
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState('')
  const latestDraft = useRef(draft)
  latestDraft.current = draft

  useEffect(() => {
    if (!props.svgAssetId) { setLoadingPreview(false); return }
    let cancelled = false
    void teachingDocumentsApi.getAsset(props.svgAssetId).then((asset) => {
      if (!cancelled) setPreview({ source: props.source, asset, sourceHash: props.sourceHash || '' })
    }).catch(() => { if (!cancelled) setError('无法加载上一次成功生成的预览。') }).finally(() => { if (!cancelled) setLoadingPreview(false) })
    return () => { cancelled = true }
  }, [props.source, props.sourceHash, props.svgAssetId])

  const render = async (source = latestDraft.current) => {
    if (!source.trim() || rendering) return
    setRendering(true); setError('')
    try {
      const result = await props.onRender(source)
      if (latestDraft.current === source) setPreview({ source, asset: result.asset, sourceHash: result.sourceHash })
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setRendering(false) }
  }

  useEffect(() => {
    if (draft === props.source || !draft.trim()) return
    const timer = window.setTimeout(() => { void render(draft) }, 700)
    return () => window.clearTimeout(timer)
  }, [draft, props.source]) // render intentionally reads stable refs to avoid rescheduling on state transitions.

  const save = () => {
    props.onApply({
      source: draft,
      svgAssetId: preview?.asset.id || props.svgAssetId,
      sourceHash: preview?.source === draft ? preview.sourceHash : undefined,
    })
    props.onClose()
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="编辑 TikZ 绘图" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose() }}>
      <section className="flex h-[min(760px,92vh)] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex items-center justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-900">
          <div><h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">编辑 TikZ 绘图</h2><p className="mt-0.5 text-xs text-zinc-500">停止输入后自动生成预览；⌘/Ctrl + Enter 可立即生成。</p></div>
          <button type="button" title="关闭" onClick={props.onClose} className="rounded p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"><X className="size-4" /></button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-zinc-200 dark:divide-zinc-800 md:grid-cols-2 md:divide-x md:divide-y-0">
          <div className="flex min-h-0 flex-col bg-zinc-50/70 dark:bg-zinc-900/30">
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-800"><span>源码</span><button type="button" disabled={rendering || !draft.trim()} onClick={() => void render()} className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-2 py-1 text-zinc-700 hover:bg-zinc-50 disabled:opacity-45 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"><Play className="size-3" />生成</button></div>
            <CodeMirror value={draft} height="100%" basicSetup={{ lineNumbers: true, foldGutter: false }} onChange={setDraft} onBlur={() => void render()} extensions={[keymap.of([{ key: 'Mod-Enter', run: () => { void render(); return true } }])]} className="min-h-0 flex-1 overflow-auto text-sm" />
          </div>
          <div className="flex min-h-0 flex-col bg-white dark:bg-zinc-950">
            <div className="border-b border-zinc-200 px-4 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-800">预览</div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-5">
              {loadingPreview || rendering ? <div className="flex items-center gap-2 text-sm text-zinc-500"><LoaderCircle className="size-4 animate-spin" />正在生成预览…</div> : preview ? <img src={preview.asset.url} alt="TikZ 预览" className="max-h-full max-w-full object-contain" /> : <p className="text-sm text-zinc-400">输入 TikZ 源码后将显示预览。</p>}
            </div>
            {error ? <p role="alert" className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300">{error}</p> : null}
          </div>
        </div>
        <footer className="flex items-center justify-between border-t border-zinc-100 px-5 py-3 dark:border-zinc-900"><span className="text-xs text-zinc-500">{preview?.source === draft ? '预览已同步' : '预览待更新'}</span><div className="flex gap-2"><button type="button" onClick={props.onClose} className="h-8 rounded border border-zinc-200 px-3 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900">取消</button><button type="button" onClick={save} className="inline-flex h-8 items-center gap-1 rounded bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"><Check className="size-3.5" />保存并关闭</button></div></footer>
      </section>
    </div>, document.body,
  )
}

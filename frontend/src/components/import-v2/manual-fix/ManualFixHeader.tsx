import { ArrowLeft, LoaderCircle, Save } from 'lucide-react'
import { Button } from '@/components/ui'

interface Props {
  candidate: any
  pdfName: string
  saving: boolean
  finalizing: boolean
  textDirty: boolean
  saveError: string
  onBack: () => void
  onSaveDraft: () => void
  onFinalize: () => void
}

export function ManualFixHeader({ candidate, pdfName, saving, finalizing, textDirty, saveError, onBack, onSaveDraft, onFinalize }: Props) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={onBack} aria-label="返回候选题" className="flex size-8 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900">
          <ArrowLeft className="size-4" />
        </button>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">候选题手动修正</h2>
          <p className="max-w-lg truncate text-[13px] text-zinc-500" title={pdfName}>{candidate?.questionNo ? `第 ${candidate.questionNo} 题 · ` : ''}{pdfName}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {saveError ? <span className="max-w-52 truncate text-[11px] text-red-700 dark:text-red-400" title={saveError}>保存失败：{saveError}</span> : saving ? <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400"><LoaderCircle className="size-3.5 animate-spin" />保存中…</span> : <span className={`text-[11px] ${textDirty ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{textDirty ? '内容未保存' : '已保存'}</span>}
        <Button variant="outline" size="sm" icon={Save} onClick={onSaveDraft} disabled={saving || finalizing}>保存草稿</Button>
        <Button size="sm" icon={Save} onClick={onFinalize} disabled={finalizing}>{finalizing ? '正在提交…' : '完成修正'}</Button>
      </div>
    </header>
  )
}

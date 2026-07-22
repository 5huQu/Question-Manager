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
    <header className="sf-glass-header flex items-center justify-between p-3.5 rounded-2xl mb-4 shadow-sm">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回候选题"
          className="sf-pressable flex size-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200/60 bg-white text-zinc-700 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="min-w-0">
          <h2 className="sf-title text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            候选题手动修正
          </h2>
          <p className="sf-subtitle max-w-lg truncate text-xs" title={pdfName}>
            {candidate?.questionNo ? `第 ${candidate.questionNo} 题 · ` : ''}{pdfName}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {saveError ? (
          <span className="max-w-52 truncate text-[11px] text-red-600 dark:text-red-400 font-medium" title={saveError}>
            保存失败：{saveError}
          </span>
        ) : saving ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 font-medium">
            <LoaderCircle className="size-3.5 animate-spin" />
            保存中…
          </span>
        ) : (
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
            textDirty
              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
          }`}>
            <span className={`size-1.5 rounded-full ${textDirty ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
            {textDirty ? '未保存' : '已保存'}
          </span>
        )}
        <Button variant="outline" size="sm" icon={Save} onClick={onSaveDraft} disabled={saving || finalizing} className="sf-pressable rounded-xl">
          保存草稿
        </Button>
        <Button size="sm" icon={Save} onClick={onFinalize} disabled={finalizing} className="sf-pressable rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 shadow-md">
          {finalizing ? '正在提交…' : '完成修正'}
        </Button>
      </div>
    </header>
  )
}

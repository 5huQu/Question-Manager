import { FormEvent, useState } from 'react'
import { ClipboardList, FileText, LoaderCircle } from 'lucide-react'
import { importV2Api, type ImportV2ImportJob } from '@/api/importV2'
import { Modal } from '@/components/dialogs/Modal'
import { Button } from '@/components/ui'

type ExportTemplate = 'exam' | 'worksheet'

export function ImportJobExportDialog({ importJob, onClose }: { importJob: ImportV2ImportJob; onClose: () => void }) {
  const isLecture = importJob.paperKind === 'lecture'
  const [title, setTitle] = useState(importJob.paperTitle || importJob.title || '未命名试卷')
  const [template, setTemplate] = useState<ExportTemplate>(isLecture ? 'worksheet' : 'exam')
  const [variant, setVariant] = useState<'student' | 'teacher'>('student')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await importV2Api.exportImportJob(importJob.id, { title, template, variant, format: 'pdf' })
      window.open(result.url, '_blank')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="导出导入批次" desc={isLecture ? '讲义型资料将使用试题单模板导出。' : '试卷型资料默认使用试卷模板，也可切换为试题单。'} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1.5">
          <span className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">试卷标题</span>
          <input
            className="flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 py-1 text-sm shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus-visible:ring-1 focus-visible:ring-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:focus-visible:ring-zinc-300"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={importJob.paperTitle || importJob.title || '未命名试卷'}
          />
        </div>
        {!isLecture ? (
          <div className="space-y-2">
            <span className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">导出模板</span>
            <div className="grid grid-cols-2 gap-0.5 rounded-lg border border-zinc-200/50 bg-zinc-100/80 p-0.5 dark:border-zinc-800/50 dark:bg-zinc-900/80">
              <button
                type="button"
                onClick={() => setTemplate('exam')}
                className={`flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-all ${
                  template === 'exam'
                    ? 'border border-zinc-200/20 bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50'
                    : 'border-transparent bg-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                }`}
              >
                <FileText className="size-4" />
                <span>试卷模板</span>
              </button>
              <button
                type="button"
                onClick={() => setTemplate('worksheet')}
                className={`flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-all ${
                  template === 'worksheet'
                    ? 'border border-zinc-200/20 bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50'
                    : 'border-transparent bg-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                }`}
              >
                <ClipboardList className="size-4" />
                <span>试题单</span>
              </button>
            </div>
          </div>
        ) : null}
        <div className="space-y-2">
          <span className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">版本选择</span>
          <div className="grid grid-cols-2 gap-0.5 rounded-lg border border-zinc-200/50 bg-zinc-100/80 p-0.5 dark:border-zinc-800/50 dark:bg-zinc-900/80">
            <button
              type="button"
              onClick={() => setVariant('student')}
              className={`flex h-8 cursor-pointer items-center justify-center rounded-md px-3 text-xs font-semibold transition-all ${
                variant === 'student'
                  ? 'border border-zinc-200/20 bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50'
                  : 'border-transparent bg-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
              }`}
            >
              学生版
            </button>
            <button
              type="button"
              onClick={() => setVariant('teacher')}
              className={`flex h-8 cursor-pointer items-center justify-center rounded-md px-3 text-xs font-semibold transition-all ${
                variant === 'teacher'
                  ? 'border border-zinc-200/20 bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50'
                  : 'border-transparent bg-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
              }`}
            >
              教师版
            </button>
          </div>
        </div>
        {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-750">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>取消</Button>
          <Button type="submit" disabled={busy} icon={busy ? LoaderCircle : FileText}>{busy ? '导出中...' : '导出'}</Button>
        </div>
      </form>
    </Modal>
  )
}

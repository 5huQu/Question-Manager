import { FormEvent, useState } from 'react'
import { ClipboardList, FileText, LoaderCircle } from 'lucide-react'
import { api, jsonHeaders } from '@/api/client'
import { Modal } from '@/components/dialogs/Modal'
import { Button } from '@/components/ui'
import type { ApiRun } from '@/types'

type ExportTemplate = 'exam' | 'worksheet'

export function RunExportDialog({ run, onClose }: { run: ApiRun; onClose: () => void }) {
  const isLecture = run.materialType === 'lecture' || run.sourceFileKind === '讲义型'
  const [title, setTitle] = useState(run.paperTitle || run.pdfName || '未命名试卷')
  const [template, setTemplate] = useState<ExportTemplate>(isLecture ? 'worksheet' : 'exam')
  const [variant, setVariant] = useState<'student' | 'teacher'>('student')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api<{ filename: string; format: string; url: string }>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(run.runId)}/export-batch`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ title, template, variant }),
      })
      window.open(result.url, '_blank')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="导出批次" desc={isLecture ? '讲义型批次将使用试题单模板导出。' : '试卷型批次默认使用试卷模板，也可切换为试题单。'} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-zinc-600">试卷标题</span>
          <input
            className="h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={run.paperTitle || run.pdfName || '未命名试卷'}
          />
        </label>
        {!isLecture ? (
          <div className="space-y-2">
            <span className="text-xs font-semibold text-zinc-600">导出模板</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTemplate('exam')}
                className={`flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors ${
                  template === 'exam'
                    ? 'border-zinc-950 bg-zinc-950 text-white'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
                }`}
              >
                <FileText className="size-4" />
                <span>试卷模板</span>
              </button>
              <button
                type="button"
                onClick={() => setTemplate('worksheet')}
                className={`flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors ${
                  template === 'worksheet'
                    ? 'border-zinc-950 bg-zinc-950 text-white'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
                }`}
              >
                <ClipboardList className="size-4" />
                <span>试题单</span>
              </button>
            </div>
          </div>
        ) : null}
        <div className="space-y-2">
          <span className="text-xs font-semibold text-zinc-600">版本选择</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setVariant('student')}
              className={`flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors ${
                variant === 'student'
                  ? 'border-zinc-950 bg-zinc-950 text-white'
                  : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
              }`}
            >
              <span>学生版</span>
            </button>
            <button
              type="button"
              onClick={() => setVariant('teacher')}
              className={`flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors ${
                variant === 'teacher'
                  ? 'border-zinc-950 bg-zinc-950 text-white'
                  : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
              }`}
            >
              <span>教师版</span>
            </button>
          </div>
        </div>
        {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>取消</Button>
          <Button type="submit" disabled={busy} icon={busy ? LoaderCircle : FileText}>{busy ? '导出中...' : '导出'}</Button>
        </div>
      </form>
    </Modal>
  )
}

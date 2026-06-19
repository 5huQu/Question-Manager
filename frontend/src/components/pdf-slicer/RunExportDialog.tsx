import { FormEvent, useState } from 'react'
import { FileText, LoaderCircle } from 'lucide-react'
import { api, jsonHeaders } from '@/api/client'
import { Modal } from '@/components/dialogs/Modal'
import { Button } from '@/components/ui'
import type { ApiRun } from '@/types'

export function RunExportDialog({ run, onClose }: { run: ApiRun; onClose: () => void }) {
  const isLecture = run.materialType === 'lecture' || run.sourceFileKind === '讲义型'
  const [title, setTitle] = useState(run.paperTitle || run.pdfName || '未命名试卷')
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
        body: JSON.stringify({ title }),
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
    <Modal title="导出批次" desc={isLecture ? '讲义型批次将使用练习单模板导出。' : '试卷型批次将使用试卷模板导出。'} onClose={onClose}>
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
        {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>取消</Button>
          <Button type="submit" disabled={busy} icon={busy ? LoaderCircle : FileText}>{busy ? '导出中...' : '导出'}</Button>
        </div>
      </form>
    </Modal>
  )
}

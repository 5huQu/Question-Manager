import { useState, type FormEvent } from 'react'
import { FileUp, LoaderCircle } from 'lucide-react'
import { api } from '@/api/client'
import { Button, Panel } from '@/components/ui'
import { RunCard } from '@/pages/pdf-slicer/RunCard'
import type { Dashboard } from '@/types'
import { mockRuns } from './OverviewTab'

export function SlicerTab({ dashboard, reload }: { dashboard: Dashboard | null; reload: () => void }) {
  const [uploading, setUploading] = useState(false)

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = event.currentTarget.elements.namedItem('files') as HTMLInputElement
    if (!input.files?.length) return
    const form = new FormData()
    Array.from(input.files).forEach((file) => form.append('files', file))
    const paperTitleInput = event.currentTarget.elements.namedItem('paperTitle') as HTMLInputElement
    form.append('paperTitle', paperTitleInput.value)
    setUploading(true)
    try {
      await api('/api/tools/pdf-slicer/uploads', { method: 'POST', body: form })
      input.value = ''
      paperTitleInput.value = ''
      reload()
    } finally {
      setUploading(false)
    }
  }

  const apiRuns = dashboard?.runs ?? []
  const runs = apiRuns.length ? apiRuns : mockRuns

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] h-[calc(100vh-9rem)] min-h-[580px] overflow-hidden">
      {/* Upload Panel */}
      <div className="h-full overflow-auto">
        <Panel title="批量上传 PDF / DOCX">
          <form className="space-y-3" onSubmit={handleUpload}>
            <p className="text-xs leading-5 text-zinc-500">上传后会写入新数据库，并自动进入切题队列。</p>
            <label className="space-y-1 block">
              <span className="text-xs text-zinc-500 font-medium">试卷名称</span>
              <input className="w-full rounded-lg border px-3 py-1.5 text-xs bg-zinc-50 focus:bg-white" name="paperTitle" placeholder="选填，若为空则自动提取" />
            </label>
            <label className="space-y-1 block">
              <span className="text-xs text-zinc-500 font-medium font-semibold">选择物理文件</span>
              <input className="w-full text-xs mt-1" accept=".pdf,.docx" name="files" required type="file" />
            </label>
            <Button className="w-full mt-2" disabled={uploading} icon={uploading ? LoaderCircle : FileUp}>
              {uploading ? '上传中...' : '提交文件并创建批次'}
            </Button>
          </form>
        </Panel>
      </div>

      {/* Slices Queue List */}
      <div className="h-full flex flex-col gap-2 overflow-hidden">
        <div className="flex items-center justify-between border-b pb-2 shrink-0">
          <h3 className="font-semibold text-xs text-zinc-500">切题与复核批次队列</h3>
          <span className="text-[10px] text-zinc-400">总共 {runs.length} 个批次</span>
        </div>
        <div className="flex-1 overflow-auto space-y-3 pr-1 pb-4">
          <div className="space-y-3">
            {runs.map((run) => (
              <RunCard key={run.runId} run={run} onReload={reload} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { FileUp, LoaderCircle } from 'lucide-react'
import { pdfSlicerApi } from '@/api/pdfSlicer'
import { settingsApi } from '@/api/settings'
import { Button, Panel } from '@/components/ui'
import { Modal } from '@/components/dialogs/Modal'
import { RunCard } from '@/pages/pdf-slicer/RunCard'
import type { Dashboard, OcrSettings } from '@/types'
import { useAsync } from '@/hooks/useAsync'
import { ensureStageValue, gradeOptionsForTeachingStages } from '@/utils/stages'
import { fileListHasWord, libreOfficeDownloadUrl } from '@/utils/wordFiles'

export function SlicerTab({ dashboard, reload }: { dashboard: Dashboard | null; reload: () => void }) {
  const [uploading, setUploading] = useState(false)
  const [stage, setStage] = useState('高三')
  const [showWordUploadWarning, setShowWordUploadWarning] = useState(false)
  const ocrSettings = useAsync<OcrSettings>(() => settingsApi.getOcrSettings(), [])
  const stageOptions = gradeOptionsForTeachingStages(ocrSettings.data?.teachingStages)
  const selectedStage = ensureStageValue(stage, stageOptions)
  const missingLibreOffice = ocrSettings.data?.sofficeAvailable === false

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = event.currentTarget.elements.namedItem('files') as HTMLInputElement
    if (!input.files?.length) return
    if (missingLibreOffice && fileListHasWord(input.files)) {
      setShowWordUploadWarning(true)
      return
    }
    const form = new FormData()
    Array.from(input.files).forEach((file) => form.append('files', file))
    const paperTitleInput = event.currentTarget.elements.namedItem('paperTitle') as HTMLInputElement
    form.append('paperTitle', paperTitleInput.value)
    form.append('stage', selectedStage)
    setUploading(true)
    try {
      await pdfSlicerApi.upload(form)
      input.value = ''
      paperTitleInput.value = ''
      reload()
    } finally {
      setUploading(false)
    }
  }

  const runs = dashboard?.runs ?? []

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] h-[calc(100vh-9rem)] min-h-[580px] overflow-hidden">
      {/* Upload Panel */}
      <div className="h-full overflow-auto">
        <Panel title="批量上传 PDF / DOC / DOCX">
          <form className="space-y-3" onSubmit={handleUpload}>
            <p className="text-xs leading-5 text-zinc-500">上传后会写入新数据库，并自动进入切题队列。</p>
            <label className="space-y-1 block">
              <span className="text-xs text-zinc-500 font-medium">试卷名称</span>
              <input className="w-full rounded-lg border px-3 py-1.5 text-xs bg-zinc-50 focus:bg-white" name="paperTitle" placeholder="选填，若为空则自动提取" />
            </label>
            <label className="space-y-1 block">
              <span className="text-xs text-zinc-500 font-medium">学段</span>
              <select className="w-full rounded-lg border px-3 py-1.5 text-xs bg-zinc-50 focus:bg-white" value={selectedStage} onChange={(event) => setStage(event.target.value)}>
                {stageOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="space-y-1 block">
              <span className="text-xs text-zinc-500 font-medium font-semibold">选择物理文件</span>
              <input className="w-full text-xs mt-1" accept=".pdf,.doc,.docx" name="files" required type="file" />
            </label>
            <Button className="w-full mt-2" disabled={uploading} icon={uploading ? LoaderCircle : FileUp}>
              {uploading ? '上传中...' : '提交文件并创建批次'}
            </Button>
          </form>
        </Panel>
      </div>

      {/* Slices Queue List */}
      <div className="h-full flex flex-col gap-2">
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
      {showWordUploadWarning ? (
        <Modal
          title="需要先安装 LibreOffice"
          desc="DOC/DOCX 文件必须先转换为 PDF 才能进入切题。"
          onClose={() => setShowWordUploadWarning(false)}
        >
          <div className="space-y-4 text-sm leading-6 text-zinc-600">
            <p>当前没有检测到 LibreOffice，因此已拦截 DOC/DOCX 上传。PDF 文件可以继续上传。</p>
            <p>安装 LibreOffice 后重启应用，或到“系统设置 → 外部工具”填写 soffice.exe 的完整路径。</p>
            <a
              href={libreOfficeDownloadUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-lg bg-zinc-950 px-3 text-xs font-semibold text-white hover:bg-zinc-800"
            >
              下载 LibreOffice
            </a>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

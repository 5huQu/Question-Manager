import { useEffect, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { BookOpen, FileStack, FileText, FileUp, RefreshCcw, ScanSearch } from 'lucide-react'
import { pdfSlicerApi } from '@/api/pdfSlicer'
import { settingsApi } from '@/api/settings'
import { SeparatedFileInput } from '@/components/pdf-slicer/SeparatedFileInput'
import { UploadModeButton } from '@/components/pdf-slicer/UploadModeButton'
import { Empty } from '@/components/ui'
import { Modal } from '@/components/dialogs/Modal'
import { useAsync } from '@/hooks/useAsync'
import type { Dashboard, OcrSettings } from '@/types'
import { materialTypeLabel, workflowModeLabel, workflowStatusLabel } from '@/utils/questionDisplay'
import { fileListHasWord, libreOfficeDownloadUrl } from '@/utils/wordFiles'
import { RunCard } from './RunCard'

export function PdfSlicerPage() {
  const { data, error, loading, reload } = useAsync<Dashboard>(() => pdfSlicerApi.getDashboard(), [])
  const ocrSettings = useAsync<OcrSettings>(() => settingsApi.getOcrSettings(), [])
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null)
  const [showWordUploadWarning, setShowWordUploadWarning] = useState(false)
  const [uploadMode, setUploadMode] = useState<'auto' | 'lecture' | 'exam'>('auto')
  const [examUploadMode, setExamUploadMode] = useState<'full' | 'separated'>('full')
  const [questionFiles, setQuestionFiles] = useState<FileList | null>(null)
  const [solutionFiles, setSolutionFiles] = useState<FileList | null>(null)
  const separatedExamUpload = uploadMode === 'exam' && examUploadMode === 'separated'
  const uploadFileCount = separatedExamUpload ? (questionFiles?.length ?? 0) + (solutionFiles?.length ?? 0) : (selectedFiles?.length ?? 0)
  const missingLibreOffice = ocrSettings.data?.sofficeAvailable === false
  const visibleBatches = (data?.batches ?? []).filter((batch) => {
    const runCount = Number(batch.runCount ?? 0)
    const title = batch.title || batch.id
    const technicalTitle = title === batch.id || /^batch_\d+/.test(title) || /^lecture_trial_batch_/.test(title)
    return runCount > 0 && !technicalTitle && batch.workflowMode === 'separated_exam'
  })
  const hasActiveRuns = (data?.runs ?? []).some((run) =>
    ['queued', 'running'].includes(run.sliceStatus) || ['queued', 'running'].includes(run.ocrStatus)
  )

  useEffect(() => {
    if (!hasActiveRuns) return
    const timer = window.setInterval(() => {
      reload({ silent: true })
    }, 2500)
    return () => window.clearInterval(timer)
  }, [hasActiveRuns, reload])

  const handleDrag = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      if (missingLibreOffice && fileListHasWord(e.dataTransfer.files)) {
        setShowWordUploadWarning(true)
        return
      }
      setSelectedFiles(e.dataTransfer.files)
    }
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      if (missingLibreOffice && fileListHasWord(e.target.files)) {
        e.target.value = ''
        setShowWordUploadWarning(true)
        return
      }
      setSelectedFiles(e.target.files)
    }
  }

  function handleSeparatedFiles(files: FileList | null, setter: (files: FileList | null) => void) {
    if (missingLibreOffice && fileListHasWord(files)) {
      setShowWordUploadWarning(true)
      setter(null)
      return
    }
    setter(files)
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (separatedExamUpload && (!questionFiles?.length || !solutionFiles?.length)) return
    if (!separatedExamUpload && (!selectedFiles || !selectedFiles.length)) return
    if (missingLibreOffice && (
      fileListHasWord(selectedFiles) ||
      fileListHasWord(questionFiles) ||
      fileListHasWord(solutionFiles)
    )) {
      setShowWordUploadWarning(true)
      return
    }
    const form = new FormData()
    const paperTitleInput = event.currentTarget.elements.namedItem('paperTitle') as HTMLInputElement
    const materialType = uploadMode === 'auto' ? 'unknown' : uploadMode === 'lecture' ? 'lecture' : 'exam'
    const fileRole = uploadMode === 'auto' ? 'unknown' : uploadMode === 'lecture' ? 'full' : examUploadMode === 'full' ? 'full' : 'unknown'
    const fileRoles: string[] = []
    if (separatedExamUpload) {
      Array.from(questionFiles ?? []).forEach((file) => {
        form.append('files', file)
        fileRoles.push('questions')
      })
      Array.from(solutionFiles ?? []).forEach((file) => {
        form.append('files', file)
        fileRoles.push('solutions')
      })
    } else {
      Array.from(selectedFiles ?? []).forEach((file) => {
        form.append('files', file)
        fileRoles.push(fileRole)
      })
    }
    form.append('paperTitle', paperTitleInput.value)
    form.append('materialType', materialType)
    form.append('fileRole', fileRole)
    form.append('fileRolesJson', JSON.stringify(fileRoles))
    setUploading(true)
    try {
      await pdfSlicerApi.upload(form)
      setSelectedFiles(null)
      setQuestionFiles(null)
      setSolutionFiles(null)
      paperTitleInput.value = ''
      reload()
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="mock-page-root min-h-[calc(100vh-6rem)] space-y-6 overflow-y-auto bg-zinc-50/10 p-6 text-zinc-950 dark:bg-zinc-950/20 dark:text-zinc-50">
      <header className="border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">PDF 切分中心</h1>
        <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">上传 PDF、DOC 或 DOCX 文件，系统将自动识别并切分为独立的题目，完成后可进行人工复核。</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">总批次</p>
          <p className="text-2xl font-bold">{data?.queueSummary.totalRuns ?? 0}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">待切题</p>
          <p className="text-2xl font-bold">{data?.queueSummary.sliceQueued ?? 0}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">待复核</p>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{data?.queueSummary.pendingQuickReview ?? 0}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">识别中</p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-500">{data?.queueSummary.ocrQueued ?? 0} / {data?.queueSummary.ocrRunning ?? 0}</p>
        </div>
      </div>

      <div className="grid xl:grid-cols-[380px_minmax(0,1fr)] gap-6 items-start">
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
          <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900/70">
            <FileUp className="size-4 text-zinc-500" />
            <h2 className="text-sm font-semibold">批量上传</h2>
          </div>
          <div className="p-5 space-y-5">
            <form onSubmit={handleUpload} className="space-y-5">
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                请选择上传模式。若不确定，请保持"自动识别"。对于分离版试卷，请分别上传原卷和解析。
              </p>

              <div className="space-y-1.5">
                <label className="text-xs font-medium block">文档名称</label>
                <input
                  type="text"
                  name="paperTitle"
                  required
                  className="flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 py-1 text-sm shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus-visible:ring-1 focus-visible:ring-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:focus-visible:ring-zinc-300"
                  placeholder="例如：2026届高三模拟考试"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium block">上传模式</label>
                <div className="grid grid-cols-3 gap-2">
                  <UploadModeButton active={uploadMode === 'auto'} icon={ScanSearch} label="自动识别" onClick={() => setUploadMode('auto')} />
                  <UploadModeButton active={uploadMode === 'lecture'} icon={BookOpen} label="讲义" onClick={() => setUploadMode('lecture')} />
                  <UploadModeButton active={uploadMode === 'exam'} icon={FileText} label="试卷" onClick={() => setUploadMode('exam')} />
                </div>
                {uploadMode === 'exam' ? (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <UploadModeButton active={examUploadMode === 'full'} icon={FileStack} label="一体解析版" onClick={() => setExamUploadMode('full')} />
                    <UploadModeButton active={examUploadMode === 'separated'} icon={FileText} label="分离原卷+解析" onClick={() => setExamUploadMode('separated')} />
                  </div>
                ) : null}
              </div>

              {separatedExamUpload ? (
                <div className="grid gap-2">
                  <SeparatedFileInput title="原卷文件" desc="试题页、学生版" files={questionFiles} inputId="question-upload-input" onChange={(files) => handleSeparatedFiles(files, setQuestionFiles)} />
                  <SeparatedFileInput title="解析文件" desc="答案、详解版本" files={solutionFiles} inputId="solution-upload-input" onChange={(files) => handleSeparatedFiles(files, setSolutionFiles)} />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium block">选择文件</label>
                  <div
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => document.getElementById('file-upload-input')?.click()}
                    className={`relative flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-lg cursor-pointer transition-all group ${
                      dragActive ? 'border-zinc-950 bg-zinc-100 dark:border-zinc-200 dark:bg-zinc-900' : 'border-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/40 dark:hover:bg-zinc-900'
                    }`}
                  >
                    <input
                      id="file-upload-input"
                      type="file"
                      name="files"
                      multiple
                      accept=".pdf,.doc,.docx,application/pdf"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 transition-transform group-hover:scale-110 dark:bg-zinc-800">
                      <FileUp className="size-5 text-zinc-500" />
                    </div>
                    {selectedFiles && selectedFiles.length > 0 ? (
                      <div className="text-center w-full">
                        <p className="text-sm font-medium">已选择 {selectedFiles.length} 个文件</p>
                        <div className="mt-1 space-y-1 max-h-24 overflow-y-auto">
                          {Array.from(selectedFiles).map((file, idx) => (
                            <p key={idx} className="truncate text-xs text-zinc-500 dark:text-zinc-400">{file.name} ({Math.round(file.size / 1024)} KB)</p>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-medium">拖拽 PDF、DOC 或 DOCX 到此处</p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">或点击浏览本地文件</p>
                      </>
                    )}
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={uploading || !uploadFileCount || (separatedExamUpload && (!questionFiles?.length || !solutionFiles?.length))}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-zinc-950 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                <FileUp className="size-4" /> {uploading ? '上传中...' : '开始上传并处理'}
              </button>
            </form>
          </div>
        </div>

        <div className="flex flex-col rounded-xl border border-zinc-200 bg-white text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
          <div className="flex items-center justify-between rounded-t-xl border-b border-zinc-200 bg-zinc-50 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900/70">
            <h2 className="text-sm font-semibold">任务进度与批次</h2>
            <button onClick={() => reload()} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50">
              <RefreshCcw className="size-3.5" /> 刷新
            </button>
          </div>

          <div className="space-y-4 bg-zinc-50/50 p-5 dark:bg-zinc-900/30">
            {loading ? <Empty text="读取中..." /> : error ? <Empty text={error} /> : data?.runs.length ? (
              <div className="space-y-4">
                {visibleBatches.length ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {visibleBatches.map((batch) => (
                      <div key={batch.id} className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{batch.title || batch.id}</p>
                            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{batch.runCount ?? 0} 个文件 · {workflowModeLabel(batch.workflowMode)}</p>
                          </div>
                          <div className="flex flex-col gap-1 shrink-0 items-end">
                            <span className="inline-flex items-center rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">{materialTypeLabel(batch.materialType)}</span>
                            <span className="inline-flex items-center rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">{workflowStatusLabel(batch.workflowStatus)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {data.runs.map((run) => <RunCard key={run.runId} run={run} onReload={reload} />)}
              </div>
            ) : <Empty text="暂无批次，先上传一份 PDF、DOC 或 DOCX。" />}
          </div>
        </div>
      </div>
      {showWordUploadWarning ? (
        <Modal
          title="需要先安装 LibreOffice"
          desc="DOC/DOCX 文件必须先转换为 PDF 才能进入切题。"
          onClose={() => setShowWordUploadWarning(false)}
        >
          <div className="space-y-4 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            <p>当前没有检测到 LibreOffice，因此已拦截 DOC/DOCX 上传。PDF 文件可以继续上传。</p>
            <p>安装 LibreOffice 后重启应用，或到“系统设置 → 外部工具”填写 soffice.exe 的完整路径。</p>
            <a
              href={libreOfficeDownloadUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-950 px-3 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              下载 LibreOffice
            </a>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}


export default PdfSlicerPage

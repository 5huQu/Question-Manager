import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, FileStack, LoaderCircle, Sparkles, AlertCircle, ExternalLink } from 'lucide-react'
import { api, jsonHeaders } from '@/api/client'
import { Button, Badge } from '@/components/ui'
import type { OcrSettings } from '@/types'
import { teachingStageOptions } from '@/utils/stages'
import { libreOfficeDownloadUrl } from '@/utils/wordFiles'

type SetupDraft = Pick<
  OcrSettings,
  | 'systemName'
  | 'siteTitle'
  | 'siteDescription'
  | 'examExportTemplate'
  | 'worksheetWatermark'
  | 'examWatermark'
  | 'lectureWatermark'
  | 'teachingStages'
>

const fallbackDraft: SetupDraft = {
  systemName: 'Question Manager',
  siteTitle: 'Question Manager',
  siteDescription: '本地优先的 PDF 切分、OCR 识别与数学题库管理工具。',
  examExportTemplate: 'builtin',
  worksheetWatermark: '教师姓名 · 工作室',
  examWatermark: 'Question Manager',
  lectureWatermark: '教师姓名 · 工作室',
  teachingStages: ['高中'],
}

type HealthResponse = {
  tools?: {
    soffice?: boolean
    sofficePath?: string
  }
}

export function SetupPage({
  initialSettings,
  onComplete,
}: {
  initialSettings: Partial<OcrSettings>
  onComplete: (settings: OcrSettings) => void
}) {
  const navigate = useNavigate()
  const [draft, setDraft] = useState<SetupDraft>({ ...fallbackDraft, ...initialSettings })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [health, setHealth] = useState<HealthResponse | null>(null)

  useEffect(() => {
    api<HealthResponse>('/api/health')
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])

  function toggleTeachingStage(stage: string) {
    const current = draft.teachingStages?.length ? draft.teachingStages : ['高中']
    const next = current.includes(stage)
      ? current.filter((item) => item !== stage)
      : [...current, stage]
    setDraft({ ...draft, teachingStages: next.length ? next : ['高中'] })
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      const saved = await api<OcrSettings>('/api/settings', {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ ...draft, setupCompleted: true }),
      })
      window.dispatchEvent(new CustomEvent('app-settings-updated', { detail: saved }))
      onComplete(saved)
      navigate('/workbench', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12 text-foreground sm:px-6">
      <main className="w-full max-w-4xl flex flex-col gap-8 relative">
        {/* Sleek Installation Wizard Header */}
        <header className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5 text-center sm:text-left justify-between border-b pb-6">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm shrink-0">
              <FileStack className="size-6" />
            </div>
            <div>
              <div className="flex items-center justify-center sm:justify-start gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  Question Manager
                </h1>
                <Badge variant="default" className="text-[10px] py-0.5 px-2 font-mono">Setup</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                首次启动配置指南 · 完成设置以初始化智能题库系统
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3.5 text-amber-500 animate-spin duration-[6000ms]" />
            <span>智能本地化部署</span>
          </div>
        </header>

        {/* Glassmorphic Form Card */}
        <section className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition-all duration-300">

          {/* Form Header Banner */}
          <div className="border-b bg-muted/20 px-6 py-5">
            <h2 className="text-sm font-bold">基础配置选项</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground font-normal">
              设置项包括侧边栏名称、网页标题、文档导出水印以及题库年级，所有选项后续均可在系统管理中随时更改。
            </p>
          </div>

          <div className="space-y-6 p-6">
            {/* Error Message */}
            {error ? (
              <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50/60 p-4 text-xs text-red-700 dark:border-red-905/30 dark:bg-red-950/20 dark:text-red-300 animate-shake">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            ) : null}

            {health && !health.tools?.soffice ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-semibold">未检测到 LibreOffice</p>
                    <p className="mt-1 text-xs leading-5 text-amber-800/80 dark:text-amber-200/80">
                      DOC/DOCX 上传需要 LibreOffice 将 Word 转为 PDF。安装后重启应用，或在系统设置里填写 soffice.exe 路径。
                    </p>
                  </div>
                </div>
                <a
                  href={libreOfficeDownloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-amber-950 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100"
                >
                  安装 LibreOffice
                  <ExternalLink className="size-3.5" />
                </a>
              </div>
            ) : health?.tools?.soffice ? (
              <div className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-xs text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200">
                <Check className="mt-0.5 size-4 shrink-0" />
                <span>已检测到 LibreOffice，DOC/DOCX 上传可自动转 PDF。</span>
              </div>
            ) : null}

            {/* Inputs grid */}
            <div className="grid gap-5 md:grid-cols-2">
              <label className="space-y-1.5 block">
                <span className="text-xs font-semibold text-zinc-650 dark:text-zinc-400">左上角系统名称</span>
                <input
                  className="w-full h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-950/40 px-3.5 text-sm outline-none transition-all duration-200 hover:border-zinc-350 dark:hover:border-zinc-700 focus:border-zinc-900 dark:focus:border-zinc-300 focus:ring-4 focus:ring-zinc-900/5 dark:focus:ring-zinc-100/5 focus:bg-white dark:focus:bg-zinc-950"
                  value={draft.systemName}
                  onChange={(event) => setDraft({ ...draft, systemName: event.target.value })}
                  placeholder="例如: Question Manager"
                />
              </label>

              <label className="space-y-1.5 block">
                <span className="text-xs font-semibold text-zinc-650 dark:text-zinc-400">系统网站标题</span>
                <input
                  className="w-full h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-950/40 px-3.5 text-sm outline-none transition-all duration-200 hover:border-zinc-350 dark:hover:border-zinc-700 focus:border-zinc-900 dark:focus:border-zinc-300 focus:ring-4 focus:ring-zinc-900/5 dark:focus:ring-zinc-100/5 focus:bg-white dark:focus:bg-zinc-950"
                  value={draft.siteTitle}
                  onChange={(event) => setDraft({ ...draft, siteTitle: event.target.value })}
                  placeholder="浏览器标签页标题"
                />
              </label>
            </div>

            <label className="space-y-1.5 block">
              <span className="text-xs font-semibold text-zinc-650 dark:text-zinc-400">系统网站描述</span>
              <textarea
                className="min-h-[90px] w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-950/40 px-3.5 py-2.5 text-sm leading-relaxed outline-none transition-all duration-200 hover:border-zinc-350 dark:hover:border-zinc-700 focus:border-zinc-900 dark:focus:border-zinc-300 focus:ring-4 focus:ring-zinc-900/5 dark:focus:ring-zinc-100/5 focus:bg-white dark:focus:bg-zinc-950"
                value={draft.siteDescription}
                onChange={(event) => setDraft({ ...draft, siteDescription: event.target.value })}
                placeholder="网站简介描述..."
              />
            </label>

            {/* Template & Stages */}
            <div className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
              <div className="space-y-2">
                <span className="text-xs font-semibold text-zinc-655 dark:text-zinc-400 block">试卷导出模板</span>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100/60 p-1 dark:bg-zinc-800/60 border border-zinc-200/30 dark:border-zinc-700/20 backdrop-blur-sm">
                  {([
                    { value: 'builtin', label: '自带模板' },
                    { value: 'examch', label: 'Examch' },
                  ] as const).map((option) => {
                    const active = draft.examExportTemplate === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setDraft({ ...draft, examExportTemplate: option.value })}
                        className={`h-8.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                          active
                            ? 'bg-white text-zinc-950 shadow-md dark:bg-zinc-950 dark:text-zinc-50 scale-[1.01]'
                            : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-white/30 dark:hover:bg-zinc-900/20'
                        }`}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-xs font-semibold text-zinc-655 dark:text-zinc-400 block">教学学段 (多选)</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {teachingStageOptions.map((stage) => {
                    const active = draft.teachingStages.includes(stage)
                    return (
                      <button
                        key={stage}
                        type="button"
                        onClick={() => toggleTeachingStage(stage)}
                        className={`flex h-9.5 items-center justify-center gap-1.5 rounded-xl border text-xs font-semibold transition-all duration-200 cursor-pointer ${
                          active
                            ? 'border-zinc-900 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950 shadow-md shadow-zinc-950/10 dark:shadow-white/5 scale-[1.02]'
                            : 'border-zinc-200 bg-zinc-50/20 hover:bg-zinc-50/80 text-zinc-500 hover:text-zinc-800 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950/20 dark:hover:bg-zinc-950/60 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:border-zinc-700'
                        }`}
                      >
                        <span className={`flex size-3.5 items-center justify-center rounded border transition-colors ${
                          active
                            ? 'border-white bg-white text-zinc-950 dark:border-zinc-950 dark:bg-zinc-950 dark:text-zinc-100'
                            : 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900'
                        }`}>
                          {active ? <Check className="size-2.5 stroke-[3px]" /> : null}
                        </span>
                        <span>{stage}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Watermarks */}
            <div className="space-y-2 pt-2">
              <span className="text-xs font-semibold text-zinc-655 dark:text-zinc-400 block">模板导出品牌文字 / 水印</span>
              <div className="grid gap-4 md:grid-cols-3">
                <label className="space-y-1.5 block">
                  <span className="text-[11px] font-medium text-zinc-450 dark:text-zinc-550">练习单模板水印</span>
                  <input
                    className="w-full h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-950/40 px-3.5 text-sm outline-none transition-all duration-200 hover:border-zinc-350 dark:hover:border-zinc-700 focus:border-zinc-900 dark:focus:border-zinc-300 focus:ring-4 focus:ring-zinc-900/5 dark:focus:ring-zinc-100/5 focus:bg-white dark:focus:bg-zinc-950"
                    value={draft.worksheetWatermark}
                    onChange={(event) => setDraft({ ...draft, worksheetWatermark: event.target.value })}
                  />
                </label>
                <label className="space-y-1.5 block">
                  <span className="text-[11px] font-medium text-zinc-455 dark:text-zinc-550">试卷模板水印</span>
                  <input
                    className="w-full h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-950/40 px-3.5 text-sm outline-none transition-all duration-200 hover:border-zinc-350 dark:hover:border-zinc-700 focus:border-zinc-900 dark:focus:border-zinc-300 focus:ring-4 focus:ring-zinc-900/5 dark:focus:ring-zinc-100/5 focus:bg-white dark:focus:bg-zinc-950"
                    value={draft.examWatermark}
                    onChange={(event) => setDraft({ ...draft, examWatermark: event.target.value })}
                  />
                </label>
                <label className="space-y-1.5 block">
                  <span className="text-[11px] font-medium text-zinc-455 dark:text-zinc-550">讲义模板水印</span>
                  <input
                    className="w-full h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-950/40 px-3.5 text-sm outline-none transition-all duration-200 hover:border-zinc-350 dark:hover:border-zinc-700 focus:border-zinc-900 dark:focus:border-zinc-300 focus:ring-4 focus:ring-zinc-900/5 dark:focus:ring-zinc-100/5 focus:bg-white dark:focus:bg-zinc-950"
                    value={draft.lectureWatermark}
                    onChange={(event) => setDraft({ ...draft, lectureWatermark: event.target.value })}
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Form Footer Actions */}
          <div className="flex justify-end border-t border-zinc-200/60 bg-zinc-50/50 px-6 py-5 dark:border-zinc-800/60 dark:bg-zinc-900/40">
            <Button
              icon={busy ? LoaderCircle : Check}
              disabled={busy}
              onClick={save}
              className="px-6 h-10.5 rounded-xl bg-gradient-to-r from-zinc-900 to-zinc-805 hover:from-zinc-800 hover:to-zinc-700 text-white dark:from-white dark:to-zinc-200 dark:text-zinc-950 dark:hover:from-white dark:hover:to-white shadow-lg shadow-zinc-950/15 dark:shadow-white/5 transition-all duration-200"
            >
              {busy ? '保存设置中...' : '完成配置，进入系统'}
            </Button>
          </div>
        </section>
      </main>
    </div>
  )
}

export default SetupPage

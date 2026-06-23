import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, Download, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui'
import type { UpdateCheckResult, UpdateProgress, UpdateStatus } from '@/api/client'

function formatBytes(value?: number) {
  const bytes = Number(value || 0)
  if (!bytes) return '未知大小'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function platformInstallHint(platformKey?: string) {
  if (platformKey?.startsWith('darwin')) {
    return '下载完成后请解压 zip，并将新版应用拖入 Applications 覆盖旧版。'
  }
  if (platformKey?.startsWith('win32')) {
    return '下载完成后请运行安装包，按提示覆盖安装。'
  }
  return '下载完成后请按当前系统的安装方式覆盖旧版。'
}

export function UpdateCard({ autoCheck = false, compact = false, initialResult = null, onUpdateAvailable }: {
  autoCheck?: boolean
  compact?: boolean
  initialResult?: UpdateCheckResult | null
  onUpdateAvailable?: (result: UpdateCheckResult) => void
}) {
  const updates = window.questionWorkbench?.updates
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(initialResult)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [opening, setOpening] = useState(false)

  const hasDownloaded = Boolean(status?.phase === 'downloaded' || checkResult?.downloadedPath)
  const updateAvailable = Boolean(checkResult?.updateAvailable)
  const unsupported = !updates

  const message = useMemo(() => {
    if (unsupported) return '当前运行环境不支持应用内更新，请使用安装包覆盖安装。'
    if (status?.message) return status.message
    if (checkResult?.message) return checkResult.message
    if (checkResult?.error) return checkResult.error
    if (updateAvailable) return '发现新版本，可以下载并覆盖安装。'
    return '点击检查更新，应用会读取 OSS 上的 latest.json。'
  }, [checkResult, status, unsupported, updateAvailable])

  async function check(options?: { silent?: boolean }) {
    if (!updates) return
    setChecking(true)
    if (!options?.silent) setStatus(null)
    try {
      const result = await updates.check(options)
      setCheckResult(result)
      if (result.updateAvailable) onUpdateAvailable?.(result)
    } finally {
      setChecking(false)
    }
  }

  async function download() {
    if (!updates) return
    setDownloading(true)
    setProgress(null)
    try {
      const result = await updates.download()
      setStatus({ phase: 'downloaded', message: result.message || '更新安装包已下载完成。', downloadedPath: result.path, version: result.version })
      setCheckResult((previous) => previous ? { ...previous, downloadedPath: result.path } : previous)
    } catch (error: any) {
      setStatus({ phase: 'error', message: error?.message || '下载更新失败。' })
    } finally {
      setDownloading(false)
    }
  }

  async function openDownloaded() {
    if (!updates) return
    setOpening(true)
    try {
      const result = await updates.openDownloaded()
      setStatus({ phase: 'downloaded', message: result.message })
    } catch (error: any) {
      setStatus({ phase: 'error', message: error?.message || '打开安装包失败。' })
    } finally {
      setOpening(false)
    }
  }

  useEffect(() => {
    if (!updates) return undefined
    const offProgress = updates.onProgress(setProgress)
    const offStatus = updates.onStatus(setStatus)
    return () => {
      offProgress()
      offStatus()
    }
  }, [updates])

  useEffect(() => {
    if (!autoCheck || !updates) return undefined
    const timer = window.setTimeout(() => {
      check({ silent: true }).catch(() => undefined)
    }, 8000)
    return () => window.clearTimeout(timer)
  }, [autoCheck, updates])

  useEffect(() => {
    if (initialResult) setCheckResult(initialResult)
  }, [initialResult])

  return (
    <div className={compact ? 'space-y-3' : 'rounded-xl border border-border bg-muted/30 p-4'}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">应用更新</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            更新不会删除您的题库、课程资料和设置。
          </p>
        </div>
        {updateAvailable ? (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
            <Check className="size-3.5" />
            有新版本
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card px-3 py-2">
          <span className="text-muted-foreground">当前版本</span>
          <span className="ml-2 font-semibold text-foreground">{checkResult?.currentVersion || '未知'}</span>
        </div>
        <div className="rounded-lg border border-border bg-card px-3 py-2">
          <span className="text-muted-foreground">最新版本</span>
          <span className="ml-2 font-semibold text-foreground">{checkResult?.latestVersion || '未检查'}</span>
        </div>
      </div>

      {checkResult?.notes ? (
        <div className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-xs leading-5 text-muted-foreground">
          {checkResult.notes}
        </div>
      ) : null}

      <div className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
        status?.phase === 'error'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-border bg-card text-muted-foreground'
      }`}>
        {status?.phase === 'error' ? <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> : null}
        <span>{message}</span>
      </div>

      {updateAvailable && checkResult?.asset ? (
        <p className="mt-2 text-[11px] leading-5 text-zinc-400">
          安装包：{formatBytes(checkResult.asset.size)} · {platformInstallHint(checkResult.platformKey)}
        </p>
      ) : null}

      {downloading && progress ? (
        <div className="mt-3 space-y-1.5">
          <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div className="h-full rounded-full bg-zinc-950 transition-all dark:bg-zinc-100" style={{ width: `${progress.percent || 0}%` }} />
          </div>
          <p className="text-[11px] text-zinc-400">
            已下载 {formatBytes(progress.downloaded)} / {formatBytes(progress.total)} {progress.percent ? `· ${progress.percent}%` : ''}
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" icon={checking ? LoaderCircle : RefreshCw} onClick={() => check()} disabled={checking || downloading || unsupported}>
          {checking ? '检查中...' : '检查更新'}
        </Button>
        <Button size="sm" icon={downloading ? LoaderCircle : Download} onClick={download} disabled={!updateAvailable || downloading || checking || unsupported}>
          {downloading ? '下载中...' : '下载更新'}
        </Button>
        <Button variant="outline" size="sm" icon={opening ? LoaderCircle : ExternalLink} onClick={openDownloaded} disabled={!hasDownloaded || opening || unsupported}>
          {opening ? '打开中...' : checkResult?.platformKey?.startsWith('darwin') ? '在 Finder 中显示' : '打开安装包'}
        </Button>
      </div>
    </div>
  )
}

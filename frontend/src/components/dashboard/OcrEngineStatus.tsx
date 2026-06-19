import { Wifi } from 'lucide-react'
import type { OcrSettings } from '@/types'

export function OcrEngineStatus({ ocrSettings }: { ocrSettings: OcrSettings | null }) {
  const configured = Boolean(ocrSettings?.apiBaseUrl && ocrSettings.apiKeyConfigured && ocrSettings.model)

  return (
    <div className="space-y-3 text-xs">
      <div className="flex justify-between items-center">
        <span className="text-zinc-500 flex items-center gap-1.5">
          <Wifi className="size-3" />
          连通性检验
        </span>
        {configured ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800/30 dark:text-emerald-400">已配置</span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-900/20 dark:border-amber-800/30 dark:text-amber-400">未配置</span>
        )}
      </div>
      <div className="flex justify-between items-center">
        <span className="text-zinc-500">OCR 模型</span>
        <span className="font-semibold text-zinc-700 dark:text-zinc-300 truncate max-w-[150px]">{ocrSettings?.model || '未设置'}</span>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-zinc-500">清洗模型</span>
        <span className="font-semibold text-zinc-700 dark:text-zinc-300 truncate max-w-[150px]">{ocrSettings?.cleanupModel || '未设置'}</span>
      </div>
    </div>
  )
}

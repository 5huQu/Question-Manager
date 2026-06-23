import { Wifi, Cpu } from 'lucide-react'
import { Badge } from '@/components/ui'
import type { OcrSettings } from '@/types'

export function OcrEngineStatus({ ocrSettings }: { ocrSettings: OcrSettings | null }) {
  const provider = ocrSettings?.ocrProvider ?? 'doc2x'
  const configured = provider === 'doc2x'
    ? Boolean(ocrSettings?.doc2xApiBaseUrl && ocrSettings.doc2xApiKeyConfigured && ocrSettings.doc2xModel)
    : provider === 'glm'
      ? Boolean(ocrSettings?.glmOcrApiBaseUrl && ocrSettings.glmOcrApiKeyConfigured && ocrSettings.glmOcrModel)
      : Boolean(ocrSettings?.apiBaseUrl && ocrSettings.apiKeyConfigured && ocrSettings.model)
  const model = provider === 'doc2x' ? ocrSettings?.doc2xModel : provider === 'glm' ? ocrSettings?.glmOcrModel : ocrSettings?.model

  return (
    <div className="space-y-4.5 text-[13px] py-1.5">
      {/* Connectivity Status */}
      <div className="flex justify-between items-center bg-zinc-50/50 dark:bg-zinc-950/20 p-2.5 rounded-xl border border-zinc-200/40 dark:border-zinc-800/30">
        <span className="text-zinc-400 dark:text-zinc-500 flex items-center gap-2 font-medium">
          <Wifi className={`size-3.5 ${configured ? 'text-emerald-500 animate-pulse' : 'text-amber-500'}`} />
          <span>服务状态</span>
        </span>

        {configured ? (
          <Badge variant="success">已就绪</Badge>
        ) : (
          <Badge variant="warning">未配置</Badge>
        )}
      </div>

      {/* Model display */}
      <div className="flex justify-between items-center px-1">
        <span className="text-zinc-400 dark:text-zinc-500 font-medium flex items-center gap-2">
          <Cpu className="size-3.5 text-zinc-400" />
          <span>OCR 运算模型</span>
        </span>
        <span className="font-mono text-xs font-bold bg-zinc-100 dark:bg-zinc-950/50 border border-zinc-200/50 dark:border-zinc-800/40 px-2.5 py-1 rounded-lg text-zinc-700 dark:text-zinc-300 truncate max-w-[170px]" title={model || '未设置'}>
          {provider === 'doc2x' ? 'Doc2X · ' : provider === 'glm' ? 'GLM-OCR · ' : ''}{model || '未设置'}
        </span>
      </div>
    </div>
  )
}
export default OcrEngineStatus

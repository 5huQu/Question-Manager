import { AlertTriangle, Check, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui'
import { FileUploadPanel } from './FileUploadPanel'
import { MetadataFormPanel } from './MetadataFormPanel'
import { useImportUpload } from './useImportUpload'

export default function ImportUploadPage() {
  const state = useImportUpload()
  const { navigate, error, notice } = state

  return (
    <div className="space-y-6 pb-12">
      {/* SF Glass Stepper Header */}
      <div className="sf-glass p-5 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" icon={ChevronLeft} onClick={() => navigate('/tools/import')} className="sf-pressable rounded-xl">
            返回列表
          </Button>
          <div>
            <h1 className="sf-title text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              新建资料导入
            </h1>
            <p className="sf-subtitle text-xs">配置元数据并上传试卷原件或解析包</p>
          </div>
        </div>

        {/* Dynamic Stepper Pills */}
        <div className="flex items-center gap-2 bg-zinc-100/80 dark:bg-zinc-900/80 p-1.5 rounded-xl border border-zinc-200/50 dark:border-zinc-800/50 text-xs font-medium self-stretch md:self-auto justify-between md:justify-start">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-xs border border-zinc-200/60 dark:border-zinc-700/60">
            <span className="flex size-4 items-center justify-center rounded-full bg-zinc-900 text-[10px] text-white dark:bg-zinc-100 dark:text-zinc-900 font-bold">1</span>
            <span>上传资料</span>
          </div>
          <span className="text-zinc-300 dark:text-zinc-700">→</span>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-zinc-400 dark:text-zinc-500">
            <span className="flex size-4 items-center justify-center rounded-full bg-zinc-200 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 font-bold">2</span>
            <span>自动识别</span>
          </div>
          <span className="text-zinc-300 dark:text-zinc-700">→</span>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-zinc-400 dark:text-zinc-500">
            <span className="flex size-4 items-center justify-center rounded-full bg-zinc-200 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 font-bold">3</span>
            <span>核对入库</span>
          </div>
        </div>
      </div>

      {notice && (
        <div className="sf-glass px-4 py-3 rounded-xl border-emerald-500/20 bg-emerald-50/50 text-xs text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300 flex items-center gap-2.5 shadow-sm">
          <Check className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="sf-glass px-4 py-3 rounded-xl border-red-500/20 bg-red-50/50 text-xs text-red-700 dark:bg-red-950/20 dark:text-red-300 flex items-center gap-2.5 shadow-sm">
          <AlertTriangle className="size-4 text-red-500 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* 左侧元数据配置 */}
        <MetadataFormPanel state={state} />

        {/* 右侧文件选择与上传提交 */}
        <FileUploadPanel state={state} />
      </div>
    </div>
  )
}

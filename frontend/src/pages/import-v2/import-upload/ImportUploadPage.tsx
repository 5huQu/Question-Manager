import { AlertTriangle, Check, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui'
import { FileUploadPanel } from './FileUploadPanel'
import { MetadataFormPanel } from './MetadataFormPanel'
import { useImportUpload } from './useImportUpload'

export default function ImportUploadPage() {
  const state = useImportUpload()
  const { navigate, error, notice } = state

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* 整合统一顶栏 Header */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-black/6 bg-white/80 px-4 md:px-6 backdrop-blur-md dark:border-white/8 dark:bg-zinc-900/80">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            aria-label="返回导入列表"
            title="返回导入列表"
            onClick={() => navigate('/tools/import')}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white/80 text-zinc-600 hover:bg-white hover:text-zinc-900 dark:border-white/12 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-all active:scale-95 shadow-2xs cursor-pointer"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-2.5 min-w-0">
            <h1 className="text-sm md:text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-50 shrink-0">
              新建资料导入
            </h1>
            <span className="hidden sm:inline text-zinc-300 dark:text-zinc-700">·</span>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">配置试卷元数据并上传原卷或解析包</p>
          </div>
        </div>

        {/* 精简步骤条 Pills */}
        <div className="flex items-center gap-1 bg-black/4 dark:bg-white/6 p-1 rounded-xl border border-black/5 dark:border-white/8 text-xs font-medium shrink-0">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 text-white shadow-2xs dark:bg-zinc-100 dark:text-zinc-900 font-semibold">
            <span className="flex size-4 items-center justify-center rounded-full bg-white/20 text-[10px] text-white dark:bg-black/20 dark:text-zinc-900 font-bold">1</span>
            <span>上传资料</span>
          </div>
          <span className="text-zinc-300 dark:text-zinc-700 text-[10px]">→</span>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-zinc-400 dark:text-zinc-500 font-medium">
            <span className="flex size-4 items-center justify-center rounded-full bg-black/5 text-[10px] text-zinc-400 dark:bg-white/10 dark:text-zinc-500 font-bold">2</span>
            <span>自动识别</span>
          </div>
          <span className="text-zinc-300 dark:text-zinc-700 text-[10px]">→</span>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-zinc-400 dark:text-zinc-500 font-medium">
            <span className="flex size-4 items-center justify-center rounded-full bg-black/5 text-[10px] text-zinc-400 dark:bg-white/10 dark:text-zinc-500 font-bold">3</span>
            <span>核对入库</span>
          </div>
        </div>
      </header>

      {/* 页面主体 */}
      <div className="flex-1 overflow-auto p-4 md:p-6 pb-12">
        <div className="max-w-7xl mx-auto space-y-5">
          {notice && (
            <div className="px-4 py-3 rounded-xl border border-emerald-500/20 bg-emerald-50/60 text-xs text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300 flex items-center gap-2.5 shadow-2xs">
              <Check className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{notice}</span>
            </div>
          )}
          {error && (
            <div className="px-4 py-3 rounded-xl border border-rose-500/20 bg-rose-50/60 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300 flex items-center gap-2.5 shadow-2xs">
              <AlertTriangle className="size-4 text-rose-500 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
            {/* 左侧元数据配置 */}
            <MetadataFormPanel state={state} />

            {/* 右侧文件选择与上传提交 */}
            <FileUploadPanel state={state} />
          </div>
        </div>
      </div>
    </div>
  )
}

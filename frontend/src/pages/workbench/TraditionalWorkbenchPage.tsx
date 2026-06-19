import { useNavigate } from 'react-router-dom'
import { BookOpen, FolderArchive, RefreshCcw, Sparkles } from 'lucide-react'
import { api } from '@/api/client'
import { Button, Badge } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { Dashboard, OcrSettings, QuestionBankResponse } from '@/types'
import { OverviewTab } from './OverviewTab'

export function TraditionalWorkbenchPage() {
  const dashboard = useAsync<Dashboard>(() => api('/api/tools/pdf-slicer/dashboard'), [])
  const questionBank = useAsync<QuestionBankResponse>(() => api('/api/question-bank/items?page=1&pageSize=5'), [])
  const ocrSettings = useAsync<OcrSettings>(() => api('/api/tools/pdf-slicer/ocr-settings'), [])
  const navigate = useNavigate()

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Workbench Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-zinc-200/60 dark:border-zinc-800/40 pb-4.5 gap-4 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-550 uppercase tracking-wider">
              工作空间 / 概览
            </span>
            <Badge variant="success" className="text-[9px] py-0 px-1.5 leading-none">系统正常</Badge>
          </div>
          <h2 className="text-xl font-bold tracking-tight mt-1 text-zinc-900 dark:text-zinc-50 bg-gradient-to-r from-zinc-900 to-zinc-700 bg-clip-text dark:from-white dark:to-zinc-300">
            智能题库工作台控制中心
          </h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            icon={BookOpen}
            onClick={() => alert('每日一题功能开发中...')}
            className="hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
          >
            每日一题
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={FolderArchive}
            onClick={() => alert('随机组卷功能开发中...')}
            className="hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
          >
            随机组卷
          </Button>
          <Button
            size="sm"
            variant="default"
            icon={RefreshCcw}
            onClick={() => {
              dashboard.reload()
              questionBank.reload()
              ocrSettings.reload()
            }}
            className="shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            数据刷新
          </Button>
        </div>
      </div>

      {/* Main Tab Panel */}
      <OverviewTab
        dashboard={dashboard.data}
        questionBank={questionBank.data}
        ocrSettings={ocrSettings.data}
        onReload={() => {
          dashboard.reload()
          questionBank.reload()
        }}
        setActiveTab={(tab) => {
          if (tab === 'slicer') navigate('/tools/pdf-slicer')
          if (tab === 'ocr') navigate('/tools/pdf-slicer/ocr-jobs')
          if (tab === 'bank') navigate('/questions')
        }}
      />
    </div>
  )
}

export default TraditionalWorkbenchPage

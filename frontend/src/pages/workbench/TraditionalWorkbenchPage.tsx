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
    <div className="space-y-6">
      {/* Workbench Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              工作空间 / 概览
            </span>
            <Badge variant="success" className="text-[9px] py-0 px-1.5 leading-none">系统正常</Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight mt-1 text-foreground">
            智能题库工作台控制中心
          </h1>
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

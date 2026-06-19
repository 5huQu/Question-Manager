import { useNavigate } from 'react-router-dom'
import { BookOpen, FolderArchive, RefreshCcw } from 'lucide-react'
import { api } from '@/api/client'
import { Button } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { Dashboard, OcrSettings, QuestionBankResponse } from '@/types'
import { OverviewTab } from './OverviewTab'

export function TraditionalWorkbenchPage() {
  const dashboard = useAsync<Dashboard>(() => api('/api/tools/pdf-slicer/dashboard'), [])
  const questionBank = useAsync<QuestionBankResponse>(() => api('/api/question-bank/items?page=1&pageSize=5'), [])
  const ocrSettings = useAsync<OcrSettings>(() => api('/api/tools/pdf-slicer/ocr-settings'), [])
  const navigate = useNavigate()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b pb-3 shrink-0">
        <div>
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
            工作空间 / 概览
          </p>
          <h2 className="text-base font-bold mt-0.5 text-zinc-900">智能数据工作台控制中心</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" icon={BookOpen} onClick={() => alert('每日一题功能开发中...')}>每日一题</Button>
          <Button size="sm" variant="outline" icon={FolderArchive} onClick={() => alert('随机组卷功能开发中...')}>随机组卷</Button>
          <Button size="sm" variant="outline" icon={RefreshCcw} onClick={() => { dashboard.reload(); questionBank.reload(); ocrSettings.reload(); }}>刷新</Button>
        </div>
      </div>

      <OverviewTab
        dashboard={dashboard.data}
        questionBank={questionBank.data}
        ocrSettings={ocrSettings.data}
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

import { dashboardApi, type ActivityHeatmapResponse } from '@/api/dashboard'
import { exportRecordsApi, type ExportRecordsResponse } from '@/api/exportRecords'
import { questionBankApi } from '@/api/questionBank'
import { settingsApi } from '@/api/settings'
import { useAsync } from '@/hooks/useAsync'
import type { OcrSettings, QuestionBankResponse } from '@/types'
import { OverviewTab } from './OverviewTab'

export function TraditionalWorkbenchPage() {
  const questionBank = useAsync<QuestionBankResponse>(() => questionBankApi.listItems({ page: 1, pageSize: 5 }), [])
  const ocrSettings = useAsync<OcrSettings>(() => settingsApi.getOcrSettings(), [])
  const activityHeatmap = useAsync<ActivityHeatmapResponse>(() => dashboardApi.getActivityHeatmap(), [])
  const exportRecords = useAsync<ExportRecordsResponse>(() => exportRecordsApi.listExportRecords({ limit: 4 }), [])

  return (
    <div>
      <OverviewTab
        questionBank={questionBank.data}
        questionBankLoading={questionBank.loading}
        ocrSettings={ocrSettings.data}
        activityHeatmap={activityHeatmap.data}
        activityHeatmapError={activityHeatmap.error}
        activityHeatmapLoading={activityHeatmap.loading}
        exportRecords={exportRecords.data}
        exportRecordsLoading={exportRecords.loading}
      />
    </div>
  )
}

export default TraditionalWorkbenchPage

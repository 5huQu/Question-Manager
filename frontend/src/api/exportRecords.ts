import { api, jsonHeaders } from './client'
import type { ExportRecord } from '@/types'

export type ExportRecordsResponse = {
  items: ExportRecord[]
}

export type ExportRecordsParams = {
  q?: string
  sourceType?: 'collection' | 'run' | 'import_job' | ''
  importJobId?: string
  runId?: string
  collectionId?: string
  limit?: number
}

export const exportRecordsApi = {
  listExportRecords(params: ExportRecordsParams = {}) {
    const query = new URLSearchParams()
    if (params.q?.trim()) query.set('q', params.q.trim())
    if (params.sourceType) query.set('sourceType', params.sourceType)
    if (params.collectionId) query.set('collectionId', params.collectionId)
    if (params.runId) query.set('runId', params.runId)
    if (params.importJobId) query.set('importJobId', params.importJobId)
    if (params.limit !== undefined) query.set('limit', String(params.limit))
    const queryString = query.toString()
    return api<ExportRecordsResponse>(`/api/question-bank/export-records${queryString ? `?${queryString}` : ''}`)
  },
  deleteExportRecord(id: string) {
    return api(`/api/question-bank/export-records/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  restoreToBasket(id: string, payload: { collectionId?: string; syncTitle?: boolean } = {}) {
    return api(`/api/question-bank/export-records/${encodeURIComponent(id)}/restore-to-basket`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  listCollectionExportRecords(collectionId: string) {
    return api<ExportRecordsResponse>(`/api/question-bank/collections/${encodeURIComponent(collectionId)}/export-records`)
  },
}

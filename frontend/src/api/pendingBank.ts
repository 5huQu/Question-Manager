import { api, jsonHeaders } from './client'
import type { BulkActionResult, PendingBankFilter, PendingBankResponse, QuestionItem } from '@/types'

export type PendingBankListParams = {
  filter?: PendingBankFilter
}

function buildPendingBankQuery(params: PendingBankListParams = {}) {
  const query = new URLSearchParams()
  if (params.filter && params.filter !== 'all') query.set('filter', params.filter)
  const queryString = query.toString()
  return queryString ? `?${queryString}` : ''
}

export const pendingBankApi = {
  getPendingBank(runId: string, params: PendingBankListParams = {}) {
    return api<PendingBankResponse>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/pending-bank${buildPendingBankQuery(params)}`)
  },
  createManualCandidate(runId: string, item: Partial<QuestionItem>) {
    return api<QuestionItem>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/pending-bank/manual-candidate`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ item }),
    })
  },
  rerunOcr(runId: string, questionId: string) {
    return api(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/pending-bank/${encodeURIComponent(questionId)}/rerun-ocr`, { method: 'POST' })
  },
  bulkConfirm(runId: string, payload: { questionIds?: string[]; all?: boolean; confirmImageReview?: boolean }) {
    return api<BulkActionResult>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/pending-bank/bulk-confirm`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  bulkSkip(runId: string, payload: { questionIds: string[] }) {
    return api<BulkActionResult>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/pending-bank/bulk-skip`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  bulkDelete(runId: string, payload: { questionIds: string[] }) {
    return api<BulkActionResult>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/pending-bank/bulk-delete`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
}

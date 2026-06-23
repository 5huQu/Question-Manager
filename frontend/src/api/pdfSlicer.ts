import { api, jsonHeaders } from './client'
import type { ApiBatch, ApiRun, Dashboard, QuestionItem, ReviewFigure, SliceReviewItem, SlicerRulesData, SlicerRulesResponse } from '@/types'

export type SliceReviewItemsResponse = {
  summary: Record<string, number>
  items: SliceReviewItem[]
}

export type QuickReviewPayload = {
  runId: string
  approvedResultIds: string[]
  autoStartOcr?: boolean
}

export const pdfSlicerApi = {
  getDashboard() {
    return api<Dashboard>('/api/tools/pdf-slicer/dashboard')
  },
  upload(form: FormData) {
    return api('/api/tools/pdf-slicer/uploads', { method: 'POST', body: form })
  },
  getRules() {
    return api<SlicerRulesResponse>('/api/tools/pdf-slicer/rules')
  },
  updateRules(rules: SlicerRulesData, baseVersion: number) {
    return api<SlicerRulesResponse>('/api/tools/pdf-slicer/rules', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ rules, baseVersion }),
    })
  },
  validateRules(rules: SlicerRulesData) {
    return api<{ valid: boolean; errors: string[] }>('/api/tools/pdf-slicer/rules/validate', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ rules }),
    })
  },
  getBatch(batchId: string) {
    return api<ApiBatch>(`/api/tools/pdf-slicer/batches/${encodeURIComponent(batchId)}`)
  },
  getRun(runId: string) {
    return api<ApiRun>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}`)
  },
  deleteRun(runId: string) {
    return api(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' })
  },
  openRunFolder(runId: string) {
    return api(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/open-folder`, { method: 'POST' })
  },
  updateRunClassification(runId: string, payload: { materialType: string; fileRole: string }) {
    return api<{ warning?: string }>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/classification`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  classifyRunQuestions(runId: string) {
    return api<{ run: ApiRun; items: QuestionItem[]; report?: { total?: number; updated?: number; failed?: number } }>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/classify`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    })
  },
  startSlice(runId: string) {
    return api(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/start-slice`, { method: 'POST' })
  },
  getSliceReviewItems(runId: string) {
    return api<SliceReviewItemsResponse>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/slice-review/items`)
  },
  quickReview(payload: QuickReviewPayload) {
    return api('/api/tools/pdf-slicer/runs/quick-review', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  deleteSliceReviewItem(runId: string, resultId: string) {
    return api(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/slice-review/items/${encodeURIComponent(resultId)}`, { method: 'DELETE' })
  },
  mergeSliceReviewItems(runId: string, resultIds: string[]) {
    return api<{ mergedId?: string; removedIds?: string[] }>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/slice-review/items/merge`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ resultIds }),
    })
  },
  updateSliceReviewItemFigures(runId: string, resultId: string, figures: ReviewFigure[] | Array<Record<string, unknown>>) {
    return api<{ item?: SliceReviewItem }>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/slice-review/items/${encodeURIComponent(resultId)}/figures`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ figures }),
    })
  },
  updateSliceReviewItemSolutionFigures(runId: string, resultId: string, figures: ReviewFigure[] | Array<Record<string, unknown>>) {
    return api<{ item?: SliceReviewItem }>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/slice-review/items/${encodeURIComponent(resultId)}/solution-figures`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ figures }),
    })
  },
  updateSliceReviewItem(runId: string, resultId: string, payload: { questionLabel?: string }) {
    return api<{ item?: SliceReviewItem }>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/slice-review/items/${encodeURIComponent(resultId)}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  splitSliceReviewItem(runId: string, resultId: string, splitRatio: number) {
    return api<{ bottomId?: string }>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/slice-review/items/${encodeURIComponent(resultId)}/split`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ splitRatio }),
    })
  },
}

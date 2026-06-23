import { api, jsonHeaders } from './client'
import type { ApiRun, QuestionBankResponse, QuestionFigure, QuestionItem } from '@/types'

export type QuestionBankListParams = {
  q?: string
  stage?: string
  questionType?: string
  knowledgePoint?: string
  solutionMethod?: string
  difficulty?: string
  page?: number
  pageSize?: number
}

export type QuestionFigurePayload = {
  usage: string
  optionLabel?: string
  pageNumber?: number
  bbox?: Record<string, number>
}

function buildQuery(params: QuestionBankListParams = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  const queryString = query.toString()
  return queryString ? `?${queryString}` : ''
}

export const questionBankApi = {
  listItems(params: QuestionBankListParams = {}) {
    return api<QuestionBankResponse>(`/api/question-bank/items${buildQuery(params)}`)
  },
  getItem(id: string) {
    return api<QuestionItem>(`/api/question-bank/items/${encodeURIComponent(id)}`)
  },
  createItem(item: Partial<QuestionItem>) {
    return api<QuestionItem>('/api/question-bank/items', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(item),
    })
  },
  updateItem(id: string, item: Partial<QuestionItem>) {
    return api<QuestionItem>(`/api/question-bank/items/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ item }),
    })
  },
  deleteItem(id: string) {
    return api(`/api/question-bank/items/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  rerunItemOcr(id: string, payload: Record<string, unknown> = {}) {
    return api<{ runId: string; message?: string }>(`/api/question-bank/items/${encodeURIComponent(id)}/rerun-ocr`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  importJsonItems(payload: Record<string, unknown>) {
    return api<{ items: QuestionItem[]; count: number; pendingBankUrl?: string }>('/api/question-bank/import-json', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  importJsonItemsFromSlices(payload: Record<string, unknown>) {
    return api<{ run?: ApiRun; items: QuestionItem[]; count: number; pendingBankUrl?: string; report?: { total?: number; updated?: number; failed?: number } }>('/api/question-bank/import-json-from-slices', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  listRunQuestions(runId: string) {
    return api<{ run: ApiRun; items: QuestionItem[] }>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/questions`)
  },
  createFigure(questionId: string, payload: QuestionFigurePayload) {
    return api<QuestionFigure>(`/api/question-bank/items/${encodeURIComponent(questionId)}/figures`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  updateFigure(questionId: string, figureId: string, payload: QuestionFigurePayload) {
    return api<QuestionFigure>(`/api/question-bank/items/${encodeURIComponent(questionId)}/figures/${encodeURIComponent(figureId)}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  deleteFigure(questionId: string, figureId: string) {
    return api(`/api/question-bank/items/${encodeURIComponent(questionId)}/figures/${encodeURIComponent(figureId)}`, { method: 'DELETE' })
  },
  uploadFigure(questionId: string, form: FormData) {
    return api<QuestionFigure>(`/api/question-bank/items/${encodeURIComponent(questionId)}/figures/upload`, {
      method: 'POST',
      body: form,
    })
  },
}

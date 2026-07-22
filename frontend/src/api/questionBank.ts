import { api, jsonHeaders } from './client'
import type { QuestionBankResponse, QuestionFigure, QuestionItem } from '@/types'

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
  sourcePath?: string
}

export type QuestionBankClassificationReport = {
  scopeType: 'all' | 'pdf_slicer_run' | 'import_job'
  scopeId: string
  total: number
  updated: number
  failed: number
  failures?: Array<{ id: string; error: string }>
}

export type AiCleanMode = 'full' | 'format_only'

export type AiCleanPreview = {
  itemId: string
  mode: AiCleanMode
  patch: Pick<QuestionItem, 'stemMarkdown' | 'answerText' | 'analysisMarkdown'>
  warnings: string[]
  confidence: number
  formatIssues: Array<{
    field?: string
    code?: string
    message?: string
    snippet?: string
    context?: string
    mode?: string
    start?: number
    end?: number
  }>
}

export type RandomPaperMatchMode = 'strict' | 'loose'
export type RandomPaperDifficultyMode = 'foundation' | 'standard' | 'advanced' | 'challenge' | 'custom'

export type QuickActionMetadata = {
  stages: string[]
  questionTypes: Array<{ type: string; total: number; available: number }>
  totalReady: number
  filteredTotal: number
  averageDifficulty: number | null
  difficultyUnknownCount: number
}

export type RandomPaperSummary = {
  requestedTotal: number
  generatedTotal: number
  typeCounts: Record<string, number>
  averageDifficulty: number | null
  matchMode: RandomPaperMatchMode
  difficultyMode: RandomPaperDifficultyMode
  difficultyRange?: { min: number; max: number }
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
  updateItem(id: string, item: Partial<QuestionItem>, expectedContentRevision?: number) {
    return api<QuestionItem>(`/api/question-bank/items/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ item, expectedContentRevision }),
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
  previewAiCleanItem(id: string, payload: { mode?: AiCleanMode } = {}) {
    return api<AiCleanPreview>(`/api/question-bank/items/${encodeURIComponent(id)}/ai-clean-preview`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  classifyAllItems() {
    return api<{ report: QuestionBankClassificationReport }>('/api/question-bank/items/classify', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    })
  },
  importJsonItems(payload: Record<string, unknown>) {
    return api<{ items: QuestionItem[]; count: number; pendingBankUrl?: string }>('/api/question-bank/import-json', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
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
  getQuickActionMetadata(params: {
    stage?: string
    knowledgePoints?: string[]
    solutionMethods?: string[]
    matchMode?: RandomPaperMatchMode
    difficultyMode?: RandomPaperDifficultyMode
    difficultyRange?: { min: number; max: number }
  } = {}) {
    const query = new URLSearchParams()
    if (params.stage) query.set('stage', params.stage)
    if (params.knowledgePoints?.length) query.set('knowledgePoints', params.knowledgePoints.join(','))
    if (params.solutionMethods?.length) query.set('solutionMethods', params.solutionMethods.join(','))
    if (params.matchMode) query.set('matchMode', params.matchMode)
    if (params.difficultyMode) query.set('difficultyMode', params.difficultyMode)
    if (params.difficultyRange) {
      query.set('difficultyMin', String(params.difficultyRange.min))
      query.set('difficultyMax', String(params.difficultyRange.max))
    }
    const queryString = query.toString()
    return api<QuickActionMetadata>(`/api/question-bank/quick-action-metadata${queryString ? `?${queryString}` : ''}`)
  },
  getDailyQuestion(params: { stage?: string; knowledgePoint?: string; solutionMethod?: string } = {}) {
    const query = new URLSearchParams()
    if (params.stage) query.set('stage', params.stage)
    if (params.knowledgePoint) query.set('knowledgePoint', params.knowledgePoint)
    if (params.solutionMethod) query.set('solutionMethod', params.solutionMethod)
    const queryString = query.toString()
    return api<{ question: QuestionItem; markdown: string; answerMarkdown: string }>(
      `/api/question-bank/daily-question${queryString ? `?${queryString}` : ''}`
    )
  },
  generateRandomPaper(payload: {
    stage?: string
    matchMode?: RandomPaperMatchMode
    difficultyMode?: RandomPaperDifficultyMode
    difficultyRange?: { min: number; max: number }
    typeCounts?: Record<string, number>
    knowledgePoints?: string[]
    solutionMethods?: string[]
    counts?: {
      singleChoice?: number
      multiChoice?: number
      fillBlank?: number
      bigQuestion?: number
    }
  }) {
    return api<{ questions: QuestionItem[]; warnings: string[]; summary?: RandomPaperSummary }>('/api/question-bank/random-paper', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
}

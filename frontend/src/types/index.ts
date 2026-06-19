import type { ReactNode } from 'react'

export type ApiRun = {
  runId: string
  batchId: string
  uploadMode?: string
  paperTitle: string
  pdfName: string
  pdfPath: string
  sourceFileName: string
  sourceFileKind: string
  materialType?: 'exam' | 'lecture' | 'unknown'
  fileRole?: 'full' | 'questions' | 'solutions' | 'unknown'
  classificationConfidence?: number
  classificationReasons?: string[]
  runDir: string
  documentDiagnostics?: Record<string, unknown>
  diagnosticMessage?: string
  createdAt: string
  updatedAt: string
  sliceStatus: string
  sliceError?: string
  quickReviewStatus: string
  totalQuestions: number
  approvedQuestions: number
  unreviewedQuestions: number
  ocrStatus: string
  ocrError: string
  progressPercent?: number
  processedQuestions?: number
  totalOcrQuestions?: number
  importedQuestions?: number
  bankedQuestions?: number
  solutionItems?: number
}

export type ApiBatch = {
  id: string
  title: string
  materialType: 'exam' | 'lecture' | 'unknown'
  workflowMode: 'single' | 'separated_exam'
  workflowStatus: 'ready' | 'needs_classification' | 'processing' | 'ready_for_bank' | 'needs_review'
  createdAt: string
  uploadedCount: number
  runCount?: number
}

export type Dashboard = {
  queueSummary: Record<string, number>
  batches: ApiBatch[]
  runs: ApiRun[]
}

export type QuestionItem = {
  id: string
  serialNo: number | null
  questionNo: string
  stage: string
  questionType: string
  difficultyScore: number
  difficultyScore10: number
  difficultyLabel: string
  chapter: string
  knowledgePoints: string[]
  solutionMethods: string[]
  sourceTitle: string
  bankStatus: string
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  problemBlocks?: RichBlock[]
  answerBlocks?: RichBlock[]
  analysisBlocks?: RichBlock[]
  searchText?: string
  sliceImagePath: string
  ocrSegmentImages?: Array<{
    kind: 'problem' | 'answer' | 'analysis'
    label: string
    path: string
  }>
  figures: QuestionFigure[]
  sourceRunId: string
  sourceSolutionRunId?: string
  mergeStatus?: string
  mergeNote?: string
  updatedAt: string
  hasFigures: boolean
  similarQuestions?: SimilarQuestion[]
  pendingBankReadOnly?: boolean
  needsFormatReview?: boolean
  formatIssue?: {
    field?: string
    code?: string
    message?: string
    snippet?: string
    context?: string
    mode?: string
    start?: number
    end?: number
  }
}

export type SimilarQuestion = {
  id: string
  questionNo: string
  sourceTitle: string
  bankStatus: string
  similarity: number
  stemPreview: string
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  questionType: string
}

export type RichInline =
  | { type: 'text'; text: string }
  | { type: 'inline_math'; tex: string }

export type RichBlock =
  | { type: 'paragraph'; content: RichInline[] }
  | { type: 'display_math'; tex: string }
  | { type: 'choices'; options: Array<{ label: string; blocks: RichBlock[] }> }
  | { type: 'table'; rows: Array<{ header?: boolean; cells: RichInline[][] }> }

export type QuestionFigure = {
  id?: string
  origin?: string
  usage?: string
  category?: string
  optionLabel?: string
  pageNumber?: number
  bbox?: Record<string, number>
  sourcePath?: string
  path?: string
}

export type BasketQuestion = {
  relationId?: string
  sortOrder?: number
  score?: number
  sectionName?: string
  item: QuestionItem
}

export type Basket = {
  id: string
  title: string
  subtitle?: string
  description?: string
  kind?: 'basket' | 'paper'
  status?: 'draft' | 'finalized'
  totalScore?: number
  timeLimit?: number
  exportFormat?: 'markdown' | 'latex'
  questionCount: number
  questions: BasketQuestion[]
}

export type QuestionBankResponse = {
  items: QuestionItem[]
  totalItems: number
  page: number
  pageSize: number
  totalPages: number
  basket: Basket
}

export type CollectionSummary = Omit<Basket, 'questions'> & {
  createdAt?: string
  updatedAt?: string
}

export type CollectionExport = {
  filename: string
  format: 'markdown' | 'latex' | 'pdf'
  content?: string
  url?: string
  path?: string
}

export type OcrJobs = {
  summary: Record<string, number>
  currentRun: ApiRun | null
  queuedRuns: ApiRun[]
  historyRuns: ApiRun[]
}

export type OcrProgress = {
  run: ApiRun
  active: boolean
  importedQuestions: number
  draftCount: number
  successfulDraftCount: number
  failedDraftCount: number
  totalQuestions: number
  progressPercent: number
  formatCleanup: null | {
    examinedCount?: number
    scriptChangedCount?: number
    modelNeededCount?: number
    modelCleanedCount?: number
    modelAttemptedCount?: number
    modelResolvedCount?: number
    failedCount?: number
    classificationAttemptedCount?: number
    classificationResolvedCount?: number
    records?: {
      id?: string
      draft?: string
      needsModelCleanup?: boolean
      reasons?: string[]
      modelError?: string
      classificationError?: string
      renderErrors?: {
        field?: string
        code?: string
        message?: string
        snippet?: string
        context?: string
        mode?: string
        start?: number
        end?: number
      }[]
    }[]
  }
  formatCleanupActive: boolean
  formatCleanupReportPath: string
  formatCleanupLogPath: string
  formatCleanupLogTail: string
  logTail: string
}

export type OcrSettings = {
  apiBaseUrl: string
  apiKeyConfigured: boolean
  model: string
  dryRun: string
  maxItems: string
  concurrency: string
  maxRetries: string
  retryDelaySeconds: string
  imageMaxWidth: string
  topK: string
  cleanupApiBaseUrl: string
  cleanupApiKeyConfigured: boolean
  cleanupModel: string
  cleanupConcurrency: string
  classificationEnabled: string
  wholeSystemPrompt: string
  wholeUserPrompt: string
  chunkSystemPrompt: string
  chunkUserPrompt: string
  cleanupSystemPrompt: string
  cleanupUserPrompt: string
  classificationSystemPrompt: string
  classificationUserPrompt: string
}

export type TagLibraries = {
  knowledgePoints: string[]
  solutionMethods: string[]
  stages: string[]
  difficultyLabels: string[]
}

export type SliceReviewItem = {
  resultId: string
  runId: string
  questionLabel: string
  pageStart: number
  pageEnd: number
  imageUrl: string
  autoImagePath: string
  pageImagePath: string
  reviewStatus: string
  note: string
  bbox: Record<string, number>
  segments?: Array<Record<string, unknown>>
  figures: Array<Record<string, unknown>>
}

export type BBox = {
  x: number
  y: number
  width: number
  height: number
}

export type CropInteraction =
  | { mode: 'draw'; start: { x: number; y: number } }
  | { mode: 'move'; start: { x: number; y: number }; rect: BBox }
  | { mode: 'resize'; corner: CropCorner; start: { x: number; y: number }; rect: BBox }

export type CropCorner = 'nw' | 'ne' | 'sw' | 'se'

export type ChoiceOption = {
  label: string
  content: string
}

export type ParsedChoiceQuestion = {
  stem: string
  options: ChoiceOption[]
}

export type AppReactNode = ReactNode

// Pending Bank Confirmation Page types
export type PendingBankFilter = 'all' | 'ready' | 'blocked' | 'banked' | 'skipped' | 'ocr_failed' | 'format_issue' | 'has_figures'

export type PendingBankSummary = {
  total: number
  ready: number
  blocked: number
  banked: number
  skipped: number
  ocrFailed: number
  formatIssue: number
  hasFigures: number
}

export type PendingBankResponse = {
  run: ApiRun
  summary: PendingBankSummary
  items: QuestionItem[]
}

export type BulkActionResult = {
  success: number
  failed: number
  warnings?: string[]
}

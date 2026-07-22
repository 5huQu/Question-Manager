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
  stage?: string
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
  ocrProvider?: 'legacy' | 'doc2x' | 'glm'
  ocrExternalUid?: string
  ocrProviderPhase?: string
  ocrProviderProgress?: number
  ocrProviderResultPath?: string
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
  contentRevision?: number
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
  province?: string
  city?: string
  paperTitle?: string
  batchName?: string
  subject?: string
  paperKind?: 'gaokao_real' | 'local_real' | 'mock' | 'school_exam' | 'lecture' | 'daily_practice' | 'unknown'
  examYear?: number
  sourceOrg?: string
  importSourceId?: string
  bankStatus: string
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  totalScore: number
  scoringRubric: ScoringRubricItem[]
  problemBlocks?: RichBlock[]
  answerBlocks?: RichBlock[]
  analysisBlocks?: RichBlock[]
  searchText?: string
  sliceImagePath: string
  solutionImagePath?: string
  ocrSegmentImages?: Array<{
    kind: 'problem' | 'answer' | 'analysis'
    label: string
    path: string
  }>
  figures: QuestionFigure[]
  sourceRunId: string
  sourceOcrProvider?: 'legacy' | 'doc2x' | 'glm'
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

export type ScoringRubricItem = {
  label: string
  score: number
  text: string
}

export type SimilarQuestion = {
  id: string
  questionNo: string
  sourceTitle: string
  sourceRunId: string
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

export type ParagraphRichBlock = Extract<RichBlock, { type: 'paragraph' }>

export type QuestionFigure = {
  id?: string
  blockId?: string
  origin?: string
  usage?: string
  category?: string
  optionLabel?: string
  pageNumber?: number
  bbox?: Record<string, number>
  sourcePath?: string
  path?: string
}

export type ReviewFigure = {
  id?: string
  page_number?: number
  pageNumber?: number
  bbox?: BBox | Record<string, number>
  kind?: string
  usage?: string
  category?: string
  optionLabel?: string
  [key: string]: unknown
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
  classificationPendingCount?: number
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

export type ExportRecord = {
  id: string
  sourceType: 'collection' | 'run' | 'import_job'
  collectionId: string
  runId: string
  importJobId: string
  title: string
  format: string
  variant: string
  filename: string
  path: string
  url: string
  items: Array<{ questionId: string; exportOrder: number }>
  contentLength: number
  questionCount: number
  status: 'succeeded' | 'failed'
  error: string
  createdAt: string
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
  pendingDraftCount: number
  totalQuestions: number
  progressPercent: number
  logTail: string
}

export type LearningLibraryType = 'knowledge_point' | 'method_tag'

export type LearningTagPoint = {
  id: string
  code: string
  name: string
  description?: string
  tagType?: 'knowledge' | 'method' | 'problem_type' | 'strategy' | 'other' | string
  appliesTo?: string[]
  sortOrder: number
}

export type LearningTagChapter = {
  id: string
  code: string
  name: string
  sortOrder: number
  knowledgePoints: LearningTagPoint[]
}

export type LearningTagLibrary = {
  id: string
  code: string
  name: string
  subject: string
  stage: string
  locale: string
  version: string
  source: string
  libraryType: LearningLibraryType
  baseKnowledgeLibraryId?: string
  baseKnowledgeLibraryCode?: string
  baseKnowledgeLibraryName?: string
  isDefault: boolean
  chapters: LearningTagChapter[]
}

export type OcrSettings = {
  setupCompleted: boolean
  systemName: string
  siteTitle: string
  siteDescription: string
  examExportTemplate: 'builtin' | 'examch'
  worksheetWatermark: string
  examWatermark: string
  lectureWatermark: string
  teachingStages: string[]
  sofficePath: string
  sofficeAvailable: boolean
  sofficeDetectedPath: string
  ocrProvider: 'legacy' | 'doc2x' | 'glm'
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
  doc2xApiBaseUrl: string
  doc2xApiKeyConfigured: boolean
  doc2xModel: string
  glmOcrApiBaseUrl: string
  glmOcrApiKeyConfigured: boolean
  glmOcrModel: string
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
  assistantCleanSystemPrompt: string
  assistantCleanUserPrompt: string
}

export type SlicerRuleEntry = {
  id: string
  term: string
  matchMode: 'contains' | 'exact'
  enabled: boolean
}

export type SlicerRulesData = {
  version: number
  auxiliaryMarkers: SlicerRuleEntry[]
  noticeTerms: SlicerRuleEntry[]
  referenceFormulaMarkers: SlicerRuleEntry[]
  trainingMarkers: SlicerRuleEntry[]
  nonQuestionRemainders: SlicerRuleEntry[]
  sectionMarkers: SlicerRuleEntry[]
}

export type SlicerRulesResponse = SlicerRulesData & {
  baseVersion: number
  hash: string
}

export type SlicerRulesHistoryEntry = {
  version: number
  timestamp: string
  hash: string
}

export type TagLibraries = {
  knowledgePoints: string[]
  solutionMethods: string[]
  stages: string[]
  questionTypes: string[]
  difficultyLabels: string[]
}

export type SliceReviewItem = {
  resultId: string
  runId: string
  questionLabel: string
  pageStart: number
  pageEnd: number
  imageUrl: string
  solutionImageUrl?: string
  solutionImagePath?: string
  hasSolutionSlice?: boolean
  solutionBbox?: Record<string, number>
  solutionSegments?: Array<Record<string, unknown>>
  solutionFigures?: ReviewFigure[]
  autoImagePath: string
  pageImagePath: string
  reviewStatus: string
  note: string
  bbox: Record<string, number>
  segments?: Array<Record<string, unknown>>
  figures: ReviewFigure[]
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
  remainder?: string
}

export type AppReactNode = ReactNode

// Pending Bank Confirmation Page types
export type PendingBankFilter = 'all' | 'ready' | 'blocked' | 'banked' | 'skipped' | 'ocr_failed' | 'has_figures'

export type PendingBankSummary = {
  total: number
  ready: number
  blocked: number
  banked: number
  skipped: number
  ocrFailed: number
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

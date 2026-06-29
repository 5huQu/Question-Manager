import { api, jsonHeaders } from './client'
import type { ExportRecord, QuestionItem } from '@/types'

export type SourceDocumentImportStats = {
  ocrDocumentCount: number
  candidateCount: number
  readyCount: number
  needsReviewCount: number
  needsManualFixCount: number
  blockedCount: number
  committedCount: number
  uncommittedCount: number
  allCommitted: boolean
  parseDiagnosticCount: number
  metadataLikeAnswerCount: number
  missingAnalysisDiagnosticCount: number
  unmatchedSolutionDiagnosticCount: number
}

export type ImportV2SourceDocument = {
  id: string
  title: string
  originalFileName: string
  filePath: string
  fileType: 'pdf' | 'image' | 'markdown' | 'json'
  pageCount: number
  provider?: 'doc2x' | 'glm' | 'manual' | 'json'
  status: string
  province: string
  city: string
  paperTitle: string
  batchName: string
  stage: string
  subject: string
  paperKind: 'gaokao_real' | 'local_real' | 'mock' | 'school_exam' | 'lecture' | 'daily_practice' | 'unknown'
  examYear: number
  sourceOrg: string
  metadata: Record<string, unknown>
  importStats?: SourceDocumentImportStats
  createdAt: string
  updatedAt: string
}

export type PaperKind = ImportV2SourceDocument['paperKind']

export type SourceMetadataDraft = {
  province: string
  city: string
  paperTitle: string
  batchName: string
  stage: string
  subject: string
  paperKind: PaperKind
  examYear: number | string
  sourceOrg: string
  hasWatermark?: boolean
  watermarkTerms?: string
}

export type ImportV2OcrDocument = {
  id: string
  sourceDocumentId: string
  provider: 'doc2x' | 'glm'
  rawResultPath: string
  markdownPath: string
  blocksJsonPath: string
  assetsJsonPath: string
  metadata: Record<string, unknown>
  createdAt: string
}

export type ImportV2OcrTask = {
  sourceDocumentId?: string
  provider?: 'doc2x' | 'glm'
  status: 'uploaded' | 'ocr_running' | 'ocr_succeeded' | 'ocr_failed' | 'parsed' | 'partially_parsed'
  ocrDocumentId?: string
  startedAt?: string
  finishedAt?: string
  error?: string
}

export type ImportV2CandidateIssue = {
  code: string
  severity: 'warning' | 'error'
  message: string
}

export type ImportV2CandidateParseDiagnostic = {
  code: string
  severity: 'info' | 'warning' | 'error'
  questionNo?: string
  message: string
  start?: number
  end?: number
}

export type SolutionBindingStrategy = 'heading_then_question' | 'question_then_heading' | 'auto'

export type MetadataBlockPolicy = 'ignore' | 'append_to_analysis' | 'store_as_note'

export type AnswerTablePolicy =
  | 'fill_empty_only'
  | 'override_metadata_like_answer'
  | 'prefer_table_for_choice_questions'

export type ImportFlowV2ParserConfig = {
  version: number
  sectionHeadings: string[]
  documentNoteKeywords: string[]
  solutionSectionKeywords: string[]
  primaryQuestionPatterns: string[]
  subQuestionPatterns: string[]
  allowParenthesizedNumberAsPrimary: boolean
  figureKeywords: string[]
  solutionBindingStrategy: SolutionBindingStrategy
  metadataBlockKeywords: string[]
  metadataBlockPolicy: MetadataBlockPolicy
  answerTablePolicy: AnswerTablePolicy
}

export type ImportParserPreset = {
  id: string
  name: string
  description: string
  config: ImportFlowV2ParserConfig
  createdAt: string
  updatedAt: string
  builtIn?: boolean
}

export type ParseCandidatesRequest = {
  configOverride?: Partial<ImportFlowV2ParserConfig>
  presetId?: string
}

export type MarkdownRange = {
  start: number
  end: number
}

export type MarkdownPreviewResponse = {
  ocrDocumentId: string
  sourceDocumentId: string
  provider: string
  markdown: string
  lineOffsets: Array<{ lineNo: number; start: number; end: number }>
  pageMarkers: Array<{ pageNo: number; offset: number; lineNo: number }>
}

export type MarkdownStructureToken = {
  id: string
  kind:
    | 'page_marker'
    | 'question_no'
    | 'sub_question_no'
    | 'answer_table'
    | 'solution_heading'
    | 'metadata_heading'
    | 'stem_range'
    | 'answer_range'
    | 'analysis_range'
  questionNo?: string
  start: number
  end: number
  lineStart: number
  lineEnd: number
  label: string
  severity?: 'info' | 'warning' | 'error'
}

export type ParserDiagnostic = {
  code:
    | 'solution_heading_without_following_question'
    | 'question_before_solution_heading'
    | 'metadata_used_as_answer'
    | 'table_answer_blocked_by_existing_answer'
    | 'missing_analysis'
    | 'unmatched_solution'
  severity: 'info' | 'warning' | 'error'
  questionNo?: string
  message: string
  start?: number
  end?: number
  suggestedConfigPatch?: Partial<ImportFlowV2ParserConfig>
}

export type CandidateParsePreview = {
  questionNo: string
  stemPreview: string
  answerPreview: string
  analysisPreview: string
  sourceRanges: {
    stem?: MarkdownRange
    answer?: MarkdownRange
    analysis?: MarkdownRange
  }
  issues: ParserDiagnostic[]
}

export type ParserPreviewResponse = {
  config: ImportFlowV2ParserConfig
  strategyRecommendation?: {
    strategy: SolutionBindingStrategy
    reason: string
    confidence: number
  }
  structures: MarkdownStructureToken[]
  candidatePreviews: CandidateParsePreview[]
  diagnostics: ParserDiagnostic[]
}

export type ImportV2Candidate = {
  id: string
  sourceDocumentId: string
  ocrDocumentId?: string
  questionNo: string
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  questionType?: string
  difficultyScore10?: number
  difficultyLabel?: string
  knowledgePoints: string[]
  solutionMethods: string[]
  figures: Array<{ id: string; usage: string; path: string; pageNo?: number; blockId?: string; sourceBlockId?: string; bbox?: [number, number, number, number]; inlineMarker?: string; optionLabel?: string }>
  sourceRefs: Array<{ pageNo: number; blockIds: string[]; kind: string }>
  status: 'ready' | 'needs_review' | 'needs_manual_fix' | 'blocked' | 'committed'
  province: string
  city: string
  paperTitle: string
  batchName: string
  stage: string
  subject: string
  paperKind: 'gaokao_real' | 'local_real' | 'mock' | 'school_exam' | 'lecture' | 'daily_practice' | 'unknown'
  examYear: number
  sourceOrg: string
  committedQuestionId?: string
  committedAt?: string
  issues: ImportV2CandidateIssue[]
  parseDiagnostics: ImportV2CandidateParseDiagnostic[]
  parserConfigSnapshot: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type OcrFigureDiagnostics = {
  placeholderCount: number
  assetsCount: number
  unmatchedPlaceholderCount: number
  unusedAssetsCount: number
  failedDownloadCount: number
}

export type ParseCandidatesResult = {
  candidateCount: number
  readyCount: number
  needsReviewCount: number
  needsManualFixCount?: number
  blockedCount: number
  items: ImportV2Candidate[]
  diagnostics?: OcrFigureDiagnostics
}

export type ImportV2ImportJob = {
  id: string
  title: string
  mode: 'single_document' | 'separated_documents'
  status: 'draft' | 'parsing' | 'parsed' | 'partially_parsed' | 'failed'
  province: string
  city: string
  paperTitle: string
  batchName: string
  stage: string
  subject: string
  paperKind: ImportV2SourceDocument['paperKind']
  examYear: number
  sourceOrg: string
  createdAt: string
  updatedAt: string
}

export type ImportV2ImportJobDocument = {
  id: string
  jobId: string
  sourceDocumentId: string
  role: 'full' | 'questions' | 'solutions'
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type ImportV2ImportJobDocumentDetail = ImportV2ImportJobDocument & {
  sourceDocument: ImportV2SourceDocument
}

export type ImportV2ImportJobStats = {
  sourceDocumentCount: number
  ocrSucceededCount: number
  candidateCount: number
  committedCandidateCount: number
  questionCount: number
  needsReviewCount: number
  blockedCount: number
  totalItems?: number
  readyCount?: number
}

export type ImportV2ImportJobDetail = {
  importJob: ImportV2ImportJob
  documents: ImportV2ImportJobDocumentDetail[]
  stats: ImportV2ImportJobStats
}

export type ImportV2JobQuestionsResponse = ImportV2ImportJobDetail & {
  items: QuestionItem[]
}

export type ImportV2JobClassificationResponse = ImportV2JobQuestionsResponse & {
  report?: {
    scopeType?: string
    scopeId?: string
    importJobId?: string
    total?: number
    updated?: number
    failed?: number
    failures?: Array<{ id: string; error: string }>
  }
}

export type ImportJobExportResult = {
  filename: string
  format: string
  url: string
  path?: string
  exportRecord?: ExportRecord
}

export const importV2Api = {
  getParserConfig() {
    return api<{ config: ImportFlowV2ParserConfig }>('/api/import-flow-v2/parser-config')
  },
  updateParserConfig(config: ImportFlowV2ParserConfig) {
    return api<{ config: ImportFlowV2ParserConfig }>('/api/import-flow-v2/parser-config', {
      method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ config }),
    })
  },
  resetParserConfig() {
    return api<{ config: ImportFlowV2ParserConfig }>('/api/import-flow-v2/parser-config/reset', { method: 'POST' })
  },
  listParserPresets() {
    return api<{ items: ImportParserPreset[] }>('/api/import-flow-v2/parser-presets')
  },
  createParserPreset(preset: Pick<ImportParserPreset, 'name' | 'description' | 'config'> & { id?: string }) {
    return api<{ preset: ImportParserPreset; items: ImportParserPreset[] }>('/api/import-flow-v2/parser-presets', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ preset }),
    })
  },
  updateParserPreset(presetId: string, preset: Partial<Pick<ImportParserPreset, 'name' | 'description' | 'config'>>) {
    return api<{ preset: ImportParserPreset; items: ImportParserPreset[] }>('/api/import-flow-v2/parser-presets/' + encodeURIComponent(presetId), {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ preset }),
    })
  },
  deleteParserPreset(presetId: string) {
    return api<{ success: boolean; items: ImportParserPreset[] }>('/api/import-flow-v2/parser-presets/' + encodeURIComponent(presetId), {
      method: 'DELETE',
    })
  },
  getMarkdownPreview(ocrDocumentId: string) {
    return api<MarkdownPreviewResponse>('/api/import-flow-v2/ocr-documents/' + encodeURIComponent(ocrDocumentId) + '/markdown-preview')
  },
  getParserPreview(ocrDocumentId: string, payload: { config?: Partial<ImportFlowV2ParserConfig>; focusQuestionNo?: string; candidateId?: string } = {}) {
    return api<ParserPreviewResponse>('/api/import-flow-v2/ocr-documents/' + encodeURIComponent(ocrDocumentId) + '/parser-preview', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  listSourceDocuments() {
    return api<{ items: ImportV2SourceDocument[] }>('/api/import-flow-v2/source-documents')
  },
  uploadSourceDocument(file: File, metadata?: Partial<ImportV2SourceDocument>) {
    const body = new FormData()
    body.append('file', file)
    if (metadata) body.append('metadata', JSON.stringify(metadata))
    return api<{ sourceDocument: ImportV2SourceDocument }>('/api/import-flow-v2/source-documents/upload', {
      method: 'POST',
      body,
    })
  },
  createImportJob(importJob: Partial<ImportV2ImportJob>) {
    return api<{ importJob: ImportV2ImportJob; documents: ImportV2ImportJobDocument[] }>('/api/import-flow-v2/jobs', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(importJob),
    })
  },
  getImportJob(importJobId: string) {
    return api<ImportV2ImportJobDetail>('/api/import-flow-v2/jobs/' + encodeURIComponent(importJobId))
  },
  addSourceDocumentToImportJob(importJobId: string, payload: { sourceDocumentId: string; role: ImportV2ImportJobDocument['role']; sortOrder?: number }) {
    return api<{ importJob: ImportV2ImportJob; document: ImportV2ImportJobDocument; sourceDocument: ImportV2SourceDocument; documents: ImportV2ImportJobDocument[] }>('/api/import-flow-v2/jobs/' + encodeURIComponent(importJobId) + '/documents', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  parseImportJobCandidates(importJobId: string, payload: ParseCandidatesRequest = {}) {
    return api<ParseCandidatesResult & { importJob?: ImportV2ImportJob; mode?: ImportV2ImportJob['mode']; status?: ImportV2ImportJob['status'] }>('/api/import-flow-v2/jobs/' + encodeURIComponent(importJobId) + '/parse-candidates', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  updateSourceDocument(sourceDocumentId: string, sourceDocument: Partial<ImportV2SourceDocument>) {
    return api<{ sourceDocument: ImportV2SourceDocument }>('/api/import-flow-v2/source-documents/' + encodeURIComponent(sourceDocumentId), {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ sourceDocument }),
    })
  },
  startSourceDocumentOcr(sourceDocumentId: string, options?: { provider?: 'doc2x' | 'glm'; force?: boolean } | 'doc2x' | 'glm') {
    const payload = typeof options === 'string' ? { provider: options } : options || {}
    return api<{ sourceDocument: ImportV2SourceDocument; task: ImportV2OcrTask }>('/api/import-flow-v2/source-documents/' + encodeURIComponent(sourceDocumentId) + '/ocr', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  getSourceDocumentOcrStatus(sourceDocumentId: string) {
    return api<{ sourceDocument: ImportV2SourceDocument; task: ImportV2OcrTask; ocrDocument?: ImportV2OcrDocument }>('/api/import-flow-v2/source-documents/' + encodeURIComponent(sourceDocumentId) + '/ocr-status')
  },
  listOcrDocuments(sourceDocumentId?: string) {
    const query = sourceDocumentId ? '?sourceDocumentId=' + encodeURIComponent(sourceDocumentId) : ''
    return api<{ items: ImportV2OcrDocument[] }>('/api/ocr-documents' + query)
  },
  importOcrDocumentJson(payload: Record<string, unknown>) {
    return api<{ sourceDocument: ImportV2SourceDocument; ocrDocument: ImportV2OcrDocument }>('/api/ocr-documents/import-json', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  updateOcrDocumentMarkdown(ocrDocumentId: string, markdown: string) {
    return api<{ ocrDocument: ImportV2OcrDocument }>('/api/ocr-documents/' + encodeURIComponent(ocrDocumentId) + '/markdown', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ markdown }),
    })
  },
  parseCandidates(ocrDocumentId: string, payload: ParseCandidatesRequest = {}) {
    return api<ParseCandidatesResult>('/api/ocr-documents/' + encodeURIComponent(ocrDocumentId) + '/parse-candidates', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  listCandidates(sourceDocumentId: string) {
    return api<{ items: ImportV2Candidate[]; diagnostics?: OcrFigureDiagnostics }>('/api/import-flow-v2/source-documents/' + encodeURIComponent(sourceDocumentId) + '/candidates')
  },
  updateCandidate(candidateId: string, candidate: Partial<ImportV2Candidate>) {
    return api<{ candidate: ImportV2Candidate }>('/api/import-flow-v2/candidates/' + encodeURIComponent(candidateId), {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ candidate }),
    })
  },
  commitCandidate(candidateId: string) {
    return api<{ candidate: ImportV2Candidate; item: unknown; classificationReports?: unknown }>('/api/import-flow-v2/candidates/' + encodeURIComponent(candidateId) + '/commit', {
      method: 'POST',
    })
  },
  commitCandidates(candidateIds: string[]) {
    return api<{ success: number; failed: number; items: unknown[]; errors: Array<{ id: string; error: string }>; classificationReports?: unknown }>('/api/import-flow-v2/candidates/commit', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ candidateIds }),
    })
  },
  createManualFixSession(candidateId: string) {
    return api<{ id: string; batchId: string; revision: number; status: string; sourceProfileJson: string; regions: any[] }>('/api/import-flow-v2/candidates/' + encodeURIComponent(candidateId) + '/manual-fix-session', {
      method: 'POST',
    })
  },
  deleteSourceDocument(sourceDocumentId: string) {
    return api<{ success: boolean }>('/api/import-flow-v2/source-documents/' + encodeURIComponent(sourceDocumentId), {
      method: 'DELETE',
    })
  },
  deleteQuestionCandidate(candidateId: string) {
    return api<{ success: boolean }>('/api/import-flow-v2/candidates/' + encodeURIComponent(candidateId), {
      method: 'DELETE',
    })
  },
  resolveImportJobForSourceDocument(sourceDocumentId: string, ensure = true) {
    const query = new URLSearchParams({ sourceDocumentId })
    if (!ensure) query.set('ensure', 'false')
    return api<ImportV2ImportJobDetail>('/api/import-flow-v2/resolve-import-job?' + query.toString())
  },
  resolveImportJobForRunId(runId: string) {
    const query = new URLSearchParams({ runId })
    return api<ImportV2ImportJobDetail>('/api/import-flow-v2/resolve-import-job?' + query.toString())
  },
  listImportJobQuestions(importJobId: string) {
    return api<ImportV2JobQuestionsResponse>('/api/import-flow-v2/jobs/' + encodeURIComponent(importJobId) + '/questions')
  },
  classifyImportJobQuestions(importJobId: string) {
    return api<ImportV2JobClassificationResponse>('/api/import-flow-v2/jobs/' + encodeURIComponent(importJobId) + '/classify', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    })
  },
  listImportJobExportRecords(importJobId: string) {
    return api<{ items: ExportRecord[] }>('/api/import-flow-v2/jobs/' + encodeURIComponent(importJobId) + '/export-records')
  },
  exportImportJob(importJobId: string, payload: Record<string, unknown>) {
    return api<ImportJobExportResult>('/api/import-flow-v2/jobs/' + encodeURIComponent(importJobId) + '/export', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  listImportJobs(query?: Record<string, string>) {
    const q = query ? '?' + new URLSearchParams(query).toString() : ''
    return api<{ items: ImportV2ImportJobDetail[] }>('/api/import-flow-v2/jobs' + q)
  },
  updateImportJob(jobId: string, payload: Partial<ImportV2ImportJob>) {
    return api<{ importJob: ImportV2ImportJob; documents: ImportV2ImportJobDocumentDetail[] }>('/api/import-flow-v2/jobs/' + encodeURIComponent(jobId), {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  deleteImportJob(jobId: string) {
    return api<{ success: boolean }>('/api/import-flow-v2/jobs/' + encodeURIComponent(jobId), {
      method: 'DELETE',
    })
  },
}

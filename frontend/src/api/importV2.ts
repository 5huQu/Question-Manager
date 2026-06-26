import { api, jsonHeaders } from './client'

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

export type ImportFlowV2ParserConfig = {
  version: number
  sectionHeadings: string[]
  documentNoteKeywords: string[]
  solutionSectionKeywords: string[]
  primaryQuestionPatterns: string[]
  subQuestionPatterns: string[]
  allowParenthesizedNumberAsPrimary: boolean
  figureKeywords: string[]
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
  listSourceDocuments() {
    return api<{ items: ImportV2SourceDocument[] }>('/api/source-documents')
  },
  uploadSourceDocument(file: File, metadata?: Partial<ImportV2SourceDocument>) {
    const body = new FormData()
    body.append('file', file)
    if (metadata) body.append('metadata', JSON.stringify(metadata))
    return api<{ sourceDocument: ImportV2SourceDocument }>('/api/source-documents/upload', {
      method: 'POST',
      body,
    })
  },
  createImportJob(importJob: Partial<ImportV2ImportJob>) {
    return api<{ importJob: ImportV2ImportJob; documents: ImportV2ImportJobDocument[] }>('/api/import-jobs', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(importJob),
    })
  },
  getImportJob(importJobId: string) {
    return api<{ importJob: ImportV2ImportJob; documents: ImportV2ImportJobDocument[] }>('/api/import-jobs/' + encodeURIComponent(importJobId))
  },
  addSourceDocumentToImportJob(importJobId: string, payload: { sourceDocumentId: string; role: ImportV2ImportJobDocument['role']; sortOrder?: number }) {
    return api<{ importJob: ImportV2ImportJob; document: ImportV2ImportJobDocument; sourceDocument: ImportV2SourceDocument; documents: ImportV2ImportJobDocument[] }>('/api/import-jobs/' + encodeURIComponent(importJobId) + '/documents', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  parseImportJobCandidates(importJobId: string) {
    return api<ParseCandidatesResult & { importJob?: ImportV2ImportJob; mode?: ImportV2ImportJob['mode']; status?: ImportV2ImportJob['status'] }>('/api/import-jobs/' + encodeURIComponent(importJobId) + '/parse-candidates', {
      method: 'POST',
    })
  },
  updateSourceDocument(sourceDocumentId: string, sourceDocument: Partial<ImportV2SourceDocument>) {
    return api<{ sourceDocument: ImportV2SourceDocument }>('/api/source-documents/' + encodeURIComponent(sourceDocumentId), {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ sourceDocument }),
    })
  },
  startSourceDocumentOcr(sourceDocumentId: string, options?: { provider?: 'doc2x' | 'glm'; force?: boolean } | 'doc2x' | 'glm') {
    const payload = typeof options === 'string' ? { provider: options } : options || {}
    return api<{ sourceDocument: ImportV2SourceDocument; task: ImportV2OcrTask }>('/api/source-documents/' + encodeURIComponent(sourceDocumentId) + '/ocr', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  getSourceDocumentOcrStatus(sourceDocumentId: string) {
    return api<{ sourceDocument: ImportV2SourceDocument; task: ImportV2OcrTask; ocrDocument?: ImportV2OcrDocument }>('/api/source-documents/' + encodeURIComponent(sourceDocumentId) + '/ocr-status')
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
  parseCandidates(ocrDocumentId: string) {
    return api<ParseCandidatesResult>('/api/ocr-documents/' + encodeURIComponent(ocrDocumentId) + '/parse-candidates', {
      method: 'POST',
    })
  },
  listCandidates(sourceDocumentId: string) {
    return api<{ items: ImportV2Candidate[]; diagnostics?: OcrFigureDiagnostics }>('/api/source-documents/' + encodeURIComponent(sourceDocumentId) + '/candidates')
  },
  updateCandidate(candidateId: string, candidate: Partial<ImportV2Candidate>) {
    return api<{ candidate: ImportV2Candidate }>('/api/question-candidates/' + encodeURIComponent(candidateId), {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ candidate }),
    })
  },
  commitCandidate(candidateId: string) {
    return api<{ candidate: ImportV2Candidate; item: unknown }>('/api/question-candidates/' + encodeURIComponent(candidateId) + '/commit', {
      method: 'POST',
    })
  },
  createManualFixSession(candidateId: string) {
    return api<{ id: string; batchId: string; revision: number; status: string; sourceProfileJson: string; regions: any[] }>('/api/question-candidates/' + encodeURIComponent(candidateId) + '/manual-fix-session', {
      method: 'POST',
    })
  },
  deleteSourceDocument(sourceDocumentId: string) {
    return api<{ success: boolean }>('/api/source-documents/' + encodeURIComponent(sourceDocumentId), {
      method: 'DELETE',
    })
  },
  deleteQuestionCandidate(candidateId: string) {
    return api<{ success: boolean }>('/api/question-candidates/' + encodeURIComponent(candidateId), {
      method: 'DELETE',
    })
  },
}

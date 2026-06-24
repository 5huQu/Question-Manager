import { api, jsonHeaders } from './client'

export type ImportV2SourceDocument = {
  id: string
  title: string
  originalFileName: string
  filePath: string
  fileType: 'pdf' | 'image' | 'markdown' | 'json'
  pageCount: number
  provider?: 'doc2x' | 'glm' | 'manual' | 'json'
  status: string
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
  provider?: 'glm'
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
  figures: Array<{ id: string; usage: string; path: string; pageNo?: number }>
  sourceRefs: Array<{ pageNo: number; blockIds: string[]; kind: string }>
  status: 'ready' | 'needs_review' | 'needs_manual_fix' | 'blocked' | 'committed'
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
  uploadSourceDocument(file: File) {
    const body = new FormData()
    body.append('file', file)
    return api<{ sourceDocument: ImportV2SourceDocument }>('/api/source-documents/upload', {
      method: 'POST',
      body,
    })
  },
  startSourceDocumentOcr(sourceDocumentId: string) {
    return api<{ sourceDocument: ImportV2SourceDocument; task: ImportV2OcrTask }>('/api/source-documents/' + encodeURIComponent(sourceDocumentId) + '/ocr', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ provider: 'glm' }),
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
}

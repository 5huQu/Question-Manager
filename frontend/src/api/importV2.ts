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

export type ImportV2CandidateIssue = {
  code: string
  severity: 'warning' | 'error'
  message: string
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
  status: 'ready' | 'needs_review' | 'needs_manual_fix' | 'blocked'
  issues: ImportV2CandidateIssue[]
  createdAt: string
  updatedAt: string
}

export type ParseCandidatesResult = {
  candidateCount: number
  readyCount: number
  needsReviewCount: number
  needsManualFixCount?: number
  blockedCount: number
  items: ImportV2Candidate[]
}

export const importV2Api = {
  listSourceDocuments() {
    return api<{ items: ImportV2SourceDocument[] }>('/api/source-documents')
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
    return api<{ items: ImportV2Candidate[] }>('/api/source-documents/' + encodeURIComponent(sourceDocumentId) + '/candidates')
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
}

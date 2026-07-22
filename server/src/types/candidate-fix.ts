export type CandidateFixSessionStatus = 'draft' | 'finalized' | 'superseded'

export type CandidateFixSegment = {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export type CandidateFixRegion = {
  id: string
  sessionId: string
  sourceDocumentId: string
  kind: 'question' | 'solution' | 'shared_answer_key'
  questionKey: string
  questionLabel: string
  questionKeys: string[]
  segments: CandidateFixSegment[]
  sortOrder: number
  note: string
  createdAt: string
  updatedAt: string
}

export type CandidateFixSession = {
  id: string
  candidateId: string
  revision: number
  status: CandidateFixSessionStatus
  sourceProfiles: Record<string, { pageCount: number; pdfName: string }>
  baseContentRevision: number
  createdAt: string
  updatedAt: string
  finalizedAt: string
  regions: CandidateFixRegion[]
}

export type CandidateFixRegionInput = Omit<CandidateFixRegion, 'id' | 'sessionId' | 'questionKey' | 'createdAt' | 'updatedAt'> & {
  id?: string
}

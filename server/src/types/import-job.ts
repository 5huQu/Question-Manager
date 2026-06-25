import type { PaperKind } from '../utils/import-metadata.js'

export type ImportJobMode = 'single_document' | 'separated_documents'

export type ImportJobStatus = 'draft' | 'parsing' | 'parsed' | 'partially_parsed' | 'failed'

export type ImportJobDocumentRole = 'full' | 'questions' | 'solutions'

export type ImportJob = {
  id: string
  title: string
  mode: ImportJobMode
  status: ImportJobStatus
  province: string
  city: string
  paperTitle: string
  batchName: string
  stage: string
  subject: string
  paperKind: PaperKind
  examYear: number
  sourceOrg: string
  createdAt: string
  updatedAt: string
}

export type ImportJobRow = {
  id: string
  title: string
  mode: ImportJobMode
  status: ImportJobStatus
  province?: string
  city?: string
  paper_title?: string
  batch_name?: string
  stage?: string
  subject?: string
  paper_kind?: string
  exam_year?: number
  source_org?: string
  created_at: string
  updated_at: string
}

export type CreateImportJobInput = {
  id?: string
  title?: string
  mode?: ImportJobMode
  status?: ImportJobStatus
  metadata?: Record<string, unknown>
  province?: string
  city?: string
  paperTitle?: string
  batchName?: string
  stage?: string
  subject?: string
  paperKind?: PaperKind
  examYear?: number
  sourceOrg?: string
}

export type UpdateImportJobInput = Partial<{
  title: string
  mode: ImportJobMode
  status: ImportJobStatus
  metadata: Record<string, unknown>
  province: string
  city: string
  paperTitle: string
  batchName: string
  stage: string
  subject: string
  paperKind: PaperKind
  examYear: number
  sourceOrg: string
}>

export type ImportJobDocument = {
  id: string
  jobId: string
  sourceDocumentId: string
  role: ImportJobDocumentRole
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type ImportJobDocumentRow = {
  id: string
  job_id: string
  source_document_id: string
  role: ImportJobDocumentRole
  sort_order: number
  created_at: string
  updated_at: string
}

export type CreateImportJobDocumentInput = {
  id?: string
  jobId: string
  sourceDocumentId: string
  role: ImportJobDocumentRole
  sortOrder?: number
}

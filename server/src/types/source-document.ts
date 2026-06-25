import type { PaperKind } from '../utils/import-metadata.js'

export type SourceDocumentFileType = 'pdf' | 'image' | 'markdown' | 'json'

export type SourceDocumentProvider = 'doc2x' | 'glm' | 'manual' | 'json'

export type SourceDocumentStatus =
  | 'uploaded'
  | 'ocr_running'
  | 'ocr_succeeded'
  | 'ocr_failed'
  | 'parsed'
  | 'partially_parsed'

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

export type SourceDocument = {
  id: string
  title: string
  originalFileName: string
  filePath: string
  fileType: SourceDocumentFileType
  pageCount: number
  provider?: SourceDocumentProvider
  status: SourceDocumentStatus
  province: string
  city: string
  paperTitle: string
  batchName: string
  stage: string
  subject: string
  paperKind: PaperKind
  examYear: number
  sourceOrg: string
  importStats?: SourceDocumentImportStats
  createdAt: string
  updatedAt: string
}

export type SourceDocumentRow = {
  id: string
  title: string
  original_file_name: string
  file_path: string
  file_type: SourceDocumentFileType
  page_count: number
  provider: SourceDocumentProvider | ''
  status: SourceDocumentStatus
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

export type CreateSourceDocumentInput = {
  id?: string
  title?: string
  originalFileName?: string
  filePath?: string
  fileType?: SourceDocumentFileType
  pageCount?: number
  provider?: SourceDocumentProvider
  status?: SourceDocumentStatus
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

export type UpdateSourceDocumentInput = Partial<{
  title: string
  originalFileName: string
  filePath: string
  fileType: SourceDocumentFileType
  pageCount: number
  provider: SourceDocumentProvider | ''
  status: SourceDocumentStatus
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

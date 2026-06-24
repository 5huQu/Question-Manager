export type SourceDocumentFileType = 'pdf' | 'image' | 'markdown' | 'json'

export type SourceDocumentProvider = 'doc2x' | 'glm' | 'manual' | 'json'

export type SourceDocumentStatus =
  | 'uploaded'
  | 'ocr_running'
  | 'ocr_succeeded'
  | 'ocr_failed'
  | 'parsed'
  | 'partially_parsed'

export type SourceDocument = {
  id: string
  title: string
  originalFileName: string
  filePath: string
  fileType: SourceDocumentFileType
  pageCount: number
  provider?: SourceDocumentProvider
  status: SourceDocumentStatus
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
}

export type UpdateSourceDocumentInput = Partial<{
  title: string
  originalFileName: string
  filePath: string
  fileType: SourceDocumentFileType
  pageCount: number
  provider: SourceDocumentProvider | ''
  status: SourceDocumentStatus
}>

// Shared compile-time projection of the server's runtime V2 contracts.
export type ImportV2OcrProvider = 'doc2x' | 'glm'
export type ImportV2ImportJobMode = 'single_document' | 'separated_documents'
export type ImportV2ImportJobDocumentRole = 'full' | 'questions' | 'solutions'

export type ImportV2ValidationError = {
  error: string
  code: 'VALIDATION_ERROR'
  field?: string
  details?: Record<string, unknown>
}

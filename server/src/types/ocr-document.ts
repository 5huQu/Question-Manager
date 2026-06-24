export type OCRDocumentProvider = 'doc2x' | 'glm'

export type OCRBlockType = 'text' | 'formula' | 'image' | 'table' | 'unknown'

export type OCRAssetType = 'image' | 'table_image' | 'page_image' | 'crop'

export type OCRBBox = [number, number, number, number]

export type OCRBlock = {
  id: string
  pageNo: number
  type: OCRBlockType
  content: string
  bbox?: OCRBBox
  markdownStart?: number
  markdownEnd?: number
  assetId?: string
  confidence?: number
}

export type OCRPage = {
  pageNo: number
  width: number
  height: number
  blocks: OCRBlock[]
}

export type OCRAsset = {
  id: string
  type: OCRAssetType
  path: string
  pageNo?: number
  bbox?: OCRBBox
  sourceBlockId?: string
}

export type OCRDocument = {
  id: string
  sourceDocumentId: string
  provider: OCRDocumentProvider
  rawResultPath: string
  markdown: string
  pages: OCRPage[]
  assets: OCRAsset[]
  metadata: Record<string, unknown>
  createdAt: string
}

export type OCRDocumentRow = {
  id: string
  source_document_id: string
  provider: OCRDocumentProvider
  raw_result_path: string
  markdown_path: string
  blocks_json_path: string
  assets_json_path: string
  metadata_json: string
  created_at: string
}

export type StoredOCRDocument = {
  id: string
  sourceDocumentId: string
  provider: OCRDocumentProvider
  rawResultPath: string
  markdownPath: string
  blocksJsonPath: string
  assetsJsonPath: string
  metadata: Record<string, unknown>
  createdAt: string
}

export type CreateOCRDocumentInput = {
  id?: string
  sourceDocumentId: string
  provider: OCRDocumentProvider
  rawResultPath?: string
  markdownPath?: string
  blocksJsonPath?: string
  assetsJsonPath?: string
  metadata?: Record<string, unknown>
  createdAt?: string
}

export type UpdateOCRDocumentInput = Partial<{
  provider: OCRDocumentProvider
  rawResultPath: string
  markdownPath: string
  blocksJsonPath: string
  assetsJsonPath: string
  metadata: Record<string, unknown>
}>

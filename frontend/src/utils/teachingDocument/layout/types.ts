import type { BoxBreakBehavior, TeachingBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import type { PaginatedItem } from './fragment'

export type SplitPolicy = 'never' | 'paragraph' | 'children' | 'forced-break' | 'unknown'

export type RenderDiagnosticCode =
  | 'block-overflow'
  | 'page-overflow'
  | 'measurement-missing'
  | 'duplicate-block-id'
  | 'unstable-layout'
  | 'resource-timeout'
  | 'unsupported-split'
  | 'invalid-paper-spec'
  | 'invalid-measurement'
  | 'paragraph-measurement-missing'
  | 'paragraph-range-invalid'
  | 'paragraph-line-overflow'
  | 'paragraph-orphan-line'
  | 'paragraph-widow-line'
  | 'unsafe-split-boundary'
  | 'box-measurement-missing'
  | 'box-child-overflow'
  | 'box-overflow'

export interface RenderDiagnostic {
  code: RenderDiagnosticCode
  severity: 'warning' | 'error'
  blockId?: string
  pageIndex?: number
  fragmentIndex?: number
  lineIndex?: number
  message: string
}

export interface RenderReadinessResult {
  ready: boolean
  timedOut: boolean
  pendingFonts: boolean
  pendingImages: string[]
  pendingQuestions: string[]
  pendingFigures: string[]
  failedImages: string[]
  diagnostics: RenderDiagnostic[]
}

export interface BlockGeometry {
  width: number
  height: number
  top: number
  bottom: number
}

export interface BlockMeasurement extends BlockGeometry {
  blockId: string
  blockType: TeachingBlock['type'] | string
  splitPolicy: SplitPolicy
  breakBehavior?: BoxBreakBehavior
  parentBlockId?: string
  sourceIndex?: number
  childIndex?: number
  depth: number
  childMeasurements: BlockMeasurement[]
}

export interface TeachingDocumentMeasurement {
  blocks: BlockMeasurement[]
  headerHeight: number
  diagnostics: RenderDiagnostic[]
  measurementVersion: string
}

export interface PaperSpec {
  size: 'A4'
  widthMm: 210
  heightMm: 297
  marginTopMm: number
  marginRightMm: number
  marginBottomMm: number
  marginLeftMm: number
}

export interface PaperMetrics {
  pageWidthPx: number
  pageHeightPx: number
  contentWidthPx: number
  contentHeightPx: number
}

export interface PaginatedPage {
  index: number
  items: PaginatedItem[]
  usedHeight: number
  overflow: boolean
  /** 标题只在第一页渲染；该高度已计入 usedHeight。 */
  showDocumentHeader: boolean
}

export interface PaginationInput {
  document: TeachingDocumentV1
  measurements: TeachingDocumentMeasurement
  paragraphMeasurements?: import('./paragraphMeasurement').ParagraphMeasurement[]
  boxMeasurements?: import('./boxMeasurement').BoxMeasurement[]
  paragraphSplitOptions?: import('./paragraphPlanner').ParagraphSplitOptions
  paper: PaperSpec
}

export interface PaginationResult {
  pages: PaginatedPage[]
  diagnostics: RenderDiagnostic[]
  measurementVersion: string
  paragraphMeasurementVersion: string
  boxMeasurementVersion: string
}

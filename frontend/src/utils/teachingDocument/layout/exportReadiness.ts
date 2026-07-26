import type { RenderDiagnostic, RenderReadinessResult } from './types'
import type { PaginationResult } from './types'

// ─── Export Readiness ─────────────────────────────────────────────────────────

export interface ExportReadinessResult {
  ready: boolean
  documentRevision: number
  paginationGeneration: number
  pageCount: number
  blockingDiagnostics: RenderDiagnostic[]
  warnings: RenderDiagnostic[]
  pendingResources: string[]
}

export interface ExportReadinessInput {
  /** 当前文档 revision */
  documentRevision: number
  /** 当前 pagination generation */
  paginationGeneration: number
  /** 最新 pagination result */
  pagination: PaginationResult | null
  /** 渲染 readiness */
  renderReadiness: RenderReadinessResult
  /** 是否有未保存内容 */
  hasUnsavedChanges: boolean
  /** 是否存在 revision 冲突 */
  hasRevisionConflict: boolean
  /** 自动保存是否失败 */
  autosaveFailed: boolean
  /** 当前 measurement generation 是否属于最新 */
  measurementGenerationCurrent: boolean
}

/** 阻止导出的诊断 code */
const BLOCKING_CODES = new Set<string>([
  'page-overflow',
  'block-overflow',
  'box-overflow',
  'measurement-missing',
  'box-measurement-missing',
  'question-measurement-missing',
  'question-region-missing',
  'question-fragment-invalid',
  'question-options-fragment-invalid',
  'paragraph-range-invalid',
  'duplicate-block-id',
  'invalid-paper-spec',
  'invalid-measurement',
  'resource-timeout',
  'question-stem-overflow',
  'question-option-overflow',
  'question-answer-overflow',
  'question-analysis-overflow',
])

/** 允许导出但发出警告的 code */
const WARNING_CODES = new Set<string>([
  'paragraph-orphan-line',
  'paragraph-widow-line',
  'unsafe-split-boundary',
  'question-heading-orphan',
  'question-resource-unresolved',
  'unsupported-split',
  'unstable-layout',
  'box-child-overflow',
])

export function classifyDiagnostics(diagnostics: RenderDiagnostic[]): {
  blocking: RenderDiagnostic[]
  warnings: RenderDiagnostic[]
} {
  const blocking: RenderDiagnostic[] = []
  const warnings: RenderDiagnostic[] = []
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'error' && BLOCKING_CODES.has(diagnostic.code)) {
      blocking.push(diagnostic)
    } else if (WARNING_CODES.has(diagnostic.code) || diagnostic.severity === 'warning') {
      warnings.push(diagnostic)
    } else if (diagnostic.severity === 'error') {
      blocking.push(diagnostic)
    }
  }
  return { blocking, warnings }
}

export function evaluateExportReadiness(input: ExportReadinessInput): ExportReadinessResult {
  const {
    documentRevision,
    paginationGeneration,
    pagination,
    renderReadiness,
    hasUnsavedChanges,
    hasRevisionConflict,
    autosaveFailed,
    measurementGenerationCurrent,
  } = input

  const blockingDiagnostics: RenderDiagnostic[] = []
  const warnings: RenderDiagnostic[] = []
  const pendingResources: string[] = [
    ...renderReadiness.pendingImages,
    ...renderReadiness.pendingQuestions,
    ...renderReadiness.pendingFigures,
  ]

  // Revision conflict blocks export
  if (hasRevisionConflict) {
    blockingDiagnostics.push({
      code: 'invalid-measurement',
      severity: 'error',
      message: '文档存在 revision 冲突，请先解决冲突后再导出。',
    })
  }

  // Autosave failure blocks export
  if (autosaveFailed) {
    blockingDiagnostics.push({
      code: 'invalid-measurement',
      severity: 'error',
      message: '自动保存失败，导出前需确保文档已保存。',
    })
  }

  // Unsaved changes (dirty / saving) block export：
  // 分页结果基于最近一次保存的文档内容，未保存修改可能导致导出与预览不一致。
  if (hasUnsavedChanges) {
    blockingDiagnostics.push({
      code: 'invalid-measurement',
      severity: 'error',
      message: '文档存在未保存的修改，请先保存后再导出。',
    })
  }

  // Font not loaded
  if (renderReadiness.pendingFonts) {
    blockingDiagnostics.push({
      code: 'resource-timeout',
      severity: 'error',
      message: '字体尚未完成加载，导出可能产生错误排版。',
    })
  }

  // Readiness timeout
  if (renderReadiness.timedOut) {
    blockingDiagnostics.push({
      code: 'resource-timeout',
      severity: 'error',
      message: '排版资源准备超时，不能确认布局稳定。',
    })
  }

  // Measurement generation stale
  if (!measurementGenerationCurrent) {
    blockingDiagnostics.push({
      code: 'invalid-measurement',
      severity: 'error',
      message: '分页结果不属于当前文档版本，请等待重新测量完成。',
    })
  }

  // No pagination result
  if (!pagination) {
    blockingDiagnostics.push({
      code: 'measurement-missing',
      severity: 'error',
      message: '尚无分页结果，无法导出。',
    })
  }

  // Classify pagination diagnostics
  if (pagination) {
    const classified = classifyDiagnostics(pagination.diagnostics)
    blockingDiagnostics.push(...classified.blocking)
    warnings.push(...classified.warnings)
  }

  // Failed images are warnings (stable placeholder)
  if (renderReadiness.failedImages.length > 0) {
    warnings.push({
      code: 'question-resource-unresolved',
      severity: 'warning',
      message: `${renderReadiness.failedImages.length} 张图片加载失败，已使用稳定占位。`,
    })
  }

  const ready = blockingDiagnostics.length === 0
    && !hasRevisionConflict
    && !autosaveFailed
    && !hasUnsavedChanges
    && Boolean(pagination)
    && measurementGenerationCurrent
    && renderReadiness.ready

  return {
    ready,
    documentRevision,
    paginationGeneration,
    pageCount: pagination?.pages.length || 0,
    blockingDiagnostics,
    warnings,
    pendingResources,
  }
}

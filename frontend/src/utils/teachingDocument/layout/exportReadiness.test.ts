import { describe, expect, it } from 'vitest'
import {
  classifyDiagnostics,
  evaluateExportReadiness,
  type ExportReadinessInput,
} from './exportReadiness'
import type { PaginationResult, RenderDiagnostic, RenderReadinessResult } from './types'

const stableReadiness: RenderReadinessResult = {
  ready: true,
  timedOut: false,
  pendingFonts: false,
  pendingImages: [],
  pendingQuestions: [],
  pendingFigures: [],
  failedImages: [],
  diagnostics: [],
}

function makePagination(diagnostics: RenderDiagnostic[] = []): PaginationResult {
  return {
    pages: [
      { index: 0, items: [], showDocumentHeader: true, overflow: false, usedHeight: 500 },
      { index: 1, items: [], showDocumentHeader: false, overflow: false, usedHeight: 300 },
    ],
    diagnostics,
    measurementVersion: 'test-v1',
    paragraphMeasurementVersion: 'test-v1',
    boxMeasurementVersion: 'test-v1',
    questionMeasurementVersion: 'test-v1',
  }
}

function makeInput(overrides: Partial<ExportReadinessInput> = {}): ExportReadinessInput {
  return {
    documentRevision: 5,
    paginationGeneration: 3,
    pagination: makePagination(),
    renderReadiness: stableReadiness,
    hasUnsavedChanges: false,
    hasRevisionConflict: false,
    autosaveFailed: false,
    measurementGenerationCurrent: true,
    ...overrides,
  }
}

describe('classifyDiagnostics', () => {
  it('classifies blocking codes as blocking', () => {
    const diagnostics: RenderDiagnostic[] = [
      { code: 'page-overflow', severity: 'error', message: 'overflow' },
      { code: 'measurement-missing', severity: 'error', message: 'missing' },
    ]
    const { blocking, warnings } = classifyDiagnostics(diagnostics)
    expect(blocking).toHaveLength(2)
    expect(warnings).toHaveLength(0)
  })

  it('classifies warning codes as warnings', () => {
    const diagnostics: RenderDiagnostic[] = [
      { code: 'paragraph-orphan-line', severity: 'warning', message: 'orphan' },
      { code: 'unstable-layout', severity: 'warning', message: 'unstable' },
    ]
    const { blocking, warnings } = classifyDiagnostics(diagnostics)
    expect(blocking).toHaveLength(0)
    expect(warnings).toHaveLength(2)
  })

  it('treats unknown error codes as blocking', () => {
    const diagnostics: RenderDiagnostic[] = [
      { code: 'invalid-measurement', severity: 'error', message: 'something' },
    ]
    const { blocking } = classifyDiagnostics(diagnostics)
    expect(blocking).toHaveLength(1)
  })
})

describe('evaluateExportReadiness', () => {
  it('returns ready when all conditions are met', () => {
    const result = evaluateExportReadiness(makeInput())
    expect(result.ready).toBe(true)
    expect(result.blockingDiagnostics).toHaveLength(0)
    expect(result.pageCount).toBe(2)
    expect(result.documentRevision).toBe(5)
    expect(result.paginationGeneration).toBe(3)
  })

  it('blocks on revision conflict', () => {
    const result = evaluateExportReadiness(makeInput({ hasRevisionConflict: true }))
    expect(result.ready).toBe(false)
    expect(result.blockingDiagnostics.some((d) => d.message.includes('revision 冲突'))).toBe(true)
  })

  it('blocks on autosave failure', () => {
    const result = evaluateExportReadiness(makeInput({ autosaveFailed: true }))
    expect(result.ready).toBe(false)
    expect(result.blockingDiagnostics.some((d) => d.message.includes('自动保存失败'))).toBe(true)
  })

  it('blocks on unsaved changes (dirty)', () => {
    const result = evaluateExportReadiness(makeInput({ hasUnsavedChanges: true }))
    expect(result.ready).toBe(false)
    expect(result.blockingDiagnostics.some((d) => d.message.includes('未保存'))).toBe(true)
  })

  it('blocks on unsaved changes even when pagination and readiness are healthy', () => {
    const result = evaluateExportReadiness(makeInput({
      hasUnsavedChanges: true,
      pagination: makePagination(),
      renderReadiness: stableReadiness,
      measurementGenerationCurrent: true,
    }))
    expect(result.ready).toBe(false)
  })

  it('blocks when render resources are pending (readiness not ready)', () => {
    const result = evaluateExportReadiness(makeInput({
      renderReadiness: {
        ...stableReadiness,
        ready: false,
        pendingQuestions: ['q1'],
      },
    }))
    expect(result.ready).toBe(false)
    expect(result.pendingResources).toContain('q1')
  })

  it('blocks when fonts pending', () => {
    const result = evaluateExportReadiness(makeInput({
      renderReadiness: { ...stableReadiness, pendingFonts: true },
    }))
    expect(result.ready).toBe(false)
    expect(result.blockingDiagnostics.some((d) => d.code === 'resource-timeout')).toBe(true)
  })

  it('blocks on readiness timeout', () => {
    const result = evaluateExportReadiness(makeInput({
      renderReadiness: { ...stableReadiness, timedOut: true },
    }))
    expect(result.ready).toBe(false)
  })

  it('blocks when measurement generation is stale', () => {
    const result = evaluateExportReadiness(makeInput({ measurementGenerationCurrent: false }))
    expect(result.ready).toBe(false)
    expect(result.blockingDiagnostics.some((d) => d.message.includes('不属于当前文档版本'))).toBe(true)
  })

  it('blocks when pagination is null', () => {
    const result = evaluateExportReadiness(makeInput({ pagination: null }))
    expect(result.ready).toBe(false)
    expect(result.pageCount).toBe(0)
  })

  it('includes pagination blocking diagnostics', () => {
    const pagination = makePagination([
      { code: 'page-overflow', severity: 'error', message: 'Page 2 overflows', pageIndex: 1 },
    ])
    const result = evaluateExportReadiness(makeInput({ pagination }))
    expect(result.ready).toBe(false)
    expect(result.blockingDiagnostics.some((d) => d.code === 'page-overflow')).toBe(true)
  })

  it('reports failed images as warnings not blocking', () => {
    const result = evaluateExportReadiness(makeInput({
      renderReadiness: { ...stableReadiness, failedImages: ['img1.png'] },
    }))
    expect(result.ready).toBe(true)
    expect(result.warnings.some((d) => d.message.includes('图片加载失败'))).toBe(true)
  })

  it('collects pending resources', () => {
    const result = evaluateExportReadiness(makeInput({
      renderReadiness: {
        ...stableReadiness,
        pendingImages: ['a.png'],
        pendingQuestions: ['q1'],
        pendingFigures: ['f1'],
      },
    }))
    expect(result.pendingResources).toEqual(['a.png', 'q1', 'f1'])
  })
})

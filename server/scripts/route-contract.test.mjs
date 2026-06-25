import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-manager-routes-'))
process.env.QUESTION_DATA_DIR = tempRoot

const { app, closeDatabase } = await import('../dist/index.js')

const expectedRoutes = new Set([
  'GET /api/health',
  'GET /api/tools/pdf-slicer/ocr-settings',
  'GET /api/settings',
  'PATCH /api/tools/pdf-slicer/ocr-settings',
  'PATCH /api/settings',
  'GET /api/import-flow-v2/parser-config',
  'PUT /api/import-flow-v2/parser-config',
  'POST /api/import-flow-v2/parser-config/reset',
  'GET /api/source-documents',
  'POST /api/source-documents',
  'POST /api/source-documents/upload',
  'GET /api/source-documents/:id',
  'PATCH /api/source-documents/:id',
  'DELETE /api/source-documents/:id',
  'GET /api/source-documents/:id/candidates',
  'POST /api/source-documents/:id/ocr',
  'GET /api/source-documents/:id/ocr-status',
  'GET /api/import-flow-v2/source-documents/:id/pages/:page',
  'POST /api/question-candidates/:id/manual-fix-session',
  'GET /api/ocr-documents',
  'POST /api/ocr-documents/import-json',
  'GET /api/ocr-documents/:id',
  'POST /api/ocr-documents/:id/parse-candidates',
  'PATCH /api/question-candidates/:id',
  'DELETE /api/question-candidates/:id',
  'POST /api/question-candidates/:id/commit',
  'POST /api/question-candidates/commit',
  'GET /api/question-bank/tag-libraries',
  'GET /api/learning-tags/libraries',
  'POST /api/learning-tags/libraries',
  'DELETE /api/learning-tags/libraries/:id',
  'GET /api/tools/pdf-slicer/rules',
  'PUT /api/tools/pdf-slicer/rules',
  'POST /api/tools/pdf-slicer/rules/validate',
  'GET /api/tools/pdf-slicer/rules/history',
  'POST /api/tools/pdf-slicer/rules/rollback/:version',
  'GET /api/tools/pdf-slicer/dashboard',
  'GET /api/dashboard/activity-heatmap',
  'POST /api/tools/pdf-slicer/uploads',
  'GET /api/tools/pdf-slicer/batches/:batchId',
  'POST /api/tools/pdf-slicer/batches/:batchId/merge-separated-exam',
  'PATCH /api/tools/pdf-slicer/runs/:runId/classification',
  'GET /api/tools/pdf-slicer/runs/:runId',
  'POST /api/tools/pdf-slicer/runs/:runId/complete-slice',
  'POST /api/tools/pdf-slicer/runs/:runId/start-slice',
  'POST /api/tools/pdf-slicer/runs/:runId/open-folder',
  'DELETE /api/tools/pdf-slicer/runs/:runId',
  'GET /api/tools/pdf-slicer/runs/:runId/document-profile',
  'POST /api/tools/pdf-slicer/runs/:runId/render-pages',
  'GET /api/tools/pdf-slicer/runs/:runId/pages/:page',
  'POST /api/tools/pdf-slicer/batches/:batchId/annotation-sessions',
  'GET /api/tools/pdf-slicer/annotation-sessions/:sessionId',
  'PUT /api/tools/pdf-slicer/annotation-sessions/:sessionId/regions',
  'POST /api/tools/pdf-slicer/annotation-sessions/:sessionId/validate',
  'POST /api/tools/pdf-slicer/annotation-sessions/:sessionId/finalize',
  'POST /api/tools/pdf-slicer/annotation-sessions/:sessionId/revise',
  'GET /api/tools/pdf-slicer/runs/:runId/slice-review/items',
  'POST /api/tools/pdf-slicer/runs/:runId/slice-review/items/merge',
  'DELETE /api/tools/pdf-slicer/runs/:runId/slice-review/items/:resultId',
  'PATCH /api/tools/pdf-slicer/runs/:runId/slice-review/items/:resultId',
  'POST /api/tools/pdf-slicer/runs/:runId/slice-review/items/:resultId/split',
  'PATCH /api/tools/pdf-slicer/runs/:runId/slice-review/items/:resultId/figures',
  'PATCH /api/tools/pdf-slicer/runs/:runId/slice-review/items/:resultId/solution-figures',
  'POST /api/tools/pdf-slicer/runs/:runId/review-figures/materialize',
  'POST /api/tools/pdf-slicer/runs/quick-review',
  'POST /api/tools/pdf-slicer/runs/bulk-ocr',
  'GET /api/tools/pdf-slicer/ocr-jobs',
  'GET /api/tools/pdf-slicer/runs/:runId/ocr-progress',
  'GET /api/tools/pdf-slicer/runs/:runId/questions',
  'POST /api/tools/pdf-slicer/runs/:runId/classify',
  'POST /api/tools/pdf-slicer/runs/:runId/start-ocr',
  'POST /api/tools/pdf-slicer/runs/:runId/resume-ocr',
  'POST /api/tools/pdf-slicer/runs/:runId/complete-ocr',
  'POST /api/tools/pdf-slicer/runs/:runId/force-rerun-ocr',
  'POST /api/tools/pdf-slicer/runs/:runId/force-interrupt-ocr',
  'GET /api/tools/pdf-slicer/runs/:runId/pending-bank',
  'POST /api/tools/pdf-slicer/runs/:runId/pending-bank/manual-candidate',
  'POST /api/tools/pdf-slicer/runs/:runId/pending-bank/:id/rerun-ocr',
  'POST /api/tools/pdf-slicer/runs/:runId/pending-bank/bulk-confirm',
  'POST /api/tools/pdf-slicer/runs/:runId/pending-bank/bulk-skip',
  'POST /api/tools/pdf-slicer/runs/:runId/pending-bank/bulk-delete',
  'GET /api/question-bank/items',
  'POST /api/question-bank/items/:id/rerun-ocr',
  'POST /api/question-bank/items',
  'POST /api/question-bank/import-json',
  'POST /api/question-bank/import-json-from-slices',
  'GET /api/question-bank/items/:id',
  'PATCH /api/question-bank/items/:id',
  'DELETE /api/question-bank/items/:id',
  'POST /api/question-bank/items/:id/figures',
  'PATCH /api/question-bank/items/:id/figures/:figureId',
  'POST /api/question-bank/items/:id/figures/upload',
  'DELETE /api/question-bank/items/:id/figures/:figureId',
  'GET /api/question-bank/collections',
  'POST /api/question-bank/collections',
  'GET /api/question-bank/collections/:id',
  'PATCH /api/question-bank/collections/:id',
  'DELETE /api/question-bank/collections/:id',
  'POST /api/question-bank/collections/:id/items',
  'PATCH /api/question-bank/collections/:id/items/:relationId',
  'DELETE /api/question-bank/collections/:id/items/:relationId',
  'DELETE /api/question-bank/collections/:id/items',
  'PATCH /api/question-bank/collections/:id/reorder',
  'POST /api/question-bank/collections/:id/export',
  'GET /api/question-bank/export-records',
  'DELETE /api/question-bank/export-records/:id',
  'POST /api/question-bank/export-records/:id/restore-to-basket',
  'GET /api/question-bank/collections/:id/export-records',
  'GET /api/tools/pdf-slicer/runs/:runId/export-records',
  'POST /api/tools/pdf-slicer/runs/:runId/export-batch',
  'GET /api/question-bank/daily-question',
  'POST /api/question-bank/random-paper',
])

function mountedRoutes(expressApp) {
  return new Set(expressApp.router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods)
      .map((method) => `${method.toUpperCase()} ${layer.route.path}`)))
}

try {
  assert.deepEqual(mountedRoutes(app), expectedRoutes)
  console.log(`route contract passed (${expectedRoutes.size} routes)`)
} finally {
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

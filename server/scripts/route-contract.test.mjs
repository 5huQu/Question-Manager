import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-manager-routes-'))
process.env.QUESTION_DATA_DIR = tempRoot

const { app, closeDatabase } = await import('../dist/index.js')

const expectedRoutes = new Set([
  'GET /api/health',
  'GET /api/settings',
  'PATCH /api/settings',
  'GET /api/import-flow-v2/parser-config',
  'PUT /api/import-flow-v2/parser-config',
  'POST /api/import-flow-v2/parser-config/reset',
  'GET /api/import-flow-v2/parser-presets',
  'POST /api/import-flow-v2/parser-presets',
  'PUT /api/import-flow-v2/parser-presets/:id',
  'DELETE /api/import-flow-v2/parser-presets/:id',
  'GET /api/import-flow-v2/ocr-documents/:id/markdown-preview',
  'POST /api/import-flow-v2/ocr-documents/:id/parser-preview',
  'GET /api/import-flow-v2/ocr-documents',
  'POST /api/import-flow-v2/ocr-documents/import-json',
  'GET /api/import-flow-v2/ocr-documents/:id',
  'PATCH /api/import-flow-v2/ocr-documents/:id/markdown',
  'POST /api/import-flow-v2/ocr-documents/:id/parse-candidates',
  'GET /api/import-flow-v2/resolve-import-job',
  'GET /api/import-flow-v2/jobs',
  'POST /api/import-flow-v2/jobs',
  'GET /api/import-flow-v2/jobs/:id',
  'PATCH /api/import-flow-v2/jobs/:id',
  'DELETE /api/import-flow-v2/jobs/:id',
  'GET /api/import-flow-v2/jobs/:id/documents',
  'POST /api/import-flow-v2/jobs/:id/documents',
  'POST /api/import-flow-v2/jobs/:id/parse-candidates',
  'GET /api/import-flow-v2/jobs/:id/candidates',
  'GET /api/import-flow-v2/jobs/:id/questions',
  'POST /api/import-flow-v2/jobs/:id/classify',
  'GET /api/import-flow-v2/jobs/:id/export-records',
  'POST /api/import-flow-v2/jobs/:id/export',
  'GET /api/import-flow-v2/source-documents',
  'POST /api/import-flow-v2/source-documents',
  'POST /api/import-flow-v2/source-documents/upload',
  'POST /api/import-flow-v2/source-documents/import-doc2x-package',
  'GET /api/import-flow-v2/source-documents/:id',
  'PATCH /api/import-flow-v2/source-documents/:id',
  'DELETE /api/import-flow-v2/source-documents/:id',
  'GET /api/import-flow-v2/source-documents/:id/candidates',
  'POST /api/import-flow-v2/source-documents/:id/ocr',
  'GET /api/import-flow-v2/source-documents/:id/ocr-status',
  'PATCH /api/import-flow-v2/candidates/:id',
  'DELETE /api/import-flow-v2/candidates/:id',
  'POST /api/import-flow-v2/candidates/:id/commit',
  'POST /api/import-flow-v2/candidates/commit',
  'POST /api/import-flow-v2/candidates/skip',
  'POST /api/import-flow-v2/candidates/:candidateId/fix-session',
  'GET /api/import-flow-v2/candidate-fix-sessions/:sessionId',
  'PUT /api/import-flow-v2/candidate-fix-sessions/:sessionId/regions',
  'POST /api/import-flow-v2/candidate-fix-sessions/:sessionId/validate',
  'POST /api/import-flow-v2/candidate-fix-sessions/:sessionId/finalize',
  'POST /api/import-flow-v2/candidate-fix-sessions/:sessionId/reopen',
  'POST /api/import-flow-v2/candidates/:id/unplaced-figures/:blockId/resolve',
  'POST /api/import-flow-v2/candidates/:id/figures/upload',
  'POST /api/import-flow-v2/candidates/:id/figures/:figureId/move',
  'GET /api/import-flow-v2/source-documents/:id/pages/:page',
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
  'GET /api/dashboard/activity-hours',
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
  'POST /api/question-bank/items/:id/ai-clean-preview',
  'POST /api/question-bank/items/classify',
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
  'PUT /api/question-bank/collections/:id/items',
  'PATCH /api/question-bank/collections/:id/reorder',
  'POST /api/question-bank/collections/:id/export',
  'POST /api/question-bank/collections/:id/layout-drafts',
  'GET /api/question-bank/collections/:id/layout-drafts',
  'GET /api/question-bank/layout-drafts',
  'GET /api/question-bank/layout-drafts/:draftId',
  'PATCH /api/question-bank/layout-drafts/:draftId',
  'DELETE /api/question-bank/layout-drafts/:draftId',
  'POST /api/question-bank/layout-drafts/:draftId/refresh-content',
  'POST /api/question-bank/layout-drafts/:draftId/content/:relationId/sync-to-bank',
  'POST /api/question-bank/layout-drafts/:draftId/preview',
  'GET /api/question-bank/layout-drafts/:draftId/preview-status',
  'GET /api/question-bank/layout-drafts/:draftId/pages',
  'POST /api/question-bank/layout-drafts/:draftId/export',
  'GET /api/question-bank/export-records',
  'DELETE /api/question-bank/export-records/:id',
  'POST /api/question-bank/export-records/:id/restore-to-basket',
  'GET /api/question-bank/collections/:id/export-records',
  'GET /api/tools/pdf-slicer/runs/:runId/export-records',
  'POST /api/tools/pdf-slicer/runs/:runId/export-batch',
  'GET /api/question-bank/quick-action-metadata',
  'GET /api/question-bank/daily-question',
  'POST /api/question-bank/random-paper',
].filter((route) => !route.includes('/api/tools/pdf-slicer') && route !== 'POST /api/question-bank/import-json-from-slices'))

function mountedRoutes(expressApp) {
  return new Set(expressApp.router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods)
      .map((method) => `${method.toUpperCase()} ${layer.route.path}`)))
}

try {
  const actualRoutes = mountedRoutes(app)
  assert.deepEqual(actualRoutes, expectedRoutes)
  for (const retiredPrefix of ['/api/import-jobs', '/api/source-documents', '/api/ocr-documents', '/api/question-candidates']) {
    assert.equal([...actualRoutes].some((route) => route.includes(` ${retiredPrefix}`)), false, `${retiredPrefix} must stay retired`)
  }
  const v2RouteSources = fs.readdirSync(new URL('../src/routes/import-flow-v2', import.meta.url))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => fs.readFileSync(new URL(`../src/routes/import-flow-v2/${name}`, import.meta.url), 'utf8'))
    .join('\n')
  assert.equal(/\b(SELECT|INSERT|UPDATE|DELETE)\s+(?:FROM|INTO|[a-z_]+\s+SET)\b/i.test(v2RouteSources), false, 'V2 routers must not contain SQL')
  const frontendImportClient = fs.readFileSync(new URL('../../frontend/src/api/importV2.ts', import.meta.url), 'utf8')
  assert.equal(/['"`]\/api\/(?:import-jobs|source-documents|ocr-documents|question-candidates)(?:\/|['"`?])/u.test(frontendImportClient), false, 'frontend V2 client must use canonical routes')
  assert.equal([...actualRoutes].some((route) => route.includes(' /api/tools/pdf-slicer')), false, 'V1 pdf-slicer API must not be mounted')
  const productionSources = [
    new URL('../src/services/import-flow-v2', import.meta.url),
    new URL('../src/services/candidate-fix', import.meta.url),
    new URL('../src/services/question-bank', import.meta.url),
  ].flatMap((directory) => fs.readdirSync(directory)
    .filter((name) => name.endsWith('.ts') && name !== 'import.ts')
    .map((name) => fs.readFileSync(new URL(name, directory.href.endsWith('/') ? directory : new URL(`${directory.href}/`)), 'utf8')))
    .join('\n')
  assert.equal(/services\/pdf-slicer|repositories\/pdf-slicer/u.test(productionSources), false, 'V2 and question-bank services must not import V1 runtime modules')

  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const address = server.address()
    assert.equal(typeof address, 'object')
    const baseUrl = `http://127.0.0.1:${address.port}`
    const invalidOcr = await fetch(`${baseUrl}/api/import-flow-v2/source-documents/missing/ocr`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'retired-provider' }),
    })
    assert.equal(invalidOcr.status, 400)
    assert.deepEqual(await invalidOcr.json(), {
      error: '字段 provider 的值无效。',
      code: 'VALIDATION_ERROR',
      field: 'provider',
      details: { allowed: ['doc2x', 'glm'] },
    })

    const invalidJob = await fetch(`${baseUrl}/api/import-flow-v2/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([]),
    })
    assert.equal(invalidJob.status, 400)
    assert.equal((await invalidJob.json()).code, 'VALIDATION_ERROR')

    const invalidUpload = new FormData()
    invalidUpload.append('metadata', '[]')
    const invalidUploadResponse = await fetch(`${baseUrl}/api/import-flow-v2/source-documents/upload`, {
      method: 'POST',
      body: invalidUpload,
    })
    assert.equal(invalidUploadResponse.status, 400)
    assert.equal((await invalidUploadResponse.json()).code, 'VALIDATION_ERROR')

    const deepContractCases = [
      {
        path: '/api/import-flow-v2/ocr-documents/missing/parse-candidates',
        method: 'POST',
        body: { configOverride: { sectionHeadings: ['题目', 7] } },
        field: '请求体.configOverride.sectionHeadings[1]',
      },
      {
        path: '/api/import-flow-v2/ocr-documents/missing/parser-preview',
        method: 'POST',
        body: { candidateIds: ['candidate-1', { id: 'candidate-2' }] },
        field: '请求体.candidateIds[1]',
      },
      {
        path: '/api/import-flow-v2/candidates/missing',
        method: 'PATCH',
        body: { figures: [{ id: 'fig-1', usage: 'stem', path: 'figure.png', bbox: [0, 1, '2', 3] }] },
        field: '请求体.figures[0].bbox[2]',
      },
      {
        path: '/api/import-flow-v2/jobs/missing/export',
        method: 'POST',
        body: { template: 'slides' },
        field: '请求体.template',
      },
    ]
    for (const testCase of deepContractCases) {
      const response = await fetch(baseUrl + testCase.path, {
        method: testCase.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(testCase.body),
      })
      assert.equal(response.status, 400, `${testCase.path} must reject malformed nested payloads before lookup`)
      const payload = await response.json()
      assert.equal(payload.code, 'VALIDATION_ERROR')
      assert.equal(payload.field, testCase.field)
    }

    for (const retiredPath of ['/api/import-jobs/missing', '/api/source-documents/missing', '/api/ocr-documents/missing', '/api/question-candidates/missing', '/api/tools/pdf-slicer/ocr-settings']) {
      assert.equal((await fetch(baseUrl + retiredPath)).status, 404, `${retiredPath} must return 404`)
    }
    for (const retiredPath of ['/api/tools/pdf-slicer/dashboard', '/api/tools/pdf-slicer/uploads', '/api/tools/pdf-slicer/runs/legacy/start-ocr', '/api/tools/pdf-slicer/runs/legacy/export-batch']) {
      assert.equal((await fetch(baseUrl + retiredPath, { method: retiredPath.includes('dashboard') ? 'GET' : 'POST' })).status, 404, `${retiredPath} must stay retired`)
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
  console.log(`route contract passed (${expectedRoutes.size} routes)`)
} finally {
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

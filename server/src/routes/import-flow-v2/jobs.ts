import type { Express } from 'express'
import { assertResponseObject, contracts, parseOptionalObject, parseObject } from '../../contracts/import-v2.js'
import { assertWithSchema, parseWithSchema } from '../../contracts/runtime-schema.js'
import {
  candidateListResponseSchema, exportRecordListResponseSchema, exportRequestSchema, exportResponseSchema,
  parseCandidatesRequestSchema, parseCandidatesResponseSchema,
} from '../../contracts/import-v2-schemas.js'
import {
  addSourceDocumentToImportJob,
  createImportJob,
  deleteImportJob,
  parseCandidatesForImportJob,
  updateImportJob,
} from '../../services/import-flow-v2/import-flow-v2.service.js'
import {
  classifyImportJobQuestions,
  ensureSingleDocumentImportJob,
  exportImportJob,
  getImportJobDetail,
  listImportJobCandidates,
  listImportJobExportRecords,
  listImportJobQuestions,
  listImportJobsWithStats,
  resolveImportJobForLegacyRunId,
  resolveImportJobForSourceDocument,
} from '../../services/import-flow-v2/import-batch.service.js'
import { applyModelSplitPreview, createModelSplitPreview, createModelSplitPreviewStream } from '../../services/import-flow-v2/model-split.service.js'
import { sendRouteError } from '../errors.js'
import { API_BASE, routeId } from './common.js'

export function mountImportJobRoutes(app: Express) {
  app.get(`${API_BASE}/resolve-import-job`, (req, res) => {
    try {
      const runId = String(req.query.runId || '').trim()
      const sourceDocumentId = String(req.query.sourceDocumentId || '').trim()
      const ensure = req.query.ensure !== 'false'
      if (runId) return void res.json(resolveImportJobForLegacyRunId(runId))
      if (!sourceDocumentId) return void res.status(400).json({ error: '请指定 sourceDocumentId 或 runId。', code: 'VALIDATION_ERROR' })
      const detail = ensure ? ensureSingleDocumentImportJob(sourceDocumentId) : resolveImportJobForSourceDocument(sourceDocumentId)
      if (!detail) return void res.status(404).json({ error: '资料尚未关联导入批次。' })
      res.json(detail)
    } catch (error) { sendRouteError(res, error) }
  })
  app.get(`${API_BASE}/jobs`, (req, res) => {
    try { res.json(assertResponseObject(listImportJobsWithStats(req.query), ['items'])) }
    catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/jobs`, (req, res) => {
    try { res.status(201).json(assertResponseObject(createImportJob(parseOptionalObject(req.body, contracts.createJob)), ['importJob', 'documents'])) }
    catch (error) { sendRouteError(res, error) }
  })
  app.get(`${API_BASE}/jobs/:id`, (req, res) => {
    try { res.json(assertResponseObject(getImportJobDetail(routeId(req)), ['importJob', 'documents', 'stats'])) }
    catch (error) { sendRouteError(res, error) }
  })
  app.patch(`${API_BASE}/jobs/:id`, (req, res) => {
    try { res.json(updateImportJob(routeId(req), parseOptionalObject(req.body, contracts.updateJob))) }
    catch (error) { sendRouteError(res, error) }
  })
  app.delete(`${API_BASE}/jobs/:id`, (req, res) => {
    try { res.json(deleteImportJob(routeId(req))) }
    catch (error) { sendRouteError(res, error) }
  })
  app.get(`${API_BASE}/jobs/:id/documents`, (req, res) => {
    try { res.json(getImportJobDetail(routeId(req))) }
    catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/jobs/:id/documents`, (req, res) => {
    try { res.status(201).json(addSourceDocumentToImportJob(routeId(req), parseObject(req.body, contracts.addJobDocument))) }
    catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/jobs/:id/parse-candidates`, (req, res) => {
    try {
      const body = parseWithSchema<Record<string, unknown>>(req.body ?? {}, parseCandidatesRequestSchema)
      res.json(assertWithSchema(parseCandidatesForImportJob(routeId(req), body), parseCandidatesResponseSchema))
    }
    catch (error) { sendRouteError(res, error) }
  })
  app.get(`${API_BASE}/jobs/:id/candidates`, (req, res) => {
    try { res.json(assertWithSchema(listImportJobCandidates(routeId(req)), candidateListResponseSchema)) }
    catch (error) { sendRouteError(res, error) }
  })
  app.get(`${API_BASE}/jobs/:id/questions`, (req, res) => {
    try { res.json(listImportJobQuestions(routeId(req))) }
    catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/jobs/:id/classify`, async (req, res) => {
    try { res.json(await classifyImportJobQuestions(routeId(req))) }
    catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/jobs/:id/model-split`, async (req, res) => {
    try { res.json(await createModelSplitPreview(routeId(req), req.body)) }
    catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/jobs/:id/model-split/stream`, async (req, res) => {
    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) controller.abort()
    })
    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()
    const write = (event: string, data: unknown) => {
      if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
    try {
      await createModelSplitPreviewStream(routeId(req), req.body, ({ event, data }) => write(event, data), controller.signal)
    } catch (error) {
      write('error', { message: error instanceof Error ? error.message : '模型辅助拆题失败。' })
    } finally {
      if (!res.writableEnded && !res.destroyed) res.end()
    }
  })
  app.post(`${API_BASE}/jobs/:id/model-split/:runId/apply`, (req, res) => {
    try {
      const preview = applyModelSplitPreview(routeId(req), routeId(req, 'runId'), req.body)
      res.json(preview)
    } catch (error) { sendRouteError(res, error) }
  })
  app.get(`${API_BASE}/jobs/:id/export-records`, (req, res) => {
    try { res.json(assertWithSchema(listImportJobExportRecords(routeId(req), req.query), exportRecordListResponseSchema)) }
    catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/jobs/:id/export`, (req, res) => {
    try {
      const body = parseWithSchema<Record<string, unknown>>(req.body ?? {}, exportRequestSchema)
      res.json(assertWithSchema(exportImportJob(routeId(req), body), exportResponseSchema))
    }
    catch (error) { sendRouteError(res, error) }
  })
}

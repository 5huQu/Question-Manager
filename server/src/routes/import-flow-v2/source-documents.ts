import type { Express } from 'express'
import { doc2xPackageUpload, sourceDocumentUpload } from '../../config.js'
import { contracts, parseOptionalObject, validateJsonObjectField } from '../../contracts/import-v2.js'
import { assertWithSchema } from '../../contracts/runtime-schema.js'
import { candidateListResponseSchema } from '../../contracts/import-v2-schemas.js'
import {
  createSourceDocument, deleteSourceDocument, getSourceDocument, getSourceDocumentOcrStatus,
  importDoc2xMarkdownPackage, listQuestionCandidatesForSource, listSourceDocuments,
  renderSourceDocumentPage, startSourceDocumentOcr, updateSourceDocument, uploadSourceDocument,
} from '../../services/import-flow-v2/import-flow-v2.service.js'
import { sendRouteError } from '../errors.js'
import { API_BASE, routeId } from './common.js'

export function mountSourceDocumentRoutes(app: Express) {
  app.get(`${API_BASE}/source-documents`, (req, res) => {
    try { res.json(listSourceDocuments(req.query)) } catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/source-documents`, (req, res) => {
    try { res.status(201).json(createSourceDocument(parseOptionalObject(req.body, {}))) } catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/source-documents/upload`, sourceDocumentUpload.single('file'), (req, res) => {
    try {
      const body = validateJsonObjectField(parseOptionalObject(req.body, contracts.sourceUpload), 'metadata')
      res.status(201).json(uploadSourceDocument(req.file, body))
    } catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/source-documents/import-doc2x-package`, doc2xPackageUpload.single('file'), async (req, res) => {
    try {
      const body = validateJsonObjectField(parseOptionalObject(req.body, contracts.sourceUpload), 'metadata')
      res.status(201).json(await importDoc2xMarkdownPackage(req.file, body))
    } catch (error) { sendRouteError(res, error) }
  })
  app.get(`${API_BASE}/source-documents/:id`, (req, res) => {
    try { res.json(getSourceDocument(routeId(req))) } catch (error) { sendRouteError(res, error) }
  })
  app.patch(`${API_BASE}/source-documents/:id`, (req, res) => {
    try { res.json(updateSourceDocument(routeId(req), parseOptionalObject(req.body, {}))) } catch (error) { sendRouteError(res, error) }
  })
  app.delete(`${API_BASE}/source-documents/:id`, (req, res) => {
    try { res.json(deleteSourceDocument(routeId(req))) } catch (error) { sendRouteError(res, error) }
  })
  app.get(`${API_BASE}/source-documents/:id/candidates`, (req, res) => {
    try { res.json(assertWithSchema(listQuestionCandidatesForSource(routeId(req), req.query), candidateListResponseSchema)) } catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/source-documents/:id/ocr`, (req, res) => {
    try { res.status(202).json(startSourceDocumentOcr(routeId(req), parseOptionalObject(req.body, contracts.startOcr))) } catch (error) { sendRouteError(res, error) }
  })
  app.get(`${API_BASE}/source-documents/:id/ocr-status`, (req, res) => {
    try { res.json(getSourceDocumentOcrStatus(routeId(req))) } catch (error) { sendRouteError(res, error) }
  })
  app.get(`${API_BASE}/source-documents/:id/pages/:page`, (req, res) => {
    try {
      const pageNum = Number(req.params.page)
      if (!Number.isInteger(pageNum) || pageNum < 1) return void res.status(400).json({ error: '无效的页码参数。', code: 'VALIDATION_ERROR' })
      res.sendFile(renderSourceDocumentPage(routeId(req), pageNum))
    } catch (error) { sendRouteError(res, error) }
  })
}

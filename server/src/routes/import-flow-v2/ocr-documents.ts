import type { Express } from 'express'
import type { QuestionCandidate } from '../../types/question-candidate.js'
import { contracts, parseObject, parseOptionalObject } from '../../contracts/import-v2.js'
import { assertWithSchema, parseWithSchema } from '../../contracts/runtime-schema.js'
import {
  markdownPreviewResponseSchema, parseCandidatesRequestSchema, parseCandidatesResponseSchema,
  parserPreviewRequestSchema, parserPreviewResponseSchema,
} from '../../contracts/import-v2-schemas.js'
import {
  getOcrDocument, importOCRDocumentJson, listOcrDocuments, parseCandidatesForOcrDocument,
  updateOcrDocumentMarkdown,
} from '../../services/import-flow-v2/import-flow-v2.service.js'
import { loadOcrDocument } from '../../services/import-flow-v2/ocr-document.service.js'
import { buildMarkdownPreview, buildParserPreview } from '../../services/question-parser/parser-preview.js'
import * as candidateRepo from '../../repositories/question-candidates.repo.js'
import { sendRouteError } from '../errors.js'
import { API_BASE, routeId } from './common.js'

export function mountOcrDocumentRoutes(app: Express) {
  app.get(`${API_BASE}/ocr-documents`, (req, res) => {
    try { res.json(listOcrDocuments(req.query)) } catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/ocr-documents/import-json`, async (req, res) => {
    try { res.status(201).json(await importOCRDocumentJson(parseObject(req.body, {}))) } catch (error) { sendRouteError(res, error) }
  })
  app.get(`${API_BASE}/ocr-documents/:id`, (req, res) => {
    try { res.json(getOcrDocument(routeId(req))) } catch (error) { sendRouteError(res, error) }
  })
  app.patch(`${API_BASE}/ocr-documents/:id/markdown`, (req, res) => {
    try { res.json(updateOcrDocumentMarkdown(routeId(req), parseObject(req.body, contracts.markdown))) } catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/ocr-documents/:id/parse-candidates`, (req, res) => {
    try {
      const body = parseWithSchema<Record<string, unknown>>(req.body ?? {}, parseCandidatesRequestSchema)
      res.json(assertWithSchema(parseCandidatesForOcrDocument(routeId(req), body), parseCandidatesResponseSchema))
    } catch (error) { sendRouteError(res, error) }
  })
  app.get(`${API_BASE}/ocr-documents/:id/markdown-preview`, (req, res) => {
    try { res.json(assertWithSchema(buildMarkdownPreview(loadOcrDocument(routeId(req))), markdownPreviewResponseSchema)) } catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/ocr-documents/:id/parser-preview`, (req, res) => {
    try {
      const body = parseWithSchema<Record<string, unknown>>(req.body ?? {}, parserPreviewRequestSchema)
      const candidateId = String(body.candidateId || '').trim()
      const candidate = candidateId ? candidateRepo.getQuestionCandidate(candidateId) || undefined : undefined
      const candidateIds = Array.isArray(body.candidateIds) ? body.candidateIds.map((item) => String(item || '').trim()).filter(Boolean) : []
      const recognizedCandidates = candidateIds
        .map((id) => candidateRepo.getQuestionCandidate(id))
        .filter((item: QuestionCandidate | null | undefined): item is QuestionCandidate => Boolean(item))
      res.json(assertWithSchema(
        buildParserPreview(loadOcrDocument(routeId(req)), body, candidate, recognizedCandidates),
        parserPreviewResponseSchema,
      ))
    } catch (error) { sendRouteError(res, error) }
  })
}

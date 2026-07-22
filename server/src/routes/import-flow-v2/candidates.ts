import type { Express } from 'express'
import { candidateFigureUpload } from '../../config.js'
import { contracts, parseOptionalObject } from '../../contracts/import-v2.js'
import { assertWithSchema, parseWithSchema } from '../../contracts/runtime-schema.js'
import {
  candidateBatchCommitResponseSchema, candidateCommitResponseSchema, candidateEnvelopeSchema,
  candidateIdsSchema, candidateMoveFigureSchema, candidatePairEnvelopeSchema, candidatePatchSchema,
  candidateResolveFigureSchema, candidateSkipResponseSchema, candidateUpdateRequestSchema,
  candidateUploadResponseSchema,
} from '../../contracts/import-v2-schemas.js'
import {
  commitQuestionCandidate, commitQuestionCandidates, deleteQuestionCandidate, moveCandidateFigure,
  resolveCandidateUnplacedFigure, skipQuestionCandidates, updateQuestionCandidate, uploadCandidateFigure,
} from '../../services/import-flow-v2/import-flow-v2.service.js'
import { sendRouteError } from '../errors.js'
import { API_BASE, routeId } from './common.js'

export function mountCandidateRoutes(app: Express) {
  app.patch(`${API_BASE}/candidates/:id`, (req, res) => {
    try {
      const raw = req.body ?? {}
      const body = raw && typeof raw === 'object' && !Array.isArray(raw) && 'candidate' in raw
        ? parseWithSchema<Record<string, unknown>>(raw, candidateUpdateRequestSchema)
        : parseWithSchema<Record<string, unknown>>(raw, candidatePatchSchema)
      res.json(assertWithSchema(updateQuestionCandidate(routeId(req), body), candidateEnvelopeSchema))
    } catch (error) { sendRouteError(res, error) }
  })
  app.delete(`${API_BASE}/candidates/:id`, (req, res) => {
    try { res.json(deleteQuestionCandidate(routeId(req))) } catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/candidates/:id/commit`, async (req, res) => {
    try { res.json(assertWithSchema(await commitQuestionCandidate(routeId(req)), candidateCommitResponseSchema)) } catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/candidates/commit`, async (req, res) => {
    try {
      const body = parseWithSchema<Record<string, unknown>>(req.body, candidateIdsSchema)
      res.json(assertWithSchema(await commitQuestionCandidates(body), candidateBatchCommitResponseSchema))
    } catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/candidates/skip`, (req, res) => {
    try {
      const body = parseWithSchema<Record<string, unknown>>(req.body, candidateIdsSchema)
      res.json(assertWithSchema(skipQuestionCandidates(body), candidateSkipResponseSchema))
    } catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/candidates/:id/figures/upload`, candidateFigureUpload.single('file'), (req, res) => {
    try {
      res.status(201).json(assertWithSchema(
        uploadCandidateFigure(routeId(req), req.file, parseOptionalObject(req.body, contracts.candidateFigureUpload)),
        candidateUploadResponseSchema,
      ))
    } catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/candidates/:id/unplaced-figures/:blockId/resolve`, (req, res) => {
    try {
      const body = parseWithSchema<Record<string, unknown>>(req.body, candidateResolveFigureSchema)
      res.json(assertWithSchema(resolveCandidateUnplacedFigure(routeId(req), routeId(req, 'blockId'), body), candidatePairEnvelopeSchema))
    } catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/candidates/:id/figures/:figureId/move`, (req, res) => {
    try {
      const body = parseWithSchema<Record<string, unknown>>(req.body, candidateMoveFigureSchema)
      res.json(assertWithSchema(moveCandidateFigure(routeId(req), routeId(req, 'figureId'), body), candidatePairEnvelopeSchema))
    } catch (error) { sendRouteError(res, error) }
  })
}

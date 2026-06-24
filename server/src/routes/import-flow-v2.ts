import type { Express } from 'express'
import { sendRouteError } from './errors.js'
import {
  commitQuestionCandidate,
  commitQuestionCandidates,
  createSourceDocument,
  getOcrDocument,
  getSourceDocument,
  importOCRDocumentJson,
  listOcrDocuments,
  listQuestionCandidatesForSource,
  listSourceDocuments,
  parseCandidatesForOcrDocument,
  updateQuestionCandidate,
} from '../services/import-flow-v2/import-flow-v2.service.js'

export function mountImportFlowV2Routes(app: Express) {
  app.get('/api/source-documents', (req, res) => {
    try {
      res.json(listSourceDocuments(req.query))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/source-documents', (req, res) => {
    try {
      res.status(201).json(createSourceDocument(req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/source-documents/:id', (req, res) => {
    try {
      res.json(getSourceDocument(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/source-documents/:id/candidates', (req, res) => {
    try {
      res.json(listQuestionCandidatesForSource(decodeURIComponent(String(req.params.id || '')), req.query))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/ocr-documents', (req, res) => {
    try {
      res.json(listOcrDocuments(req.query))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/ocr-documents/import-json', (req, res) => {
    try {
      res.status(201).json(importOCRDocumentJson(req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/ocr-documents/:id', (req, res) => {
    try {
      res.json(getOcrDocument(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/ocr-documents/:id/parse-candidates', (req, res) => {
    try {
      res.json(parseCandidatesForOcrDocument(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.patch('/api/question-candidates/:id', (req, res) => {
    try {
      res.json(updateQuestionCandidate(decodeURIComponent(String(req.params.id || '')), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/question-candidates/:id/commit', (req, res) => {
    try {
      res.json(commitQuestionCandidate(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/question-candidates/commit', (req, res) => {
    try {
      res.json(commitQuestionCandidates(req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })
}

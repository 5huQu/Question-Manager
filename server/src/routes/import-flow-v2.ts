import type { Express } from 'express'
import { upload } from '../config.js'
import { sendRouteError } from './errors.js'
import {
  commitQuestionCandidate,
  commitQuestionCandidates,
  createSourceDocument,
  getOcrDocument,
  getSourceDocument,
  importOCRDocumentJson,
  getSourceDocumentOcrStatus,
  listOcrDocuments,
  listQuestionCandidatesForSource,
  listSourceDocuments,
  parseCandidatesForOcrDocument,
  startSourceDocumentOcr,
  uploadSourceDocument,
  updateQuestionCandidate,
} from '../services/import-flow-v2/import-flow-v2.service.js'
import { getParserConfigForApi, resetParserConfig, saveParserConfig } from '../services/question-parser/parser-config.js'

export function mountImportFlowV2Routes(app: Express) {
  app.get('/api/import-flow-v2/parser-config', (_req, res) => {
    try {
      res.json({ config: getParserConfigForApi() })
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.put('/api/import-flow-v2/parser-config', (req, res) => {
    try {
      res.json({ config: saveParserConfig(req.body?.config || req.body) })
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-flow-v2/parser-config/reset', (_req, res) => {
    try {
      res.json({ config: resetParserConfig() })
    } catch (error) {
      sendRouteError(res, error)
    }
  })

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

  app.post('/api/source-documents/upload', upload.single('file'), (req, res) => {
    try {
      res.status(201).json(uploadSourceDocument(req.file))
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

  app.post('/api/source-documents/:id/ocr', (req, res) => {
    try {
      res.status(202).json(startSourceDocumentOcr(decodeURIComponent(String(req.params.id || '')), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/source-documents/:id/ocr-status', (req, res) => {
    try {
      res.json(getSourceDocumentOcrStatus(decodeURIComponent(String(req.params.id || ''))))
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

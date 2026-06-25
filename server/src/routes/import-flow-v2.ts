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
  updateSourceDocument,
  updateQuestionCandidate,
  renderSourceDocumentPage,
  createOrRestoreCandidateManualFixSession,
  deleteSourceDocument,
  deleteQuestionCandidate,
  createImportJob,
  getImportJob,
  addSourceDocumentToImportJob,
  parseCandidatesForImportJob,
} from '../services/import-flow-v2/import-flow-v2.service.js'
import { getParserConfigForApi, resetParserConfig, saveParserConfig } from '../services/question-parser/parser-config.js'

export function mountImportFlowV2Routes(app: Express) {
  app.delete('/api/source-documents/:id', (req, res) => {
    try {
      res.json(deleteSourceDocument(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.delete('/api/question-candidates/:id', (req, res) => {
    try {
      res.json(deleteQuestionCandidate(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

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

  app.post('/api/import-jobs', (req, res) => {
    try {
      res.status(201).json(createImportJob(req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/import-jobs/:id', (req, res) => {
    try {
      res.json(getImportJob(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-jobs/:id/documents', (req, res) => {
    try {
      res.status(201).json(addSourceDocumentToImportJob(decodeURIComponent(String(req.params.id || '')), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-jobs/:id/parse-candidates', (req, res) => {
    try {
      res.json(parseCandidatesForImportJob(decodeURIComponent(String(req.params.id || ''))))
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
      res.status(201).json(uploadSourceDocument(req.file, req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.patch('/api/source-documents/:id', (req, res) => {
    try {
      res.json(updateSourceDocument(decodeURIComponent(String(req.params.id || '')), req.body || {}))
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

  app.post('/api/ocr-documents/import-json', async (req, res) => {
    try {
      res.status(201).json(await importOCRDocumentJson(req.body || {}))
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

  app.get('/api/import-flow-v2/source-documents/:id/pages/:page', (req, res) => {
    try {
      const pageNum = parseInt(req.params.page, 10)
      if (isNaN(pageNum) || pageNum < 1) {
        res.status(400).json({ error: '无效的页码参数。' })
        return
      }
      const pagePath = renderSourceDocumentPage(decodeURIComponent(String(req.params.id || '')), pageNum)
      res.sendFile(pagePath)
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/question-candidates/:id/manual-fix-session', (req, res) => {
    try {
      res.json(createOrRestoreCandidateManualFixSession(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })
}

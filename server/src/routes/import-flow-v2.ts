import type { Express } from 'express'
import type { QuestionCandidate } from '../types/question-candidate.js'
import { doc2xPackageUpload, upload } from '../config.js'
import { sendRouteError } from './errors.js'
import {
  commitQuestionCandidate,
  commitQuestionCandidates,
  skipQuestionCandidates,
  createSourceDocument,
  getOcrDocument,
  getSourceDocument,
  importOCRDocumentJson,
  getSourceDocumentOcrStatus,
  listOcrDocuments,
  updateOcrDocumentMarkdown,
  listQuestionCandidatesForSource,
  listSourceDocuments,
  parseCandidatesForOcrDocument,
  startSourceDocumentOcr,
  uploadSourceDocument,
  updateSourceDocument,
  updateQuestionCandidate,
  moveCandidateFigure,
  resolveCandidateUnplacedFigure,
  renderSourceDocumentPage,
  createOrRestoreCandidateManualFixSession,
  deleteSourceDocument,
  deleteQuestionCandidate,
  createImportJob,
  getImportJob,
  addSourceDocumentToImportJob,
  parseCandidatesForImportJob,
  deleteImportJob,
  updateImportJob,
  importDoc2xMarkdownPackage,
} from '../services/import-flow-v2/import-flow-v2.service.js'
import {
  ensureSingleDocumentImportJob,
  classifyImportJobQuestions,
  exportImportJob,
  getImportJobDetail,
  listImportJobCandidates,
  listImportJobExportRecords,
  listImportJobsWithStats,
  listImportJobQuestions,
  resolveImportJobForLegacyRunId,
  resolveImportJobForSourceDocument,
} from '../services/import-flow-v2/import-batch.service.js'
import {
  createParserPreset,
  deleteParserPreset,
  getParserConfigForApi,
  listParserPresets,
  resetParserConfig,
  saveParserConfig,
  updateParserPreset,
} from '../services/question-parser/parser-config.js'
import { buildMarkdownPreview, buildParserPreview } from '../services/question-parser/parser-preview.js'
import { loadOcrDocument } from '../services/import-flow-v2/ocr-document.service.js'
import * as candidateRepo from '../repositories/question-candidates.repo.js'

export function mountImportFlowV2Routes(app: Express) {
  app.get('/api/import-flow-v2/resolve-import-job', (req, res) => {
    try {
      const runId = String(req.query.runId || '').trim()
      const sourceDocumentId = String(req.query.sourceDocumentId || '').trim()
      const ensure = req.query.ensure !== 'false'
      if (runId) {
        res.json(resolveImportJobForLegacyRunId(runId))
        return
      }
      if (!sourceDocumentId) {
        res.status(400).json({ error: '请指定 sourceDocumentId 或 runId。' })
        return
      }
      const detail = ensure ? ensureSingleDocumentImportJob(sourceDocumentId) : resolveImportJobForSourceDocument(sourceDocumentId)
      if (!detail) {
        res.status(404).json({ error: '资料尚未关联导入批次。' })
        return
      }
      res.json(detail)
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/import-flow-v2/jobs', (req, res) => {
    try {
      res.json(listImportJobsWithStats(req.query))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-flow-v2/jobs', (req, res) => {
    try {
      res.status(201).json(createImportJob(req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/import-flow-v2/jobs/:id', (req, res) => {
    try {
      res.json(getImportJobDetail(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.patch('/api/import-flow-v2/jobs/:id', (req, res) => {
    try {
      res.json(updateImportJob(decodeURIComponent(String(req.params.id || '')), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.delete('/api/import-flow-v2/jobs/:id', (req, res) => {
    try {
      res.json(deleteImportJob(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/import-flow-v2/jobs/:id/documents', (req, res) => {
    try {
      res.json(getImportJobDetail(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-flow-v2/jobs/:id/documents', (req, res) => {
    try {
      res.status(201).json(addSourceDocumentToImportJob(decodeURIComponent(String(req.params.id || '')), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-flow-v2/jobs/:id/parse-candidates', (req, res) => {
    try {
      res.json(parseCandidatesForImportJob(decodeURIComponent(String(req.params.id || '')), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/import-flow-v2/jobs/:id/candidates', (req, res) => {
    try {
      res.json(listImportJobCandidates(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/import-flow-v2/jobs/:id/questions', (req, res) => {
    try {
      res.json(listImportJobQuestions(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-flow-v2/jobs/:id/classify', async (req, res) => {
    try {
      res.json(await classifyImportJobQuestions(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/import-flow-v2/jobs/:id/export-records', (req, res) => {
    try {
      res.json(listImportJobExportRecords(decodeURIComponent(String(req.params.id || '')), req.query))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-flow-v2/jobs/:id/export', (req, res) => {
    try {
      res.json(exportImportJob(decodeURIComponent(String(req.params.id || '')), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

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

  app.get('/api/import-flow-v2/parser-presets', (_req, res) => {
    try {
      res.json(listParserPresets())
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-flow-v2/parser-presets', (req, res) => {
    try {
      res.status(201).json(createParserPreset(req.body?.preset || req.body))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.put('/api/import-flow-v2/parser-presets/:id', (req, res) => {
    try {
      res.json(updateParserPreset(decodeURIComponent(String(req.params.id || '')), req.body?.preset || req.body))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.delete('/api/import-flow-v2/parser-presets/:id', (req, res) => {
    try {
      res.json(deleteParserPreset(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/import-flow-v2/ocr-documents/:id/markdown-preview', (req, res) => {
    try {
      const document = loadOcrDocument(decodeURIComponent(String(req.params.id || '')))
      res.json(buildMarkdownPreview(document))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-flow-v2/ocr-documents/:id/parser-preview', (req, res) => {
    try {
      const document = loadOcrDocument(decodeURIComponent(String(req.params.id || '')))
      const candidateId = String(req.body?.candidateId || '').trim()
      const candidate = candidateId ? candidateRepo.getQuestionCandidate(candidateId) || undefined : undefined
      const candidateIds = Array.isArray(req.body?.candidateIds)
        ? req.body.candidateIds.map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : []
      const recognizedCandidates = candidateIds
        .map((id: string) => candidateRepo.getQuestionCandidate(id))
        .filter((item: QuestionCandidate | null | undefined): item is QuestionCandidate => Boolean(item))
      res.json(buildParserPreview(document, req.body || {}, candidate, recognizedCandidates))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/import-flow-v2/source-documents', (req, res) => {
    try {
      res.json(listSourceDocuments(req.query))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-flow-v2/source-documents', (req, res) => {
    try {
      res.status(201).json(createSourceDocument(req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-flow-v2/source-documents/upload', upload.single('file'), (req, res) => {
    try {
      res.status(201).json(uploadSourceDocument(req.file, req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-flow-v2/source-documents/import-doc2x-package', doc2xPackageUpload.single('file'), async (req, res) => {
    try {
      res.status(201).json(await importDoc2xMarkdownPackage(req.file, req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.patch('/api/import-flow-v2/source-documents/:id', (req, res) => {
    try {
      res.json(updateSourceDocument(decodeURIComponent(String(req.params.id || '')), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/import-flow-v2/source-documents/:id', (req, res) => {
    try {
      res.json(getSourceDocument(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.delete('/api/import-flow-v2/source-documents/:id', (req, res) => {
    try {
      res.json(deleteSourceDocument(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/import-flow-v2/source-documents/:id/candidates', (req, res) => {
    try {
      res.json(listQuestionCandidatesForSource(decodeURIComponent(String(req.params.id || '')), req.query))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-flow-v2/source-documents/:id/ocr', (req, res) => {
    try {
      res.status(202).json(startSourceDocumentOcr(decodeURIComponent(String(req.params.id || '')), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/import-flow-v2/source-documents/:id/ocr-status', (req, res) => {
    try {
      res.json(getSourceDocumentOcrStatus(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.patch('/api/import-flow-v2/candidates/:id', (req, res) => {
    try {
      res.json(updateQuestionCandidate(decodeURIComponent(String(req.params.id || '')), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-flow-v2/candidates/:id/unplaced-figures/:blockId/resolve', (req, res) => {
    try {
      res.json(resolveCandidateUnplacedFigure(
        decodeURIComponent(String(req.params.id || '')),
        decodeURIComponent(String(req.params.blockId || '')),
        req.body || {},
      ))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-flow-v2/candidates/:id/figures/:figureId/move', (req, res) => {
    try {
      res.json(moveCandidateFigure(
        decodeURIComponent(String(req.params.id || '')),
        decodeURIComponent(String(req.params.figureId || '')),
        req.body || {},
      ))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.delete('/api/import-flow-v2/candidates/:id', (req, res) => {
    try {
      res.json(deleteQuestionCandidate(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-flow-v2/candidates/:id/commit', async (req, res) => {
    try {
      res.json(await commitQuestionCandidate(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-flow-v2/candidates/commit', async (req, res) => {
    try {
      res.json(await commitQuestionCandidates(req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-flow-v2/candidates/skip', (req, res) => {
    try {
      res.json(skipQuestionCandidates(req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/import-flow-v2/candidates/:id/manual-fix-session', (req, res) => {
    try {
      res.json(createOrRestoreCandidateManualFixSession(decodeURIComponent(String(req.params.id || ''))))
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
      res.json(parseCandidatesForImportJob(decodeURIComponent(String(req.params.id || '')), req.body || {}))
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

  app.patch('/api/ocr-documents/:id/markdown', (req, res) => {
    try {
      res.json(updateOcrDocumentMarkdown(decodeURIComponent(String(req.params.id || '')), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/ocr-documents/:id/parse-candidates', (req, res) => {
    try {
      res.json(parseCandidatesForOcrDocument(decodeURIComponent(String(req.params.id || '')), req.body || {}))
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

  app.post('/api/question-candidates/:id/commit', async (req, res) => {
    try {
      res.json(await commitQuestionCandidate(decodeURIComponent(String(req.params.id || ''))))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/question-candidates/commit', async (req, res) => {
    try {
      res.json(await commitQuestionCandidates(req.body || {}))
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

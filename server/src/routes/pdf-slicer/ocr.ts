import type { Express } from 'express'
import { sendRouteError } from '../errors.js'
import {
  bulkOcr,
  classifyRun,
  completeOcr,
  interruptOcr,
  listOcrJobs,
  ocrProgress,
  runQuestions,
  startOcr,
} from '../../services/pdf-slicer/ocr-run.service.js'

export function mountOcrRoutes(app: Express) {
  app.post('/api/tools/pdf-slicer/runs/bulk-ocr', (req, res) => {
    try {
      res.json(bulkOcr(req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/tools/pdf-slicer/ocr-jobs', (_, res) => {
    try {
      res.json(listOcrJobs())
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/tools/pdf-slicer/runs/:runId/ocr-progress', (req, res) => {
    try {
      res.json(ocrProgress(req.params.runId))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/tools/pdf-slicer/runs/:runId/questions', (req, res) => {
    try {
      res.json(runQuestions(req.params.runId))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/classify', async (req, res) => {
    try {
      res.json(await classifyRun(req.params.runId))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/start-ocr', (req, res) => {
    try {
      res.json(startOcr(req.params.runId))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/resume-ocr', (req, res) => {
    try {
      res.json(startOcr(req.params.runId, { force: false }))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/complete-ocr', (req, res) => {
    try {
      res.json(completeOcr(req.params.runId))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/force-rerun-ocr', (req, res) => {
    try {
      res.json(startOcr(req.params.runId, { force: true, resetOutputs: true, resetFinished: true }))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/force-interrupt-ocr', (req, res) => {
    try {
      res.json(interruptOcr(req.params.runId))
    } catch (error) {
      sendRouteError(res, error)
    }
  })
}

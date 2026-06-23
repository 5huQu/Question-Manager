import type { Express } from 'express'
import { sendRouteError } from '../errors.js'
import {
  bulkConfirm,
  bulkDelete,
  bulkSkip,
  listPendingBank,
  rerunPendingBankOcr,
  saveManualCandidate,
} from '../../services/pdf-slicer/pending-bank.service.js'

export function mountPendingBankRoutes(app: Express) {
  app.get('/api/tools/pdf-slicer/runs/:runId/pending-bank', (req, res) => {
    try {
      res.json(listPendingBank(req.params.runId, req.query))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/pending-bank/manual-candidate', (req, res) => {
    try {
      const result = saveManualCandidate(req.params.runId, req.body || {})
      res.status(result.status).json(result.item)
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/pending-bank/:id/rerun-ocr', (req, res) => {
    try {
      res.json(rerunPendingBankOcr(req.params.runId, decodeURIComponent(String(req.params.id || '')), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/pending-bank/bulk-confirm', (req, res) => {
    try {
      res.json(bulkConfirm(req.params.runId, req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/pending-bank/bulk-skip', (req, res) => {
    try {
      res.json(bulkSkip(req.params.runId, req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/pending-bank/bulk-delete', (req, res) => {
    try {
      res.json(bulkDelete(req.params.runId, req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })
}

import type { Express } from 'express'
import { sendRouteError } from '../errors.js'
import {
  createFigure,
  createItem,
  deleteFigure,
  deleteItem,
  getItem,
  importJsonItems,
  importJsonItemsFromSlices,
  listItems,
  questionFigureUpload,
  rerunItemOcr,
  updateFigure,
  updateItem,
  uploadFigure,
} from '../../services/question-bank/items.service.js'
import { runQuestionBatchClassification } from '../../services/question-bank/batch-classification.js'

export function mountQuestionBankItemsRoutes(app: Express) {
  app.get('/api/question-bank/items', (req, res) => {
    try {
      res.json(listItems(req.query))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/question-bank/items/:id/rerun-ocr', (req, res) => {
    try {
      res.json(rerunItemOcr(decodeURIComponent(String(req.params.id || '')), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/question-bank/items/classify', async (_req, res) => {
    try {
      res.json({ report: await runQuestionBatchClassification({ type: 'all' }) })
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/question-bank/items', (req, res) => {
    try {
      res.status(201).json(createItem(req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/question-bank/import-json', (req, res) => {
    try {
      res.status(201).json(importJsonItems(req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/question-bank/import-json-from-slices', (req, res) => {
    try {
      res.status(201).json(importJsonItemsFromSlices(req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/question-bank/items/:id', (req, res) => {
    try {
      res.json(getItem(decodeURIComponent(req.params.id)))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.patch('/api/question-bank/items/:id', (req, res) => {
    try {
      res.json(updateItem(decodeURIComponent(req.params.id), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.delete('/api/question-bank/items/:id', (req, res) => {
    try {
      res.json(deleteItem(decodeURIComponent(req.params.id)))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/question-bank/items/:id/figures', (req, res) => {
    try {
      res.status(201).json(createFigure(decodeURIComponent(req.params.id), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.patch('/api/question-bank/items/:id/figures/:figureId', (req, res) => {
    try {
      res.json(updateFigure(decodeURIComponent(req.params.id), decodeURIComponent(req.params.figureId), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/question-bank/items/:id/figures/upload', questionFigureUpload, (req, res) => {
    try {
      res.status(201).json(uploadFigure(decodeURIComponent(String(req.params.id || '')), req))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.delete('/api/question-bank/items/:id/figures/:figureId', (req, res) => {
    try {
      res.json(deleteFigure(decodeURIComponent(req.params.id), decodeURIComponent(req.params.figureId)))
    } catch (error) {
      sendRouteError(res, error)
    }
  })
}

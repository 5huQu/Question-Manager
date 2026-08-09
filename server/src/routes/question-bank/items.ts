import type { Express } from 'express'
import { sendRouteError } from '../errors.js'
import {
  createFigure,
  createTikzFigure,
  createItem,
  bindFigureToMarker,
  deleteFigure,
  deleteItem,
  getItem,
  importJsonItems,
  listItems,
  questionFigureUpload,
  rerunItemOcr,
  updateFigure,
  updateTikzFigure,
  updateItem,
  uploadFigure,
  previewTikzFigure,
} from '../../services/question-bank/items.service.js'
import { getActiveQuestionBatchClassificationTask, getQuestionBatchClassificationTask, startQuestionBatchClassification } from '../../services/question-bank/batch-classification.js'

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

  app.post('/api/question-bank/items/classify', (_req, res) => {
    try {
      res.status(202).json({ task: startQuestionBatchClassification({ type: 'all' }) })
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/question-bank/classification-tasks/active', (_req, res) => {
    res.json({ task: getActiveQuestionBatchClassificationTask() })
  })

  app.get('/api/question-bank/classification-tasks/:id', (req, res) => {
    const task = getQuestionBatchClassificationTask(decodeURIComponent(req.params.id))
    if (!task) { res.status(404).json({ error: '分类任务不存在或已过期。' }); return }
    res.json({ task })
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

  app.post('/api/question-bank/items/:id/figures/:figureId/bind', (req, res) => {
    try {
      res.json(bindFigureToMarker(
        decodeURIComponent(String(req.params.id || '')),
        decodeURIComponent(String(req.params.figureId || '')),
        req.body || {},
      ))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/question-bank/items/:id/figures/tikz/preview', async (req, res) => {
    try {
      res.json(await previewTikzFigure(decodeURIComponent(String(req.params.id || '')), req.body?.source))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/question-bank/items/:id/figures/tikz', async (req, res) => {
    try {
      res.status(201).json(await createTikzFigure(decodeURIComponent(String(req.params.id || '')), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.patch('/api/question-bank/items/:id/figures/:figureId/tikz', async (req, res) => {
    try {
      res.json(await updateTikzFigure(decodeURIComponent(String(req.params.id || '')), decodeURIComponent(String(req.params.figureId || '')), req.body || {}))
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

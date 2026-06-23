import type { Express } from 'express'
import { sendRouteError } from '../errors.js'
import {
  addCollectionItem,
  clearCollectionItems,
  createCollection,
  deleteCollection,
  deleteCollectionItem,
  exportCollection,
  getCollection,
  listCollections,
  reorderCollectionItems,
  updateCollection,
  updateCollectionItem,
} from '../../services/question-bank/collections.service.js'

export function mountQuestionBankCollectionsRoutes(app: Express) {
  app.get('/api/question-bank/collections', (_, res) => {
    try {
      res.json(listCollections())
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/question-bank/collections', (req, res) => {
    try {
      res.status(201).json(createCollection(req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/question-bank/collections/:id', (req, res) => {
    try {
      res.json(getCollection(decodeURIComponent(req.params.id)))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.patch('/api/question-bank/collections/:id', (req, res) => {
    try {
      res.json(updateCollection(decodeURIComponent(req.params.id), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.delete('/api/question-bank/collections/:id', (req, res) => {
    try {
      res.json(deleteCollection(decodeURIComponent(req.params.id)))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/question-bank/collections/:id/items', (req, res) => {
    try {
      res.status(201).json(addCollectionItem(decodeURIComponent(req.params.id), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.patch('/api/question-bank/collections/:id/items/:relationId', (req, res) => {
    try {
      res.json(updateCollectionItem(decodeURIComponent(req.params.id), decodeURIComponent(req.params.relationId), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.delete('/api/question-bank/collections/:id/items/:relationId', (req, res) => {
    try {
      res.json(deleteCollectionItem(decodeURIComponent(req.params.id), decodeURIComponent(req.params.relationId)))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.delete('/api/question-bank/collections/:id/items', (req, res) => {
    try {
      res.json(clearCollectionItems(decodeURIComponent(req.params.id)))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.patch('/api/question-bank/collections/:id/reorder', (req, res) => {
    try {
      res.json(reorderCollectionItems(decodeURIComponent(req.params.id), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/question-bank/collections/:id/export', (req, res) => {
    try {
      res.json(exportCollection(decodeURIComponent(req.params.id), req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })
}

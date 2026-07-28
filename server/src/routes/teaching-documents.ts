import type { Express } from 'express'
import { candidateFigureUpload } from '../config.js'
import { sendRouteError } from './errors.js'
import * as service from '../services/teaching-documents.service.js'

export function mountTeachingDocumentRoutes(app: Express) {
  app.get('/api/teaching-documents', (_req, res) => {
    try { res.json(service.listTeachingDocuments()) } catch (error) { sendRouteError(res, error) }
  })
  app.post('/api/teaching-documents', (req, res) => {
    try { res.status(201).json(service.createTeachingDocument(req.body || {})) } catch (error) { sendRouteError(res, error) }
  })
  app.get('/api/teaching-documents/:id', (req, res) => {
    try { res.json(service.getTeachingDocument(decodeURIComponent(String(req.params.id || '')))) } catch (error) { sendRouteError(res, error) }
  })
  app.patch('/api/teaching-documents/:id', (req, res) => {
    try { res.json(service.updateTeachingDocument(decodeURIComponent(String(req.params.id || '')), req.body || {})) } catch (error) { sendRouteError(res, error) }
  })
  app.post('/api/teaching-documents/:id/duplicate', (req, res) => {
    try { res.status(201).json(service.duplicateTeachingDocument(decodeURIComponent(String(req.params.id || '')))) } catch (error) { sendRouteError(res, error) }
  })
  app.delete('/api/teaching-documents/:id', (req, res) => {
    try { res.json(service.deleteTeachingDocument(decodeURIComponent(String(req.params.id || '')))) } catch (error) { sendRouteError(res, error) }
  })
  app.post('/api/teaching-documents/:id/assets', candidateFigureUpload.single('file'), (req, res) => {
    try { res.status(201).json(service.uploadTeachingDocumentAsset(decodeURIComponent(String(req.params.id || '')), req.file)) } catch (error) { sendRouteError(res, error) }
  })
  app.get('/api/teaching-document-assets/:assetId', (req, res) => {
    try { res.json(service.getTeachingDocumentAsset(decodeURIComponent(String(req.params.assetId || '')))) } catch (error) { sendRouteError(res, error) }
  })
}

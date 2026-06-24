import type { Express } from 'express'
import { db } from '../../db/connection.js'
import { parseJson } from '../../utils/json.js'
import {
  createOrRestoreSession,
  getSession,
  saveRegions,
  renderRunPage,
  validateSession,
  finalizeSession,
  reviseSession
} from '../../services/pdf-slicer/annotations.service.js'

export function mountAnnotationRoutes(app: Express) {
  // GET PDF document profile info
  app.get('/api/tools/pdf-slicer/runs/:runId/document-profile', (req, res) => {
    try {
      const run = db.prepare('SELECT document_diagnostics_json FROM pdf_slicer_runs WHERE run_id = ?').get(req.params.runId) as any
      if (!run) {
        res.status(404).json({ error: '批次文件不存在。' })
        return
      }
      const diag = parseJson<Record<string, any>>(run.document_diagnostics_json || '{}', {})
      res.json(diag.profile || null)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST Trigger rendering all pages in the background
  app.post('/api/tools/pdf-slicer/runs/:runId/render-pages', (req, res) => {
    try {
      const run = db.prepare('SELECT run_id, document_diagnostics_json FROM pdf_slicer_runs WHERE run_id = ?').get(req.params.runId) as any
      if (!run) {
        res.status(404).json({ error: '批次文件不存在。' })
        return
      }
      const diag = parseJson<Record<string, any>>(run.document_diagnostics_json || '{}', {})
      const pageCount = diag.profile?.pageCount || 0
      
      // Async trigger in background
      for (let i = 1; i <= pageCount; i++) {
        setTimeout(() => {
          try {
            renderRunPage(run.run_id, i)
          } catch {}
        }, 0)
      }
      res.json({ success: true, pagesCount: pageCount })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // GET Render and redirect to individual page PNG
  app.get('/api/tools/pdf-slicer/runs/:runId/pages/:page', (req, res) => {
    try {
      const pageNum = parseInt(req.params.page, 10)
      if (isNaN(pageNum) || pageNum < 1) {
        res.status(400).json({ error: '无效的页码参数。' })
        return
      }
      const assetPath = renderRunPage(req.params.runId, pageNum)
      res.redirect(`/assets/${assetPath}`)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST Create or restore annotation session
  app.post('/api/tools/pdf-slicer/batches/:batchId/annotation-sessions', (req, res) => {
    try {
      const session = createOrRestoreSession(req.params.batchId)
      res.json(session)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // GET Retrieve annotation session
  app.get('/api/tools/pdf-slicer/annotation-sessions/:sessionId', (req, res) => {
    try {
      const session = getSession(req.params.sessionId)
      if (!session) {
        res.status(404).json({ error: '标注会话不存在。' })
        return
      }
      res.json(session)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // PUT Save annotation regions draft
  app.put('/api/tools/pdf-slicer/annotation-sessions/:sessionId/regions', (req, res) => {
    try {
      const regions = req.body?.regions || []
      const revision = parseInt(req.body?.revision || '0', 10)
      const session = saveRegions(req.params.sessionId, regions, revision)
      res.json(session)
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST Validate current regions
  app.post('/api/tools/pdf-slicer/annotation-sessions/:sessionId/validate', (req, res) => {
    try {
      const validation = validateSession(req.params.sessionId)
      res.json(validation)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST Finalize annotation and crop/stitch to DB review items
  app.post('/api/tools/pdf-slicer/annotation-sessions/:sessionId/finalize', (req, res) => {
    try {
      finalizeSession(req.params.sessionId)
      res.json({ success: true })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST Create next session revision after OCR was already started
  app.post('/api/tools/pdf-slicer/annotation-sessions/:sessionId/revise', (req, res) => {
    try {
      const newSession = reviseSession(req.params.sessionId)
      res.json(newSession)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })
}

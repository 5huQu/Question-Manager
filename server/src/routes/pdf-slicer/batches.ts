import type { Express } from 'express'
import { db } from '../../db/connection.js'
import { mapBatch, batchRuns, getRun, updateBatchWorkflow } from '../../db/runs.js'
import { tryAutoMergeSeparatedExam } from '../../services/pdf-slicer/merging.js'
import type { BatchRow } from '../../types/index.js'

export function mountBatchRoutes(app: Express) {
  app.get('/api/tools/pdf-slicer/batches/:batchId', (req, res) => {
    const row = db.prepare('SELECT * FROM pdf_slicer_batches WHERE id = ?').get(req.params.batchId) as BatchRow | undefined
    if (!row) {
      res.status(404).json({ error: '资料组不存在。' })
      return
    }
    updateBatchWorkflow(req.params.batchId)
    const next = db.prepare('SELECT * FROM pdf_slicer_batches WHERE id = ?').get(req.params.batchId) as BatchRow
    const solutionSummary = db.prepare(`
      SELECT match_status AS status, COUNT(*) AS count
      FROM pdf_slicer_solution_items
      WHERE batch_id = ?
      GROUP BY match_status
    `).all(req.params.batchId)
    res.json({ batch: mapBatch(next), runs: batchRuns(req.params.batchId), solutionSummary })
  })

  app.post('/api/tools/pdf-slicer/batches/:batchId/merge-separated-exam', (req, res) => {
    const row = db.prepare('SELECT * FROM pdf_slicer_batches WHERE id = ?').get(req.params.batchId) as BatchRow | undefined
    if (!row) {
      res.status(404).json({ error: '资料组不存在。' })
      return
    }
    const result = tryAutoMergeSeparatedExam(req.params.batchId)
    const next = db.prepare('SELECT * FROM pdf_slicer_batches WHERE id = ?').get(req.params.batchId) as BatchRow
    res.json({ ...result, batch: mapBatch(next), runs: batchRuns(req.params.batchId) })
  })
}

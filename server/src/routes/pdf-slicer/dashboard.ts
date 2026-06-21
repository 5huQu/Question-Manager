import type { Express } from 'express'
import { db } from '../../db/connection.js'
import { mapRun, mapBatch } from '../../db/runs.js'
import type { RunRow, BatchRow } from '../../types/index.js'

export function mountDashboardRoutes(app: Express) {
  app.get('/api/tools/pdf-slicer/dashboard', (_, res) => {
    const runs = (db.prepare('SELECT * FROM pdf_slicer_runs ORDER BY created_at DESC').all() as RunRow[]).map(mapRun)
    const batches = db.prepare(`
      SELECT b.id, b.title, b.material_type AS materialType, b.workflow_mode AS workflowMode, b.workflow_status AS workflowStatus,
        b.created_at AS createdAt, b.uploaded_count AS uploadedCount,
        COUNT(r.run_id) AS runCount
      FROM pdf_slicer_batches b
      LEFT JOIN pdf_slicer_runs r ON r.batch_id = b.id
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `).all()
    res.json({
      queueSummary: {
        totalRuns: runs.length,
        totalBatches: batches.length,
        sliceQueued: runs.filter((run) => run.sliceStatus === 'queued').length,
        sliceRunning: runs.filter((run) => run.sliceStatus === 'running').length,
        pendingQuickReview: runs.filter((run) => run.sliceStatus === 'succeeded' && run.quickReviewStatus === 'pending').length,
        ocrQueued: runs.filter((run) => run.ocrStatus === 'queued').length,
        ocrRunning: runs.filter((run) => run.ocrStatus === 'running').length,
        ocrSucceeded: runs.filter((run) => run.ocrStatus === 'succeeded').length,
      },
      batches,
      runs,
    })
  })
}

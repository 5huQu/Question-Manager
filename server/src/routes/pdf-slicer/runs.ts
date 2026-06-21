import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Express } from 'express'
import { db } from '../../db/connection.js'
import { getRun, batchRuns, mapBatch, updateBatchWorkflow, removeRunArtifacts } from '../../db/runs.js'
import { nowIso } from '../../utils/ids.js'
import { normalizeMaterialType, normalizeFileRole } from '../../utils/ocr-helpers.js'
import { assetPathFor, resolveStoragePath } from '../../utils/paths.js'
import { startSlicingRun } from '../../services/pdf-slicer/slicing.js'
import { tryAutoMergeSeparatedExam } from '../../services/pdf-slicer/review.js'
import type { RunRow, BatchRow } from '../../types/index.js'

export function mountRunRoutes(app: Express) {
  app.patch('/api/tools/pdf-slicer/runs/:runId/classification', (req, res) => {
    const row = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(req.params.runId) as RunRow | undefined
    if (!row) {
      res.status(404).json({ error: '批次文件不存在。' })
      return
    }
    const materialType = normalizeMaterialType(req.body?.materialType ?? req.body?.material_type ?? row.material_type)
    const fileRole = normalizeFileRole(req.body?.fileRole ?? req.body?.file_role ?? row.file_role)
    const reasons = [`用户修改为 ${materialType}/${fileRole}`]
    db.prepare(`
      UPDATE pdf_slicer_runs
      SET material_type = ?, file_role = ?, classification_confidence = 1, classification_reasons_json = ?, updated_at = ?
      WHERE run_id = ?
    `).run(materialType, fileRole, JSON.stringify(reasons), nowIso(), req.params.runId)
    if (fileRole !== 'solutions') {
      db.prepare('DELETE FROM pdf_slicer_solution_items WHERE source_run_id = ?').run(req.params.runId)
    }
    updateBatchWorkflow(row.batch_id)
    const warning = row.slice_status !== 'queued' && row.slice_status !== 'idle'
      ? '文件角色已修改。该文件已有切题结果，如需让新角色完全生效，建议重新执行切题/OCR。'
      : ''
    const batch = db.prepare('SELECT * FROM pdf_slicer_batches WHERE id = ?').get(row.batch_id) as BatchRow
    res.json({ run: getRun(req.params.runId), batch: mapBatch(batch), warning })
  })

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

  app.get('/api/tools/pdf-slicer/runs/:runId', (req, res) => {
    const run = getRun(req.params.runId)
    run ? res.json(run) : res.status(404).json({ error: '批次不存在。' })
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/complete-slice', (req, res) => {
    if (!getRun(req.params.runId)) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const total = Number(req.body?.totalQuestions || 8)
    db.prepare("UPDATE pdf_slicer_runs SET slice_status = 'succeeded', total_questions = ?, unreviewed_questions = ?, updated_at = ? WHERE run_id = ?")
      .run(total, total, nowIso(), req.params.runId)
    res.json(getRun(req.params.runId))
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/start-slice', (req, res) => {
    if (!getRun(req.params.runId)) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    try {
      res.json(startSlicingRun(req.params.runId))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.status(500).json({ error: message, run: getRun(req.params.runId) })
    }
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/open-folder', (req, res) => {
    const run = getRun(req.params.runId)
    if (!run) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const pdfPath = resolveStoragePath(run.pdfPath)
    if (!fs.existsSync(pdfPath)) {
      res.status(404).json({ error: 'PDF 文件不存在，无法打开所在文件夹。' })
      return
    }
    const folderPath = path.dirname(pdfPath)
    try {
      if (process.platform === 'darwin') {
        execFileSync('open', [folderPath], { stdio: 'ignore' })
      } else if (process.platform === 'win32') {
        execFileSync('explorer', [folderPath], { stdio: 'ignore' })
      } else {
        execFileSync('xdg-open', [folderPath], { stdio: 'ignore' })
      }
      res.json({ opened: true, folderPath: assetPathFor(folderPath) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.status(500).json({ error: `打开文件夹失败：${message}` })
    }
  })

  app.delete('/api/tools/pdf-slicer/runs/:runId', (req, res) => {
    const row = db.prepare('SELECT batch_id FROM pdf_slicer_runs WHERE run_id = ?').get(req.params.runId) as Pick<RunRow, 'batch_id'> | undefined
    removeRunArtifacts(req.params.runId)
    db.prepare('DELETE FROM question_bank_items WHERE source_run_id = ?').run(req.params.runId)
    db.prepare('DELETE FROM pdf_slicer_runs WHERE run_id = ?').run(req.params.runId)
    if (row?.batch_id) updateBatchWorkflow(row.batch_id)
    res.json({ deleted: true })
  })
}

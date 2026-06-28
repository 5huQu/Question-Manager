import fs from 'node:fs'
import path from 'node:path'
import type { Express } from 'express'
import { db } from '../../db/connection.js'
import { listExportRecords, createExportRecord, mapExportRecord, exportRecordFileSize } from '../../db/export-records.js'
import { restoreExportRecordToCollection } from '../../db/export-records.js'
import { getRun } from '../../db/runs.js'
import { collectionExists } from '../../db/collections.js'
import { nowIso, safeName } from '../../utils/ids.js'
import { assetPathFor } from '../../utils/paths.js'
import {
  normalizeNumber,
  normalizeExportRecordSourceType,
  normalizeExportVariant,
} from '../../services/question-bank/export-records.js'
import {
  exportRunWorksheetPdf,
  exportRunExamPdf,
} from '../../services/question-bank/export.js'
import { normalizeExamZhScoreConfig } from '../../utils/exam-zh.js'
import { runExportItems } from '../../services/question-bank/collections.js'

export function mountExportRecordsRoutes(app: Express) {
  app.get('/api/question-bank/export-records', (req, res) => {
    const sourceType = normalizeExportRecordSourceType(req.query.sourceType)
    const collectionId = String(req.query.collectionId || '').trim()
    const runId = String(req.query.runId || '').trim()
    const importJobId = String(req.query.importJobId || '').trim()
    const query = String(req.query.q || req.query.query || '').trim()
    const limit = Math.floor(normalizeNumber(req.query.limit, 100))
    res.json({
      items: listExportRecords({
        sourceType,
        collectionId,
        runId,
        importJobId,
        query,
        limit,
      }),
    })
  })

  app.delete('/api/question-bank/export-records/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id)
    const existing = db.prepare('SELECT id FROM question_bank_export_records WHERE id = ?').get(id)
    if (!existing) {
      res.status(404).json({ error: '导出记录不存在。' })
      return
    }
    db.prepare('DELETE FROM question_bank_export_records WHERE id = ?').run(id)
    res.json({ deleted: true })
  })

  app.post('/api/question-bank/export-records/:id/restore-to-basket', (req, res) => {
    const id = decodeURIComponent(req.params.id)
    const targetCollectionId = String(req.body?.collectionId || 'basket').trim() || 'basket'
    try {
      res.json(restoreExportRecordToCollection(id, targetCollectionId, { syncTitle: Boolean(req.body?.syncTitle) }))
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/question-bank/collections/:id/export-records', (req, res) => {
    const id = decodeURIComponent(req.params.id)
    if (!collectionExists(id)) {
      res.status(404).json({ error: '试题篮不存在。' })
      return
    }
    const limit = Math.floor(normalizeNumber(req.query.limit, 100))
    res.json({ items: listExportRecords({ sourceType: 'collection', collectionId: id, limit }) })
  })

  app.get('/api/tools/pdf-slicer/runs/:runId/export-records', (req, res) => {
    const runId = req.params.runId
    if (!getRun(runId)) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const limit = Math.floor(normalizeNumber(req.query.limit, 100))
    res.json({ items: listExportRecords({ sourceType: 'run', runId, limit }) })
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/export-batch', (req, res) => {
    const runId = req.params.runId
    const format = req.body?.format === 'pdf' ? 'pdf' : 'latex'
    const title = String(req.body?.title || '').trim()
    const template = req.body?.template === 'worksheet' ? 'worksheet' : 'exam'
    const variant = normalizeExportVariant(req.body?.variant)
    const watermarkText = String(req.body?.watermarkText || '').trim()
    const scoreConfig = normalizeExamZhScoreConfig(req.body?.scoreConfig)
    try {
      const run = getRun(runId)
      if (!run) throw new Error('批次不存在。')
      const result = run.materialType === 'lecture' || template === 'worksheet'
        ? exportRunWorksheetPdf(runId, { title, variant })
        : exportRunExamPdf(runId, { title, variant })
      const rel = assetPathFor(result.path)
      const record = createExportRecord({
        sourceType: 'run',
        runId,
        title: title || run.paperTitle || run.pdfName,
        format: result.format,
        variant: `${template}-${variant}`,
        filename: path.basename(result.path),
        path: rel,
        url: `/assets/${rel}`,
        items: runExportItems(runId),
        contentLength: exportRecordFileSize(rel),
        questionCount: Number(run.approvedQuestions || run.totalQuestions || 0),
      })
      res.json({
        filename: path.basename(result.path),
        format: result.format,
        url: `/assets/${rel}`,
        path: rel,
        exportRecord: mapExportRecord(record),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.status(500).json({ error: `批次导出失败：${message}` })
    }
  })
}

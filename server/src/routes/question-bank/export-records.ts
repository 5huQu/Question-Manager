import type { Express } from 'express'
import { db } from '../../db/connection.js'
import { listExportRecords } from '../../db/export-records.js'
import { restoreExportRecordToCollection } from '../../db/export-records.js'
import { collectionExists } from '../../db/collections.js'
import {
  normalizeNumber,
  normalizeExportRecordSourceType,
} from '../../services/question-bank/export-records.js'

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

}

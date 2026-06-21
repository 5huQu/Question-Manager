import path from 'node:path'
import type { Express } from 'express'
import { db } from '../../db/connection.js'
import { getCollection, getBasket, collectionExists, refreshCollectionScore, mapCollectionSummary } from '../../db/collections.js'
import { getQuestion, mapQuestion } from '../../db/questions.js'
import { listExportRecords, createExportRecord, mapExportRecord, exportRecordFileSize } from '../../db/export-records.js'
import { nowIso, createId, safeName } from '../../utils/ids.js'
import { assetPathFor } from '../../utils/paths.js'
import {
  normalizeCollectionKind,
  normalizeCollectionStatus,
  normalizeExportFormat,
  collectionExportItems,
} from '../../services/question-bank/collections.js'
import {
  normalizeNumber,
  normalizeExportVariant,
} from '../../services/question-bank/export-records.js'
import {
  buildCollectionMarkdown,
  buildCollectionLatex,
  exportCollectionWorksheetPdf,
} from '../../services/question-bank/export.js'
import type { CollectionRow } from '../../types/index.js'

export function mountQuestionBankCollectionsRoutes(app: Express) {
  app.get('/api/question-bank/collections', (_, res) => {
    const rows = db.prepare(`
      SELECT c.*, COUNT(ci.id) AS question_count
      FROM question_bank_collections c
      LEFT JOIN question_bank_collection_items ci ON ci.collection_id = c.id
      GROUP BY c.id
      ORDER BY CASE WHEN c.id = 'basket' THEN 0 ELSE 1 END, c.updated_at DESC
    `).all() as Array<CollectionRow & { question_count: number }>
    res.json({ items: rows.map((row) => mapCollectionSummary(row, Number(row.question_count || 0))) })
  })

  app.post('/api/question-bank/collections', (req, res) => {
    const now = nowIso()
    const title = String(req.body?.title || '未命名试卷').trim() || '未命名试卷'
    const id = req.body?.id ? safeName(String(req.body.id)) : createId('paper', title)
    if (collectionExists(id)) {
      res.status(409).json({ error: '同名试题篮已经存在。' })
      return
    }
    db.prepare(`
      INSERT INTO question_bank_collections
        (id, title, subtitle, description, kind, status, total_score, time_limit, export_format, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      title,
      String(req.body?.subtitle || ''),
      String(req.body?.description || ''),
      normalizeCollectionKind(req.body?.kind),
      normalizeCollectionStatus(req.body?.status),
      normalizeNumber(req.body?.totalScore),
      Math.max(0, Math.floor(normalizeNumber(req.body?.timeLimit))),
      normalizeExportFormat(req.body?.exportFormat),
      now,
      now
    )
    res.status(201).json(getCollection(id))
  })

  app.get('/api/question-bank/collections/:id', (req, res) => {
    const collection = getCollection(decodeURIComponent(req.params.id))
    collection ? res.json(collection) : res.status(404).json({ error: '试题篮不存在。' })
  })

  app.patch('/api/question-bank/collections/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id)
    if (!collectionExists(id)) {
      res.status(404).json({ error: '试题篮不存在。' })
      return
    }
    const body = req.body || {}
    const now = nowIso()
    db.prepare(`
      UPDATE question_bank_collections SET
        title = COALESCE(?, title),
        subtitle = COALESCE(?, subtitle),
        description = COALESCE(?, description),
        kind = COALESCE(?, kind),
        status = COALESCE(?, status),
        time_limit = COALESCE(?, time_limit),
        export_format = COALESCE(?, export_format),
        updated_at = ?
      WHERE id = ?
    `).run(
      body.title == null ? null : String(body.title || '').trim() || '未命名试卷',
      body.subtitle == null ? null : String(body.subtitle || ''),
      body.description == null ? null : String(body.description || ''),
      body.kind == null ? null : normalizeCollectionKind(body.kind),
      body.status == null ? null : normalizeCollectionStatus(body.status),
      body.timeLimit == null ? null : Math.max(0, Math.floor(normalizeNumber(body.timeLimit))),
      body.exportFormat == null ? null : normalizeExportFormat(body.exportFormat),
      now,
      id
    )
    if (Array.isArray(body.addQuestionIds)) {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO question_bank_collection_items
          (id, collection_id, question_id, sort_order, score, section_name, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const questionId of body.addQuestionIds.map(String)) {
        const q = getQuestion(questionId)
        if (!q) continue
        let finalScore = normalizeNumber(body.score)
        if (!finalScore) {
          if (q.questionType === '单选题') finalScore = 5
          else if (q.questionType === '填空题') finalScore = 5
          else if (q.questionType === '多选题') finalScore = 6
          else if (q.questionType === '解答题') finalScore = 15
          else finalScore = 5
        }
        insert.run(createId('rel'), id, questionId, Date.now(), finalScore, String(body.sectionName || ''), nowIso())
      }
      refreshCollectionScore(id)
    }
    if (body.removeQuestionId) {
      db.prepare('DELETE FROM question_bank_collection_items WHERE collection_id = ? AND question_id = ?').run(id, String(body.removeQuestionId))
      refreshCollectionScore(id)
    }
    res.json(getCollection(id))
  })

  app.delete('/api/question-bank/collections/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id)
    if (id === 'basket') {
      res.status(400).json({ error: '默认试题篮不能删除。' })
      return
    }
    if (!collectionExists(id)) {
      res.status(404).json({ error: '试题篮不存在。' })
      return
    }
    db.prepare('DELETE FROM question_bank_collections WHERE id = ?').run(id)
    res.json({ deleted: true })
  })

  app.post('/api/question-bank/collections/:id/items', (req, res) => {
    const id = decodeURIComponent(req.params.id)
    const questionId = String(req.body?.questionId || '')
    if (!collectionExists(id)) {
      res.status(404).json({ error: '试题篮不存在。' })
      return
    }
    const q = getQuestion(questionId)
    if (!q) {
      res.status(404).json({ error: '题目不存在。' })
      return
    }
    let finalScore = normalizeNumber(req.body?.score)
    if (!finalScore) {
      if (q.questionType === '单选题') finalScore = 5
      else if (q.questionType === '填空题') finalScore = 5
      else if (q.questionType === '多选题') finalScore = 6
      else if (q.questionType === '解答题') finalScore = 15
      else finalScore = 5
    }
    const now = nowIso()
    const relationId = createId('rel')
    db.prepare(`
      INSERT OR IGNORE INTO question_bank_collection_items
        (id, collection_id, question_id, sort_order, score, section_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      relationId,
      id,
      questionId,
      Math.floor(normalizeNumber(req.body?.sortOrder, Date.now())),
      finalScore,
      String(req.body?.sectionName || ''),
      now
    )
    refreshCollectionScore(id)
    res.status(201).json(getCollection(id))
  })

  app.patch('/api/question-bank/collections/:id/items/:relationId', (req, res) => {
    const id = decodeURIComponent(req.params.id)
    const relationId = decodeURIComponent(req.params.relationId)
    if (!collectionExists(id)) {
      res.status(404).json({ error: '试题篮不存在。' })
      return
    }
    const existing = db.prepare('SELECT id FROM question_bank_collection_items WHERE id = ? AND collection_id = ?').get(relationId, id)
    if (!existing) {
      res.status(404).json({ error: '试题篮题目不存在。' })
      return
    }
    db.prepare(`
      UPDATE question_bank_collection_items SET
        sort_order = COALESCE(?, sort_order),
        score = COALESCE(?, score),
        section_name = COALESCE(?, section_name)
      WHERE id = ? AND collection_id = ?
    `).run(
      req.body?.sortOrder == null ? null : Math.floor(normalizeNumber(req.body.sortOrder)),
      req.body?.score == null ? null : normalizeNumber(req.body.score),
      req.body?.sectionName == null ? null : String(req.body.sectionName || ''),
      relationId,
      id
    )
    refreshCollectionScore(id)
    res.json(getCollection(id))
  })

  app.delete('/api/question-bank/collections/:id/items/:relationId', (req, res) => {
    const id = decodeURIComponent(req.params.id)
    const relationId = decodeURIComponent(req.params.relationId)
    db.prepare('DELETE FROM question_bank_collection_items WHERE id = ? AND collection_id = ?').run(relationId, id)
    refreshCollectionScore(id)
    res.json(getCollection(id))
  })

  app.delete('/api/question-bank/collections/:id/items', (req, res) => {
    const id = decodeURIComponent(req.params.id)
    if (!collectionExists(id)) {
      res.status(404).json({ error: '试题篮不存在。' })
      return
    }
    db.prepare('DELETE FROM question_bank_collection_items WHERE collection_id = ?').run(id)
    refreshCollectionScore(id)
    res.json(getCollection(id))
  })

  app.patch('/api/question-bank/collections/:id/reorder', (req, res) => {
    const id = decodeURIComponent(req.params.id)
    if (!collectionExists(id)) {
      res.status(404).json({ error: '试题篮不存在。' })
      return
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    const update = db.prepare('UPDATE question_bank_collection_items SET sort_order = ? WHERE id = ? AND collection_id = ?')
    items.forEach((item: any, index: number) => {
      const relationId = String(item?.relationId || item?.id || '')
      if (!relationId) return
      update.run(item?.sortOrder == null ? index : Math.floor(normalizeNumber(item.sortOrder, index)), relationId, id)
    })
    db.prepare('UPDATE question_bank_collections SET updated_at = ? WHERE id = ?').run(nowIso(), id)
    res.json(getCollection(id))
  })

  app.post('/api/question-bank/collections/:id/export', (req, res) => {
    const id = decodeURIComponent(req.params.id)
    const collection = getCollection(id)
    if (!collection) {
      res.status(404).json({ error: '试题篮不存在。' })
      return
    }
    const variant = normalizeExportVariant(req.body?.variant)
    if (req.body?.format === 'pdf') {
      try {
        const template = req.body?.template === 'exam' ? 'exam' : 'worksheet'
        const pdfPath = exportCollectionWorksheetPdf(collection, variant, template === 'exam' ? 'qbank-exam' : 'qbank-worksheet')
        const relativePath = assetPathFor(pdfPath)
        const record = createExportRecord({
          sourceType: 'collection',
          collectionId: collection.id,
          title: collection.title,
          format: 'pdf',
          variant: `${template}-${variant}`,
          filename: path.basename(pdfPath),
          path: relativePath,
          url: `/assets/${relativePath}`,
          items: collectionExportItems(collection),
          contentLength: exportRecordFileSize(relativePath),
          questionCount: collection.questionCount,
        })
        res.json({
          filename: path.basename(pdfPath),
          format: 'pdf',
          url: `/assets/${relativePath}`,
          path: relativePath,
          exportRecord: mapExportRecord(record),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        res.status(500).json({ error: `练习单 PDF 导出失败：${message}` })
      }
      return
    }
    const format = normalizeExportFormat(req.body?.format || collection.exportFormat)
    const content = format === 'latex' ? buildCollectionLatex(collection, variant) : buildCollectionMarkdown(collection, variant)
    const extension = format === 'latex' ? 'tex' : 'md'
    const filename = `${safeName(collection.title || '试题篮')}-${variant}.${extension}`
    const record = createExportRecord({
      sourceType: 'collection',
      collectionId: collection.id,
      title: collection.title,
      format,
      variant,
      filename,
      items: collectionExportItems(collection),
      contentLength: Buffer.byteLength(content, 'utf8'),
      questionCount: collection.questionCount,
    })
    res.json({
      filename,
      format,
      content,
      exportRecord: mapExportRecord(record),
    })
  })
}

import { db } from './connection.js'
import type { CollectionRow, CollectionItemRow } from '../types/index.js'
import { nowIso } from '../utils/ids.js'
import { normalizeQuestionType, questionTypeOrder, collectionSectionNames } from '../utils/question-type.js'
import { mapQuestion } from './questions.js'

// ---------------------------------------------------------------------------
// mapCollectionSummary
// ---------------------------------------------------------------------------

export function mapCollectionSummary(row: CollectionRow, questionCount = 0) {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    kind: row.kind,
    status: row.status,
    totalScore: Number(row.total_score || 0),
    timeLimit: Number(row.time_limit || 0),
    exportFormat: row.export_format || 'markdown',
    questionCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---------------------------------------------------------------------------
// mapCollectionItem
// ---------------------------------------------------------------------------

export function mapCollectionItem(row: CollectionItemRow, sectionNames: Map<string, string>, previousSection: string) {
  const item = mapQuestion(row)
  const section = sectionNames.get(item.questionType) || ''
  const sectionName = section && section !== previousSection ? section : ''
  const newPreviousSection = section ? section : previousSection
  return {
    relationId: row.relation_id,
    sortOrder: row.sort_order,
    score: Number(row.score || 0),
    sectionName,
    item,
    _previousSection: newPreviousSection,
  }
}

// ---------------------------------------------------------------------------
// getCollection
// ---------------------------------------------------------------------------

export function getCollection(id: string) {
  const collection = db.prepare('SELECT * FROM question_bank_collections WHERE id = ?').get(id) as CollectionRow | undefined
  if (!collection) return null
  const rows = (db.prepare(`
    SELECT q.*, ci.id AS relation_id, ci.sort_order, ci.score, ci.section_name
    FROM question_bank_collection_items ci
    JOIN question_bank_items q ON q.id = ci.question_id
    WHERE ci.collection_id = ?
    ORDER BY ci.sort_order ASC, ci.created_at ASC
  `).all(id) as CollectionItemRow[])
    .sort((left, right) => {
      const leftGroup = questionTypeOrder(normalizeQuestionType(
        left.question_type,
        left.stem_markdown,
        left.answer_text,
      ))
      const rightGroup = questionTypeOrder(normalizeQuestionType(
        right.question_type,
        right.stem_markdown,
        right.answer_text,
      ))
      return leftGroup - rightGroup || left.sort_order - right.sort_order
    })
  const sectionNames = collectionSectionNames(rows)
  let previousSection = ''
  return {
    ...mapCollectionSummary(collection, rows.length),
    questionCount: rows.length,
    questions: rows.map((row) => {
      const item = mapQuestion(row)
      const section = sectionNames.get(item.questionType) || ''
      const sectionName = section && section !== previousSection ? section : ''
      if (section) previousSection = section
      return {
        relationId: row.relation_id,
        sortOrder: row.sort_order,
        score: Number(row.score || 0),
        sectionName,
        item,
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// getBasket
// ---------------------------------------------------------------------------

export function getBasket() {
  return getCollection('basket') ?? {
    id: 'basket',
    title: '试题篮',
    subtitle: '',
    description: '',
    kind: 'basket',
    status: 'draft',
    totalScore: 0,
    timeLimit: 0,
    exportFormat: 'markdown',
    questionCount: 0,
    createdAt: '',
    updatedAt: '',
    questions: [],
  }
}

// ---------------------------------------------------------------------------
// collectionExists
// ---------------------------------------------------------------------------

export function collectionExists(id: string) {
  return Boolean(db.prepare('SELECT id FROM question_bank_collections WHERE id = ?').get(id))
}

// ---------------------------------------------------------------------------
// refreshCollectionScore
// ---------------------------------------------------------------------------

export function refreshCollectionScore(id: string) {
  const row = db.prepare('SELECT COALESCE(SUM(score), 0) AS total FROM question_bank_collection_items WHERE collection_id = ?').get(id) as { total: number }
  db.prepare('UPDATE question_bank_collections SET total_score = ?, updated_at = ? WHERE id = ?').run(Number(row.total || 0), nowIso(), id)
}

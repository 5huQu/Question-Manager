import { db } from '../../db/connection.js'
import { getCollection, collectionExists, refreshCollectionScore, mapCollectionSummary } from '../../db/collections.js'
import type { CollectionRow } from '../../types/index.js'

type SqlValue = string | number | bigint | null | Buffer

export { getCollection, collectionExists, refreshCollectionScore }

export function listCollections() {
  const rows = db.prepare(`
    SELECT c.*, COUNT(ci.id) AS question_count
    FROM question_bank_collections c
    LEFT JOIN question_bank_collection_items ci ON ci.collection_id = c.id
    GROUP BY c.id
    ORDER BY CASE WHEN c.id = 'basket' THEN 0 ELSE 1 END, c.updated_at DESC
  `).all() as Array<CollectionRow & { question_count: number }>
  return { items: rows.map((row) => mapCollectionSummary(row, Number(row.question_count || 0))) }
}

export function insertCollection(values: SqlValue[]) {
  db.prepare(`
    INSERT INTO question_bank_collections
      (id, title, subtitle, description, kind, status, total_score, time_limit, export_format, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...values)
}

export function updateCollection(id: string, values: SqlValue[]) {
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
  `).run(...values, id)
}

export function updateCollectionWithMutations(
  id: string,
  values: SqlValue[],
  mutations: Array<{ type: 'add'; values: SqlValue[] } | { type: 'remove'; questionId: string }>,
) {
  try {
    db.exec('BEGIN')
    updateCollection(id, values)
    for (const mutation of mutations) {
      if (mutation.type === 'add') insertCollectionItem(mutation.values)
      else removeQuestionFromCollection(id, mutation.questionId)
    }
    if (mutations.length) refreshCollectionScore(id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function deleteCollection(id: string) {
  db.prepare('DELETE FROM question_bank_collections WHERE id = ?').run(id)
}

export function insertCollectionItem(values: SqlValue[]) {
  db.prepare(`
    INSERT OR IGNORE INTO question_bank_collection_items
      (id, collection_id, question_id, sort_order, score, section_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(...values)
}

export function insertCollectionItemAndRefresh(collectionId: string, values: SqlValue[]) {
  try {
    db.exec('BEGIN')
    insertCollectionItem(values)
    refreshCollectionScore(collectionId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function relationExists(relationId: string, collectionId: string) {
  return Boolean(db.prepare('SELECT id FROM question_bank_collection_items WHERE id = ? AND collection_id = ?').get(relationId, collectionId))
}

export function updateCollectionItem(collectionId: string, relationId: string, values: SqlValue[]) {
  db.prepare(`
    UPDATE question_bank_collection_items SET
      sort_order = COALESCE(?, sort_order),
      score = COALESCE(?, score),
      section_name = COALESCE(?, section_name)
    WHERE id = ? AND collection_id = ?
  `).run(...values, relationId, collectionId)
}

export function updateCollectionItemAndRefresh(collectionId: string, relationId: string, values: SqlValue[]) {
  try {
    db.exec('BEGIN')
    updateCollectionItem(collectionId, relationId, values)
    refreshCollectionScore(collectionId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function removeQuestionFromCollection(collectionId: string, questionId: string) {
  db.prepare('DELETE FROM question_bank_collection_items WHERE collection_id = ? AND question_id = ?').run(collectionId, questionId)
}

export function deleteCollectionItem(collectionId: string, relationId: string) {
  db.prepare('DELETE FROM question_bank_collection_items WHERE id = ? AND collection_id = ?').run(relationId, collectionId)
}

export function deleteCollectionItemAndRefresh(collectionId: string, relationId: string) {
  try {
    db.exec('BEGIN')
    deleteCollectionItem(collectionId, relationId)
    refreshCollectionScore(collectionId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function clearCollectionItems(collectionId: string) {
  db.prepare('DELETE FROM question_bank_collection_items WHERE collection_id = ?').run(collectionId)
}

export function clearCollectionItemsAndRefresh(collectionId: string) {
  try {
    db.exec('BEGIN')
    clearCollectionItems(collectionId)
    refreshCollectionScore(collectionId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function replaceCollectionItems(collectionId:string, items:Array<{id:string;questionId:string;sortOrder:number;score:number;sectionName:string;createdAt:string}>, title?:string){
  const insert=db.prepare('INSERT INTO question_bank_collection_items (id,collection_id,question_id,sort_order,score,section_name,created_at) VALUES (?,?,?,?,?,?,?)')
  try{db.exec('BEGIN');clearCollectionItems(collectionId);for(const item of items)insert.run(item.id,collectionId,item.questionId,item.sortOrder,item.score,item.sectionName,item.createdAt);if(title)db.prepare('UPDATE question_bank_collections SET title=?,updated_at=? WHERE id=?').run(title,new Date().toISOString(),collectionId);refreshCollectionScore(collectionId);db.exec('COMMIT')}
  catch(error){db.exec('ROLLBACK');throw error}
}

export function reorderCollectionItems(collectionId: string, items: Array<{ relationId: string; sortOrder: number }>, updatedAt: string) {
  const update = db.prepare('UPDATE question_bank_collection_items SET sort_order = ? WHERE id = ? AND collection_id = ?')
  try {
    db.exec('BEGIN')
    for (const item of items) update.run(item.sortOrder, item.relationId, collectionId)
    db.prepare('UPDATE question_bank_collections SET updated_at = ? WHERE id = ?').run(updatedAt, collectionId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

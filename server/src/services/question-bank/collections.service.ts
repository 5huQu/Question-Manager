import { getQuestion } from '../../db/questions.js'
import { nowIso, createId, safeName } from '../../utils/ids.js'
import { normalizeCollectionKind, normalizeCollectionStatus, normalizeExportFormat } from './collections.js'
import { normalizeNumber } from './export-records.js'
import { RouteError } from '../../utils/http-error.js'
import * as repo from '../../repositories/question-bank/collections.repo.js'
import { exportCollection as exportCollectionService } from './export.service.js'

export function listCollections() {
  return repo.listCollections()
}

export function createCollection(body: Record<string, any>) {
  const now = nowIso()
  const title = String(body?.title || '未命名试卷').trim() || '未命名试卷'
  const id = body?.id ? safeName(String(body.id)) : createId('paper', title)
  if (repo.collectionExists(id)) throw new RouteError(409, '同名试题篮已经存在。')
  repo.insertCollection([id, title, String(body?.subtitle || ''), String(body?.description || ''), normalizeCollectionKind(body?.kind), normalizeCollectionStatus(body?.status), normalizeNumber(body?.totalScore), Math.max(0, Math.floor(normalizeNumber(body?.timeLimit))), normalizeExportFormat(body?.exportFormat), now, now])
  return repo.getCollection(id)
}

export function getCollection(id: string) {
  const collection = repo.getCollection(id)
  if (!collection) throw new RouteError(404, '试题篮不存在。')
  return collection
}

function defaultScore(questionType: string, rawScore?: unknown) {
  let finalScore = normalizeNumber(rawScore)
  if (!finalScore) {
    if (questionType === '单选题') finalScore = 5
    else if (questionType === '填空题') finalScore = 5
    else if (questionType === '多选题') finalScore = 6
    else if (questionType === '解答题') finalScore = 15
    else finalScore = 5
  }
  return finalScore
}

export function updateCollection(id: string, body: Record<string, any>) {
  if (!repo.collectionExists(id)) throw new RouteError(404, '试题篮不存在。')
  const now = nowIso()
  const values = [
    body.title == null ? null : String(body.title || '').trim() || '未命名试卷',
    body.subtitle == null ? null : String(body.subtitle || ''),
    body.description == null ? null : String(body.description || ''),
    body.kind == null ? null : normalizeCollectionKind(body.kind),
    body.status == null ? null : normalizeCollectionStatus(body.status),
    body.timeLimit == null ? null : Math.max(0, Math.floor(normalizeNumber(body.timeLimit))),
    body.exportFormat == null ? null : normalizeExportFormat(body.exportFormat),
    now,
  ]
  const mutations: Array<{ type: 'add'; values: Array<string | number | bigint | null | Buffer> } | { type: 'remove'; questionId: string }> = []
  if (Array.isArray(body.addQuestionIds)) {
    for (const questionId of body.addQuestionIds.map(String)) {
      const q = getQuestion(questionId)
      if (!q) continue
      mutations.push({ type: 'add', values: [createId('rel'), id, questionId, Date.now(), defaultScore(q.questionType, body.score), String(body.sectionName || ''), nowIso()] })
    }
  }
  if (body.removeQuestionId) {
    mutations.push({ type: 'remove', questionId: String(body.removeQuestionId) })
  }
  repo.updateCollectionWithMutations(id, values, mutations)
  return repo.getCollection(id)
}

export function deleteCollection(id: string) {
  if (id === 'basket') throw new RouteError(400, '默认试题篮不能删除。')
  if (!repo.collectionExists(id)) throw new RouteError(404, '试题篮不存在。')
  repo.deleteCollection(id)
  return { deleted: true }
}

export function addCollectionItem(id: string, body: Record<string, any>) {
  const questionId = String(body?.questionId || '')
  if (!repo.collectionExists(id)) throw new RouteError(404, '试题篮不存在。')
  const q = getQuestion(questionId)
  if (!q) throw new RouteError(404, '题目不存在。')
  repo.insertCollectionItemAndRefresh(id, [createId('rel'), id, questionId, Math.floor(normalizeNumber(body?.sortOrder, Date.now())), defaultScore(q.questionType, body?.score), String(body?.sectionName || ''), nowIso()])
  return repo.getCollection(id)
}

export function updateCollectionItem(id: string, relationId: string, body: Record<string, any>) {
  if (!repo.collectionExists(id)) throw new RouteError(404, '试题篮不存在。')
  if (!repo.relationExists(relationId, id)) throw new RouteError(404, '试题篮题目不存在。')
  repo.updateCollectionItemAndRefresh(id, relationId, [body?.sortOrder == null ? null : Math.floor(normalizeNumber(body.sortOrder)), body?.score == null ? null : normalizeNumber(body.score), body?.sectionName == null ? null : String(body.sectionName || '')])
  return repo.getCollection(id)
}

export function deleteCollectionItem(id: string, relationId: string) {
  repo.deleteCollectionItemAndRefresh(id, relationId)
  return repo.getCollection(id)
}

export function clearCollectionItems(id: string) {
  if (!repo.collectionExists(id)) throw new RouteError(404, '试题篮不存在。')
  repo.clearCollectionItemsAndRefresh(id)
  return repo.getCollection(id)
}

export function reorderCollectionItems(id: string, body: Record<string, any>) {
  if (!repo.collectionExists(id)) throw new RouteError(404, '试题篮不存在。')
  const items = Array.isArray(body?.items) ? body.items : []
  repo.reorderCollectionItems(id, items.map((item: any, index: number) => ({ relationId: String(item?.relationId || item?.id || ''), sortOrder: item?.sortOrder == null ? index : Math.floor(normalizeNumber(item.sortOrder, index)) })).filter((item) => item.relationId), nowIso())
  return repo.getCollection(id)
}

export function exportCollection(id: string, body: Record<string, any>) {
  return exportCollectionService(getCollection(id), body)
}

import { db } from '../../../db/connection.js'
import { createQuestion, getQuestion } from '../../../db/questions.js'
import * as candidateRepo from '../../../repositories/question-candidates.repo.js'
import * as candidateFixRepo from '../../../repositories/candidate-fix-sessions.repo.js'
import type { QuestionCandidate } from '../../../types/question-candidate.js'
import { RouteError } from '../../../utils/http-error.js'
import { nowIso } from '../../../utils/ids.js'
import { difficultyLabel10, normalizeDifficultyScore10 } from '../../../utils/search.js'
import { inferQuestionType, normalizeQuestionType } from '../../../utils/question-type.js'
import { normalizeTags } from '../../tags/tag-libraries.js'
import { revalidateAllCandidatesForSourceDocument } from '../candidate-validation.service.js'
import { figuresForQuestionBank } from '../figure-mapping.js'
import { importJobContextForSource, maybeClassifyCommittedImportJobs, sourceTitle } from './source-metadata.js'
import { withImmediateTransaction } from './helpers.js'
import { cleanupOriginalPdfsForCompletedImportJob } from '../source-cleanup.service.js'

export async function commitQuestionCandidate(id: string, options: { skipAutoClassification?: boolean } = {}) {
  const candidate = candidateRepo.getQuestionCandidate(id)
  if (!candidate) throw new RouteError(404, '候选题不存在。')
  const importJobContext = importJobContextForSource(candidate.sourceDocumentId)
  if (candidate.status === 'committed') {
    if (importJobContext?.importJobId) cleanupOriginalPdfsForCompletedImportJob(importJobContext.importJobId)
    if (!candidate.committedQuestionId) {
      throw new RouteError(409, '候选题已标记为已入库，但缺少已入库题目 ID。')
    }
    const committedItem = getQuestion(candidate.committedQuestionId)
    if (!committedItem) {
      throw new RouteError(409, `候选题已标记为已入库，但题库中不存在对应题目（${candidate.committedQuestionId}）。`)
    }
    return { candidate, item: committedItem, classificationReports: null }
  }
  if (!candidate.stemMarkdown.trim()) throw new RouteError(400, '题干为空，不能入库。')
  const difficultyScore10 = normalizeDifficultyScore10(candidate.difficultyScore10)
  const inferredQuestionType = inferQuestionType(candidate.stemMarkdown, candidate.answerText, candidate.questionType || '解答题')
  const questionType = candidate.questionType === '单选题' && inferredQuestionType === '多选题'
    ? inferredQuestionType
    : normalizeQuestionType(candidate.questionType || inferredQuestionType, candidate.stemMarkdown, candidate.answerText)
  const { item, committedCandidate } = withImmediateTransaction(() => {
    const createdItem = createQuestion({
      questionNo: candidate.questionNo,
      questionType,
      difficultyScore: 0,
      difficultyScore10,
      difficultyLabel: candidate.difficultyLabel || difficultyLabel10(difficultyScore10),
      chapter: candidate.knowledgePoints[0] || '待整理',
      knowledgePoints: normalizeTags(candidate.knowledgePoints),
      solutionMethods: normalizeTags(candidate.solutionMethods),
      sourceTitle: importJobContext?.sourceTitle || sourceTitle(candidate.sourceDocumentId),
      province: candidate.province,
      city: candidate.city,
      paperTitle: candidate.paperTitle,
      batchName: candidate.batchName,
      stage: candidate.stage,
      subject: candidate.subject,
      paperKind: candidate.paperKind,
      examYear: candidate.examYear,
      sourceOrg: candidate.sourceOrg,
      importSourceId: importJobContext?.importSourceId || candidate.sourceDocumentId,
      importJobId: importJobContext?.importJobId || null,
      bankStatus: 'ready',
      stemMarkdown: candidate.stemMarkdown,
      answerText: candidate.answerText,
      analysisMarkdown: candidate.analysisMarkdown,
      figures: figuresForQuestionBank(candidate.figures),
      sourceRunId: '',
    })
    if (!createdItem) throw new RouteError(500, '入库失败。')
    const updatedCandidate = candidateRepo.updateQuestionCandidate(id, {
      status: 'committed',
      committedQuestionId: createdItem.id,
      committedAt: nowIso(),
    })
    if (!updatedCandidate) throw new RouteError(500, '题目已创建，但候选题入库状态更新失败。')
    return { item: createdItem, committedCandidate: updatedCandidate }
  })
  if (importJobContext?.importJobId) cleanupOriginalPdfsForCompletedImportJob(importJobContext.importJobId)
  const classificationReports = options.skipAutoClassification ? null : await maybeClassifyCommittedImportJobs([item])
  return { candidate: committedCandidate, item, classificationReports }
}

export async function commitQuestionCandidates(body: Record<string, unknown>) {
  const ids = Array.isArray(body.candidateIds) ? body.candidateIds.map(String) : []
  if (!ids.length) throw new RouteError(400, '请指定要入库的候选题。')
  const items = []
  const errors = []
  for (const id of ids) {
    try {
      items.push((await commitQuestionCandidate(id, { skipAutoClassification: true })).item)
    } catch (error) {
      errors.push({ id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  const classificationReports = await maybeClassifyCommittedImportJobs(items)
  return { success: items.length, failed: errors.length, items, errors, classificationReports }
}

export function skipQuestionCandidates(body: Record<string, unknown>) {
  const ids = Array.from(new Set(Array.isArray(body.candidateIds) ? body.candidateIds.map(String).filter(Boolean) : []))
  if (!ids.length) throw new RouteError(400, '请指定要跳过的候选题。')

  const candidates = ids.map((id) => {
    const candidate = candidateRepo.getQuestionCandidate(id)
    if (!candidate) throw new RouteError(404, `候选题不存在：${id}`)
    if (candidate.status === 'committed' || candidate.committedQuestionId) {
      throw new RouteError(409, `第 ${candidate.questionNo || '？'} 题已经入库，不能跳过。`)
    }
    return candidate
  })
  const sourceDocumentIds = new Set(candidates.map((candidate) => candidate.sourceDocumentId))

  withImmediateTransaction(() => {
    for (const candidate of candidates) {
      candidateFixRepo.deleteForCandidate(candidate.id)
      candidateRepo.deleteQuestionCandidate(candidate.id)
    }
  })

  for (const sourceDocumentId of sourceDocumentIds) {
    revalidateAllCandidatesForSourceDocument(sourceDocumentId)
  }
  return { success: ids.length, skippedIds: ids }
}

export function deleteQuestionCandidate(id: string) {
  const candidate = candidateRepo.getQuestionCandidate(id)
  if (!candidate) {
    throw new RouteError(404, '候选题不存在。')
  }

  const sourceDocumentId = candidate.sourceDocumentId

  db.exec('BEGIN IMMEDIATE')
  try {
    candidateFixRepo.deleteForCandidate(id)
    candidateRepo.deleteQuestionCandidate(id)
    db.exec('COMMIT')
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // ignore
    }
    throw error
  }

  revalidateAllCandidatesForSourceDocument(sourceDocumentId)

  return { success: true }
}

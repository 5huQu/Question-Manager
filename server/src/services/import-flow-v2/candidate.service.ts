import { db } from '../../db/connection.js'
import { createQuestion, getQuestion } from '../../db/questions.js'
import * as sourceRepo from '../../repositories/source-documents.repo.js'
import * as ocrRepo from '../../repositories/ocr-documents.repo.js'
import * as candidateRepo from '../../repositories/question-candidates.repo.js'
import type { CandidateIssue, QuestionCandidate, QuestionCandidateStatus, UpdateQuestionCandidateInput } from '../../types/question-candidate.js'
import { RouteError } from '../../utils/http-error.js'
import { nowIso } from '../../utils/ids.js'
import { difficultyLabel10, normalizeDifficultyScore10 } from '../../utils/search.js'
import { inferQuestionType, normalizeQuestionType } from '../../utils/question-type.js'
import { normalizeTags } from '../tags/tag-libraries.js'
import { parseQuestionCandidates } from '../question-parser/index.js'
import { statusForIssues, validateQuestionCandidate } from '../question-parser/candidate-validator.js'
import { revalidateAllCandidatesForSourceDocument } from '../pdf-slicer/annotations.service.js'
import { figuresForQuestionBank, getOcrFigureDiagnostics } from './figure-mapping.js'
import { loadOcrDocument } from './ocr-document.service.js'

const LIVE_VALIDATION_ISSUE_CODES = new Set<CandidateIssue['code']>([
  'missing_question_no',
  'duplicate_question_no',
  'missing_stem',
  'missing_answer',
  'missing_analysis',
])

function candidateStatusCounts(candidates: QuestionCandidate[]) {
  return {
    candidateCount: candidates.length,
    readyCount: candidates.filter((item) => item.status === 'ready').length,
    needsReviewCount: candidates.filter((item) => item.status === 'needs_review').length,
    needsManualFixCount: candidates.filter((item) => item.status === 'needs_manual_fix').length,
    blockedCount: candidates.filter((item) => item.status === 'blocked').length,
  }
}

function normalizeListLimit(value: unknown, fallback = 500) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(1, Math.min(1000, Math.floor(numeric)))
}

function normalizeListOffset(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.floor(numeric))
}

function normalizeCandidateStatus(value: unknown) {
  const status = String(value || '')
  return ['ready', 'needs_review', 'needs_manual_fix', 'blocked', 'committed'].includes(status)
    ? status as QuestionCandidateStatus
    : undefined
}

function liveValidateCandidates(candidates: QuestionCandidate[]) {
  const counts = new Map<string, number>()
  for (const candidate of candidates) {
    if (candidate.status === 'committed') continue
    const questionNo = candidate.questionNo.trim()
    if (!questionNo) continue
    counts.set(questionNo, (counts.get(questionNo) || 0) + 1)
  }

  const duplicateQuestionNos = new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([questionNo]) => questionNo),
  )

  return candidates.map((candidate) => {
    if (candidate.status === 'committed') return candidate
    const baseIssues = candidate.issues.filter((issue) => !LIVE_VALIDATION_ISSUE_CODES.has(issue.code))
    const issues = validateQuestionCandidate({ ...candidate, issues: baseIssues }, duplicateQuestionNos)
    return { ...candidate, issues, status: statusForIssues(issues) }
  })
}

function sourceTitle(sourceDocumentId: string) {
  const source = sourceRepo.getSourceDocument(sourceDocumentId)
  return source?.paperTitle || source?.title || source?.originalFileName || '资料导入 v2'
}

function importJobContextForSource(sourceDocumentId: string) {
  const row = db.prepare(`
    SELECT j.id, j.title, j.paper_title
    FROM import_jobs j
    JOIN import_job_documents d ON d.job_id = j.id
    WHERE d.source_document_id = ?
      AND j.status IN ('parsed', 'partially_parsed')
    ORDER BY j.updated_at DESC, j.created_at DESC
    LIMIT 1
  `).get(sourceDocumentId) as { id: string; title: string; paper_title: string } | undefined
  if (!row) return null
  const sourceId = `ifv2-job:${row.id}`
  return {
    importSourceId: sourceId,
    sourceRunId: sourceId,
    sourceTitle: row.paper_title || row.title || sourceTitle(sourceDocumentId),
  }
}

function sourceMetadata(sourceDocumentId: string) {
  const source = sourceRepo.getSourceDocument(sourceDocumentId)
  return source ? {
    province: source.province,
    city: source.city,
    paperTitle: source.paperTitle,
    batchName: source.batchName,
    stage: source.stage,
    subject: source.subject,
    paperKind: source.paperKind,
    examYear: source.examYear,
    sourceOrg: source.sourceOrg,
  } : {}
}

export function parseCandidatesForOcrDocument(id: string) {
  const document = loadOcrDocument(id)
  const candidates = parseQuestionCandidates(document)
  const metadata = sourceMetadata(document.sourceDocumentId)
  candidateRepo.deleteQuestionCandidatesForOcrDocument(id)
  const saved = candidates.map((candidate) => candidateRepo.createQuestionCandidate({ ...candidate, ...metadata })).filter(Boolean) as QuestionCandidate[]
  revalidateAllCandidatesForSourceDocument(document.sourceDocumentId)
  const finalCandidates = liveValidateCandidates(candidateRepo.listQuestionCandidates({ sourceDocumentId: document.sourceDocumentId }))
  sourceRepo.updateSourceDocument(document.sourceDocumentId, { status: saved.some((item) => item.status !== 'ready') ? 'partially_parsed' : 'parsed' })
  return { ...candidateStatusCounts(finalCandidates), items: finalCandidates, diagnostics: getOcrFigureDiagnostics(id, finalCandidates) }
}

export function listQuestionCandidatesForSource(sourceDocumentId: string, query: Record<string, unknown>) {
  if (!sourceRepo.getSourceDocument(sourceDocumentId)) throw new RouteError(404, '资料不存在。')
  const status = normalizeCandidateStatus(query.status)
  const limit = normalizeListLimit(query.limit)
  const offset = normalizeListOffset(query.offset)
  const allCandidates = liveValidateCandidates(candidateRepo.listQuestionCandidates({ sourceDocumentId, limit: 1000, offset: 0 }))
  const matchingCandidates = status ? allCandidates.filter((candidate) => candidate.status === status) : allCandidates
  const candidates = matchingCandidates.slice(offset, offset + limit)
  const [ocrDocument] = ocrRepo.listOcrDocuments({ sourceDocumentId, limit: 1 })
  const diagnostics = ocrDocument ? getOcrFigureDiagnostics(ocrDocument.id, candidates) : undefined
  return {
    items: candidates,
    diagnostics,
  }
}

export function updateQuestionCandidate(id: string, body: Record<string, unknown>) {
  const patch = (body.candidate || body) as UpdateQuestionCandidateInput
  const updated = candidateRepo.updateQuestionCandidate(id, patch)
  if (!updated) throw new RouteError(404, '候选题不存在。')
  revalidateAllCandidatesForSourceDocument(updated.sourceDocumentId)
  const finalUpdated = candidateRepo.getQuestionCandidate(id)
  if (!finalUpdated) throw new RouteError(404, '候选题不存在。')
  return { candidate: finalUpdated }
}

export function commitQuestionCandidate(id: string) {
  const candidate = candidateRepo.getQuestionCandidate(id)
  if (!candidate) throw new RouteError(404, '候选题不存在。')
  if (candidate.status === 'committed') {
    if (!candidate.committedQuestionId) {
      throw new RouteError(409, '候选题已标记为已入库，但缺少已入库题目 ID。')
    }
    const committedItem = getQuestion(candidate.committedQuestionId)
    if (!committedItem) {
      throw new RouteError(409, `候选题已标记为已入库，但题库中不存在对应题目（${candidate.committedQuestionId}）。`)
    }
    return { candidate, item: committedItem }
  }
  if (!candidate.stemMarkdown.trim()) throw new RouteError(400, '题干为空，不能入库。')
  const difficultyScore10 = normalizeDifficultyScore10(candidate.difficultyScore10)
  const importJobContext = importJobContextForSource(candidate.sourceDocumentId)
  const item = createQuestion({
    questionNo: candidate.questionNo,
    questionType: normalizeQuestionType(candidate.questionType || inferQuestionType(candidate.stemMarkdown, candidate.answerText), candidate.stemMarkdown, candidate.answerText),
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
    bankStatus: 'ready',
    stemMarkdown: candidate.stemMarkdown,
    answerText: candidate.answerText,
    analysisMarkdown: candidate.analysisMarkdown,
    figures: figuresForQuestionBank(candidate.figures),
    sourceRunId: importJobContext?.sourceRunId || `ifv2:${candidate.sourceDocumentId}`,
  })
  if (!item) throw new RouteError(500, '入库失败。')
  const committedCandidate = candidateRepo.updateQuestionCandidate(id, {
    status: 'committed',
    committedQuestionId: item.id,
    committedAt: nowIso(),
  })
  if (!committedCandidate) throw new RouteError(500, '题目已创建，但候选题入库状态更新失败。')
  return { candidate: committedCandidate, item }
}

export function commitQuestionCandidates(body: Record<string, unknown>) {
  const ids = Array.isArray(body.candidateIds) ? body.candidateIds.map(String) : []
  if (!ids.length) throw new RouteError(400, '请指定要入库的候选题。')
  const items = []
  const errors = []
  for (const id of ids) {
    try {
      items.push(commitQuestionCandidate(id).item)
    } catch (error) {
      errors.push({ id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { success: items.length, failed: errors.length, items, errors }
}

export function deleteQuestionCandidate(id: string) {
  const candidate = candidateRepo.getQuestionCandidate(id)
  if (!candidate) {
    throw new RouteError(404, '候选题不存在。')
  }

  const sessionId = `sess_candidate_${id}`
  const sourceDocumentId = candidate.sourceDocumentId

  db.exec('BEGIN IMMEDIATE')
  try {
    // 删除该候选题关联的手动修正标注选区与会话
    db.prepare('DELETE FROM pdf_slicer_annotation_regions WHERE session_id = ?').run(sessionId)
    db.prepare('DELETE FROM pdf_slicer_annotation_sessions WHERE id = ?').run(sessionId)
    // 删除候选题本身
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

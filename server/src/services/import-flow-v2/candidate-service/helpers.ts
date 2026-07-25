import { db } from '../../../db/connection.js'
import type { QuestionCandidate, QuestionCandidateStatus } from '../../../types/question-candidate.js'
import {
  LIVE_VALIDATION_ISSUE_CODES,
  refreshCandidateParseDiagnostics,
  statusForIssues,
  validateQuestionCandidate,
} from '../../question-parser/candidate-validator.js'
import { figureForBlock } from '../../question-parser/figure-linker.js'
import { loadOcrDocument } from '../ocr-document.service.js'

export function candidateStatusCounts(candidates: QuestionCandidate[]) {
  return {
    candidateCount: candidates.length,
    readyCount: candidates.filter((item) => item.status === 'ready').length,
    needsReviewCount: candidates.filter((item) => item.status === 'needs_review').length,
    needsManualFixCount: candidates.filter((item) => item.status === 'needs_manual_fix').length,
    blockedCount: candidates.filter((item) => item.status === 'blocked').length,
  }
}

export function withImmediateTransaction<T>(operation: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = operation()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // Preserve the original failure if rollback itself cannot run.
    }
    throw error
  }
}

export function normalizeListLimit(value: unknown, fallback = 500) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(1, Math.min(1000, Math.floor(numeric)))
}

export function normalizeListOffset(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.floor(numeric))
}

export function normalizeCandidateStatus(value: unknown) {
  const status = String(value || '')
  return ['ready', 'needs_review', 'needs_manual_fix', 'blocked', 'committed'].includes(status)
    ? status as QuestionCandidateStatus
    : undefined
}

export function liveValidateCandidates(candidates: QuestionCandidate[]) {
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
    return {
      ...candidate,
      issues,
      parseDiagnostics: refreshCandidateParseDiagnostics(candidate, issues),
      status: statusForIssues(issues),
    }
  })
}

export function enrichUnplacedFigureIssues(candidates: QuestionCandidate[]) {
  const documents = new Map<string, ReturnType<typeof loadOcrDocument>>()
  return candidates.map((candidate) => {
    const needsFigureLookup = candidate.issues.some((issue) =>
      issue.code === 'unplaced_figure'
      && issue.relatedBlockIds?.length
      && !issue.relatedFigures?.some((figure) => figure.path),
    )
    if (!needsFigureLookup || !candidate.ocrDocumentId) return candidate

    let document = documents.get(candidate.ocrDocumentId)
    if (!document) {
      document = loadOcrDocument(candidate.ocrDocumentId)
      documents.set(candidate.ocrDocumentId, document)
    }
    const blocks = new Map(document.pages.flatMap((page) => page.blocks).map((block) => [block.id, block]))
    const issues = candidate.issues.map((issue) => {
      if (issue.code !== 'unplaced_figure' || issue.relatedFigures?.some((figure) => figure.path)) return issue
      const relatedFigures = (issue.relatedBlockIds || [])
        .flatMap((blockId) => {
          const block = blocks.get(blockId)
          return block ? figureForBlock(document!, block, 'unknown') || [] : []
        })
      return relatedFigures.length ? { ...issue, relatedFigures } : issue
    })
    return { ...candidate, issues }
  })
}

import * as candidateRepo from '../../repositories/question-candidates.repo.js'
import { LIVE_VALIDATION_ISSUE_CODES, refreshCandidateParseDiagnostics, statusForIssues, validateQuestionCandidate } from '../question-parser/candidate-validator.js'

export function revalidateAllCandidatesForSourceDocument(sourceDocumentId: string) {
  const candidates = candidateRepo.listQuestionCandidates({ sourceDocumentId })
  const counts = new Map<string, number>()
  for (const candidate of candidates) {
    if (candidate.status === 'committed' || !candidate.questionNo.trim()) continue
    counts.set(candidate.questionNo.trim(), (counts.get(candidate.questionNo.trim()) || 0) + 1)
  }
  const duplicateNos = new Set([...counts].filter(([, count]) => count > 1).map(([questionNo]) => questionNo))
  for (const candidate of candidates) {
    if (candidate.status === 'committed') continue
    const baseIssues = candidate.issues.filter((issue) => !LIVE_VALIDATION_ISSUE_CODES.has(issue.code))
    const nextIssues = validateQuestionCandidate({ ...candidate, issues: baseIssues }, duplicateNos)
    const nextStatus = statusForIssues(nextIssues)
    const nextParseDiagnostics = refreshCandidateParseDiagnostics(candidate, nextIssues)
    if (JSON.stringify(nextIssues) !== JSON.stringify(candidate.issues) || JSON.stringify(nextParseDiagnostics) !== JSON.stringify(candidate.parseDiagnostics) || nextStatus !== candidate.status) {
      candidateRepo.updateQuestionCandidate(candidate.id, { issues: nextIssues, parseDiagnostics: nextParseDiagnostics, status: nextStatus })
    }
  }
}

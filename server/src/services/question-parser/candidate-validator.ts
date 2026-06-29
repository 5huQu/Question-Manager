import type { CandidateIssue, CandidateParseDiagnostic, QuestionCandidate, QuestionCandidateStatus } from '../../types/question-candidate.js'

export const LIVE_VALIDATION_ISSUE_CODES = new Set<CandidateIssue['code']>([
  'missing_question_no',
  'duplicate_question_no',
  'missing_stem',
  'missing_answer',
  'missing_analysis',
])

function issue(code: CandidateIssue['code'], severity: CandidateIssue['severity'], message: string): CandidateIssue {
  return { code, severity, message }
}

export function validateQuestionCandidate(candidate: QuestionCandidate, duplicateQuestionNos: Set<string>): CandidateIssue[] {
  const issues: CandidateIssue[] = [...candidate.issues]
  if (!candidate.questionNo.trim()) {
    issues.push(issue('missing_question_no', 'error', '未识别到题号。'))
  }
  if (candidate.questionNo && duplicateQuestionNos.has(candidate.questionNo)) {
    issues.push(issue('duplicate_question_no', 'error', '同一份资料中识别到重复题号。'))
  }
  if (!candidate.stemMarkdown.trim()) {
    issues.push(issue('missing_stem', 'error', '题干为空，需要人工修正。'))
  }
  if (!candidate.answerText.trim() && !candidate.analysisMarkdown.trim()) {
    issues.push(issue('missing_answer', 'warning', '未匹配到答案。'))
  }
  if (!candidate.analysisMarkdown.trim()) {
    issues.push(issue('missing_analysis', 'warning', '未匹配到解析。'))
  }
  return issues
}

export function statusForIssues(issues: CandidateIssue[]): QuestionCandidateStatus {
  if (issues.some((item) => item.severity === 'error')) return 'needs_manual_fix'
  if (issues.length) return 'needs_review'
  return 'ready'
}

export function validationIssueDiagnostics(
  candidate: Pick<QuestionCandidate, 'questionNo'>,
  issues: CandidateIssue[],
): CandidateParseDiagnostic[] {
  return issues.map((item) => ({
    code: item.code,
    severity: item.severity,
    questionNo: candidate.questionNo,
    message: item.message,
  }))
}

function strategySnapshot(candidate: Pick<QuestionCandidate, 'parserConfigSnapshot'>) {
  const value = candidate.parserConfigSnapshot?.solutionBindingStrategy
  return typeof value === 'string' ? value : ''
}

function isStaleParseDiagnostic(candidate: QuestionCandidate, diagnostic: CandidateParseDiagnostic) {
  if (LIVE_VALIDATION_ISSUE_CODES.has(diagnostic.code as CandidateIssue['code'])) return true
  const isStrategySuggestion = diagnostic.code === 'question_before_solution_heading' || diagnostic.code === 'solution_heading_without_following_question'
  if (isStrategySuggestion && (candidate.answerText.trim() || candidate.analysisMarkdown.trim())) return true
  if (
    strategySnapshot(candidate) === 'question_then_heading'
    && isStrategySuggestion
  ) {
    return true
  }
  return false
}

export function refreshCandidateParseDiagnostics(
  candidate: QuestionCandidate,
  issues: CandidateIssue[] = candidate.issues,
): CandidateParseDiagnostic[] {
  const diagnostics = [
    ...(candidate.parseDiagnostics || []).filter((item) => !isStaleParseDiagnostic(candidate, item)),
    ...validationIssueDiagnostics(candidate, issues),
  ]
  return Array.from(new Map(diagnostics.map((item) => [`${item.code}:${item.message}:${item.start ?? ''}:${item.end ?? ''}`, item])).values())
}

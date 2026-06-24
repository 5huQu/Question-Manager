import type { CandidateIssue, QuestionCandidate, QuestionCandidateStatus } from '../../types/question-candidate.js'

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
  if (!candidate.answerText.trim()) {
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

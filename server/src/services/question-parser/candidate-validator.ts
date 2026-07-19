import type { CandidateIssue, CandidateParseDiagnostic, QuestionCandidate, QuestionCandidateStatus } from '../../types/question-candidate.js'

export const LIVE_VALIDATION_ISSUE_CODES = new Set<CandidateIssue['code']>([
  'missing_question_no',
  'duplicate_question_no',
  'missing_stem',
  'missing_answer',
  'missing_analysis',
  'possible_cross_page',
  'possible_presentation_noise',
])

// These diagnostics are mirrors of candidate issues rather than independent
// parser findings. Always rebuild them from the current issue list so a
// resolved review action cannot leave a stale warning behind.
const ISSUE_MIRRORED_DIAGNOSTIC_CODES = new Set<CandidateIssue['code']>([
  'unplaced_figure',
])

function issue(code: CandidateIssue['code'], severity: CandidateIssue['severity'], message: string): CandidateIssue {
  return { code, severity, message }
}

const RESIDUAL_PRESENTATION_LINE_RE = /^(?:#{1,6}\s*)?(?:第\s*(?:I{1,4}|IV|V|[一二三四五六七八九十]+)\s*卷|第\s*[0-9０-９]+\s*页\s*[,，、/／]?\s*共\s*[0-9０-９]+\s*页|[一二三四五六七八九十百千万]+[、.．](?:(?:单项|多项|单选|多选|非)?选择题|填空题|解答题|计算题|实验题|选做题)|.*(?:答题卡上作答|画在试卷上无效))/i

function hasResidualPresentationNoise(value: string) {
  return String(value || '').split(/\r?\n/).some((line) => RESIDUAL_PRESENTATION_LINE_RE.test(line.trim()))
}

function hasLikelyTruncatedEnding(value: string) {
  const visible = String(value || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!visible || /[。！？；;：:?？）)】\]”"』」]$/.test(visible)) return false
  return /(?:需要将|应将|将|使|与|和|或|由|在|为|调)$/.test(visible)
}

export function validateQuestionCandidate(candidate: QuestionCandidate, duplicateQuestionNos: Set<string>): CandidateIssue[] {
  const issues: CandidateIssue[] = [...candidate.issues]
  const isLecture = candidate.paperKind === 'lecture'
  if (!isLecture && !candidate.questionNo.trim()) {
    issues.push(issue('missing_question_no', 'error', '未识别到题号。'))
  }
  if (!isLecture && candidate.questionNo && duplicateQuestionNos.has(candidate.questionNo)) {
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
  if ([candidate.stemMarkdown, candidate.answerText, candidate.analysisMarkdown].some(hasResidualPresentationNoise)) {
    issues.push(issue('possible_presentation_noise', 'warning', '检测到疑似页码、卷别、题型标题或答题说明，请人工复核。'))
  }
  if (hasLikelyTruncatedEnding(candidate.stemMarkdown)) {
    issues.push(issue('possible_cross_page', 'warning', '题干结尾疑似被分页或分区标题截断，请对照原文复核。'))
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
  if (ISSUE_MIRRORED_DIAGNOSTIC_CODES.has(diagnostic.code as CandidateIssue['code'])) return true
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

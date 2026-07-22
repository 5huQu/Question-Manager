import { questionReviewState, type UnifiedQuestion } from './importV2PageModel'

export type CandidateReviewTab = 'all' | 'ready' | 'warning' | 'error'

export function buildCandidateReviewModel(input: {
  questions: UnifiedQuestion[]
  activeQuestionId: string | null
  activeTab: CandidateReviewTab
  activeDiagnosticCode: string
  committedIds: Set<string>
}) {
  const { questions, activeQuestionId, activeTab, activeDiagnosticCode, committedIds } = input
  const activeQuestion = questions.find((question) => question.id === activeQuestionId) || null
  const issueCodes = new Set((activeQuestion?.issues || []).map((issue) => issue.code).filter(Boolean))
  const visibleActiveParseDiagnostics = (activeQuestion?.parseDiagnostics || [])
    .filter((diagnostic) => !issueCodes.has(diagnostic.code))
  const filteredQuestions = questions.filter((question) => {
    if (activeDiagnosticCode && !question.parseDiagnostics.some((diagnostic) => diagnostic.code === activeDiagnosticCode)) return false
    if (activeTab === 'ready') return question.status === 'ready' && question.issues.length === 0
    if (activeTab === 'warning') return question.issues.some((issue) => issue.severity === 'warning') || Boolean(question.similarQuestions?.length)
    if (activeTab === 'error') {
      return question.status === 'blocked' || question.status === 'needs_manual_fix'
        || question.issues.some((issue) => issue.severity === 'error')
    }
    return true
  })
  const diagnosticMap = new Map<string, { code: string; count: number; severity: 'info' | 'warning' | 'error' }>()
  for (const question of questions) {
    const seen = new Set<string>()
    for (const diagnostic of question.parseDiagnostics || []) {
      if (!diagnostic.code || seen.has(diagnostic.code)) continue
      seen.add(diagnostic.code)
      const current = diagnosticMap.get(diagnostic.code) || { code: diagnostic.code, count: 0, severity: diagnostic.severity }
      current.count += 1
      if (diagnostic.severity === 'error' || (diagnostic.severity === 'warning' && current.severity === 'info')) current.severity = diagnostic.severity
      diagnosticMap.set(diagnostic.code, current)
    }
  }
  const severityOrder = { error: 0, warning: 1, info: 2 }
  const parseDiagnosticCounts = Array.from(diagnosticMap.values()).sort((left, right) =>
    severityOrder[left.severity] - severityOrder[right.severity] || right.count - left.count || left.code.localeCompare(right.code))
  const reviewTabs = [
    { key: 'all' as const, label: '全部', count: questions.length },
    { key: 'ready' as const, label: '可以入库', count: questions.filter((question) => question.status === 'ready' && question.issues.length === 0).length },
    { key: 'warning' as const, label: '建议核对', count: questions.filter((question) => question.issues.some((issue) => issue.severity === 'warning') || Boolean(question.similarQuestions?.length)).length },
    { key: 'error' as const, label: '需要修正', count: questions.filter((question) => question.status === 'blocked' || question.status === 'needs_manual_fix' || question.issues.some((issue) => issue.severity === 'error')).length },
  ]
  const committedQuestionCount = questions.filter((question) => question.status === 'committed' || committedIds.has(question.id)).length
  const activeQuestionCommitted = Boolean(activeQuestion && (activeQuestion.status === 'committed' || committedIds.has(activeQuestion.id)))
  const selectableList = filteredQuestions.filter((question) => question.status !== 'committed' && !committedIds.has(question.id))

  return {
    activeQuestion,
    activeQuestionCommitted,
    activeQuestionReviewState: activeQuestion ? questionReviewState(activeQuestion, activeQuestionCommitted) : null,
    committedQuestionCount,
    filteredQuestions,
    parseDiagnosticCounts,
    reviewTabs,
    selectableList,
    visibleActiveParseDiagnostics,
  }
}

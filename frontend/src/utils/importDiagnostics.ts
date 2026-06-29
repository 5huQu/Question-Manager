const ISSUE_LABELS: Record<string, string> = {
  duplicate_question_no: '重复题号',
  unplaced_figure: '图片待核对',
  missing_answer: '缺少答案',
  missing_analysis: '缺少解析',
  missing_solution: '缺少解析文档匹配',
  solution_conflict: '解析冲突',
  unmatched_solution: '多余解析',
}

const PARSER_DIAGNOSTIC_LABELS: Record<string, string> = {
  solution_heading_without_following_question: '解析标题后无题号',
  question_before_solution_heading: '题号位置异常',
  metadata_used_as_answer: '说明误作答案',
  table_answer_blocked_by_existing_answer: '答案表未覆盖',
  missing_analysis: '缺少解析',
  unmatched_solution: '多余解析',
}

export function importIssueLabel(code?: string) {
  return ISSUE_LABELS[code || ''] || ''
}

export function parserDiagnosticLabel(code?: string) {
  return PARSER_DIAGNOSTIC_LABELS[code || ''] || importIssueLabel(code) || '结构异常'
}

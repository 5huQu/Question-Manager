import { parseJson } from '../../utils/json.js'

type FormatIssue = {
  field: string
  code: string
  message: string
  snippet: string
  context?: string
  mode?: string
  start?: number
  end?: number
}

export function formatIssueFromReviewJson(value = ''): FormatIssue | undefined {
  const payload = parseJson<Record<string, any>>(value || '{}', {})
  const issue = payload.issue
  if (issue && typeof issue === 'object') {
    return {
      field: String(issue.field || 'system'),
      code: String(issue.code || 'format_error'),
      message: String(issue.message || ''),
      snippet: String(issue.snippet || ''),
      context: String(issue.context || issue.snippet || ''),
      mode: issue.mode ? String(issue.mode) : undefined,
      start: Number.isFinite(Number(issue.start)) ? Number(issue.start) : undefined,
      end: Number.isFinite(Number(issue.end)) ? Number(issue.end) : undefined,
    }
  }
  return undefined
}

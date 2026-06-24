export type QuestionNumberMatch = {
  questionNo: string
  raw: string
  start: number
  contentStart: number
  lineStart: number
}

const QUESTION_NUMBER_RE = /(^|\n)([ \t]*(?:#{1,6}\s*)?(?:(?:第\s*([0-9０-９]{1,3})\s*题)|(?:[（(]\s*([0-9０-９]{1,3})\s*[)）])|(?:([0-9０-９]{1,3})\s*[.．、])))/g

function normalizeDigits(value: string) {
  return value.replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - '０'.charCodeAt(0)))
}

export function normalizeDetectedQuestionNo(value: unknown) {
  const normalized = normalizeDigits(String(value || ''))
    .replace(/^\s*第\s*/, '')
    .replace(/\s*题\s*$/, '')
    .replace(/[（()）.．、:：\s]/g, '')
  const parsed = Number.parseInt(normalized, 10)
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : normalized
}

export function detectQuestionNumbers(markdown: string): QuestionNumberMatch[] {
  const matches: QuestionNumberMatch[] = []
  const source = String(markdown || '')
  QUESTION_NUMBER_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = QUESTION_NUMBER_RE.exec(source))) {
    const marker = match[2] || ''
    const rawNo = match[3] || match[4] || match[5] || ''
    const questionNo = normalizeDetectedQuestionNo(rawNo)
    const lineStart = match.index + (match[1] || '').length
    matches.push({
      questionNo,
      raw: marker.trim(),
      start: lineStart,
      contentStart: lineStart + marker.length,
      lineStart,
    })
  }
  return matches
}

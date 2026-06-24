import { detectQuestionNumbers, type QuestionNumberMatch } from './question-number-detector.js'

export type QuestionMarkdownChunk = {
  questionNo: string
  rawMarker: string
  start: number
  contentStart: number
  end: number
  raw: string
  body: string
}

export function splitMarkdownByQuestionNumbers(markdown: string, matches: QuestionNumberMatch[] = detectQuestionNumbers(markdown)): QuestionMarkdownChunk[] {
  const source = String(markdown || '')
  return matches.map((match, index) => {
    const end = index + 1 < matches.length ? matches[index + 1].start : source.length
    const raw = source.slice(match.start, end).trim()
    const body = source.slice(match.contentStart, end).trim()
    return {
      questionNo: match.questionNo,
      rawMarker: match.raw,
      start: match.start,
      contentStart: match.contentStart,
      end,
      raw,
      body,
    }
  })
}

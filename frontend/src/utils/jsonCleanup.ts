import type { ParagraphRichBlock, QuestionItem, RichBlock, RichInline } from '@/types'
import { richBlocksPlainText } from '@/components/RichContent'

export function paragraphBlocksFromText(value: string): RichBlock[] {
  return String(value || '').trim()
    ? String(value || '').split(/\n{2,}/).map((part) => ({ type: 'paragraph' as const, content: inlineBlocksFromText(part.trim()) }))
    : []
}

export function inlineBlocksFromText(text: string): ParagraphRichBlock['content'] {
  const content: RichInline[] = []
  let cursor = 0
  while (cursor < text.length) {
    const start = text.indexOf('$', cursor)
    if (start < 0) {
      if (cursor < text.length) content.push({ type: 'text', text: text.slice(cursor) })
      break
    }
    if (start > cursor) content.push({ type: 'text', text: text.slice(cursor, start) })
    const end = text.indexOf('$', start + 1)
    if (end < 0) {
      content.push({ type: 'text', text: text.slice(start) })
      break
    }
    const tex = text.slice(start + 1, end).trim()
    if (tex) content.push({ type: 'inline_math', tex })
    else content.push({ type: 'text', text: text.slice(start, end + 1) })
    cursor = end + 1
  }
  return content.filter((inline) => inline.type !== 'text' || inline.text)
}

export function draftProblemText(draft: Partial<QuestionItem>) {
  return String(draft.stemMarkdown ?? richBlocksPlainText(draft.problemBlocks ?? []))
}

export function draftAnswerText(draft: Partial<QuestionItem>) {
  return String(draft.answerText ?? richBlocksPlainText(draft.answerBlocks ?? []))
}

export function draftAnalysisText(draft: Partial<QuestionItem>) {
  return String(draft.analysisMarkdown ?? richBlocksPlainText(draft.analysisBlocks ?? []))
}

export function getTextLocation(text: string, position: number) {
  const safePosition = Math.max(0, Math.min(position, text.length))
  const before = text.slice(0, safePosition)
  const line = before.split('\n').length
  const column = before.split('\n').at(-1)!.length + 1
  const lineText = text.split('\n')[line - 1] || ''
  return { line, column, lineText }
}

export function jsonErrorPosition(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : 'JSON 语法错误'
  const position = rawMessage.match(/position (\d+)/)?.[1]
  return { rawMessage, position: position ? Number(position) : null }
}

export function buildJsonParseHint(rawMessage: string, text: string, position: number | null) {
  if (position == null) return rawMessage
  const { line, column, lineText } = getTextLocation(text, position)
  const suspicious = lineText.slice(Math.max(0, column - 8), column + 16).match(/\\[^\\"/bfnrtu]/)?.[0]
  const hint = suspicious
    ? `附近疑似非法反斜杠 ${suspicious}；如果这是 LaTeX 命令，请写成 ${suspicious.replace('\\', '\\\\')}。`
    : '请检查该位置附近是否存在未转义的反斜杠、引号或多余逗号。'
  return `第 ${line} 行第 ${column} 列：${hint} 原始错误：${rawMessage}`
}

export function formatJsonParseError(error: unknown, text: string) {
  const { rawMessage, position } = jsonErrorPosition(error)
  return buildJsonParseHint(rawMessage, text, position)
}

export function jsonErrorSnippet(text: string, position: number | null) {
  if (position == null) return null
  const { line, column } = getTextLocation(text, position)
  const lines = text.split('\n')
  const startLine = Math.max(1, line - 2)
  const endLine = Math.min(lines.length, line + 2)
  return {
    line,
    column,
    rows: lines.slice(startLine - 1, endLine).map((content, index) => ({
      line: startLine + index,
      content,
      active: startLine + index === line,
    })),
  }
}

export function questionsFromPayload(payload: unknown) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.questions)) return record.questions
    const hasQuestionShape = ['problem_text', 'problemText', 'stemMarkdown', 'answer', 'answerText', 'analysis', 'analysisMarkdown', 'analysisText']
      .some((key) => record[key] != null)
    if (hasQuestionShape) return [payload]
  }
  return []
}

export function questionField(question: unknown, keys: string[]) {
  if (!question || typeof question !== 'object') return ''
  const record = question as Record<string, unknown>
  for (const key of keys) {
    if (record[key] != null) return String(record[key])
  }
  return ''
}

type PaperQuestionPreview = {
  index: number
  questionNo: string
  problemText: string
  answerText: string
  analysisText: string
  needsHumanReview: boolean
  issues: string[]
}

export function buildPaperQuestionPreview(question: unknown, index: number): PaperQuestionPreview {
  const questionNo = questionField(question, ['question_no', 'questionNo']) || String(index + 1)
  const problemText = questionField(question, ['problem_text', 'stemMarkdown', 'problemText'])
  const answerText = questionField(question, ['answer', 'answerText'])
  const analysisText = questionField(question, ['analysis', 'analysisMarkdown', 'analysisText'])
  const needsHumanReview = Boolean(question && typeof question === 'object' && (question as Record<string, unknown>).needs_human_review)
  const issues: string[] = []
  if (!problemText.trim()) issues.push('题干为空')
  if (!answerText.trim()) issues.push('答案为空')
  if (!analysisText.trim()) issues.push('解析为空')
  return { index, questionNo, problemText, answerText, analysisText, needsHumanReview, issues }
}

export function parseStrictQuestionsFromJsonText(text: string) {
  const payload: unknown = JSON.parse(text)
  const questions = questionsFromPayload(payload)
  return { payload, questions, previews: questions.map(buildPaperQuestionPreview) }
}

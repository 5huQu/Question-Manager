import type { QuestionItem, RichBlock } from '@/types'
import { richBlocksPlainText } from '@/components/RichContent'

export function paragraphBlocksFromText(value: string): RichBlock[] {
  return String(value || '').trim()
    ? String(value || '').split(/\n{2,}/).map((part) => ({ type: 'paragraph' as const, content: inlineBlocksFromText(part.trim()) }))
    : []
}

export function inlineBlocksFromText(text: string): RichBlock['content'] {
  const content: RichBlock['content'] = []
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

const legalJsonEscapeChars = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'])

export function shouldDoubleJsonBackslash(escapedChar: string, followingText: string) {
  if (!legalJsonEscapeChars.has(escapedChar)) return true
  if (escapedChar === 'u') return !/^[0-9a-fA-F]{4}/.test(followingText)
  if (!['b', 'f', 'n', 'r', 't'].includes(escapedChar)) return false
  return /^[a-z]/.test(followingText)
}

export function cleanJsonBackslashes(text: string) {
  let cleaned = ''
  let changed = 0
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (!inString) {
      cleaned += char
      if (char === '"') inString = true
      continue
    }
    if (escaped) {
      if (shouldDoubleJsonBackslash(char, text.slice(index + 1))) {
        cleaned += `\\${char}`
        changed += 1
      } else {
        cleaned += char
      }
      escaped = false
      continue
    }
    if (char === '\\') {
      cleaned += char
      escaped = true
      continue
    }
    cleaned += char
    if (char === '"') inString = false
  }
  return { cleaned, changed }
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

export function extractLikelyJsonText(text: string) {
  const trimmed = text.trim().replace(/^\uFEFF/, '')
  const fencedBlocks = Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)).map((match) => match[1]?.trim()).filter(Boolean)
  if (fencedBlocks.length) {
    return {
      text: fencedBlocks.join('\n'),
      changed: true,
      note: fencedBlocks.length > 1 ? `已提取 ${fencedBlocks.length} 个代码块中的 JSON。` : '已提取代码块中的 JSON。',
    }
  }
  const firstObject = trimmed.search(/[\[{]/)
  if (firstObject < 0) return { text: trimmed, changed: trimmed !== text, note: trimmed !== text ? '已去除前后空白。' : '' }
  const firstChar = trimmed[firstObject]
  const lastIndex = firstChar === '{' ? trimmed.lastIndexOf('}') : trimmed.lastIndexOf(']')
  if (lastIndex > firstObject) {
    const sliced = trimmed.slice(firstObject, lastIndex + 1)
    const changed = sliced !== trimmed
    return { text: sliced, changed, note: changed ? '已忽略 JSON 前后的额外文字。' : '' }
  }
  return { text: trimmed, changed: trimmed !== text, note: trimmed !== text ? '已去除前后空白。' : '' }
}

export function mergeQuestionPayloadSegments(text: string) {
  const segments = splitTopLevelJsonSegments(text)
  if (segments.length <= 1) return null
  try {
    const payloads = segments.map((segment) => JSON.parse(segment))
    const questions = payloads.flatMap(questionsFromPayload)
    if (!questions.length) return null
    return {
      cleaned: JSON.stringify({ questions }, null, 2),
      count: segments.length,
      questionCount: questions.length,
    }
  } catch {
    return null
  }
}

export function cleanAiJsonText(text: string) {
  const changes: string[] = []
  const extracted = extractLikelyJsonText(text)
  let cleaned = extracted.text
  if (extracted.note) changes.push(extracted.note)
  const backslashCleaned = cleanJsonBackslashes(cleaned)
  cleaned = backslashCleaned.cleaned
  if (backslashCleaned.changed > 0) changes.push(`已清洗 ${backslashCleaned.changed} 处 LaTeX 反斜杠。`)
  const withoutTrailingCommas = cleaned.replace(/,\s*([}\]])/g, '$1')
  if (withoutTrailingCommas !== cleaned) {
    cleaned = withoutTrailingCommas
    changes.push('已移除对象或数组结尾前的多余逗号。')
  }
  const merged = mergeQuestionPayloadSegments(cleaned)
  if (merged) {
    cleaned = merged.cleaned
    changes.push(`已识别到 ${merged.count} 段 JSON，并合并为 ${merged.questionCount} 道题。`)
  }
  return { cleaned, changes }
}

export function splitTopLevelJsonSegments(text: string) {
  const segments: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{' || char === '[') {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (char === '}' || char === ']') {
      if (depth > 0) depth -= 1
      if (depth === 0 && start >= 0) {
        segments.push(text.slice(start, index + 1))
        start = -1
      }
    }
  }
  return segments
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

export function comparableQuestionNo(value: string) {
  return String(value || '')
    .trim()
    .replace(/^\s*第\s*/u, '')
    .replace(/\s*题\s*$/u, '')
    .replace(/\s+/g, '')
    .replace(/[.．、:：）)]$/u, '')
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

export function parsePaperQuestionsFromJsonText(text: string) {
  const prepared = cleanAiJsonText(text)
  let payload: unknown
  let questions: unknown[]
  try {
    payload = JSON.parse(prepared.cleaned)
    questions = questionsFromPayload(payload)
  } catch (error) {
    const merged = mergeQuestionPayloadSegments(prepared.cleaned)
    if (!merged) throw error
    prepared.cleaned = merged.cleaned
    prepared.changes.push(`已识别到 ${merged.count} 段 JSON，并合并为 ${merged.questionCount} 道题。`)
    payload = JSON.parse(prepared.cleaned)
    questions = questionsFromPayload(payload)
  }
  return { ...prepared, payload, questions, previews: questions.map(buildPaperQuestionPreview) }
}

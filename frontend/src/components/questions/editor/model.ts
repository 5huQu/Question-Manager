import type { QuestionContentDraft } from '@/types/questionContent'
import { markdownToEditorDocument } from '@/utils/questionContentCodec'

export type QuestionContentValue = QuestionContentDraft

export type QuestionEditorVariant = 'full' | 'compact' | 'workbench'

export interface QuestionContentEditorWarning {
  code: 'raw-markdown' | 'invalid-formula' | 'recovered-draft'
  field: keyof QuestionContentValue
  message: string
}

export interface StructuredChoice {
  label: string
  content: string
}

const CHOICE_LINE = /^\s*([A-D])[.、．:)）]\s*(.+?)\s*$/i

export function splitChoices(markdown: string): { body: string; choices: StructuredChoice[] } {
  const lines = markdown.split('\n')
  const choices: StructuredChoice[] = []
  const body: string[] = []
  for (const line of lines) {
    const match = line.match(CHOICE_LINE)
    if (match) choices.push({ label: match[1].toUpperCase(), content: match[2] })
    else body.push(line)
  }
  const ordered = choices.length >= 2 && choices.every((choice, index) => choice.label === String.fromCharCode(65 + index))
  return ordered ? { body: body.join('\n').trimEnd(), choices } : { body: markdown, choices: [] }
}

export function joinChoices(body: string, choices: StructuredChoice[]): string {
  if (!choices.length) return body
  return `${body.trimEnd()}\n\n${choices.map((choice) => `${choice.label}. ${choice.content.trim()}`).join('\n')}`.trim()
}

export function detectCompatibilityWarnings(value: QuestionContentValue): QuestionContentEditorWarning[] {
  return (Object.entries(value) as Array<[keyof QuestionContentValue, string]>).flatMap(([field, markdown]) => {
    const warnings: QuestionContentEditorWarning[] = markdownToEditorDocument(markdown).warnings.map((warning) => ({ code: 'raw-markdown' as const, field, message: warning.message }))
    const dollars = (markdown.match(/(?<!\\)\$/g) || []).length
    if (dollars % 2 !== 0) {
      warnings.push({ code: 'invalid-formula', field, message: '检测到未闭合的公式分隔符，请检查 LaTeX 源码。' })
    }
    return warnings
  })
}

export function contentEquals(left: QuestionContentValue, right: QuestionContentValue): boolean {
  return left.stemMarkdown === right.stemMarkdown
    && left.answerText === right.answerText
    && left.analysisMarkdown === right.analysisMarkdown
}

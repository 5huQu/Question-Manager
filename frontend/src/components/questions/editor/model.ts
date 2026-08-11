import type { QuestionContentDraft } from '@/types/questionContent'
import { markdownToEditorDocument } from '@/utils/questionContentCodec'
import { withoutHtmlTableSegments } from '@/utils/htmlTables'
import { parseChoiceQuestion } from '@/utils/questionDisplay'

export type QuestionContentValue = QuestionContentDraft

export type QuestionEditorVariant = 'full' | 'compact' | 'workbench'

export interface QuestionContentEditorWarning {
  code: 'raw-markdown' | 'invalid-formula' | 'recovered-draft'
  field: keyof QuestionContentValue
  message: string
  excerpt?: string
}

export interface StructuredChoice {
  label: string
  content: string
}

export interface ChoiceConversionSuggestion {
  body: string
  choices: StructuredChoice[]
}

export type ChoiceAnswerMode = 'single' | 'multiple'

// Empty choices are valid while a question is being composed. In particular,
// joinChoices trims the final line's trailing space, leaving the last choice
// as `D.` until the user enters its content.
const CHOICE_LINE = /^\s*([A-D])[.、．:)）]\s*(.*?)\s*$/i

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

/** Return the answer interaction allowed by the question type, if any. */
export function choiceAnswerMode(questionType?: string): ChoiceAnswerMode | null {
  const normalized = String(questionType || '').replace(/\s/g, '')
  if (/多(?:选|项选择)/.test(normalized)) return 'multiple'
  if (/单(?:选|项选择)/.test(normalized)) return 'single'
  return null
}

/**
 * Extract a pure choice answer without changing the stored answer text.
 * The conservative full-string match deliberately leaves explanatory answers
 * such as “B，因为……” unselected rather than highlighting a false positive.
 */
export function extractChoiceAnswerLabels(
  answerText: string,
  choices: StructuredChoice[],
  mode: ChoiceAnswerMode,
): string[] {
  const available = new Set(choices.map((choice) => choice.label.toUpperCase()))
  const source = String(answerText || '').normalize('NFKC').trim().toUpperCase()
  if (!source || !available.size) return []
  const withoutPrefix = source.replace(/^(?:(?:参考)?答案(?:\s*[:：为是])?|故选|故(?:答案)?(?:为|是)?|应选|正确选项|选项)\s*/, '')
  const compact = withoutPrefix.replace(/[\s,，、;；:：.。/\\&()（）\[\]【】*_`~]/g, '')
  if (!compact || !/^[A-Z]+$/.test(compact)) return []

  const labels = Array.from(compact)
  if (labels.some((label) => !available.has(label)) || new Set(labels).size !== labels.length) return []
  if (mode === 'single' && labels.length !== 1) return []
  return choices.map((choice) => choice.label).filter((label) => labels.includes(label))
}

export function serializeChoiceAnswerLabels(choices: StructuredChoice[], labels: string[]): string {
  const selected = new Set(labels)
  return choices.map((choice) => choice.label).filter((label) => selected.has(label)).join('、')
}

/**
 * Detect legacy inline/two-per-line A-D options without mutating the source.
 * The editor presents this result for explicit confirmation before rewriting
 * the Markdown into the canonical one-option-per-line form.
 */
export function suggestChoiceConversion(markdown: string): ChoiceConversionSuggestion | null {
  if (splitChoices(markdown).choices.length) return null
  const parsed = parseChoiceQuestion(markdown)
  if (!parsed || parsed.remainder || parsed.options.length !== 4) return null
  return {
    body: parsed.stem,
    choices: parsed.options.map((option) => ({
      label: option.label,
      content: option.content,
    })),
  }
}

export function detectCompatibilityWarnings(value: QuestionContentValue): QuestionContentEditorWarning[] {
  return (Object.entries(value) as Array<[keyof QuestionContentValue, string]>).flatMap(([field, markdown]) => {
    // HTML tables are now parsed into safe, span-aware Tiptap tables. The legacy
    // codec still treats every HTML tag as raw Markdown, so only pass it the
    // remaining source when deciding whether a warning is warranted.
    const warnings: QuestionContentEditorWarning[] = markdownToEditorDocument(withoutHtmlTableSegments(markdown)).warnings.map((warning) => ({
      code: 'raw-markdown' as const,
      field,
      message: warning.message,
      excerpt: warning.excerpt,
    }))
    const dollars = (markdown.match(/(?<!\\)\$/g) || []).length
    if (dollars % 2 !== 0) {
      warnings.push({ code: 'invalid-formula', field, message: '检测到未闭合的公式分隔符，请检查 LaTeX 源码。', excerpt: markdown.replace(/\s+/g, ' ').trim().slice(0, 160) })
    }
    return warnings
  })
}

export function contentEquals(left: QuestionContentValue, right: QuestionContentValue): boolean {
  return left.stemMarkdown === right.stemMarkdown
    && left.answerText === right.answerText
    && left.analysisMarkdown === right.analysisMarkdown
}

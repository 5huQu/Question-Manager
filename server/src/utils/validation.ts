import { katex } from '../config.js'
import { normalizeBlocks, normalizeLatexMathDelimiters } from './rich-content.js'

// ── Rich Content Types ────────────────────────────────────────────
// These are included here since validateBlocks operates on them.
// They mirror the definitions in rich-content.ts.

type RichInline =
  | { type: 'text'; text: string }
  | { type: 'inline_math'; tex: string }

type RichBlock =
  | { type: 'paragraph'; content: RichInline[] }
  | { type: 'display_math'; tex: string }
  | { type: 'choices'; options: Array<{ label: string; blocks: RichBlock[] }> }
  | { type: 'table'; rows: Array<{ header?: boolean; cells: RichInline[][] }> }

// ── FormatIssue ───────────────────────────────────────────────────

export type FormatIssue = {
  field: string
  code: string
  message: string
  snippet: string
  context?: string
  mode?: string
  start?: number
  end?: number
}

export function validateQuestionMarkdown(fields: Record<string, string>): FormatIssue[] {
  const issues: FormatIssue[] = []
  for (const [field, text] of Object.entries(fields)) {
    const value = normalizeLatexMathDelimiters(String(text || ''))
    const spans = Array.from(value.matchAll(/\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$/g))
    const consumed = spans.reduce((output, match) => output.slice(0, Number(match.index || 0)) + ' '.repeat(match[0].length) + output.slice(Number(match.index || 0) + match[0].length), value)
    if (/(^|[^\\])\$/.test(consumed)) {
      issues.push({ field, code: 'math_delimiter_unclosed', message: '数学定界符 $ 未成对。', snippet: value })
      continue
    }
    for (const match of spans) {
      const tex = String(match[1] ?? match[2] ?? '').trim()
      if (!tex) continue
      try {
        katex.renderToString(tex, { displayMode: Boolean(match[1]), throwOnError: true, strict: 'ignore' })
      } catch (error) {
        issues.push({ field, code: 'katex_parse_error', message: error instanceof Error ? error.message : String(error), snippet: tex })
      }
    }
  }
  return issues
}

export function formatReviewPayload(issues: FormatIssue[], updatedAt: string) {
  return {
    issue: issues[0] || null,
    reasons: issues.map((issue) => `${issue.field}:${issue.code}`),
    renderErrors: issues,
    previewWarnings: issues,
    importBlockingIssues: issues,
    exportBlockingIssues: issues,
    updatedAt,
  }
}

// ── validateBlocks ────────────────────────────────────────────────

/**
 * Walk a (normalized) block tree and validate every TeX snippet
 * by running it through KaTeX. Returns a list of format issues;
 * an empty array means everything is valid.
 */
export function validateBlocks(blocksInput: unknown, field = 'blocks'): FormatIssue[] {
  const errors: FormatIssue[] = []

  const visitTex = (tex: string, pathLabel: string, mode: 'inline' | 'display') => {
    const value = String(tex || '').trim()
    if (!value) return

    if (/(^\$|\$$|\\\(|\\\)|\\\[|\\\])/.test(value)) {
      errors.push({ field, code: 'tex_has_delimiters', message: 'TeX 字段不能包含数学定界符。', snippet: value, context: pathLabel, mode })
      return
    }

    try {
      katex.renderToString(value, { displayMode: mode === 'display', throwOnError: true, strict: 'ignore' })
    } catch (error) {
      errors.push({ field, code: 'katex_parse_error', message: error instanceof Error ? error.message : String(error), snippet: value, context: pathLabel, mode })
    }
  }

  const visitBlocks = (blocks: RichBlock[], pathLabel: string) => {
    blocks.forEach((block, index) => {
      const nextPath = `${pathLabel}.${index}`
      if (block.type === 'paragraph') {
        block.content.forEach((inline, inlineIndex) => {
          if (inline.type === 'inline_math') visitTex(inline.tex, `${nextPath}.content.${inlineIndex}`, 'inline')
        })
      } else if (block.type === 'display_math') {
        visitTex(block.tex, nextPath, 'display')
      } else if (block.type === 'choices') {
        block.options.forEach((option, optionIndex) => visitBlocks(option.blocks, `${nextPath}.options.${optionIndex}.blocks`))
      } else if (block.type === 'table') {
        block.rows.forEach((row, rowIndex) =>
          row.cells.forEach((cell, cellIndex) =>
            cell.forEach((inline, inlineIndex) => {
              if (inline.type === 'inline_math') visitTex(inline.tex, `${nextPath}.rows.${rowIndex}.cells.${cellIndex}.${inlineIndex}`, 'inline')
            })
          )
        )
      }
    })
  }

  visitBlocks(normalizeBlocks(blocksInput), field)
  return errors
}

// ── formatIssueFromReviewJson ─────────────────────────────────────

/**
 * Parse a `FormatIssue` from the JSON payload returned by a review
 * worker (e.g. a Python format-check script).  Returns `undefined`
 * when the payload contains no recognised `issue` object.
 */
export function formatIssueFromReviewJson(value = ''): FormatIssue | undefined {
  const payload = parseJsonStrict<Record<string, any>>(value || '{}')
  if (!payload) return undefined

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

// ── local helpers ─────────────────────────────────────────────────

function parseJsonStrict<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

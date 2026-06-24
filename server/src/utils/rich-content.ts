import type { RichInline, RichBlock } from '../types/index.js'
import { parseJson } from './json.js'

// ── Constants ──────────────────────────────────────────────────────────────────

const templateWatermarkPattern = /(学科网|zxxk|原创精品资源|独家享有版权|侵权必究|帮课堂.*学与练)/i
const standalonePageNumberPattern = /^\s*\d{1,3}\s*$/
const semanticExerciseLabelPattern = /^\s*(?:[【［\[]\s*)?(?:第\s*)?(?:典例|例题|变式|即学即练|即学即练习|课堂练习|限时训练|课后训练|巩固训练|能力提升)\s*(?:\d+|[一二三四五六七八九十]+)?(?:\s*[-—–_·：:、.．]\s*(?:\d+|[一二三四五六七八九十]+))?\s*(?:题)?\s*(?:[】］\]]\s*)?/u

// ── Rich inline / block functions ──────────────────────────────────────────────

function textInline(text: unknown): RichInline | null {
  const value = String(text ?? '')
  return value ? { type: 'text', text: value } : null
}

function inlineMathDelimitersToInlines(text: string): RichInline[] {
  const inlines: RichInline[] = []
  let cursor = 0
  while (cursor < text.length) {
    const start = text.indexOf('$', cursor)
    if (start < 0) {
      if (cursor < text.length) inlines.push({ type: 'text', text: text.slice(cursor) })
      break
    }
    if (start > cursor) inlines.push({ type: 'text', text: text.slice(cursor, start) })
    const end = text.indexOf('$', start + 1)
    if (end < 0) {
      inlines.push({ type: 'text', text: text.slice(start) })
      break
    }
    const tex = text.slice(start + 1, end).trim()
    if (tex) inlines.push({ type: 'inline_math', tex })
    else inlines.push({ type: 'text', text: text.slice(start, end + 1) })
    cursor = end + 1
  }
  return inlines.filter((inline) => inline.type !== 'text' || inline.text)
}

function paragraphBlock(text: unknown): RichBlock[] {
  const value = String(text ?? '').trim()
  if (!value) return []
  return value.split(/\n{2,}/).map((part) => ({
    type: 'paragraph' as const,
    content: inlineMathDelimitersToInlines(part.trim()),
  })).filter((block) => block.content.length)
}

function normalizeInline(input: unknown): RichInline | null {
  if (!input || typeof input !== 'object') return textInline(input)
  const raw = input as Record<string, unknown>
  if (raw.type === 'inline_math') {
    const tex = String(raw.tex ?? '').trim()
    return tex ? { type: 'inline_math', tex } : null
  }
  const text = String(raw.text ?? raw.content ?? '')
  return text ? { type: 'text', text } : null
}

function normalizeInlines(input: unknown): RichInline[] {
  const source = Array.isArray(input) ? input : [input]
  const output: RichInline[] = []
  for (const item of source) {
    const inline = normalizeInline(item)
    if (!inline) continue
    const expanded = inline.type === 'text' ? inlineMathDelimitersToInlines(inline.text) : [inline]
    for (const part of expanded) {
      const previous = output[output.length - 1]
      if (previous?.type === 'text' && part.type === 'text') previous.text += part.text
      else output.push(part)
    }
  }
  return output.filter((inline) => inline.type !== 'text' || inline.text.trim())
}

function normalizeBlocks(input: unknown): RichBlock[] {
  if (typeof input === 'string') return paragraphBlock(input)
  if (!Array.isArray(input)) return []
  const blocks: RichBlock[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    if (raw.type === 'paragraph') {
      const content = normalizeInlines(raw.content)
      if (content.length) blocks.push({ type: 'paragraph', content })
    } else if (raw.type === 'display_math') {
      const tex = String(raw.tex ?? '').trim()
      if (tex) blocks.push({ type: 'display_math', tex })
    } else if (raw.type === 'choices') {
      const options = Array.isArray(raw.options) ? raw.options : []
      const normalizedOptions = options.map((option, index) => {
        const row = option && typeof option === 'object' ? option as Record<string, unknown> : {}
        const label = String(row.label || String.fromCharCode(65 + index)).trim().toUpperCase()
        const optionBlocks = normalizeBlocks(row.blocks ?? row.content ?? row.text ?? '')
        return { label, blocks: optionBlocks }
      }).filter((option) => option.label && option.blocks.length)
      if (normalizedOptions.length) blocks.push({ type: 'choices', options: normalizedOptions })
    } else if (raw.type === 'table') {
      const rows = Array.isArray(raw.rows) ? raw.rows : []
      const normalizedRows = rows.map((row) => {
        const source = row && typeof row === 'object' ? row as Record<string, unknown> : {}
        const cells = Array.isArray(source.cells) ? source.cells.map((cell) => normalizeInlines(cell)) : []
        return { header: Boolean(source.header), cells }
      }).filter((row) => row.cells.length)
      if (normalizedRows.length) blocks.push({ type: 'table', rows: normalizedRows })
    }
  }
  return blocks
}

function blocksFromPayload(payload: Record<string, any>, blockKey: string, legacyKey: string): RichBlock[] {
  const blockValue = normalizeBlocks(payload[blockKey])
  if (blockValue.length) return blockValue
  return normalizeBlocks(payload[legacyKey] ?? payload[legacyKey.replace(/_text$/, '')] ?? [])
}

function blocksFromOcrResult(result: Record<string, any>, blockKey: string, legacyKey: string): RichBlock[] {
  const blockValue = normalizeBlocks(result[blockKey])
  if (blockValue.length) return blockValue
  const fallback = stripOcrTemplateNoise(String(result[legacyKey] || '').trim()).trim()
  return normalizeBlocks(fallback)
}

function blockFieldJson(blocks: RichBlock[]) {
  return JSON.stringify(normalizeBlocks(blocks))
}

function inlinePlainText(inlines: RichInline[]) {
  return inlines.map((inline) => inline.type === 'inline_math' ? inline.tex : inline.text).join('')
}

function blocksToPlainText(blocksInput: unknown): string {
  const blocks = normalizeBlocks(blocksInput)
  return blocks.map((block) => {
    if (block.type === 'paragraph') return inlinePlainText(block.content)
    if (block.type === 'display_math') return block.tex
    if (block.type === 'choices') return block.options.map((option) => `${option.label}. ${blocksToPlainText(option.blocks)}`).join('\n')
    if (block.type === 'table') return block.rows.map((row) => row.cells.map(inlinePlainText).join('\t')).join('\n')
    return ''
  }).filter(Boolean).join('\n\n').trim()
}

function inlineMarkdown(inlines: RichInline[]) {
  return inlines.map((inline) => inline.type === 'inline_math' ? `$${inline.tex}$` : inline.text).join('')
}

function blocksToMarkdown(blocksInput: unknown): string {
  const blocks = normalizeBlocks(blocksInput)
  const lines: string[] = []
  for (const block of blocks) {
    if (block.type === 'paragraph') lines.push(inlineMarkdown(block.content))
    else if (block.type === 'display_math') lines.push(`$$\n${block.tex}\n$$`)
    else if (block.type === 'choices') lines.push(block.options.map((option) => `${option.label}. ${blocksToMarkdown(option.blocks).replace(/\n+/g, ' ').trim()}`).join('\n'))
    else if (block.type === 'table') {
      const rows = block.rows
      const width = Math.max(...rows.map((row) => row.cells.length), 1)
      rows.forEach((row, index) => {
        const cells = Array.from({ length: width }, (_, cellIndex) => inlineMarkdown(row.cells[cellIndex] || []))
        lines.push(`| ${cells.join(' | ')} |`)
        if (index === 0) lines.push(`| ${Array.from({ length: width }, () => '---').join(' | ')} |`)
      })
    }
  }
  return lines.join('\n\n').replace(/\n{4,}/g, '\n\n\n').trim()
}

// ── OCR noise stripping ────────────────────────────────────────────────────────
// Used by blocksFromOcrResult above.

function stripSemanticExerciseLabel(value: string) {
  return String(value || '').replace(semanticExerciseLabelPattern, '').trimStart()
}

function stripDoc2xNoiseComments(value: string) {
  return stripExamCarryoverNoise(String(value || '')
    .replace(/<!--\s*DOC2X_PAGE\s*:\s*\d+\s*-->/gi, '')
    .replace(/<!--\s*figureText\s*:[\s\S]*?-->/gi, ''))
}

function stripExamCarryoverNoise(value: string) {
  return String(value || '')
    .replace(/(?:^|\n)\s*(?:#{1,6}\s*)?[一二三四五六七八九十]+[、.．]\s*[^\n]{0,80}本大题[\s\S]*$/u, '')
    .replace(/(?:^|\n)\s*<table\b(?=[\s\S]*?<td>\s*题号\s*<\/td>)(?=[\s\S]*?<td>\s*答案\s*<\/td>)[\s\S]*?<\/table>/gi, '')
}

function stripOcrTemplateNoise(value: string) {
  const lines = stripDoc2xNoiseComments(stripSemanticExerciseLabel(String(value || ''))).split(/\r?\n/)
  const watermarkIndexes = new Set<number>()
  lines.forEach((line, index) => {
    const compact = line.replace(/\s+/g, '')
    if (templateWatermarkPattern.test(compact)) watermarkIndexes.add(index)
  })
  if (!watermarkIndexes.size) return lines.join('\n')
  return lines
    .filter((line, index) => {
      if (watermarkIndexes.has(index)) return false
      if (standalonePageNumberPattern.test(line) && (watermarkIndexes.has(index - 1) || watermarkIndexes.has(index + 1))) return false
      return true
    })
    .join('\n')
}

// ── Exam LaTeX helpers ─────────────────────────────────────────────────────────

function escapeLatexTextSegment(value: string) {
  return normalizeUnicodeRomanNumerals(String(value || ''))
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([#%&_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}

function normalizeUnicodeRomanNumerals(value: string) {
  const romanMap: Record<string, string> = {
    'Ⅰ': 'I',
    'Ⅱ': 'II',
    'Ⅲ': 'III',
    'Ⅳ': 'IV',
    'Ⅴ': 'V',
    'Ⅵ': 'VI',
    'Ⅶ': 'VII',
    'Ⅷ': 'VIII',
    'Ⅸ': 'IX',
    'Ⅹ': 'X',
    'ⅰ': 'i',
    'ⅱ': 'ii',
    'ⅲ': 'iii',
    'ⅳ': 'iv',
    'ⅴ': 'v',
    'ⅵ': 'vi',
    'ⅶ': 'vii',
    'ⅷ': 'viii',
    'ⅸ': 'ix',
    'ⅹ': 'x',
  }
  return value.replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]/g, (match) => romanMap[match] || match)
}

function normalizeLatexMathSegment(value: string) {
  return String(value || '')
    .replace(/\\mathbf\{R\}/g, '\\mathbb{R}')
    .replace(/\\vec\{/g, '\\overrightarrow{')
    .replace(/\s*\n\s*/g, ' ')
}

function markdownTextToExamLatex(value: string, preserveBreaks = true) {
  const text = String(value || '')
    .replace(/【解析】/g, '')
    .replace(/【分析】/g, '')
    .replace(/【详解】/g, '')
    .replace(/详解】/g, '')
    .trim()
  const parts: string[] = []
  const pattern = /(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    parts.push(escapeLatexTextSegment(text.slice(last, match.index)))
    parts.push(normalizeLatexMathSegment(match[0]))
    last = (match.index || 0) + match[0].length
  }
  parts.push(escapeLatexTextSegment(text.slice(last)))
  const rendered = parts.join('')
  if (!preserveBreaks) return rendered.replace(/\s*\n\s*/g, ' ')
  return rendered
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.split(/\n/).map((line) => line.trim()).filter(Boolean).join('\n\\par\n'))
    .filter(Boolean)
    .join('\n\\par\n')
}

function keepSubquestionsTogether(latex: string) {
  return String(latex || '').replace(
    /\\par\s*\n(?=（(?:\d+|[ivxIVX]+|[一二三四五六七八九十]+)）)/g,
    '\\par\\nobreak\n',
  )
}

// ── Markdown table helpers for LaTeX export ────────────────────────────────────

function isMarkdownTableRow(line: string) {
  const trimmed = String(line || '').trim()
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.slice(1, -1).includes('|')
}

function normalizeHtmlTablesForExport(value: string) {
  return String(value || '').replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (source, body: string) => {
    const rows = Array.from(body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
      .map((row) => Array.from(row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi))
        .map((cell) => cell[1]
          .replace(/<br\s*\/?>/gi, '<br>')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/gi, '&')
          .replace(/\|/g, '\\|')
          .trim()))
      .filter((row) => row.length)
    if (!rows.length) return source
    const width = Math.max(...rows.map((row) => row.length))
    const markdownRow = (row: string[]) => `| ${Array.from({ length: width }, (_, index) => row[index] || '').join(' | ')} |`
    const separator = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`
    return `\n\n${markdownRow(rows[0])}\n${separator}\n${rows.slice(1).map(markdownRow).join('\n')}\n\n`
  })
}

function splitMarkdownTableRow(line: string) {
  const source = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\\' && source[index + 1] === '|') {
      cell += '|'
      index += 1
    } else if (char === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell.trim())
  return cells
}

function isMarkdownTableSeparator(line: string) {
  if (!isMarkdownTableRow(line)) return false
  const cells = splitMarkdownTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^[:：]?-{3,}[:：]?$/.test(cell.replace(/\s+/g, '')))
}

function markdownTableToExamLatex(lines: string[]) {
  const separatorIndex = lines.findIndex(isMarkdownTableSeparator)
  const rows = lines.map(splitMarkdownTableRow)
  const columnCount = Math.max(...rows.map((row) => row.length), 1)
  const separator = separatorIndex >= 0 ? rows[separatorIndex] : []
  const alignments = Array.from({ length: columnCount }, (_, index) => {
    const marker = String(separator[index] || '')
    if (/^[:：].*[:：]$/.test(marker)) return 'c'
    if (/[:：]$/.test(marker)) return 'r'
    return 'l'
  })
  const output = [
    '\\par\\smallskip',
    '\\begin{center}',
    '\\renewcommand{\\arraystretch}{1.25}',
    '\\setlength{\\tabcolsep}{5pt}',
    '\\begin{adjustbox}{max width=\\linewidth}',
    `\\begin{tabular}{|${alignments.join('|')}|}\\hline`,
  ]
  rows.forEach((row, rowIndex) => {
    if (rowIndex === separatorIndex) return
    const cells = Array.from({ length: columnCount }, (_, cellIndex) => markdownTextToExamLatex(row[cellIndex] || '', false))
    if (separatorIndex > 0 && rowIndex < separatorIndex) {
      for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
        cells[cellIndex] = cells[cellIndex] ? `\\textbf{${cells[cellIndex]}}` : ''
      }
    }
    output.push(`${cells.join(' & ')} \\\\ \\hline`)
  })
  output.push('\\end{tabular}', '\\end{adjustbox}', '\\end{center}', '\\smallskip')
  return output.join('\n')
}

function markdownToExamLatex(value: string, preserveBreaks = true) {
  const lines = normalizeHtmlTablesForExport(value).replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let textLines: string[] = []
  const flushText = () => {
    const text = textLines.join('\n').trim()
    if (text) output.push(markdownTextToExamLatex(text, preserveBreaks))
    textLines = []
  }
  for (let index = 0; index < lines.length;) {
    if (isMarkdownTableRow(lines[index]) && index + 1 < lines.length && isMarkdownTableSeparator(lines[index + 1])) {
      flushText()
      const tableLines: string[] = []
      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        tableLines.push(lines[index])
        index += 1
      }
      output.push(markdownTableToExamLatex(tableLines))
      continue
    }
    textLines.push(lines[index])
    index += 1
  }
  flushText()
  return output.join('\n')
}

// ── Exports ────────────────────────────────────────────────────────────────────

export {
  blocksFromOcrResult,
  blocksFromPayload,
  blockFieldJson,
  blocksToMarkdown,
  blocksToPlainText,
  escapeLatexTextSegment,
  inlineMarkdown,
  inlineMathDelimitersToInlines,
  inlinePlainText,
  isMarkdownTableRow,
  isMarkdownTableSeparator,
  keepSubquestionsTogether,
  markdownTableToExamLatex,
  markdownTextToExamLatex,
  markdownToExamLatex,
  normalizeBlocks,
  normalizeHtmlTablesForExport,
  normalizeInline,
  normalizeInlines,
  normalizeLatexMathSegment,
  normalizeUnicodeRomanNumerals,
  paragraphBlock,
  splitMarkdownTableRow,
  stripDoc2xNoiseComments,
  stripOcrTemplateNoise,
  textInline,
}

import type { OCRDocument } from '../../types/ocr-document.js'
import { detectSolutionQuestionNumbers } from './question-number-detector.js'
import { splitMarkdownByQuestionNumbers } from './markdown-question-splitter.js'
import { getParserConfig } from './parser-config.js'
import type { ImportFlowV2ParserConfig } from './default-parser-config.js'
import {
  extractSolutionMatches,
  findSolutionSections,
  splitQuestionFields,
  type MarkdownRange,
  type SolutionMatch,
} from './solution-matcher.js'

export type ParseSolutionDocumentOptions = {
  config?: ImportFlowV2ParserConfig
}

function nonEmpty(value: string | undefined) {
  const text = String(value || '').trim()
  return text || undefined
}

function solutionMatchFromWholeDocumentChunk(body: string, offset: number, fallbackRange: MarkdownRange): SolutionMatch {
  const fields = splitQuestionFields(body, offset)
  const inferredLeadingAnswer = !fields.answerText && fields.analysisMarkdown ? nonEmpty(fields.stemMarkdown) : undefined
  const answerText = nonEmpty(fields.answerText) || inferredLeadingAnswer
  const analysisMarkdown = nonEmpty(fields.analysisMarkdown) || (!answerText ? nonEmpty(fields.stemMarkdown) : undefined)
  return {
    answerText,
    analysisMarkdown,
    answerRange: fields.answerRange || (inferredLeadingAnswer ? fields.stemRange : undefined),
    analysisRange: fields.analysisRange || (!answerText ? fields.stemRange : undefined) || fallbackRange,
  }
}

function mergeSolutionMatch(target: SolutionMatch | undefined, patch: SolutionMatch): SolutionMatch {
  return {
    ...(target || {}),
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined && value !== '')),
  }
}

function extractWholeDocumentSolutionMatches(markdown: string, config: ImportFlowV2ParserConfig) {
  const questionMatches = detectSolutionQuestionNumbers(markdown, config)
  const chunks = splitMarkdownByQuestionNumbers(markdown, questionMatches)
  const matches = new Map<string, SolutionMatch>()
  let chunksWithFieldMarkers = 0

  for (const chunk of chunks) {
    const fields = splitQuestionFields(chunk.body, chunk.contentStart)
    if (fields.hasFieldMarkers) chunksWithFieldMarkers += 1
    matches.set(chunk.questionNo, mergeSolutionMatch(matches.get(chunk.questionNo), solutionMatchFromWholeDocumentChunk(
      chunk.body,
      chunk.contentStart,
      { start: chunk.contentStart, end: chunk.end },
    )))
  }

  return { matches, chunkCount: chunks.length, chunksWithFieldMarkers }
}

/**
 * Parse HTML <table> blocks that map question numbers to answers.
 * Expected structure:
 *   <table ...>
 *     <tr><td>题号</td><td>1</td><td>2</td>...</tr>
 *     <tr><td>答案</td><td>A</td><td>C</td>...</tr>
 *   </table>
 * Returns a Map<questionNo, answerText>.
 */
export function extractAnswerTable(markdown: string): Map<string, string> {
  const result = new Map<string, string>()
  const source = String(markdown || '')
  const tablePattern = /<table\b[^>]*>([\s\S]*?)<\/table>/gi

  for (const tableMatch of source.matchAll(tablePattern)) {
    const tableContent = tableMatch[1]
    const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
    const rows: string[][] = []

    for (const rowMatch of tableContent.matchAll(rowPattern)) {
      const cellPattern = /<td\b[^>]*>([\s\S]*?)<\/td>/gi
      const cells: string[] = []
      for (const cellMatch of rowMatch[1].matchAll(cellPattern)) {
        cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim())
      }
      if (cells.length) rows.push(cells)
    }

    const headerRowIndex = rows.findIndex((row) => row.some((cell) => /题号|序号/.test(cell)))
    if (headerRowIndex < 0) continue

    const answerRowIndex = rows.findIndex((row, idx) => idx !== headerRowIndex && row.some((cell) => /答案/.test(cell)))
    if (answerRowIndex < 0) continue

    const headerRow = rows[headerRowIndex]
    const answerRow = rows[answerRowIndex]
    const labelColIndex = headerRow.findIndex((cell) => /题号|序号/.test(cell))
    const answerLabelColIndex = answerRow.findIndex((cell) => /答案/.test(cell))
    const startCol = Math.max(labelColIndex + 1, answerLabelColIndex + 1)

    for (let col = startCol; col < Math.min(headerRow.length, answerRow.length); col++) {
      const questionNo = headerRow[col].replace(/[^\d０-９]/g, '').trim()
      const answer = answerRow[col].trim()
      if (questionNo && answer) {
        // Normalize full-width digits in question number
        const normalizedNo = questionNo.replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - '０'.charCodeAt(0)))
        result.set(normalizedNo, answer)
      }
    }
  }
  return result
}

export function parseSolutionDocument(
  document: OCRDocument,
  options: ParseSolutionDocumentOptions = {},
): Map<string, SolutionMatch> {
  const config = options.config || getParserConfig()
  const markdown = String(document.markdown || '')

  // Step 1: Extract answers from HTML tables (e.g. answer key tables)
  const tableAnswers = extractAnswerTable(markdown)

  // Step 2: Run normal section-based or fallback extraction
  const solutionSections = findSolutionSections(markdown, config)
  const wholeDocumentMatches = extractWholeDocumentSolutionMatches(markdown, config)
  let matches: Map<string, SolutionMatch>

  if (
    wholeDocumentMatches.chunkCount > 0
    && wholeDocumentMatches.chunksWithFieldMarkers >= Math.ceil(wholeDocumentMatches.chunkCount / 2)
  ) {
    matches = wholeDocumentMatches.matches
  } else if (solutionSections.length) {
    matches = extractSolutionMatches(markdown, solutionSections, config)
  } else {
    matches = wholeDocumentMatches.matches
  }

  // Step 3: Merge table-based answers — they fill gaps but never overwrite existing answers
  for (const [questionNo, answerText] of tableAnswers) {
    const existing = matches.get(questionNo)
    if (!existing || !existing.answerText) {
      matches.set(questionNo, { ...(existing || {}), answerText })
    }
  }

  return matches
}

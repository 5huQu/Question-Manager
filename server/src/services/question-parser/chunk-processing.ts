import type { ImportFlowV2ParserConfig } from './default-parser-config.js'
import type { QuestionMarkdownChunk } from './markdown-question-splitter.js'
import type { CandidateFigure } from '../../types/question-candidate.js'
import { containsSectionHeading, hasAnswerOrAnalysisMarkerTextExported } from './structural-detection.js'

export function countQuestionNos(chunks: QuestionMarkdownChunk[]) {
  const counts = new Map<string, number>()
  for (const chunk of chunks) {
    if (!chunk.questionNo) continue
    counts.set(chunk.questionNo, (counts.get(chunk.questionNo) || 0) + 1)
  }
  return counts
}

export function duplicateQuestionNos(chunks: QuestionMarkdownChunk[]) {
  return new Set(Array.from(countQuestionNos(chunks).entries()).filter(([, count]) => count > 1).map(([questionNo]) => questionNo))
}

export function hasChoiceOptionLines(value: string) {
  return /(?:^|\n)\s*[A-D]\s*[.．、]/.test(value)
}

export function hasFigureMarker(value: string) {
  return /<!--\s*DOC2X_FIGURE:[^>]+\s*-->|!\[[^\]]*]\(/.test(value)
}

export function hasFigureKeyword(value: string, config: ImportFlowV2ParserConfig) {
  return config.figureKeywords.some((keyword) => String(value || '').includes(keyword))
}

export function shouldMergeDuplicateQuestionChunk(previous: QuestionMarkdownChunk, current: QuestionMarkdownChunk, config: ImportFlowV2ParserConfig) {
  if (previous.questionNo !== current.questionNo) return false
  if (hasAnswerOrAnalysisMarkerTextExported(previous.body) || containsSectionHeading(previous.body, config)) return false
  const combined = `${previous.body}\n${current.body}`
  return previous.body.length <= 120
    && (hasFigureKeyword(combined, config) || hasChoiceOptionLines(current.body) || hasFigureMarker(current.raw))
}

export function mergeDuplicateContinuationChunks(source: string, chunks: QuestionMarkdownChunk[], config: ImportFlowV2ParserConfig) {
  const merged: QuestionMarkdownChunk[] = []
  for (const chunk of chunks) {
    const previous = merged[merged.length - 1]
    if (previous && shouldMergeDuplicateQuestionChunk(previous, chunk, config)) {
      previous.end = chunk.end
      previous.raw = source.slice(previous.start, chunk.end).trim()
      previous.body = source.slice(previous.contentStart, chunk.end).trim()
      continue
    }
    merged.push({ ...chunk })
  }
  return merged
}

export function numberValue(value: string | undefined) {
  const parsed = Number.parseInt(String(value || '').replace(/[^\d]/g, ''), 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function stripRepeatedQuestionMarker(value: string, questionNo: string) {
  const normalized = numberValue(questionNo)
  if (normalized === undefined) return value
  return String(value || '').replace(new RegExp(`(^|\\n)\\s*(?:第\\s*${normalized}\\s*题|${normalized})\\s*[.．、·•]\\s*`, 'g'), '$1')
}

export function dedupeFigures(figures: CandidateFigure[]) {
  return Array.from(new Map(figures.map((figure) => [`${figure.sourceDocumentId || ''}:${figure.usage}:${figure.path}`, figure])).values())
}

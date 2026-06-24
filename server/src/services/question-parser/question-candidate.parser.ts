import type { OCRDocument } from '../../types/ocr-document.js'
import type { CandidateFigure, CandidateSourceRef, QuestionCandidate } from '../../types/question-candidate.js'
import { createId, nowIso } from '../../utils/ids.js'
import { detectQuestionNumbers } from './question-number-detector.js'
import { splitMarkdownByQuestionNumbers, type QuestionMarkdownChunk } from './markdown-question-splitter.js'
import {
  extractSolutionMatches,
  findSolutionSections,
  splitQuestionFields,
  type MarkdownRange,
  type SolutionMatch,
  type SolutionSection,
} from './solution-matcher.js'
import { figuresForRange, sourceRefsForRange } from './figure-linker.js'
import { statusForIssues, validateQuestionCandidate } from './candidate-validator.js'

export type ParseQuestionCandidatesOptions = {
  now?: string
}

function countQuestionNos(chunks: QuestionMarkdownChunk[]) {
  const counts = new Map<string, number>()
  for (const chunk of chunks) {
    if (!chunk.questionNo) continue
    counts.set(chunk.questionNo, (counts.get(chunk.questionNo) || 0) + 1)
  }
  return counts
}

function duplicateQuestionNos(chunks: QuestionMarkdownChunk[]) {
  return new Set(Array.from(countQuestionNos(chunks).entries()).filter(([, count]) => count > 1).map(([questionNo]) => questionNo))
}

function dedupeFigures(figures: CandidateFigure[]) {
  return Array.from(new Map(figures.map((figure) => [figure.id, figure])).values())
}

function dedupeSourceRefs(refs: CandidateSourceRef[]) {
  const grouped = new Map<string, CandidateSourceRef>()
  for (const ref of refs) {
    const key = ref.kind + ':' + ref.pageNo
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, ref)
      continue
    }
    grouped.set(key, {
      ...existing,
      blockIds: Array.from(new Set([...existing.blockIds, ...ref.blockIds])),
      bbox: existing.bbox || ref.bbox,
    })
  }
  return Array.from(grouped.values())
}

function shouldUseSolutionSections(markdown: string, sections: SolutionSection[]) {
  if (!sections.length) return false
  const first = sections[0]
  const before = detectQuestionNumbers(markdown.slice(0, first.start))
  if (!before.length) return false
  if (/参考|答案与解析|答案解析/.test(first.title)) return true
  const beforeNos = new Set(before.map((item) => item.questionNo).filter(Boolean))
  const afterNos = detectQuestionNumbers(markdown.slice(first.contentStart)).map((item) => item.questionNo)
  return afterNos.some((questionNo) => beforeNos.has(questionNo))
}

function solutionValue(fieldsValue: string, matchValue: string | undefined) {
  return fieldsValue.trim() || String(matchValue || '').trim()
}

function solutionRange(fieldsRange: MarkdownRange | undefined, matchRange: MarkdownRange | undefined) {
  return fieldsRange || matchRange
}

function candidateFromChunk(
  document: OCRDocument,
  chunk: QuestionMarkdownChunk,
  solution: SolutionMatch | undefined,
  duplicateNos: Set<string>,
  timestamp: string,
): QuestionCandidate {
  const fields = splitQuestionFields(chunk.body, chunk.contentStart)
  const answerText = solutionValue(fields.answerText, solution?.answerText)
  const analysisMarkdown = solutionValue(fields.analysisMarkdown, solution?.analysisMarkdown)
  const stemRange = fields.stemRange || { start: chunk.contentStart, end: chunk.end }
  const answerRange = solutionRange(fields.answerRange, solution?.answerRange)
  const analysisRange = solutionRange(fields.analysisRange, solution?.analysisRange)
  const figures = dedupeFigures([
    ...figuresForRange(document, stemRange, 'stem'),
    ...figuresForRange(document, analysisRange, 'analysis'),
  ])
  const sourceRefs = dedupeSourceRefs([
    ...sourceRefsForRange(document, stemRange, 'stem'),
    ...sourceRefsForRange(document, answerRange, 'answer'),
    ...sourceRefsForRange(document, analysisRange, 'analysis'),
  ])
  const candidate: QuestionCandidate = {
    id: createId('candidate', document.sourceDocumentId + '_' + (chunk.questionNo || 'unknown')),
    sourceDocumentId: document.sourceDocumentId,
    ocrDocumentId: document.id,
    questionNo: chunk.questionNo,
    stemMarkdown: fields.stemMarkdown,
    answerText,
    analysisMarkdown,
    knowledgePoints: [],
    solutionMethods: [],
    figures,
    sourceRefs,
    status: 'needs_review',
    issues: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  candidate.issues = validateQuestionCandidate(candidate, duplicateNos)
  candidate.status = statusForIssues(candidate.issues)
  return candidate
}

function fallbackCandidate(document: OCRDocument, timestamp: string): QuestionCandidate {
  const fields = splitQuestionFields(document.markdown || '', 0)
  const fullRange = document.markdown ? { start: 0, end: document.markdown.length } : undefined
  const candidate: QuestionCandidate = {
    id: createId('candidate', document.sourceDocumentId + '_unknown'),
    sourceDocumentId: document.sourceDocumentId,
    ocrDocumentId: document.id,
    questionNo: '',
    stemMarkdown: fields.stemMarkdown,
    answerText: fields.answerText,
    analysisMarkdown: fields.analysisMarkdown,
    knowledgePoints: [],
    solutionMethods: [],
    figures: figuresForRange(document, fields.stemRange || fullRange, 'stem'),
    sourceRefs: sourceRefsForRange(document, fields.stemRange || fullRange, 'stem'),
    status: 'needs_review',
    issues: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  candidate.issues = validateQuestionCandidate(candidate, new Set())
  candidate.status = statusForIssues(candidate.issues)
  return candidate
}

export function parseQuestionCandidates(document: OCRDocument, options: ParseQuestionCandidatesOptions = {}): QuestionCandidate[] {
  const timestamp = options.now || nowIso()
  const markdown = String(document.markdown || '')
  const solutionSections = findSolutionSections(markdown)
  const useSolutionSections = shouldUseSolutionSections(markdown, solutionSections)
  const questionMarkdown = useSolutionSections ? markdown.slice(0, solutionSections[0].start) : markdown
  const questionMatches = detectQuestionNumbers(questionMarkdown)
  const chunks = splitMarkdownByQuestionNumbers(questionMarkdown, questionMatches)

  if (!chunks.length) return [fallbackCandidate(document, timestamp)]

  const solutions = useSolutionSections ? extractSolutionMatches(markdown, solutionSections) : new Map<string, SolutionMatch>()
  const duplicateNos = duplicateQuestionNos(chunks)
  return chunks.map((chunk) => candidateFromChunk(document, chunk, solutions.get(chunk.questionNo), duplicateNos, timestamp))
}

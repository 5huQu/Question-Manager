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
import { figureForBlock, figuresForRange, sourceRefsForRange } from './figure-linker.js'
import { statusForIssues, validateQuestionCandidate } from './candidate-validator.js'
import { normalizeHtmlImageTags } from '../ocr-providers/ocr-document.normalizer.js'
import { getParserConfig } from './parser-config.js'
import type { ImportFlowV2ParserConfig } from './default-parser-config.js'

export type ParseQuestionCandidatesOptions = {
  now?: string
  config?: ImportFlowV2ParserConfig
}

function normalizedLine(value: string) {
  return value.replace(/^\s*(?:#{1,6}\s*)?/, '').replace(/\s+/g, '')
}

function normalizedStructuralLine(value: string) {
  return normalizedLine(value).replace(/^(?:第[0-9０-９]{1,3}题|[0-9０-９]{1,3}[.．、])/, '')
}

function isStructuralLine(line: string, config: ImportFlowV2ParserConfig) {
  const normalized = normalizedStructuralLine(line)
  if (!normalized) return false
  if (isSectionHeading(line, config)) return true
  return config.documentNoteKeywords.some((item) => normalized.startsWith(normalizedLine(item)))
}

function isSectionHeading(line: string, config: ImportFlowV2ParserConfig) {
  const normalized = normalizedStructuralLine(line)
  return config.sectionHeadings.some((item) => normalized === normalizedLine(item))
}

function hasPrimaryQuestionMarker(line: string, config: ImportFlowV2ParserConfig) {
  return config.primaryQuestionPatterns.some((pattern) => {
    const match = new RegExp(pattern, 'i').exec(line)
    return Boolean(match && /^[ \t#]*$/.test(line.slice(0, match.index)))
  })
}

function stripStructuralText(value: string, config: ImportFlowV2ParserConfig) {
  return String(value || '').split('\n').filter((line) => !isStructuralLine(line, config)).join('\n').trim()
}

function isReferenceFormulaHeading(line: string, config: ImportFlowV2ParserConfig) {
  const normalized = normalizedStructuralLine(line)
  return config.documentNoteKeywords.some((item) => normalized.startsWith(normalizedLine(item)) && normalizedLine(item).includes('参考公式'))
}

function isAnswerOrAnalysisMarker(line: string) {
  return /^\s*(?:【\s*)?(?:参考答案|答案与解析|答案|解析|分析|详解)(?:\s*】)?\s*[:：]?/.test(line)
}

function blankPreservingNewlines(value: string) {
  return value.replace(/[^\n]/g, ' ')
}

/**
 * Hide non-question material before detecting question numbers while preserving
 * every offset. This prevents numbered exam instructions and reference-formula
 * items from becoming artificial questions or cutting the preceding real one.
 */
function maskStructuralMarkdown(value: string, config: ImportFlowV2ParserConfig) {
  let inReferenceFormula = false
  let sawQuestion = false
  return String(value || '').split(/(?<=\n)/).map((lineWithNewline) => {
    const line = lineWithNewline.replace(/\n$/, '')
    if (inReferenceFormula && isAnswerOrAnalysisMarker(line)) {
      inReferenceFormula = false
      return lineWithNewline
    }
    if (inReferenceFormula && !sawQuestion && isSectionHeading(line, config)) {
      inReferenceFormula = false
    }
    if (inReferenceFormula) return blankPreservingNewlines(lineWithNewline)
    if (!isStructuralLine(line, config)) {
      if (hasPrimaryQuestionMarker(line, config)) sawQuestion = true
      return lineWithNewline
    }
    if (isReferenceFormulaHeading(line, config)) inReferenceFormula = true
    return blankPreservingNewlines(lineWithNewline)
  }).join('')
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
  return Array.from(new Map(figures.map((figure) => [`${figure.usage}:${figure.path}`, figure])).values())
}

function figuresForMarkdown(markdown: string, usage: CandidateFigure['usage']): CandidateFigure[] {
  const figures: CandidateFigure[] = []
  const pattern = /!\[[^\]]*]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))\s*\)/g
  for (const match of normalizeHtmlImageTags(markdown).matchAll(pattern)) {
    const path = String(match[1] || match[2] || '').replace(/\\\)/g, ')').trim()
    if (!path) continue
    figures.push({
      id: `inline_${usage}_${createId('image', path)}`,
      usage,
      path,
      inlineMarker: String(match.index ?? path),
    })
  }
  return figures
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

function figureBelongsToRef(block: OCRDocument['pages'][number]['blocks'][number], ref: CandidateSourceRef) {
  if (block.pageNo !== ref.pageNo) return false
  if (!block.bbox || !ref.bbox) return false
  const centerY = (block.bbox[1] + block.bbox[3]) / 2
  return centerY >= ref.bbox[1] && centerY <= ref.bbox[3]
}

function attachImageBlocks(document: OCRDocument, chunks: QuestionMarkdownChunk[], candidates: QuestionCandidate[], config: ImportFlowV2ParserConfig) {
  const imageBlocks = document.pages.flatMap((page) => page.blocks)
    .filter((block) => block.type === 'image' || block.assetId)
  const attached = new Set(candidates.flatMap((candidate) => candidate.figures.map((figure) => figure.sourceBlockId).filter(Boolean)))
  for (const block of imageBlocks) {
    if (attached.has(block.id)) continue
    let index = candidates.findIndex((candidate) => candidate.sourceRefs.some((ref) => figureBelongsToRef(block, ref)))
    if (index < 0 && block.markdownStart !== undefined) {
      index = chunks.findIndex((chunk) => block.markdownStart! >= chunk.start && block.markdownStart! < chunk.end)
    }
    if (index < 0 && block.bbox) {
      const samePage = candidates.map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .filter(({ candidate }) => candidate.sourceRefs.some((ref) => ref.pageNo === block.pageNo && ref.bbox))
        .map(({ candidate, candidateIndex }) => ({
          candidateIndex,
          bottom: Math.max(...candidate.sourceRefs.filter((ref) => ref.pageNo === block.pageNo && ref.bbox).map((ref) => ref.bbox![3])),
        }))
        .filter((item) => item.bottom <= block.bbox![1])
      if (samePage.length) index = samePage.sort((left, right) => right.bottom - left.bottom)[0].candidateIndex
    }
    if (index < 0) {
      const likelyFigureCandidates = candidates.map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .filter(({ candidate }) => candidate.sourceRefs.some((ref) => ref.pageNo === block.pageNo))
        .filter(({ candidate }) => config.figureKeywords.some((keyword) => candidate.stemMarkdown.includes(keyword)))
      if (likelyFigureCandidates.length) index = likelyFigureCandidates[likelyFigureCandidates.length - 1].candidateIndex
    }
    if (index < 0) {
      const fallback = candidates[candidates.length - 1]
      fallback.issues.push({ code: 'unplaced_figure', severity: 'warning', message: `有一张图片（${block.id}）未能可靠归属到题目，请核对。`, relatedBlockIds: [block.id] })
      fallback.status = statusForIssues(fallback.issues)
      continue
    }
    const figure = figureForBlock(document, block, 'stem')
    if (!figure) continue
    candidates[index].figures = dedupeFigures([...candidates[index].figures, figure])
    candidates[index].sourceRefs = dedupeSourceRefs([...candidates[index].sourceRefs, {
      pageNo: block.pageNo,
      blockIds: [block.id],
      bbox: block.bbox,
      kind: 'figure',
    }])
    attached.add(block.id)
  }
}

function shouldUseSolutionSections(markdown: string, sections: SolutionSection[], config: ImportFlowV2ParserConfig) {
  if (!sections.length) return false
  const first = sections[0]
  const before = detectQuestionNumbers(markdown.slice(0, first.start), config)
  if (!before.length) return false
  if (/参考|答案与解析|答案解析/.test(first.title)) return true
  const beforeNos = new Set(before.map((item) => item.questionNo).filter(Boolean))
  const afterNos = detectQuestionNumbers(markdown.slice(first.contentStart), config).map((item) => item.questionNo)
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
  config: ImportFlowV2ParserConfig,
): QuestionCandidate {
  const fields = splitQuestionFields(stripStructuralText(chunk.body, config), chunk.contentStart)
  const answerText = solutionValue(fields.answerText, solution?.answerText)
  const analysisMarkdown = solutionValue(fields.analysisMarkdown, solution?.analysisMarkdown)
  const stemRange = fields.stemRange || { start: chunk.contentStart, end: chunk.end }
  const answerRange = solutionRange(fields.answerRange, solution?.answerRange)
  const analysisRange = solutionRange(fields.analysisRange, solution?.analysisRange)
  const figures = dedupeFigures([
    ...figuresForRange(document, stemRange, 'stem'),
    ...figuresForRange(document, analysisRange, 'analysis'),
    ...figuresForMarkdown(fields.stemMarkdown, 'stem'),
    ...figuresForMarkdown(analysisMarkdown, 'analysis'),
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

function fallbackCandidate(document: OCRDocument, timestamp: string, config: ImportFlowV2ParserConfig): QuestionCandidate {
  const fields = splitQuestionFields(stripStructuralText(document.markdown || '', config), 0)
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
    figures: dedupeFigures([
      ...figuresForRange(document, fields.stemRange || fullRange, 'stem'),
      ...figuresForMarkdown(fields.stemMarkdown, 'stem'),
      ...figuresForMarkdown(fields.analysisMarkdown, 'analysis'),
    ]),
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
  const config = options.config || getParserConfig()
  const markdown = normalizeHtmlImageTags(String(document.markdown || ''))
  const solutionSections = findSolutionSections(markdown, config)
  const useSolutionSections = shouldUseSolutionSections(markdown, solutionSections, config)
  const maskedMarkdown = maskStructuralMarkdown(markdown, config)
  const questionMarkdown = useSolutionSections ? maskedMarkdown.slice(0, solutionSections[0].start) : maskedMarkdown
  const questionMatches = detectQuestionNumbers(questionMarkdown, config)
  const chunks = splitMarkdownByQuestionNumbers(questionMarkdown, questionMatches)

  if (!chunks.length) return [fallbackCandidate(document, timestamp, config)]

  const solutions = useSolutionSections ? extractSolutionMatches(markdown, solutionSections, config) : new Map<string, SolutionMatch>()
  const duplicateNos = duplicateQuestionNos(chunks)
  const candidates = chunks.map((chunk) => candidateFromChunk(document, chunk, solutions.get(chunk.questionNo), duplicateNos, timestamp, config))
  attachImageBlocks(document, chunks, candidates, config)
  return candidates
}

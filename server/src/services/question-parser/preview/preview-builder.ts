import type { OCRDocument } from '../../../types/ocr-document.js'
import type { QuestionCandidate } from '../../../types/question-candidate.js'
import {
  type ImportFlowV2ParserConfig,
  type SolutionBindingStrategy,
} from '../default-parser-config.js'
import { parserConfigForRequest } from '../parser-config.js'
import { detectSolutionQuestionNumbers } from '../question-number-detector.js'
import {
  extractInlineAnswerTableBlocks,
  extractHtmlAnswerTableBlocks,
  findSolutionSections,
  maskNonSolutionBlocks,
  metadataBlockRanges,
  type MarkdownRange,
} from '../solution-matcher.js'
import { parseSolutionDocument } from '../solution-document.parser.js'
import { candidatePreviewsFromMatches, diagnosticsForCandidate, recognizedCandidateDiagnostics, strategyDiagnostics } from './diagnostics.js'
import { cleanPreviewText, lineOffsetsFor, PAGE_MARKER_RE, textForRange, tokenFor } from './markdown-utils.js'
import { applyAnswerTablePolicy, cloneMatches, extractQuestionThenHeadingMatches } from './match-extraction.js'
import { extractAnswerTableEntries, isMetadataLike, metadataKeywordForLine } from './section-detection.js'
import type {
  CandidateParsePreview,
  LineOffset,
  MarkdownStructureToken,
  MarkdownStructureTokenKind,
  ParserDiagnostic,
  ParserPreviewRequest,
  ParserPreviewResponse,
  PreviewSolutionMatch,
} from './types.js'

function sourceRangeForCandidateKind(document: OCRDocument, candidate: QuestionCandidate, kind: 'stem' | 'answer' | 'analysis'): MarkdownRange | undefined {
  const candidateText = String({
    stem: candidate.stemMarkdown,
    answer: candidate.answerText,
    analysis: candidate.analysisMarkdown,
  }[kind] || '')
  if (candidateText && (kind !== 'answer' || candidateText.length >= 8)) {
    const exactStart = String(document.markdown || '').indexOf(candidateText)
    if (exactStart >= 0) return { start: exactStart, end: exactStart + candidateText.length }
  }

  const blockIds = new Set(
    candidate.sourceRefs
      .filter((ref) => ref.kind === kind)
      .flatMap((ref) => ref.blockIds || [])
      .map(String),
  )
  if (!blockIds.size) return undefined
  const ranges = document.pages
    .flatMap((page) => page.blocks)
    .filter((block) => blockIds.has(block.id) && typeof block.markdownStart === 'number' && typeof block.markdownEnd === 'number')
    .map((block) => ({ start: block.markdownStart!, end: block.markdownEnd! }))
    .filter((range) => range.end > range.start)
  if (!ranges.length) return undefined
  return {
    start: Math.min(...ranges.map((range) => range.start)),
    end: Math.max(...ranges.map((range) => range.end)),
  }
}

function collectStructureTokens(markdown: string, lines: LineOffset[], config: ImportFlowV2ParserConfig): MarkdownStructureToken[] {
  const tokens: MarkdownStructureToken[] = []
  for (const match of markdown.matchAll(PAGE_MARKER_RE)) {
    const start = match.index || 0
    const token = tokenFor(lines, {
      id: `page:${start}`,
      kind: 'page_marker',
      start,
      end: start + match[0].length,
      label: `第 ${match[1]} 页`,
      severity: 'info',
    })
    if (token) tokens.push(token)
  }

  const questionDetectionMarkdown = maskNonSolutionBlocks(markdown, config)
  for (const match of detectSolutionQuestionNumbers(questionDetectionMarkdown, config)) {
    const token = tokenFor(lines, {
      id: `question:${match.start}:${match.questionNo}`,
      kind: 'question_no',
      questionNo: match.questionNo,
      start: match.start,
      end: match.contentStart,
      label: `第 ${match.questionNo} 题`,
      severity: 'info',
    })
    if (token) tokens.push(token)
  }

  if (config.answerTablePolicy !== 'disabled') {
    for (const table of extractHtmlAnswerTableBlocks(markdown)) {
      const token = tokenFor(lines, {
        id: `answer-table:${table.start}`,
        kind: 'answer_table',
        start: table.start,
        end: table.end,
        label: table.kind === 'manual' ? '人工答案表' : table.kind === 'inferred' ? '推断答案表' : '答案表',
        severity: 'info',
      })
      if (token) tokens.push(token)
    }

    for (const block of extractInlineAnswerTableBlocks(markdown)) {
      const token = tokenFor(lines, {
        id: `inline-answer-table:${block.start}`,
        kind: 'answer_table',
        start: block.start,
        end: block.end,
        label: '答案表',
        severity: 'info',
      })
      if (token) tokens.push(token)
    }
  }

  for (const section of findSolutionSections(markdown, config)) {
    const token = tokenFor(lines, {
      id: `solution-heading:${section.start}`,
      kind: 'solution_heading',
      start: section.start,
      end: section.contentStart,
      label: section.title,
      severity: 'info',
    })
    if (token) tokens.push(token)
  }

  for (const range of metadataBlockRanges(markdown, config)) {
    const firstLineEnd = markdown.indexOf('\n', range.start)
    const line = markdown.slice(range.start, firstLineEnd >= 0 && firstLineEnd < range.end ? firstLineEnd : range.end)
    const keyword = metadataKeywordForLine(line, config) || '说明块'
    if (keyword) {
      const token = tokenFor(lines, {
        id: `metadata:${range.start}`,
        kind: 'metadata_heading',
        start: range.start,
        end: range.end,
        label: keyword,
        severity: 'warning',
      })
      if (token) tokens.push(token)
    }
  }

  return tokens
}

function buildStrategyPreview(
  document: OCRDocument,
  config: ImportFlowV2ParserConfig,
  strategy: Exclude<SolutionBindingStrategy, 'auto'>,
) {
  const markdown = String(document.markdown || '')
  const nextConfig = { ...config, solutionBindingStrategy: strategy }
  const matches = strategy === 'question_then_heading'
    ? extractQuestionThenHeadingMatches(markdown, nextConfig)
    : cloneMatches(parseSolutionDocument(document, { config: nextConfig }))
  const tableDiagnostics = applyAnswerTablePolicy(matches, extractAnswerTableEntries(markdown, nextConfig), nextConfig)
  const diagnostics = [...strategyDiagnostics(markdown, nextConfig), ...tableDiagnostics]

  for (const [questionNo, match] of matches) {
    if (isMetadataLike(match.answerText, nextConfig)) {
      diagnostics.push({
        code: 'metadata_used_as_answer',
        severity: 'warning',
        questionNo,
        message: `第 ${questionNo} 题的答案看起来像说明块内容，建议忽略说明块或允许答案表覆盖。`,
        start: match.answerRange?.start,
        end: match.answerRange?.end,
        suggestedConfigPatch: { metadataBlockPolicy: 'ignore', answerTablePolicy: 'override_metadata_like_answer' },
      })
    }
  }

  const candidatePreviews = candidatePreviewsFromMatches(markdown, matches, diagnostics)
  const score = candidatePreviews.reduce((total, preview) => {
    const answerScore = preview.answerPreview ? 2 : 0
    const analysisScore = preview.analysisPreview ? 3 : 0
    const issuePenalty = preview.issues.filter((issue) => issue.severity !== 'info').length
    return total + answerScore + analysisScore - issuePenalty
  }, 0) - diagnostics.filter((diagnostic) => diagnostic.severity !== 'info').length

  return { candidatePreviews, diagnostics, score }
}

function rangeTokensForPreviews(lines: LineOffset[], previews: CandidateParsePreview[], focusQuestionNo?: string) {
  const tokens: MarkdownStructureToken[] = []
  for (const preview of previews) {
    for (const kind of ['stem', 'answer', 'analysis'] as const) {
      const range = preview.sourceRanges[kind]
      if (!range) continue
      const token = tokenFor(lines, {
        id: `${kind}-range:${preview.questionNo}:${range.start}`,
        kind: `${kind}_range` as MarkdownStructureTokenKind,
        questionNo: preview.questionNo,
        start: range.start,
        end: range.end,
        label: `第 ${preview.questionNo} 题${kind === 'stem' ? '题干' : kind === 'answer' ? '答案' : '解析'}范围`,
        severity: focusQuestionNo && preview.questionNo === focusQuestionNo ? 'warning' : 'info',
      })
      if (token) tokens.push(token)
    }
  }
  return tokens
}

function currentCandidatePreview(document: OCRDocument, candidate: QuestionCandidate): CandidateParsePreview {
  const sourceRanges = {
    stem: sourceRangeForCandidateKind(document, candidate, 'stem'),
    answer: sourceRangeForCandidateKind(document, candidate, 'answer'),
    analysis: sourceRangeForCandidateKind(document, candidate, 'analysis'),
  }
  return {
    questionNo: candidate.questionNo,
    stemPreview: cleanPreviewText(candidate.stemMarkdown),
    answerPreview: cleanPreviewText(candidate.answerText),
    analysisPreview: cleanPreviewText(candidate.analysisMarkdown),
    sourceRanges,
    issues: [],
  }
}

function candidateHasSourceRange(preview: CandidateParsePreview) {
  return Boolean(preview.sourceRanges.stem || preview.sourceRanges.answer || preview.sourceRanges.analysis)
}

function recognizedQuestionTokensForPreviews(lines: LineOffset[], previews: CandidateParsePreview[]) {
  const tokens: MarkdownStructureToken[] = []
  for (const preview of previews) {
    for (const [kind, range] of Object.entries(preview.sourceRanges) as Array<[keyof CandidateParsePreview['sourceRanges'], MarkdownRange | undefined]>) {
      if (!range) continue
      const token = tokenFor(lines, {
        id: `recognized-question:${preview.questionNo}:${kind}:${range.start}`,
        kind: 'question_no',
        questionNo: preview.questionNo,
        start: range.start,
        end: Math.min(range.end, range.start + 1),
        label: `第 ${preview.questionNo} 题`,
        severity: 'info',
      })
      if (token) tokens.push(token)
    }
  }
  return tokens
}

export function buildParserPreview(
  document: OCRDocument,
  request: ParserPreviewRequest = {},
  candidate?: QuestionCandidate,
  recognizedCandidates: QuestionCandidate[] = [],
): ParserPreviewResponse {
  const config = parserConfigForRequest(request)
  const markdown = String(document.markdown || '')
  const lines = lineOffsetsFor(markdown)
  const focusQuestionNo = request.focusQuestionNo || candidate?.questionNo || ''

  const headingPreview = buildStrategyPreview(document, config, 'heading_then_question')
  const questionPreview = buildStrategyPreview(document, config, 'question_then_heading')
  const selectedStrategy = config.solutionBindingStrategy === 'auto'
    ? questionPreview.score > headingPreview.score ? 'question_then_heading' : 'heading_then_question'
    : config.solutionBindingStrategy
  const selected = selectedStrategy === 'question_then_heading' ? questionPreview : headingPreview

  const constrainedCandidates = recognizedCandidates.length ? recognizedCandidates : candidate ? [candidate] : []
  const constrainedPreviews = constrainedCandidates
    .map((item) => currentCandidatePreview(document, item))
    .filter(candidateHasSourceRange)
  const candidateDiagnostics = diagnosticsForCandidate(candidate, config)
  let candidatePreviews = recognizedCandidates.length ? constrainedPreviews : selected.candidatePreviews
  if (candidate && !candidatePreviews.some((preview) => preview.questionNo === candidate.questionNo)) {
    const currentPreview = currentCandidatePreview(document, candidate)
    if (candidateHasSourceRange(currentPreview)) candidatePreviews = [currentPreview, ...candidatePreviews]
  }

  const collectedStructures = collectStructureTokens(markdown, lines, config)
  const structures = [
    ...(recognizedCandidates.length
      ? collectedStructures.filter((token) => token.kind !== 'question_no')
      : collectedStructures),
    ...(recognizedCandidates.length ? recognizedQuestionTokensForPreviews(lines, candidatePreviews) : []),
    ...rangeTokensForPreviews(lines, candidatePreviews, focusQuestionNo),
  ].sort((left, right) => left.start - right.start || left.end - right.end)

  const scoreDelta = Math.abs(questionPreview.score - headingPreview.score)
  const strategyRecommendation = config.solutionBindingStrategy === 'auto' || scoreDelta > 0
    ? {
        strategy: selectedStrategy,
        reason: selectedStrategy === 'question_then_heading'
          ? '检测到题号后接说明块或参考答案标题，试运行结果能绑定更多解析内容。'
          : '检测到参考答案标题后继续出现题号，当前标题后切题策略更匹配。',
        confidence: Math.min(0.95, 0.55 + scoreDelta / Math.max(10, Math.abs(questionPreview.score) + Math.abs(headingPreview.score) + 1)),
      }
    : undefined

  return {
    config,
    strategyRecommendation,
    structures,
    candidatePreviews: candidatePreviews.slice(0, 200),
    diagnostics: recognizedCandidates.length
      ? recognizedCandidateDiagnostics(recognizedCandidates)
      : [...selected.diagnostics, ...candidateDiagnostics],
  }
}

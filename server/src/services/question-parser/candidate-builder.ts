import type { OCRDocument } from '../../types/ocr-document.js'
import type { CandidateFigure, CandidateIssue, QuestionCandidate } from '../../types/question-candidate.js'
import type { ImportFlowV2ParserConfig } from './default-parser-config.js'
import type { QuestionMarkdownChunk } from './markdown-question-splitter.js'
import type { SolutionMatch } from './solution-matcher.js'
import type { PaperKind } from '../../utils/import-metadata.js'
import { createId } from '../../utils/ids.js'
import { DEFAULT_IMPORT_METADATA } from '../../utils/import-metadata.js'
import { normalizeQuestionType } from '../../utils/question-type.js'
import { splitQuestionFields } from './solution-matcher.js'
import { figuresForRange, isLikelyPageChromeFigureId, sourceRefsForRange } from './figure-linker.js'
import { statusForIssues, validateQuestionCandidate } from './candidate-validator.js'
import { cleanOcrPresentationMarkdown } from './presentation-cleanup.js'
import { maskStructuralText } from './structural-detection.js'
import { dedupeFigures, stripRepeatedQuestionMarker } from './chunk-processing.js'
import { figuresForMarkdown, dedupeSourceRefs } from './figure-extraction.js'
import { solutionValue, solutionRange } from './solution-extraction.js'

export function candidateIssuesForSolutionWarnings(solution: SolutionMatch | undefined): CandidateIssue[] {
  return (solution?.warnings || []).map((message) => ({
    code: 'manual_review_required',
    severity: 'warning',
    message,
  }))
}

export function candidateFromChunk(
  document: OCRDocument,
  chunk: QuestionMarkdownChunk,
  solution: SolutionMatch | undefined,
  duplicateNos: Set<string>,
  timestamp: string,
  config: ImportFlowV2ParserConfig,
  paperKind: PaperKind,
): QuestionCandidate {
  const fields = splitQuestionFields(maskStructuralText(chunk.body, config), chunk.contentStart)
  const stemMarkdown = stripRepeatedQuestionMarker(cleanOcrPresentationMarkdown(fields.stemMarkdown, config), chunk.questionNo)
  const answerText = cleanOcrPresentationMarkdown(solutionValue(fields.answerText, solution?.answerText), config)
  const analysisMarkdown = cleanOcrPresentationMarkdown(solutionValue(fields.analysisMarkdown, solution?.analysisMarkdown), config)
  const stemRange = fields.stemRange || { start: chunk.contentStart, end: chunk.end }
  const answerRange = solutionRange(fields.answerRange, solution?.answerRange)
  const analysisRange = solutionRange(fields.analysisRange, solution?.analysisRange)
  const figures = dedupeFigures([
    ...figuresForRange(document, stemRange, 'stem'),
    ...figuresForRange(document, answerRange, 'analysis'),
    ...figuresForRange(document, analysisRange, 'analysis'),
    ...figuresForMarkdown(stemMarkdown, 'stem', document.sourceDocumentId),
    ...figuresForMarkdown(answerText, 'analysis', document.sourceDocumentId),
    ...figuresForMarkdown(analysisMarkdown, 'analysis', document.sourceDocumentId),
  ])
  const sourceRefs = dedupeSourceRefs([
    ...sourceRefsForRange(document, stemRange, 'stem'),
    ...sourceRefsForRange(document, answerRange, 'answer'),
    ...sourceRefsForRange(document, analysisRange, 'analysis'),
  ])
  const candidate: QuestionCandidate = {
    id: createId('candidate', chunk.questionNo || 'unknown'),
    sourceDocumentId: document.sourceDocumentId,
    ocrDocumentId: document.id,
    questionNo: chunk.questionNo,
    stemMarkdown,
    answerText,
    analysisMarkdown,
    questionType: normalizeQuestionType('', stemMarkdown, answerText),
    knowledgePoints: [],
    solutionMethods: [],
    figures,
    sourceRefs,
    status: 'needs_review',
    ...DEFAULT_IMPORT_METADATA,
    paperKind,
    issues: [],
    parseDiagnostics: [],
    parserConfigSnapshot: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  candidate.issues = validateQuestionCandidate(candidate, duplicateNos)
  for (const issue of candidateIssuesForSolutionWarnings(solution)) {
    if (!candidate.issues.some((item) => item.code === issue.code && item.message === issue.message)) {
      candidate.issues.push(issue)
    }
  }
  candidate.status = statusForIssues(candidate.issues)
  return candidate
}

export function fallbackCandidate(document: OCRDocument, timestamp: string, config: ImportFlowV2ParserConfig, paperKind: PaperKind): QuestionCandidate {
  const fields = splitQuestionFields(maskStructuralText(document.markdown || '', config), 0)
  const stemMarkdown = cleanOcrPresentationMarkdown(fields.stemMarkdown, config)
  const answerText = cleanOcrPresentationMarkdown(fields.answerText, config)
  const analysisMarkdown = cleanOcrPresentationMarkdown(fields.analysisMarkdown, config)
  const fullRange = document.markdown ? { start: 0, end: document.markdown.length } : undefined
  const candidate: QuestionCandidate = {
    id: createId('candidate', 'unknown'),
    sourceDocumentId: document.sourceDocumentId,
    ocrDocumentId: document.id,
    questionNo: '',
    stemMarkdown,
    answerText,
    analysisMarkdown,
    questionType: normalizeQuestionType('', stemMarkdown, answerText),
    knowledgePoints: [],
    solutionMethods: [],
    figures: dedupeFigures([
      ...figuresForRange(document, fields.stemRange || fullRange, 'stem'),
      ...figuresForMarkdown(stemMarkdown, 'stem', document.sourceDocumentId),
      ...figuresForMarkdown(answerText, 'analysis', document.sourceDocumentId),
      ...figuresForMarkdown(analysisMarkdown, 'analysis', document.sourceDocumentId),
    ]),
    sourceRefs: sourceRefsForRange(document, fields.stemRange || fullRange, 'stem'),
    status: 'needs_review',
    ...DEFAULT_IMPORT_METADATA,
    paperKind,
    issues: [],
    parseDiagnostics: [],
    parserConfigSnapshot: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  candidate.issues = validateQuestionCandidate(candidate, new Set())
  candidate.status = statusForIssues(candidate.issues)
  return candidate
}

export function fillDoc2xFigures(
  document: OCRDocument,
  stemMarkdown: string,
  answerMarkdown: string,
  analysisMarkdown: string,
  existingFigures: CandidateFigure[],
): { figures: CandidateFigure[]; ignoredFigureIds: string[]; warnings: string[] } {
  const figures = [...existingFigures]
  const ignoredFigureIds = new Set<string>()
  const warnings: string[] = []

  const DOC2X_FIGURE_MARKER_RE = /<!--\s*DOC2X_FIGURE:([^\s>]+)\s*-->/g
  const optionLabels = new Map<string, string>()
  for (const match of stemMarkdown.matchAll(/(?:^|\n)\s*([A-H])[.．、]\s*\n?\s*<!--\s*DOC2X_FIGURE:([^\s>]+)\s*-->/g)) {
    optionLabels.set(match[2], match[1].toUpperCase())
  }

  const scan = (markdown: string, usage: CandidateFigure['usage']) => {
    if (!markdown) return
    const matches = Array.from(markdown.matchAll(DOC2X_FIGURE_MARKER_RE))
    for (const match of matches) {
      const figureId = match[1]
      const optionLabel = usage === 'stem' ? optionLabels.get(figureId) : undefined
      const resolvedUsage: CandidateFigure['usage'] = optionLabel ? 'options' : usage
      if (isLikelyPageChromeFigureId(document, figureId)) {
        ignoredFigureIds.add(figureId)
        continue
      }

      const exists = figures.find((f) => f.id === figureId || f.blockId === figureId)
      if (exists) {
        if (exists.usage !== resolvedUsage) {
          exists.usage = resolvedUsage
        }
        exists.optionLabel = optionLabel
        continue
      }

      const asset = document.assets.find((a) => a.id === figureId)
      const block = document.pages.flatMap((p) => p.blocks).find((b) => b.id === figureId || b.assetId === figureId)

      let path = asset?.path || block?.content || ''

      if (path && /^https?:\/\//i.test(path)) {
        warnings.push(`题图下载本地化失败，保留远程 URL: ${path}`)
      }

      const newFig: CandidateFigure = {
        id: figureId,
        blockId: figureId,
        usage: resolvedUsage,
        path: path || figureId,
        sourceBlockId: asset?.sourceBlockId || block?.id,
        pageNo: asset?.pageNo || block?.pageNo || 1,
        bbox: asset?.bbox || block?.bbox,
        optionLabel,
      }
      figures.push(newFig)
    }
  }

  scan(stemMarkdown, 'stem')
  scan(answerMarkdown, 'analysis')
  scan(analysisMarkdown, 'analysis')

  const finalFigures = figures.filter((figure) => {
    const ids = [figure.id, figure.blockId, figure.sourceBlockId].filter(Boolean).map(String)
    return !ids.some((id) => ignoredFigureIds.has(id))
  })
  return { figures: dedupeFigures(finalFigures), ignoredFigureIds: Array.from(ignoredFigureIds), warnings }
}

export function removeDoc2xFigureMarkers(markdown: string, figureIds: string[]) {
  let next = String(markdown || '')
  for (const id of figureIds) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    next = next.replace(new RegExp(`\\n?\\s*<!--\\s*DOC2X_FIGURE:${escaped}\\s*-->\\s*\\n?`, 'g'), '\n')
  }
  return next.replace(/\n{3,}/g, '\n\n').trim()
}

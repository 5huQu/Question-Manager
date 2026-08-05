import type { OCRDocument } from '../../types/ocr-document.js'
import type { QuestionCandidate } from '../../types/question-candidate.js'
import { nowIso } from '../../utils/ids.js'
import { detectQuestionNumbers } from './question-number-detector.js'
import { splitMarkdownByQuestionNumbers } from './markdown-question-splitter.js'
import { findSolutionSections } from './solution-matcher.js'
import { statusForIssues, validateQuestionCandidate } from './candidate-validator.js'
import { normalizeHtmlImageTags } from '../ocr-providers/ocr-document.normalizer.js'
import { getParserConfig } from './parser-config.js'
import type { ImportFlowV2ParserConfig } from './default-parser-config.js'
import type { PaperKind } from '../../utils/import-metadata.js'
import {
  classifyQuestionDocumentLayout,
} from './document-layout.classifier.js'
import { maskStructuralMarkdown, maskLectureNonQuestionSections } from './structural-detection.js'
import { duplicateQuestionNos, mergeDuplicateContinuationChunks } from './chunk-processing.js'
import { attachImageBlocks, reassignStandaloneFigureBlocks } from './figure-extraction.js'
import { cleanQuestionMatchesForLayout, extractAppendixSolutionMatches } from './solution-extraction.js'
import type { SolutionMatch } from './solution-matcher.js'
import { candidateFromChunk, fallbackCandidate, fillDoc2xFigures, removeDoc2xFigureMarkers } from './candidate-builder.js'

export type ParseQuestionCandidatesOptions = {
  now?: string
  config?: ImportFlowV2ParserConfig
  paperKind?: PaperKind
}

function alignDocumentBlockOffsets(document: OCRDocument, markdown: string): OCRDocument {
  let cursor = 0
  return {
    ...document,
    markdown,
    pages: document.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((block) => {
        // GLM image blocks carry a signed URL as content, while the markdown
        // contains the stable DOC2X_FIGURE marker instead. Align to that
        // marker first; stale provider offsets can otherwise make a figure
        // overlap the following question.
        if (block.assetId) {
          const marker = `<!-- DOC2X_FIGURE:${block.assetId} -->`
          const markerIndex = markdown.indexOf(marker, cursor)
          if (markerIndex >= 0) {
            cursor = markerIndex + marker.length
            return {
              ...block,
              markdownStart: markerIndex,
              markdownEnd: cursor,
            }
          }
        }
        const content = String(block.content || '')
        if (!content.trim()) return block
        const index = markdown.indexOf(content, cursor)
        if (index < 0) return block
        cursor = index + content.length
        return {
          ...block,
          markdownStart: index,
          markdownEnd: cursor,
        }
      }),
    })),
  }
}

export function parseQuestionCandidates(document: OCRDocument, options: ParseQuestionCandidatesOptions = {}): QuestionCandidate[] {
  const timestamp = options.now || nowIso()
  const config = options.config || getParserConfig()
  const paperKind = options.paperKind || 'unknown'
  const markdown = normalizeHtmlImageTags(String(document.markdown || ''))
  const alignedDocument = alignDocumentBlockOffsets(document, markdown)
  const lectureAwareMarkdown = paperKind === 'lecture' ? maskLectureNonQuestionSections(markdown, config) : markdown
  const maskedMarkdown = maskStructuralMarkdown(lectureAwareMarkdown, config)
  const classification = classifyQuestionDocumentLayout(markdown, config, { detectionMarkdown: maskedMarkdown })
  const solutionSections = findSolutionSections(markdown, config)
  const useAppendixSolutions = classification.cleaningRule === 'same_document_appendix' && classification.solutionStart !== undefined
  const questionMarkdown = classification.cleaningRule === 'solution_document_only'
    ? ''
    : useAppendixSolutions
      ? maskedMarkdown.slice(0, classification.solutionStart)
      : maskedMarkdown
  const detectedQuestionMatches = detectQuestionNumbers(questionMarkdown, config)
  const questionMatches = paperKind === 'lecture'
    ? detectedQuestionMatches
    : cleanQuestionMatchesForLayout(questionMarkdown, detectedQuestionMatches, classification, config)
  const chunks = mergeDuplicateContinuationChunks(questionMarkdown, splitMarkdownByQuestionNumbers(questionMarkdown, questionMatches), config)

  let candidates: QuestionCandidate[] = []
  if (!chunks.length) {
    candidates = paperKind === 'lecture' ? [] : [fallbackCandidate(alignedDocument, timestamp, config, paperKind)]
  } else {
    const solutions = useAppendixSolutions
      ? extractAppendixSolutionMatches(markdown, classification.solutionStart!, solutionSections, config, chunks.map((chunk) => chunk.questionNo))
      : new Map<string, SolutionMatch>()
    const duplicateNos = duplicateQuestionNos(chunks)
    candidates = chunks.map((chunk) => candidateFromChunk(alignedDocument, chunk, solutions.get(chunk.questionNo), duplicateNos, timestamp, config, paperKind))
    attachImageBlocks(alignedDocument, chunks, candidates, config)
    reassignStandaloneFigureBlocks(alignedDocument, candidates)
  }

  if (paperKind === 'lecture') {
    candidates.forEach((candidate, index) => {
      candidate.questionNo = String(index + 1)
      const liveValidationCodes = new Set(['missing_question_no', 'duplicate_question_no', 'missing_stem', 'missing_answer', 'missing_analysis'])
      const baseIssues = candidate.issues.filter((item) => !liveValidationCodes.has(item.code))
      candidate.issues = validateQuestionCandidate({ ...candidate, issues: baseIssues }, new Set())
      candidate.status = statusForIssues(candidate.issues)
    })
  }

  for (const candidate of candidates) {
    const { figures: finalFigures, ignoredFigureIds, warnings } = fillDoc2xFigures(
      alignedDocument,
      candidate.stemMarkdown,
      candidate.answerText,
      candidate.analysisMarkdown,
      candidate.figures
    )
    candidate.figures = finalFigures
    if (ignoredFigureIds.length) {
      candidate.stemMarkdown = removeDoc2xFigureMarkers(candidate.stemMarkdown, ignoredFigureIds)
      candidate.answerText = removeDoc2xFigureMarkers(candidate.answerText, ignoredFigureIds)
      candidate.analysisMarkdown = removeDoc2xFigureMarkers(candidate.analysisMarkdown, ignoredFigureIds)
    }

    if (warnings.length > 0) {
      for (const w of warnings) {
        if (!candidate.issues.some((issue) => issue.message === w)) {
          candidate.issues.push({
            code: 'image_download_failed',
            severity: 'warning',
            message: w,
          })
        }
      }
      candidate.status = statusForIssues(candidate.issues)
    }
  }

  return candidates
}

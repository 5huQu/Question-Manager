import type { OCRDocument } from '../../types/ocr-document.js'
import type { CandidateFigure, CandidateIssue, CandidateSourceRef, QuestionCandidate } from '../../types/question-candidate.js'
import { createId, nowIso } from '../../utils/ids.js'
import { DEFAULT_IMPORT_METADATA } from '../../utils/import-metadata.js'
import { detectQuestionNumbers, detectSolutionQuestionNumbers, type QuestionNumberMatch } from './question-number-detector.js'
import { splitMarkdownByQuestionNumbers, type QuestionMarkdownChunk } from './markdown-question-splitter.js'
import {
  extractSolutionMatches,
  firstAnswerTableStart,
  findSolutionSections,
  maskNonSolutionBlocks,
  splitQuestionFields,
  type MarkdownRange,
  type SolutionMatch,
  type SolutionSection,
} from './solution-matcher.js'
import { figureForBlock, figuresForRange, isLikelyPageChromeBlock, isLikelyPageChromeFigureId, sourceRefsForRange } from './figure-linker.js'
import { statusForIssues, validateQuestionCandidate } from './candidate-validator.js'
import { normalizeHtmlImageTags } from '../ocr-providers/ocr-document.normalizer.js'
import { getParserConfig } from './parser-config.js'
import type { ImportFlowV2ParserConfig } from './default-parser-config.js'
import { normalizeQuestionType } from '../../utils/question-type.js'
import { cleanOcrPresentationMarkdown } from './presentation-cleanup.js'
import {
  classifyQuestionDocumentLayout,
  type QuestionDocumentLayoutClassification,
} from './document-layout.classifier.js'
import { extractAnswerTable, extractAnswerTableEntries, extractQuestionThenHeadingSolutionMatches } from './solution-document.parser.js'
import type { PaperKind } from '../../utils/import-metadata.js'

export type ParseQuestionCandidatesOptions = {
  now?: string
  config?: ImportFlowV2ParserConfig
  paperKind?: PaperKind
}

function normalizedLine(value: string) {
  return value.replace(/^\s*(?:#{1,6}\s*)?/, '').replace(/\s+/g, '')
}

function normalizedStructuralLine(value: string) {
  return normalizedLine(value).replace(/^(?:第[0-9０-９]{1,3}题|[0-9０-９]{1,3}[.．、·•]|[一二三四五六七八九十百]+、)/, '')
}

const CHINESE_SECTION_PREFIX_RE = /^[一二三四五六七八九十百千万]+[、.．]/

function normalizedSectionHeadingTitle(value: string) {
  const normalized = normalizedLine(value)
  if (!CHINESE_SECTION_PREFIX_RE.test(normalized)) return ''
  return normalized.replace(CHINESE_SECTION_PREFIX_RE, '')
}

function normalizedConfiguredSectionHeading(value: string) {
  return normalizedLine(value).replace(CHINESE_SECTION_PREFIX_RE, '')
}

function sectionHeadingMatches(lineTitle: string, configuredHeading: string) {
  if (!lineTitle || !configuredHeading) return false
  if (lineTitle === configuredHeading) return true
  if (!lineTitle.startsWith(configuredHeading)) return false
  return /^[:：（(本]/.test(lineTitle.slice(configuredHeading.length))
}

function isStructuralLine(line: string, config: ImportFlowV2ParserConfig) {
  const normalized = normalizedStructuralLine(line)
  if (!normalized) return false
  if (isSectionHeading(line, config)) return true
  return config.documentNoteKeywords.some((item) => {
    const keyword = normalizedLine(item)
    return normalized.startsWith(keyword)
  })
}

function isSectionHeading(line: string, config: ImportFlowV2ParserConfig) {
  const normalized = normalizedSectionHeadingTitle(line)
  if (!normalized) return false
  return config.sectionHeadings.some((item) => {
    const heading = normalizedConfiguredSectionHeading(item)
    return sectionHeadingMatches(normalized, heading)
  })
}

function findFirstSectionHeadingStart(value: string, config: ImportFlowV2ParserConfig) {
  const source = String(value || '')
  const lines = source.split(/(?<=\n)/)
  let offset = 0
  for (const lineWithNewline of lines) {
    const line = lineWithNewline.replace(/\n$/, '')
    if (isSectionHeading(line, config)) return offset
    offset += lineWithNewline.length
  }
  return -1
}

function hasPrimaryQuestionMarker(line: string, config: ImportFlowV2ParserConfig) {
  return config.primaryQuestionPatterns.some((pattern) => {
    const match = new RegExp(pattern, 'i').exec(line)
    return Boolean(match && /^[ \t#]*$/.test(line.slice(0, match.index)))
  })
}

function maskStructuralText(value: string, config: ImportFlowV2ParserConfig) {
  return maskStructuralMarkdown(value, config)
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

function isLectureNonQuestionHeading(line: string, config: ImportFlowV2ParserConfig) {
  const title = normalizedLine(line)
  return config.lectureNonQuestionSectionKeywords.some((item) => {
    const keyword = normalizedLine(item)
    return Boolean(keyword) && (title === keyword || title === `点${keyword}` || title.endsWith(keyword))
  })
}

function isLikelyLectureQuestionBody(value: string) {
  const body = String(value || '')
  return hasAnswerOrAnalysisMarkerText(body)
    || hasChoiceOptionLines(body)
    || /(?:_{2,}|（\s*）|\(\s*\))/.test(body)
    || /^\s*(?:【\s*(?:单选|多选|填空|解答)[^】]*】|[（(](?:20\d{2}|高[一二三]|初[一二三]))/m.test(body)
}

/**
 * A lecture often places a numbered knowledge/tips list immediately before the
 * exercises in each topic. Mask that prelude (without changing offsets) until
 * the first chunk with strong question evidence. The heading vocabulary stays
 * user-configurable in the existing parser settings.
 */
function maskLectureNonQuestionSections(value: string, config: ImportFlowV2ParserConfig) {
  const source = String(value || '')
  const lines = Array.from(source.matchAll(/.*(?:\n|$)/g))
    .filter((match) => String(match[0] || '').length)
    .map((match) => ({
      start: match.index || 0,
      end: (match.index || 0) + String(match[0] || '').length,
      text: String(match[0] || '').replace(/\n$/, ''),
    }))
  const ranges: Array<{ start: number; end: number }> = []

  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index]
    if (!isLectureNonQuestionHeading(heading.text, config)) continue
    const nextHeading = lines.slice(index + 1).find((line) => /^\s*#{1,6}\s+/.test(line.text))
    const sectionEnd = nextHeading?.start ?? source.length
    const section = source.slice(heading.end, sectionEnd)
    const matches = detectQuestionNumbers(section, config)
    const chunks = splitMarkdownByQuestionNumbers(section, matches)
    const firstQuestionIndex = chunks.findIndex((chunk) => isLikelyLectureQuestionBody(chunk.body))
    const firstQuestionStart = firstQuestionIndex >= 0 ? matches[firstQuestionIndex]?.start : undefined
    ranges.push({
      start: heading.start,
      end: firstQuestionStart === undefined ? sectionEnd : heading.end + firstQuestionStart,
    })
  }

  let masked = source
  for (const range of ranges.sort((left, right) => right.start - left.start)) {
    masked = masked.slice(0, range.start) + blankPreservingNewlines(masked.slice(range.start, range.end)) + masked.slice(range.end)
  }
  return masked
}

function maskPreludeBeforeFirstSectionHeading(value: string, config: ImportFlowV2ParserConfig) {
  const headingStart = findFirstSectionHeadingStart(value, config)
  if (headingStart <= 0) return value
  const beforeHeading = value.slice(0, headingStart)
  const afterHeading = value.slice(headingStart)
  if (!detectQuestionNumbers(afterHeading, config).length) return value
  return blankPreservingNewlines(beforeHeading) + afterHeading
}

function alignDocumentBlockOffsets(document: OCRDocument, markdown: string): OCRDocument {
  let cursor = 0
  return {
    ...document,
    markdown,
    pages: document.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((block) => {
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

/**
 * Hide non-question material before detecting question numbers while preserving
 * every offset. This prevents numbered exam instructions and reference-formula
 * items from becoming artificial questions or cutting the preceding real one.
 */
function maskStructuralMarkdown(value: string, config: ImportFlowV2ParserConfig) {
  const markdown = maskPreludeBeforeFirstSectionHeading(String(value || ''), config)
  let inReferenceFormula = false
  let sawQuestion = false
  return markdown.split(/(?<=\n)/).map((lineWithNewline) => {
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

function hasChoiceOptionLines(value: string) {
  return /(?:^|\n)\s*[A-D]\s*[.．、]/.test(value)
}

function hasFigureMarker(value: string) {
  return /<!--\s*DOC2X_FIGURE:[^>]+\s*-->|!\[[^\]]*]\(/.test(value)
}

function hasFigureKeyword(value: string, config: ImportFlowV2ParserConfig) {
  return config.figureKeywords.some((keyword) => String(value || '').includes(keyword))
}

function shouldMergeDuplicateQuestionChunk(previous: QuestionMarkdownChunk, current: QuestionMarkdownChunk, config: ImportFlowV2ParserConfig) {
  if (previous.questionNo !== current.questionNo) return false
  if (hasAnswerOrAnalysisMarkerText(previous.body) || containsSectionHeading(previous.body, config)) return false
  const combined = `${previous.body}\n${current.body}`
  return previous.body.length <= 120
    && (hasFigureKeyword(combined, config) || hasChoiceOptionLines(current.body) || hasFigureMarker(current.raw))
}

function mergeDuplicateContinuationChunks(source: string, chunks: QuestionMarkdownChunk[], config: ImportFlowV2ParserConfig) {
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

function stripRepeatedQuestionMarker(value: string, questionNo: string) {
  const normalized = numberValue(questionNo)
  if (normalized === undefined) return value
  return String(value || '').replace(new RegExp(`(^|\\n)\\s*(?:第\\s*${normalized}\\s*题|${normalized})\\s*[.．、·•]\\s*`, 'g'), '$1')
}

function dedupeFigures(figures: CandidateFigure[]) {
  return Array.from(new Map(figures.map((figure) => [`${figure.sourceDocumentId || ''}:${figure.usage}:${figure.path}`, figure])).values())
}

function figuresForMarkdown(markdown: string, usage: CandidateFigure['usage'], sourceDocumentId = ''): CandidateFigure[] {
  const figures: CandidateFigure[] = []
  const pattern = /!\[[^\]]*]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))\s*\)/g
  for (const match of normalizeHtmlImageTags(markdown).matchAll(pattern)) {
    const path = String(match[1] || match[2] || '').replace(/\\\)/g, ')').trim()
    if (!path) continue
    figures.push({
      id: `inline_${usage}_${createId('image', path)}`,
      usage,
      path,
      sourceDocumentId: sourceDocumentId || undefined,
      inlineMarker: String(match.index ?? path),
    })
  }
  return figures
}

function dedupeSourceRefs(refs: CandidateSourceRef[]) {
  const grouped = new Map<string, CandidateSourceRef>()
  for (const ref of refs) {
    const key = `${ref.sourceDocumentId || ''}:${ref.kind}:${ref.pageNo}`
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

function bboxSize(bbox?: [number, number, number, number]) {
  if (!bbox) return { width: 0, height: 0, area: 0 }
  const width = Math.max(0, bbox[2] - bbox[0])
  const height = Math.max(0, bbox[3] - bbox[1])
  return { width, height, area: width * height }
}

function isLikelyStandaloneFigureBlock(document: OCRDocument, block: OCRDocument['pages'][number]['blocks'][number]) {
  if (isLikelyPageChromeBlock(document, block)) return false
  if (block.type === 'image' && !block.assetId) return true
  if (!block.assetId) return false
  const asset = document.assets.find((item) => item.id === block.assetId)
  if (asset?.type === 'table_image' || block.type === 'table') return true
  const box = bboxSize(asset?.bbox || block.bbox)
  const page = document.pages.find((item) => item.pageNo === block.pageNo)
  const pageHeight = page?.height || 0
  const top = (asset?.bbox || block.bbox)?.[1] || 0
  const bottom = (asset?.bbox || block.bbox)?.[3] || 0
  const content = `${block.content || ''}\n${asset?.path || ''}`
  if (/学科网|组卷网|zxxk|zujuan/i.test(content)) return false
  if (pageHeight > 0 && (top < pageHeight * 0.08 || bottom > pageHeight * 0.94) && box.height < 160) return false
  if (!box.area) return block.type === 'image'
  if (box.height < 96) return false
  if (box.width / Math.max(box.height, 1) > 8) return false
  return block.type === 'image' || box.area >= 80_000
}

function attachImageBlocks(document: OCRDocument, chunks: QuestionMarkdownChunk[], candidates: QuestionCandidate[], config: ImportFlowV2ParserConfig) {
  const imageBlocks = document.pages.flatMap((page) => page.blocks)
    .filter((block) => block.type === 'image' || block.assetId)
  const attached = new Set(candidates.flatMap((candidate) => candidate.figures.map((figure) => figure.sourceBlockId).filter(Boolean)))
  for (const block of imageBlocks) {
    if (!isLikelyStandaloneFigureBlock(document, block)) continue
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
      const relatedFigure = figureForBlock(document, block, 'unknown')
      fallback.issues.push({
        code: 'unplaced_figure',
        severity: 'warning',
        message: `有一张图片（${block.id}）未能可靠归属到题目，请核对。`,
        relatedBlockIds: [block.id],
        relatedFigures: relatedFigure ? [relatedFigure] : [],
      })
      fallback.status = statusForIssues(fallback.issues)
      continue
    }
    const figure = figureForBlock(document, block, 'stem')
    if (!figure) continue
    candidates[index].figures = dedupeFigures([...candidates[index].figures, figure])
    candidates[index].sourceRefs = dedupeSourceRefs([...candidates[index].sourceRefs, {
      sourceDocumentId: document.sourceDocumentId,
      pageNo: block.pageNo,
      blockIds: [block.id],
      bbox: block.bbox,
      kind: 'figure',
    }])
    attached.add(block.id)
  }
}

function solutionValue(fieldsValue: string, matchValue: string | undefined) {
  return fieldsValue.trim() || String(matchValue || '').trim()
}

function solutionRange(fieldsRange: MarkdownRange | undefined, matchRange: MarkdownRange | undefined) {
  return fieldsRange || matchRange
}

function hasAnswerOrAnalysisMarkerText(value: string) {
  return /【\s*(?:答案|解析|分析|详解)\s*】|(?:答案|解析|分析|详解)\s*[:：]/.test(value)
}

function containsSectionHeading(value: string, config: ImportFlowV2ParserConfig) {
  return String(value || '').split(/\n/).some((line) => isSectionHeading(line, config))
}

function numberValue(value: string | undefined) {
  const parsed = Number.parseInt(String(value || '').replace(/[^\d]/g, ''), 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function cleanQuestionMatchesForLayout(
  markdown: string,
  matches: QuestionNumberMatch[],
  classification: QuestionDocumentLayoutClassification,
  config: ImportFlowV2ParserConfig,
) {
  if (classification.cleaningRule !== 'same_document_inline') return matches
  const chunks = splitMarkdownByQuestionNumbers(markdown, matches)
  const result: QuestionNumberMatch[] = []
  let skippedAnalysisNumbering = false

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const chunk = chunks[index]
    const previous = result[result.length - 1]
    if (!previous || !chunk) {
      result.push(match)
      skippedAnalysisNumbering = false
      continue
    }

    const currentNo = numberValue(match.questionNo)
    const previousNo = numberValue(previous.questionNo)
    const textSincePreviousQuestion = markdown.slice(previous.contentStart, match.start)
    const afterAnswerOrAnalysis = hasAnswerOrAnalysisMarkerText(textSincePreviousQuestion)
    const bodyHasAnswerOrAnalysis = hasAnswerOrAnalysisMarkerText(chunk.body)
    const crossedSectionHeading = containsSectionHeading(textSincePreviousQuestion, config)
    const resetOrDuplicate = currentNo !== undefined && previousNo !== undefined && currentNo <= previousNo
    const looksLikeContinuedAnalysisSteps = skippedAnalysisNumbering
      && currentNo !== undefined
      && previousNo !== undefined
      && currentNo <= Math.max(5, previousNo + 1)

    if (
      afterAnswerOrAnalysis
      && !bodyHasAnswerOrAnalysis
      && !crossedSectionHeading
      && (resetOrDuplicate || looksLikeContinuedAnalysisSteps)
    ) {
      skippedAnalysisNumbering = true
      continue
    }

    result.push(match)
    skippedAnalysisNumbering = false
  }

  return result
}

function nonEmpty(value: string | undefined) {
  const text = String(value || '').trim()
  return text || undefined
}

function mergeSolutionMatch(target: SolutionMatch | undefined, patch: SolutionMatch): SolutionMatch {
  return {
    ...(target || {}),
    ...Object.fromEntries(Object.entries(patch).filter(([key, value]) => key !== 'warnings' && value !== undefined && value !== '')),
    warnings: [
      ...(target?.warnings || []),
      ...(patch.warnings || []),
    ],
  }
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

function compactForCheck(value: string) {
  return String(value || '').replace(/\s+/g, '').replace(/[，。；、,.:：]/g, '')
}

function isMetadataLikeAnswer(value: string | undefined, config: ImportFlowV2ParserConfig) {
  const compact = compactForCheck(String(value || '')).slice(0, 120)
  if (!compact) return false
  return config.metadataBlockKeywords.some((keyword) => {
    const key = compactForCheck(keyword)
    return compact.startsWith(key) || compact.includes(`【${key}】`)
  })
}

function simpleChoiceAnswer(value: string) {
  const compact = compactForCheck(value).replace(/[;；]$/g, '').toUpperCase()
  return /^[A-D]{1,4}$/.test(compact) ? compact : ''
}

function hasConclusionForAnswer(value: string, answerText: string | undefined) {
  const answer = simpleChoiceAnswer(answerText || '')
  if (!answer) return true
  const compact = compactForCheck(value).toUpperCase()
  return compact.includes(`故选${answer}`) || compact.includes(`选${answer}`)
}

function hasCompletedSolutionBeforeOrphan(value: string) {
  return /(?:故选|故答案|故填|故答案为|答案为|综上|证毕|得证)/.test(value.slice(-800))
}

function findTrailingUnnumberedSolutionBlock(body: string, answerText: string | undefined) {
  const source = String(body || '')
  const marker = /(?:\n\s*(?:<!--\s*(?:GLM|DOC2X)_PAGE:\d+\s*-->\s*)*)\n?\s*(?:【\s*(?:分析|解析)\s*】|(?:分析|解析)\s*[:：])/g
  const matches = Array.from(source.matchAll(marker))
  for (let index = 1; index < matches.length; index += 1) {
    const start = matches[index].index || 0
    const before = source.slice(0, start).trim()
    const orphan = source.slice(start).trim()
    if (before.length < 20 || orphan.length < 30) continue
    if (!hasCompletedSolutionBeforeOrphan(before)) continue
    if (!hasConclusionForAnswer(orphan, answerText)) continue
    return { splitIndex: start, before, orphan }
  }
  return null
}

function shouldInferMissingSolutionNo(currentNo: number | undefined, nextNo: number | undefined, expectedNos: Set<string>, tableAnswers: Map<string, string>) {
  if (currentNo === undefined || nextNo === undefined) return ''
  if (nextNo !== currentNo + 2) return ''
  const missingNo = String(currentNo + 1)
  if (!expectedNos.has(missingNo)) return ''
  if (!tableAnswers.has(missingNo)) return ''
  return missingNo
}

function trimBodyBeforeAnswerTable(body: string, config: ImportFlowV2ParserConfig) {
  const tableStart = firstAnswerTableStart(body, config)
  return tableStart === undefined ? body : body.slice(0, tableStart).trimEnd()
}

function extractWholeDocumentSolutionMatches(markdown: string, start: number, config: ImportFlowV2ParserConfig, expectedQuestionNos: string[] = []) {
  const source = markdown.slice(start)
  const starts = detectSolutionQuestionNumbers(maskNonSolutionBlocks(source, config), config)
  const chunks = splitMarkdownByQuestionNumbers(source, starts)
  const matches = new Map<string, SolutionMatch>()
  let chunksWithFieldMarkers = 0
  const expectedNos = new Set(expectedQuestionNos)
  const tableAnswers = extractAnswerTable(source, config)

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    const nextChunk = chunks[index + 1]
    const currentNo = numberValue(chunk.questionNo)
    const nextNo = numberValue(nextChunk?.questionNo)
    const missingNo = shouldInferMissingSolutionNo(currentNo, nextNo, expectedNos, tableAnswers)
    const inferred = missingNo ? findTrailingUnnumberedSolutionBlock(chunk.body, tableAnswers.get(missingNo)) : null
    const currentBody = trimBodyBeforeAnswerTable(inferred?.before || chunk.body, config)
    const fields = splitQuestionFields(currentBody, start + chunk.contentStart)
    if (fields.hasFieldMarkers) chunksWithFieldMarkers += 1
    matches.set(chunk.questionNo, mergeSolutionMatch(matches.get(chunk.questionNo), solutionMatchFromWholeDocumentChunk(
      currentBody,
      start + chunk.contentStart,
      { start: start + chunk.contentStart, end: start + chunk.contentStart + currentBody.length },
    )))

    if (inferred && missingNo) {
      const orphanStart = start + chunk.contentStart + inferred.splitIndex
      const orphanPatch = solutionMatchFromWholeDocumentChunk(
        inferred.orphan,
        orphanStart,
        { start: orphanStart, end: start + chunk.end },
      )
      matches.set(missingNo, mergeSolutionMatch(matches.get(missingNo), {
        ...orphanPatch,
        answerText: orphanPatch.answerText || tableAnswers.get(missingNo),
        warnings: [`第 ${missingNo} 题解析区缺失题号，已按前后题号和答案表自动归位，请核对。`],
      }))
    }
  }

  return { matches, chunkCount: chunks.length, chunksWithFieldMarkers }
}

function offsetRange(range: MarkdownRange | undefined, offset: number): MarkdownRange | undefined {
  return range ? { start: range.start + offset, end: range.end + offset } : undefined
}

function mergeTableAnswers(matches: Map<string, SolutionMatch>, markdown: string, config: ImportFlowV2ParserConfig, offset = 0) {
  if (config.answerTablePolicy === 'disabled') return matches
  const entries = new Map<string, { questionNo: string; answerText: string; range?: MarkdownRange }>()
  for (const entry of extractAnswerTableEntries(markdown, config)) entries.set(entry.questionNo, entry)
  for (const [questionNo, entry] of entries) {
    const existing = matches.get(questionNo)
    const answerText = entry.answerText
    const answerRange = offsetRange(entry.range, offset)
    const shouldOverride = Boolean(existing?.answerText) && (
      (config.answerTablePolicy === 'override_metadata_like_answer' && isMetadataLikeAnswer(existing?.answerText, config))
      || (config.answerTablePolicy === 'prefer_table_for_choice_questions' && Boolean(simpleChoiceAnswer(answerText)))
    )
    if (!existing || !existing.answerText || shouldOverride) {
      matches.set(questionNo, { ...(existing || {}), answerText, answerRange })
    } else if (String(existing.answerText || '').trim() === answerText.trim() && answerRange && !existing.answerRange) {
      matches.set(questionNo, { ...existing, answerRange })
    }
  }
  return matches
}

function extractAppendixSolutionMatches(
  markdown: string,
  start: number,
  sections: SolutionSection[],
  config: ImportFlowV2ParserConfig,
  expectedQuestionNos: string[] = [],
) {
  const scopedSections = sections.filter((section) => section.start >= start)
  const wholeDocument = extractWholeDocumentSolutionMatches(markdown, start, config, expectedQuestionNos)
  const headingThenQuestionMatches = (
    wholeDocument.chunkCount > 0
    && wholeDocument.chunksWithFieldMarkers >= Math.ceil(wholeDocument.chunkCount / 2)
  )
    ? wholeDocument.matches
    : scopedSections.length
      ? extractSolutionMatches(markdown, scopedSections, config)
      : wholeDocument.matches
  const questionThenHeadingMatches = extractQuestionThenHeadingSolutionMatches(markdown, config, start).matches

  if (config.solutionBindingStrategy === 'question_then_heading') {
    return mergeTableAnswers(questionThenHeadingMatches, markdown.slice(start), config, start)
  }
  if (config.solutionBindingStrategy === 'auto') {
    const score = (matches: Map<string, SolutionMatch>) => Array.from(matches.values()).reduce((total, match) => {
      return total + (String(match.answerText || '').trim() ? 2 : 0) + (String(match.analysisMarkdown || '').trim() ? 3 : 0)
    }, 0)
    return mergeTableAnswers(
      score(questionThenHeadingMatches) > score(headingThenQuestionMatches) ? questionThenHeadingMatches : headingThenQuestionMatches,
      markdown.slice(start),
      config,
      start,
    )
  }
  if (
    wholeDocument.chunkCount > 0
    && wholeDocument.chunksWithFieldMarkers >= Math.ceil(wholeDocument.chunkCount / 2)
  ) {
    return mergeTableAnswers(wholeDocument.matches, markdown.slice(start), config, start)
  }
  if (scopedSections.length) return mergeTableAnswers(extractSolutionMatches(markdown, scopedSections, config), markdown.slice(start), config, start)
  return mergeTableAnswers(wholeDocument.matches, markdown.slice(start), config, start)
}

function candidateIssuesForSolutionWarnings(solution: SolutionMatch | undefined): CandidateIssue[] {
  return (solution?.warnings || []).map((message) => ({
    code: 'manual_review_required',
    severity: 'warning',
    message,
  }))
}

function candidateFromChunk(
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

function fallbackCandidate(document: OCRDocument, timestamp: string, config: ImportFlowV2ParserConfig, paperKind: PaperKind): QuestionCandidate {
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

function fillDoc2xFigures(
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

function removeDoc2xFigureMarkers(markdown: string, figureIds: string[]) {
  let next = String(markdown || '')
  for (const id of figureIds) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    next = next.replace(new RegExp(`\\n?\\s*<!--\\s*DOC2X_FIGURE:${escaped}\\s*-->\\s*\\n?`, 'g'), '\n')
  }
  return next.replace(/\n{3,}/g, '\n\n').trim()
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

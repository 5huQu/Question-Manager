import type { ImportFlowV2ParserConfig } from '../default-parser-config.js'
import { splitMarkdownByQuestionNumbers } from '../markdown-question-splitter.js'
import { detectSolutionQuestionNumbers } from '../question-number-detector.js'
import {
  firstAnswerTableStart,
  findSolutionSections,
  maskNonSolutionBlocks,
  metadataOnlySolutionBlock,
  splitQuestionFields,
  type MarkdownRange,
  type SolutionMatch,
} from '../solution-matcher.js'
import { cleanPreviewText } from './markdown-utils.js'
import { isMetadataLike, metadataKeywordForLine, simpleChoiceAnswer } from './section-detection.js'
import type { ParserDiagnostic, PreviewSolutionMatch, TableAnswerEntry } from './types.js'

export function cloneMatches(matches: Map<string, SolutionMatch>) {
  const result = new Map<string, PreviewSolutionMatch>()
  for (const [questionNo, match] of matches) result.set(questionNo, { ...match })
  return result
}

export function applyAnswerTablePolicy(
  matches: Map<string, PreviewSolutionMatch>,
  entries: TableAnswerEntry[],
  config: ImportFlowV2ParserConfig,
): ParserDiagnostic[] {
  if (config.answerTablePolicy === 'disabled') return []
  const diagnostics: ParserDiagnostic[] = []
  for (const entry of entries) {
    const existing = matches.get(entry.questionNo)
    if (!existing || !String(existing.answerText || '').trim()) {
      matches.set(entry.questionNo, { ...(existing || {}), answerText: entry.answerText, answerRange: entry.range })
      continue
    }

    if (String(existing.answerText || '').trim() === entry.answerText.trim()) {
      matches.set(entry.questionNo, { ...existing, answerRange: existing.answerRange || entry.range })
      continue
    }

    const shouldOverride =
      (config.answerTablePolicy === 'override_metadata_like_answer' && isMetadataLike(existing.answerText, config))
      || (config.answerTablePolicy === 'prefer_table_for_choice_questions' && simpleChoiceAnswer(entry.answerText))

    if (shouldOverride) {
      matches.set(entry.questionNo, { ...existing, answerText: entry.answerText, answerRange: entry.range })
      continue
    }

    diagnostics.push({
      code: 'table_answer_blocked_by_existing_answer',
      severity: 'info',
      questionNo: entry.questionNo,
      message: `答案表识别到第 ${entry.questionNo} 题答案为「${entry.answerText}」，但当前策略不会覆盖已有答案。`,
      start: entry.range.start,
      end: entry.range.end,
      suggestedConfigPatch: { answerTablePolicy: 'override_metadata_like_answer' },
    })
  }
  return diagnostics
}

export function mergePreviewMatch(target: PreviewSolutionMatch | undefined, patch: PreviewSolutionMatch): PreviewSolutionMatch {
  return {
    ...(target || {}),
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined && value !== '')),
  }
}

function firstMetadataHeadingStart(markdown: string, start: number, end: number, config: ImportFlowV2ParserConfig) {
  const source = markdown.slice(start, end)
  const lines = source.split(/(?<=\n)/)
  let offset = start
  for (const lineWithNewline of lines) {
    const line = lineWithNewline.replace(/\n$/, '')
    if (metadataKeywordForLine(line, config)) return offset
    offset += lineWithNewline.length
  }
  return undefined
}

export function extractQuestionThenHeadingMatches(markdown: string, config: ImportFlowV2ParserConfig) {
  const questionMatches = detectSolutionQuestionNumbers(maskNonSolutionBlocks(markdown, config), config)
  const chunks = splitMarkdownByQuestionNumbers(markdown, questionMatches)
  const sections = findSolutionSections(markdown, config)
  const matches = new Map<string, PreviewSolutionMatch>()

  for (const chunk of chunks) {
    const chunkSections = sections
      .filter((section) => section.start >= chunk.contentStart && section.start < chunk.end)
      .sort((left, right) => left.start - right.start)
    const firstSection = chunkSections[0]
    const metadataStart = firstMetadataHeadingStart(markdown, chunk.contentStart, firstSection?.start || chunk.end, config)

    if (firstSection) {
      const stemEnd = Math.min(firstSection.start, metadataStart ?? firstSection.start)
      const rawStem = markdown.slice(chunk.contentStart, stemEnd)
      const bodyStart = firstSection.contentStart
      const bodyEnd = chunk.end
      const body = markdown.slice(bodyStart, bodyEnd)
      const fields = splitQuestionFields(body, bodyStart)
      let patch: PreviewSolutionMatch

      if (fields.hasFieldMarkers) {
        patch = {
          stemMarkdown: cleanPreviewText(rawStem),
          stemRange: rawStem.trim() ? { start: chunk.contentStart, end: stemEnd } : undefined,
          answerText: fields.answerText,
          analysisMarkdown: fields.analysisMarkdown,
          answerRange: fields.answerRange,
          analysisRange: fields.analysisRange,
        }
      } else {
        const bodyText = cleanPreviewText(body, 2000)
        const bodyLooksLikeAnalysis = /^(?:解|证明|分析|详解)\s*[:：]/.test(bodyText) || bodyText.length > 20 || firstSection.kind !== 'answer'
        patch = {
          stemMarkdown: cleanPreviewText(rawStem),
          stemRange: rawStem.trim() ? { start: chunk.contentStart, end: stemEnd } : undefined,
          answerText: bodyLooksLikeAnalysis ? undefined : bodyText,
          analysisMarkdown: bodyLooksLikeAnalysis ? bodyText : undefined,
          answerRange: bodyLooksLikeAnalysis ? undefined : { start: bodyStart, end: bodyEnd },
          analysisRange: bodyLooksLikeAnalysis ? { start: bodyStart, end: bodyEnd } : undefined,
        }
      }
      matches.set(chunk.questionNo, mergePreviewMatch(matches.get(chunk.questionNo), patch))
      continue
    }

    const body = markdown.slice(chunk.contentStart, chunk.end)
    const tableStart = firstAnswerTableStart(body, config)
    const trimmedBody = tableStart === undefined ? body : body.slice(0, tableStart).trimEnd()
    if (config.metadataBlockPolicy === 'ignore' && metadataOnlySolutionBlock(trimmedBody, config)) continue
    const fields = splitQuestionFields(trimmedBody, chunk.contentStart)
    matches.set(chunk.questionNo, mergePreviewMatch(matches.get(chunk.questionNo), {
      stemMarkdown: fields.stemMarkdown,
      stemRange: fields.stemRange,
      answerText: fields.answerText,
      analysisMarkdown: fields.analysisMarkdown,
      answerRange: fields.answerRange,
      analysisRange: fields.analysisRange,
    }))
  }

  return matches
}

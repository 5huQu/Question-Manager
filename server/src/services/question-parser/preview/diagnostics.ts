import type { QuestionCandidate } from '../../../types/question-candidate.js'
import type { ImportFlowV2ParserConfig } from '../default-parser-config.js'
import { splitMarkdownByQuestionNumbers } from '../markdown-question-splitter.js'
import { detectSolutionQuestionNumbers } from '../question-number-detector.js'
import {
  findSolutionSections,
  maskNonSolutionBlocks,
} from '../solution-matcher.js'
import { cleanPreviewText, textForRange } from './markdown-utils.js'
import { containsAnswerTable, containsQuestionSectionHeading, isMetadataLike } from './section-detection.js'
import type { CandidateParsePreview, ParserDiagnostic, PreviewSolutionMatch } from './types.js'

export function candidatePreviewsFromMatches(markdown: string, matches: Map<string, PreviewSolutionMatch>, diagnostics: ParserDiagnostic[]): CandidateParsePreview[] {
  const diagnosticsByQuestion = new Map<string, ParserDiagnostic[]>()
  for (const diagnostic of diagnostics) {
    if (!diagnostic.questionNo) continue
    const items = diagnosticsByQuestion.get(diagnostic.questionNo) || []
    items.push(diagnostic)
    diagnosticsByQuestion.set(diagnostic.questionNo, items)
  }
  return Array.from(matches.entries())
    .sort(([left], [right]) => Number(left) - Number(right) || left.localeCompare(right))
    .map(([questionNo, match]) => {
      const issues = [...(diagnosticsByQuestion.get(questionNo) || [])]
      if (!String(match.analysisMarkdown || '').trim()) {
        issues.push({
          code: 'missing_analysis',
          severity: 'warning',
          questionNo,
          message: `第 ${questionNo} 题当前试运行结果缺少解析。`,
          suggestedConfigPatch: { solutionBindingStrategy: 'question_then_heading' },
        })
      }
      return {
        questionNo,
        stemPreview: match.stemRange ? textForRange(markdown, match.stemRange) : cleanPreviewText(match.stemMarkdown || ''),
        answerPreview: match.answerRange ? textForRange(markdown, match.answerRange) : cleanPreviewText(match.answerText || ''),
        analysisPreview: match.analysisRange ? textForRange(markdown, match.analysisRange) : cleanPreviewText(match.analysisMarkdown || ''),
        sourceRanges: {
          stem: match.stemRange,
          answer: match.answerRange,
          analysis: match.analysisRange,
        },
        issues,
      } satisfies CandidateParsePreview
    })
}

export function strategyDiagnostics(markdown: string, config: ImportFlowV2ParserConfig): ParserDiagnostic[] {
  const diagnostics: ParserDiagnostic[] = []
  const shouldSuggestQuestionThenHeading = config.solutionBindingStrategy !== 'question_then_heading'
  const sections = findSolutionSections(markdown, config)
  const questionMatches = detectSolutionQuestionNumbers(maskNonSolutionBlocks(markdown, config), config)
  const chunks = splitMarkdownByQuestionNumbers(markdown, questionMatches)

  if (shouldSuggestQuestionThenHeading) {
    for (const section of sections) {
      const content = markdown.slice(section.contentStart, section.end)
      const followingQuestions = detectSolutionQuestionNumbers(maskNonSolutionBlocks(content, config), config)
      if (!followingQuestions.length && section.kind === 'answer' && containsAnswerTable(content, config)) continue
      if (!followingQuestions.length) {
        const previousQuestion = [...questionMatches].reverse().find((match) => match.start < section.start)
        diagnostics.push({
          code: 'solution_heading_without_following_question',
          severity: 'warning',
          questionNo: previousQuestion?.questionNo,
          message: previousQuestion
            ? `检测到「${section.title}」，但标题后没有新的题号；它可能应该绑定到前面的第 ${previousQuestion.questionNo} 题。`
            : `检测到「${section.title}」，但标题后没有新的题号。`,
          start: section.start,
          end: section.contentStart,
          suggestedConfigPatch: { solutionBindingStrategy: 'question_then_heading' },
        })
      }
    }

    for (const chunk of chunks) {
      const section = sections.find((item) => item.start >= chunk.contentStart && item.start < chunk.end)
      if (!section) continue
      const between = markdown.slice(chunk.contentStart, section.start)
      if (containsAnswerTable(between, config) || containsQuestionSectionHeading(between, config)) continue
      diagnostics.push({
        code: 'question_before_solution_heading',
        severity: 'info',
        questionNo: chunk.questionNo,
        message: `第 ${chunk.questionNo} 题的题号出现在「${section.title}」之前，可试用"题号在参考答案前"策略。`,
        start: chunk.start,
        end: section.contentStart,
        suggestedConfigPatch: { solutionBindingStrategy: 'question_then_heading' },
      })
    }
  }

  return diagnostics
}

export function recognizedCandidateDiagnostics(candidates: QuestionCandidate[]) {
  const diagnostics: ParserDiagnostic[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    for (const diagnostic of candidate.parseDiagnostics || []) {
      const item = diagnostic as ParserDiagnostic
      const key = `${item.code}:${item.questionNo || candidate.questionNo}:${item.start || ''}:${item.end || ''}:${item.message}`
      if (seen.has(key)) continue
      seen.add(key)
      diagnostics.push({ ...item, questionNo: item.questionNo || candidate.questionNo })
    }
  }
  return diagnostics
}

export function diagnosticsForCandidate(candidate: QuestionCandidate | undefined, config: ImportFlowV2ParserConfig): ParserDiagnostic[] {
  if (!candidate) return []
  const diagnostics: ParserDiagnostic[] = []
  if (isMetadataLike(candidate.answerText, config)) {
    diagnostics.push({
      code: 'metadata_used_as_answer',
      severity: 'warning',
      questionNo: candidate.questionNo,
      message: `当前候选题答案疑似来自「${config.metadataBlockKeywords.join(' / ')}」等说明块。`,
      suggestedConfigPatch: { metadataBlockPolicy: 'ignore', answerTablePolicy: 'override_metadata_like_answer' },
    })
  }
  if (!String(candidate.analysisMarkdown || '').trim()) {
    diagnostics.push({
      code: 'missing_analysis',
      severity: 'warning',
      questionNo: candidate.questionNo,
      message: `当前候选题第 ${candidate.questionNo || '未知'} 题缺少解析。`,
      suggestedConfigPatch: { solutionBindingStrategy: 'question_then_heading' },
    })
  }
  return diagnostics
}

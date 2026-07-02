import type { OCRDocument } from '../../types/ocr-document.js'
import type { CandidateFigure, CandidateIssue, CandidateSourceRef, QuestionCandidate } from '../../types/question-candidate.js'
import { createId } from '../../utils/ids.js'
import { figuresForRange, sourceRefsForRange } from './figure-linker.js'
import { statusForIssues } from './candidate-validator.js'
import type { SolutionMatch } from './solution-matcher.js'
import { cleanOcrPresentationMarkdown } from './presentation-cleanup.js'

function hasText(value: string | undefined) {
  return Boolean(String(value || '').trim())
}

function dedupeFigures(figures: CandidateFigure[]) {
  const result = new Map<string, CandidateFigure>()
  for (const figure of figures) {
    result.set(`${figure.sourceDocumentId || ''}:${figure.usage}:${figure.path}:${figure.sourceBlockId || figure.blockId || figure.inlineMarker || figure.id}`, figure)
  }
  return Array.from(result.values())
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

function figuresForInlineMarkdown(markdown: string, sourceDocumentId = ''): CandidateFigure[] {
  const source = String(markdown || '')
  const figures: CandidateFigure[] = []
  const markdownPattern = /!\[[^\]]*]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))\s*\)/g
  for (const match of source.matchAll(markdownPattern)) {
    const path = String(match[1] || match[2] || '').replace(/\\\)/g, ')').trim()
    if (!path) continue
    figures.push({
      id: `inline_analysis_${createId('image', path)}`,
      usage: 'analysis',
      path,
      sourceDocumentId: sourceDocumentId || undefined,
      inlineMarker: String(match.index ?? path),
    })
  }

  const htmlPattern = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi
  for (const match of source.matchAll(htmlPattern)) {
    const path = String(match[1] || match[2] || match[3] || '').trim()
    if (!path) continue
    figures.push({
      id: `inline_analysis_${createId('image', path)}`,
      usage: 'analysis',
      path,
      sourceDocumentId: sourceDocumentId || undefined,
      inlineMarker: String(match.index ?? path),
    })
  }
  return figures
}

function issue(code: CandidateIssue['code'], message: string): CandidateIssue {
  return { code, severity: 'warning', message }
}

function appendIssue(issues: CandidateIssue[], next: CandidateIssue) {
  if (issues.some((item) => item.code === next.code && item.message === next.message)) return issues
  return [...issues, next]
}

function removeResolvedMissingIssues(candidate: QuestionCandidate) {
  const removable = new Set<CandidateIssue['code']>()
  if (hasText(candidate.answerText)) removable.add('missing_answer')
  if (hasText(candidate.analysisMarkdown)) removable.add('missing_analysis')
  return candidate.issues.filter((item) => !removable.has(item.code))
}

export function mergeQuestionCandidatesWithSolutions(
  candidates: QuestionCandidate[],
  solutionMatches: Map<string, SolutionMatch>,
  solutionDocument: OCRDocument,
): QuestionCandidate[] {
  const matchedQuestionNos = new Set<string>()
  const merged = candidates.map((candidate) => {
    const solution = solutionMatches.get(candidate.questionNo)
    const next: QuestionCandidate = {
      ...candidate,
      figures: [...candidate.figures],
      sourceRefs: [...candidate.sourceRefs],
      issues: [...candidate.issues],
    }

    if (!solution) {
      next.issues = appendIssue(next.issues, issue('missing_solution', `未在解析文档中匹配到第 ${candidate.questionNo || '未知'} 题。`))
      next.status = statusForIssues(next.issues)
      return next
    }

    matchedQuestionNos.add(candidate.questionNo)
    const solutionAnswer = cleanOcrPresentationMarkdown(String(solution.answerText || '').trim())
    const solutionAnalysis = cleanOcrPresentationMarkdown(String(solution.analysisMarkdown || '').trim())

    if (solutionAnswer) {
      if (hasText(next.answerText)) {
        next.issues = appendIssue(next.issues, issue('solution_conflict', `第 ${candidate.questionNo || '未知'} 题已有答案，解析文档答案未覆盖。`))
      } else {
        next.answerText = solutionAnswer
      }
    }

    if (solutionAnalysis) {
      if (hasText(next.analysisMarkdown)) {
        next.issues = appendIssue(next.issues, issue('solution_conflict', `第 ${candidate.questionNo || '未知'} 题已有解析，解析文档解析未覆盖。`))
      } else {
        next.analysisMarkdown = solutionAnalysis
      }
    }

    const refs: CandidateSourceRef[] = []
    if (solutionAnswer) refs.push(...sourceRefsForRange(solutionDocument, solution.answerRange, 'answer'))
    if (solutionAnalysis) refs.push(...sourceRefsForRange(solutionDocument, solution.analysisRange, 'analysis'))
    next.sourceRefs = dedupeSourceRefs([...next.sourceRefs, ...refs])

    if (solutionAnalysis) {
      next.figures = dedupeFigures([
        ...next.figures,
        ...figuresForRange(solutionDocument, solution.analysisRange, 'analysis'),
        ...figuresForInlineMarkdown(solutionAnalysis, solutionDocument.sourceDocumentId),
      ])
    }

    next.issues = removeResolvedMissingIssues(next)
    next.status = statusForIssues(next.issues)
    return next
  })

  const unmatched = Array.from(solutionMatches.keys())
    .filter((questionNo) => !matchedQuestionNos.has(questionNo))
    .sort((left, right) => Number(left) - Number(right) || left.localeCompare(right))

  if (unmatched.length && merged.length) {
    const first = merged[0]
    first.issues = appendIssue(first.issues, issue('unmatched_solution', `解析文档中存在未匹配题干的题号：${unmatched.join('、')}。`))
    first.status = statusForIssues(first.issues)
  }

  return merged
}

import type { QuestionCandidate } from '../../types/question-candidate.js'
import { normalizeQuestionType } from '../../utils/question-type.js'
import type { QuestionMarkdownChunk } from './markdown-question-splitter.js'
import { dedupeFigures, numberValue } from './chunk-processing.js'
import { dedupeSourceRefs } from './figure-extraction.js'

type CandidateRun = {
  chunks: QuestionMarkdownChunk[]
  candidates: QuestionCandidate[]
}

type CandidatePair = {
  question: QuestionCandidate
  solution: QuestionCandidate
  solutionIndex: number
  similarity: number
}

function visibleStem(value: string) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\\(?:big|var)?triangle(?:up)?/gi, ' triangle ')
    .replace(/\\(?:left|right|mathrm|mathbf|text|operatorname|operatorname\*)/g, '')
    .replace(/[^\p{Script=Han}a-z0-9]+/giu, '')
    .toLowerCase()
}

function ngrams(value: string, size = 2) {
  if (value.length <= size) return value ? [value] : []
  const result: string[] = []
  for (let index = 0; index <= value.length - size; index += 1) result.push(value.slice(index, index + size))
  return result
}

function diceSimilarity(left: string, right: string) {
  const a = visibleStem(left)
  const b = visibleStem(right)
  if (!a || !b) return 0
  if (a === b) return 1
  const leftCounts = new Map<string, number>()
  for (const gram of ngrams(a)) leftCounts.set(gram, (leftCounts.get(gram) || 0) + 1)
  let overlap = 0
  const rightGrams = ngrams(b)
  for (const gram of rightGrams) {
    const count = leftCounts.get(gram) || 0
    if (!count) continue
    overlap += 1
    if (count === 1) leftCounts.delete(gram)
    else leftCounts.set(gram, count - 1)
  }
  return (2 * overlap) / Math.max(1, ngrams(a).length + rightGrams.length)
}

function hasSolution(candidate: QuestionCandidate) {
  return Boolean(candidate.answerText.trim() || candidate.analysisMarkdown.trim())
}

function solutionRate(run: CandidateRun) {
  if (!run.candidates.length) return 0
  return run.candidates.filter(hasSolution).length / run.candidates.length
}

function splitRuns(chunks: QuestionMarkdownChunk[], candidates: QuestionCandidate[]) {
  const runs: CandidateRun[] = []
  for (let index = 0; index < candidates.length; index += 1) {
    const chunk = chunks[index]
    const candidate = candidates[index]
    if (!chunk || !candidate) continue
    const currentNo = numberValue(chunk.questionNo)
    const previousChunk = runs[runs.length - 1]?.chunks.at(-1)
    const previousNo = numberValue(previousChunk?.questionNo)
    if (!runs.length || (currentNo !== undefined && previousNo !== undefined && currentNo <= previousNo)) {
      runs.push({ chunks: [chunk], candidates: [candidate] })
      continue
    }
    runs[runs.length - 1].chunks.push(chunk)
    runs[runs.length - 1].candidates.push(candidate)
  }
  return runs
}

function candidatePairs(questionRun: CandidateRun, solutionRun: CandidateRun) {
  const pairs: CandidatePair[] = []
  const usedSolutions = new Set<number>()

  for (const question of questionRun.candidates) {
    const exactMatches = solutionRun.candidates
      .map((solution, solutionIndex) => ({ solution, solutionIndex }))
      .filter(({ solution, solutionIndex }) => !usedSolutions.has(solutionIndex) && solution.questionNo === question.questionNo)
      .map(({ solution, solutionIndex }) => ({ solution, solutionIndex, similarity: diceSimilarity(question.stemMarkdown, solution.stemMarkdown) }))
      .sort((left, right) => right.similarity - left.similarity)

    let selected: { solution: QuestionCandidate; solutionIndex: number; similarity: number } | undefined = exactMatches[0]
    if (selected?.solution.stemMarkdown.trim() && selected.similarity < 0.45) selected = undefined

    if (!selected) continue
    usedSolutions.add(selected.solutionIndex)
    pairs.push({ question, ...selected })
  }

  return pairs
}

function canPairRuns(questionRun: CandidateRun, solutionRun: CandidateRun, pairs: CandidatePair[]) {
  const maxLength = Math.max(questionRun.candidates.length, solutionRun.candidates.length)
  const minimumPairs = maxLength <= 2 ? maxLength : 3
  if (pairs.length < minimumPairs || pairs.length / Math.max(1, maxLength) < 0.75) return false
  if (solutionRate(questionRun) > 0.35 || solutionRate(solutionRun) < 0.65) return false

  const comparable = pairs.filter((pair) => pair.question.stemMarkdown.trim() && pair.solution.stemMarkdown.trim())
  if (!comparable.length) return pairs.length / Math.max(1, maxLength) >= 0.9
  const averageSimilarity = comparable.reduce((total, pair) => total + pair.similarity, 0) / comparable.length
  const reliableSimilarityRate = comparable.filter((pair) => pair.similarity >= 0.55).length / comparable.length
  return averageSimilarity >= 0.68 && reliableSimilarityRate >= 0.8
}

function markerFigureIds(value: string) {
  return new Set(Array.from(String(value || '').matchAll(/<!--\s*DOC2X_FIGURE:([^\s>]+)\s*-->/g)).map((match) => match[1]))
}

function mergeIssues(left: QuestionCandidate, right: QuestionCandidate) {
  const liveCodes = new Set(['missing_question_no', 'duplicate_question_no', 'missing_stem', 'missing_answer', 'missing_analysis'])
  const issues = [...left.issues, ...right.issues].filter((issue) => !liveCodes.has(issue.code))
  return Array.from(new Map(issues.map((issue) => [
    `${issue.code}:${issue.message}:${(issue.relatedBlockIds || []).join(',')}`,
    issue,
  ])).values())
}

function mergePair(pair: CandidatePair) {
  const { question, solution, similarity } = pair
  const stemMarkdown = question.stemMarkdown.trim() ? question.stemMarkdown : solution.stemMarkdown
  const answerText = solution.answerText.trim() ? solution.answerText : question.answerText
  const analysisMarkdown = solution.analysisMarkdown.trim() ? solution.analysisMarkdown : question.analysisMarkdown
  const solutionFigureIds = markerFigureIds(`${answerText}\n${analysisMarkdown}`)
  const questionStemFigures = question.figures.filter((figure) => figure.usage !== 'analysis')
  const solutionFigures = solution.figures.filter((figure) =>
    figure.usage === 'analysis'
    || solutionFigureIds.has(figure.id)
    || Boolean(figure.blockId && solutionFigureIds.has(figure.blockId)),
  )
  const fallbackStemFigures = questionStemFigures.length
    ? []
    : solution.figures.filter((figure) => figure.usage === 'stem' || figure.usage === 'options')
  const solutionFigureBlocks = new Set(solutionFigures.flatMap((figure) => [figure.sourceBlockId, figure.blockId].filter(Boolean).map(String)))
  const sourceRefs = dedupeSourceRefs([
    ...question.sourceRefs.filter((ref) => ref.kind === 'stem' || ref.kind === 'figure'),
    ...solution.sourceRefs.filter((ref) => ref.kind === 'answer' || ref.kind === 'analysis'),
    ...solution.sourceRefs.filter((ref) => ref.kind === 'figure' && ref.blockIds.some((id) => solutionFigureBlocks.has(id))),
  ])

  return {
    ...question,
    stemMarkdown,
    answerText,
    analysisMarkdown,
    questionType: normalizeQuestionType('', stemMarkdown, answerText),
    figures: dedupeFigures([...questionStemFigures, ...fallbackStemFigures, ...solutionFigures]),
    sourceRefs,
    issues: mergeIssues(question, solution),
    parseDiagnostics: [
      ...question.parseDiagnostics,
      ...solution.parseDiagnostics,
      {
        code: 'paired_lecture_variant',
        severity: 'info' as const,
        questionNo: question.questionNo,
        message: `已按题号、相邻分组和题干相似度（${Math.round(similarity * 100)}%）合并题目版与解析版。`,
      },
    ],
    updatedAt: solution.updatedAt || question.updatedAt,
  }
}

/**
 * Lecture packages commonly contain adjacent student/teacher variants whose
 * numbering restarts at 1. Pair only when the first run is mostly unsolved,
 * the second is mostly solved, and question stems align despite OCR noise.
 */
export function pairLectureQuestionSolutionRuns(chunks: QuestionMarkdownChunk[], candidates: QuestionCandidate[]) {
  if (chunks.length !== candidates.length || candidates.length < 2) return candidates
  const runs = splitRuns(chunks, candidates)
  const result: QuestionCandidate[] = []

  for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
    const questionRun = runs[runIndex]
    const solutionRun = runs[runIndex + 1]
    if (!solutionRun) {
      result.push(...questionRun.candidates)
      continue
    }

    const pairs = candidatePairs(questionRun, solutionRun)
    if (!canPairRuns(questionRun, solutionRun, pairs)) {
      result.push(...questionRun.candidates)
      continue
    }

    const pairByQuestion = new Map(pairs.map((pair) => [pair.question.id, pair]))
    const usedSolutionIndexes = new Set(pairs.map((pair) => pair.solutionIndex))
    for (const candidate of questionRun.candidates) {
      const pair = pairByQuestion.get(candidate.id)
      result.push(pair ? mergePair(pair) : candidate)
    }
    for (let solutionIndex = 0; solutionIndex < solutionRun.candidates.length; solutionIndex += 1) {
      if (!usedSolutionIndexes.has(solutionIndex)) result.push(solutionRun.candidates[solutionIndex])
    }
    runIndex += 1
  }

  return result
}

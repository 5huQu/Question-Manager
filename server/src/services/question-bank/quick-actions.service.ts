import { db } from '../../db/connection.js'
import { mapQuestion } from '../../db/questions.js'
import type { QuestionRow } from '../../types/index.js'
import { RouteError } from '../../utils/http-error.js'
import {
  markdownWithInlineFigures,
  figuresWithoutInlineMarkers,
  markdownFigureLines,
} from '../../utils/figure-export.js'
import { stripLeadingQuestionNo } from '../../utils/question-type.js'

type PublicQuestion = ReturnType<typeof mapQuestion>
export type MatchMode = 'strict' | 'loose'
export type DifficultyMode = 'foundation' | 'standard' | 'advanced' | 'challenge' | 'custom'

type DifficultyRange = {
  min: number
  max: number
}

type DifficultyBucket = {
  scores: number[]
  weight: number
}

const legacyTypeCounts: Record<string, string> = {
  singleChoice: '单选题',
  multiChoice: '多选题',
  fillBlank: '填空题',
  bigQuestion: '解答题',
}

const difficultyPlans: Record<Exclude<DifficultyMode, 'custom'>, DifficultyBucket[]> = {
  foundation: [
    { scores: [1, 2], weight: 0.3 },
    { scores: [3, 4], weight: 0.6 },
    { scores: [5], weight: 0.1 },
  ],
  standard: [
    { scores: [3, 4], weight: 0.3 },
    { scores: [5, 6], weight: 0.6 },
    { scores: [7], weight: 0.1 },
  ],
  advanced: [
    { scores: [4, 5], weight: 0.2 },
    { scores: [6, 7], weight: 0.6 },
    { scores: [8], weight: 0.2 },
  ],
  challenge: [
    { scores: [6, 7], weight: 0.3 },
    { scores: [8, 9], weight: 0.6 },
    { scores: [10], weight: 0.1 },
  ],
}

function getDailyIndex(length: number, seed = ''): number {
  if (length <= 0) return 0
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const date = String(today.getDate()).padStart(2, '0')
  const dateStr = `${year}-${month}-${date}:${seed}` // YYYY-MM-DD + filters
  
  let hash = 0
  for (let i = 0; i < dateStr.length; i++) {
    hash = (hash << 5) - hash + dateStr.charCodeAt(i)
    hash |= 0 // Convert to 32bit integer
  }
  return Math.abs(hash) % length
}

function cleanText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function cleanList(value: unknown) {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，、;/；\n]+/) : []
  return Array.from(new Set(source.map(cleanText).filter(Boolean)))
}

function normalizeMatchMode(value: unknown): MatchMode {
  return value === 'loose' ? 'loose' : 'strict'
}

function normalizeDifficultyMode(value: unknown): DifficultyMode {
  return value === 'foundation' || value === 'advanced' || value === 'challenge' || value === 'custom'
    ? value
    : 'standard'
}

function normalizeDifficultyRange(value: unknown): DifficultyRange {
  const raw = (value || {}) as Record<string, unknown>
  const minValue = Math.trunc(Number(raw.min ?? 1))
  const maxValue = Math.trunc(Number(raw.max ?? 10))
  const min = Math.min(10, Math.max(1, Number.isFinite(minValue) ? minValue : 1))
  const max = Math.min(10, Math.max(1, Number.isFinite(maxValue) ? maxValue : 10))
  return { min: Math.min(min, max), max: Math.max(min, max) }
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

function pushLikeGroup(queryParts: string[], params: unknown[], column: string, values: string[]) {
  if (values.length === 0) return
  queryParts.push(`(${values.map(() => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`)
  values.forEach((value) => params.push(`%${escapeLike(value)}%`))
}

function buildReadyQuestionQuery(filters: {
  stage?: string
  knowledgePoints?: string[]
  solutionMethods?: string[]
  matchMode?: MatchMode
  includeDifficulty?: boolean
  difficultyMode?: DifficultyMode
  difficultyRange?: DifficultyRange
}) {
  const whereParts = ["bank_status = 'ready'"]
  const params: any[] = []
  const stage = cleanText(filters.stage)
  const kps = cleanList(filters.knowledgePoints)
  const sms = cleanList(filters.solutionMethods)
  const matchMode = normalizeMatchMode(filters.matchMode)

  if (stage) {
    whereParts.push('stage = ?')
    params.push(stage)
  }

  if (kps.length > 0 || sms.length > 0) {
    if (matchMode === 'loose' && kps.length > 0 && sms.length > 0) {
      const looseParts: string[] = []
      pushLikeGroup(looseParts, params, 'knowledge_points_json', kps)
      pushLikeGroup(looseParts, params, 'solution_methods_json', sms)
      whereParts.push(`(${looseParts.join(' OR ')})`)
    } else {
      pushLikeGroup(whereParts, params, 'knowledge_points_json', kps)
      pushLikeGroup(whereParts, params, 'solution_methods_json', sms)
    }
  }

  if (filters.includeDifficulty) {
    const targetScores = targetDifficultyScores(filters.difficultyMode, filters.difficultyRange)
    whereParts.push(`difficulty_score_10 IN (${targetScores.map(() => '?').join(', ')})`)
    params.push(...targetScores)
  }

  return {
    sql: `
      SELECT *
      FROM question_bank_items
      WHERE ${whereParts.join(' AND ')}
      ORDER BY serial_no ASC, id ASC
    `,
    params,
  }
}

function allReadyRows() {
  return db.prepare(`
    SELECT *
    FROM question_bank_items
    WHERE bank_status = 'ready'
    ORDER BY serial_no ASC, id ASC
  `).all() as QuestionRow[]
}

function shuffleArray<T>(array: T[]): T[] {
  const next = [...array]
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

function score10(question: PublicQuestion) {
  const score = Math.trunc(Number(question.difficultyScore10 || 0))
  return Number.isFinite(score) && score >= 1 && score <= 10 ? score : 0
}

function targetDifficultyScores(mode: unknown, range?: DifficultyRange) {
  const difficultyMode = normalizeDifficultyMode(mode)
  const scores = new Set<number>()
  if (difficultyMode === 'custom') {
    const normalized = normalizeDifficultyRange(range)
    for (let score = normalized.min; score <= normalized.max; score++) scores.add(score)
  } else {
    difficultyPlans[difficultyMode].forEach((bucket) => bucket.scores.forEach((score) => scores.add(score)))
  }
  return Array.from(scores).sort((a, b) => a - b)
}

function weightedBucketCounts(count: number, buckets: DifficultyBucket[]) {
  if (count <= 0) return []
  const raw = buckets.map((bucket, index) => {
    const exact = count * bucket.weight
    return {
      index,
      bucket,
      count: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    }
  })
  let allocated = raw.reduce((sum, item) => sum + item.count, 0)
  for (const item of [...raw].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (allocated >= count) break
    item.count += 1
    allocated += 1
  }
  return raw.flatMap((item) => Array.from({ length: item.count }, () => item.bucket))
}

function customDifficultyBuckets(count: number, range?: DifficultyRange) {
  const normalized = normalizeDifficultyRange(range)
  const scores: number[] = []
  for (let score = normalized.min; score <= normalized.max; score++) scores.push(score)
  return Array.from({ length: count }, (_, index) => ({ scores: [scores[index % scores.length]], weight: 1 }))
}

function difficultyBucketsForCount(count: number, mode: unknown, range?: DifficultyRange) {
  const difficultyMode = normalizeDifficultyMode(mode)
  if (difficultyMode === 'custom') return customDifficultyBuckets(count, range)
  return weightedBucketCounts(count, difficultyPlans[difficultyMode])
}

function normalizeTypeCounts(body: {
  typeCounts?: Record<string, unknown>
  counts?: Record<string, unknown>
}) {
  const entries = new Map<string, number>()
  const addCount = (type: string, rawCount: unknown) => {
    const cleanType = cleanText(type)
    const count = Math.min(100, Math.max(0, Math.trunc(Number(rawCount || 0))))
    if (!cleanType || !Number.isFinite(count) || count <= 0) return
    entries.set(cleanType, (entries.get(cleanType) || 0) + count)
  }

  if (body.typeCounts && typeof body.typeCounts === 'object') {
    Object.entries(body.typeCounts).forEach(([type, count]) => addCount(type, count))
  } else if (body.counts && typeof body.counts === 'object') {
    Object.entries(legacyTypeCounts).forEach(([legacyKey, type]) => addCount(type, body.counts?.[legacyKey]))
  } else {
    addCount('单选题', 8)
    addCount('多选题', 3)
    addCount('填空题', 3)
    addCount('解答题', 5)
  }

  return Object.fromEntries(entries)
}

function averageDifficulty(questions: PublicQuestion[]) {
  const scores = questions.map(score10).filter((score) => score > 0)
  if (scores.length === 0) return null
  return Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1))
}

function buildQuestionMarkdown(question: ReturnType<typeof mapQuestion>) {
  const stemMarkdown = stripLeadingQuestionNo(question.stemMarkdown || '', question.questionNo || '')
  const stemFigures = (question.figures || []).filter((f: any) => String(f.usage || '') !== 'analysis')
  const formattedStem = markdownWithInlineFigures(stemMarkdown, stemFigures)
  const extraFigures = figuresWithoutInlineMarkers(stemMarkdown, stemFigures)
  const figureLines = markdownFigureLines(extraFigures)

  let markdown = `${formattedStem}`
  if (figureLines.length > 0) {
    markdown += '\n\n' + figureLines.join('\n')
  }
  return markdown
}

function buildAnswerMarkdown(question: ReturnType<typeof mapQuestion>) {
  const solutionFigures = (question.figures || []).filter((f: any) => String(f.usage || '') === 'analysis')
  const formattedAnswer = markdownWithInlineFigures(question.answerText || '暂无答案', solutionFigures)
  const formattedAnalysis = markdownWithInlineFigures(question.analysisMarkdown || '暂无解析', solutionFigures)
  const solExtraFigures = figuresWithoutInlineMarkers(
    `${question.answerText || ''}\n${question.analysisMarkdown || ''}`,
    solutionFigures
  )
  const solFigureLines = markdownFigureLines(solExtraFigures)

  let answerMarkdown = `**参考答案：**\n\n${formattedAnswer}\n\n**解析：**\n\n${formattedAnalysis}`
  if (solFigureLines.length > 0) {
    answerMarkdown += '\n\n' + solFigureLines.join('\n')
  }
  return answerMarkdown
}

export function getDailyQuestion(filters: {
  stage?: string
  knowledgePoint?: string
  solutionMethod?: string
}) {
  const query = buildReadyQuestionQuery({
    stage: filters.stage,
    knowledgePoints: filters.knowledgePoint ? [filters.knowledgePoint] : [],
    solutionMethods: filters.solutionMethod ? [filters.solutionMethod] : [],
    matchMode: 'strict',
  })
  const rows = db.prepare(query.sql).all(...query.params) as QuestionRow[]
  if (rows.length === 0) {
    throw new RouteError(404, '没有找到符合筛选条件的题目，请尝试修改筛选条件。')
  }

  const seed = [filters.stage, filters.knowledgePoint, filters.solutionMethod].map((item) => cleanText(item)).join('|')
  const idx = getDailyIndex(rows.length, seed)
  const question = mapQuestion(rows[idx])
  const markdown = buildQuestionMarkdown(question)
  const answerMarkdown = buildAnswerMarkdown(question)

  return {
    question,
    markdown,
    answerMarkdown,
  }
}

export function getQuickActionMetadata(filters: {
  stage?: string
  knowledgePoints?: string[]
  solutionMethods?: string[]
  matchMode?: MatchMode
  difficultyMode?: DifficultyMode
  difficultyRange?: DifficultyRange
} = {}) {
  const readyQuestions = allReadyRows().map(mapQuestion)
  const stages = Array.from(new Set(readyQuestions.map((question) => cleanText(question.stage)).filter(Boolean)))
  const allTypeCounts = new Map<string, number>()
  readyQuestions.forEach((question) => {
    const type = cleanText(question.questionType) || '未设题型'
    allTypeCounts.set(type, (allTypeCounts.get(type) || 0) + 1)
  })

  const query = buildReadyQuestionQuery({
    stage: filters.stage,
    knowledgePoints: filters.knowledgePoints,
    solutionMethods: filters.solutionMethods,
    matchMode: filters.matchMode,
    includeDifficulty: true,
    difficultyMode: filters.difficultyMode,
    difficultyRange: filters.difficultyRange,
  })
  const filteredQuestions = (db.prepare(query.sql).all(...query.params) as QuestionRow[]).map(mapQuestion)
  const availableTypeCounts = new Map<string, number>()
  filteredQuestions.forEach((question) => {
    const type = cleanText(question.questionType) || '未设题型'
    availableTypeCounts.set(type, (availableTypeCounts.get(type) || 0) + 1)
  })

  return {
    stages,
    questionTypes: Array.from(allTypeCounts.entries()).map(([type, total]) => ({
      type,
      total,
      available: availableTypeCounts.get(type) || 0,
    })),
    totalReady: readyQuestions.length,
    filteredTotal: filteredQuestions.length,
    averageDifficulty: averageDifficulty(filteredQuestions),
    difficultyUnknownCount: readyQuestions.filter((question) => score10(question) === 0).length,
  }
}

export function generateRandomPaper(body: {
  stage?: string
  matchMode?: MatchMode
  difficultyMode?: DifficultyMode
  difficultyRange?: DifficultyRange
  typeCounts?: Record<string, unknown>
  knowledgePoints?: string[]
  solutionMethods?: string[]
  counts?: {
    singleChoice?: number
    multiChoice?: number
    fillBlank?: number
    bigQuestion?: number
  }
}) {
  const matchMode = normalizeMatchMode(body.matchMode)
  const difficultyMode = normalizeDifficultyMode(body.difficultyMode)
  const difficultyRange = normalizeDifficultyRange(body.difficultyRange)
  const typeCounts = normalizeTypeCounts(body)
  const targetScores = new Set(targetDifficultyScores(difficultyMode, difficultyRange))
  const requestedTotal = Object.values(typeCounts).reduce((sum, count) => sum + count, 0)
  if (requestedTotal <= 0) throw new RouteError(400, '请至少设置 1 道题。')

  const query = buildReadyQuestionQuery({
    stage: body.stage,
    knowledgePoints: body.knowledgePoints,
    solutionMethods: body.solutionMethods,
    matchMode,
  })

  const rows = db.prepare(query.sql).all(...query.params) as QuestionRow[]
  if (rows.length === 0) {
    throw new RouteError(404, '没有找到符合筛选条件的题目，请选择其他知识点或解题方法。')
  }

  const questions = rows.map(mapQuestion)
  const selectedQuestions: PublicQuestion[] = []
  const selectedIds = new Set<string>()
  const warnings: string[] = []

  const takeOne = (pool: PublicQuestion[], predicate: (question: PublicQuestion) => boolean) => {
    const candidates = shuffleArray(pool.filter((question) => !selectedIds.has(question.id) && predicate(question)))
    return candidates[0] || null
  }

  Object.entries(typeCounts).forEach(([type, reqCount]) => {
    const pool = questions.filter((question) => (cleanText(question.questionType) || '未设题型') === type)
    const slots = difficultyBucketsForCount(reqCount, difficultyMode, difficultyRange)
    const beforeCount = selectedQuestions.length
    let usedAdjacent = false
    let usedTargetRange = false
    let usedUnknown = false

    slots.forEach((slot) => {
      const slotScores = new Set(slot.scores)
      const adjacentScores = new Set(
        slot.scores.flatMap((score) => [score - 1, score + 1]).filter((score) => score >= 1 && score <= 10)
      )
      const selected =
        takeOne(pool, (question) => slotScores.has(score10(question))) ||
        takeOne(pool, (question) => {
          const score = score10(question)
          const ok = adjacentScores.has(score)
          if (ok) usedAdjacent = true
          return ok
        }) ||
        takeOne(pool, (question) => {
          const score = score10(question)
          const ok = targetScores.has(score)
          if (ok) usedTargetRange = true
          return ok
        }) ||
        takeOne(pool, (question) => {
          const ok = score10(question) === 0
          if (ok) usedUnknown = true
          return ok
        })

      if (!selected) return
      selectedIds.add(selected.id)
      selectedQuestions.push(selected)
    })

    const providedCount = selectedQuestions.length - beforeCount
    if (providedCount < reqCount) {
      warnings.push(`题库中符合条件的${type}数量不足，仅提供 ${providedCount} 道（请求 ${reqCount} 道）。`)
    }
    if (usedAdjacent) warnings.push(`部分${type}使用了相邻难度题补足。`)
    if (usedTargetRange) warnings.push(`部分${type}使用了同题型目标范围内其他难度题补足。`)
    if (usedUnknown) warnings.push(`部分${type}使用了难度待定题作为兜底。`)
  })

  if (selectedQuestions.length === 0) {
    throw new RouteError(404, '题库中符合条件的题目数量为 0，请修改筛选条件。')
  }

  const generatedTypeCounts = selectedQuestions.reduce<Record<string, number>>((acc, question) => {
    const type = cleanText(question.questionType) || '未设题型'
    acc[type] = (acc[type] || 0) + 1
    return acc
  }, {})

  return {
    questions: selectedQuestions,
    warnings: Array.from(new Set(warnings)),
    summary: {
      requestedTotal,
      generatedTotal: selectedQuestions.length,
      typeCounts: generatedTypeCounts,
      averageDifficulty: averageDifficulty(selectedQuestions),
      matchMode,
      difficultyMode,
      difficultyRange: difficultyMode === 'custom' ? difficultyRange : undefined,
    }
  }
}

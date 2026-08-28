import { RouteError } from '../utils/http-error.js'

type JsonRecord = Record<string, unknown>

export type CanonicalQuestionJson = {
  questionNo?: string
  stage?: string
  questionType?: string
  sourceTitle?: string
  stemMarkdown: string
  answerText?: string
  analysisMarkdown?: string
  knowledgePoints?: unknown
  solutionMethods?: unknown
  difficultyScore10?: unknown
  difficultyLabel?: string
  totalScore?: unknown
  scoringRubric?: unknown
  needsHumanReview: boolean
}

export type CanonicalQuestionJsonPayload = {
  sourceTitle?: string
  stage?: string
  questions: CanonicalQuestionJson[]
}

function invalid(message: string): never {
  throw new RouteError(400, `题目 JSON schema 错误：${message}`)
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label}必须是对象。`)
  return value as JsonRecord
}

function optionalString(raw: JsonRecord, aliases: readonly string[], label: string) {
  for (const key of aliases) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'string') invalid(`字段 ${key}（${label}）必须是字符串。`)
    return raw[key] as string
  }
  return undefined
}

function optionalBoolean(raw: JsonRecord, aliases: readonly string[], label: string) {
  for (const key of aliases) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'boolean') invalid(`字段 ${key}（${label}）必须是布尔值。`)
    return raw[key] as boolean
  }
  return undefined
}

function optionalNumber(raw: JsonRecord, aliases: readonly string[], label: string) {
  for (const key of aliases) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key])) invalid(`字段 ${key}（${label}）必须是有限数字。`)
    return raw[key]
  }
  return undefined
}

function optionalTags(raw: JsonRecord, aliases: readonly string[], label: string) {
  for (const key of aliases) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'string' && !Array.isArray(raw[key])) invalid(`字段 ${key}（${label}）必须是字符串或字符串数组。`)
    if (Array.isArray(raw[key]) && raw[key].some((item) => typeof item !== 'string')) invalid(`字段 ${key}（${label}）只能包含字符串。`)
    return raw[key]
  }
  return undefined
}

function optionalArray(raw: JsonRecord, aliases: readonly string[], label: string) {
  for (const key of aliases) {
    if (raw[key] === undefined) continue
    if (!Array.isArray(raw[key])) invalid(`字段 ${key}（${label}）必须是数组。`)
    return raw[key]
  }
  return undefined
}

/**
 * Strict contract for JSON explicitly supplied by users.  This deliberately
 * does not share createQuestion's blank-draft defaults.
 */
export function normalizeQuestionJson(rawValue: unknown, index?: number): CanonicalQuestionJson {
  const raw = record(rawValue, `questions[${index ?? 0}]`)
  const stemMarkdown = optionalString(raw, ['problem_text', 'stemMarkdown', 'problemText'], '题干')
  if (stemMarkdown === undefined || !stemMarkdown.trim()) invalid(`questions[${index ?? 0}] 缺少非空题干（problem_text、stemMarkdown 或 problemText）。`)

  const review = optionalBoolean(raw, ['needs_human_review', 'needsHumanReview'], '人工复核')
  return {
    questionNo: optionalString(raw, ['question_no', 'questionNo'], '题号'),
    stage: optionalString(raw, ['stage'], '学段'),
    questionType: optionalString(raw, ['question_type', 'questionType'], '题型'),
    sourceTitle: optionalString(raw, ['source_title', 'sourceTitle', 'paperTitle'], '来源'),
    stemMarkdown,
    answerText: optionalString(raw, ['answer', 'answerText'], '答案'),
    analysisMarkdown: optionalString(raw, ['analysis', 'analysisMarkdown', 'analysisText'], '解析'),
    knowledgePoints: optionalTags(raw, ['knowledge_points', 'knowledgePoints'], '知识点'),
    solutionMethods: optionalTags(raw, ['solution_methods', 'solutionMethods'], '解题方法'),
    difficultyScore10: optionalNumber(raw, ['difficulty_score_10', 'difficultyScore10'], '难度'),
    difficultyLabel: optionalString(raw, ['difficulty_label', 'difficultyLabel'], '难度标签'),
    totalScore: optionalNumber(raw, ['total_score', 'totalScore'], '分值'),
    scoringRubric: optionalArray(raw, ['scoring_rubric', 'scoringRubric'], '评分细则'),
    needsHumanReview: review ?? false,
  }
}

export function normalizeQuestionJsonPayload(value: unknown): CanonicalQuestionJsonPayload {
  const outer = Array.isArray(value) ? undefined : record(value, '请求体')
  const rawQuestions = Array.isArray(value) ? value : (outer as JsonRecord).questions
  if (!Array.isArray(rawQuestions) || !rawQuestions.length) invalid('必须提供至少一道题目的 questions 数组。')
  if (outer && outer.sourceTitle !== undefined && typeof outer.sourceTitle !== 'string') invalid('字段 sourceTitle 必须是字符串。')
  if (outer && outer.paperTitle !== undefined && typeof outer.paperTitle !== 'string') invalid('字段 paperTitle 必须是字符串。')
  if (outer && outer.stage !== undefined && typeof outer.stage !== 'string') invalid('字段 stage 必须是字符串。')
  return {
    sourceTitle: outer ? (outer.sourceTitle ?? outer.paperTitle) as string | undefined : undefined,
    stage: outer?.stage as string | undefined,
    questions: rawQuestions.map((question, index) => normalizeQuestionJson(question, index)),
  }
}

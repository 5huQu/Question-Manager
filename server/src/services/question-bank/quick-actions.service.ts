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

function getDailyIndex(length: number): number {
  if (length <= 0) return 0
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const date = String(today.getDate()).padStart(2, '0')
  const dateStr = `${year}-${month}-${date}` // YYYY-MM-DD
  
  let hash = 0
  for (let i = 0; i < dateStr.length; i++) {
    hash = (hash << 5) - hash + dateStr.charCodeAt(i)
    hash |= 0 // Convert to 32bit integer
  }
  return Math.abs(hash) % length
}

function shuffleArray<T>(array: T[]): T[] {
  const next = [...array]
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
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
  knowledgePoint?: string
  solutionMethod?: string
}) {
  let query = "SELECT * FROM question_bank_items WHERE bank_status = 'ready'"
  const params: any[] = []

  if (filters.knowledgePoint) {
    query += " AND knowledge_points_json LIKE ?"
    params.push(`%${filters.knowledgePoint}%`)
  }

  if (filters.solutionMethod) {
    query += " AND solution_methods_json LIKE ?"
    params.push(`%${filters.solutionMethod}%`)
  }

  const rows = db.prepare(query).all(...params) as QuestionRow[]
  if (rows.length === 0) {
    throw new RouteError(404, '没有找到符合筛选条件的题目，请尝试修改筛选条件。')
  }

  // Deterministically select using date hash
  const idx = getDailyIndex(rows.length)
  const question = mapQuestion(rows[idx])
  const markdown = buildQuestionMarkdown(question)
  const answerMarkdown = buildAnswerMarkdown(question)

  return {
    question,
    markdown,
    answerMarkdown,
  }
}

export function generateRandomPaper(body: {
  knowledgePoints?: string[]
  solutionMethods?: string[]
  counts?: {
    singleChoice?: number
    multiChoice?: number
    fillBlank?: number
    bigQuestion?: number
  }
}) {
  const kps = body.knowledgePoints || []
  const sms = body.solutionMethods || []
  const counts = {
    singleChoice: Number(body.counts?.singleChoice ?? 8),
    multiChoice: Number(body.counts?.multiChoice ?? 3),
    fillBlank: Number(body.counts?.fillBlank ?? 3),
    bigQuestion: Number(body.counts?.bigQuestion ?? 5),
  }

  let query = "SELECT * FROM question_bank_items WHERE bank_status = 'ready'"
  const params: any[] = []

  if (kps.length > 0) {
    const kpSql = kps.map(() => 'knowledge_points_json LIKE ?').join(' OR ')
    query += ` AND (${kpSql})`
    kps.forEach(kp => params.push(`%${kp}%`))
  }

  if (sms.length > 0) {
    const smSql = sms.map(() => 'solution_methods_json LIKE ?').join(' OR ')
    query += ` AND (${smSql})`
    sms.forEach(sm => params.push(`%${sm}%`))
  }

  const rows = db.prepare(query).all(...params) as QuestionRow[]
  if (rows.length === 0) {
    throw new RouteError(404, '没有找到符合筛选条件的题目，请选择其他知识点或解题方法。')
  }

  const questions = rows.map(mapQuestion)

  // Group by question type
  const grouped: Record<string, typeof questions> = {
    '单选题': [],
    '多选题': [],
    '填空题': [],
    '解答题': [],
  }

  questions.forEach(q => {
    const type = q.questionType || '解答题'
    if (grouped[type]) {
      grouped[type].push(q)
    } else {
      // fallback other types to big question
      grouped['解答题'].push(q)
    }
  })

  const selectedQuestions: typeof questions = []
  const warnings: string[] = []

  // Helper to select and handle counts
  const selectType = (type: string, reqCount: number) => {
    const available = grouped[type] || []
    const shuffled = shuffleArray(available)
    const taken = shuffled.slice(0, reqCount)
    selectedQuestions.push(...taken)

    if (taken.length < reqCount) {
      warnings.push(`题库中符合条件的${type}数量不足，仅提供 ${taken.length} 道（请求 ${reqCount} 道）`)
    }
  }

  selectType('单选题', counts.singleChoice)
  selectType('多选题', counts.multiChoice)
  selectType('填空题', counts.fillBlank)
  selectType('解答题', counts.bigQuestion)

  if (selectedQuestions.length === 0) {
    throw new RouteError(404, '题库中符合条件的题目数量为 0，请修改筛选条件。')
  }

  return {
    questions: selectedQuestions,
    warnings,
  }
}

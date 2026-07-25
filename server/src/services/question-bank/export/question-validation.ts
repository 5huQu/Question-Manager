import { bindInlineImageReferences } from '../../../utils/figure-helpers.js'
import { validateQuestionMarkdown } from '../../../utils/validation.js'
import { mapQuestion } from '../../../db/questions.js'
import { collectionSectionNames } from './collection-helpers.js'
import { exportFieldsForVariant, type ExportCollection, type ExportContentField, type ExportVariant, type StandardExportVariant } from './types.js'
import type { QuestionRow } from '../../../types/index.js'

export function questionForExport(item: ReturnType<typeof mapQuestion>, runId: string, fields: ExportContentField[] = exportFieldsForVariant('teacher')) {
  assertQuestionExportable(item, fields)
  const binding = bindInlineImageReferences(
    {
      id: item.id,
      problem_text: item.stemMarkdown,
      answer: item.answerText,
      analysis: item.analysisMarkdown,
    },
    runId,
    { localFigures: item.figures, fields },
  )
  if (!binding) return item
  if (binding.issue) {
    const label = item.questionNo ? `第 ${item.questionNo} 题` : `题目 #${item.id}`
    throw new Error(`${label}图片尚未完成绑定：${binding.issue.message}。请先在"框选题图"中复核。`)
  }
  return {
    ...item,
    stemMarkdown: binding.stem,
    answerText: binding.answer,
    analysisMarkdown: binding.analysis,
    figures: binding.figures,
  }
}

export function assertQuestionExportable(
  item: Pick<ReturnType<typeof mapQuestion>, 'id' | 'questionNo' | 'stemMarkdown' | 'answerText' | 'analysisMarkdown'>,
  fields: ExportContentField[] = exportFieldsForVariant('teacher'),
) {
  const issues = validateQuestionMarkdown({ problem_text: item.stemMarkdown, answer: item.answerText, analysis: item.analysisMarkdown })
    .filter((issue) => {
      if (issue.field === '题干') return fields.includes('stem')
      if (issue.field === '答案') return fields.includes('answer')
      if (issue.field === '解析') return fields.includes('analysis')
      return true
    })
  if (!issues.length) return
  const label = item.questionNo ? `第 ${item.questionNo} 题` : `题目 #${item.id}`
  const issue = issues[0]
  throw new Error(`${label}${issue.field}存在公式格式问题：${issue.snippet}。请修复后再导出。`)
}

export function assertCollectionExportable(collection: ExportCollection, fields: ExportContentField[] = exportFieldsForVariant('teacher')) {
  collection.questions.forEach((entry) => assertQuestionExportable(entry.item, fields))
}

/** A pseudo-collection built from an ordered question set for worksheet export. */
export function buildQuestionSetWorksheetCollection(input: {
  id: string
  title: string
  subtitle?: string
  createdAt?: string
  updatedAt?: string
  rows: QuestionRow[]
  bindingRunId?: string
  variant: StandardExportVariant
}) {
  const rows = input.rows
  const sectionNames = collectionSectionNames(rows)
  let previousSection = ''
  return {
    id: input.id,
    title: input.title || '综合练习',
    subtitle: input.subtitle || '学生版',
    description: '',
    kind: 'paper' as const,
    status: 'finalized' as const,
    totalScore: 0,
    timeLimit: 0,
    exportFormat: 'pdf',
    questionCount: rows.length,
    createdAt: input.createdAt || '',
    updatedAt: input.updatedAt || '',
    questions: rows.map((row, index) => {
      const item = questionForExport(
        mapQuestion(row),
        input.bindingRunId || row.source_run_id || input.id,
        exportFieldsForVariant(input.variant),
      )
      const section = sectionNames.get(item.questionType) || ''
      const sectionName = section && section !== previousSection ? section : ''
      if (section) previousSection = section
      return {
        relationId: `${input.id}-${item.id}`,
        sortOrder: index + 1,
        score: 0,
        sectionName,
        item,
      }
    }),
  }
}

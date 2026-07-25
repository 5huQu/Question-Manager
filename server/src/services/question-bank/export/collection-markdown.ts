import { stripLeadingQuestionNo } from '../../../utils/question-type.js'
import {
  markdownWithInlineFigures,
  markdownFigureLines,
  questionFigures,
  analysisFigures,
  figuresWithoutInlineMarkers,
} from '../../../utils/figure-export.js'
import { markdownQuestionLine } from './collection-helpers.js'
import { assertCollectionExportable } from './question-validation.js'
import { buildCollectionErrorNotebookMarkdown } from './error-notebook.js'
import { exportFieldsForVariant, type ExportCollection, type ExportVariant } from './types.js'

export function buildCollectionMarkdown(
  collection: ExportCollection,
  variant: ExportVariant,
) {
  if (variant === 'error_notebook') return buildCollectionErrorNotebookMarkdown(collection)
  assertCollectionExportable(collection, exportFieldsForVariant(variant))
  const lines: string[] = []
  lines.push(`# ${collection.title || '未命名试卷'}（${variant === 'teacher' ? '教师版' : '学生版'}）`)
  if (collection.subtitle) lines.push('', collection.subtitle)
  const meta = [`题数：${collection.questionCount}`]
  if (collection.totalScore) meta.push(`总分：${collection.totalScore}`)
  if (collection.timeLimit) meta.push(`时长：${collection.timeLimit} 分钟`)
  lines.push('', meta.join(' | '), '')
  let currentSection = ''
  collection.questions.forEach((entry, index) => {
    if (entry.sectionName && entry.sectionName !== currentSection) {
      currentSection = entry.sectionName
      lines.push('', `## ${currentSection}`, '')
    }
    const stemFigures = questionFigures(entry)
    lines.push(markdownQuestionLine(index + 1, entry, stemFigures), '')
    lines.push(...markdownFigureLines(figuresWithoutInlineMarkers(entry.item.stemMarkdown, stemFigures)), '')
    if (variant === 'teacher') {
      const solutionFigures = analysisFigures(entry)
      lines.push(`参考答案：${markdownWithInlineFigures(entry.item.answerText || '暂无', solutionFigures)}`, '')
      lines.push(`解析：${markdownWithInlineFigures(entry.item.analysisMarkdown || '暂无', solutionFigures)}`, '')
      lines.push(
        ...markdownFigureLines(
          figuresWithoutInlineMarkers(
            `${entry.item.answerText || ''}\n${entry.item.analysisMarkdown || ''}`,
            solutionFigures,
          ),
        ),
        '',
      )
    }
  })
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n'
}

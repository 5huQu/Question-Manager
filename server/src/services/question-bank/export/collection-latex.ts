import { stripLeadingQuestionNo } from '../../../utils/question-type.js'
import {
  latexWithInlineFigures,
  latexFigureLines,
  questionFigures,
  analysisFigures,
  figuresWithoutInlineMarkers,
} from '../../../utils/figure-export.js'
import { escapeLatex } from './collection-helpers.js'
import { assertCollectionExportable } from './question-validation.js'
import { buildCollectionErrorNotebookLatex } from './error-notebook.js'
import { exportFieldsForVariant, type ExportCollection, type ExportVariant } from './types.js'

export function buildCollectionLatex(
  collection: ExportCollection,
  variant: ExportVariant,
) {
  if (variant === 'error_notebook') return buildCollectionErrorNotebookLatex(collection)
  assertCollectionExportable(collection, exportFieldsForVariant(variant))
  const lines: string[] = [
    '\\documentclass[12pt]{ctexart}',
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage{graphicx}',
    '\\usepackage[a4paper,margin=2.2cm]{geometry}',
    '\\setlength{\\parindent}{0pt}',
    '\\setlength{\\parskip}{0.8em}',
    '\\begin{document}',
    `\\begin{center}{\\LARGE ${escapeLatex(collection.title || '未命名试卷')}（${variant === 'teacher' ? '教师版' : '学生版'}）}\\end{center}`,
  ]
  if (collection.subtitle) lines.push(`\\begin{center}${escapeLatex(collection.subtitle)}\\end{center}`)
  lines.push(
    `题数：${collection.questionCount}${collection.totalScore ? `\\quad 总分：${collection.totalScore}` : ''}${collection.timeLimit ? `\\quad 时长：${collection.timeLimit} 分钟` : ''}`,
  )
  let currentSection = ''
  collection.questions.forEach((entry, index) => {
    if (entry.sectionName && entry.sectionName !== currentSection) {
      currentSection = entry.sectionName
      lines.push(`\\subsection*{${escapeLatex(currentSection)}}`)
    }
    const score = Number(entry.score || 0)
    lines.push(`\\textbf{${index + 1}.}${score ? `（${score} 分）` : ''}`)
    const stemFigures = questionFigures(entry)
    const stem = stripLeadingQuestionNo(entry.item.stemMarkdown, entry.item.questionNo)
    lines.push(latexWithInlineFigures(stem || '（题干待补充）', stemFigures))
    lines.push(...latexFigureLines(figuresWithoutInlineMarkers(stem, stemFigures)))
    if (variant === 'teacher') {
      const solutionFigures = analysisFigures(entry)
      lines.push(`\\textbf{参考答案：}${latexWithInlineFigures(entry.item.answerText || '暂无', solutionFigures)}`)
      lines.push(`\\textbf{解析：}${latexWithInlineFigures(entry.item.analysisMarkdown || '暂无', solutionFigures)}`)
      lines.push(
        ...latexFigureLines(
          figuresWithoutInlineMarkers(
            `${entry.item.answerText || ''}\n${entry.item.analysisMarkdown || ''}`,
            solutionFigures,
          ),
        ),
      )
    }
  })
  lines.push('\\end{document}')
  return lines.join('\n\n') + '\n'
}

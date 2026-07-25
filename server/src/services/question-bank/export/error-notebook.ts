import fs from 'node:fs'
import path from 'node:path'
import { storageRoot } from '../../../config.js'
import { safeName } from '../../../utils/ids.js'
import { normalizeQuestionType, stripLeadingQuestionNo } from '../../../utils/question-type.js'
import {
  markdownWithInlineFigures,
  latexWithInlineFigures,
  markdownFigureLines,
  latexFigureLines,
  questionFigures,
  figuresWithoutInlineMarkers,
} from '../../../utils/figure-export.js'
import { splitChoiceStemForExport } from '../../../utils/exam-zh.js'
import { compileWorksheetTex } from '../../../utils/worksheet-figures.js'
import { escapeLatex, sectionOrdinal, stripLeadingScore } from './collection-helpers.js'
import { assertCollectionExportable } from './question-validation.js'
import type { ExportCollection } from './types.js'

function errorNotebookGroups(collection: ExportCollection) {
  const groups = new Map<string, typeof collection.questions>()
  collection.questions.forEach((entry) => {
    const questionType = normalizeQuestionType(entry.item.questionType, entry.item.stemMarkdown, entry.item.answerText)
    const entries = groups.get(questionType) || []
    entries.push(entry)
    groups.set(questionType, entries)
  })
  return [...groups.entries()].map(([questionType, entries], index) => ({
    title: `${sectionOrdinal(index + 1)}、${questionType}`,
    entries,
  }))
}

export function buildCollectionErrorNotebookMarkdown(collection: ExportCollection) {
  assertCollectionExportable(collection, ['stem'])
  const lines = [
    '# 错题本',
    '',
    `> 来源：${collection.title || '未命名题集'}  `,
    `> 题目数量：${collection.questionCount} 题`,
  ]
  let questionIndex = 0
  errorNotebookGroups(collection).forEach((group) => {
    lines.push('', `## ${group.title}`, '', '---', '')
    group.entries.forEach((entry) => {
      questionIndex += 1
      const stemFigures = questionFigures(entry)
      const stem = stripLeadingScore(stripLeadingQuestionNo(entry.item.stemMarkdown, entry.item.questionNo))
      lines.push(`**${questionIndex}.** ${markdownWithInlineFigures(stem || '（题干待补充）', stemFigures)}`, '')
      lines.push(...markdownFigureLines(figuresWithoutInlineMarkers(stem, stemFigures)), '')
    })
  })
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n'
}

function errorNotebookQuestionLatex(entry: ExportCollection['questions'][number], index: number) {
  const originalStem = stripLeadingScore(stripLeadingQuestionNo(entry.item.stemMarkdown, entry.item.questionNo))
  const { prompt, choices, trailingContent } = splitChoiceStemForExport(originalStem)
  const stemFigures = questionFigures(entry)
  const lines = [`\\questionnumber{${index}}`]
  const renderText = (value: string) => latexWithInlineFigures(value, stemFigures).replace(/_{2,}/g, '\\underline{\\hspace{3.2em}}')
  if (choices.length === 4) {
    lines[0] += renderText(prompt || '（题干待补充）')
    lines.push('\\vspace{0.45em}', '\\begin{tabularx}{\\textwidth}{@{}XXXX@{}}')
    lines.push(choices.map((choice, choiceIndex) => `${String.fromCharCode(65 + choiceIndex)}. ${renderText(choice)}`).join(' &\n'))
    lines.push('\\end{tabularx}')
    if (trailingContent) lines.push(renderText(trailingContent))
  } else {
    lines[0] += renderText(originalStem || '（题干待补充）')
  }
  lines.push(...latexFigureLines(figuresWithoutInlineMarkers(originalStem, stemFigures)))
  return lines
}

export function buildCollectionErrorNotebookLatex(collection: ExportCollection) {
  assertCollectionExportable(collection, ['stem'])
  const lines = [
    '\\documentclass[UTF8,12pt]{ctexart}',
    '\\usepackage[a4paper,top=22mm,bottom=24mm,left=22mm,right=22mm]{geometry}',
    '\\usepackage{amsmath}',
    '\\usepackage{fontspec}',
    '\\usepackage{unicode-math}',
    '\\usepackage{graphicx}',
    '\\usepackage{tabularx}',
    '\\usepackage{xcolor}',
    '\\usepackage{fancyhdr}',
    '\\IfFontExistsTF{Songti SC}{\\setCJKmainfont{Songti SC}}{\\IfFontExistsTF{SimSun}{\\setCJKmainfont{SimSun}}{\\setCJKmainfont{FandolSong-Regular}}}',
    '\\IfFontExistsTF{Times New Roman}{\\setmainfont{Times New Roman}}{\\setmainfont{TeX Gyre Termes}}',
    '\\IfFontExistsTF{STIX Two Math}{\\setmathfont{STIX Two Math}}{\\setmathfont{Latin Modern Math}}',
    '\\setlength{\\parindent}{0pt}',
    '\\setlength{\\parskip}{0pt}',
    '\\setlength{\\headheight}{15pt}',
    '\\linespread{1.18}',
    '\\pagestyle{fancy}',
    '\\fancyhf{}',
    '\\fancyhead[L]{\\small\\color{gray}错题本}',
    `\\fancyhead[R]{\\small\\color{gray}${escapeLatex(collection.title || '未命名题集')}}`,
    '\\fancyfoot[C]{\\small\\color{gray}\\thepage}',
    '\\renewcommand{\\headrulewidth}{0pt}',
    '\\newcommand{\\notebooksection}[1]{\\vspace{0.8em}{\\fontsize{13.5pt}{17pt}\\selectfont\\bfseries #1\\par}\\vspace{0.22em}\\hrule height 0.55pt\\vspace{0.65em}}',
    '\\newcommand{\\questionnumber}[1]{{\\bfseries #1.}\\hspace{0.65em}}',
    '\\begin{document}',
  ]
  let questionIndex = 0
  errorNotebookGroups(collection).forEach((group) => {
    lines.push(`\\notebooksection{${escapeLatex(group.title)}}`)
    group.entries.forEach((entry) => {
      questionIndex += 1
      lines.push(...errorNotebookQuestionLatex(entry, questionIndex), '\\vspace{0.8em}')
    })
  })
  lines.push('\\end{document}')
  return lines.join('\n\n') + '\n'
}

export function exportCollectionErrorNotebookPdf(collection: ExportCollection) {
  if (!collection.questions.length) throw new Error('当前试题篮没有题目，无法导出。')
  const exportRoot = path.join(storageRoot, 'output', 'pdf', 'collection-exports', safeName(collection.id))
  fs.mkdirSync(exportRoot, { recursive: true })
  const baseName = `${safeName(collection.title || '错题本')}-error-notebook`
  const texPath = path.join(exportRoot, `${baseName}.tex`)
  fs.writeFileSync(texPath, buildCollectionErrorNotebookLatex(collection), 'utf8')
  compileWorksheetTex(texPath)
  return path.join(exportRoot, `${baseName}.pdf`)
}

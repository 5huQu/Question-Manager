import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { db } from '../../db/connection.js'
import { sourceRoot, storageRoot } from '../../config.js'
import { safeName } from '../../utils/ids.js'
import { normalizeQuestionType } from '../../utils/question-type.js'
import {
  markdownWithInlineFigures,
  latexWithInlineFigures,
  markdownFigureLines,
  latexFigureLines,
  questionFigures,
  analysisFigures,
  questionPlainText,
  figuresWithoutInlineMarkers,
  doc2xInlineFigureIds,
  figuresByIdentifier,
} from '../../utils/figure-export.js'
import { bindInlineImageReferences } from '../../utils/figure-helpers.js'
import { markdownToExamLatex as richMarkdownToExamLatex } from '../../utils/rich-content.js'
import {
  worksheetFigureWidthLimits,
  worksheetFigureId,
  optimizeWorksheetFigures,
  worksheetAnswerLatex,
  compileWorksheetTex,
  worksheetEntryKey,
  buildWorksheetScorePlan,
  worksheetSectionTitle,
  qbankChoiceLayout,
  worksheetMaxLayoutIterations,
  parseWorksheetFigureTelemetry,
  parseWorksheetQuestionTelemetry,
  worksheetTelemetryWarnings,
  decideWorksheetFigureLayout,
  WorksheetFigureSpec,
} from '../../utils/worksheet-figures.js'
import {
  renderExamZhPrompt,
  buildRunExamZhLatex,
  exportRunExamZh,
  exportExamZhQuestionSet,
  splitChoiceStemForExport,
} from '../../utils/exam-zh.js'
import { readAppSettings } from '../settings/app-settings.js'
import { collectionExportItems } from './collections.js'
import { mapQuestion } from '../../db/questions.js'
import { getCollection } from '../../db/collections.js'
import { getRun } from '../../db/runs.js'
import { resolveStoragePath } from '../../utils/paths.js'
import { stripAssetPrefix } from '../../utils/ocr-helpers.js'
import { stripLeadingQuestionNo } from '../../utils/question-type.js'
import { validateQuestionMarkdown } from '../../utils/validation.js'
import type { QuestionRow } from '../../types/index.js'
import type { PaperLayoutDraft, QuestionLayout, ChoiceLayoutOverride, LayoutWarning } from './paper-layout.js'
import { templateRenderSpec } from './template-render-spec.js'
import { figureLayoutFor, questionLayoutFor } from './paper-layout.js'

/**
 * Collection-shaped object with the minimum fields needed for export.
 * In index.ts this is `NonNullable<ReturnType<typeof getCollection>>`.
 */
export type ExportCollection = NonNullable<ReturnType<typeof getCollection>>

function collectionQuestionRows(collection: ExportCollection): QuestionRow[] {
  return collection.questions.map((entry, index) => {
    const item = entry.item as Record<string, any>
    return {
      id: String(item.id || entry.relationId || `question-${index + 1}`),
      serial_no: Number(item.serialNo || index + 1),
      question_no: String(item.questionNo || index + 1),
      stage: String(item.stage || '高三'),
      question_type: String(item.questionType || ''),
      difficulty_score: Number(item.difficultyScore || 0),
      difficulty_score_10: Number(item.difficultyScore10 || 0),
      difficulty_label: String(item.difficultyLabel || ''),
      chapter: String(item.chapter || ''),
      knowledge_points_json: JSON.stringify(item.knowledgePoints || []),
      solution_methods_json: JSON.stringify(item.solutionMethods || []),
      source_title: String(item.sourceTitle || ''),
      province: String(item.province || ''),
      city: String(item.city || ''),
      paper_title: String(item.paperTitle || ''),
      batch_name: String(item.batchName || ''),
      subject: String(item.subject || ''),
      paper_kind: item.paperKind || 'unknown',
      exam_year: Number(item.examYear || 0),
      source_org: String(item.sourceOrg || ''),
      import_source_id: String(item.importSourceId || ''),
      bank_status: item.bankStatus || 'ready',
      stem_markdown: String(item.stemMarkdown || ''),
      answer_text: String(item.answerText || ''),
      analysis_markdown: String(item.analysisMarkdown || ''),
      content_revision: Number(item.contentRevision || 1),
      total_score: Number(entry.score || item.totalScore || 0),
      scoring_rubric_json: JSON.stringify(item.scoringRubric || []),
      search_text: String(item.searchText || ''),
      slice_image_path: String(item.sliceImagePath || ''),
      figures_json: JSON.stringify(item.figures || []),
      source_run_id: String(item.sourceRunId || ''),
      source_solution_run_id: String(item.sourceSolutionRunId || ''),
      merge_status: String(item.mergeStatus || ''),
      merge_note: String(item.mergeNote || ''),
      format_review_required: item.needsFormatReview ? 1 : 0,
      format_review_reasons_json: JSON.stringify(item.formatIssue ? [item.formatIssue] : []),
      created_at: String(item.createdAt || collection.createdAt || ''),
      updated_at: String(item.updatedAt || collection.updatedAt || ''),
    } as QuestionRow
  })
}

// ---------------------------------------------------------------------------
// Local helpers still in index.ts (not yet extracted to utils)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Exam-zh helpers duplicated here until the legacy copies in index.ts are
// removed; these delegate to the utils/exam-zh.ts module.
// ---------------------------------------------------------------------------

const DOC2X_FIGURE_MARKER_RE = /<!--\s*DOC2X_FIGURE:([^>\s]+)\s*-->/g
type ExportContentField = 'stem' | 'answer' | 'analysis'

/** Escape special LaTeX characters for text (non-math) segments. */
function escapeLatex(value: string) {
  return questionPlainText(value)
    .replace(/([#%&])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\n{2,}/g, '\n\n')
}

/** A pseudo-collection built from an ordered question set for worksheet export. */
function buildQuestionSetWorksheetCollection(input: {
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

/**
 * Re-run the same local-figure binding used by OCR review before exporting.
 * This is intentionally non-mutating: export either gets a fully consistent
 * snapshot or stops with an actionable question number.
 */
function questionForExport(item: ReturnType<typeof mapQuestion>, runId: string, fields: ExportContentField[] = exportFieldsForVariant('teacher')) {
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
    throw new Error(`${label}图片尚未完成绑定：${binding.issue.message}。请先在“框选题图”中复核。`)
  }
  return {
    ...item,
    stemMarkdown: binding.stem,
    answerText: binding.answer,
    analysisMarkdown: binding.analysis,
    figures: binding.figures,
  }
}

function exportFieldsForVariant(variant: ExportVariant): ExportContentField[] {
  return variant === 'teacher' ? ['stem', 'answer', 'analysis'] : ['stem']
}

function assertQuestionExportable(
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

function assertCollectionExportable(collection: ExportCollection, fields: ExportContentField[] = exportFieldsForVariant('teacher')) {
  collection.questions.forEach((entry) => assertQuestionExportable(entry.item, fields))
}

/** Build section-name hints from question types in the same order as index.ts. */
function collectionSectionNames(rows: Array<Pick<QuestionRow, 'question_type' | 'stem_markdown' | 'answer_text'>>) {
  const sections = new Map<string, string>()
  let index = 0
  for (const row of rows) {
    const normalized = normalizeQuestionType(row.question_type, row.stem_markdown, row.answer_text)
    if (!sections.has(normalized)) {
      index += 1
      sections.set(normalized, `${sectionOrdinal(index)}、${normalized}`)
    }
  }
  return sections
}

function sectionOrdinal(index: number) {
  const ordinals = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  return ordinals[index] || String(index)
}

/** Helper: insert inline figure references into a markdown question line. */
function markdownQuestionLine(index: number, entry: any, figures: Array<Record<string, any>> = []) {
  const score = Number(entry.score || 0)
  const stem = markdownWithInlineFigures(
    stripLeadingQuestionNo(entry.item.stemMarkdown, entry.item.questionNo),
    figures,
  )
  const scoreText = score ? `（${score} 分）` : ''
  return `**${index}.** ${scoreText}${stem || '（题干待补充）'}`
}

// ---------------------------------------------------------------------------
// Public export functions
// ---------------------------------------------------------------------------

export type ExportVariant = 'student' | 'teacher' | 'error_notebook'
type StandardExportVariant = Exclude<ExportVariant, 'error_notebook'>

export function normalizeExportVariant(value: unknown): ExportVariant {
  if (value === 'error_notebook' || value === 'error-notebook') return 'error_notebook'
  if (value === 'teacher' || value === 'answers') return 'teacher'
  return 'student'
}

function stripLeadingScore(value: string) {
  return String(value || '').replace(/^\s*[（(]\s*\d+(?:\.\d+)?\s*分\s*[）)]\s*/, '').trimStart()
}

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

// ── Collection markdown ────────────────────────────────────────────────────

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

// ── Collection LaTeX ───────────────────────────────────────────────────────

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

// ── Collection worksheet PDF ──────────────────────────────────────────────

export function buildCollectionWorksheetLatex(
  collection: ExportCollection,
  variant: StandardExportVariant,
  figuresDir: string,
  adjustments: Map<string, number>,
  documentClass = 'qbank-worksheet',
  layoutDraft?: PaperLayoutDraft,
) {
  const renderSpec = templateRenderSpec(documentClass === 'qbank-exam' ? 'exam' : 'worksheet')
  const specs = new Map<string, WorksheetFigureSpec>()
  const warnings: LayoutWarning[] = []
  const scorePlan = buildWorksheetScorePlan(collection as any)
  const appSettings = readAppSettings()
  const brandName =
    documentClass === 'qbank-lecture'
      ? appSettings.lectureWatermark
      : documentClass === 'qbank-exam'
        ? appSettings.examWatermark
        : appSettings.worksheetWatermark
  const brandTagline = `${brandName} ｜ 高中数学`
  const lines = [
    `\\documentclass{${documentClass}}`,
    `\\geometry{a4paper,top=${renderSpec.page.marginTopMm}mm,bottom=${renderSpec.page.marginBottomMm}mm,left=${renderSpec.page.marginLeftMm}mm,right=${renderSpec.page.marginRightMm}mm,headheight=26pt,headsep=10pt,footskip=22pt}`,
    `\\setlength{\\parskip}{${renderSpec.typography.questionGapMm.toFixed(1)}mm}`,
    `\\setbrandname{${markdownToExamLatex(brandName, false)}}`,
    '\\setbrandmark{Q}',
    `\\setbrandtagline{${markdownToExamLatex(brandTagline, false)}}`,
    '\\setsubject{高中数学}',
    `\\doctitle{${markdownToExamLatex(collection.title || '综合练习', false)}}`,
  ]
  lines.push('\\begin{document}', '\\qbankmaketitle')
  let currentSection = ''
  const layoutOrder=new Map((layoutDraft?.questions||[]).map((item,index)=>[item.relationId,item.order??index]))
  const orderedQuestions=collection.questions.map((entry,index)=>({entry,index})).sort((left,right)=>(layoutOrder.get(String(left.entry.relationId||left.entry.item?.id))??left.index)-(layoutOrder.get(String(right.entry.relationId||right.entry.item?.id))??right.index)).map(item=>item.entry)
  orderedQuestions.forEach((entry, index) => {
    const key = worksheetEntryKey(entry, index)
    const sectionName = scorePlan.entrySections.get(key) || ''
    const questionLayout = questionLayoutFor(layoutDraft, entry.relationId || entry.item?.id)
    // A page break belongs to the question and therefore must happen before
    // its section heading. Emitting the heading first leaves an orphaned
    // heading (and often an almost empty page) when the first question in a
    // section uses equalized-page pagination.
    if ((questionLayout?.pageBreakBefore || questionLayout?.equalizedPageBreakBefore) && index > 0) lines.push('\\newpage')
    if (sectionName && sectionName !== currentSection) {
      currentSection = sectionName
      lines.push(
        `\\examsectionstart{${markdownToExamLatex(
          worksheetSectionTitle(currentSection, scorePlan.sectionScores.get(currentSection)),
          false,
        )}}`,
      )
    }
    if (!(questionLayout?.pageBreakBefore || questionLayout?.equalizedPageBreakBefore) && questionLayout?.keepTogether !== false) lines.push('\\Needspace{8\\baselineskip}')
    lines.push(worksheetQuestionLatex(entry, index, variant, collection.id, figuresDir, adjustments, specs, questionLayout, warnings))
  })
  lines.push('\\end{document}', '')
  return { content: lines.join('\n\n'), specs, warnings }
}

function worksheetQuestionLatex(
  entry: any,
  index: number,
  variant: StandardExportVariant,
  collectionId: string,
  figuresDir: string,
  adjustments: Map<string, number>,
  specs: Map<string, WorksheetFigureSpec>,
  layout?: QuestionLayout,
  warnings: LayoutWarning[] = [],
) {
  const questionId = safeName(String(entry.relationId || entry.item?.id || index + 1))
  const lines = [`\\begin{examquestion}{${index + 1}}{${questionId}}`]
  const { prompt, choices, trailingContent } = splitChoiceStemForExport(entry.item.stemMarkdown)
  const stemFigures = questionFigures(entry)
  // Doc2X often places a single figure marker exactly between the stem and
  // option A. Treat that boundary marker as a layout figure so choices can
  // occupy the space beside it instead of waiting below a full-width row.
  const boundaryMarker = doc2xInlineFigureIds(prompt).size === 1
    ? prompt.match(/<!--\s*DOC2X_FIGURE:([^>\s]+)\s*-->\s*$/)
    : null
  const boundaryFigure = boundaryMarker ? figuresByIdentifier(stemFigures).get(boundaryMarker[1]) : undefined
  const promptForLayout = boundaryMarker ? prompt.slice(0, boundaryMarker.index).trim() : prompt
  const registerFigure = (figure: Record<string, any>, figureIndex: number, usage: string, requestedWidth?: number) => {
      const sourcePath = figureAbsolutePath(figure)
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        warnings.push({ code: 'missing-figure', questionId, figureId: String(figure.id || figure.blockId || figureIndex + 1), message: '题目引用的图片文件不存在。', suggestion: '请重新绑定或上传图片后再导出。' })
        return ''
      }
      const extension = path.extname(sourcePath).toLowerCase() || '.png'
      const figureId = worksheetFigureId(collectionId, entry, figure, figureIndex, usage)
      // The full collection-prefixed figure id is longer than safeName's
      // 80-character limit.  Using it directly made different figures in the
      // same question collapse to one filename (notably q18's histogram/pie).
      const outputName = `${safeName(`q${entry.item.serialNo || index + 1}-${figure.id || figureIndex + 1}`)}${extension}`
      const outputPath = path.join(figuresDir, outputName)
      if (!fs.existsSync(outputPath)) fs.copyFileSync(sourcePath, outputPath)
      const limits = worksheetFigureWidthLimits(sourcePath)
      specs.set(figureId, { id: figureId, sourcePath, outputName, ...limits })
      // A workbench override is authoritative. Automatic fit iterations may
      // only adjust figures that are still using template defaults.
      const width = requestedWidth ?? adjustments.get(figureId) ?? limits.defaultWidth
      const alignment=figureLayoutFor(layout,figure)?.alignment||'center'
      return `\\qbankfigure{${figureId}}{${width.toFixed(4)}}{${alignment}}{figures/${outputName}}`
  }
  const appendFigures = (figures: Array<Record<string, any>>, usage: string) => {
    const rendered = figures.flatMap((figure, figureIndex) => {
      const latex = registerFigure(figure, figureIndex, usage, figureLayoutFor(layout, figure)?.widthRatio)
      return latex ? [latex] : []
    })
    const mode = layout?.multiFigureLayout || 'auto'
    if (rendered.length >= 2 && rendered.length <= 4 && mode !== 'column') lines.push(worksheetFigureGridLatex(rendered))
    else lines.push(...rendered)
  }

  const figuresWithoutMarkers = figuresWithoutInlineMarkers(entry.item.stemMarkdown, stemFigures)
  const unanchoredStemFigures = figuresWithoutMarkers.filter((figure) => String(figure.usage || 'stem') !== 'options')
  const sideFigure = unanchoredStemFigures.length === 1
    ? unanchoredStemFigures[0]
    : unanchoredStemFigures.length === 0 && boundaryFigure
      ? boundaryFigure
      : undefined
  const sideDecision = sideFigure ? decideWorksheetFigureLayout({
    questionId,
    figureId: String(sideFigure.id || sideFigure.blockId || 'figure'),
    imagePath: figureAbsolutePath(sideFigure),
    stemFigureCount: 1,
    hasInlineMarker: false,
    choices,
    requested: figureLayoutFor(layout, sideFigure),
  }) : undefined
  if (sideDecision) warnings.push(...sideDecision.warnings)
  const explicitWideChoices = layout?.choiceLayout === 'four' || layout?.choiceLayout === 'two'
  const useSideLayout = Boolean(
    sideFigure && sideDecision &&
    (sideDecision.placement === 'side-left' || sideDecision.placement === 'side-right') &&
    (sideDecision.source === 'manual' || !explicitWideChoices),
  )
  if (useSideLayout) lines.unshift('\\Needspace{16\\baselineskip}')
  const promptLatex = compactWorksheetFigureRuns(keepSubquestionsTogether(
    worksheetPromptWithInlineFigures(
      promptForLayout || entry.item.stemMarkdown,
      stemFigures,
      entry.item.questionType,
      (figure) => registerFigure(figure, Math.max(0, stemFigures.indexOf(figure)), 'stem'),
    ) || '（题干待补充）',
  ), layout?.multiFigureLayout)
  lines.push(promptLatex)

  if (useSideLayout && sideFigure && sideDecision) {
    // Inside the fixed 40% minipage, use almost all local width. The decision's
    // widthRatio describes the page-level slot rather than a nested fraction.
    const figureLatex = registerFigure(sideFigure, Math.max(0, stemFigures.indexOf(sideFigure)), 'stem', 0.95)
    if (figureLatex) {
      lines.push(`\\qbankchoiceswithfigure{${sideDecision.placement === 'side-left' ? 'left' : 'right'}}{${sideDecision.widthRatio.toFixed(2)}}{${figureLatex}}{${worksheetChoicesLatex(choices, stemFigures, 'one', layout)}}`)
    } else {
      lines.push(worksheetChoicesLatex(choices, stemFigures, layout?.choiceLayout, layout))
    }
  } else {
    const keepFigureWithChoices = unanchoredStemFigures.length === 1 && choices.length === 4
    if (keepFigureWithChoices) lines.push('\\begin{samepage}')
    appendFigures(unanchoredStemFigures.filter((figure) => {
      const placement = figureLayoutFor(layout, figure)?.placement
      return placement !== 'after-choices'
    }), 'stem')
    if (choices.length) {
      if (layout?.choiceLayout === 'four' && qbankChoiceLayout(choices) !== 'four') warnings.push({ code: 'choice-overflow', questionId, message: '选项内容不适合强制四栏，可能超出栏宽。', suggestion: '改为自动、两栏或单栏布局。' })
      lines.push(worksheetChoicesLatex(choices, stemFigures, layout?.choiceLayout))
    }
    if (trailingContent) {
      lines.push(compactWorksheetFigureRuns(keepSubquestionsTogether(
        worksheetMarkdownWithInlineFigures(trailingContent, stemFigures, true, false, (figure) =>
          registerFigure(figure, Math.max(0, stemFigures.indexOf(figure)), 'stem'),
        ),
      ), layout?.multiFigureLayout))
    }
    if (keepFigureWithChoices) lines.push('\\end{samepage}')
    appendFigures(unanchoredStemFigures.filter((figure) => figureLayoutFor(layout, figure)?.placement === 'after-choices'), 'stem')
  }
  appendFigures(
    figuresWithoutMarkers.filter((figure) => String(figure.usage || '') === 'options'),
    'options',
  )
  if (variant === 'teacher') {
    const solutionFigures = analysisFigures(entry)
    lines.push('\\begin{solutionbox}')
    const renderSolutionFigure = (figure: Record<string, any>) =>
      registerFigure(figure, Math.max(0, solutionFigures.indexOf(figure)), 'analysis')
    lines.push(`\\anslabel ${worksheetMarkdownWithInlineFigures(entry.item.answerText, solutionFigures, true, true, renderSolutionFigure) || '暂无'}\\par`)
    lines.push(`\\sollabel ${worksheetMarkdownWithInlineFigures(entry.item.analysisMarkdown || '暂无', solutionFigures, true, false, renderSolutionFigure)}`)
    appendFigures(
      figuresWithoutInlineMarkers(
        `${entry.item.answerText || ''}\n${entry.item.analysisMarkdown || ''}`,
        solutionFigures,
      ),
      'analysis',
    )
    lines.push('\\end{solutionbox}')
  } else if (
    normalizeQuestionType(entry.item.questionType, entry.item.stemMarkdown, entry.item.answerText) === '解答题'
  ) {
    const answerAreaHeight = Math.min(Math.max(Number(layout?.answerAreaHeight ?? layout?.equalizedAnswerAreaHeight ?? 4.2), 0), 30)
    if (answerAreaHeight > 0) lines.push(`\\nobreak\\begin{answerarea}{${answerAreaHeight.toFixed(1)}cm}\\end{answerarea}`)
  }
  lines.push('\\end{examquestion}')
  return lines.join('\n')
}

function worksheetPromptWithInlineFigures(
  content: string,
  figures: Array<Record<string, any>>,
  questionType: string,
  renderFigure: (figure: Record<string, any>) => string,
) {
  return worksheetInlineFigureLatex(content, figures, (text) => renderExamZhPrompt(text, questionType), renderFigure)
}

function worksheetMarkdownWithInlineFigures(
  content: string,
  figures: Array<Record<string, any>>,
  preserveParagraphs = true,
  answer = false,
  renderFigure?: (figure: Record<string, any>) => string,
) {
  return worksheetInlineFigureLatex(
    content,
    figures,
    (text) => answer ? worksheetAnswerLatex(text) : markdownToExamLatex(text, preserveParagraphs),
    renderFigure,
  )
}

function worksheetInlineFigureLatex(
  content: string,
  figures: Array<Record<string, any>>,
  renderText: (text: string) => string,
  renderFigure?: (figure: Record<string, any>) => string,
) {
  const source = String(content || '')
  const figureById = figuresByIdentifier(figures)
  const lines: string[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  DOC2X_FIGURE_MARKER_RE.lastIndex = 0
  while ((match = DOC2X_FIGURE_MARKER_RE.exec(source))) {
    const text = source.slice(cursor, match.index).trim()
    if (text) lines.push(renderText(text))
    const figure = figureById.get(match[1])
    if (figure) {
      const latex = renderFigure?.(figure) || worksheetInlineFigureLines(figure).join('\n')
      if (latex) lines.push(latex)
    }
    cursor = match.index + match[0].length
  }
  const tail = source.slice(cursor).trim()
  if (tail) lines.push(renderText(tail))
  return lines.join('\n')
}

function compactWorksheetFigureRuns(latex: string, mode: QuestionLayout['multiFigureLayout'] = 'auto') {
  if (mode === 'column') return latex
  const item = String.raw`\\qbankfigure\{([^{}]+)\}\{([0-9.]+)\}\{(?:left|center|right)\}\{([^{}]+)\}\s*(?:\\par\s*)?((?:图\s*)?[甲乙丙丁戊己庚辛])`
  const run = new RegExp(`(?:${item}\\s*){2,}`, 'g')
  const labelled = String(latex || '').replace(run, (block) => {
    const matcher = new RegExp(item, 'g')
    const cells: string[] = []
    let match: RegExpExecArray | null
    while ((match = matcher.exec(block))) {
      cells.push(JSON.stringify({ id: match[1], width: Number(match[2]), path: match[3], label: match[4].replace(/\s+/g, '') }))
    }
    if (cells.length < 2) return block
    const columns = cells.length === 3 ? 3 : 2
    const cellWidth = columns === 3 ? 0.31 : 0.48
    const rendered = cells.map((cell) => {
      const parsed = JSON.parse(cell) as { id: string; width: number; path: string; label: string }
      const scale = Math.min(1, Math.max(0.3, parsed.width / cellWidth))
      return `\\qbankfiguregridcell{${parsed.id}}{${parsed.path}}{${parsed.label}}{${scale.toFixed(3)}}`
    })
    return `\\begin{qbankfiguregrid}{${columns}}\n${rendered.join('\n')}\n\\end{qbankfiguregrid}`
  })
  const plainItem = String.raw`\\qbankfigure\{[^{}]+\}\{[0-9.]+\}\{(?:left|center|right)\}\{[^{}]+\}`
  const plainRun = new RegExp(`(?:${plainItem}\\s*){2,4}`, 'g')
  return labelled.replace(plainRun, (block) => {
    const figures = block.match(new RegExp(plainItem, 'g')) || []
    return figures.length >= 2 ? worksheetFigureGridLatex(figures) : block
  })
}

function worksheetFigureGridLatex(figures: string[]) {
  const item = /\\qbankfigure\{([^{}]+)\}\{([0-9.]+)\}\{(?:left|center|right)\}\{([^{}]+)\}/
  const parsed = figures.flatMap((latex) => {
    const match = latex.match(item)
    return match ? [{ id: match[1], width: Number(match[2]), path: match[3] }] : []
  })
  if (parsed.length !== figures.length) return figures.join('\n')
  const columns = parsed.length === 3 ? 3 : 2
  const cellWidth = columns === 3 ? 0.31 : 0.48
  const cells = parsed.map((figure) => {
    const scale = Math.min(1, Math.max(0.3, figure.width / cellWidth))
    return `\\qbankfiguregridcell{${figure.id}}{${figure.path}}{}{${scale.toFixed(3)}}`
  })
  return `\\begin{qbankfiguregrid}{${columns}}\n${cells.join('\n')}\n\\end{qbankfiguregrid}`
}

function worksheetInlineFigureLines(figure: Record<string, any>) {
  const sourcePath = figureAbsolutePath(figure)
  if (!sourcePath || !fs.existsSync(sourcePath)) return []
  return [
    '\\begin{center}',
    `\\includegraphics[width=0.82\\linewidth]{\\detokenize{${sourcePath}}}`,
    '\\end{center}',
  ]
}

function worksheetChoicesLatex(choices: string[], figures: Array<Record<string, any>> = [], override: ChoiceLayoutOverride = 'auto', layout?: QuestionLayout) {
  const rendered = choices.map((choice) => worksheetChoiceLatex(choice, figures, layout))
  if (rendered.length === 4) {
    const layout = override === 'auto' ? qbankChoiceLayout(choices) : override
    if (layout === 'four')
      return `\\qbankchoicesfour{${rendered[0]}}{${rendered[1]}}{${rendered[2]}}{${rendered[3]}}`
    if (layout === 'two')
      return `\\qbankchoicestwo{${rendered[0]}}{${rendered[1]}}{${rendered[2]}}{${rendered[3]}}`
  }
  return ['\\begin{qbankchoicesone}', ...rendered.map((choice) => `\\item ${choice}`), '\\end{qbankchoicesone}'].join(
    '\n',
  )
}

/** Render an option marker inside its A/B/C/D cell instead of as a block below the question. */
function worksheetChoiceLatex(choice: string, figures: Array<Record<string, any>>, layout?: QuestionLayout) {
  const inlineIds = doc2xInlineFigureIds(choice)
  if (!inlineIds.size) return markdownToExamLatex(choice, true).replace(/\n+/g, ' ').trim()
  const figureById = figuresByIdentifier(figures)
  let cursor = 0
  let match: RegExpExecArray | null
  const parts: string[] = []
  DOC2X_FIGURE_MARKER_RE.lastIndex = 0
  while ((match = DOC2X_FIGURE_MARKER_RE.exec(choice))) {
    const text = choice.slice(cursor, match.index).trim()
    if (text) parts.push(markdownToExamLatex(text, true).replace(/\n+/g, ' ').trim())
    const figure = figureById.get(match[1])
    const sourcePath = figure ? figureAbsolutePath(figure) : ''
    if (sourcePath && fs.existsSync(sourcePath)) {
      const requested = figure ? figureLayoutFor(layout, figure)?.widthRatio : undefined
      const cellWidth = Math.min(1, Math.max(0.35, (requested ?? 0.3) / 0.48))
      parts.push(`\\includegraphics[width=${cellWidth.toFixed(3)}\\linewidth,height=2.8cm,keepaspectratio]{\\detokenize{${sourcePath}}}`)
    }
    cursor = match.index + match[0].length
  }
  const tail = choice.slice(cursor).trim()
  if (tail) parts.push(markdownToExamLatex(tail, true).replace(/\n+/g, ' ').trim())
  return parts.join(' ')
}

function keepSubquestionsTogether(latex: string) {
  return String(latex || '').replace(
    /\\par\s*\n(?=（(?:\d+|[ivxIVX]+|[一二三四五六七八九十]+)）)/g,
    '\\par\\nobreak\n',
  )
}

function figureAbsolutePath(figure: Record<string, any>) {
  const rawPath = stripAssetPrefix(String(figure.path || figure.sourcePath || ''))
  if (!rawPath) return ''
  return path.isAbsolute(rawPath) ? rawPath : resolveStoragePath(rawPath)
}

function markdownToExamLatex(value: string, preserveBreaks = true) {
  const text = String(value || '')
    .replace(/【解析】/g, '')
    .replace(/【分析】/g, '')
    .replace(/【详解】/g, '')
    .replace(/详解】/g, '')
    .trim()
  return richMarkdownToExamLatex(text, preserveBreaks)
}

export function exportCollectionWorksheetPdf(
  collection: ExportCollection,
  variant: StandardExportVariant,
  documentClass = 'qbank-worksheet',
  layoutDraft?: PaperLayoutDraft,
) {
  return exportCollectionWorksheetPdfWithDiagnostics(collection, variant, documentClass, layoutDraft).pdfPath
}

export function exportCollectionWorksheetPdfWithDiagnostics(
  collection: ExportCollection,
  variant: StandardExportVariant,
  documentClass = 'qbank-worksheet',
  layoutDraft?: PaperLayoutDraft,
) {
  if (!collection.questions.length) throw new Error('当前试题篮没有题目，无法导出。')
  assertCollectionExportable(collection, exportFieldsForVariant(variant))
  if (documentClass === 'qbank-exam' && readAppSettings().examExportTemplate === 'examch') {
    const result = exportExamZhQuestionSet({
      id: collection.id,
      title: collection.title || '综合试卷',
      rows: collectionQuestionRows(collection),
      format: 'pdf',
      variant,
      watermarkText: readAppSettings().examWatermark,
    })
    return {
      pdfPath: result.path,
      texPath: result.texPath,
      logPath: result.logPath,
      warnings: [] as LayoutWarning[],
      questionTelemetry: [],
    }
  }
  const exportRoot = path.join(storageRoot, 'output', 'pdf', 'collection-exports', safeName(collection.id))
  const figuresDir = path.join(exportRoot, 'figures')
  fs.mkdirSync(figuresDir, { recursive: true })
  for (const templateName of ['qbank-theme.sty', `${documentClass}.cls`]) {
    fs.copyFileSync(
      path.join(sourceRoot, 'templates', 'latex', templateName),
      path.join(exportRoot, templateName),
    )
  }
  const templateName = documentClass === 'qbank-exam' ? 'exam' : 'worksheet'
  const baseName = `${safeName(collection.title || '练习单')}-${templateName}-${variant === 'teacher' ? 'teacher' : 'student'}`
  const texPath = path.join(exportRoot, `${baseName}.tex`)
  const pdfPath = path.join(exportRoot, `${baseName}.pdf`)
  fs.rmSync(pdfPath, { force: true })
  const adjustments = new Map<string, number>()
  let knownWarnings: LayoutWarning[] = []
  try {
    for (let iteration = 0; iteration < worksheetMaxLayoutIterations; iteration += 1) {
      const rendered = buildCollectionWorksheetLatex(collection, variant, figuresDir, adjustments, documentClass, layoutDraft)
      knownWarnings = rendered.warnings
      fs.writeFileSync(texPath, rendered.content, 'utf8')
      compileWorksheetTex(texPath)
      const telemetry = parseWorksheetFigureTelemetry(texPath.replace(/\.tex$/, '.log'))
      if (!optimizeWorksheetFigures(telemetry, rendered.specs, adjustments)) break
    }
    const rendered = buildCollectionWorksheetLatex(collection, variant, figuresDir, adjustments, documentClass, layoutDraft)
    knownWarnings = rendered.warnings
    fs.writeFileSync(texPath, rendered.content, 'utf8')
    compileWorksheetTex(texPath)
    const logPath = texPath.replace(/\.tex$/, '.log')
    const questionTelemetry = parseWorksheetQuestionTelemetry(logPath)
    const warnings = [...rendered.warnings, ...worksheetTelemetryWarnings(questionTelemetry, parseWorksheetFigureTelemetry(logPath), rendered.specs)]
    const uniqueWarnings = [...new Map(warnings.map((warning) => [`${warning.code}:${warning.questionId}:${warning.figureId || ''}:${warning.page || ''}`, warning])).values()]
    return { pdfPath, texPath, logPath, warnings: uniqueWarnings, questionTelemetry }
  } catch (error) {
    if (error && typeof error === 'object') Object.assign(error, { layoutWarnings: knownWarnings })
    throw error
  }
}

export function exportQuestionSetPdf(input: {
  id: string
  title: string
  rows: QuestionRow[]
  template: 'exam' | 'worksheet'
  variant: StandardExportVariant
  createdAt?: string
  updatedAt?: string
  bindingRunId?: string
}) {
  if (!input.rows.length) throw new Error('当前题组没有题目，无法导出。')
  if (input.template === 'exam' && readAppSettings().examExportTemplate === 'examch') {
    return exportExamZhQuestionSet({
      id: input.id,
      title: input.title,
      rows: input.rows,
      format: 'pdf',
      variant: input.variant,
      watermarkText: readAppSettings().examWatermark,
    })
  }
  const collection = buildQuestionSetWorksheetCollection({
    id: input.id,
    title: input.title,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    rows: input.rows,
    bindingRunId: input.bindingRunId,
    variant: input.variant,
  })
  const documentClass = input.template === 'exam' ? 'qbank-exam' : 'qbank-worksheet'
  const pdfPath = exportCollectionWorksheetPdf(collection as any, input.variant, documentClass)
  return { path: pdfPath, format: 'pdf' as const }
}

// ── Run worksheet PDF ──────────────────────────────────────────────────────

export function exportRunWorksheetPdf(runId: string, options: { title?: string; variant?: StandardExportVariant }) {
  const run = getRun(runId)
  if (!run) throw new Error('批次不存在。')
  const rows = db.prepare(`
    SELECT * FROM question_bank_items
    WHERE source_run_id = ? AND bank_status = 'banked'
    ORDER BY serial_no ASC
  `).all(runId) as QuestionRow[]
  if (!rows.length) throw new Error('当前批次暂无已入库题目，无法导出。')
  const variant = options.variant || 'student'
  return exportQuestionSetPdf({
    id: `run-${run.runId}`,
    title: options.title || run.paperTitle || run.pdfName || '综合练习',
    rows,
    template: 'worksheet',
    variant,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    bindingRunId: run.runId,
  })
}

// ── Run exam PDF (qbank-exam template) ─────────────────────────────────────

export function exportRunExamPdf(runId: string, options: { title?: string; variant?: StandardExportVariant }) {
  const variant = options.variant || 'student'
  const run = getRun(runId)
  if (!run) throw new Error('批次不存在。')
  const rows = db.prepare(`
    SELECT * FROM question_bank_items
    WHERE source_run_id = ? AND bank_status = 'banked'
    ORDER BY serial_no ASC
  `).all(runId) as QuestionRow[]
  if (!rows.length) throw new Error('当前批次暂无已入库题目，无法导出。')
  // The alternate template used to bypass all image review rules. Validate
  // every exported question before choosing either renderer.
  rows.forEach((row) => questionForExport(mapQuestion(row), runId, exportFieldsForVariant(variant)))
  if (readAppSettings().examExportTemplate === 'examch') {
    return exportRunExamZh(runId, { ...options, format: 'pdf', variant })
  }
  return exportQuestionSetPdf({
    id: `run-${run.runId}`,
    title: options.title || run.paperTitle || run.pdfName || '综合练习',
    rows,
    template: 'exam',
    variant,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    bindingRunId: run.runId,
  })
}

// ── Re-export exam-zh functions so callers can use them directly ───────────

export { buildRunExamZhLatex, exportRunExamZh, splitChoiceStemForExport }

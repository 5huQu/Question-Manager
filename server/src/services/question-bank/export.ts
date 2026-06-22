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
  WorksheetFigureSpec,
} from '../../utils/worksheet-figures.js'
import {
  renderExamZhPrompt,
  buildRunExamZhLatex,
  exportRunExamZh,
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
import type { QuestionRow } from '../../types/index.js'

/**
 * Collection-shaped object with the minimum fields needed for export.
 * In index.ts this is `NonNullable<ReturnType<typeof getCollection>>`.
 */
export type ExportCollection = NonNullable<ReturnType<typeof getCollection>>

// ---------------------------------------------------------------------------
// Local helpers still in index.ts (not yet extracted to utils)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Exam-zh helpers duplicated here until the legacy copies in index.ts are
// removed; these delegate to the utils/exam-zh.ts module.
// ---------------------------------------------------------------------------

const DOC2X_FIGURE_MARKER_RE = /<!--\s*DOC2X_FIGURE:([^>\s]+)\s*-->/g

/** Escape special LaTeX characters for text (non-math) segments. */
function escapeLatex(value: string) {
  return questionPlainText(value)
    .replace(/([#%&])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\n{2,}/g, '\n\n')
}

/** A pseudo-collection built from a run's banked questions for worksheet export. */
function buildRunWorksheetCollection(run: NonNullable<ReturnType<typeof getRun>>, rows: QuestionRow[]) {
  const sectionNames = collectionSectionNames(rows)
  let previousSection = ''
  return {
    id: `run-${run.runId}`,
    title: run.paperTitle || run.pdfName || '综合练习',
    subtitle: '学生版',
    description: '',
    kind: 'paper' as const,
    status: 'finalized' as const,
    totalScore: 0,
    timeLimit: 0,
    exportFormat: 'pdf',
    questionCount: rows.length,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    questions: rows.map((row, index) => {
      const item = questionForExport(mapQuestion(row), run.runId)
      const section = sectionNames.get(item.questionType) || ''
      const sectionName = section && section !== previousSection ? section : ''
      if (section) previousSection = section
      return {
        relationId: `${run.runId}-${item.id}`,
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
function questionForExport(item: ReturnType<typeof mapQuestion>, runId: string) {
  const binding = bindInlineImageReferences(
    {
      id: item.id,
      problem_text: item.stemMarkdown,
      answer: item.answerText,
      analysis: item.analysisMarkdown,
    },
    runId,
    { localFigures: item.figures },
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

export type ExportVariant = 'student' | 'teacher'

export function normalizeExportVariant(value: unknown): ExportVariant {
  if (value === 'teacher' || value === 'answers') return 'teacher'
  return 'student'
}

// ── Collection markdown ────────────────────────────────────────────────────

export function buildCollectionMarkdown(
  collection: ExportCollection,
  variant: ExportVariant,
) {
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

function buildCollectionWorksheetLatex(
  collection: ExportCollection,
  variant: ExportVariant,
  figuresDir: string,
  adjustments: Map<string, number>,
  documentClass = 'qbank-worksheet',
) {
  const specs = new Map<string, WorksheetFigureSpec>()
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
    `\\setbrandname{${markdownToExamLatex(brandName, false)}}`,
    '\\setbrandmark{Q}',
    `\\setbrandtagline{${markdownToExamLatex(brandTagline, false)}}`,
    '\\setsubject{高中数学}',
    `\\doctitle{${markdownToExamLatex(collection.title || '综合练习', false)}}`,
  ]
  lines.push('\\begin{document}', '\\qbankmaketitle')
  let currentSection = ''
  collection.questions.forEach((entry, index) => {
    const key = worksheetEntryKey(entry, index)
    const sectionName = scorePlan.entrySections.get(key) || ''
    if (sectionName && sectionName !== currentSection) {
      currentSection = sectionName
      lines.push(
        `\\examsectionstart{${markdownToExamLatex(
          worksheetSectionTitle(currentSection, scorePlan.sectionScores.get(currentSection)),
          false,
        )}}`,
      )
    }
    lines.push(worksheetQuestionLatex(entry, index, variant, collection.id, figuresDir, adjustments, specs))
  })
  lines.push('\\end{document}', '')
  return { content: lines.join('\n\n'), specs }
}

function worksheetQuestionLatex(
  entry: any,
  index: number,
  variant: ExportVariant,
  collectionId: string,
  figuresDir: string,
  adjustments: Map<string, number>,
  specs: Map<string, WorksheetFigureSpec>,
) {
  const lines = [`\\begin{examquestion}{${index + 1}}`]
  const { prompt, choices } = splitChoiceStemForExport(entry.item.stemMarkdown)
  const stemFigures = questionFigures(entry)
  const registerFigure = (figure: Record<string, any>, figureIndex: number, usage: string) => {
      const sourcePath = figureAbsolutePath(figure)
      if (!sourcePath || !fs.existsSync(sourcePath)) return ''
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
      const width = adjustments.get(figureId) ?? limits.defaultWidth
      return `\\qbankfigure{${figureId}}{${width.toFixed(4)}}{figures/${outputName}}`
  }
  const appendFigures = (figures: Array<Record<string, any>>, usage: string) => {
    figures.forEach((figure, figureIndex) => {
      const latex = registerFigure(figure, figureIndex, usage)
      if (latex) lines.push(latex)
    })
  }

  lines.push(
    keepSubquestionsTogether(
      worksheetPromptWithInlineFigures(
        prompt || entry.item.stemMarkdown,
        stemFigures,
        entry.item.questionType,
        (figure) => registerFigure(figure, Math.max(0, stemFigures.indexOf(figure)), 'stem'),
      ) || '（题干待补充）',
    ),
  )
  if (choices.length) {
    lines.push(worksheetChoicesLatex(choices, stemFigures))
  }

  appendFigures(figuresWithoutInlineMarkers(entry.item.stemMarkdown, stemFigures), 'stem')
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
    normalizeQuestionType(entry.item.questionType, entry.item.stemMarkdown, entry.item.answerText) === '解答题' &&
    !stemFigures.length
  ) {
    lines.push('\\nobreak\\begin{answerarea}{4.2cm}\\end{answerarea}')
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
  const figureById = new Map(figures.map((figure) => [String(figure.blockId || figure.id || ''), figure]))
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

function worksheetInlineFigureLines(figure: Record<string, any>) {
  const sourcePath = figureAbsolutePath(figure)
  if (!sourcePath || !fs.existsSync(sourcePath)) return []
  return [
    '\\begin{center}',
    `\\includegraphics[width=0.82\\linewidth]{\\detokenize{${sourcePath}}}`,
    '\\end{center}',
  ]
}

function worksheetChoicesLatex(choices: string[], figures: Array<Record<string, any>> = []) {
  const rendered = choices.map((choice) => worksheetChoiceLatex(choice, figures))
  if (rendered.length === 4) {
    const layout = qbankChoiceLayout(choices)
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
function worksheetChoiceLatex(choice: string, figures: Array<Record<string, any>>) {
  const inlineIds = doc2xInlineFigureIds(choice)
  if (!inlineIds.size) return markdownToExamLatex(choice, true).replace(/\n+/g, ' ').trim()
  const figureById = new Map(figures.map((figure) => [String(figure.blockId || figure.id || ''), figure]))
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
      parts.push(`\\includegraphics[width=0.88\\linewidth,height=3.8cm,keepaspectratio]{\\detokenize{${sourcePath}}}`)
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
  variant: ExportVariant,
  documentClass = 'qbank-worksheet',
) {
  if (!collection.questions.length) throw new Error('当前试题篮没有题目，无法导出。')
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
  const adjustments = new Map<string, number>()
  for (let iteration = 0; iteration < worksheetMaxLayoutIterations; iteration += 1) {
    const rendered = buildCollectionWorksheetLatex(collection, variant, figuresDir, adjustments, documentClass)
    fs.writeFileSync(texPath, rendered.content, 'utf8')
    compileWorksheetTex(texPath)
    const telemetry = parseWorksheetFigureTelemetry(texPath.replace(/\.tex$/, '.log'))
    if (!optimizeWorksheetFigures(telemetry, rendered.specs, adjustments)) break
  }
  const rendered = buildCollectionWorksheetLatex(collection, variant, figuresDir, adjustments, documentClass)
  fs.writeFileSync(texPath, rendered.content, 'utf8')
  compileWorksheetTex(texPath)
  return path.join(exportRoot, `${baseName}.pdf`)
}

// ── Run worksheet PDF ──────────────────────────────────────────────────────

export function exportRunWorksheetPdf(runId: string, options: { title?: string; variant?: ExportVariant }) {
  const run = getRun(runId)
  if (!run) throw new Error('批次不存在。')
  const rows = db.prepare(`
    SELECT * FROM question_bank_items
    WHERE source_run_id = ? AND bank_status = 'banked'
    ORDER BY serial_no ASC
  `).all(runId) as QuestionRow[]
  if (!rows.length) throw new Error('当前批次暂无已入库题目，无法导出。')
  const collection = buildRunWorksheetCollection({ ...run, paperTitle: options.title || run.paperTitle }, rows)
  const variant = options.variant || 'student'
  const pdfPath = exportCollectionWorksheetPdf(collection as any, variant)
  return { path: pdfPath, format: 'pdf' as const }
}

// ── Run exam PDF (qbank-exam template) ─────────────────────────────────────

export function exportRunExamPdf(runId: string, options: { title?: string; variant?: ExportVariant }) {
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
  rows.forEach((row) => questionForExport(mapQuestion(row), runId))
  if (readAppSettings().examExportTemplate === 'examch') {
    return exportRunExamZh(runId, { ...options, format: 'pdf', variant })
  }
  const collection = buildRunWorksheetCollection({ ...run, paperTitle: options.title || run.paperTitle }, rows)
  const pdfPath = exportCollectionWorksheetPdf(collection as any, variant, 'qbank-exam')
  return { path: pdfPath, format: 'pdf' as const }
}

// ── Re-export exam-zh functions so callers can use them directly ───────────

export { buildRunExamZhLatex, exportRunExamZh, splitChoiceStemForExport }

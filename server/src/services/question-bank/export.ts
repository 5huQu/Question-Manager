import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { db } from '../../db/connection.js'
import { storageRoot } from '../../config.js'
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
} from '../../utils/figure-export.js'
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

let _sourceRoot = ''
function sourceRoot(): string {
  if (!_sourceRoot) {
    // Lazy lookup from the module path -- same heuristic as config.ts.
    _sourceRoot = path.resolve(new URL('.', import.meta.url).pathname, '../../..')
  }
  return _sourceRoot
}

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
      const item = mapQuestion(row)
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
  lines.push(
    keepSubquestionsTogether(
      renderExamZhPrompt(prompt || entry.item.stemMarkdown, entry.item.questionType) || '（题干待补充）',
    ),
  )
  if (choices.length) {
    lines.push(worksheetChoicesLatex(choices))
  }

  const appendFigures = (figures: Array<Record<string, any>>, usage: string) => {
    figures.forEach((figure, figureIndex) => {
      const sourcePath = figureAbsolutePath(figure)
      if (!sourcePath || !fs.existsSync(sourcePath)) return
      const extension = path.extname(sourcePath).toLowerCase() || '.png'
      const figureId = worksheetFigureId(collectionId, entry, figure, figureIndex, usage)
      const outputName = `${safeName(figureId)}${extension}`
      const outputPath = path.join(figuresDir, outputName)
      if (!fs.existsSync(outputPath)) fs.copyFileSync(sourcePath, outputPath)
      const limits = worksheetFigureWidthLimits(sourcePath)
      specs.set(figureId, { id: figureId, sourcePath, outputName, ...limits })
      const width = adjustments.get(figureId) ?? limits.defaultWidth
      lines.push(`\\qbankfigure{${figureId}}{${width.toFixed(4)}}{figures/${outputName}}`)
    })
  }

  appendFigures(stemFigures, 'stem')
  if (variant === 'teacher') {
    lines.push('\\begin{solutionbox}')
    lines.push(`\\anslabel ${worksheetAnswerLatex(entry.item.answerText) || '暂无'}\\par`)
    lines.push(`\\sollabel ${markdownToExamLatex(entry.item.analysisMarkdown || '暂无', true)}`)
    appendFigures(analysisFigures(entry), 'analysis')
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

function worksheetChoicesLatex(choices: string[]) {
  const rendered = choices.map((choice) => markdownToExamLatex(choice, true).replace(/\n+/g, ' ').trim())
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
  // This is a simplified version; the full markdown->LaTeX pipeline is in
  // utils/exam-zh.ts / utils/latex.ts.  For now we delegate to the same
  // helpers that index.ts uses.
  const text = String(value || '')
    .replace(/【解析】/g, '')
    .replace(/【分析】/g, '')
    .replace(/【详解】/g, '')
    .replace(/详解】/g, '')
    .trim()
  const parts: string[] = []
  const pattern = /(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    parts.push(escapeLatexTextSegment(text.slice(last, match.index)))
    parts.push(normalizeLatexMathSegment(match[0]))
    last = (match.index || 0) + match[0].length
  }
  parts.push(escapeLatexTextSegment(text.slice(last)))
  const rendered = parts.join('')
  if (!preserveBreaks) return rendered.replace(/\s*\n\s*/g, ' ')
  return rendered
    .split(/\n\s*\n+/)
    .map((paragraph) =>
      paragraph
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n\\par\n'),
    )
    .filter(Boolean)
    .join('\n\\par\n')
}

function escapeLatexTextSegment(value: string) {
  return normalizeUnicodeRomanNumerals(String(value || ''))
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([#%&_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}

function normalizeUnicodeRomanNumerals(value: string) {
  const romanMap: Record<string, string> = {
    'Ⅰ': 'I', 'Ⅱ': 'II', 'Ⅲ': 'III', 'Ⅳ': 'IV', 'Ⅴ': 'V',
    'Ⅵ': 'VI', 'Ⅶ': 'VII', 'Ⅷ': 'VIII', 'Ⅸ': 'IX', 'Ⅹ': 'X',
    'ⅰ': 'i', 'ⅱ': 'ii', 'ⅲ': 'iii', 'ⅳ': 'iv', 'ⅴ': 'v',
    'ⅵ': 'vi', 'ⅶ': 'vii', 'ⅷ': 'viii', 'ⅸ': 'ix', 'ⅹ': 'x',
  }
  return value.replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]/g, (match) => romanMap[match] || match)
}

function normalizeLatexMathSegment(value: string) {
  return String(value || '')
    .replace(/\\mathbf\{R\}/g, '\\mathbb{R}')
    .replace(/\\vec\{/g, '\\overrightarrow{')
    .replace(/\s*\n\s*/g, ' ')
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
      path.join(sourceRoot(), 'templates', 'latex', templateName),
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
  if (readAppSettings().examExportTemplate === 'examch') {
    return exportRunExamZh(runId, { ...options, format: 'pdf', variant })
  }
  const run = getRun(runId)
  if (!run) throw new Error('批次不存在。')
  const rows = db.prepare(`
    SELECT * FROM question_bank_items
    WHERE source_run_id = ? AND bank_status = 'banked'
    ORDER BY serial_no ASC
  `).all(runId) as QuestionRow[]
  if (!rows.length) throw new Error('当前批次暂无已入库题目，无法导出。')
  const collection = buildRunWorksheetCollection({ ...run, paperTitle: options.title || run.paperTitle }, rows)
  const pdfPath = exportCollectionWorksheetPdf(collection as any, variant, 'qbank-exam')
  return { path: pdfPath, format: 'pdf' as const }
}

// ── Re-export exam-zh functions so callers can use them directly ───────────

export { buildRunExamZhLatex, exportRunExamZh, splitChoiceStemForExport }

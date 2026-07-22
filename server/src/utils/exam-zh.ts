import path from 'node:path'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pythonRoot, storageRoot, runsRoot, frontendDist } from '../config.js'
import { normalizeBlocks, inlineMarkdown, blocksToMarkdown, markdownToExamLatex, markdownTableToExamLatex, escapeLatexTextSegment, normalizeUnicodeRomanNumerals, normalizeLatexMathSegment, keepSubquestionsTogether } from './rich-content.js'
import { questionFigures, analysisFigures, latexFigureLines, latexWithInlineFigures, figureCaptionForExport, markdownWithInlineFigures, removeDoc2xFigurePlaceholders, questionPlainText, doc2xInlineFigureIds, figuresWithoutInlineMarkers, figuresByIdentifier } from './figure-export.js'
import { figureAbsolutePath } from './image-operations.js'
import { parseJson } from './json.js'
import { normalizeQuestionType, exportQuestionType, paperQuestionNo, stripLeadingQuestionNo, selectedChoiceLetters } from './question-type.js'
import { nowIso, safeName } from './ids.js'
import type { QuestionRow } from '../types/index.js'
import { db } from '../db/connection.js'
import { mapQuestion } from '../db/questions.js'
import { getRun } from '../db/runs.js'
import { readAppSettings } from '../services/settings/app-settings.js'
import { firstExecutable, xelatexPath } from '../services/settings/tools.js'

type ExportVariant = 'student' | 'teacher'

// ── Local constants ────────────────────────────────────────────────────────────

const DOC2X_FIGURE_MARKER_RE = /<!--\s*DOC2X_FIGURE:([^>\s]+)\s*-->/g

const examZhFillinToken = '@@EXAMZH_FILLIN_BLANK@@'
const escapedExamZhFillinToken = '@@EXAMZH\\_FILLIN\\_BLANK@@'

// ── Types ──────────────────────────────────────────────────────────────────────

export type ExamZhScoreConfig = {
  singleChoice: number
  multipleChoice: number
  fillin: number
  solution: number[]
}

export const defaultExamZhScoreConfig: ExamZhScoreConfig = {
  singleChoice: 5,
  multipleChoice: 6,
  fillin: 5,
  solution: [13, 15, 15, 17, 17],
}

// ── Fill-in blank helpers ──────────────────────────────────────────────────────

export function examZhFillinBlank(width = '2.8cm') {
  return `\\underline{\\hspace{${width}}}`
}

export function hasVisibleFillinBlank(value: string) {
  return /_{2,}|＿{2,}|\\(?:underline|fillin|blank)\b/.test(String(value || ''))
}

// ── Choice parentheses helpers ─────────────────────────────────────────────────

export function keepChoiceParenTogether(latex: string) {
  return String(latex || '')
    .replace(/（\s*(?:\\par\s*)?）/g, '\\mbox{（\\hspace{1.25em}）}')
    .replace(/\(\s*(?:\\par\s*)?\)/g, '\\mbox{(\\hspace{1.25em})}')
}

export function keepChoiceParenTogetherWithAnswer(latex: string, answer: string) {
  const ansStr = answer.trim()
  if (!ansStr) return keepChoiceParenTogether(latex)
  const cnParen = /（\s*(?:\\par\s*)?）/g
  const enParen = /\(\s*(?:\\par\s*)?\)/g

  const cnMatches = Array.from(latex.matchAll(cnParen))
  const enMatches = Array.from(latex.matchAll(enParen))

  if (cnMatches.length > 0) {
    const lastMatch = cnMatches[cnMatches.length - 1]
    const idx = lastMatch.index!
    return keepChoiceParenTogether(latex.slice(0, idx)) + `\\mbox{（\\textbf{${ansStr}}）}` + keepChoiceParenTogether(latex.slice(idx + lastMatch[0].length))
  } else if (enMatches.length > 0) {
    const lastMatch = enMatches[enMatches.length - 1]
    const idx = lastMatch.index!
    return keepChoiceParenTogether(latex.slice(0, idx)) + `\\mbox{(\\textbf{${ansStr}})}` + keepChoiceParenTogether(latex.slice(idx + lastMatch[0].length))
  }

  return keepChoiceParenTogether(latex)
}

// ── Prompt rendering ───────────────────────────────────────────────────────────

export function renderExamZhPrompt(prompt: string, questionType: string, variant: ExportVariant = 'student', answer = '') {
  if (questionType !== '填空题') {
    const latex = markdownToExamLatex(prompt, true)
    if (variant === 'teacher' && (questionType === '单选题' || questionType === '多选题')) {
      const letters = Array.from(selectedChoiceLetters(answer)).sort().join('')
      if (letters) {
        return keepChoiceParenTogetherWithAnswer(latex, letters)
      }
    }
    return keepChoiceParenTogether(latex)
  }
  const source = String(prompt || '')
  const hadBlank = hasVisibleFillinBlank(source)
  const normalized = source.replace(/_{2,}|＿{2,}/g, examZhFillinToken)
  let rendered = markdownToExamLatex(normalized, true)
    .replaceAll(escapedExamZhFillinToken, examZhFillinBlank())
    .replaceAll(examZhFillinToken, examZhFillinBlank())
  if (!hadBlank) rendered = `${rendered}\\,${examZhFillinBlank()}`
  return rendered
}

export function examZhFigureLines(figures: Array<Record<string, any>>) {
  return figures.flatMap((figure) => {
    const filePath = figureAbsolutePath(figure)
    if (!filePath || !fs.existsSync(filePath)) return []
    const width = '0.34\\linewidth'
    return [
      '\\begin{flushleft}',
      `\\includegraphics[width=${width},keepaspectratio]{\\detokenize{${filePath}}}`,
      '\\end{flushleft}',
    ]
  })
}

export function examZhChoiceFigureLines(figures: Array<Record<string, any>>) {
  return figures.flatMap((figure) => {
    const filePath = figureAbsolutePath(figure)
    if (!filePath || !fs.existsSync(filePath)) return []
    return [`\\includegraphics[width=0.9\\linewidth,keepaspectratio]{\\detokenize{${filePath}}}`]
  })
}

export function renderExamZhPromptWithInlineFigures(
  prompt: string,
  figures: Array<Record<string, any>>,
  questionType: string,
  variant: ExportVariant,
  answer = '',
) {
  if (!doc2xInlineFigureIds(prompt).size) return renderExamZhPrompt(prompt, questionType, variant, answer)
  const figureById = figuresByIdentifier(figures)
  const lines: string[] = []
  const source = String(prompt || '')
  let cursor = 0
  let match: RegExpExecArray | null
  DOC2X_FIGURE_MARKER_RE.lastIndex = 0
  while ((match = DOC2X_FIGURE_MARKER_RE.exec(source))) {
    const text = removeDoc2xFigurePlaceholders(source.slice(cursor, match.index))
    if (text) lines.push(renderExamZhPrompt(text, questionType, variant))
    const figure = figureById.get(match[1])
    if (figure) lines.push(...examZhFigureLines([figure]))
    cursor = match.index + match[0].length
  }
  const tail = removeDoc2xFigurePlaceholders(source.slice(cursor))
  if (tail) lines.push(renderExamZhPrompt(tail, questionType, variant, answer))
  return lines.join('\n')
}

export function renderExamZhMarkdownWithInlineFigures(
  content: string,
  figures: Array<Record<string, any>>,
  figureLayout: 'block' | 'choice' = 'block',
) {
  if (!doc2xInlineFigureIds(content).size) return markdownToExamLatex(content, true)
  const figureById = figuresByIdentifier(figures)
  const lines: string[] = []
  const source = String(content || '')
  let cursor = 0
  let match: RegExpExecArray | null
  DOC2X_FIGURE_MARKER_RE.lastIndex = 0
  while ((match = DOC2X_FIGURE_MARKER_RE.exec(source))) {
    const text = removeDoc2xFigurePlaceholders(source.slice(cursor, match.index))
    if (text) lines.push(markdownToExamLatex(text, true))
    const figure = figureById.get(match[1])
    if (figure) {
      lines.push(...(figureLayout === 'choice' ? examZhChoiceFigureLines([figure]) : examZhFigureLines([figure])))
    }
    cursor = match.index + match[0].length
  }
  const tail = removeDoc2xFigurePlaceholders(source.slice(cursor))
  if (tail) lines.push(markdownToExamLatex(tail, true))
  return lines.join('\n')
}

// ── Answer blank ───────────────────────────────────────────────────────────────

export function examZhAnswerBlank(serialNo: number) {
  const heights: Record<number, string> = {
    15: '4.4cm',
    16: '4.8cm',
    17: '4.6cm',
    18: '6.8cm',
    19: '5.2cm',
  }
  return `\\answerblank{${heights[serialNo] || '3cm'}}`
}

// ── Score helpers ──────────────────────────────────────────────────────────────

export function scoreText(score: number) {
  return Number.isInteger(score) ? String(score) : String(score).replace(/\.0+$/, '')
}

export function sectionScoreSummary(count: number, perQuestionScore: number) {
  const total = count * perQuestionScore
  return `每题${scoreText(perQuestionScore)}分，共${scoreText(total)}分`
}

export function buildExamZhScorePlan(rows: QuestionRow[], config: ExamZhScoreConfig) {
  const counts = { singleChoice: 0, multipleChoice: 0, fillin: 0, solution: 0 }
  const totals = { singleChoice: 0, multipleChoice: 0, fillin: 0, solution: 0 }
  const questionScores = new Map<string, number>()
  let solutionIndex = 0
  for (const [index, row] of rows.entries()) {
    const item = mapQuestion(row)
    const paperNo = paperQuestionNo(item, index)
    const questionType = exportQuestionType(item, paperNo)
    let score = 0
    if (questionType === '单选题') {
      score = config.singleChoice
      counts.singleChoice += 1
      totals.singleChoice += score
    } else if (questionType === '多选题') {
      score = config.multipleChoice
      counts.multipleChoice += 1
      totals.multipleChoice += score
    } else if (questionType === '填空题') {
      score = config.fillin
      counts.fillin += 1
      totals.fillin += score
    } else if (questionType === '解答题') {
      score = config.solution[solutionIndex] ?? config.solution[config.solution.length - 1] ?? 0
      solutionIndex += 1
      counts.solution += 1
      totals.solution += score
    }
    if (score > 0) questionScores.set(item.id, score)
  }
  return { counts, totals, questionScores }
}

export function examZhSectionForQuestionType(questionType: string, scorePlan: ReturnType<typeof buildExamZhScorePlan>, emittedSections: Set<string>) {
  if (emittedSections.has(questionType)) return ''
  emittedSections.add(questionType)
  if (questionType === '单选题') return `\\section*{一、单选题（${sectionScoreSummary(scorePlan.counts.singleChoice, scorePlan.counts.singleChoice ? scorePlan.totals.singleChoice / scorePlan.counts.singleChoice : defaultExamZhScoreConfig.singleChoice)}）}`
  if (questionType === '多选题') return `\\section*{二、多选题（${sectionScoreSummary(scorePlan.counts.multipleChoice, scorePlan.counts.multipleChoice ? scorePlan.totals.multipleChoice / scorePlan.counts.multipleChoice : defaultExamZhScoreConfig.multipleChoice)}）}`
  if (questionType === '填空题') return `\\section*{三、填空题（${sectionScoreSummary(scorePlan.counts.fillin, scorePlan.counts.fillin ? scorePlan.totals.fillin / scorePlan.counts.fillin : defaultExamZhScoreConfig.fillin)}）}`
  if (questionType === '解答题') return `\\section*{四、解答题（共${scoreText(scorePlan.totals.solution)}分）}`
  return ''
}

export function normalizeExamZhScoreConfig(value: unknown): ExamZhScoreConfig {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const numberOrDefault = (input: unknown, fallback: number) => {
    const parsed = Number(input)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
  }
  const solutionSource = Array.isArray(source.solution) ? source.solution : defaultExamZhScoreConfig.solution
  return {
    singleChoice: numberOrDefault(source.singleChoice, defaultExamZhScoreConfig.singleChoice),
    multipleChoice: numberOrDefault(source.multipleChoice, defaultExamZhScoreConfig.multipleChoice),
    fillin: numberOrDefault(source.fillin, defaultExamZhScoreConfig.fillin),
    solution: defaultExamZhScoreConfig.solution.map((score, index) => numberOrDefault(solutionSource[index], score)),
  }
}

// ── Stem / choice splitting ────────────────────────────────────────────────────

export function splitChoiceStemForExport(stem: string) {
  const source = stripLeadingQuestionNo(String(stem || ''))
  let matches = Array.from(source.matchAll(/(^|[\r\n])\s*([A-D])\s*[.．、]\s*/g))
  if (matches.length !== 4) {
    matches = Array.from(source.matchAll(/(^|\s)([A-D])\s*[.．、]\s*/g))
  }
  const labels = matches.map((match) => match[2]).join('')
  if (labels !== 'ABCD' || matches.length !== 4) return { prompt: source, choices: [] as string[] }
  const prompt = source.slice(0, matches[0].index).trim()
  const choices = matches.map((match, index) => {
    const start = (match.index || 0) + match[0].length
    const end = index + 1 < matches.length ? (matches[index + 1].index || source.length) : source.length
    return source.slice(start, end).trim()
  })
  // Some experiment/solution questions contain an A-D subquestion followed by
  // (2), (3), etc. Keep that tail outside choice D so later figures and text
  // return to the normal question flow.
  let trailingContent = ''
  const tailMatch = choices[3]?.match(/(?:\n|\\par\s*)\s*(?=[（(](?:2|3|4|5|6|7|8|9|二|三|四|五|六|七|八|九)[）)])/)
  if (tailMatch?.index !== undefined) {
    trailingContent = choices[3].slice(tailMatch.index).replace(/^\s*\\par\s*/, '').trim()
    choices[3] = choices[3].slice(0, tailMatch.index).trim()
  }
  return { prompt, choices, trailingContent }
}

// ── LaTeX generation (exam-zh document class) ──────────────────────────────────

export function buildRunExamZhLatex(
  run: Record<string, any>,
  rows: QuestionRow[],
  title: string,
  variant: ExportVariant = 'student',
  scoreConfig = defaultExamZhScoreConfig,
  watermarkText = '',
) {
  const scorePlan = buildExamZhScorePlan(rows, scoreConfig)
  const watermark = markdownToExamLatex(String(watermarkText || '').replace(/\s+/g, ' ').trim(), false)
  const lines: string[] = [
    '\\documentclass{exam-zh}',
    '\\usepackage{amsmath,mathtools}',
    '\\usepackage{graphicx}',
    '\\usepackage{needspace}',
    '\\usepackage{xcolor}',
    '\\usepackage{eso-pic}',
    '',
    '\\examsetup{',
    '  page/size = a4paper,',
    `  paren/show-answer = ${variant === 'teacher' ? 'true' : 'false'},`,
    `  fillin/show-answer = ${variant === 'teacher' ? 'true' : 'false'},`,
    `  solution/show-solution = ${variant === 'teacher' ? 'show' : 'hide'},`,
    '  choices/max-columns = 4,',
    '  choices/label-pos = auto,',
    '  choices/label-sep = 0.45em,',
    '  choices/column-sep = 1em',
    '}',
    '',
    '\\everymath{\\displaystyle}',
    '\\setlength{\\parskip}{0.32em}',
    '\\newcommand{\\answerblank}[1]{\\par\\vspace{#1}\\par}',
    '\\AddToShipoutPictureBG{%',
    '  \\AtPageCenter{%',
    `    \\rotatebox{35}{\\textcolor{black!14}{\\fontsize{54}{64}\\selectfont\\itshape ${watermark}}}%`,
    '  }%',
    '}',
    '',
    `\\title{${markdownToExamLatex(title, false)}}`,
    '\\subject{}',
    '',
    '\\begin{document}',
    '\\maketitle',
    '\\vspace{-0.8em}',
  ]
  const emittedSections = new Set<string>()
  for (const [index, row] of rows.entries()) {
    const item = mapQuestion(row)
    const paperNo = paperQuestionNo(item, index)
    const questionType = exportQuestionType(item, paperNo)
    const section = examZhSectionForQuestionType(questionType, scorePlan, emittedSections)
    if (section) lines.push('', section)
    if (paperNo === 16 || paperNo === 18) lines.push('\\newpage')
    const { prompt, choices, trailingContent } = splitChoiceStemForExport(item.stemMarkdown)
    const questionScore = scorePlan.questionScores.get(item.id)
    lines.push('', '\\begin{question}')
    const stemFigures = questionFigures({ item })
    lines.push(`${questionScore ? `\\textbf{（${scoreText(questionScore)}分）}\\quad ` : ''}${renderExamZhPromptWithInlineFigures(prompt, stemFigures, questionType, variant, item.answerText) || '（题干待补充）'}`)
    if (choices.length) {
      lines.push('\\begin{choices}')
      for (const choice of choices) lines.push(`  \\item ${renderExamZhMarkdownWithInlineFigures(choice, stemFigures, 'choice')}`)
      lines.push('\\end{choices}')
    }
    if (trailingContent) lines.push(renderExamZhMarkdownWithInlineFigures(trailingContent, stemFigures))
    lines.push(...examZhFigureLines(figuresWithoutInlineMarkers(item.stemMarkdown, stemFigures)))
    if (questionType === '解答题' && paperNo >= 15 && variant !== 'teacher') {
      lines.push(examZhAnswerBlank(paperNo))
    }
    if (variant === 'teacher') {
      lines.push('\\begin{solution}')
      const solutionFigures = analysisFigures({ item })
      lines.push(`\\textbf{【答案】} ${renderExamZhMarkdownWithInlineFigures(item.answerText, solutionFigures) || '暂无'}`)
      lines.push('')
      lines.push(`\\textbf{【解析】} ${renderExamZhMarkdownWithInlineFigures(item.analysisMarkdown, solutionFigures) || '暂无'}`)
      const remainingSolutionFigures = figuresWithoutInlineMarkers(`${item.answerText || ''}\n${item.analysisMarkdown || ''}`, solutionFigures)
      if (remainingSolutionFigures.length) {
        lines.push(...examZhFigureLines(remainingSolutionFigures))
      }
      lines.push('\\end{solution}')
    }
    lines.push('\\end{question}')
  }
  lines.push('', '\\end{document}', '')
  return lines.join('\n')
}

export function exportRunExamZh(
  runId: string,
  options: {
    title?: string
    format?: 'latex' | 'pdf'
    scoreConfig?: ExamZhScoreConfig
    watermarkText?: string
    variant?: ExportVariant
  }
) {
  const variant = options.variant || 'student'
  const run = getRun(runId)
  if (!run) throw new Error('批次不存在。')
  const rows = (db.prepare(`
    SELECT * FROM question_bank_items
    WHERE source_run_id = ? AND bank_status = 'banked'
    ORDER BY serial_no ASC
  `).all(runId) as QuestionRow[]).sort((left, right) => {
    const leftNo = paperQuestionNo(mapQuestion(left), 0)
    const rightNo = paperQuestionNo(mapQuestion(right), 0)
    return leftNo - rightNo
  })
  if (!rows.length) throw new Error('当前批次暂无已入库题目，无法导出。')
  return exportExamZhQuestionSet({
    id: runId,
    title: options.title || run.paperTitle || run.pdfName || runId,
    rows,
    ...options,
  })
}

export function exportExamZhQuestionSet(input: {
  id: string
  title: string
  rows: QuestionRow[]
  format?: 'latex' | 'pdf'
  scoreConfig?: ExamZhScoreConfig
  watermarkText?: string
  variant?: ExportVariant
}) {
  const variant = input.variant || 'student'
  if (!input.rows.length) throw new Error('当前题组没有题目，无法导出。')
  const rows = [...input.rows].sort((left, right) => {
    const leftNo = paperQuestionNo(mapQuestion(left), 0)
    const rightNo = paperQuestionNo(mapQuestion(right), 0)
    return leftNo - rightNo
  })
  const outDir = path.join(storageRoot, 'output', 'pdf', 'examzh-exports', safeName(input.id))
  fs.mkdirSync(outDir, { recursive: true })
  const baseName = `${safeName(input.title || input.id)}-examzh-${variant}`
  const texPath = path.join(outDir, `${baseName}.tex`)
  fs.writeFileSync(
    texPath,
    buildRunExamZhLatex(
      {},
      rows,
      input.title,
      variant,
      input.scoreConfig,
      input.watermarkText || '',
    ),
    'utf8'
  )
  if (input.format === 'pdf') {
    for (let i = 0; i < 2; i += 1) {
      execFileSync(xelatexPath(), ['-interaction=nonstopmode', '-halt-on-error', path.basename(texPath)], {
        cwd: outDir,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 10,
      })
    }
    return { path: path.join(outDir, `${baseName}.pdf`), texPath, logPath: path.join(outDir, `${baseName}.log`), format: 'pdf' as const }
  }
  return { path: texPath, texPath, logPath: path.join(outDir, `${baseName}.log`), format: 'latex' as const }
}

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { storageRoot, runsRoot, pythonRoot } from '../config.js'
import { parseJson } from './json.js'
import { normalizeBlocks, blocksToMarkdown, inlineMarkdown, markdownToExamLatex, normalizeLatexMathSegment } from './rich-content.js'
import { latexWithInlineFigures, latexFigureLines, figureCaptionForExport, questionFigures, analysisFigures, removeDoc2xFigurePlaceholders, questionPlainText } from './figure-export.js'
import { imageDimensions } from './image-operations.js'
import { nowIso, safeName } from './ids.js'
import { normalizeQuestionType, exportQuestionType, sectionOrdinal } from './question-type.js'
import { defaultExamZhScoreConfig } from './exam-zh.js'
import { firstExecutable, xelatexPath } from '../services/settings/tools.js'
import { pythonCommand } from '../services/settings/python.js'
import type { FigureLayout, LayoutWarning, ResolvedFigureLayout, ResolvedFigurePlacement } from '../services/question-bank/paper-layout.js'

// ── Types ──────────────────────────────────────────────────────────────────────

type ExportVariant = 'student' | 'teacher'

export type WorksheetFigureSpec = {
  id: string
  sourcePath: string
  outputName: string
  defaultWidth: number
  minWidth: number
}

export type WorksheetFigureTelemetry = {
  id: string
  pageTotal: number
  pageGoal: number
  height: number
  depth: number
  width: number
}

export type WorksheetQuestionTelemetry = {
  id: string
  startPage: number
  startPageTotal: number
  endPage: number
  endPageTotal: number
  pageGoal: number
}

export type FigureLayoutDecision = {
  placement: ResolvedFigurePlacement
  widthRatio: number
  alignment: 'left' | 'center' | 'right'
  keepWithChoices: boolean
  source: 'auto' | 'manual'
  reason: string
  confidence: number
  layout: ResolvedFigureLayout
  warnings: LayoutWarning[]
}

export type FigureLayoutDecisionInput = {
  questionId: string
  figureId: string
  imagePath?: string
  stemFigureCount: number
  hasInlineMarker: boolean
  choices: string[]
  requested?: FigureLayout
}

type WorksheetSectionScore = {
  count: number
  total: number
  scores: number[]
}

// ── Constants ──────────────────────────────────────────────────────────────────

export const worksheetMaxLayoutIterations = 3
export const worksheetFigureFitPaddingPt = 4

function scoreText(score: number) {
  return Number.isInteger(score) ? String(score) : String(score).replace(/\.0+$/, '')
}

// ── Figure width limits ────────────────────────────────────────────────────────

export function worksheetFigureWidthLimits(imagePath: string) {
  try {
    const size = imageDimensions(imagePath)
    const aspect = size.height > 0 ? size.width / size.height : 1
    if (aspect > 1.6) return { defaultWidth: 0.48, minWidth: 0.36 }
    if (aspect < 0.85) return { defaultWidth: 0.20, minWidth: 0.16 }
  } catch {
    // Fall back to the ordinary-image preset when metadata cannot be read.
  }
  return { defaultWidth: 0.30, minWidth: 0.24 }
}

/** Deterministic, side-effect-free decision used by PDF preview and export. */
export function decideWorksheetFigureLayout(input: FigureLayoutDecisionInput): FigureLayoutDecision {
  const warnings: LayoutWarning[] = []
  let aspect: number | undefined
  if (input.imagePath && fs.existsSync(input.imagePath)) {
    try {
      const size = imageDimensions(input.imagePath)
      if (size.width > 0 && size.height > 0) aspect = size.width / size.height
    } catch {
      // Invalid metadata is handled by the block fallback below.
    }
  }
  if (aspect === undefined) {
    warnings.push({
      code: input.imagePath ? 'layout-fallback' : 'missing-figure',
      questionId: input.questionId,
      figureId: input.figureId,
      message: input.imagePath ? '无法读取图片尺寸，已使用独占一行布局。' : '图片文件不存在，无法计算图文混排。',
      suggestion: '请检查图片文件后刷新排版预览。',
    })
  }

  const hasFourChoices = input.choices.length === 4
  const shortChoices = hasFourChoices && qbankChoiceLayout(input.choices) === 'four'
  const suitableAspect = aspect !== undefined && aspect >= 0.72 && aspect <= 1.65
  const auto: ResolvedFigurePlacement = !input.hasInlineMarker && input.stemFigureCount === 1 && hasFourChoices && suitableAspect
    ? 'side-right'
    : 'block'
  const requested = input.requested?.placement
  const override = requested && requested !== 'auto' ? requested : undefined
  let resolved = override || auto
  let source: 'auto' | 'manual' = override ? 'manual' : 'auto'
  let reason = auto === 'side-right'
    ? '四个选项纵向排列在左侧，题图放在右侧并共享同一行区域。'
    : input.hasInlineMarker
      ? '图片已有题干内联锚点，不参与自动左右混排。'
      : input.stemFigureCount !== 1
        ? '仅单张题干图可以自动左右混排。'
        : !shortChoices
          ? '选项数量或宽度不适合左右混排。'
          : '图片宽高比不适合左右混排。'

  if ((resolved === 'side-left' || resolved === 'side-right') && (input.hasInlineMarker || input.stemFigureCount !== 1 || input.choices.length !== 4 || aspect === undefined)) {
    warnings.push({ code: 'layout-fallback', questionId: input.questionId, figureId: input.figureId, message: '当前图片无法安全执行左右混排，已回退为独占一行。', suggestion: '请使用单张无锚点题干图，或选择图片独占一行。' })
    resolved = 'block'
    source = override ? 'manual' : 'auto'
    reason = '不满足稳定左右混排约束，安全回退为独占一行。'
  }

  const side = resolved === 'side-left' || resolved === 'side-right'
  const requestedWidth = input.requested?.widthRatio ?? (side ? 0.38 : input.imagePath ? worksheetFigureWidthLimits(input.imagePath).defaultWidth : 0.3)
  const widthRatio = side ? Math.min(0.55, Math.max(0.25, requestedWidth)) : Math.min(1, Math.max(0.15, requestedWidth))
  return {
    placement: resolved,
    widthRatio,
    alignment: input.requested?.alignment || (side ? (resolved === 'side-left' ? 'left' : 'right') : 'center'),
    keepWithChoices: input.requested?.keepWithChoices ?? side,
    source,
    reason,
    confidence: auto === 'side-right' ? 0.9 : aspect === undefined ? 0.45 : 0.8,
    layout: { auto, override, resolved },
    warnings,
  }
}

export function worksheetFigureId(collectionId: string, entry: any, figure: Record<string, any>, index: number, usage: string) {
  const questionKey = safeName(String(entry.item.serialNo || entry.item.id || index + 1))
  const figureKey = safeName(String(figure.id || `fig${index + 1}`))
  return `${safeName(collectionId)}-q${questionKey}-${figureKey}-${safeName(usage)}`
}

// ── Figure optimization ────────────────────────────────────────────────────────

export function parseWorksheetFigureTelemetry(logPath: string) {
  if (!fs.existsSync(logPath)) return [] as WorksheetFigureTelemetry[]
  const text = fs.readFileSync(logPath, 'utf8')
  const blocks = text.match(/QBANKFIG[\s\S]*?width=[0-9.]+/g) || []
  return blocks.flatMap((block) => {
    const compact = block.replace(/\s+/g, '')
    const match = compact.match(/QBANKFIGid=(.+?)page=(.+?)pagetotal=([0-9.]+)ptpagegoal=([0-9.]+)ptfigheight=([0-9.]+)ptfigdepth=([0-9.]+)ptwidth=([0-9.]+)/)
    if (!match) return []
    return [{
      id: match[1],
      pageTotal: Number(match[3]),
      pageGoal: Number(match[4]),
      height: Number(match[5]),
      depth: Number(match[6]),
      width: Number(match[7]),
    }]
  })
}

export function parseWorksheetQuestionTelemetry(logPath: string) {
  if (!fs.existsSync(logPath)) return [] as WorksheetQuestionTelemetry[]
  const text = fs.readFileSync(logPath, 'utf8')
  const compact = text.replace(/\s+/g, '')
  const records = [...compact.matchAll(/QBANKQUESTIONphase=(start|end)id=(.+?)page=(\d+)pagetotal=([0-9.]+)ptpagegoal=([0-9.]+)pt/g)]
  const starts = new Map<string, { page: number; pageTotal: number; pageGoal: number }>()
  const result: WorksheetQuestionTelemetry[] = []
  for (const match of records) {
    const [, phase, id, pageText, totalText, goalText] = match
    const page = Number(pageText)
    if (phase === 'start') starts.set(id, { page, pageTotal: Number(totalText), pageGoal: Number(goalText) })
    else {
      const start = starts.get(id)
      if (start) result.push({ id, startPage: start.page, startPageTotal: start.pageTotal, endPage: page, endPageTotal: Number(totalText), pageGoal: Number(goalText) || start.pageGoal })
    }
  }
  return result
}

export function worksheetTelemetryWarnings(
  questions: WorksheetQuestionTelemetry[],
  figures: WorksheetFigureTelemetry[],
  specs: Map<string, WorksheetFigureSpec>,
): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  for (const record of questions) {
    if (record.endPage > record.startPage) warnings.push({ code: 'question-split', questionId: record.id, page: record.startPage, message: '题目内容跨页显示。', suggestion: '启用整题保持，或在本题前强制分页。' })
    if (record.pageGoal < 100000 && record.endPageTotal > record.pageGoal + 1) warnings.push({ code: 'page-overflow', questionId: record.id, page: record.endPage, message: '题目内容超过页面正文区域。', suggestion: '缩小图片、减少答题区高度或在本题前分页。' })
  }
  for (const record of figures) {
    const spec = specs.get(record.id)
    if (!spec || record.pageGoal > 100000) continue
    const remaining = record.pageGoal - record.pageTotal
    const needed = record.height + record.depth
    if (needed > remaining && record.width <= spec.minWidth + 0.0005) warnings.push({ code: 'figure-too-small', questionId: questionIdFromFigureId(record.id), figureId: record.id, message: '图片已达到最小可读宽度，当前页面仍无法容纳。', suggestion: '将图文块整体移到下一页，或手工调整图片布局。' })
  }
  return warnings
}

function questionIdFromFigureId(id: string) {
  return id.match(/-q([^-]+)-/)?.[1] || id
}

export function optimizeWorksheetFigures(
  telemetry: WorksheetFigureTelemetry[],
  specs: Map<string, WorksheetFigureSpec>,
  adjustments: Map<string, number>,
) {
  let changed = false
  telemetry.forEach((record) => {
    const spec = specs.get(record.id)
    if (!spec || record.width <= spec.minWidth + 0.0005 || record.pageGoal > 100000) return
    const remaining = record.pageGoal - record.pageTotal
    const needed = record.height + record.depth
    if (remaining <= worksheetFigureFitPaddingPt || needed <= remaining) return
    // Compute the fitting scale directly; repeated 0.88 scaling could stop
    // short and leave an otherwise fitting diagram alone on the next page.
    const targetWidth = Number((record.width * ((remaining - worksheetFigureFitPaddingPt) / needed)).toFixed(4))
    if (targetWidth < spec.minWidth || targetWidth >= record.width - 0.0005) return
    adjustments.set(record.id, targetWidth)
    changed = true
  })
  return changed
}

// ── Tags ───────────────────────────────────────────────────────────────────────

export function worksheetTags(entry: any) {
  const parts: string[] = []
  const difficulty = String(entry.item.difficultyLabel || '').trim()
  if (difficulty) parts.push(`\\difftag{${markdownToExamLatex(difficulty, false)}}`)
  const knowledgePoints = Array.isArray(entry.item.knowledgePoints) ? entry.item.knowledgePoints.slice(0, 4) : []
  for (const point of knowledgePoints) {
    parts.push(`\\kptag{${markdownToExamLatex(String(point), false)}}`)
  }
  return parts.join(' ')
}

// ── Answer LaTeX ───────────────────────────────────────────────────────────────

export function worksheetAnswerLatex(value: string) {
  const text = String(value || '').trim()
  if (!text) return ''
  const rawMath = /\\(?:frac|dfrac|sqrt|sum|int|lim|ln|infty|mathbb|mathbf|vec|overrightarrow|leq|geq|neq|cdot|times|binom)\b/
  if (!text.includes('$') && !/\\[([]/.test(text) && rawMath.test(text) && text.length <= 160) {
    return `$${normalizeLatexMathSegment(text)}$`
  }
  return markdownToExamLatex(text, true)
}

// ── Compilation ────────────────────────────────────────────────────────────────

export function compileWorksheetTex(texPath: string) {
  try {
    for (let pass = 0; pass < 2; pass += 1) {
      execFileSync(xelatexPath(), ['-interaction=nonstopmode', '-halt-on-error', path.basename(texPath)], {
        cwd: path.dirname(texPath),
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 10,
      })
    }
  } catch (error) {
    const logPath = texPath.replace(/\.tex$/i, '.log')
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''
    const diagnostic = Array.from(log.matchAll(/!\s+([^\n]+)[\s\S]*?l\.(\d+)\s+([^\n]+)/g)).at(-1)
    if (diagnostic) {
      throw new Error(`PDF 编译失败（TeX 第 ${diagnostic[2]} 行）：${diagnostic[1]}。附近内容：${diagnostic[3].trim()}`, { cause: error })
    }
    throw error
  }
}

// ── Score helpers ──────────────────────────────────────────────────────────────

export function worksheetDefaultScore(questionType: string, solutionIndex: number) {
  if (questionType === '单选题') return defaultExamZhScoreConfig.singleChoice
  if (questionType === '多选题') return defaultExamZhScoreConfig.multipleChoice
  if (questionType === '填空题') return defaultExamZhScoreConfig.fillin
  if (questionType === '解答题') return defaultExamZhScoreConfig.solution[solutionIndex] ?? defaultExamZhScoreConfig.solution[defaultExamZhScoreConfig.solution.length - 1] ?? 0
  return 0
}

export function worksheetGeneratedSectionName(questionType: string, emitted: Map<string, string>) {
  const normalized = normalizeQuestionType(questionType)
  const existing = emitted.get(normalized)
  if (existing) return existing
  const name = `${sectionOrdinal(emitted.size + 1)}、${normalized}`
  emitted.set(normalized, name)
  return name
}

export function worksheetEntryKey(entry: any, index: number) {
  return String(entry.relationId || entry.item?.id || index)
}

export function buildWorksheetScorePlan(collection: Record<string, any>) {
  const entryScores = new Map<string, number>()
  const entrySections = new Map<string, string>()
  const sectionScores = new Map<string, WorksheetSectionScore>()
  const generatedSections = new Map<string, string>()
  const hasExplicitSections = collection.questions.some((entry: any) => String(entry.sectionName || '').trim())
  let currentSection = ''
  let solutionIndex = 0
  collection.questions.forEach((entry: any, index: number) => {
    const questionType = normalizeQuestionType(entry.item.questionType, entry.item.stemMarkdown, entry.item.answerText)
    const explicitScore = Number(entry.score || 0)
    const defaultScore = worksheetDefaultScore(questionType, solutionIndex)
    if (questionType === '解答题') solutionIndex += 1
    const score = explicitScore > 0 ? explicitScore : defaultScore
    if (entry.sectionName) currentSection = String(entry.sectionName)
    if (!hasExplicitSections) currentSection = worksheetGeneratedSectionName(questionType, generatedSections)
    else if (!currentSection) currentSection = worksheetGeneratedSectionName(questionType, generatedSections)
    const key = worksheetEntryKey(entry, index)
    entryScores.set(key, score)
    entrySections.set(key, currentSection)
    const section = sectionScores.get(currentSection) || { count: 0, total: 0, scores: [] }
    section.count += 1
    section.total += score
    section.scores.push(score)
    sectionScores.set(currentSection, section)
  })
  return { entryScores, entrySections, sectionScores }
}

export function worksheetSectionTitle(name: string, score: WorksheetSectionScore | undefined) {
  if (!score) return name
  const uniqueScores = Array.from(new Set(score.scores.map((value) => scoreText(value))))
  const summary = uniqueScores.length === 1
    ? `每题${uniqueScores[0]}分，共${score.count}题`
    : `共${score.count}题，共${scoreText(score.total)}分`
  return `${name}（${summary}）`
}

// ── Choice layout ──────────────────────────────────────────────────────────────

export function qbankChoiceLayout(choices: string[]) {
  if (choices.length !== 4) return 'one'
  if (choices.some(qbankChoiceRequiresSingleColumn)) return 'one'
  const widths = choices.map(qbankChoiceVisualWidth)
  const maxWidth = Math.max(...widths, 0)
  const totalWidth = widths.reduce((sum, width) => sum + width, 0)
  if (maxWidth <= 18 && totalWidth <= 72) return 'four'
  if (maxWidth <= 38 && totalWidth <= 152) return 'two'
  return 'one'
}

function qbankChoiceRequiresSingleColumn(choice: string) {
  const source = String(choice || '').replace(/\r\n?/g, '\n')
  return /\n\s*\n|\$\$|\\\[|\\begin\s*\{|!\[[^\]]*\]\(|<img\b|^\s*\|.*\|\s*$/im.test(source)
}

/** Approximate printed em width, ignoring LaTeX/Markdown source-only syntax. */
function qbankChoiceVisualWidth(choice: string) {
  const plain = questionPlainText(String(choice || '').replace(/\r\n?/g, '\n').replace(/\n+/g, ' '))
    .replace(/\\(?:left|right|displaystyle|textstyle|quad|qquad)\b|\\[,;!]/g, '')
    .replace(/\\(?:frac|dfrac|tfrac|sqrt|overline|underline|vec|hat|bar)\b/g, '')
    .replace(/\\[a-zA-Z]+/g, 'α')
    .replace(/[\$*_`~{}]/g, '')
    .replace(/\s+/g, '')

  let width = 0
  for (const character of plain) {
    if (/\p{Script=Han}/u.test(character)) width += 1
    else if (/[A-Z]/.test(character)) width += 0.7
    else if (/[a-z0-9]/.test(character)) width += 0.55
    else if (/[=+\-×÷<>≤≥]/.test(character)) width += 0.7
    else width += 0.8
  }
  return width
}

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { storageRoot, runsRoot, pythonRoot } from '../config.js'
import { parseJson } from './json.js'
import { normalizeBlocks, blocksToMarkdown, inlineMarkdown, markdownToExamLatex, normalizeLatexMathSegment } from './rich-content.js'
import { latexWithInlineFigures, latexFigureLines, figureCaptionForExport, questionFigures, analysisFigures, removeDoc2xFigurePlaceholders, questionPlainText } from './figure-export.js'
import { imageDimensions } from './figure-helpers.js'
import { nowIso, safeName } from './ids.js'
import { normalizeQuestionType, exportQuestionType, sectionOrdinal } from './question-type.js'
import { defaultExamZhScoreConfig } from './exam-zh.js'
import { firstExecutable, xelatexPath } from '../services/settings/tools.js'
import { pythonCommand } from '../services/settings/python.js'

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
  if (!text.includes('$') && rawMath.test(text) && text.length <= 160) {
    return `$${normalizeLatexMathSegment(text)}$`
  }
  return markdownToExamLatex(text, true)
}

// ── Compilation ────────────────────────────────────────────────────────────────

export function compileWorksheetTex(texPath: string) {
  for (let pass = 0; pass < 2; pass += 1) {
    execFileSync(xelatexPath(), ['-interaction=nonstopmode', '-halt-on-error', path.basename(texPath)], {
      cwd: path.dirname(texPath),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10,
    })
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
  if (choices.some((choice) => /\n|\$\$|\|[^\n]*\||!\[[^\]]*\]\(/.test(String(choice || '')))) return 'one'
  const plainChoices = choices.map((choice) => questionPlainText(choice).replace(/\$+/g, '').replace(/\s+/g, ''))
  const maxLength = Math.max(...plainChoices.map((choice) => choice.length), 0)
  const totalLength = plainChoices.reduce((sum, choice) => sum + choice.length, 0)
  if (maxLength <= 18 && totalLength <= 72) return 'four'
  if (maxLength <= 38 && totalLength <= 152) return 'two'
  return 'one'
}

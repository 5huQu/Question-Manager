import fs from 'node:fs'
import path from 'node:path'
import { sourceRoot, storageRoot } from '../../../config.js'
import { safeName } from '../../../utils/ids.js'
import {
  optimizeWorksheetFigures,
  compileWorksheetTex,
  worksheetMaxLayoutIterations,
  parseWorksheetFigureTelemetry,
  parseWorksheetQuestionTelemetry,
  worksheetTelemetryWarnings,
} from '../../../utils/worksheet-figures.js'
import { exportExamZhQuestionSet } from '../../../utils/exam-zh.js'
import { readAppSettings } from '../../settings/app-settings.js'
import { mapQuestion } from '../../../db/questions.js'
import { collectionQuestionRows } from './collection-helpers.js'
import { assertCollectionExportable, buildQuestionSetWorksheetCollection } from './question-validation.js'
import { buildCollectionWorksheetLatex } from './worksheet-latex.js'
import { exportFieldsForVariant, type ExportCollection, type StandardExportVariant } from './types.js'
import type { PaperLayoutDraft, LayoutWarning } from '../paper-layout.js'
import type { QuestionRow } from '../../../types/index.js'

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

import fs from 'node:fs'
import path from 'node:path'
import { parseJson } from '../json.js'
import { resolveStoragePath, stripAssetPrefix } from '../paths.js'
import { db } from '../../db/connection.js'
import { cropFigureImage, cropFigureImageAsync } from './pil-operations.js'
import { normalizedFigureId, reviewFigurePixelBBox, figurePixelBBoxForSegments, reviewFigureDefaultUsage, type ReviewRow } from './review-bbox.js'
import { figureBelongsToReview, sourceImagePathForOcrResult } from './figure-belonging.js'
import { loadSolutionCutResultRecord } from './cut-results.js'

export function providerFigureWithExistingAsset(figure: Record<string, any>, figureId: string) {
  const providerAssetOrigin = String(figure.origin || '')
  const providerAssetPath = (providerAssetOrigin === 'doc2x_v3' || providerAssetOrigin === 'glm_ocr' || providerAssetOrigin === 'review_manual')
    ? stripAssetPrefix(String(figure.path || figure.assetPath || ''))
    : ''
  if (!providerAssetPath || !fs.existsSync(resolveStoragePath(providerAssetPath))) return null
  const usage = String(figure.usage || figure.category || 'stem')
  return {
    ...figure,
    id: figureId,
    origin: providerAssetOrigin,
    usage,
    category: String(figure.category || figure.usage || usage),
    pageNumber: Number(figure.pageNumber ?? figure.page_number ?? 1),
    path: providerAssetPath,
  }
}

export function sourceFiguresForImportedOcrResult(result: Record<string, any>, reviewRow?: ReviewRow) {
  const reviewFigures = reviewRow ? parseJson<Array<Record<string, any>>>(reviewRow.figures_json || '[]', []) : []
  const providerFigures = Array.isArray(result.figures) ? result.figures : []
  // A reviewed question from a scanned paper has an explicit human figure
  // selection. Provider page-block images are merely OCR by-products and may
  // overlap neighbouring options or include a larger area, so they must never
  // replace the reviewed crop. We still retain provider figures for documents
  // without a manual question review (notably standalone solution documents).
  const candidateFigures = reviewRow && reviewFigures.length > 0 && String(result.ocr_record_kind || 'question') !== 'solution'
    ? reviewFigures
    : [...reviewFigures, ...providerFigures]
  return Array.from(new Map(
    candidateFigures
      .filter((figure) => figureBelongsToReview(reviewRow, figure))
      .map((figure, index) => [String(figure.id || `figure_${index}`), figure]),
  ).values())
}

/**
 * Build the figure list for an imported OCR result, cropping review images
 * as needed.  Used by question-bank import and OCR re-run pipelines.
 */
export function figuresForImportedOcrResult(result: Record<string, any>, runId: string) {
  const reviewRow = db.prepare('SELECT * FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?')
    .get(runId, String(result.id || '')) as ReviewRow | undefined
  const sourceFigures = sourceFiguresForImportedOcrResult(result, reviewRow)
  const sourceRel = sourceImagePathForOcrResult(result, reviewRow)
  const sourceAbs = sourceRel ? resolveStoragePath(sourceRel) : ''
  return sourceFigures.map((figure, index) => {
    const figureId = normalizedFigureId(figure.id, index)
    const providerFigure = providerFigureWithExistingAsset(figure, figureId)
    if (providerFigure) return providerFigure
    const outputRel = path.join('data', 'question_figures', String(result.id), `${figureId}.png`)
    const outputAbs = resolveStoragePath(outputRel)
    const sourceBBox = figure.bbox || {}
    const resultSegments = Array.isArray(result.segments) ? result.segments : (Array.isArray(result.reviewed_segments) ? result.reviewed_segments : [])
    const pixelBBox = sourceAbs && fs.existsSync(sourceAbs)
      ? reviewRow
        ? reviewFigurePixelBBox(reviewRow, figure, sourceAbs)
        : figurePixelBBoxForSegments(resultSegments, Number(result.page || figure.page_number || figure.pageNumber || 1), figure, sourceAbs)
      : sourceBBox
    if (sourceAbs && fs.existsSync(sourceAbs)) {
      cropFigureImage(sourceAbs, outputAbs, pixelBBox)
    }
    const usage = String(figure.usage || figure.category || reviewFigureDefaultUsage(reviewRow, figure))
    return {
      ...figure,
      id: figureId,
      origin: figure.origin || 'review_crop',
      usage,
      category: String(figure.category || figure.usage || usage),
      pageNumber: Number(figure.pageNumber ?? figure.page_number ?? 1),
      reviewBBox: sourceBBox,
      bbox: pixelBBox,
      sourcePath: sourceRel,
      path: fs.existsSync(outputAbs) ? outputRel : String(figure.path || ''),
    }
  })
}

export async function figuresForImportedOcrResultAsync(result: Record<string, any>, runId: string) {
  const reviewRow = db.prepare('SELECT * FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?').get(runId, String(result.id || '')) as ReviewRow | undefined
  const sourceFigures = sourceFiguresForImportedOcrResult(result, reviewRow)
  const sourceRel = sourceImagePathForOcrResult(result, reviewRow)
  const sourceAbs = sourceRel ? resolveStoragePath(sourceRel) : ''
  const figures: Array<Record<string, any>> = []
  for (const [index, figure] of sourceFigures.entries()) {
    const figureId = normalizedFigureId(figure.id, index)
    const providerFigure = providerFigureWithExistingAsset(figure, figureId)
    if (providerFigure) {
      figures.push(providerFigure)
      continue
    }
    const outputRel = path.join('data', 'question_figures', String(result.id), `${figureId}.png`)
    const outputAbs = resolveStoragePath(outputRel)
    const sourceBBox = figure.bbox || {}
    const resultSegments = Array.isArray(result.segments) ? result.segments : (Array.isArray(result.reviewed_segments) ? result.reviewed_segments : [])
    const pixelBBox = sourceAbs && fs.existsSync(sourceAbs)
      ? reviewRow
        ? reviewFigurePixelBBox(reviewRow, figure, sourceAbs)
        : figurePixelBBoxForSegments(resultSegments, Number(result.page || figure.page_number || figure.pageNumber || 1), figure, sourceAbs)
      : sourceBBox
    if (sourceAbs && fs.existsSync(sourceAbs)) await cropFigureImageAsync(sourceAbs, outputAbs, pixelBBox)
    const usage = String(figure.usage || figure.category || reviewFigureDefaultUsage(reviewRow, figure))
    figures.push({ ...figure, id: figureId, origin: figure.origin || 'review_crop', usage, category: String(figure.category || figure.usage || usage), pageNumber: Number(figure.pageNumber ?? figure.page_number ?? 1), reviewBBox: sourceBBox, bbox: pixelBBox, sourcePath: sourceRel, path: fs.existsSync(outputAbs) ? outputRel : String(figure.path || '') })
  }
  return figures
}

export function figuresForSolutionItem(solution: Record<string, any>, targetQuestionId: string) {
  const sourceRel = stripAssetPrefix(String(solution.source_image_path || solution.image_path || ''))
  const sourceAbs = sourceRel ? resolveStoragePath(sourceRel) : ''
  const sourceFigures = parseJson<Array<Record<string, any>>>(String(solution.figures_json || '[]'), [])
    .filter((figure) => figureBelongsToReview(undefined, figure))
  return sourceFigures.map((figure, index) => {
    const figureId = normalizedFigureId(`${solution.id || 'solution'}_${figure.id || index + 1}`, index)
    const providerFigure = providerFigureWithExistingAsset(figure, figureId)
    if (providerFigure) return { ...providerFigure, usage: 'analysis', category: 'analysis' }
    const existingPath = stripAssetPrefix(String(figure.path || ''))
    if (existingPath && fs.existsSync(resolveStoragePath(existingPath))) {
      return { ...figure, id: figureId, usage: 'analysis', category: 'analysis', path: existingPath }
    }
    const outputRel = path.join('data', 'question_figures', targetQuestionId, `${figureId}.png`)
    const outputAbs = resolveStoragePath(outputRel)
    const sourceBBox = figure.bbox || {}
    const cutRecord = loadSolutionCutResultRecord(String(solution.source_run_id || ''), String(solution.id || ''))
    const cutSegments = Array.isArray(cutRecord?.segments) ? cutRecord.segments : []
    const pixelBBox = sourceAbs && fs.existsSync(sourceAbs)
      ? figurePixelBBoxForSegments(cutSegments, Number(cutRecord?.page || figure.page_number || figure.pageNumber || 1), figure, sourceAbs)
      : sourceBBox
    if (sourceAbs && fs.existsSync(sourceAbs)) cropFigureImage(sourceAbs, outputAbs, pixelBBox)
    return {
      ...figure,
      id: figureId,
      origin: figure.origin || 'review_crop',
      usage: 'analysis',
      category: 'analysis',
      pageNumber: Number(figure.pageNumber ?? figure.page_number ?? 1),
      reviewBBox: sourceBBox,
      bbox: pixelBBox,
      sourcePath: sourceRel,
      path: fs.existsSync(outputAbs) ? outputRel : existingPath,
    }
  })
}

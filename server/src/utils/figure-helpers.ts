import fs from 'node:fs'
import path from 'node:path'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { parseJson } from './json.js'
import { resolveStoragePath, stripAssetPrefix } from './paths.js'
import { db } from '../db/connection.js'
import { getRun } from '../db/runs.js'
import { pythonCommand } from '../services/settings/python.js'

const INLINE_IMAGE_REFERENCE_RE = /<img\b[^>]*\bsrc\s*=\s*['"][^'"]+['"][^>]*>|!\[[^\]]*\]\([^)]+\)/gi
const INLINE_IMAGE_PLACEHOLDER_RE = /<!--\s*OCR_IMAGE_REFERENCE:(stem|answer|analysis):\d+\s*-->/gi
const INLINE_BOUND_FIGURE_RE = /<!--\s*DOC2X_FIGURE:[^>\s]+\s*-->/gi
const INLINE_IMAGE_WARNING_RE = /\n?>\s*⚠️\s*缺少可绑定的(?:题干|答案|解析)图（引用\s*\d+\/\d+）\s*\n?/g
const execFileAsync = promisify(execFile)

// ── Exported functions ───────────────────────────────────────────────────────

export function imageMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  return 'image/png'
}

export function imageExtension(filename: string, mimeType: string) {
  const extension = path.extname(filename || '').toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) return extension
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  return '.png'
}

export function figureAbsolutePath(figure: Record<string, any>) {
  const rawPath = stripAssetPrefix(String(figure.path || figure.sourcePath || ''))
  if (!rawPath) return ''
  return path.isAbsolute(rawPath) ? rawPath : resolveStoragePath(rawPath)
}

export function imageDimensions(imagePath: string) {
  return JSON.parse(execFileSync(pythonCommand(), [
    '-c',
    'from PIL import Image; import json, sys; im=Image.open(sys.argv[1]); print(json.dumps({"width": im.width, "height": im.height}))',
    imagePath,
  ], { encoding: 'utf8' })) as { width: number; height: number }
}

export function cropFigureImage(sourcePath: string, outputPath: string, bbox: Record<string, any>) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const cropScript = [
    'from PIL import Image',
    'import json, sys',
    'src, dst, raw = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])',
    'x = int(round(float(raw.get("x", raw.get("x0", 0)))))',
    'y = int(round(float(raw.get("y", raw.get("y0", 0)))))',
    'w = int(round(float(raw.get("width", raw.get("w", raw.get("x1", 0) - raw.get("x0", 0))))))',
    'h = int(round(float(raw.get("height", raw.get("h", raw.get("y1", 0) - raw.get("y0", 0))))))',
    'im = Image.open(src)',
    'x = max(0, min(x, im.width - 1)); y = max(0, min(y, im.height - 1))',
    'w = max(1, min(w, im.width - x)); h = max(1, min(h, im.height - y))',
    'im.crop((x, y, x + w, y + h)).save(dst)',
  ].join('; ')
  execFileSync(pythonCommand(), ['-c', cropScript, sourcePath, outputPath, JSON.stringify(bbox)], { encoding: 'utf8' })
}

export async function cropFigureImageAsync(sourcePath: string, outputPath: string, bbox: Record<string, any>) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })
  const cropScript = [
    'from PIL import Image', 'import json, sys', 'src, dst, raw = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])',
    'x = int(round(float(raw.get("x", raw.get("x0", 0)))))', 'y = int(round(float(raw.get("y", raw.get("y0", 0)))))',
    'w = int(round(float(raw.get("width", raw.get("w", raw.get("x1", 0) - raw.get("x0", 0))))))', 'h = int(round(float(raw.get("height", raw.get("h", raw.get("y1", 0) - raw.get("y0", 0))))))',
    'im = Image.open(src)', 'x = max(0, min(x, im.width - 1)); y = max(0, min(y, im.height - 1))',
    'w = max(1, min(w, im.width - x)); h = max(1, min(h, im.height - y))', 'im.crop((x, y, x + w, y + h)).save(dst)',
  ].join('; ')
  await execFileAsync(pythonCommand(), ['-c', cropScript, sourcePath, outputPath, JSON.stringify(bbox)], { encoding: 'utf8' })
}

export async function splitReviewImage(sourcePath: string, topOutputPath: string, bottomOutputPath: string, splitRatio: number) {
  fs.mkdirSync(path.dirname(topOutputPath), { recursive: true })
  fs.mkdirSync(path.dirname(bottomOutputPath), { recursive: true })
  const splitScript = [
    'from PIL import Image',
    'import json, sys',
    'src, top_dst, bottom_dst, raw = sys.argv[1], sys.argv[2], sys.argv[3], json.loads(sys.argv[4])',
    'ratio = float(raw.get("splitRatio", 0.5))',
    'im = Image.open(src)',
    'y = int(round(im.height * ratio))',
    'y = max(8, min(y, im.height - 8))',
    'im.crop((0, 0, im.width, y)).save(top_dst)',
    'im.crop((0, y, im.width, im.height)).save(bottom_dst)',
    'print(json.dumps({"width": im.width, "height": im.height, "splitY": y, "topHeight": y, "bottomHeight": im.height - y}))',
  ].join('; ')
  const { stdout } = await execFileAsync(pythonCommand(), ['-c', splitScript, sourcePath, topOutputPath, bottomOutputPath, JSON.stringify({ splitRatio })], { encoding: 'utf8' })
  return JSON.parse(stdout)
}

export async function mergeReviewImages(sourcePaths: string[], outputPath: string) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const mergeScript = [
    'from PIL import Image',
    'import json, sys',
    'raw_paths, dst = json.loads(sys.argv[1]), sys.argv[2]',
    'images = [Image.open(path).convert("RGB") for path in raw_paths]',
    'width = max(im.width for im in images)',
    'height = sum(im.height for im in images)',
    'canvas = Image.new("RGB", (width, height), "white")',
    'y = 0',
    'parts = []',
    'for im, path in zip(images, raw_paths):',
    '    canvas.paste(im, (0, y))',
    '    parts.append({"path": path, "width": im.width, "height": im.height, "y": y})',
    '    y += im.height',
    'canvas.save(dst)',
    'print(json.dumps({"width": width, "height": height, "parts": parts}))',
  ].join('\n')
  const { stdout } = await execFileAsync(pythonCommand(), ['-c', mergeScript, JSON.stringify(sourcePaths), outputPath], { encoding: 'utf8' })
  return JSON.parse(stdout)
}

export function normalizedFigureId(value: unknown, index: number) {
  return String(value || `review_fig_${index + 1}`).replace(/[^\w.-]+/g, '_')
}

export function expandedReviewBBox(bbox: Record<string, any>) {
  const x = Number(bbox.x ?? bbox.x0 ?? 0)
  const y = Number(bbox.y ?? bbox.y0 ?? 0)
  const width = Number(bbox.width ?? bbox.w ?? Number(bbox.x1 ?? 0) - Number(bbox.x0 ?? 0))
  const height = Number(bbox.height ?? bbox.h ?? Number(bbox.y1 ?? 0) - Number(bbox.y0 ?? 0))
  return { x: x - 4, y, width: width + 8, height: height + 10 }
}

function rawReviewBBox(value: any): { x: number; y: number; width: number; height: number } | null {
  if (!value) return null
  if (Array.isArray(value) && value.length === 4) {
    const x0 = Number(value[0])
    const y0 = Number(value[1])
    const x1 = Number(value[2])
    const y1 = Number(value[3])
    const width = x1 - x0
    const height = y1 - y0
    return Number.isFinite(x0) && Number.isFinite(y0) && width > 0 && height > 0
      ? { x: x0, y: y0, width, height }
      : null
  }
  if (typeof value !== 'object') return null
  const x = Number(value.x ?? value.x0)
  const y = Number(value.y ?? value.y0)
  const width = Number(value.width ?? value.w ?? Number(value.x1 ?? 0) - Number(value.x0 ?? 0))
  const height = Number(value.height ?? value.h ?? Number(value.y1 ?? 0) - Number(value.y0 ?? 0))
  return Number.isFinite(x) && Number.isFinite(y) && width > 0 && height > 0
    ? { x, y, width, height }
    : null
}

function isNormalizedReviewBBox(bbox: { x: number; y: number; width: number; height: number }) {
  return bbox.x >= 0 && bbox.y >= 0 && bbox.width > 0 && bbox.height > 0 &&
    bbox.x <= 1 && bbox.y <= 1 && bbox.width <= 1 && bbox.height <= 1
}

function reviewSegmentBBox(segment: Record<string, any>, fallbackBBox?: { x: number; y: number; width: number; height: number }) {
  const explicit = rawReviewBBox(segment.bbox)
  if (explicit) return explicit
  const flat = rawReviewBBox(segment)
  if (!flat) return null
  return isNormalizedReviewBBox(flat) && fallbackBBox ? fallbackBBox : flat
}

type ReviewRow = {
  result_id: string
  run_id: string
  question_label: string
  page_start: number
  page_end: number
  page_image_path: string
  auto_image_path: string
  bbox_json: string
  segments_json: string
  text_regions_json: string
  figures_json: string
  glm_figure_bindings_json: string
  review_status: string
  note: string
  created_at: string
  updated_at: string
}

export function figurePixelBBoxForSegments(sourceSegments: Array<Record<string, any>>, fallbackPage: number, figure: Record<string, any>, imagePath: string) {
  if (!fs.existsSync(imagePath)) return figure.bbox || {}
  const segments = sourceSegments
    .map((segment) => {
      const rawBBox = reviewSegmentBBox(segment)
      const bbox = rawBBox ? expandedReviewBBox(rawBBox) : null
      return bbox && bbox.width > 0 && bbox.height > 0
        ? { pageNumber: Number(segment.page_number ?? segment.pageNumber ?? segment.page ?? fallbackPage), bbox }
        : null
    })
    .filter(Boolean) as Array<{ pageNumber: number; bbox: { x: number; y: number; width: number; height: number } }>
  if (!segments.length || !figure.bbox) return figure.bbox || {}

  const totalHeight = segments.reduce((sum, segment) => sum + segment.bbox.height, 0)
  const maxWidth = Math.max(...segments.map((segment) => segment.bbox.width), 1)
  let yOffset = 0
  const offsets = segments.map((segment) => {
    const current = { ...segment, yOffset }
    yOffset += segment.bbox.height
    return current
  })
  const figureBBox = figure.bbox
  const pageNumber = Number(figure.page_number ?? figure.pageNumber ?? fallbackPage)
  const segment = offsets.find((entry) => {
    const left = entry.bbox
    const right = figureBBox
    return entry.pageNumber === pageNumber &&
      !(left.x + left.width <= right.x || right.x + right.width <= left.x || left.y + left.height <= right.y || right.y + right.height <= left.y)
  })
  if (!segment) return figure.bbox || {}

  const size = imageDimensions(imagePath)
  return {
    x: ((Number(figureBBox.x || 0) - segment.bbox.x) / maxWidth) * size.width,
    y: ((Number(figureBBox.y || 0) - segment.bbox.y + segment.yOffset) / Math.max(totalHeight, 1)) * size.height,
    width: (Number(figureBBox.width || 0) / maxWidth) * size.width,
    height: (Number(figureBBox.height || 0) / Math.max(totalHeight, 1)) * size.height,
  }
}

export function reviewFigurePixelBBox(reviewRow: ReviewRow | undefined, figure: Record<string, any>, imagePath: string) {
  if (!reviewRow) return figure.bbox || {}
  const rawSegments = parseJson<Array<Record<string, any>>>(reviewRow.segments_json || '[]', [])
  const fallbackBBox = rawReviewBBox(parseJson<any>(reviewRow.bbox_json || '{}', {})) || undefined
  const sourceSegments = rawSegments.length
    ? rawSegments.map((segment) => ({ ...segment, bbox: reviewSegmentBBox(segment, fallbackBBox) || segment.bbox }))
    : [{ page_number: reviewRow.page_start, bbox: fallbackBBox }]
  return figurePixelBBoxForSegments(sourceSegments, reviewRow.page_start, figure, imagePath)
}

export function reviewFigureDefaultUsage(reviewRow: ReviewRow | undefined, figure: Record<string, any>) {
  const boundary = answerOrAnalysisBoundary(reviewRow)
  const figureKey = reviewFigureReadingKey(reviewRow, figure)
  if (!boundary || !figureKey) return 'stem'
  if (figureKey.segmentIndex > boundary.segmentIndex) return 'analysis'
  if (figureKey.segmentIndex < boundary.segmentIndex) return 'stem'
  return figureKey.y >= boundary.y ? 'analysis' : 'stem'
}

export function answerOrAnalysisBoundary(reviewRow: ReviewRow | undefined) {
  if (!reviewRow) return null
  const regions = parseJson<Array<Record<string, any>>>(reviewRow.text_regions_json || '[]', [])
  const candidates = regions
    .filter((region) => region.kind === 'answer' || region.kind === 'analysis')
    .flatMap((region) => Array.isArray(region.segments) ? region.segments.slice(0, 1) : [])
    .map((segment) => reviewSegmentReadingKey(reviewRow, segment, false))
    .filter(Boolean) as Array<{ segmentIndex: number; y: number }>
  if (!candidates.length) return null
  candidates.sort((left, right) => left.segmentIndex - right.segmentIndex || left.y - right.y)
  return candidates[0]
}

export function reviewFigureReadingKey(reviewRow: ReviewRow | undefined, figure: Record<string, any>) {
  if (!reviewRow || !figure?.bbox) return null
  return reviewSegmentReadingKey(reviewRow, {
    page_number: figure.page_number ?? figure.pageNumber,
    bbox: figure.bbox,
  }, true)
}

export function reviewSegmentReadingKey(reviewRow: ReviewRow, segment: Record<string, any>, useCenter: boolean) {
  const bbox = segment.bbox && typeof segment.bbox === 'object' ? segment.bbox : {}
  const pageNumber = Number(segment.page_number ?? segment.pageNumber ?? 0)
  let y = Number(bbox.y ?? bbox.y0 ?? 0)
  if (useCenter) {
    y += Number(bbox.height ?? bbox.h ?? Number(bbox.y1 ?? 0) - Number(bbox.y0 ?? 0)) / 2
  }
  if (!Number.isFinite(pageNumber) || !Number.isFinite(y)) return null

  const rawSegments = parseJson<Array<Record<string, any>>>(reviewRow.segments_json || '[]', [])
  const fallbackBBox = parseJson<Record<string, any>>(reviewRow.bbox_json || '{}', {})
  const sourceSegments = rawSegments.length ? rawSegments : [{ page_number: reviewRow.page_start, bbox: fallbackBBox }]
  const indexes = sourceSegments
    .map((sourceSegment, index) => ({ sourceSegment, index }))
    .filter(({ sourceSegment }) => Number(sourceSegment.page_number ?? sourceSegment.pageNumber ?? reviewRow.page_start) === pageNumber)
  if (!indexes.length) return null

  const containing = indexes.find(({ sourceSegment }) => {
    const sourceBBox = sourceSegment.bbox && typeof sourceSegment.bbox === 'object' ? sourceSegment.bbox : {}
    const top = Number(sourceBBox.y ?? sourceBBox.y0 ?? 0)
    const height = Number(sourceBBox.height ?? sourceBBox.h ?? Number(sourceBBox.y1 ?? 0) - Number(sourceBBox.y0 ?? 0))
    return y >= top - 2 && y <= top + height + 2
  })
  return { segmentIndex: (containing || indexes[0]).index, y }
}

export function loadCutResultRecord(runId: string, resultId: string): Record<string, any> | null {
  const run = getRun(runId)
  if (!run) return null
  const cutId = String(resultId || '').match(/CUT_\d+/)?.[0] || resultId.split('_').pop() || ''
  const cutPath = path.join(resolveStoragePath(run.runDir), 'output', 'cut_results.json')
  if (!fs.existsSync(cutPath)) return null
  const payload = parseJson<{ results?: Array<Record<string, any>> }>(fs.readFileSync(cutPath, 'utf8'), { results: [] })
  return payload.results?.find((item) => String(item.id || '') === cutId || String(item.question_no || '') === cutId) || null
}

export function loadSolutionCutResultRecord(runId: string, resultId: string): Record<string, any> | null {
  const run = getRun(runId)
  if (!run) return null
  const cutId = String(resultId || '').match(/SOL_\d+/)?.[0] || resultId.split('_').pop() || ''
  const cutPath = path.join(resolveStoragePath(run.runDir), 'output', 'cut_results.json')
  if (!fs.existsSync(cutPath)) return null
  const payload = parseJson<{ solution_results?: Array<Record<string, any>> }>(fs.readFileSync(cutPath, 'utf8'), { solution_results: [] })
  return payload.solution_results?.find((item) => String(item.id || '') === cutId || String(item.question_no || '') === cutId) || null
}

function normalizedRectangle(value: Record<string, any>, sourceIsPdfPoints = false) {
  const x = Number(value.x ?? value.x0 ?? 0)
  const y = Number(value.y ?? value.y0 ?? 0)
  const width = Number(value.width ?? value.w ?? Number(value.x1 ?? 0) - x)
  const height = Number(value.height ?? value.h ?? Number(value.y1 ?? 0) - y)
  return sourceIsPdfPoints
    ? { x: x / 595.3, y: y / 841.9, width: width / 595.3, height: height / 841.9 }
    : { x, y, width, height }
}

function rectanglesOverlap(left: ReturnType<typeof normalizedRectangle>, right: ReturnType<typeof normalizedRectangle>) {
  return left.x < right.x + right.width && right.x < left.x + left.width &&
    left.y < right.y + right.height && right.y < left.y + left.height
}

function isFormulaSuspectFigure(figure: Record<string, any>) {
  return Boolean(figure.formula_suspect ?? figure.formulaSuspect)
}

function isManualFigure(figure: Record<string, any>) {
  return String(figure.origin || '') === 'manual'
}

function glmFigureMatchesConfirmedReviewFigure(reviewRow: ReviewRow, figure: Record<string, any>) {
  const figureId = String(figure.id || '')
  if (!figureId) return false
  const binding = parseJson<Record<string, any>>(reviewRow.glm_figure_bindings_json || '{}', {})
  const matchedReviewIds = new Set(
    (Array.isArray(binding.bindings) ? binding.bindings : [])
      .filter((entry) => String(entry?.glm_figure_id || '') === figureId && String(entry?.status || '') === 'matched')
      .map((entry) => String(entry.review_figure_id || ''))
      .filter(Boolean),
  )
  if (!matchedReviewIds.size) return false
  const reviewFigures = parseJson<Array<Record<string, any>>>(reviewRow.figures_json || '[]', [])
  return reviewFigures.some((reviewFigure) =>
    matchedReviewIds.has(String(reviewFigure.id || '')) &&
    (!isFormulaSuspectFigure(reviewFigure) || isManualFigure(reviewFigure)),
  )
}

function glmFigureIsBoundToReviewFigure(reviewRow: ReviewRow, figure: Record<string, any>) {
  const figureId = String(figure.id || '')
  if (!figureId) return false
  const binding = parseJson<Record<string, any>>(reviewRow.glm_figure_bindings_json || '{}', {})
  return (Array.isArray(binding.bindings) ? binding.bindings : []).some((entry) =>
    String(entry?.glm_figure_id || '') === figureId && String(entry?.status || '') === 'matched',
  )
}

// GLM reports every image found on each parsed page.  A page can contain
// several questions, so page membership alone must not become figure binding.
function figureBelongsToReview(reviewRow: ReviewRow | undefined, figure: Record<string, any>) {
  if (isFormulaSuspectFigure(figure) && !isManualFigure(figure)) return false
  if (String(figure.origin || '') !== 'glm_ocr') return true
  if (!reviewRow) return false
  // A GLM block matched to a reviewer crop is evidence for that crop, not a
  // second diagram. Keep the binding in diagnostics but render only the
  // editable reviewer-owned image.
  if (glmFigureIsBoundToReviewFigure(reviewRow, figure)) return false
  const figureBox = normalizedRectangle(figure.bbox || {})
  if (figureBox.width <= 0 || figureBox.height <= 0) return false
  const figurePage = Number(figure.pageNumber ?? figure.page_number ?? 0)
  const segments = parseJson<Array<Record<string, any>>>(reviewRow.segments_json || '[]', [])
  const candidates = segments.length
    ? segments
    : [{ page_number: reviewRow.page_start, bbox: parseJson<Record<string, any>>(reviewRow.bbox_json || '{}', {}) }]
  const overlapsReviewSegment = candidates.some((segment) =>
    Number(segment.page_number ?? segment.pageNumber ?? reviewRow.page_start) === figurePage &&
    rectanglesOverlap(figureBox, normalizedRectangle(segment.bbox || {}, true)),
  )
  return overlapsReviewSegment && glmFigureMatchesConfirmedReviewFigure(reviewRow, figure)
}

export function sliceImagePathForOcrResult(result: Record<string, any>, runId: string) {
  const reviewRow = db.prepare('SELECT * FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?')
    .get(runId, String(result.id || '')) as ReviewRow | undefined
  return stripAssetPrefix(String(result.image_path || reviewRow?.auto_image_path || reviewRow?.page_image_path || ''))
}

function sourceImagePathForOcrResult(result: Record<string, any>, reviewRow?: ReviewRow) {
  const isSolution = String(result.ocr_record_kind || '') === 'solution'
  return stripAssetPrefix(String(
    isSolution
      ? (result.solution_image_path || result.image_path || result.reviewed_image_path || result.auto_image_path)
      : (result.problem_image_path || result.image_path || result.reviewed_image_path || result.auto_image_path) ||
    reviewRow?.auto_image_path ||
    reviewRow?.page_image_path ||
    '',
  ))
}

function providerFigureWithExistingAsset(figure: Record<string, any>, figureId: string) {
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

function sourceFiguresForImportedOcrResult(result: Record<string, any>, reviewRow?: ReviewRow) {
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

type InlineImageField = 'stem' | 'answer' | 'analysis'

const inlineImageFields: Array<{ field: InlineImageField; resultKey: string; label: string }> = [
  { field: 'stem', resultKey: 'problem_text', label: '题干' },
  { field: 'answer', resultKey: 'answer', label: '答案' },
  { field: 'analysis', resultKey: 'analysis', label: '解析' },
]

function inlineImageReferenceCount(value: string) {
  INLINE_IMAGE_REFERENCE_RE.lastIndex = 0
  INLINE_IMAGE_PLACEHOLDER_RE.lastIndex = 0
  INLINE_BOUND_FIGURE_RE.lastIndex = 0
  return Array.from(value.matchAll(INLINE_IMAGE_REFERENCE_RE)).length + Array.from(value.matchAll(INLINE_IMAGE_PLACEHOLDER_RE)).length + Array.from(value.matchAll(INLINE_BOUND_FIGURE_RE)).length
}

function cleanOcrPresentationHtml(value: string, field?: InlineImageField) {
  let figureCaptionIndex = 0
  const captionPlaceholder = () => {
    figureCaptionIndex += 1
    return field ? `\n\n<!-- OCR_IMAGE_REFERENCE:${field}:${figureCaptionIndex} -->\n\n` : '\n'
  }
  return String(value || '')
    // `figureText` is OCR's description of text inside a diagram, not question
    // prose. It is not meaningful without the image and otherwise leaks into
    // the rendered stem as a faux tag.
    .replace(/<!--\s*figureText:[\s\S]*?-->/gi, '\n')
    // Doc2X commonly emits a plain "图 1" caption immediately after the image
    // marker.  It labels that already-referenced image; treating it as a new
    // figure creates a false 2-references/1-image mismatch.
    .replace(/(<!--\s*DOC2X_FIGURE:[^>\s]+\s*-->)\s*(?:图|figure)\s*\d+\s*/gi, '$1\n')
    .replace(/(<img\b[^>]*\bsrc\s*=\s*['"][^'"]+['"][^>]*>)\s*(?:图|figure)\s*\d+\s*/gi, '$1\n')
    .replace(/(!\[[^\]]*\]\([^)]+\))\s*(?:图|figure)\s*\d+\s*/gi, '$1\n')
    // Some scanned multiple-choice pages repeat a bare option letter after
    // the corresponding image. The visible `A.` already labels the option.
    .replace(/(<!--\s*DOC2X_FIGURE:[^>\s]+\s*-->)\s*[A-D]\s*(?=\n|$)/gi, '$1\n')
    // GLM sometimes represents a diagram only as a centered caption, such as
    // `<div align="center">图1</div>`. Preserve it as an image reference so
    // reviewed crops can be inserted at the intended reading position.
    .replace(/<div\b[^>]*>\s*(?:图|figure)\s*\d+\s*<\/div>/gi, captionPlaceholder)
    .replace(/^\s*(?:图|figure)\s*\d+\s*$/gim, captionPlaceholder)
    .replace(/<div\b[^>]*>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|center)>/gi, '\n')
    .replace(/<(?:p|center)\b[^>]*>/gi, '\n')
    .replace(INLINE_IMAGE_WARNING_RE, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Replace remote OCR image tags with local cut figures, but only when the
 * number of references and locally cut figures agrees for every content area.
 * A mismatch is deliberately left unresolved and returned as a review issue;
 * falling back to page-wide provider images is what previously caused figures
 * from neighbouring questions to be bound to the current question.
 */
export function bindInlineImageReferences(result: Record<string, any>, runId: string, options: { localFigures?: Array<Record<string, any>> } = {}) {
  const reviewRow = db.prepare('SELECT * FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?')
    .get(runId, String(result.id || '')) as ReviewRow | undefined
  const reviewFigures = reviewRow ? parseJson<Array<Record<string, any>>>(reviewRow.figures_json || '[]', []) : []
  const references = inlineImageFields.map((entry) => ({
    ...entry,
    value: cleanOcrPresentationHtml(String(result[entry.resultKey] || ''), entry.field),
    count: inlineImageReferenceCount(cleanOcrPresentationHtml(String(result[entry.resultKey] || ''), entry.field)),
  }))
  const totalReferences = references.reduce((sum, entry) => sum + entry.count, 0)

  // Force the existing review/cut figures to be the only source for inline
  // binding.  This produces stable local paths through figuresForImported...
  const localFigures = options.localFigures?.length
    ? options.localFigures
    : figuresForImportedOcrResult({ ...result, figures: reviewFigures }, runId)

  if (!totalReferences) {
    // OCR occasionally keeps "如图 2 所示" in the prose but drops the image
    // marker entirely. With exactly one reviewer-selected stem figure, the
    // intended position is unambiguous enough to restore automatically.
    const stemFigures = localFigures.filter((figure) => {
      const usage = String(figure.usage || figure.category || 'stem')
      return usage === 'stem' || usage === 'options'
    })
    const figureReference = /如图\s*\d+\s*所示/
    const stem = String(result.problem_text || '')
    if (stemFigures.length === 1 && figureReference.test(stem)) {
      const figure = stemFigures[0]
      const boundFigure = {
        ...figure,
        usage: 'stem',
        category: 'stem',
        blockId: 'cut_inline_stem_1',
        ocrBinding: figure.ocrBinding?.enabled
          ? { ...figure.ocrBinding, status: 'bound' }
          : figure.ocrBinding,
      }
      if (figure.ocrBinding?.enabled) figure.ocrBinding = { ...figure.ocrBinding, status: 'bound' }
      const figures = localFigures.map((candidate) => String(candidate.id || '') === String(figure.id || '') ? boundFigure : candidate)
      return {
        stem: cleanOcrPresentationHtml(stem, 'stem').replace(figureReference, `<!-- DOC2X_FIGURE:${boundFigure.blockId} -->\n\n$&`),
        answer: String(result.answer || ''),
        analysis: String(result.analysis || ''),
        figures,
        issue: null,
      }
    }
    return null
  }

  const byUsage = new Map<InlineImageField, Array<Record<string, any>>>()
  for (const field of inlineImageFields) byUsage.set(field.field, [])
  for (const figure of localFigures) {
    const rawUsage = String(figure.usage || 'stem')
    const usage: InlineImageField = rawUsage === 'analysis' ? 'analysis' : rawUsage === 'answer' ? 'answer' : 'stem'
    byUsage.get(usage)?.push(figure)
  }

  const issues: Array<{ field: InlineImageField; expected: number; available: number; label: string }> = []
  const selected: Array<Record<string, any>> = []
  const content: Record<InlineImageField, string> = { stem: String(result.problem_text || ''), answer: String(result.answer || ''), analysis: String(result.analysis || '') }
  let usedNativeDoc2xFigures = false
  for (const entry of references) {
    if (!entry.count) continue
    const allCandidates = byUsage.get(entry.field) || []
    const hasNativeReference = /<!--\s*DOC2X_FIGURE:[^>\s]+\s*-->/i.test(entry.value)
    const nativeCandidates = hasNativeReference
      ? allCandidates.filter((figure) => String(figure.origin || '') === 'doc2x_v3')
      : []
    // A Doc2X marker names a provider block exactly.  Prefer that provider's
    // downloaded figure over an overlapping manual crop of the same option.
    const candidates = nativeCandidates.length === entry.count ? nativeCandidates : allCandidates
    if (candidates.length !== entry.count) {
      issues.push({ field: entry.field, expected: entry.count, available: candidates.length, label: entry.label })
      let missingIndex = 0
      const referencePattern = new RegExp(`${INLINE_IMAGE_REFERENCE_RE.source}|${INLINE_IMAGE_PLACEHOLDER_RE.source}|${INLINE_BOUND_FIGURE_RE.source}`, 'gi')
      content[entry.field] = entry.value.replace(referencePattern, () => {
        missingIndex += 1
        return `\n\n<!-- OCR_IMAGE_REFERENCE:${entry.field}:${missingIndex} -->\n> ⚠️ 缺少可绑定的${entry.label}图（引用 ${missingIndex}/${entry.count}）\n\n`
      })
      continue
    }
    let index = 0
    const referencePattern = new RegExp(`${INLINE_IMAGE_REFERENCE_RE.source}|${INLINE_IMAGE_PLACEHOLDER_RE.source}|${INLINE_BOUND_FIGURE_RE.source}`, 'gi')
    const isFourImageChoice = entry.field === 'stem' && entry.count === 4
    const sourceValue = isFourImageChoice
      ? entry.value.replace(/^\s*[A-D][.．、]\s*$/gm, '')
      : entry.value
    content[entry.field] = sourceValue.replace(referencePattern, () => {
      const optionLabel = isFourImageChoice ? String.fromCharCode(65 + index) : ''
      const candidate = candidates[index]
      // `localFigures` is also inspected by the importer for unplaced manual
      // attachments immediately after this function returns. Keep that source
      // object in sync with the copied figure written to the question.
      if (candidate.ocrBinding?.enabled) {
        candidate.ocrBinding = { ...candidate.ocrBinding, status: 'bound' }
      }
      const figure = {
        ...candidate,
        usage: isFourImageChoice ? 'options' : entry.field,
        category: isFourImageChoice ? 'options' : entry.field,
        optionLabel,
        blockId: `cut_inline_${entry.field}_${index + 1}`,
        ocrBinding: candidate.ocrBinding,
      }
      selected.push(figure)
      index += 1
      if (nativeCandidates.length === entry.count) usedNativeDoc2xFigures = true
      return isFourImageChoice
        ? `\n\n${optionLabel}.\n<!-- DOC2X_FIGURE:${figure.blockId} -->\n\n`
        : `\n\n<!-- DOC2X_FIGURE:${figure.blockId} -->\n\n`
    })
  }
  if (usedNativeDoc2xFigures) {
    for (const figure of localFigures) {
      if (String(figure.origin || '') === 'doc2x_v3' || !figure.ocrBinding?.enabled || figure.ocrBinding?.status !== 'unplaced') continue
      const usage = String(figure.usage || figure.category || '')
      if (usage === 'options' || usage === 'stem') {
        figure.ocrBinding = { ...figure.ocrBinding, status: 'ignored' }
      }
    }
  }
  const selectedById = new Map(selected.map((figure) => [String(figure.id || ''), figure]))
  const boundFigures = localFigures.map((figure) => selectedById.get(String(figure.id || '')) || figure)
  return {
    ...content,
    // Keep unrelated reviewed figures too (for example a stem diagram while
    // analysis captions are being bound). Only the matched figures receive an
    // inline block id.
    figures: issues.length ? localFigures : boundFigures,
    issue: issues.length ? {
      field: 'figures',
      code: 'inline_image_reference_mismatch',
      message: issues.map((entry) => `${entry.label}图片引用 ${entry.expected} 个，但切分题图 ${entry.available} 个`).join('；'),
      snippet: issues.map((entry) => `${entry.label} ${entry.available}/${entry.expected}`).join('，'),
    } : null,
  }
}

export function bindExplicitAttachments(
  result: Record<string, any>,
  localFigures: Array<Record<string, any>>
) {
  const fields: Array<'problem_text' | 'answer' | 'analysis'> = ['problem_text', 'answer', 'analysis']

  for (const figure of localFigures) {
    if (!figure.ocrBinding?.enabled || !figure.ocrBinding?.attachmentId) {
      continue
    }
    const attachmentId = String(figure.ocrBinding.attachmentId)
    // Match the literal protocol token emitted by OCR, e.g. {{figure:F1}}.
    // Attachment IDs are generated internally today, but escaping keeps this
    // safe if a future provider uses a different identifier format.
    const escapedAttachmentId = attachmentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`\\{\\{\\s*figure\\s*:\\s*${escapedAttachmentId}\\s*\\}\\}`, 'gi')

    let found = false
    for (const field of fields) {
      const text = String(result[field] || '')
      if (pattern.test(text)) {
        found = true
        const blockId = `cut_inline_${figure.usage || 'stem'}_${attachmentId}`
        figure.blockId = blockId
        figure.ocrBinding = {
          ...figure.ocrBinding,
          status: 'bound'
        }
        result[field] = text.replace(pattern, `\n\n<!-- DOC2X_FIGURE:${blockId} -->\n\n`)
      }
    }

    if (!found) {
      // 如果它之前被标为 bound 且并没有被匹配（比如文本中已被用户手动挪去，且没找到当前匹配），
      // 我们在导入时将其设定为 unplaced
      if (figure.ocrBinding.status !== 'ignored') {
        figure.ocrBinding = {
          ...figure.ocrBinding,
          status: 'unplaced'
        }
      }
    }
  }
}

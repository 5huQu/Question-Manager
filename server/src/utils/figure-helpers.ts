import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseJson } from './json.js'
import { resolveStoragePath, stripAssetPrefix } from './paths.js'
import { db } from '../db/connection.js'
import { getRun } from '../db/runs.js'
import { pythonCommand } from '../services/settings/python.js'

const INLINE_IMAGE_REFERENCE_RE = /<img\b[^>]*\bsrc\s*=\s*['"][^'"]+['"][^>]*>/gi
const INLINE_IMAGE_PLACEHOLDER_RE = /<!--\s*OCR_IMAGE_REFERENCE:(stem|answer|analysis):\d+\s*-->/gi
const INLINE_BOUND_FIGURE_RE = /<!--\s*DOC2X_FIGURE:[^>\s]+\s*-->/gi
const INLINE_IMAGE_WARNING_RE = /\n?>\s*⚠️\s*缺少可绑定的(?:题干|答案|解析)图（引用\s*\d+\/\d+）\s*\n?/g

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

export function splitReviewImage(sourcePath: string, topOutputPath: string, bottomOutputPath: string, splitRatio: number) {
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
  return JSON.parse(execFileSync(pythonCommand(), ['-c', splitScript, sourcePath, topOutputPath, bottomOutputPath, JSON.stringify({ splitRatio })], { encoding: 'utf8' }))
}

export function mergeReviewImages(sourcePaths: string[], outputPath: string) {
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
  return JSON.parse(execFileSync(pythonCommand(), ['-c', mergeScript, JSON.stringify(sourcePaths), outputPath], { encoding: 'utf8' }))
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
  review_status: string
  note: string
  created_at: string
  updated_at: string
}

export function reviewFigurePixelBBox(reviewRow: ReviewRow | undefined, figure: Record<string, any>, imagePath: string) {
  if (!reviewRow || !fs.existsSync(imagePath)) return figure.bbox || {}
  const rawSegments = parseJson<Array<Record<string, any>>>(reviewRow.segments_json || '[]', [])
  const fallbackBBox = parseJson<Record<string, any>>(reviewRow.bbox_json || '{}', {})
  const sourceSegments = rawSegments.length ? rawSegments : [{ page_number: reviewRow.page_start, bbox: fallbackBBox }]
  const segments = sourceSegments
    .map((segment) => {
      const bbox = segment.bbox && typeof segment.bbox === 'object' ? expandedReviewBBox(segment.bbox) : null
      return bbox && bbox.width > 0 && bbox.height > 0
        ? { pageNumber: Number(segment.page_number ?? segment.pageNumber ?? reviewRow.page_start), bbox }
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
  const pageNumber = Number(figure.page_number ?? figure.pageNumber ?? reviewRow.page_start)
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

// GLM reports every image found on each parsed page.  A page can contain
// several questions, so page membership alone must not become figure binding.
function figureBelongsToReview(reviewRow: ReviewRow | undefined, figure: Record<string, any>) {
  if (String(figure.origin || '') !== 'glm_ocr' || !reviewRow) return true
  const figureBox = normalizedRectangle(figure.bbox || {})
  if (figureBox.width <= 0 || figureBox.height <= 0) return false
  const figurePage = Number(figure.pageNumber ?? figure.page_number ?? 0)
  const segments = parseJson<Array<Record<string, any>>>(reviewRow.segments_json || '[]', [])
  const candidates = segments.length
    ? segments
    : [{ page_number: reviewRow.page_start, bbox: parseJson<Record<string, any>>(reviewRow.bbox_json || '{}', {}) }]
  return candidates.some((segment) =>
    Number(segment.page_number ?? segment.pageNumber ?? reviewRow.page_start) === figurePage &&
    rectanglesOverlap(figureBox, normalizedRectangle(segment.bbox || {}, true)),
  )
}

export function sliceImagePathForOcrResult(result: Record<string, any>, runId: string) {
  const reviewRow = db.prepare('SELECT * FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?')
    .get(runId, String(result.id || '')) as ReviewRow | undefined
  return stripAssetPrefix(String(result.image_path || reviewRow?.auto_image_path || reviewRow?.page_image_path || ''))
}

/**
 * Build the figure list for an imported OCR result, cropping review images
 * as needed.  Used by question-bank import and OCR re-run pipelines.
 */
export function figuresForImportedOcrResult(result: Record<string, any>, runId: string) {
  const reviewRow = db.prepare('SELECT * FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?')
    .get(runId, String(result.id || '')) as ReviewRow | undefined
  const reviewFigures = reviewRow ? parseJson<Array<Record<string, any>>>(reviewRow.figures_json || '[]', []) : []
  const sourceFigures = (Array.isArray(result.figures) && result.figures.length ? result.figures : reviewFigures)
    .filter((figure) => figureBelongsToReview(reviewRow, figure))
  const sourceRel = stripAssetPrefix(String(result.image_path || reviewRow?.auto_image_path || ''))
  const sourceAbs = sourceRel ? resolveStoragePath(sourceRel) : ''
  return sourceFigures.map((figure, index) => {
    const figureId = normalizedFigureId(figure.id, index)
    const providerAssetOrigin = String(figure.origin || '')
    const providerAssetPath = providerAssetOrigin === 'doc2x_v3' || providerAssetOrigin === 'glm_ocr' ? stripAssetPrefix(String(figure.path || '')) : ''
    if (providerAssetPath && fs.existsSync(resolveStoragePath(providerAssetPath))) {
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
    const outputRel = path.join('data', 'question_figures', String(result.id), `${figureId}.png`)
    const outputAbs = resolveStoragePath(outputRel)
    const sourceBBox = figure.bbox || {}
    const pixelBBox = sourceAbs && fs.existsSync(sourceAbs)
      ? reviewFigurePixelBBox(reviewRow, figure, sourceAbs)
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

function cleanOcrPresentationHtml(value: string) {
  return String(value || '')
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
    value: cleanOcrPresentationHtml(String(result[entry.resultKey] || '')),
    count: inlineImageReferenceCount(cleanOcrPresentationHtml(String(result[entry.resultKey] || ''))),
  }))
  const totalReferences = references.reduce((sum, entry) => sum + entry.count, 0)
  if (!totalReferences) return null

  // Force the existing review/cut figures to be the only source for inline
  // binding.  This produces stable local paths through figuresForImported...
  const localFigures = options.localFigures?.length
    ? options.localFigures
    : figuresForImportedOcrResult({ ...result, figures: reviewFigures }, runId)
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
  for (const entry of references) {
    if (!entry.count) continue
    const candidates = byUsage.get(entry.field) || []
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
      const figure = {
        ...candidates[index],
        usage: isFourImageChoice ? 'options' : entry.field,
        category: isFourImageChoice ? 'options' : entry.field,
        optionLabel,
        blockId: `cut_inline_${entry.field}_${index + 1}`,
      }
      selected.push(figure)
      index += 1
      return isFourImageChoice
        ? `\n\n${optionLabel}.\n<!-- DOC2X_FIGURE:${figure.blockId} -->\n\n`
        : `\n\n<!-- DOC2X_FIGURE:${figure.blockId} -->\n\n`
    })
  }
  return {
    ...content,
    figures: selected,
    issue: issues.length ? {
      field: 'figures',
      code: 'inline_image_reference_mismatch',
      message: issues.map((entry) => `${entry.label}图片引用 ${entry.expected} 个，但切分题图 ${entry.available} 个`).join('；'),
      snippet: issues.map((entry) => `${entry.label} ${entry.available}/${entry.expected}`).join('，'),
    } : null,
  }
}

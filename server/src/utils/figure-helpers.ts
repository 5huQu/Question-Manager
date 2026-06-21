import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseJson } from './json.js'
import { resolveStoragePath, stripAssetPrefix } from './paths.js'
import { getRun } from '../db/runs.js'
import { pythonCommand } from '../services/settings/python.js'

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

/**
 * Build the figure list for an imported OCR result, cropping review images
 * as needed.  Used by question-bank import and OCR re-run pipelines.
 */
export function figuresForImportedOcrResult(result: Record<string, any>, runId: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { db } = require('../db/connection.js')
  const reviewRow = db.prepare('SELECT * FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?')
    .get(runId, String(result.id || '')) as ReviewRow | undefined
  const reviewFigures = reviewRow ? parseJson<Array<Record<string, any>>>(reviewRow.figures_json || '[]', []) : []
  const sourceFigures = Array.isArray(result.figures) && result.figures.length ? result.figures : reviewFigures
  const sourceRel = stripAssetPrefix(String(result.image_path || reviewRow?.auto_image_path || ''))
  const sourceAbs = sourceRel ? resolveStoragePath(sourceRel) : ''
  return sourceFigures.map((figure, index) => {
    const figureId = normalizedFigureId(figure.id, index)
    const doc2xAssetPath = String(figure.origin || '') === 'doc2x_v3' ? stripAssetPrefix(String(figure.path || '')) : ''
    if (doc2xAssetPath && fs.existsSync(resolveStoragePath(doc2xAssetPath))) {
      const usage = String(figure.usage || figure.category || 'stem')
      return {
        ...figure,
        id: figureId,
        origin: 'doc2x_v3',
        usage,
        category: String(figure.category || figure.usage || usage),
        pageNumber: Number(figure.pageNumber ?? figure.page_number ?? 1),
        path: doc2xAssetPath,
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

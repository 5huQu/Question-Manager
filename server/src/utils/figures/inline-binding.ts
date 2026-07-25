import { parseJson } from '../json.js'
import { db } from '../../db/connection.js'
import type { ReviewRow } from './review-bbox.js'
import { figuresForImportedOcrResult } from './imported-ocr-figures.js'

const INLINE_IMAGE_REFERENCE_RE = /<img\b[^>]*\bsrc\s*=\s*['"][^'"]+['"][^>]*>|!\[[^\]]*\]\([^)]+\)/gi
const INLINE_IMAGE_PLACEHOLDER_RE = /<!--\s*OCR_IMAGE_REFERENCE:(stem|answer|analysis):\d+\s*-->/gi
const INLINE_BOUND_FIGURE_RE = /<!--\s*DOC2X_FIGURE:[^>\s]+\s*-->/gi
const INLINE_IMAGE_WARNING_RE = /\n?>\s*⚠️\s*缺少可绑定的(?:题干|答案|解析)图（引用\s*\d+\/\d+）\s*\n?/g

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

function inlineBoundFigureIds(value: string) {
  INLINE_BOUND_FIGURE_RE.lastIndex = 0
  return Array.from(String(value || '').matchAll(INLINE_BOUND_FIGURE_RE), (match) => {
    const idMatch = match[0].match(/DOC2X_FIGURE:([^>\s]+)/i)
    return idMatch?.[1] || ''
  }).filter(Boolean)
}

function figureMatchesId(figure: Record<string, any>, id: string) {
  return [figure.id, figure.blockId, figure.sourceBlockId]
    .filter(Boolean)
    .some((value) => String(value) === String(id))
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
export function bindInlineImageReferences(
  result: Record<string, any>,
  runId: string,
  options: { localFigures?: Array<Record<string, any>>, fields?: InlineImageField[] } = {},
) {
  const reviewRow = db.prepare('SELECT * FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?')
    .get(runId, String(result.id || '')) as ReviewRow | undefined
  const reviewFigures = reviewRow ? parseJson<Array<Record<string, any>>>(reviewRow.figures_json || '[]', []) : []
  const fieldsToBind = options.fields?.length
    ? inlineImageFields.filter((entry) => options.fields?.includes(entry.field))
    : inlineImageFields
  const references = fieldsToBind.map((entry) => ({
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
    const allCandidates = entry.field === 'answer'
      ? [...(byUsage.get('answer') || []), ...(byUsage.get('analysis') || [])]
      : byUsage.get(entry.field) || []
    const referenceIds = inlineBoundFigureIds(entry.value)
    const directCandidates = referenceIds.map((id) => allCandidates.find((figure) => figureMatchesId(figure, id))).filter(Boolean) as Array<Record<string, any>>
    const hasNativeReference = /<!--\s*DOC2X_FIGURE:[^>\s]+\s*-->/i.test(entry.value)
    const nativeCandidates = hasNativeReference
      ? allCandidates.filter((figure) => String(figure.origin || '') === 'doc2x_v3')
      : []
    // A Doc2X marker names a provider block exactly.  Prefer that provider's
    // downloaded figure over an overlapping manual crop of the same option.
    const candidates = directCandidates.length === entry.count
      ? directCandidates
      : nativeCandidates.length === entry.count
        ? nativeCandidates
        : allCandidates
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

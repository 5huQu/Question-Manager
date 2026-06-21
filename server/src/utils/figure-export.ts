import path from 'node:path'
import fs from 'node:fs'
import { figureAbsolutePath } from './figure-helpers.js'

// ── Regex ────────────────────────────────────────────────────────────────────

const DOC2X_FIGURE_MARKER_RE = /<!--\s*DOC2X_FIGURE:([^>\s]+)\s*-->/g

// ── Local helpers ────────────────────────────────────────────────────────────

export function questionPlainText(value: string) {
  return String(value || '').replace(/\r\n?/g, '\n').trim()
}

function escapeLatex(value: string) {
  return questionPlainText(value)
    .replace(/([#%&])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\n{2,}/g, '\n\n')
}

function imageMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  return 'image/png'
}

// ── Exported functions ───────────────────────────────────────────────────────

export function doc2xInlineFigureIds(content: string) {
  DOC2X_FIGURE_MARKER_RE.lastIndex = 0
  return new Set(Array.from(String(content || '').matchAll(DOC2X_FIGURE_MARKER_RE), (match) => match[1]))
}

export function removeDoc2xFigurePlaceholders(content: string) {
  return String(content || '')
    .replace(DOC2X_FIGURE_MARKER_RE, '')
    .replace(/<!--\s*Media\s*-->/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function figuresWithoutInlineMarkers(content: string, figures: Array<Record<string, any>>) {
  const inlineIds = doc2xInlineFigureIds(content)
  return figures.filter((figure) => !inlineIds.has(String(figure.blockId || figure.id || '')))
}

export function markdownWithInlineFigures(content: string, figures: Array<Record<string, any>>) {
  const figureById = new Map(figures.map((figure) => [String(figure.blockId || figure.id || ''), figure]))
  return String(content || '')
    .replace(DOC2X_FIGURE_MARKER_RE, (_marker, id) => markdownFigureLines(figureById.get(id) ? [figureById.get(id)!] : []).join('\n'))
    .replace(/<!--\s*Media\s*-->/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function latexWithInlineFigures(content: string, figures: Array<Record<string, any>>) {
  const figureById = new Map(figures.map((figure) => [String(figure.blockId || figure.id || ''), figure]))
  const source = String(content || '')
  const lines: string[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  DOC2X_FIGURE_MARKER_RE.lastIndex = 0
  while ((match = DOC2X_FIGURE_MARKER_RE.exec(source))) {
    const text = removeDoc2xFigurePlaceholders(source.slice(cursor, match.index))
    if (text) lines.push(escapeLatex(text))
    const figure = figureById.get(match[1])
    if (figure) lines.push(...latexFigureLines([figure]))
    cursor = match.index + match[0].length
  }
  const tail = removeDoc2xFigurePlaceholders(source.slice(cursor))
  if (tail) lines.push(escapeLatex(tail))
  return lines.join('\n\n')
}

export function markdownFigureLines(figures: Array<Record<string, any>>) {
  return figures.flatMap((figure, index) => {
    const filePath = figureAbsolutePath(figure)
    if (!filePath || !fs.existsSync(filePath)) return []
    const caption = figureCaptionForExport(figure, index).replace(/[[\]]/g, '')
    const data = fs.readFileSync(filePath).toString('base64')
    return [`![${caption}](data:${imageMimeType(filePath)};base64,${data})`]
  })
}

export function latexFigureLines(figures: Array<Record<string, any>>) {
  return figures.flatMap((figure, index) => {
    const filePath = figureAbsolutePath(figure)
    if (!filePath || !fs.existsSync(filePath)) return []
    const caption = escapeLatex(figureCaptionForExport(figure, index))
    return [
      '\\begin{center}',
      `\\includegraphics[width=0.82\\linewidth]{\\detokenize{${filePath}}}`,
      `{\\small ${caption}}`,
      '\\end{center}',
    ]
  })
}

export function figureUsageText(usage: string) {
  if (usage === 'stem') return '题干图'
  if (usage === 'options') return '选项图'
  if (usage === 'analysis') return '解析图'
  return '题图'
}

export function figureCaptionForExport(figure: Record<string, any>, index: number) {
  const usage = figureUsageText(String(figure.usage || ''))
  const optionLabel = String(figure.optionLabel || '').trim()
  return optionLabel ? `${usage} ${optionLabel}` : `${usage} ${index + 1}`
}

export function questionFigures(item: any) {
  const figures = Array.isArray(item?.item?.figures) ? item.item.figures as Array<Record<string, any>> : []
  return figures.filter((figure) => String(figure.usage || '') !== 'analysis')
}

export function analysisFigures(item: any) {
  const figures = Array.isArray(item?.item?.figures) ? item.item.figures as Array<Record<string, any>> : []
  return figures.filter((figure) => String(figure.usage || '') === 'analysis')
}

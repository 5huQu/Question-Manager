/**
 * TeachingDocument 解析、规范化与验证
 *
 * 职责分离：
 * - parseTeachingDocument: 安全反序列化 + 规范化（允许修复数据，但保留所有原始内容）
 * - validateTeachingDocument: 只读检查，不修改数据
 * - migrateDocumentIds: 明确的 ID 迁移，返回新文档
 *
 * 核心原则：
 * - 未知 version 不静默丢弃
 * - 未知 block type 保留为 UnknownBlock（含完整 rawData）
 * - 非法盒子子节点保留为 UnknownBlock + 产生 issue，不静默删除
 * - 解析时不生成随机 ID；缺失 ID 使用确定性占位符
 */

import type {
  BoxBlock,
  BoxChildBlock,
  DocumentValidationIssue,
  DocumentValidationResult,
  FigureAssetRef,
  FigureBlock,
  QuestionBlock,
  QuestionDisplayOptions,
  QuestionInlineContent,
  QuestionFigurePlacement,
  QuestionInsertedFigure,
  QuestionFigureSlot,
  SpacerBlock,
  TeachingBlock,
  TeachingDocument,
  TeachingDocumentStyle,
  TeachingDocumentOutlineOptions,
  TeachingDocumentPrintOptions,
  PrintChromeAlignment,
  PrintChromeContentType,
  PrintChromeFont,
  PrintChromeFontSize,
  PrintChromeSectionOptions,
  PrintChromeSlot,
  PrintPageNumberFormat,
  TeachingDocumentV1,
  TeachingInline,
  InlineMark,
  TeachingMarginPreset,
  TeachingQuestionSpacing,
  TeachingTextStyle,
} from '@/types/teachingDocument'
import { getBoxTemplate } from './boxTemplates'
import { TEXT_FONT_OPTIONS } from './lectureFonts'
import { isFigureLayoutPreset } from './figureLayoutPresets'
import { parseBoxAppearance } from './boxAppearance'

// ─── 常量 ────────────────────────────────────────────────────────────────────

const KNOWN_BLOCK_TYPES = new Set([
  'heading', 'paragraph', 'blockMath', 'figure', 'question',
  'box', 'divider', 'spacer', 'pageBreak', 'rawMarkdown', 'table',
  'tikz',
])

const BOX_CHILD_TYPES = new Set([
  'paragraph', 'blockMath', 'table', 'rawMarkdown', 'figure', 'tikz', 'question', 'divider', 'spacer',
])

const VALID_MARKS = new Set<string>(['bold', 'italic', 'underline', 'strikethrough', 'code'])
const VALID_INLINE_FONT_SIZES = new Set([12, 14, 16, 18, 20, 24])
const VALID_TEXT_WEIGHTS = new Set([400, 500, 600, 700])
const VALID_TEXT_ALIGNMENTS = new Set(['left', 'center', 'right', 'justify'])
const VALID_LIST_STYLES = new Set(['bullet', 'ordered'])
const VALID_INDENT_LEVELS = new Set([0, 1, 2, 3, 4])

const VALID_MARGIN_PRESETS = new Set<string>(['compact', 'normal', 'relaxed'])
const VALID_QUESTION_SPACING = new Set<string>(['compact', 'normal', 'relaxed'])
const VALID_PRINT_CHROME_TYPES = new Set<PrintChromeContentType>(['none', 'customText', 'documentTitle', 'documentType', 'pageNumber', 'totalPages', 'date'])
const VALID_PRINT_CHROME_ALIGNMENTS = new Set<PrintChromeAlignment>(['left', 'center', 'right'])
const VALID_PAGE_NUMBER_FORMATS = new Set<PrintPageNumberFormat>(['number', 'page', 'fraction', 'page-total', 'dash'])
const VALID_PRINT_CHROME_FONTS = new Set<PrintChromeFont>(['inherit', ...TEXT_FONT_OPTIONS.map((option) => option.id as PrintChromeFont)])
const VALID_PRINT_CHROME_FONT_SIZES = new Set<PrintChromeFontSize>([8, 9, 10, 11, 12, 14])

// ─── 确定性 ID ───────────────────────────────────────────────────────────────

/**
 * 生成确定性占位 ID（基于索引），用于解析时缺失 ID 的块。
 * 这些 ID 在文档保存前应通过 migrateDocumentIds 替换为稳定 ID。
 */
function deterministicId(prefix: string, index: number): string {
  return `${prefix}_auto_${index}`
}

function extractId(raw: Record<string, unknown>, prefix: string, index: number): string {
  const existing = raw.id
  if (typeof existing === 'string' && existing.trim()) return existing
  return deterministicId(prefix, index)
}

/**
 * 生成稳定的块 ID（用于编辑器创建新块或迁移）。
 * 基于时间戳 + 计数器，保证唯一性。
 */
let idCounter = 0
export function generateBlockId(prefix = 'blk'): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`
}

// ─── 行内解析 ────────────────────────────────────────────────────────────────

function unknownType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') {
    const type = (value as Record<string, unknown>).type
    return typeof type === 'string' && type ? type : 'object'
  }
  return typeof value
}

function parseInlineArray(
  value: unknown,
  issues: DocumentValidationIssue[],
  blockId: string,
): TeachingInline[] {
  if (!Array.isArray(value)) return []
  return value.map((item): TeachingInline => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push({
        level: 'warning',
        blockId,
        code: 'unknown-inline-node',
        message: `行内节点类型 "${unknownType(item)}" 暂不支持，已保留原始数据。`,
      })
      return { type: 'unknown', originalType: unknownType(item), rawData: item }
    }
    const node = item as Record<string, unknown>
    if (node.type === 'text' && typeof node.text === 'string') {
      const rawMarks = Array.isArray(node.marks) ? node.marks : undefined
      const marks = rawMarks?.filter((mark): mark is InlineMark => typeof mark === 'string' && VALID_MARKS.has(mark))
      const unknownMarks = rawMarks?.filter((mark) => typeof mark !== 'string' || !VALID_MARKS.has(mark))
      if (unknownMarks?.length) {
        issues.push({
          level: 'warning',
          blockId,
          code: 'unknown-inline-mark',
          message: `文本包含 ${unknownMarks.length} 个暂不支持的 mark，原值已保留。`,
        })
      }
      // 行内字体覆盖：仅接受非空字符串 id；渲染端对未知 id 会回退默认字体
      const font = typeof node.font === 'string' && node.font ? node.font : undefined
      const color = typeof node.color === 'string' && /^#[0-9a-f]{6}$/i.test(node.color) ? node.color : undefined
      const fontSize = VALID_INLINE_FONT_SIZES.has(Number(node.fontSize))
        ? Number(node.fontSize) as 12 | 14 | 16 | 18 | 20 | 24
        : undefined
      return {
        type: 'text',
        text: node.text,
        marks: marks?.length ? marks : undefined,
        font,
        color,
        fontSize,
        unknownMarks: unknownMarks?.length ? unknownMarks : undefined,
      }
    }
    if (node.type === 'inlineMath' && typeof node.latex === 'string') {
      return { type: 'inlineMath', latex: node.latex }
    }
    if (node.type === 'hardBreak') {
      return { type: 'hardBreak' }
    }
    const originalType = unknownType(node)
    issues.push({
      level: 'warning',
      blockId,
      code: 'unknown-inline-node',
      message: `行内节点类型 "${originalType}" 暂不支持，已保留原始数据。`,
    })
    return { type: 'unknown', originalType, rawData: node }
  })
}

// ─── 图片引用解析 ────────────────────────────────────────────────────────────

function parseFigureAssetRef(node: Record<string, unknown>): FigureAssetRef {
  // 新格式：asset 字段
  const asset = node.asset
  if (asset && typeof asset === 'object') {
    const ref = asset as Record<string, unknown>
    if (ref.type === 'questionFigure' && typeof ref.questionId === 'string' && typeof ref.figureId === 'string') {
      return { type: 'questionFigure', questionId: ref.questionId, figureId: ref.figureId }
    }
    if (ref.type === 'documentAsset' && typeof ref.assetId === 'string') {
      return { type: 'documentAsset', assetId: ref.assetId }
    }
    if (ref.type === 'legacyPath' && typeof ref.path === 'string') {
      return { type: 'legacyPath', path: ref.path }
    }
  }
  // 兼容旧格式：src 字段 → legacyPath
  if (typeof node.src === 'string') {
    return { type: 'legacyPath', path: node.src }
  }
  return { type: 'legacyPath', path: '' }
}

// ─── 题目显示选项解析 ────────────────────────────────────────────────────────

const VALID_ANSWER_SPACE_STYLES = new Set(['blank', 'lines', 'grid'])
const VALID_FIGURE_SLOTS = new Set<QuestionFigureSlot>([
  'stem-start', 'stem-end', 'before-options', 'after-options',
  'before-answer', 'after-answer', 'analysis-start', 'analysis-end',
])

function parseAnswerSpace(raw: unknown): QuestionDisplayOptions['answerSpace'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const node = raw as Record<string, unknown>
  const heightMm = Number(node.heightMm)
  const style = String(node.style || '')
  if (!Number.isFinite(heightMm) || heightMm <= 0) return undefined
  if (!VALID_ANSWER_SPACE_STYLES.has(style)) return undefined
  return { heightMm, style: style as 'blank' | 'lines' | 'grid', splitAcrossPages: node.splitAcrossPages === true ? true : undefined }
}

function parseFigureOverrides(raw: unknown): QuestionDisplayOptions['figureOverrides'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const node = raw as Record<string, unknown>
  const result: Record<string, QuestionFigurePlacement> = {}
  let hasValid = false
  for (const [key, value] of Object.entries(node)) {
    if (!key || !value || typeof value !== 'object') continue
    const entry = value as Record<string, unknown>
    const widthMm = Number(entry.widthMm)
    const alignment = typeof entry.alignment === 'string' && ['left', 'center', 'right'].includes(entry.alignment)
      ? entry.alignment as 'left' | 'center' | 'right'
      : undefined
    const layoutPreset = isFigureLayoutPreset(entry.layoutPreset) ? entry.layoutPreset : undefined
    const textWrap = ['top-bottom', 'square-left', 'square-right'].includes(String(entry.textWrap))
      ? String(entry.textWrap) as QuestionFigurePlacement['textWrap']
      : undefined
    const wrapGapMm = Number(entry.wrapGapMm)
    const groupWithNext = entry.groupWithNext === true ? true : undefined
    const groupColumns = [2, 3, 4].includes(Number(entry.groupColumns))
      ? Number(entry.groupColumns) as 2 | 3 | 4
      : undefined
    const groupMatchHeight = entry.groupMatchHeight === true ? true : undefined
    const groupHeightMm = Number(entry.groupHeightMm)
    const slot = VALID_FIGURE_SLOTS.has(entry.slot as QuestionFigureSlot) ? entry.slot as QuestionFigureSlot : undefined
    const order = Number(entry.order)
    const placement: QuestionFigurePlacement = {
      ...(Number.isFinite(widthMm) && widthMm > 0 ? { widthMm } : {}),
      ...(alignment ? { alignment } : {}),
      ...(layoutPreset ? { layoutPreset } : {}),
      ...(textWrap && textWrap !== 'top-bottom' ? { textWrap } : {}),
      ...(textWrap === 'square-left' || textWrap === 'square-right'
        ? { wrapGapMm: Number.isFinite(wrapGapMm) ? Math.max(0, Math.min(20, wrapGapMm)) : 4 }
        : {}),
      ...(groupWithNext ? { groupWithNext } : {}),
      ...(groupWithNext && groupColumns ? { groupColumns } : {}),
      ...(groupWithNext && groupMatchHeight ? { groupMatchHeight } : {}),
      ...(groupWithNext && groupMatchHeight && Number.isFinite(groupHeightMm) && groupHeightMm > 0 ? { groupHeightMm } : {}),
      ...(slot ? { slot } : {}),
      ...(Number.isFinite(order) ? { order } : {}),
    }
    if (!Object.keys(placement).length) continue
    result[key] = placement
    hasValid = true
  }
  return hasValid ? result : undefined
}

function parseInsertedFigures(raw: unknown): QuestionInsertedFigure[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const result: QuestionInsertedFigure[] = []
  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const node = value as Record<string, unknown>
    const id = typeof node.id === 'string' ? node.id.trim() : ''
    const slot = VALID_FIGURE_SLOTS.has(node.slot as QuestionFigureSlot) ? node.slot as QuestionFigureSlot : undefined
    const order = Number(node.order)
    if (!id || !slot || !Number.isFinite(order)) continue
    const widthMm = Number(node.widthMm)
    const alignment = typeof node.alignment === 'string' && ['left', 'center', 'right'].includes(node.alignment)
      ? node.alignment as 'left' | 'center' | 'right' : undefined
    const layoutPreset = isFigureLayoutPreset(node.layoutPreset) ? node.layoutPreset : undefined
    const textWrap = ['top-bottom', 'square-left', 'square-right'].includes(String(node.textWrap))
      ? String(node.textWrap) as QuestionFigurePlacement['textWrap']
      : undefined
    const wrapGapMm = Number(node.wrapGapMm)
    const groupWithNext = node.groupWithNext === true ? true : undefined
    const groupColumns = [2, 3, 4].includes(Number(node.groupColumns))
      ? Number(node.groupColumns) as 2 | 3 | 4
      : undefined
    const placement: QuestionFigurePlacement = {
      ...(Number.isFinite(widthMm) && widthMm > 0 ? { widthMm } : {}),
      ...(alignment ? { alignment } : {}),
      ...(layoutPreset ? { layoutPreset } : {}),
      ...(textWrap && textWrap !== 'top-bottom' ? { textWrap } : {}),
      ...(textWrap === 'square-left' || textWrap === 'square-right'
        ? { wrapGapMm: Number.isFinite(wrapGapMm) ? Math.max(0, Math.min(20, wrapGapMm)) : 4 }
        : {}),
      ...(groupWithNext ? { groupWithNext } : {}),
      ...(groupWithNext && groupColumns ? { groupColumns } : {}),
    }
    result.push({
      id,
      asset: parseFigureAssetRef({ asset: node.asset }),
      slot,
      order,
      ...placement,
      ...(typeof node.caption === 'string' ? { caption: node.caption } : {}),
      ...(typeof node.alt === 'string' ? { alt: node.alt } : {}),
    })
  }
  return result.length ? result : undefined
}

function parseQuestionInlineContent(raw: unknown, issues: DocumentValidationIssue[], blockId: string): QuestionInlineContent | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const result: QuestionInlineContent = {}
  for (const [key, value] of Object.entries(raw).slice(0, 200)) {
    if (!key || key.length > 240 || !Array.isArray(value)) continue
    const inlines = parseInlineArray(value, issues, `${blockId}:${key}`)
    if (inlines.length) result[key] = inlines
  }
  return Object.keys(result).length ? result : undefined
}

// ─── 块解析 ──────────────────────────────────────────────────────────────────

function parseBlock(raw: unknown, index: number, issues: DocumentValidationIssue[]): TeachingBlock | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const id = deterministicId('unk', index)
    issues.push({
      level: 'warning',
      blockId: id,
      code: 'invalid-block',
      message: `索引 ${index} 处的块不是有效对象，已作为未知块保留。`,
    })
    return {
      type: 'unknown',
      id,
      originalType: unknownType(raw),
      rawData: raw,
    }
  }
  const node = raw as Record<string, unknown>
  const type = String(node.type || '')

  if (!KNOWN_BLOCK_TYPES.has(type)) {
    const id = extractId(node, 'unk', index)
    return {
      type: 'unknown',
      id,
      originalType: type || '(empty)',
      rawData: node,
    }
  }

  switch (type) {
    case 'heading': {
      const id = extractId(node, 'h', index)
      const level = Number(node.level)
      const rawNumbering = node.numbering && typeof node.numbering === 'object' && !Array.isArray(node.numbering) ? node.numbering as Record<string, unknown> : undefined
      const numbering = rawNumbering && ['inherit', 'none', 'manual'].includes(String(rawNumbering.mode || 'inherit')) ? {
        mode: String(rawNumbering.mode || 'inherit') as 'inherit' | 'none' | 'manual',
        ...(typeof rawNumbering.manualLabel === 'string' && rawNumbering.manualLabel.trim() ? { manualLabel: rawNumbering.manualLabel.trim().slice(0, 40) } : {}),
        ...(Number.isInteger(rawNumbering.restartAt) && Number(rawNumbering.restartAt) > 0 ? { restartAt: Number(rawNumbering.restartAt) } : {}),
      } : undefined
      return {
        type: 'heading',
        id,
        level: ([1, 2, 3, 4].includes(level) ? level : 3) as 1 | 2 | 3 | 4,
        content: parseInlineArray(node.content, issues, id),
        ...(numbering ? { numbering } : {}),
        ...(VALID_TEXT_ALIGNMENTS.has(String(node.alignment)) && node.alignment !== 'left' ? { alignment: node.alignment as 'left' | 'center' | 'right' | 'justify' } : {}),
        ...(VALID_INDENT_LEVELS.has(Number(node.indentLevel)) && Number(node.indentLevel) ? { indentLevel: Number(node.indentLevel) as 1 | 2 | 3 | 4 } : {}),
      }
    }
    case 'paragraph': {
      const id = extractId(node, 'p', index)
      return {
        type: 'paragraph',
        id,
        content: parseInlineArray(node.content, issues, id),
        ...(VALID_TEXT_ALIGNMENTS.has(String(node.alignment)) && node.alignment !== 'left' ? { alignment: node.alignment as 'left' | 'center' | 'right' | 'justify' } : {}),
        ...(VALID_LIST_STYLES.has(String(node.listStyle)) ? { listStyle: node.listStyle as 'bullet' | 'ordered' } : {}),
        ...(VALID_INDENT_LEVELS.has(Number(node.indentLevel)) && Number(node.indentLevel) ? { indentLevel: Number(node.indentLevel) as 1 | 2 | 3 | 4 } : {}),
      }
    }
    case 'blockMath':
      return {
        type: 'blockMath',
        id: extractId(node, 'math', index),
        latex: typeof node.latex === 'string' ? node.latex : '',
        label: typeof node.label === 'string' ? node.label : undefined,
      }
    case 'table': {
      const id = extractId(node, 'table', index)
      const rawRows = Array.isArray(node.rows) ? node.rows.slice(0, 20) : []
      const rows = rawRows.map((rawRow, rowIndex) => {
        const rawCells = Array.isArray(rawRow) ? rawRow.slice(0, 12) : []
        return rawCells.map((rawCell, cellIndex) => {
          const cell = rawCell && typeof rawCell === 'object' && !Array.isArray(rawCell) ? rawCell as Record<string, unknown> : {}
          return { content: parseInlineArray(cell.content, issues, `${id}-${rowIndex}-${cellIndex}`) }
        })
      }).filter((row) => row.length)
      const columnCount = rows[0]?.length || 2
      const normalizedRows = (rows.length ? rows : Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => ({ content: [] })))).map((row) => Array.from({ length: columnCount }, (_, columnIndex) => row[columnIndex] || { content: [] }))
      return { type: 'table', id, rows: normalizedRows, hasHeader: typeof node.hasHeader === 'boolean' ? node.hasHeader : true }
    }
    case 'figure': {
      const alignment = String(node.alignment || 'center')
      const widthRatio = Number(node.widthRatio)
      const widthMm = Number(node.widthMm)
      const groupItems = Array.isArray(node.groupItems)
        ? node.groupItems.slice(0, 12).flatMap((rawItem, itemIndex) => {
            if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return []
            const item = rawItem as Record<string, unknown>
            return [{
              id: typeof item.id === 'string' && item.id ? item.id : `${extractId(node, 'fig', index)}-item-${itemIndex + 1}`,
              asset: parseFigureAssetRef({ asset: item.asset }),
              ...(typeof item.caption === 'string' ? { caption: item.caption } : {}),
              ...(typeof item.alt === 'string' ? { alt: item.alt } : {}),
            }]
          })
        : []
      const groupColumns = [1, 2, 3].includes(Number(node.groupColumns))
        ? Number(node.groupColumns) as 1 | 2 | 3
        : 2
      const groupGapMm = Number(node.groupGapMm)
      const wrapGapMm = Number(node.wrapGapMm)
      const textWrap = ['top-bottom', 'square-left', 'square-right'].includes(String(node.textWrap))
        ? String(node.textWrap) as FigureBlock['textWrap']
        : undefined
      if (node.layoutPreset != null && !isFigureLayoutPreset(node.layoutPreset)) {
        issues.push({ level: 'warning', blockId: extractId(node, 'fig', index), code: 'invalid-figure-preset', message: `图片排版预设 "${String(node.layoutPreset)}" 无效，已回退旧字段。` })
      }
      return {
        type: 'figure',
        id: extractId(node, 'fig', index),
        asset: parseFigureAssetRef(node),
        alt: typeof node.alt === 'string' ? node.alt : undefined,
        alignment: (['left', 'center', 'right'].includes(alignment) ? alignment : 'center') as FigureBlock['alignment'],
        layoutPreset: isFigureLayoutPreset(node.layoutPreset) ? node.layoutPreset : undefined,
        widthRatio: Number.isFinite(widthRatio) && widthRatio >= 0.1 && widthRatio <= 1 ? widthRatio : undefined,
        widthMm: Number.isFinite(widthMm) && widthMm > 0 ? widthMm : undefined,
        lockAspectRatio: typeof node.lockAspectRatio === 'boolean' ? node.lockAspectRatio : undefined,
        textWrap,
        wrapGapMm: textWrap === 'square-left' || textWrap === 'square-right'
          ? (Number.isFinite(wrapGapMm) ? Math.max(0, Math.min(20, wrapGapMm)) : undefined)
          : undefined,
        caption: typeof node.caption === 'string' ? node.caption : undefined,
        groupItems: groupItems.length ? groupItems : undefined,
        groupColumns: groupItems.length ? groupColumns : undefined,
        groupGapMm: groupItems.length && Number.isFinite(groupGapMm) ? Math.max(0, Math.min(20, groupGapMm)) : undefined,
      }
    }
    case 'tikz': {
      const alignment = String(node.alignment || 'center')
      const widthMm = Number(node.widthMm)
      if (node.layoutPreset != null && !isFigureLayoutPreset(node.layoutPreset)) {
        issues.push({ level: 'warning', blockId: extractId(node, 'tikz', index), code: 'invalid-figure-preset', message: `TikZ 绘图的排版预设 "${String(node.layoutPreset)}" 无效，已回退旧字段。` })
      }
      return { type: 'tikz', id: extractId(node, 'tikz', index), source: typeof node.source === 'string' ? node.source.slice(0, 50_000) : '', sourceHash: typeof node.sourceHash === 'string' ? node.sourceHash : undefined, svgAssetId: typeof node.svgAssetId === 'string' ? node.svgAssetId : undefined, alignment: (['left', 'center', 'right'].includes(alignment) ? alignment : 'center') as 'left' | 'center' | 'right', layoutPreset: isFigureLayoutPreset(node.layoutPreset) ? node.layoutPreset : undefined, widthMm: Number.isFinite(widthMm) && widthMm > 0 ? widthMm : undefined, alt: typeof node.alt === 'string' ? node.alt : undefined, caption: typeof node.caption === 'string' ? node.caption : undefined }
    }
    case 'question': {
      const display = node.display && typeof node.display === 'object' ? node.display as Record<string, unknown> : undefined
      if (display?.figureOverrides && typeof display.figureOverrides === 'object') {
        for (const [key, value] of Object.entries(display.figureOverrides as Record<string, unknown>)) {
          if (value && typeof value === 'object') {
            const entry = value as Record<string, unknown>
            if (entry.layoutPreset != null && !isFigureLayoutPreset(entry.layoutPreset)) issues.push({ level: 'warning', blockId: extractId(node, 'q', index), code: 'invalid-figure-preset', message: `图片覆盖 "${key}" 的排版预设无效。` })
            if (entry.groupColumns != null && ![2, 3, 4].includes(Number(entry.groupColumns))) issues.push({ level: 'warning', blockId: extractId(node, 'q', index), code: 'invalid-figure-group-columns', message: `图片覆盖 "${key}" 的并排列数无效。` })
            if (entry.groupHeightMm != null && (!Number.isFinite(Number(entry.groupHeightMm)) || Number(entry.groupHeightMm) <= 0)) issues.push({ level: 'warning', blockId: extractId(node, 'q', index), code: 'invalid-figure-group-height', message: `图片覆盖 "${key}" 的统一高度无效。` })
            if (entry.slot != null && !VALID_FIGURE_SLOTS.has(entry.slot as QuestionFigureSlot)) issues.push({ level: 'warning', blockId: extractId(node, 'q', index), code: 'invalid-figure-slot', message: `图片覆盖 "${key}" 的位置无效。` })
          }
        }
      }
      const breakBehavior = ['auto', 'avoid', 'force-before'].includes(String(node.breakBehavior || 'auto'))
        ? String(node.breakBehavior || 'auto') as QuestionBlock['breakBehavior']
        : 'auto'
      return {
        type: 'question',
        id: extractId(node, 'q', index),
        questionId: typeof node.questionId === 'string' ? node.questionId : '',
        breakBehavior,
        display: display ? {
          choiceLayout: ['auto', 'four', 'two', 'one'].includes(String(display.choiceLayout))
            ? display.choiceLayout as QuestionDisplayOptions['choiceLayout']
            : undefined,
          showAnswer: typeof display.showAnswer === 'boolean' ? display.showAnswer : undefined,
          showAnalysis: typeof display.showAnalysis === 'boolean' ? display.showAnalysis : undefined,
          showScore: typeof display.showScore === 'boolean' ? display.showScore : undefined,
          scoreOverride: typeof display.scoreOverride === 'number' ? display.scoreOverride : undefined,
          displayNumber: typeof display.displayNumber === 'string' ? display.displayNumber : undefined,
          displayNumberAuto: display.displayNumberAuto === true ? true : undefined,
          answerSpace: parseAnswerSpace(display.answerSpace),
          figureOverrides: parseFigureOverrides(display.figureOverrides),
          insertedFigures: parseInsertedFigures(display.insertedFigures),
          inlineContent: parseQuestionInlineContent(display.inlineContent, issues, extractId(node, 'q', index)),
          typography: parseTextStyle(display.typography),
        } : undefined,
      } satisfies QuestionBlock
    }
    case 'box': {
      const breakBehavior = String(node.breakBehavior || 'auto')
      const appearance = parseBoxAppearance(node.appearance)
      const rawChildren = Array.isArray(node.children) ? node.children : []
      const children: BoxChildBlock[] = []
      for (let ci = 0; ci < rawChildren.length; ci++) {
        const childRaw = rawChildren[ci]
        const childNode = childRaw && typeof childRaw === 'object' && !Array.isArray(childRaw)
          ? childRaw as Record<string, unknown>
          : null
        const childType = childNode ? String(childNode.type || '') : unknownType(childRaw)
        if (BOX_CHILD_TYPES.has(childType)) {
          const parsed = parseBlock(childRaw, ci, issues)
          if (parsed) children.push(parsed as BoxChildBlock)
        } else {
          // 非法子节点：保留为 UnknownBlock 并产生 issue，不静默丢弃
          const childId = childNode ? extractId(childNode, 'unk', ci) : deterministicId('unk', ci)
          children.push({
            type: 'unknown',
            id: childId,
            originalType: childType || '(empty)',
            rawData: childRaw,
          })
          issues.push({
            level: 'warning',
            blockId: extractId(node, 'box', index),
            code: 'illegal-box-child',
            message: `盒子索引 ${index} 的子节点 ${ci} 类型 "${childType}" 不允许出现在盒子内，已保留为未知块。`,
          })
        }
      }
      return {
        type: 'box',
        id: extractId(node, 'box', index),
        templateId: typeof node.templateId === 'string' ? node.templateId : 'concept',
        title: typeof node.title === 'string' ? node.title : undefined,
        icon: typeof node.icon === 'string' ? node.icon : undefined,
        ...(appearance ? { appearance } : {}),
        breakBehavior: (['auto', 'avoid', 'allow', 'force-before'].includes(breakBehavior) ? breakBehavior : 'auto') as BoxBlock['breakBehavior'],
        children,
      }
    }
    case 'divider':
      return { type: 'divider', id: extractId(node, 'hr', index) }
    case 'spacer': {
      const heightEm = Number(node.heightEm)
      const heightMm = Number(node.heightMm)
      return {
        type: 'spacer',
        id: extractId(node, 'sp', index),
        heightEm: Number.isFinite(heightEm) ? Math.min(8, Math.max(0.5, heightEm)) : 2,
        heightMm: Number.isFinite(heightMm) && heightMm > 0 ? heightMm : undefined,
      } satisfies SpacerBlock
    }
    case 'pageBreak':
      return { type: 'pageBreak', id: extractId(node, 'pb', index) }
    case 'rawMarkdown':
      return {
        type: 'rawMarkdown',
        id: extractId(node, 'md', index),
        markdown: typeof node.markdown === 'string' ? node.markdown : '',
        reason: (['fallback', 'user-inserted', 'unsupported-structure'].includes(String(node.reason)) ? node.reason : undefined) as 'fallback' | 'user-inserted' | 'unsupported-structure' | undefined,
      }
    default:
      return null
  }
}

// ─── 解析（规范化） ──────────────────────────────────────────────────────────

/**
 * 安全解析 JSON 为 TeachingDocument。
 * 这是规范化过程：允许修复数据格式，但保留所有原始内容。
 * 未知块保留为 UnknownBlock；非法盒子子节点保留为 UnknownBlock + issue。
 */
export function parseTeachingDocument(json: unknown): { document: TeachingDocument | null; issues: DocumentValidationIssue[] } {
  const issues: DocumentValidationIssue[] = []

  if (!json || typeof json !== 'object') {
    issues.push({ level: 'error', code: 'invalid-root', message: '文档根节点不是有效对象。' })
    return { document: null, issues }
  }

  const root = json as Record<string, unknown>
  const version = root.version

  if (version !== 1) {
    issues.push({
      level: 'error',
      code: 'unsupported-version',
      message: `不支持的文档版本: ${JSON.stringify(version)}。当前仅支持 version: 1。`,
    })
    return { document: null, issues }
  }

  const documentType = String(root.documentType || '')
  if (!['worksheet', 'exam', 'lecture', 'wrong-question-collection'].includes(documentType)) {
    issues.push({
      level: 'warning',
      code: 'unknown-document-type',
      message: `未知文档类型 "${documentType}"，已降级为 worksheet。`,
    })
  }

  const content = Array.isArray(root.content) ? root.content : []
  const blocks: TeachingBlock[] = []
  for (let i = 0; i < content.length; i++) {
    const block = parseBlock(content[i], i, issues)
    if (block) {
      blocks.push(block)
      if (block.type === 'unknown') {
        issues.push({
          level: 'warning',
          blockId: block.id,
          code: 'unknown-block-type',
          message: `未识别的块类型 "${block.originalType}" 已保留为未知块。`,
        })
      }
    }
  }

  const document: TeachingDocumentV1 = {
    version: 1,
    documentType: (['worksheet', 'exam', 'lecture', 'wrong-question-collection'].includes(documentType) ? documentType : 'worksheet') as TeachingDocumentV1['documentType'],
    title: typeof root.title === 'string' ? root.title : '未命名文档',
    metadata: root.metadata && typeof root.metadata === 'object' && !Array.isArray(root.metadata) ? root.metadata as Record<string, unknown> : {},
    content: blocks,
    style: parseDocumentStyle(root.style),
    outline: parseDocumentOutline(root.outline),
  }

  return { document, issues }
}

function parseDocumentOutline(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const node = raw as Record<string, unknown>
  const preset = ['textbook', 'decimal', 'chinese', 'exam', 'chapter-chinese', 'chapter-decimal', 'chapter-section', 'roman', 'paren', 'none'].includes(String(node.preset))
    ? node.preset as TeachingDocumentOutlineOptions['preset']
    : undefined
  const levels: Record<number, { style?: 'arabic' | 'chinese' | 'roman-upper' | 'alpha-upper'; template?: string; includeParents?: boolean }> = {}
  if (node.levels && typeof node.levels === 'object' && !Array.isArray(node.levels)) {
    for (const level of [1, 2, 3, 4]) {
      const value = (node.levels as Record<string, unknown>)[String(level)]
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const item = value as Record<string, unknown>
      const style = ['arabic', 'chinese', 'roman-upper', 'alpha-upper'].includes(String(item.style)) ? item.style as 'arabic' | 'chinese' | 'roman-upper' | 'alpha-upper' : undefined
      const template = typeof item.template === 'string' && item.template.length <= 80 ? item.template : undefined
      const includeParents = typeof item.includeParents === 'boolean' ? item.includeParents : undefined
      if (style || template || includeParents !== undefined) levels[level] = { style, template, includeParents }
    }
  }
  const numberingEnabled = typeof node.numberingEnabled === 'boolean' ? node.numberingEnabled : undefined
  return numberingEnabled === undefined && !preset && !Object.keys(levels).length ? undefined : { numberingEnabled, preset, ...(Object.keys(levels).length ? { levels } : {}) }
}

/**
 * 解析文档级打印样式（字体、边距）。只接受受约束的 id / 枚举，
 * 非法或缺省值返回 undefined（由上层回退默认）。不产生 issue：
 * 样式属于展示偏好，字段缺失/非法不应干扰内容校验。
 */
function parseDocumentStyle(raw: unknown): TeachingDocumentStyle | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const node = raw as Record<string, unknown>
  const typographyPreset = node.typographyPreset === 'exam' || node.typographyPreset === 'lecture'
    ? node.typographyPreset
    : undefined
  const bodyFont = typeof node.bodyFont === 'string' && node.bodyFont ? node.bodyFont : undefined
  const bodyLatinFont = typeof node.bodyLatinFont === 'string' && node.bodyLatinFont ? node.bodyLatinFont : undefined
  const bodyNumberFont = typeof node.bodyNumberFont === 'string' && node.bodyNumberFont ? node.bodyNumberFont : undefined
  const headingFont = typeof node.headingFont === 'string' && node.headingFont ? node.headingFont : undefined
  const headingLatinFont = typeof node.headingLatinFont === 'string' && node.headingLatinFont ? node.headingLatinFont : undefined
  const headingNumberFont = typeof node.headingNumberFont === 'string' && node.headingNumberFont ? node.headingNumberFont : undefined
  const headingStyles = parseHeadingStyles(node.headingStyles)
  const questionStyle = parseTextStyle(node.questionStyle)
  const marginPreset = typeof node.marginPreset === 'string' && VALID_MARGIN_PRESETS.has(node.marginPreset)
    ? node.marginPreset as TeachingMarginPreset
    : undefined
  const questionSpacing = typeof node.questionSpacing === 'string' && VALID_QUESTION_SPACING.has(node.questionSpacing)
    ? node.questionSpacing as TeachingQuestionSpacing
    : undefined
  const print = parseDocumentPrintOptions(node.print)
  if (!typographyPreset && !bodyFont && !bodyLatinFont && !bodyNumberFont && !headingFont && !headingLatinFont && !headingNumberFont && !headingStyles && !questionStyle && !marginPreset && !questionSpacing && !print) return undefined
  return { typographyPreset, bodyFont, bodyLatinFont, bodyNumberFont, headingFont, headingLatinFont, headingNumberFont, headingStyles, questionStyle, marginPreset, questionSpacing, print }
}

function parseTextStyle(raw: unknown): TeachingTextStyle | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const node = raw as Record<string, unknown>
  const font = typeof node.font === 'string' && TEXT_FONT_OPTIONS.some((option) => option.id === node.font) ? node.font : undefined
  const fontSize = VALID_INLINE_FONT_SIZES.has(Number(node.fontSize)) ? Number(node.fontSize) as TeachingTextStyle['fontSize'] : undefined
  const color = typeof node.color === 'string' && /^#[0-9a-f]{6}$/i.test(node.color) ? node.color : undefined
  const fontWeight = VALID_TEXT_WEIGHTS.has(Number(node.fontWeight)) ? Number(node.fontWeight) as TeachingTextStyle['fontWeight'] : undefined
  const italic = typeof node.italic === 'boolean' ? node.italic : undefined
  if (!font && !fontSize && !color && !fontWeight && italic === undefined) return undefined
  return { font, fontSize, color, fontWeight, italic }
}

function parseHeadingStyles(raw: unknown): TeachingDocumentStyle['headingStyles'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const result: TeachingDocumentStyle['headingStyles'] = {}
  for (const level of [1, 2, 3, 4] as const) {
    const parsed = parseTextStyle((raw as Record<string, unknown>)[String(level)])
    if (parsed) result[level] = parsed
  }
  return Object.keys(result).length ? result : undefined
}

function parseDocumentPrintOptions(raw: unknown): TeachingDocumentPrintOptions | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const node = raw as Record<string, unknown>
  const boolean = (key: keyof TeachingDocumentPrintOptions) =>
    typeof node[key] === 'boolean' ? node[key] as boolean : undefined
  const text = (key: 'headerSubtitle' | 'footerCustomText') =>
    typeof node[key] === 'string' && node[key].trim() ? node[key].trim().slice(0, 160) : undefined
  const legacyHeaderSubtitle = text('headerSubtitle')
  const legacyFooterText = text('footerCustomText')
  const legacyHeaderShowTitle = boolean('headerShowTitle')
  const legacyFooterShowPageNumber = boolean('footerShowPageNumber')
  const legacyFooterShowTotalPages = boolean('footerShowTotalPages')
  let header = parseChromeSection(node.header)
  let footer = parseChromeSection(node.footer)
  let pageNumber = parsePageNumberOptions(node.pageNumber)

  // 旧单条文本配置读取后即升级为三栏；内容仍完整保留。
  if (!header && (legacyHeaderSubtitle !== undefined || legacyHeaderShowTitle !== undefined)) {
    header = legacyHeaderSubtitle
      ? {
          left: legacyHeaderShowTitle === false ? { type: 'none', align: 'left' } : { type: 'documentTitle', align: 'left' },
          center: { type: 'customText', text: legacyHeaderSubtitle, align: 'center' },
          right: { type: 'none', align: 'right' },
        }
      : {
          center: legacyHeaderShowTitle === false ? { type: 'none', align: 'center' } : { type: 'documentTitle', align: 'center' },
        }
  }
  if (!footer && (legacyFooterText !== undefined || legacyFooterShowPageNumber !== undefined)) {
    footer = {
      left: legacyFooterText ? { type: 'customText', text: legacyFooterText, align: 'left' } : { type: 'none', align: 'left' },
      center: legacyFooterShowPageNumber === false ? { type: 'none', align: 'center' } : { type: 'pageNumber', align: 'center' },
      right: { type: 'none', align: 'right' },
    }
  }
  if (!pageNumber && legacyFooterShowTotalPages !== undefined) pageNumber = { showTotalPages: legacyFooterShowTotalPages }
  const print: TeachingDocumentPrintOptions = {
    headerEnabled: boolean('headerEnabled'),
    headerShowOnFirstPage: boolean('headerShowOnFirstPage'),
    footerEnabled: boolean('footerEnabled'),
    header,
    footer,
    pageNumber,
    showDocumentType: boolean('showDocumentType'),
  }
  return Object.values(print).some((value) => value !== undefined) ? print : undefined
}

function parseChromeSection(raw: unknown): PrintChromeSectionOptions | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const node = raw as Record<string, unknown>
  const section: PrintChromeSectionOptions = {}
  for (const position of ['left', 'center', 'right'] as const) {
    const slot = parseChromeSlot(node[position])
    if (slot) section[position] = slot
  }
  return Object.keys(section).length ? section : undefined
}

function parseChromeSlot(raw: unknown): PrintChromeSlot | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const node = raw as Record<string, unknown>
  if (typeof node.type !== 'string' || !VALID_PRINT_CHROME_TYPES.has(node.type as PrintChromeContentType)) return undefined
  const align = typeof node.align === 'string' && VALID_PRINT_CHROME_ALIGNMENTS.has(node.align as PrintChromeAlignment)
    ? node.align as PrintChromeAlignment
    : undefined
  const text = node.type === 'customText' && typeof node.text === 'string'
    ? node.text.trim().slice(0, 160)
    : undefined
  const font = typeof node.font === 'string' && VALID_PRINT_CHROME_FONTS.has(node.font as PrintChromeFont)
    ? node.font as PrintChromeFont
    : undefined
  const fontSize = typeof node.fontSize === 'number' && VALID_PRINT_CHROME_FONT_SIZES.has(node.fontSize as PrintChromeFontSize)
    ? node.fontSize as PrintChromeFontSize
    : undefined
  return {
    type: node.type as PrintChromeContentType,
    text: text || undefined,
    align,
    font,
    fontSize,
    bold: typeof node.bold === 'boolean' ? node.bold : undefined,
    italic: typeof node.italic === 'boolean' ? node.italic : undefined,
  }
}

function parsePageNumberOptions(raw: unknown): TeachingDocumentPrintOptions['pageNumber'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const node = raw as Record<string, unknown>
  const format = typeof node.format === 'string' && VALID_PAGE_NUMBER_FORMATS.has(node.format as PrintPageNumberFormat)
    ? node.format as PrintPageNumberFormat
    : undefined
  const prefix = typeof node.prefix === 'string' ? node.prefix.slice(0, 32) : undefined
  const suffix = typeof node.suffix === 'string' ? node.suffix.slice(0, 32) : undefined
  const showTotalPages = typeof node.showTotalPages === 'boolean' ? node.showTotalPages : undefined
  return format !== undefined || prefix !== undefined || suffix !== undefined || showTotalPages !== undefined
    ? { format, prefix, suffix, showTotalPages }
    : undefined
}

// ─── 验证（只读检查） ────────────────────────────────────────────────────────

/**
 * 验证已解析文档的结构完整性。只检查，不修改。
 * 检查：空 ID、重复 ID、空题目引用、无效模板、非法盒子子节点等。
 */
/**
 * 结构签名：校验问题几乎全部由结构字段产生（块类型/id/题目引用/图片引用/数值选项），
 * 正文文本不影响校验结果。用"剔除正文的逐块签名 + WeakMap 缓存"判断是否需要重跑
 * 全量校验——同一块引用只签名一次，普通文本回显只产生新的段落块，O(变更块)。
 */
const blockSignatureCache = new WeakMap<object, string>()

function inlineTextLength(inlines: TeachingInline[]): number {
  let total = 0
  for (const inline of inlines) total += inline.type === 'text' ? inline.text.length : 1
  return total
}

function structuralBlockSignature(block: TeachingBlock): string {
  const cached = blockSignatureCache.get(block)
  if (cached !== undefined) return cached
  let value: string
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      value = `${block.type}:${block.id}:${block.type === 'heading' ? block.level : ''}:${inlineTextLength(block.content)}`
      break
    case 'box':
      value = `box:${block.id}:${block.templateId}:${block.breakBehavior}:${JSON.stringify(block.appearance || {})}:${block.children.map((child) => structuralBlockSignature(child as TeachingBlock)).join('|')}`
      break
    default:
      value = `${block.type}:${block.id}:${JSON.stringify(block)}`
  }
  blockSignatureCache.set(block, value)
  return value
}

export function structuralDocumentSignature(document: TeachingDocument): string {
  return document.content.map(structuralBlockSignature).join('|')
}

export function validateTeachingDocument(document: TeachingDocument): DocumentValidationResult {
  const issues: DocumentValidationIssue[] = []
  const seenIds = new Set<string>()

  function checkBlock(block: TeachingBlock, depth: number) {
    // 空 ID
    if (!block.id || !block.id.trim()) {
      issues.push({ level: 'error', blockId: block.id, code: 'empty-id', message: '块 ID 为空。' })
    }

    // ID 唯一性
    if (seenIds.has(block.id)) {
      issues.push({ level: 'error', blockId: block.id, code: 'duplicate-id', message: `块 ID "${block.id}" 重复。` })
    }
    seenIds.add(block.id)

    // 递归深度保护
    if (depth > 3) {
      issues.push({ level: 'error', blockId: block.id, code: 'max-depth', message: '块嵌套深度超过限制。' })
      return
    }

    // 自动占位 ID 警告
    if (/_auto_\d+$/.test(block.id)) {
      issues.push({ level: 'warning', blockId: block.id, code: 'auto-id', message: `块 "${block.id}" 使用自动占位 ID，保存前应迁移为稳定 ID。` })
    }

    switch (block.type) {
      case 'question':
        if (!block.questionId.trim()) {
          issues.push({ level: 'error', blockId: block.id, code: 'empty-question-ref', message: '题目块缺少有效的 questionId 引用。' })
        }
        // 校验 answerSpace
        if (block.display?.answerSpace) {
          const { heightMm } = block.display.answerSpace
          if (!Number.isFinite(heightMm) || heightMm <= 0) {
            issues.push({ level: 'warning', blockId: block.id, code: 'invalid-answer-space', message: `题目回答留空高度无效: ${heightMm}。` })
          } else if (heightMm > 500) {
            issues.push({ level: 'warning', blockId: block.id, code: 'invalid-answer-space', message: `题目回答留空高度 ${heightMm}mm 超出合理上限 500mm。` })
          }
        }
        // 校验 figureOverrides
        if (block.display?.figureOverrides) {
          for (const [key, override] of Object.entries(block.display.figureOverrides)) {
            if (!key.trim()) {
              issues.push({ level: 'warning', blockId: block.id, code: 'invalid-figure-override', message: '图片覆盖 key 不得为空。' })
            }
            if (override.widthMm != null && (!Number.isFinite(override.widthMm) || override.widthMm <= 0)) {
              issues.push({ level: 'warning', blockId: block.id, code: 'invalid-figure-override', message: `图片覆盖 "${key}" 的宽度无效: ${override.widthMm}。` })
            }
            if (override.layoutPreset && !isFigureLayoutPreset(override.layoutPreset)) {
              issues.push({ level: 'warning', blockId: block.id, code: 'invalid-figure-preset', message: `图片覆盖 "${key}" 的排版预设无效。` })
            }
            if (override.slot && !VALID_FIGURE_SLOTS.has(override.slot)) {
              issues.push({ level: 'warning', blockId: block.id, code: 'invalid-figure-slot', message: `图片覆盖 "${key}" 的位置无效。` })
            }
          }
        }
        if (block.display?.insertedFigures) {
          const insertedIds = new Set<string>()
          for (const figure of block.display.insertedFigures) {
            if (insertedIds.has(figure.id)) issues.push({ level: 'warning', blockId: block.id, code: 'duplicate-inserted-figure-id', message: `文档插图 id "${figure.id}" 重复。` })
            insertedIds.add(figure.id)
            const asset = figure.asset
            const missing = asset.type === 'documentAsset' ? !asset.assetId.trim() : asset.type === 'questionFigure' ? !asset.questionId.trim() || !asset.figureId.trim() : !asset.path.trim()
            if (missing) issues.push({ level: 'warning', blockId: block.id, code: 'missing-inserted-figure-asset', message: `文档插图 "${figure.id}" 缺少有效资源引用。` })
          }
        }
        break
      case 'figure': {
        const asset = block.asset
        if (asset.type === 'legacyPath' && !asset.path.trim()) {
          issues.push({ level: 'warning', blockId: block.id, code: 'empty-figure-ref', message: '图片块缺少有效资源引用。' })
        }
        if (asset.type === 'legacyPath' && /^(?:[a-zA-Z]:[\\/]|\/|file:\/\/)/.test(asset.path.trim())) {
          issues.push({ level: 'error', blockId: block.id, code: 'absolute-legacy-path', message: '图片 legacyPath 不得保存本地绝对路径。' })
        }
        if (asset.type === 'questionFigure' && (!asset.questionId.trim() || !asset.figureId.trim())) {
          issues.push({ level: 'error', blockId: block.id, code: 'invalid-figure-ref', message: '图片引用 questionFigure 缺少 questionId 或 figureId。' })
        }
        if (asset.type === 'documentAsset' && !asset.assetId.trim()) {
          issues.push({ level: 'error', blockId: block.id, code: 'invalid-figure-ref', message: '图片引用 documentAsset 缺少 assetId。' })
        }
        // 校验 widthMm
        if (block.widthMm != null) {
          if (!Number.isFinite(block.widthMm) || block.widthMm <= 0) {
            issues.push({ level: 'warning', blockId: block.id, code: 'invalid-figure-width', message: `图片宽度 ${block.widthMm}mm 无效（必须 > 0）。` })
          } else if (block.widthMm > 500) {
            issues.push({ level: 'warning', blockId: block.id, code: 'invalid-figure-width', message: `图片宽度 ${block.widthMm}mm 超出合理上限 500mm。` })
          }
        }
        if (block.layoutPreset && !isFigureLayoutPreset(block.layoutPreset)) {
          issues.push({ level: 'warning', blockId: block.id, code: 'invalid-figure-preset', message: `图片排版预设 "${block.layoutPreset}" 无效。` })
        }
        if (block.groupItems?.length) {
          if (![1, 2, 3].includes(block.groupColumns || 2)) {
            issues.push({ level: 'error', blockId: block.id, code: 'invalid-figure-ref', message: '图片组列数只能为 1、2 或 3。' })
          }
          const ids = new Set<string>()
          for (const item of block.groupItems) {
            if (!item.id.trim() || ids.has(item.id)) {
              issues.push({ level: 'error', blockId: block.id, code: 'invalid-figure-ref', message: '图片组项目 ID 不能为空或重复。' })
            }
            ids.add(item.id)
            const itemAsset = item.asset
            const missing = itemAsset.type === 'documentAsset'
              ? !itemAsset.assetId.trim()
              : itemAsset.type === 'questionFigure'
                ? !itemAsset.questionId.trim() || !itemAsset.figureId.trim()
                : !itemAsset.path.trim()
            if (missing) issues.push({ level: 'error', blockId: block.id, code: 'invalid-figure-ref', message: `图片组项目 "${item.id}" 缺少有效资源引用。` })
          }
        }
        break
      }
      case 'tikz':
        if (!block.source.trim()) issues.push({ level: 'warning', blockId: block.id, code: 'empty-tikz-source', message: 'TikZ 绘图缺少源码。' })
        if (!block.svgAssetId) issues.push({ level: 'warning', blockId: block.id, code: 'missing-tikz-preview', message: 'TikZ 绘图尚未生成 SVG 预览。' })
        break
      case 'box':
        if (!block.templateId.trim()) {
          issues.push({ level: 'warning', blockId: block.id, code: 'empty-template-id', message: '盒子块缺少 templateId。' })
        } else if (!getBoxTemplate(block.templateId)) {
          issues.push({ level: 'warning', blockId: block.id, code: 'unknown-template-id', message: `盒子模板 "${block.templateId}" 未注册，将使用稳定降级模板。` })
        }
        for (const child of block.children) {
          // 运行时检查非法子节点（类型系统外的异常数据）
          const childRecord = child as unknown as Record<string, unknown>
          if (childRecord.type === 'box' || childRecord.type === 'heading' || childRecord.type === 'pageBreak') {
            issues.push({ level: 'error', blockId: block.id, code: 'illegal-box-child', message: `盒子包含不允许的子节点类型 "${String(childRecord.type)}"。` })
          }
          if (childRecord.type === 'unknown') {
            issues.push({ level: 'warning', blockId: block.id, code: 'unknown-box-child', message: `盒子包含未识别的子节点（已保留原始数据）。` })
          }
          checkBlock(child as TeachingBlock, depth + 1)
        }
        break
      case 'spacer':
        if (block.heightEm < 0.5 || block.heightEm > 8) {
          issues.push({ level: 'warning', blockId: block.id, code: 'spacer-range', message: `留白高度 ${block.heightEm}em 超出建议范围 0.5~8em。` })
        }
        // 校验 heightMm
        if (block.heightMm != null) {
          if (!Number.isFinite(block.heightMm) || block.heightMm <= 0) {
            issues.push({ level: 'warning', blockId: block.id, code: 'invalid-spacer-height', message: `留白高度 ${block.heightMm}mm 无效（必须 > 0）。` })
          } else if (block.heightMm > 500) {
            issues.push({ level: 'warning', blockId: block.id, code: 'invalid-spacer-height', message: `留白高度 ${block.heightMm}mm 超出合理上限 500mm。` })
          }
        }
        break
      case 'heading':
        if (!block.content.length) {
          issues.push({ level: 'warning', blockId: block.id, code: 'empty-heading', message: '标题块内容为空。' })
        }
        checkInlines(block.content, block.id)
        break
      case 'paragraph':
        checkInlines(block.content, block.id)
        break
      case 'unknown':
        issues.push({ level: 'warning', blockId: block.id, code: 'unknown-block-type', message: `未识别的块类型 "${block.originalType}" 已保留原始数据。` })
        break
      default:
        break
    }
  }

  function checkInlines(inlines: TeachingInline[], blockId: string) {
    for (const inline of inlines) {
      if (inline.type === 'unknown') {
        issues.push({ level: 'warning', blockId, code: 'unknown-inline-node', message: `包含暂不支持的行内节点 "${inline.originalType}"，原始数据已保留。` })
      }
      if (inline.type === 'text' && inline.unknownMarks?.length) {
        issues.push({ level: 'warning', blockId, code: 'unknown-inline-mark', message: `文本包含 ${inline.unknownMarks.length} 个暂不支持的 mark，原值已保留。` })
      }
    }
  }

  for (const block of document.content) {
    checkBlock(block, 0)
  }

  return {
    valid: !issues.some((issue) => issue.level === 'error'),
    issues,
  }
}

const FATAL_TEACHING_DOCUMENT_CODES = new Set([
  'invalid-root',
  'unsupported-version',
  'invalid-document-type',
  'invalid-title',
  'invalid-metadata',
  'invalid-content',
  'empty-id',
  'duplicate-id',
  'absolute-legacy-path',
  'max-depth',
])

/**
 * 保存边界：结构损坏、身份冲突和本地绝对路径属于致命错误。
 * 空题目/图片引用等语义问题仍作为 validation error 展示，但允许原样保存。
 */
export function hasFatalTeachingDocumentIssues(issues: DocumentValidationIssue[]) {
  return issues.some((issue) => issue.level === 'error' && FATAL_TEACHING_DOCUMENT_CODES.has(issue.code))
}

// ─── ID 迁移 ─────────────────────────────────────────────────────────────────

/**
 * 明确的 ID 迁移：为所有使用自动占位 ID 的块生成稳定 ID。
 * 返回新文档（不修改原文档）。保存后 ID 不再变化。
 */
export function migrateDocumentIds(document: TeachingDocument): TeachingDocument {
  function migrateBlock(block: TeachingBlock): TeachingBlock {
    const needsMigration = /_auto_\d+$/.test(block.id)
    const id = needsMigration ? generateBlockId(block.type.slice(0, 3)) : block.id

    if (block.type === 'box') {
      return { ...block, id, children: block.children.map((c) => migrateBlock(c as TeachingBlock)) as BoxChildBlock[] }
    }
    return { ...block, id } as TeachingBlock
  }

  return {
    ...document,
    content: document.content.map(migrateBlock),
  }
}

// ─── 序列化 ──────────────────────────────────────────────────────────────────

/** 序列化文档为 JSON 字符串（安全、确定性） */
export function serializeTeachingDocument(document: TeachingDocument): string {
  return JSON.stringify(document, null, 2)
}

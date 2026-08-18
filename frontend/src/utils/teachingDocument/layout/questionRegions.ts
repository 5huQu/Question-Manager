import type {
  ChoiceOption,
  QuestionFigure,
  QuestionItem,
} from '@/types'
import type {
  FigureAlignment,
  FigureAssetRef,
  InlineText,
  ParagraphBlock,
  QuestionBlock,
  QuestionDisplayOptions,
  QuestionFigurePlacement,
  QuestionFigureSlot,
  QuestionInsertedFigure,
  QuestionInlineContent,
  TeachingInline,
} from '@/types/teachingDocument'
import type { FigureLayoutPreset } from '../figureLayoutPresets'
import { normalizeMarkdownForRender } from '@/components/MarkdownContent'
import { splitHtmlTableSegments } from '@/utils/htmlTables'
import { normalizeLatexMathDelimiters } from '@/utils/mathMarkdown'
import { choiceLayoutForTexts, type ChoiceLayout } from '@/utils/choiceLayout'
import type { ChoiceLayoutOverrides } from '@/utils/choiceLayout'
import {
  figuresByUsage,
  parseChoiceQuestion,
} from '@/utils/questionDisplay'
import { parseInlineMarkdown } from '../markdownCompat'

export type QuestionRegionType =
  | 'heading'
  | 'stem'
  | 'figure'
  | 'options'
  | 'answer'
  | 'analysis'

export type QuestionRegionSplitPolicy =
  | 'never'
  | 'paragraph'
  | 'options'
  | 'children'

export interface QuestionRegionDescriptor {
  key: string
  type: QuestionRegionType
  index: number
  splitPolicy: QuestionRegionSplitPolicy
  keepWithNext?: boolean
}

export interface QuestionHeadingRegion extends QuestionRegionDescriptor {
  type: 'heading'
  kind: 'heading'
}

export interface QuestionParagraphRegion extends QuestionRegionDescriptor {
  type: 'stem' | 'analysis'
  kind: 'paragraph'
  paragraph: ParagraphBlock
  /** 题号由运行时生成，不能随题干局部样式一起持久化。 */
  generatedQuestionNumber?: TeachingInline[]
}

export interface QuestionMarkdownRegion extends QuestionRegionDescriptor {
  type: 'stem' | 'analysis'
  kind: 'markdown'
  markdown: string
}

export interface QuestionMathRegion extends QuestionRegionDescriptor {
  type: 'stem' | 'analysis'
  kind: 'math'
  latex: string
}

export interface QuestionFigureRegion extends QuestionRegionDescriptor {
  type: 'figure'
  kind: 'figure'
  owner: 'stem' | 'analysis'
  figures: QuestionFigure[]
  /** 文档本地插图使用稳定资源引用，题库图则继续使用 figures。 */
  asset?: FigureAssetRef
  /** 用于讲义级尺寸覆盖的稳定题图 id。 */
  figureKey?: string
  missingFigureId?: string
  /** 讲义级图片宽度覆盖（mm） */
  widthOverrideMm?: number
  /** 讲义级对齐覆盖 */
  alignmentOverride?: FigureAlignment
  layoutPreset?: FigureLayoutPreset
  textWrap?: QuestionFigurePlacement['textWrap']
  wrapGapMm?: number
  /** 当前图作为两图并排的起始图时为 true。 */
  groupWithNext?: boolean
  /** 并排组需要容纳的连续题图数量。 */
  groupColumns?: 2 | 3 | 4
  /** 并排组中的题图 key，用于保持选择与尺寸覆盖稳定。 */
  groupFigureKeys?: string[]
  /** 并排组中每张题图的独立宽度覆盖。 */
  groupFigureWidthOverrides?: Record<string, number>
  /** 并排组按统一高度显示。 */
  groupMatchHeight?: boolean
  /** 并排组统一高度（毫米）。 */
  groupHeightMm?: number
}

export interface QuestionOptionsRowRegion extends QuestionRegionDescriptor {
  type: 'options'
  kind: 'options-row'
  rowIndex: number
  optionStart: number
  optionEnd: number
  options: ChoiceOption[]
  layout: ChoiceLayout
  figures: QuestionFigure[]
  /** 可编辑的简单选项内容，key 为选项标签。 */
  inlineContent?: Record<string, TeachingInline[]>
}

export interface QuestionAnswerRegion extends QuestionRegionDescriptor {
  type: 'answer'
  kind: 'answer'
  markdown: string
  figures: QuestionFigure[]
  inlineContent?: TeachingInline[]
}

export interface QuestionLabelRegion extends QuestionRegionDescriptor {
  type: 'analysis'
  kind: 'label'
  label: string
}

export type AnswerSpacePattern = 'blank' | 'lines' | 'grid'

export interface QuestionAnswerSpaceRegion extends QuestionRegionDescriptor {
  type: 'answer'
  kind: 'answer-space'
  /** 留空高度（mm） */
  heightMm: number
  /** 背景样式 */
  pattern: AnswerSpacePattern
  splitAcrossPages: boolean
}

export type QuestionRuntimeRegion =
  | QuestionHeadingRegion
  | QuestionParagraphRegion
  | QuestionMarkdownRegion
  | QuestionMathRegion
  | QuestionFigureRegion
  | QuestionOptionsRowRegion
  | QuestionAnswerRegion
  | QuestionAnswerSpaceRegion
  | QuestionLabelRegion

export interface QuestionRuntimeModel {
  blockId: string
  questionId: string
  displayNumber: string
  score: number
  questionType: string
  regions: QuestionRuntimeRegion[]
}

const FIGURE_MARKER = /<!--\s*DOC2X_FIGURE:([^>\s]+)\s*-->/gi
const BLOCK_MATH = /\$\$([\s\S]*?)\$\$/g

function stableRegionKey(
  blockId: string,
  type: QuestionRegionType,
  index: number,
) {
  return `${blockId}:question:${type}:${index}`
}

export function questionOptionInlineContentKey(regionKey: string, label: string) {
  return `${regionKey}:option:${label}`
}

function figureIds(figure: QuestionFigure) {
  return [figure.id, figure.blockId]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
}

function simpleParagraph(markdown: string) {
  const source = markdown.trim()
  return source.length > 0
    && !/(?:^|\n)\s*(?:#{1,6}\s|[-+*]\s|\d+[.)]\s|>|```|~~~|\|)|<\/?[A-Za-z]|!\[[^\]]*\]\(|(?<!!)\[[^\]]+\]\(|(?<!\\)[*_]|~~|`/.test(source)
}

/** 复杂 Markdown 仍由原渲染器负责；简单文本与行内公式可进入可编辑文字编辑器。 */
export function isEditableQuestionText(value: string) {
  return Boolean(value.trim()) && !/[#*_~`[\]<>|]/.test(value)
}

function inlineContentOrFallback(inlineContent: QuestionInlineContent | undefined, key: string, value: string) {
  if (inlineContent && Object.prototype.hasOwnProperty.call(inlineContent, key)) return inlineContent[key]
  const normalized = normalizeLatexMathDelimiters(value)
  // 块级公式仍交给 MarkdownContent 渲染；内联编辑器只接收行内内容。
  if (/(?:^|\n)\s*\$\$/.test(normalized)) return undefined
  return isEditableQuestionText(normalized) ? parseInlineMarkdown(normalized) : undefined
}

function contentRegions(input: {
  blockId: string
  type: 'stem' | 'analysis'
  markdown: string
  figures: QuestionFigure[]
  startIndex: number
  figureOverrides?: QuestionDisplayOptions['figureOverrides']
  inlineContent?: QuestionInlineContent
}) {
  const regions: QuestionRuntimeRegion[] = []
  const usedFigures = new Set<QuestionFigure>()
  let index = input.startIndex

  const pushText = (source: string) => {
    let cursor = 0
    BLOCK_MATH.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = BLOCK_MATH.exec(source))) {
      const before = source.slice(cursor, match.index)
      before.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean).forEach((part) => {
        const key = stableRegionKey(input.blockId, input.type, index)
        if (simpleParagraph(part)) {
          regions.push({
            key,
            type: input.type,
            index,
            kind: 'paragraph',
            splitPolicy: 'paragraph',
            paragraph: {
              type: 'paragraph',
              id: key,
              content: inlineContentOrFallback(input.inlineContent, key, part) || parseInlineMarkdown(part),
            },
          })
        } else {
          regions.push({
            key,
            type: input.type,
            index,
            kind: 'markdown',
            splitPolicy: 'never',
            markdown: part,
          })
        }
        index += 1
      })
      regions.push({
        key: stableRegionKey(input.blockId, input.type, index),
        type: input.type,
        index,
        kind: 'math',
        splitPolicy: 'never',
        latex: match[1].trim(),
      })
      index += 1
      cursor = match.index + match[0].length
    }
    source.slice(cursor).split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean).forEach((part) => {
      const key = stableRegionKey(input.blockId, input.type, index)
      if (simpleParagraph(part)) {
        regions.push({
          key,
          type: input.type,
          index,
          kind: 'paragraph',
          splitPolicy: 'paragraph',
          paragraph: {
            type: 'paragraph',
            id: key,
              content: inlineContentOrFallback(input.inlineContent, key, part) || parseInlineMarkdown(part),
          },
        })
      } else {
        regions.push({
          key,
          type: input.type,
          index,
          kind: 'markdown',
          splitPolicy: 'never',
          markdown: part,
        })
      }
      index += 1
    })
  }

  // Keep supported HTML tables intact until MarkdownContent renders them. The
  // older general-purpose normalizer intentionally flattens HTML tables to GFM,
  // which would discard rowspan/colspan in a teaching document.
  const normalized = splitHtmlTableSegments(input.markdown)
    .map((segment) => segment.type === 'html-table' ? segment.source : normalizeMarkdownForRender(segment.content))
    .join('')
  let cursor = 0
  FIGURE_MARKER.lastIndex = 0
  let marker: RegExpExecArray | null
  while ((marker = FIGURE_MARKER.exec(normalized))) {
    pushText(normalized.slice(cursor, marker.index))
    const figure = input.figures.find((item) => figureIds(item).includes(marker![1]))
    if (figure) usedFigures.add(figure)
    const figureKey = figure ? (figure.id || figure.blockId || '') : marker[1]
    const override = input.figureOverrides?.[figureKey]
    if (!override?.slot) regions.push({
      key: `${input.blockId}:question:figure:${figureKey || marker[1]}`,
      type: 'figure',
      index,
      kind: 'figure',
      splitPolicy: 'never',
      owner: input.type,
      figures: figure ? [figure] : [],
      figureKey: figure ? (figure.id || figure.blockId || marker[1]) : marker[1],
      missingFigureId: figure?.path ? undefined : marker[1],
      widthOverrideMm: override?.widthMm,
      alignmentOverride: override?.alignment,
      layoutPreset: override?.layoutPreset,
      textWrap: override?.textWrap,
      wrapGapMm: override?.wrapGapMm,
      groupWithNext: override?.groupWithNext,
      groupColumns: override?.groupColumns,
      groupMatchHeight: override?.groupMatchHeight,
      groupHeightMm: override?.groupHeightMm,
    })
    if (!override?.slot) index += 1
    cursor = marker.index + marker[0].length
  }
  pushText(normalized.slice(cursor))
  const trailingFigures = input.figures.filter(
    (figure) => !usedFigures.has(figure) && !input.figureOverrides?.[figure.id || figure.blockId || '']?.slot,
  )
  trailingFigures.forEach((figure) => {
    const figureKey = figure.id || figure.blockId || ''
    const override = input.figureOverrides?.[figureKey]
    regions.push({
      key: `${input.blockId}:question:figure:${figureKey}`,
      type: 'figure',
      index,
      kind: 'figure',
      splitPolicy: 'never',
      owner: input.type,
      figures: [figure],
      figureKey: figure.id || figure.blockId || undefined,
      missingFigureId: figure.path
        ? undefined
        : figureIds(figure)[0] || '未标识题图',
      widthOverrideMm: override?.widthMm,
      alignmentOverride: override?.alignment,
      layoutPreset: override?.layoutPreset,
      textWrap: override?.textWrap,
      wrapGapMm: override?.wrapGapMm,
      groupWithNext: override?.groupWithNext,
      groupColumns: override?.groupColumns,
      groupMatchHeight: override?.groupMatchHeight,
      groupHeightMm: override?.groupHeightMm,
    })
    index += 1
  })
  return regions
}

interface PlacedFigure {
  placement: QuestionFigurePlacement
  stableIndex: number
  region: QuestionFigureRegion
}

function slotVisible(slot: QuestionFigureSlot, display: QuestionDisplayOptions | undefined) {
  if (slot === 'before-answer' || slot === 'after-answer') return display?.showAnswer === true
  if (slot === 'analysis-start' || slot === 'analysis-end') return display?.showAnalysis === true
  return true
}

function insertionIndex(regions: QuestionRuntimeRegion[], slot: QuestionFigureSlot) {
  const first = (type: QuestionRegionType) => regions.findIndex((region) => region.type === type)
  const last = (type: QuestionRegionType) => {
    for (let index = regions.length - 1; index >= 0; index -= 1) if (regions[index].type === type) return index
    return -1
  }
  const stemFirst = first('stem')
  const stemLast = last('stem')
  const optionsFirst = first('options')
  const optionsLast = last('options')
  const answerFirst = first('answer')
  const answerLast = last('answer')
  const analysisFirst = first('analysis')
  const analysisLast = last('analysis')
  switch (slot) {
    case 'stem-start': return stemFirst >= 0 ? stemFirst : 0
    case 'stem-end': return stemLast >= 0 ? stemLast + 1 : 0
    case 'before-options': return optionsFirst >= 0 ? optionsFirst : stemLast + 1
    case 'after-options': return optionsLast >= 0 ? optionsLast + 1 : stemLast + 1
    case 'before-answer': return answerFirst >= 0 ? answerFirst : (optionsLast >= 0 ? optionsLast + 1 : stemLast + 1)
    case 'after-answer': return answerLast >= 0 ? answerLast + 1 : (optionsLast >= 0 ? optionsLast + 1 : stemLast + 1)
    case 'analysis-start': return analysisFirst >= 0 ? analysisFirst : regions.length
    case 'analysis-end': return analysisLast >= 0 ? analysisLast + 1 : regions.length
  }
}

export function applyQuestionFigurePlacements(
  regions: QuestionRuntimeRegion[],
  placed: PlacedFigure[],
  display?: QuestionDisplayOptions,
) {
  const next = [...regions]
  const bySlot = new Map<QuestionFigureSlot, PlacedFigure[]>()
  for (const item of placed) {
    const slot = item.placement.slot
    if (!slot || !slotVisible(slot, display)) continue
    const values = bySlot.get(slot) || []
    values.push(item)
    bySlot.set(slot, values)
  }
  const slots: QuestionFigureSlot[] = ['analysis-end', 'analysis-start', 'after-answer', 'before-answer', 'after-options', 'before-options', 'stem-end', 'stem-start']
  for (const slot of slots) {
    const values = bySlot.get(slot)
    if (!values?.length) continue
    values.sort((a, b) => {
      const aExplicit = Number.isFinite(a.placement.order)
      const bExplicit = Number.isFinite(b.placement.order)
      if (aExplicit !== bExplicit) return aExplicit ? -1 : 1
      if (aExplicit && bExplicit && a.placement.order !== b.placement.order) return Number(a.placement.order) - Number(b.placement.order)
      return a.stableIndex - b.stableIndex
    })
    next.splice(insertionIndex(next, slot), 0, ...values.map((value) => value.region))
  }
  return next
}

/**
 * 将用户标记为“与下一张并排”的连续题图合成一个不可分页的图组区域。
 * 只合并同一题干/解析区域中的题库题图；文档插图和被移动到其他位置的题图保持独立，
 * 避免改变用户明确指定的插入顺序。
 */
export function groupAdjacentQuestionFigures(regions: QuestionRuntimeRegion[]) {
  const grouped: QuestionRuntimeRegion[] = []
  for (let index = 0; index < regions.length; index += 1) {
    const current = regions[index]
    const next = regions[index + 1]
    if (current.kind === 'figure'
      && current.groupWithNext
      && !current.asset) {
      const desiredColumns = current.groupColumns || 2
      const members: QuestionFigureRegion[] = [current]
      for (let offset = 1; offset < desiredColumns; offset += 1) {
        const candidate = regions[index + offset]
        if (candidate?.kind !== 'figure'
          || candidate.asset
          || candidate.owner !== current.owner
          || candidate.figures.length !== 1) break
        members.push(candidate)
      }
      if (members.length < 2) {
        grouped.push(current)
        continue
      }
      grouped.push({
        ...current,
        figures: members.flatMap((member) => member.figures),
        groupFigureKeys: members.map((member) => member.figureKey || member.key),
        groupFigureWidthOverrides: Object.fromEntries(
          members.flatMap((member) => member.figureKey && member.widthOverrideMm != null
            ? [[member.figureKey, member.widthOverrideMm] as const]
            : []),
        ),
        groupMatchHeight: current.groupMatchHeight,
        groupHeightMm: current.groupHeightMm,
        groupWithNext: undefined,
        groupColumns: undefined,
      })
      index += members.length - 1
      continue
    }
    grouped.push(current)
  }
  return grouped
}

/**
 * 左右环绕题图的语义范围是整道题，而不是题图 marker 后面的半段题干。
 * 将启用环绕的题图提升到所属 stem/analysis 内容起点，使题干文字在图片两侧自然排版。
 */
function hoistWrappedQuestionFigures(regions: QuestionRuntimeRegion[]) {
  const next = [...regions]
  for (let index = 0; index < next.length; index += 1) {
    const region = next[index]
    if (region.kind !== 'figure'
      || region.groupFigureKeys?.length
      || (region.textWrap !== 'square-left' && region.textWrap !== 'square-right')) continue
    const ownerType = region.owner === 'analysis' ? 'analysis' : 'stem'
    const firstOwnerIndex = next.findIndex((candidate) => candidate.type === ownerType
      && (candidate.kind === 'paragraph' || candidate.kind === 'markdown'))
    if (firstOwnerIndex >= 0 && index > firstOwnerIndex) {
      next.splice(index, 1)
      next.splice(firstOwnerIndex, 0, region)
    }
  }
  return next
}

/** 题号（及可选分数）对应的行内内容，加粗题号、分数不加粗。 */
function questionNumberInlines(displayNumber: string, score: number, showScore: boolean): InlineText[] {
  if (!displayNumber) return []
  if (showScore && score > 0) {
    return [
      { type: 'text', text: `${displayNumber}.`, marks: ['bold'] },
      { type: 'text', text: `（${score} 分） ` },
    ]
  }
  return [{ type: 'text', text: `${displayNumber}. `, marks: ['bold'] }]
}

function sameTeachingInline(left: TeachingInline, right: TeachingInline) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameInlinePresentation(left: TeachingInline, right: TeachingInline) {
  if (left.type !== 'text' || right.type !== 'text') return false
  return JSON.stringify({ ...left, text: undefined }) === JSON.stringify({ ...right, text: undefined })
}

/** 去掉题号运行时前缀，兼容早期版本已将题号写入 inlineContent 的数据。 */
export function stripGeneratedQuestionNumber(inlines: TeachingInline[], prefix: TeachingInline[]) {
  if (!prefix.length) return inlines
  let offset = 0
  while (offset + prefix.length <= inlines.length
    && prefix.every((inline, index) => sameTeachingInline(inlines[offset + index], inline))) {
    offset += prefix.length
  }
  let next = offset ? inlines.slice(offset) : inlines

  // Tiptap merges adjacent text nodes that have the same marks. In that case
  // several legacy prefixes may arrive as one text node such as "1. 1. 1. ".
  // Strip those repetitions at text level as well.
  const firstPrefix = prefix[0]
  const first = next[0]
  if (prefix.length === 1 && first && firstPrefix
    && first.type === 'text' && firstPrefix.type === 'text') {
    let text = first.text
    let repetitions = 0
    while (text.startsWith(firstPrefix.text)) {
      text = text.slice(firstPrefix.text.length)
      repetitions += 1
    }
    if (text !== first.text && (repetitions >= 2 || sameInlinePresentation(first, firstPrefix))) {
      next = text ? [{ ...first, text }, ...next.slice(1)] : next.slice(1)
    }
  }
  return next
}

/**
 * 将题号内联到首个题干区域，实现“题号.题干”同行显示：
 * - 首区域为段落：题号作为加粗行内内容前置；
 * - 首区域为复杂 markdown：前置转义加粗题号（`**8.**` 开头避免被解析为有序列表）；
 * - 首区域为公式/题图等：题号单独成段（少见兜底）。
 */
function inlineQuestionNumber(
  regions: QuestionRuntimeRegion[],
  blockId: string,
  displayNumber: string,
  score: number,
  showScore: boolean,
) {
  if (!displayNumber) return
  const first = regions[0]
  if (first && first.kind === 'paragraph' && first.type === 'stem') {
    const prefix = questionNumberInlines(displayNumber, score, showScore)
    first.generatedQuestionNumber = prefix
    first.paragraph.content = [
      ...prefix,
      ...stripGeneratedQuestionNumber(first.paragraph.content, prefix),
    ]
    return
  }
  if (first && first.kind === 'markdown' && first.type === 'stem') {
    const scoreText = showScore && score > 0 ? `（${score} 分）` : ''
    first.markdown = `**${displayNumber}.**${scoreText} ${first.markdown}`
    return
  }
  const key = stableRegionKey(blockId, 'stem', -1)
  regions.unshift({
    key,
    type: 'stem',
    index: -1,
    kind: 'paragraph',
    splitPolicy: 'paragraph',
    paragraph: {
      type: 'paragraph',
      id: key,
      content: questionNumberInlines(displayNumber, score, showScore),
    },
  })
}

export function createQuestionRuntimeModel(
  block: QuestionBlock,
  question: QuestionItem,
  options: {
    choiceLayoutOverrides?: ChoiceLayoutOverrides
    probeChoiceLayouts?: boolean
  } = {},
): QuestionRuntimeModel {
  const displayNumber = block.display?.displayNumber || question.questionNo || ''
  const score = block.display?.scoreOverride ?? question.totalScore
  const showScore = block.display?.showScore === true
  const figureOverrides = block.display?.figureOverrides
  const inlineContent = block.display?.inlineContent
  // 题库预览在 MarkdownContent 中会先统一 \(...\) / \[...\] 定界符；
  // 讲义编辑器会把选项拆到内联编辑器，必须在拆分前使用同一规则。
  const normalizedStemMarkdown = normalizeLatexMathDelimiters(question.stemMarkdown)
  const parsedChoice = parseChoiceQuestion(normalizedStemMarkdown)
  const stemMarkdown = parsedChoice?.stem || normalizedStemMarkdown || '题干为空'
  const stemFigures = figuresByUsage(question.figures, 'stem')
  const optionFigures = figuresByUsage(question.figures, 'options')
  const answerFigures = figuresByUsage(question.figures, 'answer')
  const analysisFigures = figuresByUsage(question.figures, 'analysis')
  const regions: QuestionRuntimeRegion[] = []
  const placed: PlacedFigure[] = []
  const figureByKey = new Map(question.figures.flatMap((figure) => figureIds(figure).map((key) => [key, figure] as const)))
  for (const [figureKey, placement] of Object.entries(figureOverrides || {})) {
    if (!placement.slot) continue
    const figure = figureByKey.get(figureKey)
    if (!figure) continue
    placed.push({
      placement,
      stableIndex: question.figures.indexOf(figure),
      region: {
        key: `${block.id}:question:figure:${figureKey}`,
        type: 'figure', index: 0, kind: 'figure', splitPolicy: 'never',
        owner: placement.slot.startsWith('analysis') ? 'analysis' : 'stem',
        figures: [figure], figureKey,
        widthOverrideMm: placement.widthMm,
        alignmentOverride: placement.alignment,
        layoutPreset: placement.layoutPreset,
        textWrap: placement.textWrap,
        wrapGapMm: placement.wrapGapMm,
        groupWithNext: placement.groupWithNext,
        groupColumns: placement.groupColumns,
        groupMatchHeight: placement.groupMatchHeight,
        groupHeightMm: placement.groupHeightMm,
      },
    })
  }

  regions.push(...contentRegions({
    blockId: block.id,
    type: 'stem',
    markdown: stemMarkdown,
    figures: stemFigures,
    startIndex: 0,
    figureOverrides,
    inlineContent,
  }))

  inlineQuestionNumber(regions, block.id, displayNumber, score, showScore)

  if (parsedChoice?.options.length) {
    // 选项按排版行建模，使分页器可以在“行”之间换页，同时保证单个选项
    // 不被截断。四栏=1 行、双栏=2 行、单栏=4 行；题图强制单栏。
    const heuristicLayout = choiceLayoutForTexts(
      parsedChoice.options.map((option) => option.content),
      optionFigures.length > 0,
    )
    // 纸张排版的首轮由真实 KaTeX 宽度探测列数；首轮完成后固定结果，
    // 使选项行模型、测量高度和最终分页使用同一个列数。
    const configuredLayout = block.display?.choiceLayout || 'auto'
    const explicitLayout = configuredLayout === 'four'
      ? 'quad'
      : configuredLayout === 'two'
        ? 'double'
        : configuredLayout === 'one'
          ? 'single'
          : undefined
    const layout = explicitLayout
      || options.choiceLayoutOverrides?.[block.id]
      || (options.probeChoiceLayouts && !optionFigures.length && parsedChoice.options.length === 4
        ? 'adaptive'
        : heuristicLayout)
    const columns = layout === 'quad' || layout === 'adaptive' ? 4 : layout === 'double' ? 2 : 1
    for (let optionStart = 0, rowIndex = 0; optionStart < parsedChoice.options.length; optionStart += columns, rowIndex += 1) {
      const optionEnd = Math.min(parsedChoice.options.length, optionStart + columns)
      const rowOptions = parsedChoice.options.slice(optionStart, optionEnd)
      const rowLabels = new Set(rowOptions.map((option) => option.label))
      const rowKey = stableRegionKey(block.id, 'options', rowIndex)
      const rowInlineContent = Object.fromEntries(rowOptions.flatMap((option) => {
        const key = questionOptionInlineContentKey(rowKey, option.label)
        const value = inlineContentOrFallback(inlineContent, key, option.content)
        return value ? [[option.label, value] as const] : []
      }))
      regions.push({
        key: rowKey,
        type: 'options',
        index: rowIndex,
        kind: 'options-row',
        splitPolicy: 'options',
        rowIndex,
        optionStart,
        optionEnd,
        options: rowOptions,
        layout,
        figures: optionFigures.filter((figure) => !figureOverrides?.[figure.id || figure.blockId || '']?.slot && (
          figure.optionLabel ? rowLabels.has(figure.optionLabel) : rowIndex === 0
        )),
        inlineContent: Object.keys(rowInlineContent).length ? rowInlineContent : undefined,
      })
    }
    if (parsedChoice.remainder) {
      regions.push(...contentRegions({
        blockId: block.id,
        type: 'stem',
        markdown: parsedChoice.remainder,
        figures: [],
        startIndex: regions.filter((region) => region.type === 'stem').length,
        figureOverrides,
        inlineContent,
      }))
    }
  }

  if (block.display?.showAnswer && question.answerText.trim()) {
    const key = stableRegionKey(block.id, 'answer', 0)
    regions.push({
      key,
      type: 'answer',
      index: 0,
      kind: 'answer',
      splitPolicy: 'never',
      markdown: question.answerText,
      figures: answerFigures,
      inlineContent: inlineContentOrFallback(inlineContent, key, question.answerText),
    })
  }
  if (block.display?.showAnalysis && question.analysisMarkdown.trim()) {
    regions.push({
      key: stableRegionKey(block.id, 'analysis', -1),
      type: 'analysis',
      index: -1,
      kind: 'label',
      splitPolicy: 'never',
      keepWithNext: true,
      label: '解析：',
    })
    regions.push(...contentRegions({
      blockId: block.id,
      type: 'analysis',
      markdown: question.analysisMarkdown,
      figures: analysisFigures,
      startIndex: 0,
      figureOverrides,
      inlineContent,
    }))
  }

  for (const figure of block.display?.insertedFigures || []) {
    placed.push({
      placement: figure,
      stableIndex: question.figures.length + (block.display?.insertedFigures || []).indexOf(figure),
      region: {
        key: `${block.id}:question:inserted-figure:${figure.id}`,
        type: 'figure', index: 0, kind: 'figure', splitPolicy: 'never',
        owner: figure.slot.startsWith('analysis') ? 'analysis' : 'stem',
        figures: [], asset: figure.asset, figureKey: figure.id,
        widthOverrideMm: figure.widthMm,
        alignmentOverride: figure.alignment,
        layoutPreset: figure.layoutPreset,
        textWrap: figure.textWrap,
        wrapGapMm: figure.wrapGapMm,
        groupWithNext: figure.groupWithNext,
        groupColumns: figure.groupColumns,
        groupMatchHeight: figure.groupMatchHeight,
        groupHeightMm: figure.groupHeightMm,
      },
    })
  }

  // 题目回答留空区域（讲义级覆盖，不影响题库）
  const answerSpace = block.display?.answerSpace
  if (answerSpace && answerSpace.heightMm > 0) {
    regions.push({
      key: stableRegionKey(block.id, 'answer', 999),
      type: 'answer',
      index: 999,
      kind: 'answer-space',
      splitPolicy: 'never',
      heightMm: answerSpace.heightMm,
      pattern: answerSpace.style ?? 'blank',
      splitAcrossPages: answerSpace.splitAcrossPages === true,
    })
  }

  return {
    blockId: block.id,
    questionId: block.questionId,
    displayNumber,
    score,
    questionType: question.questionType,
    regions: hoistWrappedQuestionFigures(groupAdjacentQuestionFigures(applyQuestionFigurePlacements(regions, placed, block.display))),
  }
}

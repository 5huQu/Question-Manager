import type {
  ChoiceOption,
  QuestionFigure,
  QuestionItem,
} from '@/types'
import type {
  FigureAlignment,
  InlineText,
  ParagraphBlock,
  QuestionBlock,
  QuestionDisplayOptions,
} from '@/types/teachingDocument'
import { normalizeMarkdownForRender } from '@/components/MarkdownContent'
import { choiceLayoutForTexts, type ChoiceLayout } from '@/utils/choiceLayout'
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
  /** 用于讲义级尺寸覆盖的稳定题图 id。 */
  figureKey?: string
  missingFigureId?: string
  /** 讲义级图片宽度覆盖（mm） */
  widthOverrideMm?: number
  /** 讲义级对齐覆盖 */
  alignmentOverride?: FigureAlignment
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
}

export interface QuestionAnswerRegion extends QuestionRegionDescriptor {
  type: 'answer'
  kind: 'answer'
  markdown: string
  figures: QuestionFigure[]
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

function contentRegions(input: {
  blockId: string
  type: 'stem' | 'analysis'
  markdown: string
  figures: QuestionFigure[]
  startIndex: number
  figureOverrides?: QuestionDisplayOptions['figureOverrides']
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
              content: parseInlineMarkdown(part),
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
            content: parseInlineMarkdown(part),
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

  const normalized = normalizeMarkdownForRender(input.markdown)
  let cursor = 0
  FIGURE_MARKER.lastIndex = 0
  let marker: RegExpExecArray | null
  while ((marker = FIGURE_MARKER.exec(normalized))) {
    pushText(normalized.slice(cursor, marker.index))
    const figure = input.figures.find((item) => figureIds(item).includes(marker![1]))
    if (figure) usedFigures.add(figure)
    const figureKey = figure ? (figure.id || figure.blockId || '') : marker[1]
    const override = input.figureOverrides?.[figureKey]
    regions.push({
      key: stableRegionKey(input.blockId, 'figure', index),
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
    })
    index += 1
    cursor = marker.index + marker[0].length
  }
  pushText(normalized.slice(cursor))
  const trailingFigures = input.figures.filter(
    (figure) => !usedFigures.has(figure),
  )
  trailingFigures.forEach((figure) => {
    const figureKey = figure.id || figure.blockId || ''
    const override = input.figureOverrides?.[figureKey]
    regions.push({
      key: stableRegionKey(input.blockId, 'figure', index),
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
    })
    index += 1
  })
  return regions
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
    first.paragraph.content = [
      ...questionNumberInlines(displayNumber, score, showScore),
      ...first.paragraph.content,
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
): QuestionRuntimeModel {
  const displayNumber = block.display?.displayNumber || question.questionNo || ''
  const score = block.display?.scoreOverride ?? question.totalScore
  const showScore = block.display?.showScore === true
  const figureOverrides = block.display?.figureOverrides
  const parsedChoice = parseChoiceQuestion(question.stemMarkdown)
  const stemMarkdown = parsedChoice?.stem || question.stemMarkdown || '题干为空'
  const stemFigures = figuresByUsage(question.figures, 'stem')
  const optionFigures = figuresByUsage(question.figures, 'options')
  const analysisFigures = figuresByUsage(question.figures, 'analysis')
  const regions: QuestionRuntimeRegion[] = []

  regions.push(...contentRegions({
    blockId: block.id,
    type: 'stem',
    markdown: stemMarkdown,
    figures: stemFigures,
    startIndex: 0,
    figureOverrides,
  }))

  inlineQuestionNumber(regions, block.id, displayNumber, score, showScore)

  if (parsedChoice?.options.length) {
    // 选项按排版行建模，使分页器可以在“行”之间换页，同时保证单个选项
    // 不被截断。四栏=1 行、双栏=2 行、单栏=4 行；题图强制单栏。
    const layout = choiceLayoutForTexts(
      parsedChoice.options.map((option) => option.content),
      optionFigures.length > 0,
    )
    const columns = layout === 'quad' ? 4 : layout === 'double' ? 2 : 1
    for (let optionStart = 0, rowIndex = 0; optionStart < parsedChoice.options.length; optionStart += columns, rowIndex += 1) {
      const optionEnd = Math.min(parsedChoice.options.length, optionStart + columns)
      const rowOptions = parsedChoice.options.slice(optionStart, optionEnd)
      const rowLabels = new Set(rowOptions.map((option) => option.label))
      regions.push({
        key: stableRegionKey(block.id, 'options', rowIndex),
        type: 'options',
        index: rowIndex,
        kind: 'options-row',
        splitPolicy: 'options',
        rowIndex,
        optionStart,
        optionEnd,
        options: rowOptions,
        layout,
        figures: optionFigures.filter((figure) => (
          figure.optionLabel ? rowLabels.has(figure.optionLabel) : rowIndex === 0
        )),
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
      }))
    }
  }

  if (block.display?.showAnswer && question.answerText.trim()) {
    regions.push({
      key: stableRegionKey(block.id, 'answer', 0),
      type: 'answer',
      index: 0,
      kind: 'answer',
      splitPolicy: 'never',
      markdown: question.answerText,
      figures: question.figures,
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
    }))
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
    })
  }

  return {
    blockId: block.id,
    questionId: block.questionId,
    displayNumber,
    score,
    questionType: question.questionType,
    regions,
  }
}

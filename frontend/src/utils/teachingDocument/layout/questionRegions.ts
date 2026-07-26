import type {
  ChoiceOption,
  QuestionFigure,
  QuestionItem,
} from '@/types'
import type {
  ParagraphBlock,
  QuestionBlock,
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
  missingFigureId?: string
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

export type QuestionRuntimeRegion =
  | QuestionHeadingRegion
  | QuestionParagraphRegion
  | QuestionMarkdownRegion
  | QuestionMathRegion
  | QuestionFigureRegion
  | QuestionOptionsRowRegion
  | QuestionAnswerRegion
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
    regions.push({
      key: stableRegionKey(input.blockId, 'figure', index),
      type: 'figure',
      index,
      kind: 'figure',
      splitPolicy: 'never',
      owner: input.type,
      figures: figure ? [figure] : [],
      missingFigureId: figure?.path ? undefined : marker[1],
    })
    index += 1
    cursor = marker.index + marker[0].length
  }
  pushText(normalized.slice(cursor))
  const trailingFigures = input.figures.filter(
    (figure) => !usedFigures.has(figure),
  )
  trailingFigures.forEach((figure) => {
    regions.push({
      key: stableRegionKey(input.blockId, 'figure', index),
      type: 'figure',
      index,
      kind: 'figure',
      splitPolicy: 'never',
      owner: input.type,
      figures: [figure],
      missingFigureId: figure.path
        ? undefined
        : figureIds(figure)[0] || '未标识题图',
    })
    index += 1
  })
  return regions
}

export function createQuestionRuntimeModel(
  block: QuestionBlock,
  question: QuestionItem,
): QuestionRuntimeModel {
  const displayNumber = block.display?.displayNumber || question.questionNo || ''
  const score = block.display?.scoreOverride ?? question.totalScore
  const parsedChoice = parseChoiceQuestion(question.stemMarkdown)
  const stemMarkdown = parsedChoice?.stem || question.stemMarkdown || '题干为空'
  const stemFigures = figuresByUsage(question.figures, 'stem')
  const optionFigures = figuresByUsage(question.figures, 'options')
  const analysisFigures = figuresByUsage(question.figures, 'analysis')
  const regions: QuestionRuntimeRegion[] = [{
    key: stableRegionKey(block.id, 'heading', 0),
    type: 'heading',
    index: 0,
    kind: 'heading',
    splitPolicy: 'never',
    keepWithNext: true,
  }]

  regions.push(...contentRegions({
    blockId: block.id,
    type: 'stem',
    markdown: stemMarkdown,
    figures: stemFigures,
    startIndex: 0,
  }))

  if (parsedChoice?.options.length) {
    const layout = choiceLayoutForTexts(
      parsedChoice.options.map((option) => option.content),
      optionFigures.some((figure) => Boolean(figure.path)),
    )
    const rowSize = layout === 'quad' ? 4 : layout === 'double' ? 2 : 1
    for (let optionStart = 0, rowIndex = 0; optionStart < parsedChoice.options.length; optionStart += rowSize, rowIndex += 1) {
      const options = parsedChoice.options.slice(optionStart, optionStart + rowSize)
      regions.push({
        key: stableRegionKey(block.id, 'options', rowIndex),
        type: 'options',
        index: rowIndex,
        kind: 'options-row',
        splitPolicy: 'options',
        rowIndex,
        optionStart,
        optionEnd: optionStart + options.length,
        options,
        layout,
        figures: optionFigures.filter((figure) => options.some(
          (option) => String(figure.optionLabel || '').toUpperCase() === option.label,
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
    }))
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

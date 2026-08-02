/**
 * 测量编排器：把一整套 DOM 测量合并为单次块元素查询。
 *
 * 原先分页管线对同一组块元素做了 5 次相同的 querySelectorAll（measure /
 * paragraphs / boxes / questions / boxChildQuestions），每轮测量都是重复遍历。
 * 编排器只查询一次顶层块列表与段落块列表，把元素列表分发给各测量函数
 * （各函数保留默认自查询路径，独立调用与测试不受影响）。
 */
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { measureTeachingDocument, type GeometryAdapter } from './measure'
import { TEACHING_DOM, TEACHING_DOM_SELECTORS } from './domContract'
import { measureTeachingDocumentParagraphs, type ParagraphMeasurement } from './paragraphMeasurement'
import {
  measureTeachingDocumentBoxes,
  type BoxChromeGeometryAdapter,
  type BoxMeasurement,
} from './boxMeasurement'
import {
  measureBoxChildQuestions,
  measureTeachingDocumentQuestions,
  type QuestionChromeGeometryAdapter,
  type QuestionMeasurement,
  type QuestionResolutionLike,
} from './questionMeasurement'
import { measureBoxChildRawMarkdowns, type RawMarkdownMeasurement } from './rawMarkdownMeasurement'
import type { ChoiceLayoutOverrides } from '@/utils/choiceLayout'
import type { ParagraphRangeGeometryAdapter } from './paragraphMeasurement'
import type { TeachingDocumentMeasurement } from './types'

export interface MeasurementAdapters {
  geometry?: GeometryAdapter
  paragraphGeometry?: ParagraphRangeGeometryAdapter
  boxGeometry?: BoxChromeGeometryAdapter
  questionGeometry?: QuestionChromeGeometryAdapter
}

export interface TeachingDocumentMeasurementBundle {
  measurement: TeachingDocumentMeasurement
  paragraphs: ParagraphMeasurement[]
  boxes: BoxMeasurement[]
  questions: QuestionMeasurement[]
  boxChildQuestions: Map<string, QuestionMeasurement>
  boxChildRawMarkdowns: RawMarkdownMeasurement[]
}

export function measureTeachingDocumentAll(
  root: HTMLElement,
  document: TeachingDocumentV1,
  adapters: MeasurementAdapters = {},
  resolveQuestion?: (questionId: string) => QuestionResolutionLike,
  choiceLayoutOverrides?: ChoiceLayoutOverrides,
): TeachingDocumentMeasurementBundle {
  // 单次块元素查询；顶层/段落子集由过滤器派生，与各测量函数内部的查询语义一致。
  const allBlocks = Array.from(root.querySelectorAll<HTMLElement>(TEACHING_DOM_SELECTORS.block))
  const topLevelBlocks = allBlocks.filter((element) => !element.parentElement?.closest(TEACHING_DOM_SELECTORS.block))
  const paragraphBlocks = allBlocks.filter((element) => element.getAttribute(TEACHING_DOM.blockType) === 'paragraph')

  const documentMeasurement = measureTeachingDocument(root, document, adapters.geometry)
  const paragraphs = measureTeachingDocumentParagraphs(root, document, adapters.paragraphGeometry, paragraphBlocks)
  const boxes = measureTeachingDocumentBoxes(root, document, documentMeasurement, adapters.boxGeometry, topLevelBlocks)
  const questions = measureTeachingDocumentQuestions(
    root,
    document,
    documentMeasurement,
    resolveQuestion,
    adapters.geometry,
    adapters.paragraphGeometry,
    adapters.questionGeometry,
    choiceLayoutOverrides,
    topLevelBlocks,
  )
  const boxChildQuestions = measureBoxChildQuestions(
    root,
    document,
    documentMeasurement,
    resolveQuestion,
    adapters.geometry,
    adapters.paragraphGeometry,
    adapters.questionGeometry,
    choiceLayoutOverrides,
    topLevelBlocks,
  )
  const boxChildRawMarkdowns = measureBoxChildRawMarkdowns(root, document)
  return { measurement: documentMeasurement, paragraphs, boxes, questions, boxChildQuestions, boxChildRawMarkdowns }
}

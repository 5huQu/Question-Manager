import type { QuestionItem } from '@/types'
import type { BoxBlock, QuestionBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import type { ChoiceLayoutOverrides } from '@/utils/choiceLayout'
import { TEACHING_DOM, TEACHING_DOM_SELECTORS } from './domContract'
import { blockSourcePathKey, type BlockSourcePath } from './fragment'
import type { GeometryAdapter } from './measure'
import { browserGeometryAdapter } from './measure'
import {
  browserParagraphRangeGeometryAdapter,
  measureParagraphLines,
  type ParagraphMeasurement,
  type ParagraphRangeGeometryAdapter,
} from './paragraphMeasurement'
import {
  createQuestionRuntimeModel,
  type QuestionRegionSplitPolicy,
  type QuestionRegionType,
  type QuestionRuntimeModel,
} from './questionRegions'
import type {
  RenderDiagnostic,
  TeachingDocumentMeasurement,
} from './types'

export interface QuestionRegionMeasurement {
  key: string
  type: QuestionRegionType
  index: number
  splitPolicy: QuestionRegionSplitPolicy
  height: number
  top: number
  bottom: number
  optionStart?: number
  optionEnd?: number
  rowIndex?: number
  optionMeasurements?: Array<{
    optionIndex: number
    rowIndex: number
    width: number
    height: number
    splitPolicy: 'never'
  }>
  paragraphMeasurement?: ParagraphMeasurement
}

export interface QuestionMeasurement {
  blockId: string
  questionId: string
  sourceIndex: number
  totalHeight: number
  headingHeight: number
  fragmentChrome: {
    single: number
    start: number
    middle: number
    end: number
  }
  model: QuestionRuntimeModel
  regions: QuestionRegionMeasurement[]
  diagnostics: RenderDiagnostic[]
  measurementVersion: string
}

export interface QuestionChromeGeometryAdapter {
  margins(root: HTMLElement): { marginTop: number; marginBottom: number }
}

export const browserQuestionChromeGeometryAdapter: QuestionChromeGeometryAdapter = {
  margins(root) {
    const style = root.ownerDocument.defaultView?.getComputedStyle(root)
    return {
      marginTop: Number.parseFloat(style?.marginTop || '0') || 0,
      marginBottom: Number.parseFloat(style?.marginBottom || '0') || 0,
    }
  },
}

export type QuestionResolutionLike =
  | QuestionItem
  | { status: 'loading' | 'error' | 'missing'; message?: string }
  | undefined

function isQuestionItem(value: QuestionResolutionLike): value is QuestionItem {
  return Boolean(value && !('status' in value))
}

// Measurement must use the same document-local content that the renderer uses.
function effectiveQuestionContent(block: QuestionBlock, question: QuestionItem): QuestionItem {
  return block.localContent ? { ...question, ...block.localContent } : question
}

function versionForQuestion(input: Omit<QuestionMeasurement, 'measurementVersion'>) {
  const source = [
    input.blockId,
    input.questionId,
    input.sourceIndex,
    input.totalHeight,
    input.fragmentChrome.single,
    input.fragmentChrome.start,
    input.fragmentChrome.middle,
    input.fragmentChrome.end,
    ...input.regions.flatMap((region) => [
      region.key,
      region.type,
      region.index,
      region.height,
      region.optionStart ?? '',
      region.optionEnd ?? '',
      region.rowIndex ?? '',
      ...(region.optionMeasurements || []).flatMap((option) => [
        option.optionIndex,
        option.rowIndex,
        option.width,
        option.height,
      ]),
      region.paragraphMeasurement?.measurementVersion || '',
    ]),
  ].join('|')
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `q-${(hash >>> 0).toString(16)}`
}

function validGeometry(values: number[]) {
  return values.every(Number.isFinite) && values.every((value) => value >= 0)
}

/**
 * 题目区域测量核心：顶层题目与 box 子题共用。
 * 统一产出区域缺失/重复、零高/NaN/负值、题图未解析、
 * option 索引重复或缺失等诊断，避免 box 子题诊断缺失。
 */
export interface MeasureQuestionCoreInput {
  root: HTMLElement
  geometry: GeometryAdapter
  paragraphGeometry: ParagraphRangeGeometryAdapter
  chromeGeometry: QuestionChromeGeometryAdapter
  block: QuestionBlock
  question: QuestionItem
  sourceIndex: number
  /** 稳定 source path（顶层题目 childPath 为空；box 子题含 childIndex/blockId） */
  sourcePath: BlockSourcePath
  questionRoot: HTMLElement | null
  /** 顶层题目传入 shell 顶层测量高度；box 子题省略，按区域与外边距总和计算 */
  shellHeight?: number
  /** 诊断消息前缀，例如 `题目 ${qid}` 或 `盒子内题目 ${qid}` */
  label: string
  choiceLayoutOverrides?: ChoiceLayoutOverrides
}

export function measureQuestionCore(input: MeasureQuestionCoreInput): QuestionMeasurement {
  const {
    root, geometry, paragraphGeometry, chromeGeometry,
    block, question, sourceIndex, sourcePath, questionRoot, shellHeight, label, choiceLayoutOverrides,
  } = input
  const diagnostics: RenderDiagnostic[] = []
  const model = createQuestionRuntimeModel(block, question, { choiceLayoutOverrides })

  const regionElements = new Map<string, HTMLElement[]>()
  questionRoot?.querySelectorAll<HTMLElement>(
    `:scope > [${TEACHING_DOM.questionRegion}]`,
  ).forEach((element) => {
    const key = element.getAttribute(TEACHING_DOM.questionRegionKey) || ''
    regionElements.set(key, [...(regionElements.get(key) || []), element])
  })

  const regionMeasurements: QuestionRegionMeasurement[] = model.regions.map((region) => {
    const matches = regionElements.get(region.key) || []
    const element = matches[0]
    if (matches.length !== 1 || !element) {
      diagnostics.push({
        code: 'question-region-missing',
        severity: 'error',
        blockId: block.id,
        questionId: block.questionId,
        region: region.type,
        message: `${label} 的区域 ${region.key} 缺失或重复。`,
      })
    }
    const rect = element
      ? geometry.measure(element, root)
      : { width: 0, height: 0, top: 0, bottom: 0 }
    if (!validGeometry([rect.width, rect.height, rect.top, rect.bottom])
      || rect.bottom < rect.top || rect.height === 0) {
      diagnostics.push({
        code: 'invalid-measurement',
        severity: rect.height === 0 ? 'warning' : 'error',
        blockId: block.id,
        questionId: block.questionId,
        region: region.type,
        message: `${label} 的区域 ${region.key} 几何无效或高度为零。`,
      })
    }
    if (region.kind === 'figure'
      && (!region.figures.length || region.figures.every((figure) => !figure.path))) {
      diagnostics.push({
        code: 'question-resource-unresolved',
        severity: 'warning',
        blockId: block.id,
        questionId: block.questionId,
        region: region.type,
        message: `${label} 的题图 ${region.missingFigureId || region.key} 缺少可解析资源。`,
      })
    }
    if (region.kind === 'options-row' && region.figures.some((figure) => !figure.path)) {
      diagnostics.push({
        code: 'question-resource-unresolved',
        severity: 'warning',
        blockId: block.id,
        questionId: block.questionId,
        region: region.type,
        optionIndex: region.optionStart,
        message: `${label} 的选项行 ${region.rowIndex} 包含缺失图片资源。`,
      })
    }
    let paragraphMeasurement: ParagraphMeasurement | undefined
    if (region.kind === 'paragraph' && element) {
      paragraphMeasurement = measureParagraphLines(
        root,
        region.paragraph,
        sourceIndex,
        element,
        paragraphGeometry,
        sourcePath,
      )
      diagnostics.push(...paragraphMeasurement.diagnostics)
    }
    const optionMeasurements = region.kind === 'options-row' && element
      ? Array.from(element.querySelectorAll<HTMLElement>(
          `[${TEACHING_DOM.questionOptionIndex}]`,
        )).map((optionElement) => {
          const optionIndex = Number(
            optionElement.getAttribute(TEACHING_DOM.questionOptionIndex),
          )
          const rowIndex = Number(
            optionElement.getAttribute(TEACHING_DOM.questionOptionRow),
          )
          const optionRect = geometry.measure(optionElement, root)
          if (!Number.isInteger(optionIndex)
            || !Number.isInteger(rowIndex)
            || !validGeometry([optionRect.width, optionRect.height])
            || optionRect.height === 0) {
            diagnostics.push({
              code: 'invalid-measurement',
              severity: 'error',
              blockId: block.id,
              questionId: block.questionId,
              region: region.type,
              optionIndex: Number.isInteger(optionIndex) ? optionIndex : undefined,
              message: `${label} 的选项几何或索引无效。`,
            })
          }
          return {
            optionIndex,
            rowIndex,
            width: Number.isFinite(optionRect.width) && optionRect.width >= 0
              ? optionRect.width
              : 0,
            height: Number.isFinite(optionRect.height) && optionRect.height >= 0
              ? optionRect.height
              : 0,
            splitPolicy: 'never' as const,
          }
        })
      : undefined
    if (optionMeasurements && region.kind === 'options-row') {
      const seen = new Set<number>()
      optionMeasurements.forEach((option) => {
        if (seen.has(option.optionIndex)) {
          diagnostics.push({
            code: 'question-options-fragment-invalid',
            severity: 'error',
            blockId: block.id,
            questionId: block.questionId,
            region: region.type,
            optionIndex: option.optionIndex,
            message: `${label} 的选项索引 ${option.optionIndex} 重复。`,
          })
        }
        seen.add(option.optionIndex)
      })
      const expected = Array.from(
        { length: region.optionEnd - region.optionStart },
        (_, offset) => region.optionStart + offset,
      )
      if (expected.some((optionIndex) => !seen.has(optionIndex))) {
        diagnostics.push({
          code: 'question-options-fragment-invalid',
          severity: 'error',
          blockId: block.id,
          questionId: block.questionId,
          region: region.type,
          message: `${label} 的选项行 ${region.rowIndex} 未完整测量。`,
        })
      }
    }
    return {
      key: region.key,
      type: region.type,
      index: region.index,
      splitPolicy: region.splitPolicy,
      height: Number.isFinite(rect.height) && rect.height >= 0 ? rect.height : 0,
      top: Number.isFinite(rect.top) ? rect.top : 0,
      bottom: Number.isFinite(rect.bottom) ? rect.bottom : 0,
      ...(region.kind === 'options-row'
        ? {
            optionStart: region.optionStart,
            optionEnd: region.optionEnd,
            rowIndex: region.rowIndex,
          }
        : {}),
      optionMeasurements,
      paragraphMeasurement,
    }
  })

  const margins = questionRoot
    ? chromeGeometry.margins(questionRoot)
    : { marginTop: 0, marginBottom: 0 }
  if (!validGeometry([margins.marginTop, margins.marginBottom])) {
    diagnostics.push({
      code: 'invalid-measurement',
      severity: 'error',
      blockId: block.id,
      questionId: block.questionId,
      message: `${label} 的外边距测量无效。`,
    })
  }
  const safeTop = Number.isFinite(margins.marginTop) && margins.marginTop >= 0
    ? margins.marginTop
    : 0
  const safeBottom = Number.isFinite(margins.marginBottom) && margins.marginBottom >= 0
    ? margins.marginBottom
    : 0
  const computedTotal = regionMeasurements.reduce((sum, region) => sum + region.height, 0)
    + safeTop + safeBottom
  const withoutVersion = {
    blockId: block.id,
    questionId: block.questionId,
    sourceIndex,
    totalHeight: shellHeight ?? computedTotal,
    headingHeight: regionMeasurements.find((region) => region.type === 'heading')?.height || 0,
    fragmentChrome: {
      single: safeTop + safeBottom,
      start: safeTop,
      middle: 0,
      end: safeBottom,
    },
    model,
    regions: regionMeasurements,
    diagnostics,
  }
  return {
    ...withoutVersion,
    measurementVersion: versionForQuestion(withoutVersion),
  }
}

export function measureTeachingDocumentQuestions(
  root: HTMLElement,
  document: TeachingDocumentV1,
  documentMeasurement: TeachingDocumentMeasurement,
  resolveQuestion?: (questionId: string) => QuestionResolutionLike,
  geometry: GeometryAdapter = browserGeometryAdapter,
  paragraphGeometry: ParagraphRangeGeometryAdapter = browserParagraphRangeGeometryAdapter,
  chromeGeometry: QuestionChromeGeometryAdapter = browserQuestionChromeGeometryAdapter,
  choiceLayoutOverrides?: ChoiceLayoutOverrides,
  /** 编排器传入已查询的顶层块元素，避免同轮重复 querySelectorAll。 */
  topLevelElements?: HTMLElement[],
) {
  const result: QuestionMeasurement[] = []
  const topElementsResolved = topLevelElements ?? Array.from(
    root.querySelectorAll<HTMLElement>(TEACHING_DOM_SELECTORS.block),
  ).filter((element) => !element.parentElement?.closest(TEACHING_DOM_SELECTORS.block))
  const elementBySource = new Map<number, HTMLElement>()
  topElementsResolved.forEach((element) => {
    const sourceIndex = Number(element.getAttribute(TEACHING_DOM.sourceIndex))
    if (Number.isInteger(sourceIndex)) elementBySource.set(sourceIndex, element)
  })
  const blockMeasurementBySource = new Map(
    documentMeasurement.blocks
      .filter((measurement) => measurement.sourceIndex !== undefined)
      .map((measurement) => [measurement.sourceIndex as number, measurement]),
  )

  document.content.forEach((block, sourceIndex) => {
    if (block.type !== 'question') return
    const question = resolveQuestion?.(block.questionId)
    if (!isQuestionItem(question)) return
    const shell = elementBySource.get(sourceIndex)
    const questionRoot = shell?.querySelector<HTMLElement>(
      `[${TEACHING_DOM.questionRoot}]`,
    ) || null
    const blockMeasurement = blockMeasurementBySource.get(sourceIndex)
    const shellDiagnostics: RenderDiagnostic[] = []
    if (!shell || !questionRoot || !blockMeasurement) {
      shellDiagnostics.push({
        code: 'question-measurement-missing',
        severity: 'error',
        blockId: block.id,
        questionId: block.questionId,
        message: `题目 ${block.questionId} 缺少稳定 root 或顶层测量结果。`,
      })
    }
    const measurement = measureQuestionCore({
      root,
      geometry,
      paragraphGeometry,
      chromeGeometry,
      block,
      question: effectiveQuestionContent(block, question),
      sourceIndex,
      sourcePath: { sourceIndex, topLevelBlockId: block.id, childPath: [] },
      questionRoot,
      shellHeight: blockMeasurement?.height || 0,
      label: `题目 ${block.questionId}`,
      choiceLayoutOverrides,
    })
    measurement.diagnostics.unshift(...shellDiagnostics)
    result.push(measurement)
  })
  return result
}

export function questionMeasurementsVersion(measurements: QuestionMeasurement[]) {
  return measurements.map((measurement) => measurement.measurementVersion).join('.')
}

export function questionMeasurementForBlock(
  measurements: QuestionMeasurement[],
  block: QuestionBlock,
  sourceIndex: number,
) {
  return measurements.find(
    (measurement) => measurement.sourceIndex === sourceIndex
      && measurement.blockId === block.id
      && measurement.questionId === block.questionId,
  )
}

/**
 * Measure question children inside box blocks.
 * Returns a Map keyed by blockSourcePathKey(sourcePath) for box planner lookup.
 */
export function measureBoxChildQuestions(
  root: HTMLElement,
  document: TeachingDocumentV1,
  documentMeasurement: TeachingDocumentMeasurement,
  resolveQuestion?: (questionId: string) => QuestionResolutionLike,
  geometry: GeometryAdapter = browserGeometryAdapter,
  paragraphGeometry: ParagraphRangeGeometryAdapter = browserParagraphRangeGeometryAdapter,
  chromeGeometry: QuestionChromeGeometryAdapter = browserQuestionChromeGeometryAdapter,
  choiceLayoutOverrides?: ChoiceLayoutOverrides,
  /** 编排器传入已查询的顶层块元素，避免同轮重复 querySelectorAll。 */
  topLevelElements?: HTMLElement[],
): Map<string, QuestionMeasurement> {
  const result = new Map<string, QuestionMeasurement>()
  const topElementsResolved = topLevelElements ?? Array.from(
    root.querySelectorAll<HTMLElement>(TEACHING_DOM_SELECTORS.block),
  ).filter((element) => !element.parentElement?.closest(TEACHING_DOM_SELECTORS.block))
  const elementBySource = new Map<number, HTMLElement>()
  topElementsResolved.forEach((element) => {
    const sourceIndex = Number(element.getAttribute(TEACHING_DOM.sourceIndex))
    if (Number.isInteger(sourceIndex)) elementBySource.set(sourceIndex, element)
  })

  document.content.forEach((block, sourceIndex) => {
    if (block.type !== 'box') return
    const boxBlock = block as BoxBlock
    const boxShell = elementBySource.get(sourceIndex)
    if (!boxShell) return
    const boxBody = boxShell.querySelector<HTMLElement>(`[${TEACHING_DOM.boxBody}]`)
    if (!boxBody) return
    const childShells = Array.from(
      boxBody.querySelectorAll<HTMLElement>(`:scope > ${TEACHING_DOM_SELECTORS.block}`),
    )

    boxBlock.children.forEach((child, childIndex) => {
      if (child.type !== 'question') return
      const questionChild = child as QuestionBlock
      const question = resolveQuestion?.(questionChild.questionId)
      if (!isQuestionItem(question)) return

      const sourcePath: BlockSourcePath = {
        sourceIndex,
        topLevelBlockId: boxBlock.id,
        childPath: [{ childIndex, blockId: child.id }],
      }
      const diagnostics: RenderDiagnostic[] = []

      // 稳定 source path 定位：parentBlockId + childIndex + blockId 三属性唯一定位 DOM 节点，
      // 重复或缺失都必须产出诊断，避免仅按 blockId 查找导致重复子块错配。
      const matches = childShells.filter(
        (element) => element.getAttribute(TEACHING_DOM.parentBlockId) === boxBlock.id
          && element.getAttribute(TEACHING_DOM.childIndex) === String(childIndex)
          && element.getAttribute(TEACHING_DOM.blockId) === child.id,
      )
      if (matches.length > 1) {
        diagnostics.push({
          code: 'duplicate-block-id',
          severity: 'error',
          blockId: child.id,
          questionId: questionChild.questionId,
          message: `盒子 ${boxBlock.id} 内索引 ${childIndex} 的子块 ${child.id} 匹配 ${matches.length} 个 DOM 节点，测量无法唯一定位。`,
        })
      }
      const childShell = matches[0] || null
      const questionRoot = childShell?.querySelector<HTMLElement>(
        `[${TEACHING_DOM.questionRoot}]`,
      ) || null
      if (!childShell || !questionRoot) {
        diagnostics.push({
          code: 'question-measurement-missing',
          severity: 'error',
          blockId: child.id,
          questionId: questionChild.questionId,
          message: `盒子 ${boxBlock.id} 内的题目 ${questionChild.questionId} 缺少稳定 root（childIndex=${childIndex}，blockId=${child.id}）。`,
        })
      }

      // 复用顶层题目测量核心，补齐零高/NaN/负值、region 重复或缺失、
      // option 索引重复或缺失、题图未解析诊断。
      const measurement = measureQuestionCore({
        root,
        geometry,
        paragraphGeometry,
        chromeGeometry,
        block: questionChild,
        question: effectiveQuestionContent(questionChild, question),
        sourceIndex,
        sourcePath,
        questionRoot,
        label: `盒子内题目 ${questionChild.questionId}`,
        choiceLayoutOverrides,
      })
      measurement.diagnostics.unshift(...diagnostics)
      result.set(blockSourcePathKey(sourcePath), measurement)
    })
  })
  return result
}

import type { QuestionItem } from '@/types'
import type { QuestionBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import { TEACHING_DOM, TEACHING_DOM_SELECTORS } from './domContract'
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

type QuestionResolutionLike =
  | QuestionItem
  | { status: 'loading' | 'error' | 'missing'; message?: string }
  | undefined

function isQuestionItem(value: QuestionResolutionLike): value is QuestionItem {
  return Boolean(value && !('status' in value))
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

export function measureTeachingDocumentQuestions(
  root: HTMLElement,
  document: TeachingDocumentV1,
  documentMeasurement: TeachingDocumentMeasurement,
  resolveQuestion?: (questionId: string) => QuestionResolutionLike,
  geometry: GeometryAdapter = browserGeometryAdapter,
  paragraphGeometry: ParagraphRangeGeometryAdapter = browserParagraphRangeGeometryAdapter,
  chromeGeometry: QuestionChromeGeometryAdapter = browserQuestionChromeGeometryAdapter,
) {
  const result: QuestionMeasurement[] = []
  const topElements = Array.from(
    root.querySelectorAll<HTMLElement>(TEACHING_DOM_SELECTORS.block),
  ).filter((element) => !element.parentElement?.closest(TEACHING_DOM_SELECTORS.block))
  const elementBySource = new Map<number, HTMLElement>()
  topElements.forEach((element) => {
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
    const diagnostics: RenderDiagnostic[] = []
    const model = createQuestionRuntimeModel(block, question)
    const shell = elementBySource.get(sourceIndex)
    const questionRoot = shell?.querySelector<HTMLElement>(
      `[${TEACHING_DOM.questionRoot}]`,
    ) || null
    const blockMeasurement = blockMeasurementBySource.get(sourceIndex)
    if (!shell || !questionRoot || !blockMeasurement) {
      diagnostics.push({
        code: 'question-measurement-missing',
        severity: 'error',
        blockId: block.id,
        questionId: block.questionId,
        message: `题目 ${block.questionId} 缺少稳定 root 或顶层测量结果。`,
      })
    }

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
          message: `题目 ${block.questionId} 的区域 ${region.key} 缺失或重复。`,
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
          message: `题目 ${block.questionId} 的区域 ${region.key} 几何无效或高度为零。`,
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
          message: `题目 ${block.questionId} 的题图 ${region.missingFigureId || region.key} 缺少可解析资源。`,
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
          message: `题目 ${block.questionId} 的选项行 ${region.rowIndex} 包含缺失图片资源。`,
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
          {
            sourceIndex,
            topLevelBlockId: block.id,
            childPath: [],
          },
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
                message: `题目 ${block.questionId} 的选项几何或索引无效。`,
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
              message: `题目 ${block.questionId} 的选项索引 ${option.optionIndex} 重复。`,
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
            message: `题目 ${block.questionId} 的选项行 ${region.rowIndex} 未完整测量。`,
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
        message: `题目 ${block.questionId} 的外边距测量无效。`,
      })
    }
    const safeTop = Number.isFinite(margins.marginTop) && margins.marginTop >= 0
      ? margins.marginTop
      : 0
    const safeBottom = Number.isFinite(margins.marginBottom) && margins.marginBottom >= 0
      ? margins.marginBottom
      : 0
    const withoutVersion = {
      blockId: block.id,
      questionId: block.questionId,
      sourceIndex,
      totalHeight: blockMeasurement?.height || 0,
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
    result.push({
      ...withoutVersion,
      measurementVersion: versionForQuestion(withoutVersion),
    })
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

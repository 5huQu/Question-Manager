import type { QuestionBlock } from '@/types/teachingDocument'
import type {
  PaginatedQuestionRegionItem,
  QuestionFragmentPaginationItem,
  WholeQuestionRegionPaginationItem,
} from './fragment'
import type {
  QuestionMeasurement,
  QuestionRegionMeasurement,
} from './questionMeasurement'
import { planParagraphFragments, type ParagraphSplitOptions } from './paragraphPlanner'
import type { QuestionRuntimeRegion } from './questionRegions'
import type { RenderDiagnostic } from './types'

export interface QuestionSplitOptions {
  minStemLinesWithHeading: number
  minOptionItemsOnPage: number
}

export const DEFAULT_QUESTION_SPLIT_OPTIONS: QuestionSplitOptions = {
  minStemLinesWithHeading: 2,
  minOptionItemsOnPage: 2,
}

/** 仅用于题图在页尾折叠留白后的 CSS 亚像素取整误差。 */
const TRAILING_FIGURE_FIT_EPSILON = 2

export interface QuestionFragmentPlan {
  fragments: QuestionFragmentPaginationItem[]
  diagnostics: RenderDiagnostic[]
}

interface Draft {
  pageOffset: number
  regionItems: PaginatedQuestionRegionItem[]
  contentHeight: number
  trimEndChrome?: boolean
}

export function planQuestionFragments(input: {
  block: QuestionBlock
  measurement: QuestionMeasurement
  firstPageAvailableHeight: number
  pageContentHeight: number
  options?: Partial<QuestionSplitOptions>
  paragraphSplitOptions?: ParagraphSplitOptions
}): QuestionFragmentPlan {
  const options = { ...DEFAULT_QUESTION_SPLIT_OPTIONS, ...input.options }
  const { block, measurement, pageContentHeight } = input
  const diagnostics: RenderDiagnostic[] = []
  const drafts: Draft[] = [{ pageOffset: 0, regionItems: [], contentHeight: 0 }]
  const endReserve = Math.max(
    0,
    measurement.fragmentChrome.end - measurement.fragmentChrome.middle,
  )
  const availableForPage = (pageOffset: number) => pageOffset === 0
    ? Math.max(0, input.firstPageAvailableHeight)
    : pageContentHeight
  const chromeForPage = (pageOffset: number) => drafts
    .slice(0, pageOffset)
    .some((draft) => draft.regionItems.length > 0)
    ? measurement.fragmentChrome.middle
    : measurement.fragmentChrome.start
  const capacity = (draft: Draft) => Math.max(
    0,
    availableForPage(draft.pageOffset)
      - chromeForPage(draft.pageOffset)
      - endReserve
      - draft.contentHeight,
  )
  const fullCapacity = Math.max(
    0,
    pageContentHeight - measurement.fragmentChrome.middle - endReserve,
  )
  const ensureDraft = (pageOffset: number) => {
    while (drafts.length <= pageOffset) {
      drafts.push({ pageOffset: drafts.length, regionItems: [], contentHeight: 0 })
    }
    return drafts[pageOffset]
  }
  const measuredByKey = new Map(
    measurement.regions.map((region) => [region.key, region]),
  )
  const missingRegion = measurement.model.regions.find((region) => !measuredByKey.has(region.key))
  if (missingRegion) {
    return {
      fragments: [],
      diagnostics: [{
        code: 'question-region-missing',
        severity: 'error',
        blockId: block.id,
        questionId: block.questionId,
        region: missingRegion.type,
        message: `题目 ${block.questionId} 的区域 ${missingRegion.key} 无测量，已回退为完整题目，未丢弃任何内容。`,
      }, {
        code: 'question-fragment-invalid',
        severity: 'error',
        blockId: block.id,
        questionId: block.questionId,
        message: `题目 ${block.questionId} 的区域测量不完整，无法安全生成 fragment。`,
      }],
    }
  }
  let currentOffset = 0

  const wholeItem = (
    region: QuestionRuntimeRegion,
    measured: QuestionRegionMeasurement,
    height = measured.height,
    trimTrailingSpacing = false,
  ): WholeQuestionRegionPaginationItem => ({
    kind: 'whole-question-region',
    regionKey: region.key,
    regionType: region.type,
    regionIndex: region.index,
    height,
    ...(trimTrailingSpacing ? { trimTrailingSpacing: true } : {}),
    ...(region.kind === 'options-row'
      ? {
          optionStart: region.optionStart,
          optionEnd: region.optionEnd,
          rowIndex: region.rowIndex,
        }
      : {}),
  })

  const overflowCode = (region: QuestionRuntimeRegion) => {
    if (region.type === 'options') return 'question-option-overflow' as const
    if (region.type === 'answer') return 'question-answer-overflow' as const
    if (region.type === 'analysis') return 'question-analysis-overflow' as const
    return 'question-stem-overflow' as const
  }

  const placeWhole = (
    region: QuestionRuntimeRegion,
    measured: QuestionRegionMeasurement,
    allowTrailingSpacingTrim = false,
  ) => {
    let draft = ensureDraft(currentOffset)
    const trailingSpacing = allowTrailingSpacingTrim ? measured.trailingSpacing || 0 : 0
    const trimmedHeight = Math.max(0, measured.height - trailingSpacing)
    const trimFits = trailingSpacing > 0
      && trimmedHeight <= capacity(draft) + endReserve + TRAILING_FIGURE_FIT_EPSILON
    if (measured.height > capacity(draft) + 0.01 && !trimFits
      && (draft.regionItems.length > 0 || measured.height <= fullCapacity + 0.01)) {
      currentOffset += 1
      draft = ensureDraft(currentOffset)
    }
    if ((trimFits ? trimmedHeight : measured.height) > fullCapacity + 0.01) {
      diagnostics.push({
        code: overflowCode(region),
        severity: 'error',
        blockId: block.id,
        questionId: block.questionId,
        region: region.type,
        optionIndex: region.kind === 'options-row' ? region.optionStart : undefined,
        message: `题目 ${block.questionId} 的 ${region.type} 区域 ${region.key} 超过单页且当前按整体区域保留。`,
      })
    }
    draft.regionItems.push(wholeItem(region, measured, trimFits ? trimmedHeight : measured.height, trimFits))
    draft.contentHeight += trimFits ? trimmedHeight : measured.height
    if (trimFits) draft.trimEndChrome = true
  }

  const placeClippedAnswerSpace = (
    region: Extract<QuestionRuntimeRegion, { kind: 'answer-space' }>,
    measured: QuestionRegionMeasurement,
  ) => {
    const draft = ensureDraft(currentOffset)
    const height = Math.min(measured.height, Math.max(0, capacity(draft)))
    if (height <= 0.01) return
    draft.regionItems.push({
      kind: 'whole-question-region',
      regionKey: region.key,
      regionType: region.type,
      regionIndex: region.index,
      height,
      answerSpaceSegment: height < measured.height ? 'start' : 'single',
    })
    draft.contentHeight += height
  }

  const placeParagraph = (
    region: Extract<QuestionRuntimeRegion, { kind: 'paragraph' }>,
    measured: QuestionRegionMeasurement,
    prefix?: {
      region: QuestionRuntimeRegion
      measured: QuestionRegionMeasurement
    },
  ) => {
    let draft = ensureDraft(currentOffset)
    const prefixHeight = prefix?.measured.height || 0
    const paragraphMeasurement = measured.paragraphMeasurement
    if (!paragraphMeasurement) {
      diagnostics.push({
        code: 'question-measurement-missing',
        severity: 'warning',
        blockId: block.id,
        questionId: block.questionId,
        region: region.type,
        message: `题目 ${block.questionId} 的段落区域 ${region.key} 缺少行盒，按整体区域保留。`,
      })
      if (prefix) {
        let target = ensureDraft(currentOffset)
        const pairHeight = prefixHeight + measured.height
        if (pairHeight > capacity(target) + 0.01
          && (target.regionItems.length > 0 || pairHeight <= fullCapacity + 0.01)) {
          currentOffset += 1
          target = ensureDraft(currentOffset)
        }
        target.regionItems.push(
          wholeItem(prefix.region, prefix.measured),
          wholeItem(region, measured),
        )
        target.contentHeight += pairHeight
      } else {
        placeWhole(region, measured)
      }
      return
    }
    const paragraphOptions = prefix?.region.type === 'heading'
      ? {
          ...(input.paragraphSplitOptions || {
            minLinesAtPageBottom: 2,
            minLinesAtPageTop: 2,
          }),
          minLinesAtPageBottom: Math.max(
            input.paragraphSplitOptions?.minLinesAtPageBottom || 2,
            options.minStemLinesWithHeading,
          ),
        }
      : input.paragraphSplitOptions
    const plan = planParagraphFragments({
      block: region.paragraph,
      measurement: paragraphMeasurement,
      firstPageAvailableHeight: Math.max(0, capacity(draft) - prefixHeight),
      pageContentHeight: Math.max(0, fullCapacity - prefixHeight),
      options: paragraphOptions,
    })
    diagnostics.push(...plan.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      blockId: block.id,
      questionId: block.questionId,
      region: region.type,
    })))
    if (plan.mode !== 'fragments') {
      if (prefix) {
        const pairHeight = prefixHeight + measured.height
        if (pairHeight > capacity(draft) + 0.01
          && (draft.regionItems.length > 0 || pairHeight <= fullCapacity + 0.01)) {
          currentOffset += 1
          draft = ensureDraft(currentOffset)
        }
        draft.regionItems.push(
          wholeItem(prefix.region, prefix.measured),
          wholeItem(region, measured),
        )
        draft.contentHeight += pairHeight
      } else {
        placeWhole(region, measured)
      }
      return
    }

    const baseOffset = currentOffset
    const firstPageOffset = plan.fragments[0].pageOffset
    if (prefix) {
      const target = ensureDraft(baseOffset + firstPageOffset)
      target.regionItems.push(wholeItem(prefix.region, prefix.measured))
      target.contentHeight += prefixHeight
    }
    plan.fragments.forEach((fragment) => {
      const pageOffset = baseOffset + fragment.pageOffset
      const target = ensureDraft(pageOffset)
      target.regionItems.push({
        kind: 'question-paragraph-fragment',
        regionKey: region.key,
        regionType: region.type,
        regionIndex: region.index,
        fragmentIndex: fragment.fragmentIndex,
        range: fragment.range,
        continuation: fragment.continuation,
        lineStart: fragment.lineStart,
        lineEnd: fragment.lineEnd,
        height: fragment.height,
      })
      target.contentHeight += fragment.height
      currentOffset = Math.max(currentOffset, pageOffset)
    })
  }

  const regions = measurement.model.regions
  let index = 0
  while (index < regions.length) {
    const region = regions[index]
    const measured = measuredByKey.get(region.key)
    if (!measured) break
    const next = regions[index + 1]
    const nextMeasured = next ? measuredByKey.get(next.key) : undefined
    if (region.keepWithNext && next && nextMeasured) {
      if (next.kind === 'paragraph') {
        placeParagraph(next, nextMeasured, { region, measured })
      } else {
        let draft = ensureDraft(currentOffset)
        const pairHeight = measured.height + nextMeasured.height
        if (pairHeight > capacity(draft) + 0.01
          && pairHeight <= fullCapacity + 0.01) {
          currentOffset += 1
          draft = ensureDraft(currentOffset)
        }
        if (region.type === 'heading' && nextMeasured.height > 0
          && pairHeight > fullCapacity + 0.01) {
          diagnostics.push({
            code: 'question-heading-orphan',
            severity: 'warning',
            blockId: block.id,
            questionId: block.questionId,
            region: next.type,
            message: `题目 ${block.questionId} 的题号无法与首个整体题干区域在单页共同容纳。`,
          })
        }
        draft.regionItems.push(wholeItem(region, measured), wholeItem(next, nextMeasured))
        draft.contentHeight += pairHeight
      }
      index += 2
      continue
    }

    if (region.kind === 'answer-space' && region.splitAcrossPages && measured.height > capacity(ensureDraft(currentOffset)) + 0.01) {
      placeClippedAnswerSpace(region, measured)
    } else if (region.kind === 'paragraph' && measured.height > capacity(ensureDraft(currentOffset)) + 0.01) {
      placeParagraph(region, measured)
    } else {
      if (region.kind === 'options-row' && index + 1 < regions.length) {
        const nextRegion = regions[index + 1]
        const nextOption = nextRegion.kind === 'options-row'
          ? measuredByKey.get(nextRegion.key)
          : undefined
        const currentItemCount = region.optionEnd - region.optionStart
        const pairedItemCount = currentItemCount
          + (nextRegion.kind === 'options-row'
            ? nextRegion.optionEnd - nextRegion.optionStart
            : 0)
        if (currentItemCount < options.minOptionItemsOnPage
          && pairedItemCount >= options.minOptionItemsOnPage
          && nextOption
          && measured.height + nextOption.height > capacity(ensureDraft(currentOffset)) + 0.01
          && measured.height + nextOption.height <= fullCapacity + 0.01) {
          currentOffset += 1
        }
      }
      placeWhole(region, measured, region.kind === 'figure' && index === regions.length - 1)
    }
    index += 1
  }

  const nonEmpty = drafts.filter((draft) => draft.regionItems.length > 0)
  const fragments = nonEmpty.map((draft, fragmentIndex): QuestionFragmentPaginationItem => {
    const continuation = nonEmpty.length === 1
      ? 'single'
      : fragmentIndex === 0
        ? 'start'
        : fragmentIndex === nonEmpty.length - 1
          ? 'end'
          : 'middle'
    return {
      kind: 'fragment',
      fragmentType: 'question',
      blockId: block.id,
      sourceIndex: measurement.sourceIndex,
      questionId: block.questionId,
      fragmentIndex,
      pageOffset: draft.pageOffset,
      continuation,
      ...(draft.trimEndChrome ? { trimEndChrome: true } : {}),
      regionItems: draft.regionItems,
      height: draft.contentHeight + measurement.fragmentChrome[continuation]
        - (draft.trimEndChrome ? endReserve : 0),
    }
  })
  if (!fragments.length && regions.length) {
    diagnostics.push({
      code: 'question-fragment-invalid',
      severity: 'error',
      blockId: block.id,
      questionId: block.questionId,
      message: `题目 ${block.questionId} 未生成任何非空 fragment。`,
    })
  }
  for (const fragment of fragments) {
    if (fragment.regionItems.length === 1
      && fragment.regionItems[0].regionType === 'heading') {
      diagnostics.push({
        code: 'question-heading-orphan',
        severity: 'error',
        blockId: block.id,
        questionId: block.questionId,
        fragmentIndex: fragment.fragmentIndex,
        message: `题目 ${block.questionId} 生成了只有题号的非法 fragment。`,
      })
    }
  }
  return { fragments, diagnostics }
}

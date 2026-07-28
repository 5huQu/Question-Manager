import type { BoxBlock, ParagraphBlock, QuestionBlock } from '@/types/teachingDocument'
import type { BoxMeasurement } from './boxMeasurement'
import {
  blockSourcePathKey,
  type BoxFragmentPaginationItem,
  type PaginatedBoxChildItem,
} from './fragment'
import type { ParagraphMeasurement } from './paragraphMeasurement'
import { planParagraphFragments, type ParagraphSplitOptions } from './paragraphPlanner'
import type { QuestionMeasurement } from './questionMeasurement'
import { planQuestionFragments } from './questionPlanner'
import type { RenderDiagnostic } from './types'

export interface BoxFragmentPlan {
  fragments: BoxFragmentPaginationItem[]
  diagnostics: RenderDiagnostic[]
}

interface Draft {
  pageOffset: number
  childItems: PaginatedBoxChildItem[]
  childHeight: number
}

export function planBoxFragments(input: {
  block: BoxBlock
  sourceIndex: number
  measurement: BoxMeasurement
  paragraphMeasurements: Map<string, ParagraphMeasurement>
  questionMeasurements?: Map<string, QuestionMeasurement>
  firstPageAvailableHeight: number
  pageContentHeight: number
  paragraphSplitOptions?: ParagraphSplitOptions
}): BoxFragmentPlan {
  const {
    block,
    sourceIndex,
    measurement,
    paragraphMeasurements,
    pageContentHeight,
  } = input
  const diagnostics: RenderDiagnostic[] = []
  const drafts: Draft[] = [{ pageOffset: 0, childItems: [], childHeight: 0 }]
  const endReserve = Math.max(
    0,
    measurement.fragmentChrome.end - measurement.fragmentChrome.middle,
  )

  const availableForPage = (pageOffset: number) => (
    pageOffset === 0
      ? Math.max(0, input.firstPageAvailableHeight)
      : pageContentHeight
  )
  const chromeForPage = (pageOffset: number) => (
    pageOffset === 0
      ? measurement.fragmentChrome.start
      : measurement.fragmentChrome.middle
  )
  const childCapacity = (draft: Draft) => Math.max(
    0,
    availableForPage(draft.pageOffset)
      - chromeForPage(draft.pageOffset)
      - endReserve
      - draft.childHeight,
  )
  const fullPageChildCapacity = Math.max(
    0,
    pageContentHeight - measurement.fragmentChrome.middle - endReserve,
  )
  const ensureDraft = (pageOffset: number) => {
    while (drafts.length <= pageOffset) {
      drafts.push({ pageOffset: drafts.length, childItems: [], childHeight: 0 })
    }
    return drafts[pageOffset]
  }
  let currentOffset = 0

  const placeWholeChild = (
    child: BoxBlock['children'][number],
    childIndex: number,
    height: number,
  ) => {
    let draft = ensureDraft(currentOffset)
    if (height > childCapacity(draft) + 0.01
      && (draft.childItems.length > 0 || height <= fullPageChildCapacity + 0.01)) {
      currentOffset += 1
      draft = ensureDraft(currentOffset)
    }
    if (height > fullPageChildCapacity + 0.01) {
      diagnostics.push({
        code: 'box-child-overflow',
        severity: 'error',
        blockId: child.id,
        fragmentIndex: currentOffset,
        message: `盒子 ${block.id} 的子块 ${childIndex}:${child.id} 高 ${height.toFixed(1)}px，且当前不支持按其内部结构继续拆分。`,
      })
    }
    draft.childItems.push({
      kind: 'whole-child',
      sourcePath: measurement.children[childIndex]?.sourcePath || {
        sourceIndex,
        topLevelBlockId: block.id,
        childPath: [{ childIndex, blockId: child.id }],
      },
      parentBlockId: block.id,
      childBlockId: child.id,
      childIndex,
      blockType: child.type,
      height,
    })
    draft.childHeight += height
  }

  block.children.forEach((child, childIndex) => {
    const childMeasurement = measurement.children[childIndex]
    if (!childMeasurement
      || childMeasurement.childIndex !== childIndex
      || childMeasurement.childBlockId !== child.id) {
      diagnostics.push({
        code: 'box-measurement-missing',
        severity: 'error',
        blockId: child.id,
        message: `盒子 ${block.id} 的 source path ${childIndex}:${child.id} 无可靠测量，按零高度整体保留。`,
      })
      placeWholeChild(child, childIndex, 0)
      return
    }

    let draft = ensureDraft(currentOffset)
    if (child.type === 'question'
      && child.breakBehavior === 'force-before'
      && (draft.childItems.length > 0 || draft.childHeight > 0)) {
      currentOffset += 1
      draft = ensureDraft(currentOffset)
    }
    if (child.type !== 'paragraph' && child.type !== 'question') {
      placeWholeChild(child, childIndex, childMeasurement.height)
      return
    }
    if (childMeasurement.height <= childCapacity(draft) + 0.01) {
      placeWholeChild(child, childIndex, childMeasurement.height)
      return
    }

    // ── Question child fragmentation ──────────────────────────────────
    if (child.type === 'question') {
      if (child.breakBehavior === 'avoid') {
        placeWholeChild(child, childIndex, childMeasurement.height)
        return
      }
      const questionMeasurement = input.questionMeasurements?.get(
        blockSourcePathKey(childMeasurement.sourcePath),
      )
      if (!questionMeasurement) {
        diagnostics.push({
          code: 'question-measurement-missing',
          severity: 'warning',
          blockId: child.id,
          message: `盒子 ${block.id} 的题目子块 ${childIndex}:${child.id} 缺少区域测量，按整体子块保留。`,
        })
        placeWholeChild(child, childIndex, childMeasurement.height)
        return
      }
      const plan = planQuestionFragments({
        block: child as QuestionBlock,
        measurement: questionMeasurement,
        firstPageAvailableHeight: childCapacity(draft),
        pageContentHeight: fullPageChildCapacity,
        paragraphSplitOptions: input.paragraphSplitOptions,
      })
      diagnostics.push(...plan.diagnostics)
      if (!plan.fragments.length
        || plan.diagnostics.some((item) => item.code === 'question-fragment-invalid' && item.severity === 'error')) {
        placeWholeChild(child, childIndex, childMeasurement.height)
        return
      }
      const baseOffset = currentOffset
      plan.fragments.forEach((fragment) => {
        const pageOffset = baseOffset + fragment.pageOffset
        const target = ensureDraft(pageOffset)
        target.childItems.push({
          kind: 'question-child-fragment',
          sourcePath: childMeasurement.sourcePath,
          parentBlockId: block.id,
          childBlockId: child.id,
          childIndex,
          questionId: (child as QuestionBlock).questionId,
          fragmentIndex: fragment.fragmentIndex,
          regionItems: fragment.regionItems,
          continuation: fragment.continuation,
          height: fragment.height,
        })
        target.childHeight += fragment.height
        currentOffset = Math.max(currentOffset, pageOffset)
      })
      return
    }

    // ── Paragraph child fragmentation ─────────────────────────────────
    const paragraphMeasurement = paragraphMeasurements.get(
      blockSourcePathKey(childMeasurement.sourcePath),
    )
    if (!paragraphMeasurement) {
      diagnostics.push({
        code: 'paragraph-measurement-missing',
        severity: 'warning',
        blockId: child.id,
        message: `盒子 ${block.id} 的段落子块 ${childIndex}:${child.id} 缺少行盒测量，按整体子块保留。`,
      })
      placeWholeChild(child, childIndex, childMeasurement.height)
      return
    }
    const plan = planParagraphFragments({
      block: child as ParagraphBlock,
      measurement: paragraphMeasurement,
      firstPageAvailableHeight: childCapacity(draft),
      pageContentHeight: fullPageChildCapacity,
      options: input.paragraphSplitOptions,
    })
    diagnostics.push(...plan.diagnostics)
    if (plan.mode === 'whole-next') {
      if (draft.childItems.length > 0) currentOffset += 1
      placeWholeChild(child, childIndex, childMeasurement.height)
      return
    }
    if (plan.mode === 'fallback-whole') {
      placeWholeChild(child, childIndex, childMeasurement.height)
      return
    }

    const baseOffset = currentOffset
    plan.fragments.forEach((fragment) => {
      const pageOffset = baseOffset + fragment.pageOffset
      const target = ensureDraft(pageOffset)
      target.childItems.push({
        kind: 'paragraph-child-fragment',
        sourcePath: childMeasurement.sourcePath,
        parentBlockId: block.id,
        childBlockId: child.id,
        childIndex,
        fragmentIndex: fragment.fragmentIndex,
        range: fragment.range,
        continuation: fragment.continuation,
        lineStart: fragment.lineStart,
        lineEnd: fragment.lineEnd,
        height: fragment.height,
      })
      target.childHeight += fragment.height
      currentOffset = Math.max(currentOffset, pageOffset)
    })
  })

  const nonEmpty = drafts.filter((draft) => draft.childItems.length > 0)
  const sourcePath = {
    sourceIndex,
    topLevelBlockId: block.id,
    childPath: [],
  }
  const fragments = nonEmpty.map((draft, index): BoxFragmentPaginationItem => {
    const continuation = nonEmpty.length === 1
      ? 'single'
      : index === 0
        ? 'start'
        : index === nonEmpty.length - 1
          ? 'end'
          : 'middle'
    return {
      kind: 'fragment',
      fragmentType: 'box',
      blockId: block.id,
      sourceIndex,
      sourcePath,
      fragmentIndex: index,
      pageOffset: draft.pageOffset,
      continuation,
      childItems: draft.childItems,
      height: draft.childHeight + measurement.fragmentChrome[continuation],
    }
  })
  return { fragments, diagnostics }
}

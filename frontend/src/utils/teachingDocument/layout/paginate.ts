import type { ParagraphBlock, TeachingBlock } from '@/types/teachingDocument'
import { boxMeasurementsVersion, type BoxMeasurement } from './boxMeasurement'
import { planBoxFragments } from './boxPlanner'
import { blockSourcePathKey } from './fragment'
import { paragraphMeasurementsVersion, type ParagraphMeasurement } from './paragraphMeasurement'
import { planParagraphFragments } from './paragraphPlanner'
import {
  questionMeasurementsVersion,
  type QuestionMeasurement,
} from './questionMeasurement'
import { planQuestionFragments } from './questionPlanner'
import { rawMarkdownMeasurementsVersion, type RawMarkdownMeasurement } from './rawMarkdownMeasurement'
import { paperMetrics, validatePaperSpec } from './paper'
import type {
  BlockMeasurement,
  PaginatedPage,
  PaginationInput,
  PaginationResult,
  RenderDiagnostic,
} from './types'

function topLevelMeasurementQueues(measurements: BlockMeasurement[]) {
  const result = new Map<string, BlockMeasurement[]>()
  for (const measurement of measurements) {
    const queue = result.get(measurement.blockId) || []
    queue.push(measurement)
    result.set(measurement.blockId, queue)
  }
  return result
}

function paragraphMeasurementBySource(measurements: ParagraphMeasurement[]) {
  return new Map(measurements.map((measurement) => [measurement.sourceIndex, measurement]))
}

function paragraphMeasurementByPath(measurements: ParagraphMeasurement[]) {
  return new Map(measurements.map((measurement) => [
    blockSourcePathKey(measurement.sourcePath),
    measurement,
  ]))
}

function boxMeasurementBySource(measurements: BoxMeasurement[]) {
  return new Map(measurements.map((measurement) => [measurement.sourceIndex, measurement]))
}

function questionMeasurementBySource(measurements: QuestionMeasurement[]) {
  return new Map(measurements.map((measurement) => [measurement.sourceIndex, measurement]))
}

function rawMarkdownMeasurementByPath(measurements: RawMarkdownMeasurement[]) {
  return new Map(measurements.map((measurement) => [blockSourcePathKey(measurement.sourcePath), measurement]))
}

function duplicateDocumentIdDiagnostics(blocks: TeachingBlock[]): RenderDiagnostic[] {
  const counts = new Map<string, number>()
  for (const block of blocks) counts.set(block.id, (counts.get(block.id) || 0) + 1)
  return [...counts.entries()]
    .filter(([id, count]) => id !== '' && count > 1)
    .map(([id, count]) => ({
      code: 'duplicate-block-id' as const,
      severity: 'error' as const,
      blockId: id,
      message: `文档包含 ${count} 个 ID 为 ${id} 的顶层块；分页按 sourceIndex 和原始顺序匹配，不会静默选择第一个。`,
    }))
}

export function paginateTeachingDocument(input: PaginationInput): PaginationResult {
  const { document, measurements, paper } = input
  const paragraphMeasurements = input.paragraphMeasurements || []
  const boxMeasurements = input.boxMeasurements || []
  const questionMeasurements = input.questionMeasurements || []
  const boxChildQuestionMeasurements = [...(input.boxChildQuestionMeasurements?.values() || [])]
  const boxChildRawMarkdownMeasurements = input.boxChildRawMarkdownMeasurements || []
  const paragraphVersion = paragraphMeasurementsVersion(paragraphMeasurements)
  const boxVersion = boxMeasurementsVersion(boxMeasurements)
  const rawMarkdownVersion = rawMarkdownMeasurementsVersion(boxChildRawMarkdownMeasurements)
  const topLevelQuestionVersion = questionMeasurementsVersion(questionMeasurements)
  const boxChildQuestionVersion = questionMeasurementsVersion(boxChildQuestionMeasurements)
  // box 子题的 measurement version 与诊断必须进入最终 pagination 与 export readiness。
  const questionVersion = boxChildQuestionVersion
    ? `${topLevelQuestionVersion}|box:${boxChildQuestionVersion}`
    : topLevelQuestionVersion
  const metrics = input.metrics ?? paperMetrics(paper)
  const documentHeaderSpanColumns = Math.max(1, Math.trunc(input.documentHeaderSpanColumns ?? 1))
  const diagnostics: RenderDiagnostic[] = [
    ...measurements.diagnostics,
    ...paragraphMeasurements.flatMap((measurement) => measurement.diagnostics),
    ...boxMeasurements.flatMap((measurement) => measurement.diagnostics),
    ...questionMeasurements.flatMap((measurement) => measurement.diagnostics),
    ...boxChildQuestionMeasurements.flatMap((measurement) => measurement.diagnostics),
    ...boxChildRawMarkdownMeasurements.flatMap((measurement) => measurement.diagnostics),
    ...validatePaperSpec(paper),
    ...duplicateDocumentIdDiagnostics(document.content),
  ]

  if (diagnostics.some((item) => item.code === 'invalid-paper-spec' && item.severity === 'error')) {
    return {
      pages: [{ index: 0, items: [], usedHeight: 0, overflow: false, showDocumentHeader: true }],
      diagnostics,
      measurementVersion: measurements.measurementVersion,
      paragraphMeasurementVersion: paragraphVersion,
      boxMeasurementVersion: boxVersion,
      questionMeasurementVersion: rawMarkdownVersion ? `${questionVersion}|raw:${rawMarkdownVersion}` : questionVersion,
    }
  }

  const queues = topLevelMeasurementQueues(measurements.blocks)
  const paragraphs = paragraphMeasurementBySource(paragraphMeasurements)
  const paragraphsByPath = paragraphMeasurementByPath(paragraphMeasurements)
  const boxes = boxMeasurementBySource(boxMeasurements)
  const rawMarkdownsByPath = rawMarkdownMeasurementByPath(boxChildRawMarkdownMeasurements)
  const questions = questionMeasurementBySource(questionMeasurements)
  const pages: PaginatedPage[] = []
  let current: PaginatedPage = {
    index: 0,
    items: [],
    usedHeight: measurements.headerHeight,
    overflow: measurements.headerHeight > metrics.contentHeightPx,
    showDocumentHeader: true,
  }

  if (current.overflow) {
    diagnostics.push({
      code: 'page-overflow',
      severity: 'error',
      pageIndex: 0,
      message: '文档标题区域已经超过单页内容区高度。',
    })
  }

  const commitPage = () => {
    pages.push(current)
    const nextPageIndex = pages.length
    const reserveDocumentHeader = nextPageIndex < documentHeaderSpanColumns
    current = {
      index: nextPageIndex,
      items: [],
      usedHeight: reserveDocumentHeader ? measurements.headerHeight : 0,
      overflow: reserveDocumentHeader && measurements.headerHeight > metrics.contentHeightPx,
      showDocumentHeader: false,
    }
  }

  const addWhole = (
    block: TeachingBlock,
    sourceIndex: number,
    measurement: BlockMeasurement | undefined,
    forceFreshPage = false,
  ) => {
    const height = measurement && Number.isFinite(measurement.height) && measurement.height >= 0
      ? measurement.height
      : 0
    if (forceFreshPage && (current.items.length > 0 || current.usedHeight > 0)) commitPage()
    if ((current.items.length > 0 || current.usedHeight > 0)
      && current.usedHeight + height > metrics.contentHeightPx
      && height <= metrics.contentHeightPx) {
      commitPage()
    }
    const pageIndex = current.index
    if (height > metrics.contentHeightPx) {
      if (block.type === 'rawMarkdown') {
        const tableHeight = measurement?.maxTableHeight
        if (tableHeight !== undefined && tableHeight > metrics.contentHeightPx) {
          diagnostics.push({
            code: 'table-overflow',
            severity: 'error',
            blockId: block.id,
            pageIndex,
            message: `rawMarkdown 块 ${block.id} 内的表格高 ${tableHeight.toFixed(1)}px，超过单页内容区 ${metrics.contentHeightPx.toFixed(1)}px，表格不可拆分。`,
          })
        } else {
          diagnostics.push({
            code: 'rawmarkdown-overflow',
            severity: 'error',
            blockId: block.id,
            pageIndex,
            message: `rawMarkdown 块 ${block.id} 高 ${height.toFixed(1)}px，超过单页内容区 ${metrics.contentHeightPx.toFixed(1)}px，V1 不支持拆分。`,
          })
        }
      } else {
        diagnostics.push({
          code: 'block-overflow',
          severity: 'error',
          blockId: block.id,
          pageIndex,
          message: `块 ${block.id} 高 ${height.toFixed(1)}px，超过单页内容区 ${metrics.contentHeightPx.toFixed(1)}px。`,
        })
      }
      if (measurement?.splitPolicy === 'paragraph' || measurement?.splitPolicy === 'children') {
        diagnostics.push({
          code: 'unsupported-split',
          severity: 'warning',
          blockId: block.id,
          pageIndex,
          message: `块 ${block.id} 声明为 ${measurement.splitPolicy} 可拆分，但当前缺少可用片段测量，仍按整体放置。`,
        })
      }
    }
    current.items.push({ kind: 'whole', blockId: block.id, blockType: block.type, sourceIndex })
    current.usedHeight += height
    if (current.usedHeight > metrics.contentHeightPx) {
      current.overflow = true
      diagnostics.push({
        code: 'page-overflow',
        severity: 'error',
        blockId: block.id,
        pageIndex,
        message: `第 ${pageIndex + 1} 页内容超过可用高度。`,
      })
    }
  }

  document.content.forEach((block, sourceIndex) => {
    if (block.type === 'pageBreak') {
      commitPage()
      return
    }

    const measurement = queues.get(block.id)?.shift()
    if (!measurement) {
      diagnostics.push({
        code: 'measurement-missing',
        severity: 'error',
        blockId: block.id,
        pageIndex: current.index,
        message: `块 ${block.id} 缺少顶层测量结果，已以 0 高度保留在分页结果中。`,
      })
    }

    if (block.type === 'question') {
      const height = measurement && Number.isFinite(measurement.height) && measurement.height >= 0
        ? measurement.height
        : 0
      const behavior = block.breakBehavior || 'auto'
      if (behavior === 'force-before' && (current.items.length > 0 || current.usedHeight > 0)) {
        commitPage()
      }
      const available = Math.max(0, metrics.contentHeightPx - current.usedHeight)
      if (height <= available) {
        addWhole(block, sourceIndex, measurement)
        return
      }
      if (behavior === 'avoid') {
        // “整题不拆”优先保持题目完整；若题目本身超过一页，则明确产生
        // overflow 诊断，不静默违背用户选择。
        addWhole(block, sourceIndex, measurement, height <= metrics.contentHeightPx)
        return
      }
      // 题目放不进当前页时，优先使用题目内部规划器。这样题干/选项可以
      // 在页底安全地开始，并在必要时跨页，而不是为了保持整题而制造大片留白。
      // 用户插入的 pageBreak 仍然在上面的分支直接提交新页。
      const questionMeasurement = questions.get(sourceIndex)
      if (!questionMeasurement
        || questionMeasurement.blockId !== block.id
        || questionMeasurement.questionId !== block.questionId) {
        diagnostics.push({
          code: 'question-measurement-missing',
          severity: 'warning',
          blockId: block.id,
          questionId: block.questionId,
          pageIndex: current.index,
          message: `题目 ${block.questionId} 缺少内部区域测量，回退为整体分页。`,
        })
        addWhole(block, sourceIndex, measurement, height <= metrics.contentHeightPx)
        return
      }
      const plan = planQuestionFragments({
        block,
        measurement: questionMeasurement,
        firstPageAvailableHeight: available,
        pageContentHeight: metrics.contentHeightPx,
        paragraphSplitOptions: input.paragraphSplitOptions,
      })
      diagnostics.push(...plan.diagnostics)
      if (!plan.fragments.length
        || plan.diagnostics.some((item) => item.code === 'question-fragment-invalid' && item.severity === 'error')) {
        addWhole(block, sourceIndex, measurement)
        return
      }
      const basePageIndex = current.index
      for (const fragment of plan.fragments) {
        while (current.index < basePageIndex + fragment.pageOffset) commitPage()
        current.items.push(fragment)
        current.usedHeight += fragment.height
        if (current.usedHeight > metrics.contentHeightPx + 0.01) {
          current.overflow = true
          diagnostics.push({
            code: 'question-fragment-invalid',
            severity: 'error',
            blockId: block.id,
            questionId: block.questionId,
            pageIndex: current.index,
            fragmentIndex: fragment.fragmentIndex,
            message: `题目 ${block.questionId} 的片段 ${fragment.fragmentIndex + 1} 超过第 ${current.index + 1} 页。`,
          })
        }
      }
      return
    }

    if (block.type === 'box') {
      const behavior = block.breakBehavior || 'auto'
      const height = measurement && Number.isFinite(measurement.height) && measurement.height >= 0
        ? measurement.height
        : 0
      let available = Math.max(0, metrics.contentHeightPx - current.usedHeight)

      if (behavior === 'force-before' && (current.items.length > 0 || current.usedHeight > 0)) {
        commitPage()
        available = metrics.contentHeightPx
      }
      if (behavior === 'avoid' && height > metrics.contentHeightPx) {
        diagnostics.push({
          code: 'box-overflow',
          severity: 'error',
          blockId: block.id,
          pageIndex: current.index,
          message: `avoid 盒子 ${block.id} 超过单页，按约定保持整体且不静默拆分。`,
        })
      }
      if (height <= available || behavior === 'avoid') {
        addWhole(block, sourceIndex, measurement)
        return
      }
      const boxMeasurement = boxes.get(sourceIndex)
      if (!boxMeasurement) {
        diagnostics.push({
          code: 'box-measurement-missing',
          severity: 'warning',
          blockId: block.id,
          pageIndex: current.index,
          message: `盒子 ${block.id} 缺少 chrome 与子块测量，回退为整体分页。`,
        })
        addWhole(block, sourceIndex, measurement)
        return
      }
      const plan = planBoxFragments({
        block,
        sourceIndex,
        measurement: boxMeasurement,
        paragraphMeasurements: paragraphsByPath,
        questionMeasurements: input.boxChildQuestionMeasurements,
        rawMarkdownMeasurements: rawMarkdownsByPath,
        firstPageAvailableHeight: available,
        pageContentHeight: metrics.contentHeightPx,
        paragraphSplitOptions: input.paragraphSplitOptions,
      })
      diagnostics.push(...plan.diagnostics)
      if (!plan.fragments.length) {
        addWhole(block, sourceIndex, measurement)
        return
      }
      // 自动规划确认整个盒子仍应从下一页完整开始时，保留 whole 语义；
      // 其余情况使用 start/middle/end fragments，真正触发跨页样式。
      if (plan.fragments.length === 1
        && plan.fragments[0].continuation === 'single'
        && plan.fragments[0].pageOffset > 0
        && height <= metrics.contentHeightPx) {
        addWhole(block, sourceIndex, measurement, true)
        return
      }
      const basePageIndex = current.index
      for (const fragment of plan.fragments) {
        while (current.index < basePageIndex + fragment.pageOffset) commitPage()
        current.items.push(fragment)
        current.usedHeight += fragment.height
        if (current.usedHeight > metrics.contentHeightPx + 0.01) {
          current.overflow = true
          diagnostics.push({
            code: 'box-overflow',
            severity: 'error',
            blockId: block.id,
            pageIndex: current.index,
            fragmentIndex: fragment.fragmentIndex,
            message: `盒子 ${block.id} 的片段 ${fragment.fragmentIndex + 1} 超过第 ${current.index + 1} 页内容区。`,
          })
        }
      }
      return
    }

    if (measurement?.breakBehavior === 'force-before') {
      addWhole(block, sourceIndex, measurement, true)
      return
    }

    const height = measurement && Number.isFinite(measurement.height) && measurement.height >= 0
      ? measurement.height
      : 0
    const available = Math.max(0, metrics.contentHeightPx - current.usedHeight)
    if (block.type !== 'paragraph' || height <= available) {
      addWhole(block, sourceIndex, measurement)
      return
    }

    const paragraphMeasurement = paragraphs.get(sourceIndex)
    if (!paragraphMeasurement) {
      diagnostics.push({
        code: 'paragraph-measurement-missing',
        severity: 'warning',
        blockId: block.id,
        pageIndex: current.index,
        message: `段落 ${block.id} 缺少行盒测量，回退为整体分页。`,
      })
      addWhole(block, sourceIndex, measurement)
      return
    }

    const plan = planParagraphFragments({
      block: block as ParagraphBlock,
      measurement: paragraphMeasurement,
      firstPageAvailableHeight: available,
      pageContentHeight: metrics.contentHeightPx,
      options: input.paragraphSplitOptions,
    })
    diagnostics.push(...plan.diagnostics)
    if (plan.mode === 'whole-next') {
      addWhole(block, sourceIndex, measurement, true)
      return
    }
    if (plan.mode === 'fallback-whole') {
      addWhole(block, sourceIndex, measurement)
      return
    }

    const basePageIndex = current.index
    for (const fragment of plan.fragments) {
      while (current.index < basePageIndex + fragment.pageOffset) commitPage()
      current.items.push({
        kind: 'fragment',
        fragmentType: 'paragraph',
        blockId: block.id,
        sourceIndex,
        fragmentIndex: fragment.fragmentIndex,
        range: fragment.range,
        continuation: fragment.continuation,
        lineStart: fragment.lineStart,
        lineEnd: fragment.lineEnd,
        height: fragment.height,
      })
      current.usedHeight += fragment.height
      if (current.usedHeight > metrics.contentHeightPx + 0.01) {
        current.overflow = true
        diagnostics.push({
          code: 'page-overflow',
          severity: 'error',
          blockId: block.id,
          pageIndex: current.index,
          fragmentIndex: fragment.fragmentIndex,
          message: `段落 ${block.id} 的片段 ${fragment.fragmentIndex + 1} 超过第 ${current.index + 1} 页内容区。`,
        })
      }
    }
  })

  pages.push(current)
  return {
    pages,
    diagnostics,
    measurementVersion: measurements.measurementVersion,
    paragraphMeasurementVersion: paragraphVersion,
    boxMeasurementVersion: boxVersion,
    questionMeasurementVersion: rawMarkdownVersion ? `${questionVersion}|raw:${rawMarkdownVersion}` : questionVersion,
  }
}

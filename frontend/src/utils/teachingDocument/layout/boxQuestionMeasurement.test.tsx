import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { QuestionItem } from '@/types'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { TeachingDocumentRenderer } from '@/components/teaching-document/TeachingDocumentRenderer'
import type { QuestionResolution } from '@/components/teaching-document/blocks/BlockRenderer'
import {
  measureTeachingDocument,
  measureBoxChildQuestions,
  blockSourcePathKey,
  TEACHING_DOM,
  type GeometryAdapter,
  type ParagraphRangeGeometryAdapter,
  type QuestionChromeGeometryAdapter,
} from '.'

function makeQuestion(id: string, stem: string): QuestionItem {
  return {
    id,
    serialNo: null,
    questionNo: '1',
    stage: '高中',
    questionType: '解答题',
    difficultyScore: 3,
    difficultyScore10: 6,
    difficultyLabel: '中等',
    chapter: '',
    knowledgePoints: [],
    solutionMethods: [],
    sourceTitle: '',
    bankStatus: 'ready',
    stemMarkdown: stem,
    answerText: '1',
    analysisMarkdown: '直接计算即可。',
    totalScore: 12,
    scoringRubric: [],
    sliceImagePath: '',
    figures: [],
    sourceRunId: '',
    updatedAt: '',
    hasFigures: false,
  }
}

const questionA = makeQuestion('q-child-a', '求甲的值。')
const questionB = makeQuestion('q-child-b', '求乙的值。')

function boxDocument(childIds: string[]): TeachingDocumentV1 {
  return {
    version: 1,
    documentType: 'lecture',
    title: '',
    metadata: {},
    content: [{
      type: 'box',
      id: 'box',
      templateId: 'method',
      breakBehavior: 'allow',
      children: childIds.map((id, index) => ({
        type: 'question' as const,
        id,
        questionId: id === 'q-child-a' ? questionA.id : questionB.id,
        display: { displayNumber: String(index + 1) },
      })),
    }],
  }
}

function renderedRoot(
  fixture: TeachingDocumentV1,
  resolveQuestion: (id: string) => QuestionResolution,
) {
  const root = document.createElement('div')
  root.innerHTML = renderToStaticMarkup(
    <TeachingDocumentRenderer document={fixture} resolveQuestion={resolveQuestion} />,
  )
  return root
}

const geometry: GeometryAdapter = {
  measure(element) {
    if (element.hasAttribute(TEACHING_DOM.questionOptionIndex)) {
      return { width: 140, height: 18, top: 0, bottom: 18 }
    }
    const region = element.getAttribute(TEACHING_DOM.questionRegion)
    const height = region
      ? ({ heading: 20, stem: 40, answer: 25, analysis: 35 }[region] || 10)
      : 100
    return { width: 600, height, top: 0, bottom: height }
  },
}

const paragraphGeometry: ParagraphRangeGeometryAdapter = {
  measureText: () => [{ width: 100, height: 20, top: 0, bottom: 20 }],
  measureAtomic: () => [],
  margins: () => ({ marginTop: 0, marginBottom: 0 }),
}

const chromeGeometry: QuestionChromeGeometryAdapter = {
  margins: () => ({ marginTop: 10, marginBottom: 12 }),
}

function measure(
  fixture: TeachingDocumentV1,
  resolveQuestion: (id: string) => QuestionResolution,
) {
  const root = renderedRoot(fixture, resolveQuestion)
  const documentMeasurement = measureTeachingDocument(root, fixture, geometry)
  const map = measureBoxChildQuestions(
    root,
    fixture,
    documentMeasurement,
    resolveQuestion,
    geometry,
    paragraphGeometry,
    chromeGeometry,
  )
  return { root, map }
}

describe('measureBoxChildQuestions', () => {
  it('locates question children by stable source path and reuses the shared measurement core', () => {
    const fixture = boxDocument(['q-child-a', 'q-child-b'])
    const { map } = measure(fixture, (id) => (id === questionA.id ? questionA : questionB))

    expect(map.size).toBe(2)
    const keyA = blockSourcePathKey({
      sourceIndex: 0,
      topLevelBlockId: 'box',
      childPath: [{ childIndex: 0, blockId: 'q-child-a' }],
    })
    const keyB = blockSourcePathKey({
      sourceIndex: 0,
      topLevelBlockId: 'box',
      childPath: [{ childIndex: 1, blockId: 'q-child-b' }],
    })
    const measurementA = map.get(keyA)
    const measurementB = map.get(keyB)
    expect(measurementA?.questionId).toBe(questionA.id)
    expect(measurementB?.questionId).toBe(questionB.id)

    // 复用顶层核心：totalHeight = 区域高度和 + 外边距（无 shellHeight）。
    if (measurementA) {
      const regionSum = measurementA.regions.reduce((sum, region) => sum + region.height, 0)
      expect(measurementA.totalHeight).toBe(regionSum + 10 + 12)
      expect(measurementA.measurementVersion).toMatch(/^q-/)
      expect(measurementA.diagnostics).toEqual([])
    }
  })

  it('resolves duplicate child block IDs by explicit child index without false duplicates', () => {
    // 两个子块 blockId 相同（'same'），但 childIndex 不同，source path 仍唯一。
    const fixture: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '',
      metadata: {},
      content: [{
        type: 'box',
        id: 'box',
        templateId: 'method',
        breakBehavior: 'allow',
        children: [
          { type: 'question', id: 'same', questionId: questionA.id, display: { displayNumber: '1' } },
          { type: 'question', id: 'same', questionId: questionB.id, display: { displayNumber: '2' } },
        ],
      }],
    }
    const { map } = measure(fixture, (id) => (id === questionA.id ? questionA : questionB))

    expect(map.size).toBe(2)
    const first = map.get(blockSourcePathKey({
      sourceIndex: 0, topLevelBlockId: 'box', childPath: [{ childIndex: 0, blockId: 'same' }],
    }))
    const second = map.get(blockSourcePathKey({
      sourceIndex: 0, topLevelBlockId: 'box', childPath: [{ childIndex: 1, blockId: 'same' }],
    }))
    expect(first?.questionId).toBe(questionA.id)
    expect(second?.questionId).toBe(questionB.id)
    // childIndex 不同即可唯一定位，不应误报 duplicate-block-id。
    expect(first?.diagnostics.some((d) => d.code === 'duplicate-block-id')).toBe(false)
    expect(second?.diagnostics.some((d) => d.code === 'duplicate-block-id')).toBe(false)
  })

  it('diagnoses when multiple DOM nodes match the same stable source path', () => {
    const fixture = boxDocument(['q-child-a'])
    const root = renderedRoot(fixture, (id) => (id === questionA.id ? questionA : undefined))
    // 克隆子块 shell，使同一 (parentBlockId, childIndex, blockId) 匹配两个节点。
    const boxBody = root.querySelector<HTMLElement>(`[${TEACHING_DOM.boxBody}]`)
    const childShell = boxBody?.querySelector<HTMLElement>(
      `[${TEACHING_DOM.childIndex}="0"][${TEACHING_DOM.blockId}="q-child-a"]`,
    )
    if (boxBody && childShell) boxBody.append(childShell.cloneNode(true))

    const documentMeasurement = measureTeachingDocument(root, fixture, geometry)
    const map = measureBoxChildQuestions(
      root, fixture, documentMeasurement,
      (id) => (id === questionA.id ? questionA : undefined),
      geometry, paragraphGeometry, chromeGeometry,
    )
    const measurement = map.get(blockSourcePathKey({
      sourceIndex: 0, topLevelBlockId: 'box', childPath: [{ childIndex: 0, blockId: 'q-child-a' }],
    }))
    expect(measurement?.diagnostics.some((d) => d.code === 'duplicate-block-id')).toBe(true)
  })

  it('diagnoses a missing region instead of measuring it as zero silently', () => {
    const fixture = boxDocument(['q-child-a'])
    const root = renderedRoot(fixture, (id) => (id === questionA.id ? questionA : undefined))
    // 删除题干区域，制造 region 缺失。
    root.querySelector(`[${TEACHING_DOM.questionRegion}="stem"]`)?.remove()

    const documentMeasurement = measureTeachingDocument(root, fixture, geometry)
    const map = measureBoxChildQuestions(
      root, fixture, documentMeasurement,
      (id) => (id === questionA.id ? questionA : undefined),
      geometry, paragraphGeometry, chromeGeometry,
    )
    const measurement = map.get(blockSourcePathKey({
      sourceIndex: 0, topLevelBlockId: 'box', childPath: [{ childIndex: 0, blockId: 'q-child-a' }],
    }))
    expect(measurement?.diagnostics.some((d) => d.code === 'question-region-missing')).toBe(true)
  })

  it('skips children whose resolver has not produced a question yet', () => {
    const fixture = boxDocument(['q-child-a', 'q-child-b'])
    // q-child-b 仍在加载：不应产生测量条目（等待资源稳定后重测）。
    const { map } = measure(fixture, (id) => (
      id === questionA.id ? questionA : { status: 'loading' }
    ))
    expect(map.size).toBe(1)
    expect(map.has(blockSourcePathKey({
      sourceIndex: 0, topLevelBlockId: 'box', childPath: [{ childIndex: 1, blockId: 'q-child-b' }],
    }))).toBe(false)
  })
})

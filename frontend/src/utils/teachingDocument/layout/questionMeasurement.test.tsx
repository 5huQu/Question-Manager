import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { QuestionItem } from '@/types'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { TeachingDocumentRenderer } from '@/components/teaching-document/TeachingDocumentRenderer'
import {
  measureTeachingDocument,
  measureTeachingDocumentQuestions,
  TEACHING_DOM,
  type GeometryAdapter,
  type ParagraphRangeGeometryAdapter,
  type QuestionChromeGeometryAdapter,
} from '.'

const question: QuestionItem = {
  id: 'q-measure',
  serialNo: null,
  questionNo: '7',
  stage: '高中',
  questionType: '单选题',
  difficultyScore: 3,
  difficultyScore10: 6,
  difficultyLabel: '中等',
  chapter: '',
  knowledgePoints: [],
  solutionMethods: [],
  sourceTitle: '',
  bankStatus: 'ready',
  stemMarkdown: '选择正确结论。\n\nA. 甲\nB. 乙\nC. 丙\nD. 丁',
  answerText: 'A',
  analysisMarkdown: '逐项判断即可。',
  totalScore: 5,
  scoringRubric: [],
  sliceImagePath: '',
  figures: [],
  sourceRunId: '',
  updatedAt: '',
  hasFigures: false,
}

const fixture: TeachingDocumentV1 = {
  version: 1,
  documentType: 'worksheet',
  title: '',
  metadata: {},
  content: [{
    type: 'question',
    id: 'question-block',
    questionId: question.id,
    display: { showAnswer: true, showAnalysis: true },
  }],
}

function renderedRoot() {
  const root = document.createElement('div')
  root.innerHTML = renderToStaticMarkup(
    <TeachingDocumentRenderer document={fixture} resolveQuestion={() => question} />,
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
      ? ({ heading: 20, stem: 40, options: 30, answer: 25, analysis: 35 }[region] || 10)
      : 220
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

describe('measureTeachingDocumentQuestions', () => {
  it('measures explicitly keyed regions, option rows and paragraph line boxes', () => {
    const root = renderedRoot()
    const documentMeasurement = measureTeachingDocument(root, fixture, geometry)
    const [measurement] = measureTeachingDocumentQuestions(
      root,
      fixture,
      documentMeasurement,
      () => question,
      geometry,
      paragraphGeometry,
      chromeGeometry,
    )

    expect(measurement.totalHeight).toBe(220)
    expect(measurement.fragmentChrome).toEqual({
      single: 22,
      start: 10,
      middle: 0,
      end: 12,
    })
    expect(measurement.regions.map((region) => region.type)).toEqual([
      'stem',
      'options',
      'answer',
      'analysis',
      'analysis',
    ])
    expect(measurement.regions.find((region) => region.type === 'options'))
      .toMatchObject({
        optionStart: 0,
        optionEnd: 4,
        rowIndex: 0,
        optionMeasurements: [
          { optionIndex: 0, rowIndex: 0, width: 140, height: 18 },
          { optionIndex: 1, rowIndex: 0, width: 140, height: 18 },
          { optionIndex: 2, rowIndex: 0, width: 140, height: 18 },
          { optionIndex: 3, rowIndex: 0, width: 140, height: 18 },
        ],
      })
    expect(measurement.regions.filter((region) => region.paragraphMeasurement))
      .toHaveLength(2)
    expect(measurement.diagnostics).toEqual([])
  })

  it('diagnoses a duplicate region key instead of choosing one silently', () => {
    const root = renderedRoot()
    const region = root.querySelector<HTMLElement>(`[${TEACHING_DOM.questionRegion}]`)
    region?.parentElement?.append(region.cloneNode(true))
    const documentMeasurement = measureTeachingDocument(root, fixture, geometry)
    const [measurement] = measureTeachingDocumentQuestions(
      root,
      fixture,
      documentMeasurement,
      () => question,
      geometry,
      paragraphGeometry,
      chromeGeometry,
    )
    expect(measurement.diagnostics.some((item) => item.code === 'question-region-missing'))
      .toBe(true)
  })

  it('reports invalid geometry without embedding it in the document', () => {
    const root = renderedRoot()
    const invalidGeometry: GeometryAdapter = {
      measure(element) {
        if (element.hasAttribute(TEACHING_DOM.questionRegion)) {
          return { width: 600, height: Number.NaN, top: 0, bottom: -1 }
        }
        return { width: 600, height: 220, top: 0, bottom: 220 }
      },
    }
    const documentMeasurement = measureTeachingDocument(root, fixture, invalidGeometry)
    const [measurement] = measureTeachingDocumentQuestions(
      root,
      fixture,
      documentMeasurement,
      () => question,
      invalidGeometry,
      paragraphGeometry,
      chromeGeometry,
    )
    expect(measurement.diagnostics.some((item) => item.code === 'invalid-measurement'))
      .toBe(true)
    expect(JSON.stringify(fixture)).not.toContain('measurementVersion')
  })
})

import type { TeachingBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import { TEACHING_DOCUMENT_ASSET_IDS } from './teachingDocumentFixtures'

export type TeachingDocumentPerformanceFixtureSize = 'small' | 'medium' | 'large'

const FIXTURE_CONFIG: Record<TeachingDocumentPerformanceFixtureSize, { blocks: number; questions: number }> = {
  small: { blocks: 30, questions: 10 },
  medium: { blocks: 100, questions: 40 },
  large: { blocks: 300, questions: 100 },
}

const QUESTION_IDS = [
  'fixture-choice',
  'fixture-solution',
  'fixture-question-long-choice',
  'fixture-question-long-analysis',
] as const

function questionPositions(blockCount: number, questionCount: number) {
  return new Set(Array.from({ length: questionCount }, (_, index) => (
    Math.min(blockCount - 1, Math.floor(((index + 0.5) * blockCount) / questionCount))
  )))
}

function nonQuestionBlock(index: number, size: TeachingDocumentPerformanceFixtureSize): TeachingBlock {
  const id = `performance-${size}-${index + 1}`
  if (index % 29 === 0) {
    return {
      type: 'heading',
      id,
      level: index % 58 === 0 ? 1 : 2,
      content: [{ type: 'text', text: `性能基线章节 ${index + 1}` }],
    }
  }
  if (index > 0 && index % 47 === 0) return { type: 'pageBreak', id }
  if (index % 17 === 0) {
    return {
      type: 'box',
      id,
      templateId: index % 34 === 0 ? 'warning' : 'method',
      title: `性能基线知识卡片 ${index + 1}`,
      breakBehavior: 'auto',
      children: [
        {
          type: 'paragraph',
          id: `${id}-paragraph`,
          content: [{
            type: 'text',
            text: '卡片段落用于测量子块、中文换行与连续分页。'.repeat((index % 3) + 2),
          }],
        },
        {
          type: 'blockMath',
          id: `${id}-math`,
          latex: `f_{${index + 1}}(x)=x^2-${index + 1}x+1`,
        },
      ],
    }
  }
  if (index % 13 === 0) {
    return {
      type: 'figure',
      id,
      asset: {
        type: 'documentAsset',
        assetId: index % 26 === 0 ? TEACHING_DOCUMENT_ASSET_IDS.tall : TEACHING_DOCUMENT_ASSET_IDS.wide,
      },
      alignment: 'center',
      widthRatio: index % 26 === 0 ? 0.42 : 0.72,
      caption: `性能基线图片 ${index + 1}`,
    }
  }
  if (index % 11 === 0) {
    return {
      type: 'rawMarkdown',
      id,
      markdown: `### 混合内容 ${index + 1}\n\n中文段落 mixed with English and $x_${index + 1}^2$。`,
      reason: 'user-inserted',
    }
  }
  return {
    type: 'paragraph',
    id,
    content: [{
      type: 'text',
      text: `第 ${index + 1} 个性能基线段落包含中文、English words、数字 ${index + 1} 与标点。`.repeat((index % 4) + 2),
    }],
  }
}

export function createTeachingDocumentPerformanceFixture(
  size: TeachingDocumentPerformanceFixtureSize,
): TeachingDocumentV1 {
  const config = FIXTURE_CONFIG[size]
  const positions = questionPositions(config.blocks, config.questions)
  let questionIndex = 0
  const content = Array.from({ length: config.blocks }, (_, index): TeachingBlock => {
    if (!positions.has(index)) return nonQuestionBlock(index, size)
    const questionId = QUESTION_IDS[questionIndex % QUESTION_IDS.length]
    questionIndex += 1
    return {
      type: 'question',
      id: `performance-${size}-question-${questionIndex}`,
      questionId,
      display: {
        displayNumber: String(questionIndex),
        displayNumberAuto: true,
        showAnswer: questionIndex % 3 === 0,
        showAnalysis: questionIndex % 5 === 0,
      },
    }
  })

  return {
    version: 1,
    documentType: 'worksheet',
    title: `文档编辑器性能基线 · ${size.toUpperCase()}`,
    metadata: {
      fixtureKind: 'teaching-document-performance',
      performanceSize: size,
      expectedBlockCount: config.blocks,
      expectedQuestionCount: config.questions,
    },
    content,
  }
}

export const TEACHING_DOCUMENT_PERFORMANCE_FIXTURES = {
  small: createTeachingDocumentPerformanceFixture('small'),
  medium: createTeachingDocumentPerformanceFixture('medium'),
  large: createTeachingDocumentPerformanceFixture('large'),
} as const

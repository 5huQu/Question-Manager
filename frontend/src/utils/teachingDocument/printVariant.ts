import type { BoxChildBlock, QuestionBlock, TeachingBlock, TeachingDocumentV1 } from '@/types/teachingDocument'

export type TeachingDocumentPrintVariant = 'student' | 'teacher'

/**
 * 输出版本只影响答案与解析的可见性，不回写原始文档。
 * 编辑器预览与实际打印共用此转换，避免两处版本规则偏离。
 */
export function documentForPrintVariant(source: TeachingDocumentV1, variant: TeachingDocumentPrintVariant): TeachingDocumentV1 {
  const showSolutions = variant === 'teacher'
  const transformQuestion = (block: QuestionBlock): QuestionBlock => ({
    ...block,
    display: {
      ...block.display,
      showAnswer: showSolutions,
      showAnalysis: showSolutions,
    },
  })
  const transformChild = (block: BoxChildBlock): BoxChildBlock => block.type === 'question' ? transformQuestion(block) : block
  const transformBlock = (block: TeachingBlock): TeachingBlock => {
    if (block.type === 'question') return transformQuestion(block)
    if (block.type === 'box') return { ...block, children: block.children.map(transformChild) }
    return block
  }
  return { ...source, content: source.content.map(transformBlock) }
}

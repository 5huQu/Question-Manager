import type { BoxChildBlock, QuestionBlock, TeachingBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import { renumberAutomaticQuestionNumbers } from './editorState'

export type TeachingDocumentPrintVariant = 'student' | 'teacher'

const variantDocumentCache = new WeakMap<TeachingDocumentV1, Partial<Record<TeachingDocumentPrintVariant, TeachingDocumentV1>>>()

/**
 * 输出版本只影响答案与解析的可见性，不回写原始文档。
 * 编辑器预览与实际打印共用此转换，避免两处版本规则偏离。
 * 自动题号也在这里统一按文档出现顺序计算，不能直接沿用题库原始题号。
 */
export function documentForPrintVariant(source: TeachingDocumentV1, variant: TeachingDocumentPrintVariant): TeachingDocumentV1 {
  const cached = variantDocumentCache.get(source)?.[variant]
  if (cached) return cached
  const showSolutions = variant === 'teacher'
  const normalizedSource = renumberAutomaticQuestionNumbers(source)
  const transformQuestion = (block: QuestionBlock): QuestionBlock => ({
    ...block,
    display: {
      ...block.display,
      showAnswer: showSolutions,
      showAnalysis: showSolutions,
      // 教师版已呈现答案与解析，不再保留学生作答区域。
      answerSpace: variant === 'teacher' ? undefined : block.display?.answerSpace,
    },
  })
  const transformChild = (block: BoxChildBlock): BoxChildBlock => block.type === 'question' ? transformQuestion(block) : block
  const transformBlock = (block: TeachingBlock): TeachingBlock => {
    if (block.type === 'question') return transformQuestion(block)
    if (block.type === 'box') return { ...block, children: block.children.map(transformChild) }
    return block
  }
  const result = { ...normalizedSource, content: normalizedSource.content.map(transformBlock) }
  const variants = variantDocumentCache.get(source) ?? {}
  variants[variant] = result
  variantDocumentCache.set(source, variants)
  return result
}

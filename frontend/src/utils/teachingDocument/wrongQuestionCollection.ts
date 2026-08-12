import type { BoxBlock, TeachingBlock, TeachingDocumentV1 } from '@/types/teachingDocument'

/** 错题集文档不显示文档标题，只呈现题目。 */
export function showsDocumentTitle(document: Pick<TeachingDocumentV1, 'documentType' | 'title'>): boolean {
  return document.documentType !== 'wrong-question-collection' && Boolean(document.title)
}

/**
 * 错题集文档只呈现题目：顶层仅保留 question 块，卡片内仅保留 question 子块，
 * 标题、章节、段落、公式、表格、图片等其余块全部隐藏。
 * 非错题集文档原样返回（保持引用不变，不破坏下游缓存）。
 */
export function questionOnlyDocument(source: TeachingDocumentV1): TeachingDocumentV1 {
  if (source.documentType !== 'wrong-question-collection') return source
  const keepBlock = (block: TeachingBlock): TeachingBlock | null => {
    if (block.type === 'question') return block
    if (block.type === 'box') {
      const children = (block as BoxBlock).children.filter((child) => child.type === 'question')
      if (!children.length) return null
      return { ...block, children }
    }
    return null
  }
  return { ...source, content: source.content.flatMap((block) => keepBlock(block) ?? []) }
}

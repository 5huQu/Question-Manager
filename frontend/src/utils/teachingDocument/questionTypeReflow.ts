import type { QuestionItem } from '@/types'
import type { HeadingBlock, QuestionBlock, TeachingBlock, TeachingDocumentV1, TeachingInline } from '@/types/teachingDocument'

const GENERATED_SECTION_RE = /^(.*、)(.+?)（共\s*\d+\s*题，共\s*[\d.]+\s*分）$/
const CN_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

function inlineText(content: TeachingInline[]): string {
  return content.map((inline) => inline.type === 'text' ? inline.text : '').join('').trim()
}

function scoreFor(block: QuestionBlock, question: QuestionItem | undefined): number {
  const score = block.display?.scoreOverride ?? question?.totalScore ?? 0
  return Number.isFinite(Number(score)) ? Number(score) : 0
}

function updateGeneratedHeading(block: HeadingBlock, type: string, questions: QuestionBlock[], questionMap: Record<string, QuestionItem>): HeadingBlock {
  const current = inlineText(block.content)
  const match = current.match(GENERATED_SECTION_RE)
  if (!match) return block
  const score = questions.reduce((sum, question) => sum + scoreFor(question, questionMap[question.questionId]), 0)
  const scoreText = String(Math.round(score * 10) / 10)
  const text = `${match[1]}${type}（共 ${questions.length} 题，共 ${scoreText} 分）`
  if (current === text) return block
  return { ...block, content: [{ type: 'text', text }] }
}

type Section = { headingIndex: number; endIndex: number; type: string }

function generatedSections(content: TeachingBlock[]): Section[] {
  const sections: Section[] = []
  for (let index = 0; index < content.length; index += 1) {
    const block = content[index]
    if (block.type !== 'heading' || block.level !== 3) continue
    const match = inlineText(block.content).match(GENERATED_SECTION_RE)
    if (!match) continue
    const endIndex = content.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.type === 'heading' && candidate.level <= 3)
    sections.push({ headingIndex: index, endIndex: endIndex < 0 ? content.length : endIndex, type: match[2].trim() })
  }
  return sections
}

/**
 * 将回填题库后题型发生变化的题目移动到对应的系统生成大题下。
 * 只处理 exam 文档中的顶层题目，保留自定义编号和非题目块。
 */
export function reflowQuestionAfterTypeChange(
  document: TeachingDocumentV1,
  questionMap: Record<string, QuestionItem>,
  questionId: string,
  previousType: string,
  nextType: string,
): TeachingDocumentV1 {
  if (document.documentType !== 'exam' || previousType.trim() === nextType.trim()) return document
  const sections = generatedSections(document.content)
  const source = sections.find((section) => section.type === previousType.trim())
  const target = sections.find((section) => section.type === nextType.trim())
  if (!source || !target || source.headingIndex === target.headingIndex) return document

  const moved = document.content[source.headingIndex + 1] && document.content
    .slice(source.headingIndex + 1, source.endIndex)
    .find((block): block is QuestionBlock => block.type === 'question' && block.questionId === questionId)
  if (!moved) return document

  const content = document.content
  // Remove first, then insert at the end of the target section. Indexes are adjusted
  // through stable block IDs so source/target order is independent of their location.
  const withoutMoved = content.filter((block) => block.id !== moved.id)
  const targetHeadingIndex = withoutMoved.findIndex((block) => block.id === content[target.headingIndex].id)
  const targetEnd = withoutMoved.findIndex((block, index) => index > targetHeadingIndex && block.type === 'heading' && block.level <= 3)
  const insertionIndex = targetEnd < 0 ? withoutMoved.length : targetEnd
  withoutMoved.splice(insertionIndex, 0, moved)

  let generatedHeadingNumber = 0
  const refreshed = withoutMoved.map((block, index, all) => {
    if (block.type !== 'heading' || block.level !== 3) return block
    const match = inlineText(block.content).match(GENERATED_SECTION_RE)
    if (!match) return block
    const end = all.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.type === 'heading' && candidate.level <= 3)
    const body = all.slice(index + 1, end < 0 ? all.length : end).filter((candidate): candidate is QuestionBlock => candidate.type === 'question')
    if (body.length === 0 && block.id === content[source.headingIndex].id) return null
    generatedHeadingNumber += 1
    const prefix = generatedHeadingNumber <= CN_NUMERALS.length ? `${CN_NUMERALS[generatedHeadingNumber - 1]}、` : `第${generatedHeadingNumber}、`
    const normalizedHeading: HeadingBlock = {
      ...block,
      content: [{ type: 'text', text: `${prefix}${match[2].trim()}（共 0 题，共 0 分）` }],
    }
    return updateGeneratedHeading(normalizedHeading, match[2].trim(), body, questionMap)
  }).filter((block): block is TeachingBlock => Boolean(block))
  return { ...document, content: refreshed }
}

/**
 * 组卷工作台 → 讲义文档（试卷）快照构建器
 *
 * 题目仅以 questionId 引用题库（不复制内容），题库保持唯一数据源；
 * 讲义编辑器中的题目渲染、答案开关、分值覆盖等能力直接生效。
 */

import type { TeachingBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import { generateBlockId } from './validate'

export type ExamImportEntry = {
  questionId: string
  questionType: string
  score: number
}

/** 大题固定排序：常见题型在前，未知题型按首次出现顺序排在后面 */
const TYPE_ORDER = ['单选题', '多选题', '填空题', '解答题']
const CN_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

function sectionLabel(index: number): string {
  return index < CN_NUMERALS.length ? CN_NUMERALS[index] : `第${index + 1}`
}

function formatScore(score: number): string {
  return String(Math.round(score * 10) / 10)
}

/** 按题型分组：TYPE_ORDER 在前，其余题型按首次出现顺序；组内保持传入顺序 */
export function groupExamEntriesByType(entries: ExamImportEntry[]): Array<[string, ExamImportEntry[]]> {
  const buckets = new Map<string, ExamImportEntry[]>()
  for (const entry of entries) {
    const type = entry.questionType.trim() || '未分类'
    const bucket = buckets.get(type)
    if (bucket) bucket.push(entry)
    else buckets.set(type, [entry])
  }
  const known = TYPE_ORDER.filter((type) => buckets.has(type))
  const others = [...buckets.keys()].filter((type) => !TYPE_ORDER.includes(type))
  return [...known, ...others].map((type) => [type, buckets.get(type)!] as [string, ExamImportEntry[]])
}

/**
 * 将题目列表构建为一份试卷型讲义文档：
 * 每个题型一个大题标题（如"一、单选题（共 3 题，共 15 分）"），题目全卷连续编号。
 */
export function buildExamDocumentFromQuestions(entries: ExamImportEntry[], title: string): TeachingDocumentV1 {
  const groups = groupExamEntriesByType(entries)
  const content: TeachingBlock[] = []
  let questionNo = 0

  groups.forEach(([type, items], groupIndex) => {
    const groupScore = items.reduce((sum, entry) => sum + entry.score, 0)
    content.push({
      type: 'heading',
      id: generateBlockId('heading'),
      level: 3,
      content: [{ type: 'text', text: `${sectionLabel(groupIndex)}、${type}（共 ${items.length} 题，共 ${formatScore(groupScore)} 分）` }],
    })
    for (const entry of items) {
      questionNo += 1
      content.push({
        type: 'question',
        id: generateBlockId('question'),
        questionId: entry.questionId,
        display: {
          showAnswer: false,
          showAnalysis: false,
          scoreOverride: entry.score,
          displayNumber: String(questionNo),
        },
      })
    }
  })

  return {
    version: 1,
    documentType: 'exam',
    title,
    metadata: {},
    content,
  }
}

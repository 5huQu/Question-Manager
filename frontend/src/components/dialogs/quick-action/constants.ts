import type { RandomPaperDifficultyMode, RandomPaperMatchMode } from '@/api/questionBank'

export type QuickActionMode = 'daily' | 'random'

export const difficultyOptions: Array<{ value: RandomPaperDifficultyMode; label: string; hint: string }> = [
  { value: 'foundation', label: '基础巩固', hint: '1-5' },
  { value: 'standard', label: '常规练习', hint: '3-7' },
  { value: 'advanced', label: '提升训练', hint: '4-8' },
  { value: 'challenge', label: '挑战拔高', hint: '6-10' },
  { value: 'custom', label: '自定义', hint: '1-10' },
]

export const matchModeOptions: Array<{ value: RandomPaperMatchMode; label: string }> = [
  { value: 'strict', label: '精准匹配' },
  { value: 'loose', label: '宽松匹配' },
]

export const defaultTypeCountByName: Record<string, number> = {
  单选题: 8,
  多选题: 3,
  填空题: 3,
  解答题: 5,
}

export function difficultyText(question: { difficultyScore10?: number; difficultyLabel?: string }) {
  const score = Number(question.difficultyScore10 || 0)
  if (score > 0) return `难度 ${score}/10`
  return question.difficultyLabel || '难度待定'
}

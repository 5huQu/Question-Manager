export const teachingStageOptions = ['小学', '初中', '高中', '其他']

export const stageGradeMap: Record<string, string[]> = {
  小学: ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'],
  初中: ['初一', '初二', '初三'],
  高中: ['高一', '高二', '高三'],
  其他: ['其他'],
}

export function gradeOptionsForTeachingStages(teachingStages?: string[]) {
  const selected = teachingStages?.length ? teachingStages : ['高中']
  return Array.from(new Set(selected.flatMap((stage) => stageGradeMap[stage] ?? [])))
}

export function ensureStageValue(value: string, options: string[]) {
  if (value && options.includes(value)) return value
  return options[0] ?? value ?? ''
}

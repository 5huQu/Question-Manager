import type { LearningLibraryType, LearningTagChapter, LearningTagLibrary } from '@/types'

export type EditorMode = 'visual' | 'json'
export type SaveState = 'idle' | 'saving' | 'saved' | 'error'
export type AddDialogMode = 'choice' | 'ai'
export type AiGuideStep = 1 | 2

export const STAGE_OPTIONS = [
  { value: 'primary_school', label: '小学' },
  { value: 'middle_school', label: '初中' },
  { value: 'high_school', label: '高中' },
  { value: 'adult', label: '成人' },
]

export const LIBRARY_TYPE_META: Record<LearningLibraryType, { label: string; sectionLabel: string; pointLabel: string }> = {
  knowledge_point: { label: '知识点标签库', sectionLabel: '章节', pointLabel: '知识点' },
  method_tag: { label: '方法题型标签库', sectionLabel: '分组', pointLabel: '方法题型标签' },
}

export const SUBJECT_OPTIONS = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理']

export function stageLabel(stage: string) {
  return STAGE_OPTIONS.find((option) => option.value === stage)?.label ?? stage
}

export function typeMeta(type?: LearningLibraryType) {
  return LIBRARY_TYPE_META[type ?? 'knowledge_point']
}

export function stats(library: LearningTagLibrary | null) {
  return {
    sections: library?.chapters.length ?? 0,
    points: library?.chapters.reduce((sum, chapter) => sum + chapter.knowledgePoints.length, 0) ?? 0,
  }
}

export function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function slugCode(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'custom_library'
}

export function stringifyLibrary(library: LearningTagLibrary) {
  return JSON.stringify({
    code: library.code,
    name: library.name,
    subject: library.subject,
    stage: library.stage,
    locale: library.locale,
    version: library.version,
    source: library.source,
    libraryType: library.libraryType,
    baseKnowledgeLibraryId: library.baseKnowledgeLibraryId,
    baseKnowledgeLibraryCode: library.baseKnowledgeLibraryCode,
    baseKnowledgeLibraryName: library.baseKnowledgeLibraryName,
    isDefault: library.isDefault,
    chapters: library.chapters.map((chapter) => ({
      code: chapter.code,
      name: chapter.name,
      sortOrder: chapter.sortOrder,
      knowledgePoints: chapter.knowledgePoints.map((point) => ({
        code: point.code,
        name: point.name,
        description: point.description,
        tagType: point.tagType,
        appliesTo: point.appliesTo,
        sortOrder: point.sortOrder,
      })),
    })),
  }, null, 2)
}

export function exportPayload(library: LearningTagLibrary) {
  const base = {
    code: library.code,
    name: library.name,
    subject: library.subject,
    stage: library.stage,
    locale: library.locale,
    version: library.version,
    source: library.source,
    libraryType: library.libraryType,
  }
  if (library.libraryType === 'method_tag') {
    return {
      ...base,
      baseKnowledgeLibraryCode: library.baseKnowledgeLibraryCode,
      groups: library.chapters.map((chapter) => ({
        code: chapter.code,
        name: chapter.name,
        sortOrder: chapter.sortOrder,
        tags: chapter.knowledgePoints,
      })),
    }
  }
  return {
    ...base,
    isDefault: library.isDefault,
    chapters: library.chapters,
  }
}

export function normalizeLibrary(value: unknown): LearningTagLibrary {
  const input = value as Partial<LearningTagLibrary> & {
    groups?: Array<LearningTagChapter & { tags?: LearningTagChapter['knowledgePoints'] }>
  }
  const libraryType: LearningLibraryType = input.libraryType === 'method_tag' ? 'method_tag' : 'knowledge_point'
  const rawSections = libraryType === 'method_tag'
    ? (Array.isArray(input.groups) ? input.groups.map((group) => ({ ...group, knowledgePoints: group.tags ?? group.knowledgePoints })) : input.chapters)
    : input.chapters
  return {
    id: input.id || input.code || makeId('library'),
    code: input.code || 'custom_library',
    name: input.name || '新标签库',
    subject: input.subject || '数学',
    stage: input.stage || 'high_school',
    locale: input.locale || 'zh-CN',
    version: input.version || '1.0.0',
    source: input.source || 'local-edit',
    libraryType,
    baseKnowledgeLibraryId: input.baseKnowledgeLibraryId,
    baseKnowledgeLibraryCode: input.baseKnowledgeLibraryCode,
    baseKnowledgeLibraryName: input.baseKnowledgeLibraryName,
    isDefault: libraryType === 'knowledge_point' && Boolean(input.isDefault),
    chapters: Array.isArray(rawSections) ? rawSections.map((chapter, chapterIndex) => ({
      id: chapter.id || chapter.code || makeId('chapter'),
      code: chapter.code || `${libraryType === 'method_tag' ? 'MG' : 'CH'}_${chapterIndex + 1}`,
      name: chapter.name || `新${typeMeta(libraryType).sectionLabel}`,
      sortOrder: Number(chapter.sortOrder || chapterIndex + 1),
      knowledgePoints: Array.isArray(chapter.knowledgePoints) ? chapter.knowledgePoints.map((point, pointIndex) => ({
        id: point.id || point.code || makeId('point'),
        code: point.code || `${libraryType === 'method_tag' ? 'MT' : 'KP'}_${chapterIndex + 1}_${pointIndex + 1}`,
        name: point.name || `新${typeMeta(libraryType).pointLabel}`,
        description: point.description,
        tagType: point.tagType || (libraryType === 'method_tag' ? 'method' : 'knowledge'),
        appliesTo: point.appliesTo,
        sortOrder: Number(point.sortOrder || pointIndex + 1),
      })) : [],
    })) : [],
  }
}

export function validate(library: LearningTagLibrary | null, jsonError = '') {
  if (jsonError) return jsonError
  if (!library) return '请选择或新建一个标签库'
  if (!library.code.trim() || !library.name.trim() || !library.subject.trim() || !library.stage.trim()) return '标签库 code、名称、科目、阶段不能为空'
  if (!library.chapters.length) return `至少需要一个${typeMeta(library.libraryType).sectionLabel}`
  for (const [chapterIndex, chapter] of library.chapters.entries()) {
    if (!chapter.code.trim() || !chapter.name.trim()) return `第 ${chapterIndex + 1} 个${typeMeta(library.libraryType).sectionLabel}缺少 code 或名称`
    if (!chapter.knowledgePoints.length) return `「${chapter.name || chapter.code}」至少需要一个${typeMeta(library.libraryType).pointLabel}`
    for (const [pointIndex, point] of chapter.knowledgePoints.entries()) {
      if (!point.code.trim() || !point.name.trim()) return `「${chapter.name || chapter.code}」的第 ${pointIndex + 1} 个标签缺少 code 或名称`
    }
  }
  return ''
}

export function newLibrary(libraryType: LearningLibraryType, baseLibrary?: LearningTagLibrary): LearningTagLibrary {
  const stamp = Date.now().toString(36)
  const meta = typeMeta(libraryType)
  return normalizeLibrary({
    id: `draft-${stamp}`,
    code: libraryType === 'method_tag' ? `method_library_${stamp}` : `custom_library_${stamp}`,
    name: libraryType === 'method_tag' ? '新方法题型标签库' : '新知识点标签库',
    subject: baseLibrary?.subject ?? '数学',
    stage: baseLibrary?.stage ?? 'high_school',
    locale: 'zh-CN',
    version: '1.0.0',
    source: 'local-edit',
    libraryType,
    baseKnowledgeLibraryId: baseLibrary?.id,
    baseKnowledgeLibraryCode: baseLibrary?.code,
    baseKnowledgeLibraryName: baseLibrary?.name,
    isDefault: false,
    chapters: [{
      id: makeId('chapter'),
      code: libraryType === 'method_tag' ? 'MG_NEW' : 'CH_NEW',
      name: `新${meta.sectionLabel}`,
      sortOrder: 1,
      knowledgePoints: [{
        id: makeId('point'),
        code: libraryType === 'method_tag' ? 'MT_NEW' : 'KP_NEW',
        name: `新${meta.pointLabel}`,
        tagType: libraryType === 'method_tag' ? 'method' : 'knowledge',
        sortOrder: 1,
      }],
    }],
  })
}

export function formatKnowledgeDirectory(library?: LearningTagLibrary) {
  if (!library) return '尚未选择对照知识点标签库。'
  return [
    `对照知识点库：${library.name}`,
    `科目：${library.subject}`,
    `学段：${stageLabel(library.stage)}`,
    '知识点目录：',
    ...library.chapters.flatMap((chapter, chapterIndex) => [
      `${chapterIndex + 1}. ${chapter.name}`,
      ...chapter.knowledgePoints.map((point) => `   - ${point.name}`),
    ]),
  ].join('\n')
}

export function inputClass(extra = '') {
  return `h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 ${extra}`
}

export function textareaClass(extra = '') {
  return `w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 ${extra}`
}

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
  return JSON.stringify(exportPayload(library), null, 2)
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
    baseKnowledgeLibraryId: library.baseKnowledgeLibraryId,
    baseKnowledgeLibraryCode: library.baseKnowledgeLibraryCode,
    baseKnowledgeLibraryName: library.baseKnowledgeLibraryName,
  }
  if (library.libraryType === 'method_tag') {
    return {
      ...base,
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

function importedLibraryError(message: string): never {
  throw new Error(`标签库 JSON schema 错误：${message}`)
}

function importedRecord(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) importedLibraryError(`${label}必须是对象。`)
  return value as Record<string, unknown>
}

function requiredImportedString(record: Record<string, unknown>, field: string) {
  if (typeof record[field] !== 'string' || !(record[field] as string).trim()) importedLibraryError(`字段 ${field} 必须是非空字符串。`)
  return (record[field] as string).trim()
}

function importedTagLibraryCode(value: string) {
  const code = value.toLowerCase()
  if (!/^[a-z0-9_-]{1,96}$/.test(code)) {
    importedLibraryError('字段 code 只能包含字母、数字、_ 或 -，且长度不能超过 96。')
  }
  return code
}

/** Strict contract for user-edited/imported JSON; draft normalization stays lenient. */
export function parseImportedLibrary(value: unknown): LearningTagLibrary {
  const library = importedRecord(value, '标签库')
  if (library.libraryType !== 'knowledge_point' && library.libraryType !== 'method_tag') {
    importedLibraryError('字段 libraryType 必须为 knowledge_point 或 method_tag；不支持 library_type，也不会默认知识点库。')
  }
  const code = importedTagLibraryCode(requiredImportedString(library, 'code'))
  for (const field of ['name', 'subject', 'stage']) requiredImportedString(library, field)
  for (const field of ['locale', 'version', 'source', 'baseKnowledgeLibraryId', 'baseKnowledgeLibraryCode', 'baseKnowledgeLibraryName']) {
    if (library[field] !== undefined && typeof library[field] !== 'string') importedLibraryError(`字段 ${field} 必须是字符串。`)
  }
  if (library.isDefault !== undefined && typeof library.isDefault !== 'boolean') importedLibraryError('字段 isDefault 必须是布尔值。')
  const isMethod = library.libraryType === 'method_tag'
  const sectionField = isMethod ? 'groups' : 'chapters'
  const pointField = isMethod ? 'tags' : 'knowledgePoints'
  const forbiddenField = isMethod ? 'chapters' : 'groups'
  if (library[forbiddenField] !== undefined) importedLibraryError(`${library.libraryType} 不支持字段 ${forbiddenField}。`)
  if (!Array.isArray(library[sectionField]) || !library[sectionField].length) importedLibraryError(`字段 ${sectionField} 必须是非空数组。`)
  for (const [sectionIndex, rawSection] of (library[sectionField] as unknown[]).entries()) {
    const section = importedRecord(rawSection, `${sectionField}[${sectionIndex}]`)
    requiredImportedString(section, 'code')
    requiredImportedString(section, 'name')
    if (section.sortOrder !== undefined && (typeof section.sortOrder !== 'number' || !Number.isFinite(section.sortOrder))) importedLibraryError(`${sectionField}[${sectionIndex}].sortOrder 必须是数字。`)
    if (!Array.isArray(section[pointField]) || !section[pointField].length) importedLibraryError(`${sectionField}[${sectionIndex}].${pointField} 必须是非空数组。`)
    for (const [pointIndex, rawPoint] of (section[pointField] as unknown[]).entries()) {
      const point = importedRecord(rawPoint, `${sectionField}[${sectionIndex}].${pointField}[${pointIndex}]`)
      requiredImportedString(point, 'code')
      requiredImportedString(point, 'name')
      if (point.description !== undefined && typeof point.description !== 'string') importedLibraryError(`${sectionField}[${sectionIndex}].${pointField}[${pointIndex}].description 必须是字符串。`)
      if (point.sortOrder !== undefined && (typeof point.sortOrder !== 'number' || !Number.isFinite(point.sortOrder))) importedLibraryError(`${sectionField}[${sectionIndex}].${pointField}[${pointIndex}].sortOrder 必须是数字。`)
      if (point.tagType !== undefined && typeof point.tagType !== 'string') importedLibraryError(`${sectionField}[${sectionIndex}].${pointField}[${pointIndex}].tagType 必须是字符串。`)
      if (isMethod && point.tagType !== undefined && !['method', 'problem_type', 'strategy', 'other'].includes(point.tagType as string)) importedLibraryError(`${sectionField}[${sectionIndex}].${pointField}[${pointIndex}].tagType 无效。`)
      if (point.appliesTo !== undefined && (!Array.isArray(point.appliesTo) || point.appliesTo.some((item) => typeof item !== 'string'))) importedLibraryError(`${sectionField}[${sectionIndex}].${pointField}[${pointIndex}].appliesTo 必须是字符串数组。`)
    }
  }
  return normalizeLibrary({ ...library, code })
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

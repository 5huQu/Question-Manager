import fs from 'node:fs'
import path from 'node:path'
import { tagLibrariesDir } from '../../config.js'
import { parseJson } from '../../utils/json.js'

export function normalizeTags(value: unknown) {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，、;/；\n]+/) : []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const item of raw) {
    const tag = String(item || '').replace(/\s+/g, ' ').trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return tags.slice(0, 8)
}

export function uniqueTags(values: unknown[]) {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const item of values) {
    const tag = String(item || '').replace(/\s+/g, ' ').trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return tags
}

export function tagLibraryType(value: unknown) {
  return String(value) === 'method_tag' ? 'method_tag' : 'knowledge_point'
}

export function safeTagLibraryCode(value: unknown, fallback = 'custom_library') {
  const raw = String(value || '').trim().toLowerCase()
  return (raw.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || fallback).slice(0, 96)
}

export function tagLibraryFilePath(code: string) {
  return path.join(tagLibrariesDir, `${safeTagLibraryCode(code)}.json`)
}

export function normalizeLearningTagLibrary(rawValue: unknown, fallbackCode = 'learning_tag_library') {
  const raw = rawValue as Record<string, any>
  const libraryType = tagLibraryType(raw?.libraryType)
  const code = safeTagLibraryCode(raw?.code, fallbackCode)
  const sections = libraryType === 'method_tag'
    ? (Array.isArray(raw?.groups) ? raw.groups : Array.isArray(raw?.chapters) ? raw.chapters : [])
    : (Array.isArray(raw?.chapters) ? raw.chapters : Array.isArray(raw?.groups) ? raw.groups : [])
  return {
    id: code,
    code,
    name: String(raw?.name || code),
    subject: String(raw?.subject || '数学'),
    stage: String(raw?.stage || 'high_school'),
    locale: String(raw?.locale || 'zh-CN'),
    version: String(raw?.version || '1.0.0'),
    source: String(raw?.source || 'local-edit'),
    libraryType,
    baseKnowledgeLibraryId: raw?.baseKnowledgeLibraryId ? String(raw.baseKnowledgeLibraryId) : undefined,
    baseKnowledgeLibraryCode: raw?.baseKnowledgeLibraryCode ? String(raw.baseKnowledgeLibraryCode) : undefined,
    baseKnowledgeLibraryName: raw?.baseKnowledgeLibraryName ? String(raw.baseKnowledgeLibraryName) : undefined,
    isDefault: libraryType === 'knowledge_point' && Boolean(raw?.isDefault),
    chapters: sections.map((section: any, sectionIndex: number) => {
      const points = libraryType === 'method_tag'
        ? (Array.isArray(section?.tags) ? section.tags : Array.isArray(section?.knowledgePoints) ? section.knowledgePoints : [])
        : (Array.isArray(section?.knowledgePoints) ? section.knowledgePoints : Array.isArray(section?.tags) ? section.tags : [])
      const sectionCode = String(section?.code || `${libraryType === 'method_tag' ? 'MG' : 'CH'}_${sectionIndex + 1}`)
      return {
        id: sectionCode,
        code: sectionCode,
        name: String(section?.name || `分组 ${sectionIndex + 1}`),
        sortOrder: Number(section?.sortOrder || sectionIndex + 1),
        knowledgePoints: points.map((point: any, pointIndex: number) => {
          const pointCode = String(point?.code || `${libraryType === 'method_tag' ? 'MT' : 'KP'}_${sectionIndex + 1}_${pointIndex + 1}`)
          return {
            id: pointCode,
            code: pointCode,
            name: String(point?.name || `标签 ${pointIndex + 1}`),
            description: point?.description ? String(point.description) : undefined,
            tagType: point?.tagType ? String(point.tagType) : libraryType === 'method_tag' ? 'method' : 'knowledge',
            appliesTo: Array.isArray(point?.appliesTo) ? point.appliesTo.map((item: unknown) => String(item)).filter(Boolean) : undefined,
            sortOrder: Number(point?.sortOrder || pointIndex + 1),
          }
        }),
      }
    }),
  }
}

export function serializeLearningTagLibrary(library: ReturnType<typeof normalizeLearningTagLibrary>) {
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
        tags: chapter.knowledgePoints.map((point: any) => ({
          code: point.code,
          name: point.name,
          description: point.description,
          tagType: point.tagType || 'method',
          appliesTo: point.appliesTo,
          sortOrder: point.sortOrder,
        })),
      })),
    }
  }
  return {
    ...base,
    isDefault: Boolean(library.isDefault),
    chapters: library.chapters.map((chapter) => ({
      code: chapter.code,
      name: chapter.name,
      sortOrder: chapter.sortOrder,
      knowledgePoints: chapter.knowledgePoints.map((point: any) => ({
        code: point.code,
        name: point.name,
        description: point.description,
        tagType: point.tagType || 'knowledge',
        sortOrder: point.sortOrder,
      })),
    })),
  }
}

export function validateLearningTagLibrary(library: ReturnType<typeof normalizeLearningTagLibrary>) {
  if (!library.code || !library.name || !library.subject || !library.stage) return '标签库 code、名称、科目、阶段不能为空。'
  if (!library.chapters.length) return library.libraryType === 'method_tag' ? '至少需要一个分组。' : '至少需要一个章节。'
  for (const [chapterIndex, chapter] of library.chapters.entries()) {
    if (!chapter.code || !chapter.name) return `第 ${chapterIndex + 1} 个${library.libraryType === 'method_tag' ? '分组' : '章节'}缺少 code 或名称。`
    if (!chapter.knowledgePoints.length) return `「${chapter.name}」至少需要一个标签。`
    for (const [pointIndex, point] of chapter.knowledgePoints.entries()) {
      if (!point.code || !point.name) return `「${chapter.name}」的第 ${pointIndex + 1} 个标签缺少 code 或名称。`
    }
  }
  return ''
}

export function readLearningTagLibraries() {
  const files = fs.readdirSync(tagLibrariesDir)
    .filter((fileName) => fileName.toLowerCase().endsWith('.json'))
    .sort()
  const libraries = files.flatMap((fileName) => {
    const filePath = path.join(tagLibrariesDir, fileName)
    const payload = parseJson<unknown>(fs.readFileSync(filePath, 'utf8'), null)
    if (!payload) return []
    const values = Array.isArray(payload) ? payload : [payload]
    return values.map((value, index) => normalizeLearningTagLibrary(value, path.basename(fileName, '.json') || `library_${index + 1}`))
  })
  return libraries.sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name, 'zh-CN'))
}

export function writeLearningTagLibrary(rawPayload: unknown) {
  const library = normalizeLearningTagLibrary(rawPayload)
  const error = validateLearningTagLibrary(library)
  if (error) throw new Error(error)
  if (library.isDefault && library.libraryType === 'knowledge_point') {
    for (const existing of readLearningTagLibraries()) {
      if (existing.code === library.code || existing.libraryType !== 'knowledge_point' || !existing.isDefault) continue
      const existingPath = tagLibraryFilePath(existing.code)
      if (fs.existsSync(existingPath)) {
        fs.writeFileSync(existingPath, `${JSON.stringify(serializeLearningTagLibrary({ ...existing, isDefault: false }), null, 2)}\n`)
      }
    }
  }
  fs.writeFileSync(tagLibraryFilePath(library.code), `${JSON.stringify(serializeLearningTagLibrary(library), null, 2)}\n`)
  return normalizeLearningTagLibrary(serializeLearningTagLibrary(library))
}

export function readTagLibraries() {
  const libraries = readLearningTagLibraries()
  const libraryKnowledgePoints = libraries.filter((library) => library.libraryType === 'knowledge_point').flatMap((library) =>
    library.chapters.flatMap((chapter) => chapter.knowledgePoints.map((item: any) => item.name).filter(Boolean))
  )
  const librarySolutionMethods = libraries.filter((library) => library.libraryType === 'method_tag').flatMap((library) =>
    library.chapters.flatMap((chapter) => chapter.knowledgePoints.map((item: any) => item.name).filter(Boolean))
  )
  const knowledgePoints = uniqueTags([...libraryKnowledgePoints])
  const solutionMethods = uniqueTags([...librarySolutionMethods])
  return {
    knowledgePoints,
    solutionMethods,
    stages: [],
    questionTypes: [],
    difficultyLabels: ['基础', '中等', '较难', '压轴'],
  }
}

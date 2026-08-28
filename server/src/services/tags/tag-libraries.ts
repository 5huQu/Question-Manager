import fs from 'node:fs'
import path from 'node:path'
import { tagLibrariesDir } from '../../config.js'
import { db } from '../../db/connection.js'
import { configuredGradeStages } from '../settings/app-settings.js'
import { parseJson } from '../../utils/json.js'
import { difficultyLabel10 } from '../../utils/search.js'

const DEFAULT_QUESTION_TYPES = ['单选题', '多选题', '填空题', '解答题']
const DEFAULT_DIFFICULTY_LABELS = ['基础', '中等', '较难', '压轴']

type QuestionBankFilterRow = {
  stage?: string | null
  question_type?: string | null
  difficulty_label?: string | null
  difficulty_score_10?: number | string | null
  knowledge_points_json?: string | null
  solution_methods_json?: string | null
}

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

function storedTagValues(value: unknown) {
  const parsed = parseJson<unknown>(String(value || '[]'), [])
  return Array.isArray(parsed) ? parsed : []
}

function questionBankFilterRows() {
  return db.prepare(`
    SELECT stage, question_type, difficulty_label, difficulty_score_10,
           knowledge_points_json, solution_methods_json
    FROM question_bank_items
    WHERE COALESCE(bank_status, '') <> 'skipped'
  `).all() as QuestionBankFilterRow[]
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

function importedLibraryError(message: string): never {
  throw new Error(`标签库 JSON schema 错误：${message}`)
}

function importedRecord(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) importedLibraryError(`${label}必须是对象。`)
  return value as Record<string, unknown>
}

function requiredImportedString(raw: Record<string, unknown>, field: string) {
  const value = raw[field]
  if (typeof value !== 'string' || !value.trim()) importedLibraryError(`字段 ${field} 必须是非空字符串。`)
  return value.trim()
}

function optionalImportedString(raw: Record<string, unknown>, field: string) {
  if (raw[field] === undefined) return undefined
  if (typeof raw[field] !== 'string') importedLibraryError(`字段 ${field} 必须是字符串。`)
  return raw[field]
}

function importedSections(value: unknown, sectionField: 'chapters' | 'groups', pointField: 'knowledgePoints' | 'tags', libraryType: 'knowledge_point' | 'method_tag') {
  if (!Array.isArray(value) || !value.length) importedLibraryError(`字段 ${sectionField} 必须是非空数组。`)
  return value.map((rawSection, sectionIndex) => {
    const section = importedRecord(rawSection, `${sectionField}[${sectionIndex}]`)
    const code = requiredImportedString(section, 'code')
    const name = requiredImportedString(section, 'name')
    if (!Array.isArray(section[pointField]) || !section[pointField].length) {
      importedLibraryError(`${sectionField}[${sectionIndex}].${pointField} 必须是非空数组。`)
    }
    return {
      id: code,
      code,
      name,
      sortOrder: typeof section.sortOrder === 'number' && Number.isFinite(section.sortOrder) ? section.sortOrder : sectionIndex + 1,
      knowledgePoints: (section[pointField] as unknown[]).map((rawPoint, pointIndex) => {
        const point = importedRecord(rawPoint, `${sectionField}[${sectionIndex}].${pointField}[${pointIndex}]`)
        const pointCode = requiredImportedString(point, 'code')
        const pointName = requiredImportedString(point, 'name')
        if (point.sortOrder !== undefined && (typeof point.sortOrder !== 'number' || !Number.isFinite(point.sortOrder))) {
          importedLibraryError(`${sectionField}[${sectionIndex}].${pointField}[${pointIndex}].sortOrder 必须是数字。`)
        }
        if (point.appliesTo !== undefined && (!Array.isArray(point.appliesTo) || point.appliesTo.some((item) => typeof item !== 'string'))) {
          importedLibraryError(`${sectionField}[${sectionIndex}].${pointField}[${pointIndex}].appliesTo 必须是字符串数组。`)
        }
        const tagType = optionalImportedString(point, 'tagType')
        if (libraryType === 'method_tag' && tagType && !['method', 'problem_type', 'strategy', 'other'].includes(tagType)) {
          importedLibraryError(`${sectionField}[${sectionIndex}].${pointField}[${pointIndex}].tagType 无效。`)
        }
        return {
          id: pointCode,
          code: pointCode,
          name: pointName,
          description: optionalImportedString(point, 'description'),
          tagType: tagType || (libraryType === 'method_tag' ? 'method' : 'knowledge'),
          appliesTo: point.appliesTo as string[] | undefined,
          sortOrder: typeof point.sortOrder === 'number' ? point.sortOrder : pointIndex + 1,
        }
      }),
    }
  })
}

/** Strict contract for user-imported JSON. Historical file reads use normalizeLearningTagLibrary instead. */
export function normalizeImportedLearningTagLibrary(rawValue: unknown) {
  const raw = importedRecord(rawValue, '标签库')
  if (raw.libraryType !== 'knowledge_point' && raw.libraryType !== 'method_tag') {
    importedLibraryError('字段 libraryType 必须为 knowledge_point 或 method_tag；不支持 library_type，也不会默认知识点库。')
  }
  const libraryType = raw.libraryType
  const code = safeTagLibraryCode(requiredImportedString(raw, 'code'))
  const name = requiredImportedString(raw, 'name')
  const subject = requiredImportedString(raw, 'subject')
  const stage = requiredImportedString(raw, 'stage')
  if (raw.locale !== undefined && typeof raw.locale !== 'string') importedLibraryError('字段 locale 必须是字符串。')
  if (raw.version !== undefined && typeof raw.version !== 'string') importedLibraryError('字段 version 必须是字符串。')
  if (raw.source !== undefined && typeof raw.source !== 'string') importedLibraryError('字段 source 必须是字符串。')
  if (raw.isDefault !== undefined && typeof raw.isDefault !== 'boolean') importedLibraryError('字段 isDefault 必须是布尔值。')
  if (raw.baseKnowledgeLibraryCode !== undefined && typeof raw.baseKnowledgeLibraryCode !== 'string') importedLibraryError('字段 baseKnowledgeLibraryCode 必须是字符串。')

  if (libraryType === 'knowledge_point' && raw.groups !== undefined) importedLibraryError('knowledge_point 只能使用 chapters / knowledgePoints，不能使用 groups / tags。')
  if (libraryType === 'method_tag' && raw.chapters !== undefined) importedLibraryError('method_tag 只能使用 groups / tags，不能使用 chapters / knowledgePoints。')
  const chapters = libraryType === 'method_tag'
    ? importedSections(raw.groups, 'groups', 'tags', libraryType)
    : importedSections(raw.chapters, 'chapters', 'knowledgePoints', libraryType)
  return {
    id: code,
    code,
    name,
    subject,
    stage,
    locale: (raw.locale as string | undefined) || 'zh-CN',
    version: (raw.version as string | undefined) || '1.0.0',
    source: (raw.source as string | undefined) || 'local-edit',
    libraryType,
    baseKnowledgeLibraryId: optionalImportedString(raw, 'baseKnowledgeLibraryId'),
    baseKnowledgeLibraryCode: optionalImportedString(raw, 'baseKnowledgeLibraryCode'),
    baseKnowledgeLibraryName: optionalImportedString(raw, 'baseKnowledgeLibraryName'),
    isDefault: libraryType === 'knowledge_point' && Boolean(raw.isDefault),
    chapters,
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

export function writeLearningTagLibraries(rawPayloads: unknown[]) {
  if (!Array.isArray(rawPayloads) || !rawPayloads.length) importedLibraryError('必须提供非空标签库数组。')
  const libraries = rawPayloads.map(normalizeImportedLearningTagLibrary)
  const duplicate = libraries.find((library, index) => libraries.findIndex((candidate) => candidate.code === library.code) !== index)
  if (duplicate) importedLibraryError(`同一批次包含重复 code：${duplicate.code}。`)

  const toWrite = new Map<string, ReturnType<typeof normalizeLearningTagLibrary>>()
  for (const library of libraries) toWrite.set(library.code, library)
  if (libraries.some((library) => library.libraryType === 'knowledge_point' && library.isDefault)) {
    for (const existing of readLearningTagLibraries()) {
      if (existing.libraryType === 'knowledge_point' && existing.isDefault && !toWrite.has(existing.code)) {
        toWrite.set(existing.code, { ...existing, isDefault: false })
      }
    }
  }

  const staged: Array<{ target: string; temp: string; backup: string; hadTarget: boolean }> = []
  try {
    for (const [code, library] of toWrite) {
      const target = tagLibraryFilePath(code)
      const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const temp = `${target}.${token}.tmp`
      const backup = `${target}.${token}.bak`
      fs.writeFileSync(temp, `${JSON.stringify(serializeLearningTagLibrary(library), null, 2)}\n`)
      staged.push({ target, temp, backup, hadTarget: fs.existsSync(target) })
    }
    for (const item of staged) if (item.hadTarget) fs.renameSync(item.target, item.backup)
    for (const item of staged) fs.renameSync(item.temp, item.target)
    for (const item of staged) if (fs.existsSync(item.backup)) fs.unlinkSync(item.backup)
  } catch (error) {
    for (const item of staged) {
      if (fs.existsSync(item.temp)) fs.unlinkSync(item.temp)
      if (fs.existsSync(item.backup)) {
        if (fs.existsSync(item.target)) fs.unlinkSync(item.target)
        fs.renameSync(item.backup, item.target)
      } else if (!item.hadTarget && fs.existsSync(item.target)) {
        fs.unlinkSync(item.target)
      }
    }
    throw error
  }
  return libraries.map((library) => normalizeLearningTagLibrary(serializeLearningTagLibrary(library)))
}

export function writeLearningTagLibrary(rawPayload: unknown) {
  return writeLearningTagLibraries([rawPayload])[0]
}

export function readTagLibraries() {
  const libraries = readLearningTagLibraries()
  const questionRows = questionBankFilterRows()
  const libraryKnowledgePoints = libraries.filter((library) => library.libraryType === 'knowledge_point').flatMap((library) =>
    library.chapters.flatMap((chapter) => chapter.knowledgePoints.map((item: any) => item.name).filter(Boolean))
  )
  const librarySolutionMethods = libraries.filter((library) => library.libraryType === 'method_tag').flatMap((library) =>
    library.chapters.flatMap((chapter) => chapter.knowledgePoints.map((item: any) => item.name).filter(Boolean))
  )
  const knowledgePoints = uniqueTags([...libraryKnowledgePoints])
  const solutionMethods = uniqueTags([...librarySolutionMethods])
  const bankKnowledgePoints = questionRows.flatMap((row) => storedTagValues(row.knowledge_points_json))
  const bankSolutionMethods = questionRows.flatMap((row) => storedTagValues(row.solution_methods_json))
  const bankDifficultyLabels = questionRows.flatMap((row) => [
    row.difficulty_label,
    difficultyLabel10(Number(row.difficulty_score_10 || 0)),
  ])
  return {
    // Keep the flat lists for existing consumers, and expose the normalized
    // hierarchy for editors that need chapter/group-aware selection.
    libraries,
    // 选项既要覆盖标签库，也要覆盖已经写入题库但尚未进入标签库的历史数据。
    knowledgePoints: uniqueTags([...knowledgePoints, ...bankKnowledgePoints]),
    solutionMethods: uniqueTags([...solutionMethods, ...bankSolutionMethods]),
    stages: uniqueTags([...configuredGradeStages(), ...questionRows.map((row) => row.stage)]),
    questionTypes: uniqueTags([...DEFAULT_QUESTION_TYPES, ...questionRows.map((row) => row.question_type)]),
    difficultyLabels: uniqueTags([...DEFAULT_DIFFICULTY_LABELS, ...bankDifficultyLabels]),
  }
}

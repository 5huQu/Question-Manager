import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpenCheck, CheckCircle2, ChevronDown, Code2, Copy, Download, GripVertical, ListTree, Plus, Save, Sparkles, Trash2, X } from 'lucide-react'
import { api } from '@/api/client'
import { Badge, Button, Empty, PageTitle } from '@/components/ui'
import type { LearningLibraryType, LearningTagChapter, LearningTagLibrary } from '@/types'

type EditorMode = 'visual' | 'json'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type AddDialogMode = 'choice' | 'ai'
type AiGuideStep = 1 | 2

const STAGE_OPTIONS = [
  { value: 'primary_school', label: '小学' },
  { value: 'middle_school', label: '初中' },
  { value: 'high_school', label: '高中' },
  { value: 'adult', label: '成人' },
]

const LIBRARY_TYPE_META: Record<LearningLibraryType, { label: string; sectionLabel: string; pointLabel: string }> = {
  knowledge_point: { label: '知识点标签库', sectionLabel: '章节', pointLabel: '知识点' },
  method_tag: { label: '方法题型标签库', sectionLabel: '分组', pointLabel: '方法题型标签' },
}

const SUBJECT_OPTIONS = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理']

function stageLabel(stage: string) {
  return STAGE_OPTIONS.find((option) => option.value === stage)?.label ?? stage
}

function typeMeta(type?: LearningLibraryType) {
  return LIBRARY_TYPE_META[type ?? 'knowledge_point']
}

function stats(library: LearningTagLibrary | null) {
  return {
    sections: library?.chapters.length ?? 0,
    points: library?.chapters.reduce((sum, chapter) => sum + chapter.knowledgePoints.length, 0) ?? 0,
  }
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function slugCode(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'custom_library'
}

function stringifyLibrary(library: LearningTagLibrary) {
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

function exportPayload(library: LearningTagLibrary) {
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

function normalizeLibrary(value: unknown): LearningTagLibrary {
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

function validate(library: LearningTagLibrary | null, jsonError = '') {
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

function newLibrary(libraryType: LearningLibraryType, baseLibrary?: LearningTagLibrary): LearningTagLibrary {
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

function formatKnowledgeDirectory(library?: LearningTagLibrary) {
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

function inputClass(extra = '') {
  return `h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 ${extra}`
}

function textareaClass(extra = '') {
  return `w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 ${extra}`
}

export default function LearningTagsPage() {
  const [libraries, setLibraries] = useState<LearningTagLibrary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [editor, setEditor] = useState<LearningTagLibrary | null>(null)
  const [mode, setMode] = useState<EditorMode>('visual')
  const [jsonText, setJsonText] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState('')
  const [lastSavedAt, setLastSavedAt] = useState('')
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addDialogMode, setAddDialogMode] = useState<AddDialogMode>('choice')
  const [addLibraryType, setAddLibraryType] = useState<LearningLibraryType>('knowledge_point')
  const [addBaseKnowledgeLibraryId, setAddBaseKnowledgeLibraryId] = useState('')
  const [aiGuideStep, setAiGuideStep] = useState<AiGuideStep>(1)
  const [aiSubject, setAiSubject] = useState('数学')
  const [aiStage, setAiStage] = useState('high_school')
  const [aiScopeNote, setAiScopeNote] = useState('')
  const [aiJsonText, setAiJsonText] = useState('')
  const [aiImporting, setAiImporting] = useState(false)
  const [draggedChapterId, setDraggedChapterId] = useState<string | null>(null)
  const [dragOverChapterId, setDragOverChapterId] = useState<string | null>(null)
  const saveTimerRef = useRef<number | null>(null)

  const knowledgeLibraries = useMemo(() => libraries.filter((library) => library.libraryType === 'knowledge_point'), [libraries])
  const selectedBaseKnowledgeLibrary = knowledgeLibraries.find((library) => library.id === addBaseKnowledgeLibraryId) ?? knowledgeLibraries[0]
  const addTypeMeta = typeMeta(addLibraryType)
  const aiScopeText = [
    `学段：${stageLabel(aiStage)}`,
    `科目：${aiSubject}`,
    aiScopeNote.trim() ? `补充范围：${aiScopeNote.trim()}` : '',
  ].filter(Boolean).join('；')
  const aiStartPrompt = addLibraryType === 'knowledge_point'
    ? `你是一名课程管理系统的知识点目录顾问。请围绕「${aiScopeText || '待补充范围'}」整理适合题库工作台使用的“知识点标签库”。\n\n要求：\n1. 只整理知识点，不整理解题方法、技巧、拔高模型或题型套路。\n2. 先输出一版草案，按“章节 / 知识点”结构展示。\n3. 每个知识点都需要有中文名，并建议一个稳定英文大写编码。章节编码使用 CH_ 前缀，知识点编码使用 KP_ 前缀。\n4. 不要直接输出 JSON。先问我是否需要增删、合并、改名或调整顺序。\n5. 之后请和我一轮一轮确认，直到我明确说“可以生成文件内容”。`
    : `你是一名课程管理系统的方法题型标签顾问。请基于下面这份已有知识点目录，为「${aiScopeText || '待补充范围'}」整理适合题库工作台使用的“方法题型标签库”。\n\n${formatKnowledgeDirectory(selectedBaseKnowledgeLibrary)}\n\n要求：\n1. 必须围绕上面的知识点目录生成，不要脱离对照知识点库。\n2. 只整理解题方法、题型、策略、常见处理路径，不要重复生成知识点标签。\n3. 先输出一版草案，按“方法分组 / 方法题型标签”结构展示。\n4. 每个标签需要中文名、标签类型（method/problem_type/strategy/other）和适用知识点范围。\n5. 不要直接输出 JSON。先问我是否需要增删、合并、改名或调整顺序，直到我明确说“可以生成文件内容”。`
  const aiJsonPrompt = addLibraryType === 'knowledge_point'
    ? `请根据我们已经确认过的最终知识点目录，生成可以接入题库工作台的 JSON 数组。\n\n必须输出如下数组结构，只输出 JSON，不要解释：\n\n[\n  {\n    "libraryType": "knowledge_point",\n    "code": "${slugCode(`${aiStage}_${aiSubject}`)}",\n    "name": "${stageLabel(aiStage)}${aiSubject}知识点标签库",\n    "subject": "${aiSubject}",\n    "stage": "${aiStage}",\n    "locale": "zh-CN",\n    "version": "1.0.0",\n    "source": "ai-assisted",\n    "chapters": [\n      {\n        "code": "CH_EXAMPLE",\n        "name": "章节中文名",\n        "knowledgePoints": [\n          { "code": "KP_EXAMPLE", "name": "知识点中文名" }\n        ]\n      }\n    ]\n  }\n]\n\n要求：\n1. 所有 code 必须稳定、唯一、使用英文大写和下划线。\n2. 章节编码只能使用 CH_ 前缀，知识点编码只能使用 KP_ 前缀。\n3. 不要包含 MT_、ADV_ 或任何解题方法类标签。\n4. 老师在系统里只会看到中文名，所以 name 必须清晰、可直接展示。`
    : `请根据我们已经确认过的最终方法题型目录，生成可以接入题库工作台的 JSON 数组。\n\n必须输出如下数组结构，只输出 JSON，不要解释：\n\n[\n  {\n    "libraryType": "method_tag",\n    "baseKnowledgeLibraryCode": "${selectedBaseKnowledgeLibrary?.code ?? '请填写对照知识点库 code'}",\n    "code": "${slugCode(`${aiStage}_${aiSubject}_methods`)}",\n    "name": "${stageLabel(aiStage)}${aiSubject}方法题型标签库",\n    "subject": "${selectedBaseKnowledgeLibrary?.subject ?? aiSubject}",\n    "stage": "${selectedBaseKnowledgeLibrary?.stage ?? aiStage}",\n    "locale": "zh-CN",\n    "version": "1.0.0",\n    "source": "ai-assisted",\n    "groups": [\n      {\n        "code": "MG_EXAMPLE",\n        "name": "分组中文名",\n        "tags": [\n          {\n            "code": "MT_EXAMPLE",\n            "name": "方法题型标签中文名",\n            "tagType": "method",\n            "appliesTo": ["对应知识点名称"]\n          }\n        ]\n      }\n    ]\n  }\n]\n\n要求：\n1. 所有 code 必须稳定、唯一、使用英文大写和下划线。\n2. 分组编码使用 MG_ 前缀；方法题型标签编码优先使用 MT_ 前缀。\n3. tagType 只能使用 method、problem_type、strategy、other。\n4. appliesTo 填中文知识点名称，必须来自对照知识点目录或其合理章节范围。\n5. 不要生成 chapters / knowledgePoints 字段。`
  const parsedJson = useMemo(() => {
    if (mode !== 'json') return { library: editor, error: '' }
    try {
      return { library: normalizeLibrary(JSON.parse(jsonText)), error: '' }
    } catch {
      return { library: null, error: '当前内容不是有效 JSON' }
    }
  }, [editor, jsonText, mode])
  const activeLibrary = mode === 'json' ? parsedJson.library : editor
  const activeStats = stats(activeLibrary)
  const activeMeta = typeMeta(activeLibrary?.libraryType)
  const validationError = validate(activeLibrary, parsedJson.error)
  const statusLabel = validationError || (
    saveState === 'saving' ? '正在保存'
      : saveState === 'saved' && lastSavedAt ? `已保存 ${lastSavedAt}`
        : dirty ? '等待自动保存'
          : '已同步'
  )

  const selectLibrary = useCallback((library: LearningTagLibrary) => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    setSelectedId(library.id)
    setEditor(library)
    setJsonText(stringifyLibrary(library))
    setExpandedIds(new Set())
    setMode('visual')
    setDirty(false)
    setSaveState('idle')
    setError('')
  }, [])

  const loadLibraries = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api<{ libraries: LearningTagLibrary[] }>('/api/learning-tags/libraries')
      const nextLibraries = (data.libraries ?? []).map(normalizeLibrary)
      setLibraries(nextLibraries)
      const selected = nextLibraries.find((library) => library.id === selectedId) ?? nextLibraries[0] ?? null
      if (selected) selectLibrary(selected)
      if (!selected) {
        setSelectedId('')
        setEditor(null)
        setJsonText('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [selectLibrary, selectedId])

  useEffect(() => {
    void loadLibraries()
  }, [])

  useEffect(() => {
    if (!addBaseKnowledgeLibraryId || !knowledgeLibraries.some((library) => library.id === addBaseKnowledgeLibraryId)) {
      setAddBaseKnowledgeLibraryId(knowledgeLibraries[0]?.id ?? '')
    }
  }, [addBaseKnowledgeLibraryId, knowledgeLibraries])

  const saveLibrary = useCallback(async (library: LearningTagLibrary, silent = true) => {
    const message = validate(library)
    if (message) {
      if (!silent) setError(message)
      return
    }
    setSaveState('saving')
    setError('')
    try {
      const result = await api<{ library: LearningTagLibrary }>('/api/learning-tags/libraries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyLibrary(library),
      })
      const saved = normalizeLibrary(result.library)
      setLibraries((current) => {
        const rest = current.filter((item) => item.code !== saved.code && item.id !== saved.id)
        return [saved, ...rest].sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name, 'zh-CN'))
      })
      setSelectedId(saved.id)
      setEditor(saved)
      if (mode === 'visual') setJsonText(stringifyLibrary(saved))
      setDirty(false)
      setSaveState('saved')
      setLastSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
    } catch (err) {
      setSaveState('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [mode])

  useEffect(() => {
    if (!dirty || !activeLibrary || validationError) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => void saveLibrary(activeLibrary), 900)
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [activeLibrary, dirty, saveLibrary, validationError])

  const markEditor = (next: LearningTagLibrary) => {
    setEditor(next)
    if (mode === 'visual') setJsonText(stringifyLibrary(next))
    setDirty(true)
    setSaveState('idle')
  }

  const updateChapter = (chapterIndex: number, updater: (chapter: LearningTagChapter) => LearningTagChapter) => {
    if (!editor) return
    markEditor({
      ...editor,
      chapters: editor.chapters.map((chapter, index) => index === chapterIndex ? updater(chapter) : chapter),
    })
  }

  const reorderChapter = (sourceChapterId: string, targetChapterId: string) => {
    if (!editor || sourceChapterId === targetChapterId) return
    const sourceIndex = editor.chapters.findIndex((chapter) => chapter.id === sourceChapterId)
    const targetIndex = editor.chapters.findIndex((chapter) => chapter.id === targetChapterId)
    if (sourceIndex < 0 || targetIndex < 0) return

    const nextChapters = [...editor.chapters]
    const [moved] = nextChapters.splice(sourceIndex, 1)
    nextChapters.splice(targetIndex, 0, moved)
    markEditor({
      ...editor,
      chapters: nextChapters.map((chapter, index) => ({ ...chapter, sortOrder: index + 1 })),
    })
  }

  const addLibrary = (libraryType: LearningLibraryType) => {
    const baseLibrary = libraryType === 'method_tag' ? knowledgeLibraries[0] : undefined
    const next = newLibrary(libraryType, baseLibrary)
    setLibraries((current) => [next, ...current])
    selectLibrary(next)
    setDirty(true)
  }

  const openAddDialog = () => {
    setAddDialogMode('choice')
    setAddLibraryType('knowledge_point')
    setAiGuideStep(1)
    setAiJsonText('')
    setError('')
    setAddDialogOpen(true)
  }

  const handleDirectAdd = () => {
    const baseLibrary = addLibraryType === 'method_tag' ? selectedBaseKnowledgeLibrary : undefined
    if (addLibraryType === 'method_tag' && !baseLibrary) {
      setError('请先选择对照知识点标签库。')
      return
    }
    const next = newLibrary(addLibraryType, baseLibrary)
    setLibraries((current) => [next, ...current])
    selectLibrary(next)
    setDirty(true)
    setAddDialogOpen(false)
  }

  const copyPrompt = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setError('')
    } catch {
      setError('复制失败，请手动选中提示词复制。')
    }
  }

  const handleAiJsonImport = async () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(aiJsonText)
    } catch {
      setError('JSON 格式不正确。')
      return
    }

    const payloads = Array.isArray(parsed) ? parsed : [parsed]
    if (!payloads.length) {
      setError('JSON 数组为空。')
      return
    }

    setAiImporting(true)
    setError('')
    try {
      const imported: LearningTagLibrary[] = []
      for (const payload of payloads) {
        const result = await api<{ library: LearningTagLibrary }>('/api/learning-tags/libraries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        imported.push(normalizeLibrary(result.library))
      }
      await loadLibraries()
      if (imported.at(-1)) selectLibrary(imported.at(-1)!)
      setAddDialogOpen(false)
      setAiJsonText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAiImporting(false)
    }
  }

  const deleteLibrary = async (library: LearningTagLibrary) => {
    if (!window.confirm(`确定删除「${library.name}」吗？`)) return
    try {
      await api<{ ok: boolean }>(`/api/learning-tags/libraries/${encodeURIComponent(library.id)}`, { method: 'DELETE' })
      const nextLibraries = libraries.filter((item) => item.id !== library.id)
      setLibraries(nextLibraries)
      const next = nextLibraries[0] ?? null
      if (selectedId === library.id && next) selectLibrary(next)
      if (!next) {
        setSelectedId('')
        setEditor(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const exportLibrary = (library: LearningTagLibrary) => {
    const blob = new Blob([`${JSON.stringify(exportPayload(library), null, 2)}\n`], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${slugCode(library.code)}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <PageTitle title="学习标签库" desc="维护题目入库、薄弱点分析和方法题型识别使用的标签模板。" path="/learning-tags" />

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-950 dark:bg-red-950/40 dark:text-red-300">{error}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(340px,0.85fr)_minmax(520px,1.15fr)]">
        <div className="space-y-5">
          <section className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-muted-foreground" />
                <h2 className="font-semibold">已安装标签库</h2>
              </div>
              <Button size="sm" variant="outline" icon={Plus} onClick={openAddDialog}>新增</Button>
            </div>
            <div className="mt-3 grid max-h-[480px] gap-2 overflow-y-auto pr-1">
              {loading ? <Empty text="正在加载标签库..." /> : null}
              {!loading && !libraries.length ? <Empty text="还没有标签库，先新增一个。" /> : null}
              {libraries.map((library) => {
                const selected = library.id === selectedId
                const itemStats = stats(library)
                const meta = typeMeta(library.libraryType)
                return (
                  <article key={library.id} className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl border p-3 transition ${selected ? 'border-primary bg-accent' : 'bg-card hover:bg-accent/40'}`}>
                    <button className="min-w-0 text-left" onClick={() => selectLibrary(library)} type="button">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="break-words text-sm font-semibold">{library.name}</span>
                        <Badge>{meta.label}</Badge>
                        {library.isDefault ? <Badge variant="success">默认</Badge> : null}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span>{library.subject}</span>
                        <span>{stageLabel(library.stage)}</span>
                        <span>{itemStats.sections} {meta.sectionLabel}</span>
                        <span>{itemStats.points} {meta.pointLabel}</span>
                      </div>
                    </button>
                    <Button size="sm" icon={Download} onClick={() => exportLibrary(library)}>导出</Button>
                    <button
                      aria-label={`删除${library.name}`}
                      className="flex size-9 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-600 transition hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300"
                      disabled={library.isDefault || libraries.length <= 1}
                      onClick={() => void deleteLibrary(library)}
                      title={library.isDefault ? '默认标签库不可删除' : '删除标签库'}
                      type="button"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </article>
                )
              })}
            </div>
          </section>

          <section className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
            <div className="flex items-center gap-2">
              <BookOpenCheck className="size-4 text-muted-foreground" />
              <h2 className="font-semibold">当前模板</h2>
            </div>
            <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
              <div className="font-semibold text-foreground">{activeLibrary?.name ?? '未选择'}</div>
              <div>科目：{activeLibrary?.subject ?? '-'}</div>
              <div>{activeMeta.sectionLabel}：{activeStats.sections}</div>
              <div>{activeMeta.pointLabel}：{activeStats.points}</div>
              <div className={validationError || saveState === 'error' ? 'text-red-600' : 'text-emerald-600'}>{statusLabel}</div>
            </div>
          </section>
        </div>

        <section className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">{activeLibrary?.name ?? '标签库编辑器'}</h2>
              <p className="mt-1 text-sm text-muted-foreground">可切换 JSON 与直观视图编辑；内容有效时会自动实时保存。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm ${mode === 'visual' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'}`} onClick={() => setMode('visual')} type="button"><ListTree className="size-4" />直观视图</button>
              <button className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm ${mode === 'json' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'}`} onClick={() => { if (editor) setJsonText(stringifyLibrary(editor)); setMode('json') }} type="button"><Code2 className="size-4" />JSON</button>
              <Button icon={Save} disabled={!activeLibrary || Boolean(validationError) || saveState === 'saving'} onClick={() => activeLibrary && void saveLibrary(activeLibrary, false)}>保存</Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant={validationError ? 'danger' : saveState === 'saving' ? 'warning' : 'success'}>{statusLabel}</Badge>
            {activeLibrary ? <Badge>{activeLibrary.subject}</Badge> : null}
            {activeLibrary ? <Badge>{activeStats.sections} {activeMeta.sectionLabel} / {activeStats.points} {activeMeta.pointLabel}</Badge> : null}
          </div>

          {mode === 'json' ? (
            <textarea
              className={textareaClass('mt-4 min-h-[620px] font-mono text-xs leading-5')}
              value={jsonText}
              onChange={(event) => {
                setJsonText(event.target.value)
                setDirty(true)
                setSaveState('idle')
              }}
            />
          ) : editor ? (
            <div className="mt-4 space-y-5">
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-zinc-500">标签库类型</span>
                  <select className={inputClass()} value={editor.libraryType} onChange={(event) => {
                    const libraryType = event.target.value as LearningLibraryType
                    const baseLibrary = libraryType === 'method_tag' ? knowledgeLibraries[0] : undefined
                    markEditor({
                      ...editor,
                      libraryType,
                      isDefault: libraryType === 'knowledge_point' ? editor.isDefault : false,
                      subject: baseLibrary?.subject ?? editor.subject,
                      stage: baseLibrary?.stage ?? editor.stage,
                      baseKnowledgeLibraryId: baseLibrary?.id,
                      baseKnowledgeLibraryCode: baseLibrary?.code,
                      baseKnowledgeLibraryName: baseLibrary?.name,
                    })
                  }}>
                    <option value="knowledge_point">知识点标签库</option>
                    <option value="method_tag">方法题型标签库</option>
                  </select>
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-zinc-500">模板名称</span>
                  <input className={inputClass()} value={editor.name} onChange={(event) => markEditor({ ...editor, name: event.target.value })} />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-zinc-500">语言</span>
                  <input className={inputClass()} value={editor.locale} onChange={(event) => markEditor({ ...editor, locale: event.target.value })} />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-zinc-500">科目</span>
                  <select className={inputClass()} value={SUBJECT_OPTIONS.includes(editor.subject) ? editor.subject : '__custom__'} onChange={(event) => markEditor({ ...editor, subject: event.target.value === '__custom__' ? '' : event.target.value })}>
                    {SUBJECT_OPTIONS.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                    <option value="__custom__">其他</option>
                  </select>
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-zinc-500">阶段</span>
                  <select className={inputClass()} value={STAGE_OPTIONS.some((option) => option.value === editor.stage) ? editor.stage : '__custom__'} onChange={(event) => markEditor({ ...editor, stage: event.target.value === '__custom__' ? '' : event.target.value })}>
                    {STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    <option value="__custom__">其他</option>
                  </select>
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-zinc-500">默认标签库</span>
                  <div className="grid grid-cols-2 rounded-lg border bg-zinc-50 p-0.5 dark:bg-zinc-950">
                    <button className={`h-9 rounded-md text-sm ${!editor.isDefault ? 'bg-white shadow-sm dark:bg-zinc-800' : 'text-zinc-500'}`} disabled={editor.libraryType === 'method_tag'} onClick={() => markEditor({ ...editor, isDefault: false })} type="button">普通</button>
                    <button className={`h-9 rounded-md text-sm ${editor.isDefault ? 'bg-zinc-950 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-950' : 'text-zinc-500'}`} disabled={editor.libraryType === 'method_tag'} onClick={() => markEditor({ ...editor, isDefault: true })} type="button">默认</button>
                  </div>
                </label>
                {editor.libraryType === 'method_tag' ? (
                  <label className="grid gap-1.5 md:col-span-2 2xl:col-span-3">
                    <span className="text-xs font-medium text-zinc-500">对照知识点库</span>
                    <select className={inputClass()} value={editor.baseKnowledgeLibraryId ?? ''} onChange={(event) => {
                      const baseLibrary = knowledgeLibraries.find((library) => library.id === event.target.value)
                      markEditor({
                        ...editor,
                        baseKnowledgeLibraryId: baseLibrary?.id,
                        baseKnowledgeLibraryCode: baseLibrary?.code,
                        baseKnowledgeLibraryName: baseLibrary?.name,
                        subject: baseLibrary?.subject ?? editor.subject,
                        stage: baseLibrary?.stage ?? editor.stage,
                        isDefault: false,
                      })
                    }}>
                      <option value="">请选择</option>
                      {knowledgeLibraries.map((library) => <option key={library.id} value={library.id}>{library.name} · {library.subject} · {stageLabel(library.stage)}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">{activeMeta.sectionLabel}与{activeMeta.pointLabel}</h3>
                <Button size="sm" variant="outline" icon={Plus} onClick={() => markEditor({
                  ...editor,
                  chapters: [...editor.chapters, {
                    id: makeId('chapter'),
                    code: `${editor.libraryType === 'method_tag' ? 'MG' : 'CH'}_${editor.chapters.length + 1}`,
                    name: editor.libraryType === 'method_tag' ? '新分组' : '新章节',
                    sortOrder: editor.chapters.length + 1,
                    knowledgePoints: [{
                      id: makeId('point'),
                      code: editor.libraryType === 'method_tag' ? 'MT_NEW' : 'KP_NEW',
                      name: editor.libraryType === 'method_tag' ? '新方法题型标签' : '新知识点',
                      tagType: editor.libraryType === 'method_tag' ? 'method' : 'knowledge',
                      sortOrder: 1,
                    }],
                  }],
                })}>添加{activeMeta.sectionLabel}</Button>
              </div>

              <div className="space-y-3">
                {editor.chapters.map((chapter, chapterIndex) => {
                  const expanded = expandedIds.has(chapter.id)
                  const isDragging = draggedChapterId === chapter.id
                  const isDragTarget = dragOverChapterId === chapter.id && draggedChapterId !== chapter.id
                  return (
                    <article
                      key={chapter.id}
                      draggable
                      onDragStart={(event) => {
                        const target = event.target as HTMLElement
                        const fromHandle = Boolean(target.closest('[data-chapter-drag-handle]'))
                        const blockedControl = Boolean(target.closest('input, textarea, select, button, a'))
                        if (!fromHandle && blockedControl) {
                          event.preventDefault()
                          return
                        }
                        setDraggedChapterId(chapter.id)
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', chapter.id)
                      }}
                      onDragEnd={() => {
                        setDraggedChapterId(null)
                        setDragOverChapterId(null)
                      }}
                      onDragOver={(event) => {
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                        setDragOverChapterId(chapter.id)
                      }}
                      onDragLeave={() => setDragOverChapterId((current) => current === chapter.id ? null : current)}
                      onDrop={(event) => {
                        event.preventDefault()
                        const sourceChapterId = draggedChapterId ?? event.dataTransfer.getData('text/plain')
                        reorderChapter(sourceChapterId, chapter.id)
                        setDraggedChapterId(null)
                        setDragOverChapterId(null)
                      }}
                      className={`overflow-hidden rounded-xl border bg-zinc-50 p-3 transition-all duration-150 dark:bg-zinc-950/50 ${
                        isDragTarget ? 'border-zinc-900 shadow-lg ring-1 ring-zinc-900 dark:border-zinc-100 dark:ring-zinc-100' : ''
                      } ${isDragging ? 'scale-[0.985] opacity-50' : 'scale-100 opacity-100'}`}
                    >
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                        <div className="grid min-w-0 grid-cols-[36px_52px_minmax(0,1fr)] items-center gap-3">
                          <button
                            aria-label="拖动章节排序"
                            className="flex size-9 cursor-grab items-center justify-center rounded-lg border bg-white text-zinc-500 active:cursor-grabbing dark:bg-zinc-900"
                            data-chapter-drag-handle
                            title="拖动排序"
                            type="button"
                          >
                            <GripVertical className="size-4" />
                          </button>
                          <span className="flex h-10 w-10 items-center justify-center rounded-lg border bg-white text-xs font-semibold text-zinc-500 dark:bg-zinc-900">{String(chapterIndex + 1).padStart(2, '0')}</span>
                          <div className="min-w-0">
                            <div className="break-words font-semibold">{chapter.name || `未命名${activeMeta.sectionLabel}`}</div>
                            <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-zinc-500">
                              <span>{activeMeta.sectionLabel} {chapterIndex + 1}</span>
                              <span>{chapter.knowledgePoints.length} 个{activeMeta.pointLabel}</span>
                            </div>
                          </div>
                        </div>
                        <Button size="sm" icon={ChevronDown} onClick={() => setExpandedIds((current) => {
                          const next = new Set(current)
                          if (next.has(chapter.id)) next.delete(chapter.id)
                          else next.add(chapter.id)
                          return next
                        })}>{expanded ? '收起' : '展开'}</Button>
                      </div>

                      {expanded ? (
                        <div className="mt-3 space-y-3 border-t pt-3">
                          <div className="grid gap-2 md:grid-cols-[140px_minmax(0,1fr)_90px_36px] md:items-end">
                            <label className="grid gap-1.5">
                              <span className="text-xs text-zinc-500">{activeMeta.sectionLabel} code</span>
                              <input className={inputClass('h-9')} value={chapter.code} onChange={(event) => updateChapter(chapterIndex, (item) => ({ ...item, code: event.target.value }))} />
                            </label>
                            <label className="grid gap-1.5">
                              <span className="text-xs text-zinc-500">{activeMeta.sectionLabel}名称</span>
                              <input className={inputClass('h-9')} value={chapter.name} onChange={(event) => updateChapter(chapterIndex, (item) => ({ ...item, name: event.target.value }))} />
                            </label>
                            <label className="grid gap-1.5">
                              <span className="text-xs text-zinc-500">排序</span>
                              <input className={inputClass('h-9')} type="number" value={chapter.sortOrder} onChange={(event) => updateChapter(chapterIndex, (item) => ({ ...item, sortOrder: Number(event.target.value) || chapterIndex + 1 }))} />
                            </label>
                            <button className="flex size-9 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white dark:border-red-950 dark:bg-red-950/30 dark:text-red-300" onClick={() => markEditor({ ...editor, chapters: editor.chapters.filter((_, index) => index !== chapterIndex) })} type="button"><Trash2 className="size-4" /></button>
                          </div>

                          <div className="space-y-2">
                            {chapter.knowledgePoints.map((point, pointIndex) => (
                              <div key={point.id} className={`grid gap-2 rounded-lg border bg-white p-2 dark:bg-zinc-900 ${editor.libraryType === 'method_tag' ? 'md:grid-cols-[130px_minmax(0,1fr)_120px_minmax(0,1fr)_36px]' : 'md:grid-cols-[140px_minmax(0,1fr)_minmax(0,1fr)_36px]'}`}>
                                <input className={inputClass('h-9 font-mono text-xs')} value={point.code} onChange={(event) => updateChapter(chapterIndex, (item) => ({ ...item, knowledgePoints: item.knowledgePoints.map((kp, index) => index === pointIndex ? { ...kp, code: event.target.value } : kp) }))} />
                                <input className={inputClass('h-9')} value={point.name} onChange={(event) => updateChapter(chapterIndex, (item) => ({ ...item, knowledgePoints: item.knowledgePoints.map((kp, index) => index === pointIndex ? { ...kp, name: event.target.value } : kp) }))} />
                                {editor.libraryType === 'method_tag' ? (
                                  <select className={inputClass('h-9')} value={point.tagType ?? 'method'} onChange={(event) => updateChapter(chapterIndex, (item) => ({ ...item, knowledgePoints: item.knowledgePoints.map((kp, index) => index === pointIndex ? { ...kp, tagType: event.target.value } : kp) }))}>
                                    <option value="method">方法</option>
                                    <option value="problem_type">题型</option>
                                    <option value="strategy">策略</option>
                                    <option value="other">其他</option>
                                  </select>
                                ) : null}
                                <input className={inputClass('h-9')} placeholder={editor.libraryType === 'method_tag' ? '适用知识点，用顿号分隔' : '说明（可选）'} value={editor.libraryType === 'method_tag' ? (point.appliesTo ?? []).join('、') : point.description ?? ''} onChange={(event) => updateChapter(chapterIndex, (item) => ({ ...item, knowledgePoints: item.knowledgePoints.map((kp, index) => index === pointIndex ? editor.libraryType === 'method_tag' ? { ...kp, appliesTo: event.target.value.split(/[、,，;；/]+/).map((value) => value.trim()).filter(Boolean) } : { ...kp, description: event.target.value || undefined } : kp) }))} />
                                <button className="flex size-9 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white dark:border-red-950 dark:bg-red-950/30 dark:text-red-300" onClick={() => updateChapter(chapterIndex, (item) => ({ ...item, knowledgePoints: item.knowledgePoints.filter((_, index) => index !== pointIndex) }))} type="button"><Trash2 className="size-4" /></button>
                              </div>
                            ))}
                            <Button size="sm" variant="outline" icon={Plus} onClick={() => updateChapter(chapterIndex, (item) => ({
                              ...item,
                              knowledgePoints: [...item.knowledgePoints, {
                                id: makeId('point'),
                                code: `${editor.libraryType === 'method_tag' ? 'MT' : 'KP'}_${item.knowledgePoints.length + 1}`,
                                name: editor.libraryType === 'method_tag' ? '新方法题型标签' : '新知识点',
                                tagType: editor.libraryType === 'method_tag' ? 'method' : 'knowledge',
                                sortOrder: item.knowledgePoints.length + 1,
                              }],
                            }))}>添加{activeMeta.pointLabel}</Button>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </div>
          ) : (
            <Empty text="请选择或新建标签库。" />
          )}
        </section>
      </div>

      {addDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 p-4 backdrop-blur-sm">
          <div className={`flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl dark:bg-zinc-900 ${addDialogMode === 'ai' ? 'max-w-3xl' : 'max-w-2xl'}`}>
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <div>
                <h2 className="text-base font-semibold">{addDialogMode === 'choice' ? '新增标签库' : 'AI 辅助生成标签库'}</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {addDialogMode === 'choice'
                    ? '先选择标签库类型，再决定从空白模板开始或使用 AI 辅助生成。'
                    : `第 ${aiGuideStep} 步 / 2：${aiGuideStep === 1 ? '先让模型和你确认目录结构' : '再让模型输出可导入的 JSON 数组'}`}
                </p>
              </div>
              <button className="flex size-9 items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => setAddDialogOpen(false)} type="button" aria-label="关闭">
                <X className="size-4" />
              </button>
            </div>

            {addDialogMode === 'choice' ? (
              <div className="space-y-4 overflow-y-auto p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  {(['knowledge_point', 'method_tag'] as LearningLibraryType[]).map((option) => {
                    const selected = addLibraryType === option
                    const meta = typeMeta(option)
                    return (
                      <button
                        key={option}
                        className={`rounded-xl border p-4 text-left transition ${selected ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950' : 'bg-white hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800'}`}
                        onClick={() => setAddLibraryType(option)}
                        type="button"
                      >
                        <div className="font-semibold">{meta.label}</div>
                        <p className={`mt-1 text-sm leading-6 ${selected ? 'opacity-80' : 'text-zinc-500'}`}>
                          {option === 'knowledge_point' ? '记录题目对应哪些知识点。' : '记录题目卡在哪类方法、题型或策略。'}
                        </p>
                      </button>
                    )
                  })}
                </div>

                {addLibraryType === 'method_tag' ? (
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-zinc-500">对照知识点标签库</span>
                    <select className={inputClass()} value={addBaseKnowledgeLibraryId} onChange={(event) => setAddBaseKnowledgeLibraryId(event.target.value)}>
                      {knowledgeLibraries.map((library) => (
                        <option key={library.id} value={library.id}>{library.name} · {library.subject} · {stageLabel(library.stage)}</option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    className="flex min-h-36 flex-col items-start rounded-xl border bg-white p-5 text-left transition hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                    disabled={addLibraryType === 'method_tag' && !selectedBaseKnowledgeLibrary}
                    onClick={handleDirectAdd}
                    type="button"
                  >
                    <span className="flex size-10 items-center justify-center rounded-xl bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"><Plus className="size-4" /></span>
                    <span className="mt-4 font-semibold">直接添加</span>
                    <span className="mt-1 text-sm leading-6 text-zinc-500">创建一个新{addTypeMeta.label}，并直接在直观视图里修改。</span>
                  </button>
                  <button
                    className="flex min-h-36 flex-col items-start rounded-xl border bg-white p-5 text-left transition hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                    disabled={addLibraryType === 'method_tag' && !selectedBaseKnowledgeLibrary}
                    onClick={() => {
                      if (addLibraryType === 'method_tag' && !selectedBaseKnowledgeLibrary) {
                        setError('请先选择对照知识点标签库。')
                        return
                      }
                      setAddDialogMode('ai')
                      setAiGuideStep(1)
                    }}
                    type="button"
                  >
                    <span className="flex size-10 items-center justify-center rounded-xl bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"><Sparkles className="size-4" /></span>
                    <span className="mt-4 font-semibold">AI 辅助</span>
                    <span className="mt-1 text-sm leading-6 text-zinc-500">先复制提示词到大模型对话，确认终版后再导入 JSON。</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                  {aiGuideStep === 1 ? (
                    <div className="grid gap-4">
                      <div className="rounded-xl border bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-950">
                        当前生成：<span className="font-semibold text-zinc-900 dark:text-zinc-100">{addTypeMeta.label}</span>
                        {addLibraryType === 'method_tag' && selectedBaseKnowledgeLibrary ? <span className="ml-2">对照：{selectedBaseKnowledgeLibrary.name}</span> : null}
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="grid gap-1.5">
                          <span className="text-xs font-medium text-zinc-500">学科</span>
                          <select className={inputClass()} value={aiSubject} onChange={(event) => setAiSubject(event.target.value)}>
                            {SUBJECT_OPTIONS.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                          </select>
                        </label>
                        <label className="grid gap-1.5">
                          <span className="text-xs font-medium text-zinc-500">学段</span>
                          <select className={inputClass()} value={aiStage} onChange={(event) => setAiStage(event.target.value)}>
                            {STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        </label>
                      </div>
                      <label className="grid gap-1.5">
                        <span className="text-xs font-medium text-zinc-500">补充范围</span>
                        <input className={inputClass()} value={aiScopeNote} onChange={(event) => setAiScopeNote(event.target.value)} placeholder="例如：人教版 A 版必修、上海中考、AP Calculus AB" />
                      </label>
                      <div className="rounded-xl border bg-zinc-50 p-3 dark:bg-zinc-950">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="font-semibold">开始提问提示词</div>
                          <Button size="sm" variant="outline" icon={Copy} onClick={() => void copyPrompt(aiStartPrompt)}>复制</Button>
                        </div>
                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-5 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{aiStartPrompt}</pre>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      <div className="rounded-xl border bg-zinc-50 p-3 dark:bg-zinc-950">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="font-semibold">生成 JSON 数组提示词</div>
                          <Button size="sm" variant="outline" icon={Copy} onClick={() => void copyPrompt(aiJsonPrompt)}>复制</Button>
                        </div>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-5 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{aiJsonPrompt}</pre>
                      </div>
                      <label className="grid gap-1.5">
                        <span className="text-xs font-medium text-zinc-500">粘贴模型输出的 JSON 数组</span>
                        <textarea
                          className={textareaClass('min-h-52 font-mono text-xs leading-5')}
                          value={aiJsonText}
                          onChange={(event) => setAiJsonText(event.target.value)}
                          placeholder='[{"code":"...","name":"...","chapters":[...]}]'
                        />
                      </label>
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2 border-t px-5 py-4">
                  <Button variant="outline" onClick={() => aiGuideStep === 1 ? setAddDialogMode('choice') : setAiGuideStep(1)}>返回</Button>
                  {aiGuideStep === 1 ? (
                    <Button onClick={() => setAiGuideStep(2)}>下一步</Button>
                  ) : (
                    <Button onClick={() => void handleAiJsonImport()} disabled={aiImporting || !aiJsonText.trim()}>{aiImporting ? '导入中' : '导入'}</Button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

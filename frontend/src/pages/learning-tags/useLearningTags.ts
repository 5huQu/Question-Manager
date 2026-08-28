import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { learningTagsApi } from '@/api/learningTags'
import type { LearningLibraryType, LearningTagChapter, LearningTagLibrary } from '@/types'
import {
  type AddDialogMode,
  type AiGuideStep,
  type EditorMode,
  type SaveState,
  formatKnowledgeDirectory,
  newLibrary,
  normalizeLibrary,
  parseImportedLibrary,
  slugCode,
  stageLabel,
  stats,
  stringifyLibrary,
  typeMeta,
  validate,
  exportPayload,
} from './utils'

export function useLearningTags() {
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
      return { library: parseImportedLibrary(JSON.parse(jsonText)), error: '' }
    } catch (error) {
      return { library: null, error: error instanceof Error ? error.message : '当前内容不是有效 JSON' }
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
      const data = await learningTagsApi.listLibraries()
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
      const result = await learningTagsApi.createLibrary(JSON.parse(stringifyLibrary(library)) as Record<string, unknown>)
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

    if (!Array.isArray(parsed)) {
      setError('AI JSON 导入只接受标签库 JSON 数组。')
      return
    }
    const payloads = parsed
    if (!payloads.length) {
      setError('JSON 数组为空。')
      return
    }

    setAiImporting(true)
    setError('')
    try {
      const normalizedPayloads = payloads.map((payload) => JSON.parse(stringifyLibrary(parseImportedLibrary(payload))) as Record<string, unknown>)
      const result = await learningTagsApi.importLibraries(normalizedPayloads)
      const imported = result.libraries.map(normalizeLibrary)
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
      await learningTagsApi.deleteLibrary(library.id)
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

  return {
    libraries,
    selectedId,
    editor,
    setEditor,
    mode,
    setMode,
    jsonText,
    setJsonText,
    expandedIds,
    setExpandedIds,
    loading,
    dirty,
    setDirty,
    saveState,
    setSaveState,
    error,
    setError,
    addDialogOpen,
    setAddDialogOpen,
    addDialogMode,
    setAddDialogMode,
    addLibraryType,
    setAddLibraryType,
    addBaseKnowledgeLibraryId,
    setAddBaseKnowledgeLibraryId,
    aiGuideStep,
    setAiGuideStep,
    aiSubject,
    setAiSubject,
    aiStage,
    setAiStage,
    aiScopeNote,
    setAiScopeNote,
    aiJsonText,
    setAiJsonText,
    aiImporting,
    draggedChapterId,
    setDraggedChapterId,
    dragOverChapterId,
    setDragOverChapterId,
    knowledgeLibraries,
    selectedBaseKnowledgeLibrary,
    addTypeMeta,
    aiStartPrompt,
    aiJsonPrompt,
    activeLibrary,
    activeStats,
    activeMeta,
    validationError,
    statusLabel,
    selectLibrary,
    saveLibrary,
    markEditor,
    updateChapter,
    reorderChapter,
    openAddDialog,
    handleDirectAdd,
    copyPrompt,
    handleAiJsonImport,
    deleteLibrary,
    exportLibrary,
  }
}

export type LearningTagsController = ReturnType<typeof useLearningTags>

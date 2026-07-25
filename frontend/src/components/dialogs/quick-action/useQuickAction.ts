import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { learningTagsApi } from '@/api/learningTags'
import {
  questionBankApi,
  type QuickActionMetadata,
  type RandomPaperDifficultyMode,
  type RandomPaperMatchMode,
  type RandomPaperSummary,
} from '@/api/questionBank'
import { collectionsApi } from '@/api/collections'
import { BASKET_COLLECTION_ID } from '@/utils/questionBasket'
import { notifyBasketUpdated } from '../../QuestionBasket'
import { defaultTypeCountByName, type QuickActionMode } from './constants'

export function useQuickAction(initialMode: QuickActionMode, onClose: () => void) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<QuickActionMode>(initialMode)
  const [loading, setLoading] = useState(false)
  const [exportFormat, setExportFormat] = useState<'Markdown' | 'PDF'>('Markdown')
  const [exportVariant, setExportVariant] = useState<'student' | 'teacher'>('student')
  const [isExporting, setIsExporting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Hierarchical libraries list
  const [libraries, setLibraries] = useState<any[]>([])
  const [metadata, setMetadata] = useState<QuickActionMetadata | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(false)

  // Search filter for trees
  const [kpSearch, setKpSearch] = useState('')
  const [smSearch, setSmSearch] = useState('')

  // Collapsible state for tree nodes
  const [expandedKpChapters, setExpandedKpChapters] = useState<Record<string, boolean>>({})
  const [expandedSmGroups, setExpandedSmGroups] = useState<Record<string, boolean>>({})

  // User selections
  const [selectedKp, setSelectedKp] = useState<string>('')
  const [selectedSm, setSelectedSm] = useState<string>('')
  const [selectedKps, setSelectedKps] = useState<string[]>([])
  const [selectedSms, setSelectedSms] = useState<string[]>([])
  const [selectedStage, setSelectedStage] = useState<string>('')

  // Random paper counts
  const [matchMode, setMatchMode] = useState<RandomPaperMatchMode>('strict')
  const [difficultyMode, setDifficultyMode] = useState<RandomPaperDifficultyMode>('standard')
  const [difficultyRange, setDifficultyRange] = useState({ min: 3, max: 7 })
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({})

  // Results
  const [dailyResult, setDailyResult] = useState<{
    question: any
    markdown: string
    answerMarkdown: string
  } | null>(null)

  const [randomResult, setRandomResult] = useState<{
    questions: any[]
    warnings: string[]
    summary?: RandomPaperSummary
  } | null>(null)

  // Result display states
  const [showDailyAnswer, setShowDailyAnswer] = useState(false)
  const [showGlobalRandomAnswers, setShowGlobalRandomAnswers] = useState(false)
  const [localRandomAnswersVisible, setLocalRandomAnswersVisible] = useState<Record<string, boolean>>({})
  const [paperTitle, setPaperTitle] = useState('')
  const [isSavingPaper, setIsSavingPaper] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [basketSuccess, setBasketSuccess] = useState(false)

  // Load tag libraries
  useEffect(() => {
    async function loadTags() {
      setLoading(true)
      try {
        const res = await learningTagsApi.listLibraries()
        setLibraries(res.libraries || [])
      } catch (err) {
        console.error('Failed to load tag libraries:', err)
      } finally {
        setLoading(false)
      }
    }
    loadTags()
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadMetadata() {
      setMetadataLoading(true)
      try {
        const res = await questionBankApi.getQuickActionMetadata({
          stage: selectedStage || undefined,
          knowledgePoints: mode === 'random' ? selectedKps : selectedKp ? [selectedKp] : [],
          solutionMethods: mode === 'random' ? selectedSms : selectedSm ? [selectedSm] : [],
          matchMode,
          difficultyMode,
          difficultyRange: difficultyMode === 'custom' ? difficultyRange : undefined,
        })
        if (!cancelled) setMetadata(res)
      } catch (err) {
        console.error('Failed to load quick action metadata:', err)
        if (!cancelled) setMetadata(null)
      } finally {
        if (!cancelled) setMetadataLoading(false)
      }
    }
    loadMetadata()
    return () => {
      cancelled = true
    }
  }, [
    selectedStage,
    selectedKp,
    selectedSm,
    selectedKps.join('|'),
    selectedSms.join('|'),
    matchMode,
    difficultyMode,
    difficultyRange.min,
    difficultyRange.max,
    mode,
  ])

  useEffect(() => {
    if (!metadata) return
    setTypeCounts((current) => {
      const validTypes = new Set(metadata.questionTypes.map((item) => item.type))
      const next: Record<string, number> = {}
      let changed = false

      Object.entries(current).forEach(([type, count]) => {
        if (!validTypes.has(type)) {
          changed = true
          return
        }
        next[type] = count
      })

      metadata.questionTypes.forEach((item) => {
        if (next[item.type] !== undefined) return
        const fallback = defaultTypeCountByName[item.type] ?? Math.min(5, item.total)
        next[item.type] = Math.min(fallback, item.total)
        changed = true
      })

      return changed ? next : current
    })
  }, [metadata])

  // Memoize hierarchical sections
  const kpChapters = useMemo(() => {
    const kps = libraries.filter((lib: any) => lib.libraryType === 'knowledge_point')
    return kps.flatMap((lib: any) => lib.chapters || [])
  }, [libraries])

  const smGroups = useMemo(() => {
    const sms = libraries.filter((lib: any) => lib.libraryType === 'method_tag')
    return sms.flatMap((lib: any) => lib.chapters || [])
  }, [libraries])

  const stageOptions = metadata?.stages ?? []
  const totalRequested = useMemo(() => Object.values(typeCounts).reduce((sum, count) => sum + Math.max(0, Number(count || 0)), 0), [typeCounts])
  const typeCountWarnings = useMemo(
    () => (metadata?.questionTypes ?? []).filter((item) => (typeCounts[item.type] || 0) > item.available),
    [metadata, typeCounts]
  )

  // Submit action
  const handleGenerate = async () => {
    setSubmitting(true)
    setError(null)
    setBasketSuccess(false)
    setSaveSuccess(false)

    try {
      if (mode === 'daily') {
        const res = await questionBankApi.getDailyQuestion({
          stage: selectedStage || undefined,
          knowledgePoint: selectedKp || undefined,
          solutionMethod: selectedSm || undefined
        })
        setDailyResult(res)
        setShowDailyAnswer(false)
      } else {
        if (totalRequested <= 0) {
          setError('请至少设置 1 道题。')
          return
        }
        const res = await questionBankApi.generateRandomPaper({
          stage: selectedStage || undefined,
          knowledgePoints: selectedKps,
          solutionMethods: selectedSms,
          matchMode,
          difficultyMode,
          difficultyRange: difficultyMode === 'custom' ? difficultyRange : undefined,
          typeCounts,
        })
        setRandomResult(res)
        setLocalRandomAnswersVisible({})
        setShowGlobalRandomAnswers(false)
        
        // Auto default paper title
        const dateStr = new Date().toLocaleDateString()
        setPaperTitle(`随机智能组卷 (${dateStr})`)
      }
    } catch (err: any) {
      setError(err?.message || '生成失败，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  // Copy Markdown text to clipboard
  const handleCopyMarkdown = (text: string) => {
    navigator.clipboard.writeText(text)
    alert('Markdown 已复制到剪贴板。')
  }

  // Add random paper questions to active basket
  const handleAddToBasket = async () => {
    if (!randomResult || randomResult.questions.length === 0) return
    setBasketSuccess(false)
    try {
      const activeBasketId = BASKET_COLLECTION_ID
      await collectionsApi.updateCollection(activeBasketId, {
        addQuestionIds: randomResult.questions.map(q => q.id)
      })
      notifyBasketUpdated()
      setBasketSuccess(true)
      setTimeout(() => setBasketSuccess(false), 3000)
    } catch (err: any) {
      alert(`加入试题篮失败: ${err?.message || String(err)}`)
    }
  }

  // Save random paper as new collection/paper
  const handleSaveAsPaper = async () => {
    if (!randomResult || randomResult.questions.length === 0) return
    const title = paperTitle.trim()
    if (!title) {
      alert('请输入试卷标题')
      return
    }

    setIsSavingPaper(true)
    setSaveSuccess(false)
    try {
      const created = await collectionsApi.createCollection({
        title,
        kind: 'paper'
      })
      await collectionsApi.updateCollection(created.id, {
        addQuestionIds: randomResult.questions.map(q => q.id)
      })
      notifyBasketUpdated()
      setSaveSuccess(true)
    } catch (err: any) {
      alert(`保存试卷失败: ${err?.message || String(err)}`)
    } finally {
      setIsSavingPaper(false)
    }
  }

  // Export random paper
  const handleExportPaper = async () => {
    if (!randomResult || randomResult.questions.length === 0) return
    const title = paperTitle.trim() || `随机智能组卷 (${new Date().toLocaleDateString()})`
    
    setIsExporting(true)
    try {
      // 1. Create a paper collection
      const created = await collectionsApi.createCollection({
        title,
        kind: 'paper'
      })
      // 2. Add questions to this collection
      await collectionsApi.updateCollection(created.id, {
        addQuestionIds: randomResult.questions.map(q => q.id)
      })
      notifyBasketUpdated()

      // 3. Export to chosen format
      if (exportFormat === 'Markdown') {
        onClose()
        navigate(`/questions/collections/${encodeURIComponent(created.id)}/markdown-preview?variant=${exportVariant}`)
      } else {
        const payload = await collectionsApi.exportCollection(created.id, {
          format: 'pdf',
          variant: exportVariant,
          template: 'exam'
        })
        if (payload.format === 'pdf' && payload.url) {
          window.open(payload.url, '_blank', 'noopener,noreferrer')
        }
      }
    } catch (err: any) {
      alert(`导出失败: ${err?.message || String(err)}`)
    } finally {
      setIsExporting(false)
    }
  }

  const handleReset = () => {
    setDailyResult(null)
    setRandomResult(null)
    setError(null)
  }

  const hasResult = dailyResult !== null || randomResult !== null

  return {
    // Mode
    mode,
    setMode,
    // Loading states
    loading,
    submitting,
    isExporting,
    error,
    // Libraries & metadata
    libraries,
    metadata,
    metadataLoading,
    kpChapters,
    smGroups,
    stageOptions,
    // Search
    kpSearch,
    setKpSearch,
    smSearch,
    setSmSearch,
    // Expanded state
    expandedKpChapters,
    setExpandedKpChapters,
    expandedSmGroups,
    setExpandedSmGroups,
    // Selections
    selectedKp,
    setSelectedKp,
    selectedSm,
    setSelectedSm,
    selectedKps,
    setSelectedKps,
    selectedSms,
    setSelectedSms,
    selectedStage,
    setSelectedStage,
    // Random paper config
    matchMode,
    setMatchMode,
    difficultyMode,
    setDifficultyMode,
    difficultyRange,
    setDifficultyRange,
    typeCounts,
    setTypeCounts,
    totalRequested,
    typeCountWarnings,
    // Results
    dailyResult,
    randomResult,
    hasResult,
    // Result display
    showDailyAnswer,
    setShowDailyAnswer,
    showGlobalRandomAnswers,
    setShowGlobalRandomAnswers,
    localRandomAnswersVisible,
    setLocalRandomAnswersVisible,
    paperTitle,
    setPaperTitle,
    isSavingPaper,
    saveSuccess,
    basketSuccess,
    // Export config
    exportFormat,
    setExportFormat,
    exportVariant,
    setExportVariant,
    // Handlers
    handleGenerate,
    handleCopyMarkdown,
    handleAddToBasket,
    handleSaveAsPaper,
    handleExportPaper,
    handleReset,
    setError,
  }
}

export type QuickActionState = ReturnType<typeof useQuickAction>

import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X,
  Sparkles,
  Flame,
  BookOpen,
  Eye,
  EyeOff,
  Plus,
  Check,
  RotateCcw,
  ShoppingBag,
  Save,
  LoaderCircle,
  Copy,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  Search,
  FileCode2,
  FileText,
  FileDown
} from 'lucide-react'
import { Button, Badge } from '../ui'
import { learningTagsApi } from '@/api/learningTags'
import { questionBankApi } from '@/api/questionBank'
import { collectionsApi } from '@/api/collections'
import { notifyBasketUpdated, stripLeadingQuestionNo } from '../QuestionBasket'
import { QuestionMarkdownContent } from '../questions/QuestionContent'

type QuickActionMode = 'daily' | 'random'

interface QuickActionDialogProps {
  initialMode: QuickActionMode
  onClose: () => void
}

function CustomCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
      className={`flex size-3.5 shrink-0 items-center justify-center rounded border transition-all duration-150 cursor-pointer ${
        checked || indeterminate
          ? 'bg-zinc-900 border-zinc-900 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-900'
          : 'border-zinc-300 hover:border-zinc-400 bg-white dark:border-zinc-700 dark:hover:border-zinc-700 dark:bg-zinc-900'
      }`}
    >
      {checked && <Check className="size-2.5 stroke-[3px]" />}
      {!checked && indeterminate && <div className="h-[2px] w-1.5 bg-current rounded-xs" />}
    </button>
  )
}

export function QuickActionDialog({ initialMode, onClose }: QuickActionDialogProps) {
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

  // Random paper counts
  const [counts, setCounts] = useState({
    singleChoice: 8,
    multiChoice: 3,
    fillBlank: 3,
    bigQuestion: 5
  })

  // Results
  const [dailyResult, setDailyResult] = useState<{
    question: any
    markdown: string
    answerMarkdown: string
  } | null>(null)

  const [randomResult, setRandomResult] = useState<{
    questions: any[]
    warnings: string[]
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

  // Memoize hierarchical sections
  const kpChapters = useMemo(() => {
    const kps = libraries.filter((lib: any) => lib.libraryType === 'knowledge_point')
    return kps.flatMap((lib: any) => lib.chapters || [])
  }, [libraries])

  const smGroups = useMemo(() => {
    const sms = libraries.filter((lib: any) => lib.libraryType === 'method_tag')
    return sms.flatMap((lib: any) => lib.chapters || [])
  }, [libraries])

  // Submit action
  const handleGenerate = async () => {
    setSubmitting(true)
    setError(null)
    setBasketSuccess(false)
    setSaveSuccess(false)

    try {
      if (mode === 'daily') {
        const res = await questionBankApi.getDailyQuestion({
          knowledgePoint: selectedKp || undefined,
          solutionMethod: selectedSm || undefined
        })
        setDailyResult(res)
        setShowDailyAnswer(false)
      } else {
        const res = await questionBankApi.generateRandomPaper({
          knowledgePoints: selectedKps,
          solutionMethods: selectedSms,
          counts
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
      const activeBasketId = localStorage.getItem('question-manager.activeCollectionId') || 'basket'
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 dark:bg-black/65 p-4 backdrop-blur-sm animate-in fade-in duration-200 select-none">
      <div
        className={`flex h-[90vh] flex-col overflow-hidden rounded-2xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl transition-all duration-350 ${
          hasResult && mode === 'random' ? 'w-full max-w-6xl' : 'w-full max-w-4xl'
        }`}
      >
        {/* Header */}
        <div className="flex flex-none items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 bg-zinc-50/50 dark:bg-zinc-900/20">
          <div>
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              {mode === 'daily' ? (
                <>
                  <Flame className="size-4 text-orange-500 animate-pulse" />
                  每日一题
                </>
              ) : (
                <>
                  <Sparkles className="size-4 text-amber-500" />
                  随机出卷
                </>
              )}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {hasResult
                ? '生成成功，请查看以下预览并可进行答案显隐切换。'
                : '通过选择特定知识点和解题方法来智能生成习题或组卷。'}
            </p>
          </div>
          <button
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2 text-zinc-405 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-zinc-500">
                <LoaderCircle className="size-8 animate-spin text-zinc-700 dark:text-zinc-300" />
                <span className="text-xs">加载标签库中...</span>
              </div>
            </div>
          ) : submitting ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-zinc-500">
                <LoaderCircle className="size-8 animate-spin text-zinc-700 dark:text-zinc-300" />
                <span className="text-xs">智能匹配生成中，请稍候...</span>
              </div>
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
              <div className="rounded-full bg-red-50 dark:bg-red-950/20 p-3 text-red-500 dark:text-red-400 mb-4">
                <AlertTriangle className="size-8" />
              </div>
              <h4 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">生成失败</h4>
              <p className="mt-1 text-xs text-zinc-500 max-w-md">{error}</p>
              <button
                onClick={handleReset}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <RotateCcw className="size-3.5" />
                重新配置
              </button>
            </div>
          ) : !hasResult ? (
            /* Parameter Configuration Screen */
            <div className="p-6 space-y-6 text-left">
              {/* Tab Selector */}
              <div className="flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900 w-fit">
                <button
                  onClick={() => {
                    setMode('daily')
                    setError(null)
                  }}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
                    mode === 'daily'
                      ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-zinc-50'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                  }`}
                >
                  <Flame className={`size-3.5 ${mode === 'daily' ? 'text-orange-500' : ''}`} />
                  每日一题
                </button>
                <button
                  onClick={() => {
                    setMode('random')
                    setError(null)
                  }}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
                    mode === 'random'
                      ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-zinc-50'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                  }`}
                >
                  <Sparkles className={`size-3.5 ${mode === 'random' ? 'text-amber-500' : ''}`} />
                  随机出卷
                </button>
              </div>

              {/* Hierarchical Tag Selection Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 1. Knowledge Points Hierarchical Tree Selector */}
                <div className="flex flex-col space-y-2">
                  <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                    选择知识点 {mode === 'random' && '(可多选)'}
                  </label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 size-3.5 text-zinc-400 dark:text-zinc-500" />
                    <input
                      type="text"
                      placeholder="搜索知识点..."
                      value={kpSearch}
                      onChange={e => setKpSearch(e.target.value)}
                      className="w-full rounded-lg border border-zinc-200 bg-transparent pl-8 pr-8 py-2 text-xs outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"
                    />
                    {kpSearch && (
                      <button
                        type="button"
                        onClick={() => setKpSearch('')}
                        className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-600"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>

                  {/* FIXED HEIGHT: h-80 */}
                  <div className="h-80 overflow-y-auto p-3 rounded-lg border border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/20 space-y-2 select-none">
                    {kpChapters.map((chapter: any) => {
                      const filteredKps = chapter.knowledgePoints.filter((kp: any) =>
                        kp.name.toLowerCase().includes(kpSearch.toLowerCase())
                      )
                      const chapterMatches = chapter.name.toLowerCase().includes(kpSearch.toLowerCase())
                      const displayKps = chapterMatches ? chapter.knowledgePoints : filteredKps

                      if (kpSearch && displayKps.length === 0 && !chapterMatches) {
                        return null
                      }

                      const isExpanded = expandedKpChapters[chapter.code] ?? (kpSearch ? true : false)
                      const kpNames = chapter.knowledgePoints.map((kp: any) => kp.name)
                      const selectedChildren = chapter.knowledgePoints.filter((kp: any) =>
                        mode === 'daily' ? selectedKp === kp.name : selectedKps.includes(kp.name)
                      )
                      
                      const isAllSelected = selectedChildren.length === chapter.knowledgePoints.length && chapter.knowledgePoints.length > 0
                      const isIndeterminate = selectedChildren.length > 0 && selectedChildren.length < chapter.knowledgePoints.length

                      const handleChapterToggle = () => {
                        if (mode === 'daily') return
                        if (isAllSelected) {
                          setSelectedKps(curr => curr.filter(name => !kpNames.includes(name)))
                        } else {
                          setSelectedKps(curr => {
                            const next = [...curr]
                            kpNames.forEach((name: string) => {
                              if (!next.includes(name)) next.push(name)
                            })
                            return next
                          })
                        }
                      }

                      return (
                        <div key={chapter.code} className="space-y-1">
                          <div className="flex items-center gap-2 py-0.5">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedKpChapters(prev => ({
                                  ...prev,
                                  [chapter.code]: !(prev[chapter.code] ?? (kpSearch ? true : false))
                                }))
                              }
                              className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 cursor-pointer"
                            >
                              <ChevronRight className={`size-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                            {mode === 'random' && (
                              <CustomCheckbox
                                checked={isAllSelected}
                                indeterminate={isIndeterminate}
                                onChange={handleChapterToggle}
                              />
                            )}
                            <span
                              className="text-xs font-semibold text-zinc-800 dark:text-zinc-300 truncate cursor-pointer hover:text-zinc-950 dark:hover:text-zinc-100"
                              onClick={() =>
                                setExpandedKpChapters(prev => ({
                                  ...prev,
                                  [chapter.code]: !(prev[chapter.code] ?? (kpSearch ? true : false))
                                }))
                              }
                              title={chapter.name}
                            >
                              {chapter.name}
                            </span>
                          </div>

                          {isExpanded && displayKps.length > 0 && (
                            <div className="pl-6 space-y-1 border-l border-zinc-200 dark:border-zinc-800 ml-2">
                              {displayKps.map((kp: any) => {
                                const isSelected = mode === 'daily' ? selectedKp === kp.name : selectedKps.includes(kp.name)
                                const handleKpToggleLocal = () => {
                                  if (mode === 'daily') {
                                    setSelectedKp(prev => prev === kp.name ? '' : kp.name)
                                  } else {
                                    setSelectedKps(curr =>
                                      curr.includes(kp.name) ? curr.filter(n => n !== kp.name) : [...curr, kp.name]
                                    )
                                  }
                                }

                                return (
                                  <div key={kp.code} className="flex items-center gap-2 py-0.5">
                                    {mode === 'random' ? (
                                      <CustomCheckbox checked={isSelected} onChange={handleKpToggleLocal} />
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={handleKpToggleLocal}
                                        className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border transition-all duration-150 cursor-pointer ${
                                          isSelected
                                            ? 'bg-zinc-900 border-zinc-900 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-900 shadow-sm'
                                            : 'border-zinc-300 hover:border-zinc-400 bg-white dark:border-zinc-700 dark:bg-zinc-900'
                                        }`}
                                      >
                                        {isSelected && <div className="size-1.5 rounded-full bg-white dark:bg-zinc-905" />}
                                      </button>
                                    )}
                                    <span
                                      className={`text-xs leading-snug cursor-pointer ${
                                        isSelected
                                          ? 'font-bold text-zinc-950 dark:text-zinc-50'
                                          : 'text-zinc-650 dark:text-zinc-450 hover:text-zinc-900'
                                      }`}
                                      onClick={handleKpToggleLocal}
                                    >
                                      {kp.name}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {kpChapters.length === 0 && (
                      <div className="text-xs text-zinc-400 text-center py-4">暂无知识点数据</div>
                    )}
                  </div>
                </div>

                {/* 2. Solution Methods Hierarchical Tree Selector */}
                <div className="flex flex-col space-y-2">
                  <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                    选择解题方法 {mode === 'random' && '(可多选)'}
                  </label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 size-3.5 text-zinc-400 dark:text-zinc-500" />
                    <input
                      type="text"
                      placeholder="搜索解题方法..."
                      value={smSearch}
                      onChange={e => setSmSearch(e.target.value)}
                      className="w-full rounded-lg border border-zinc-200 bg-transparent pl-8 pr-8 py-2 text-xs outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"
                    />
                    {smSearch && (
                      <button
                        type="button"
                        onClick={() => setSmSearch('')}
                        className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-600"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>

                  {/* FIXED HEIGHT: h-80 */}
                  <div className="h-80 overflow-y-auto p-3 rounded-lg border border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/20 space-y-2 select-none">
                    {smGroups.map((group: any) => {
                      const filteredTags = group.knowledgePoints.filter((tag: any) =>
                        tag.name.toLowerCase().includes(smSearch.toLowerCase())
                      )
                      const groupMatches = group.name.toLowerCase().includes(smSearch.toLowerCase())
                      const displayTags = groupMatches ? group.knowledgePoints : filteredTags

                      if (smSearch && displayTags.length === 0 && !groupMatches) {
                        return null
                      }

                      const isExpanded = expandedSmGroups[group.code] ?? (smSearch ? true : false)
                      const tagNames = group.knowledgePoints.map((tag: any) => tag.name)
                      const selectedChildren = group.knowledgePoints.filter((tag: any) =>
                        mode === 'daily' ? selectedSm === tag.name : selectedSms.includes(tag.name)
                      )
                      
                      const isAllSelected = selectedChildren.length === group.knowledgePoints.length && group.knowledgePoints.length > 0
                      const isIndeterminate = selectedChildren.length > 0 && selectedChildren.length < group.knowledgePoints.length

                      const handleGroupToggle = () => {
                        if (mode === 'daily') return
                        if (isAllSelected) {
                          setSelectedSms(curr => curr.filter(name => !tagNames.includes(name)))
                        } else {
                          setSelectedSms(curr => {
                            const next = [...curr]
                            tagNames.forEach((name: string) => {
                              if (!next.includes(name)) next.push(name)
                            })
                            return next
                          })
                        }
                      }

                      return (
                        <div key={group.code} className="space-y-1">
                          <div className="flex items-center gap-2 py-0.5">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedSmGroups(prev => ({
                                  ...prev,
                                  [group.code]: !(prev[group.code] ?? (smSearch ? true : false))
                                }))
                              }
                              className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 cursor-pointer"
                            >
                              <ChevronRight className={`size-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                            {mode === 'random' && (
                              <CustomCheckbox
                                checked={isAllSelected}
                                indeterminate={isIndeterminate}
                                onChange={handleGroupToggle}
                              />
                            )}
                            <span
                              className="text-xs font-semibold text-zinc-800 dark:text-zinc-300 truncate cursor-pointer hover:text-zinc-950 dark:hover:text-zinc-100"
                              onClick={() =>
                                setExpandedSmGroups(prev => ({
                                  ...prev,
                                  [group.code]: !(prev[group.code] ?? (smSearch ? true : false))
                                }))
                              }
                              title={group.name}
                            >
                              {group.name}
                            </span>
                          </div>

                          {isExpanded && displayTags.length > 0 && (
                            <div className="pl-6 space-y-1 border-l border-zinc-200 dark:border-zinc-800 ml-2">
                              {displayTags.map((tag: any) => {
                                const isSelected = mode === 'daily' ? selectedSm === tag.name : selectedSms.includes(tag.name)
                                const handleTagToggleLocal = () => {
                                  if (mode === 'daily') {
                                    setSelectedSm(prev => prev === tag.name ? '' : tag.name)
                                  } else {
                                    setSelectedSms(curr =>
                                      curr.includes(tag.name) ? curr.filter(n => n !== tag.name) : [...curr, tag.name]
                                    )
                                  }
                                }

                                return (
                                  <div key={tag.code} className="flex items-center gap-2 py-0.5">
                                    {mode === 'random' ? (
                                      <CustomCheckbox checked={isSelected} onChange={handleTagToggleLocal} />
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={handleTagToggleLocal}
                                        className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border transition-all duration-150 cursor-pointer ${
                                          isSelected
                                            ? 'bg-zinc-900 border-zinc-900 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-900 shadow-sm'
                                            : 'border-zinc-300 hover:border-zinc-400 bg-white dark:border-zinc-700 dark:bg-zinc-900'
                                        }`}
                                      >
                                        {isSelected && <div className="size-1.5 rounded-full bg-white dark:bg-zinc-905" />}
                                      </button>
                                    )}
                                    <span
                                      className={`text-xs leading-snug cursor-pointer ${
                                        isSelected
                                          ? 'font-bold text-zinc-950 dark:text-zinc-50'
                                          : 'text-zinc-655 dark:text-zinc-450 hover:text-zinc-900'
                                      }`}
                                      onClick={handleTagToggleLocal}
                                    >
                                      {tag.name}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {smGroups.length === 0 && (
                      <div className="text-xs text-zinc-400 text-center py-4">暂无解题方法数据</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Show selected tags review summary */}
              <div className="flex flex-col gap-1.5 text-xs text-zinc-500 bg-zinc-50/30 p-3 rounded-lg border border-zinc-200 dark:bg-zinc-900/10 dark:border-zinc-800">
                <div className="flex gap-1.5 flex-wrap items-center">
                  <span className="font-semibold text-zinc-400">已选知识点:</span>
                  {mode === 'daily' ? (
                    selectedKp ? <Badge variant="outline">{selectedKp}</Badge> : <span className="text-zinc-400 italic">未选择则不设范围</span>
                  ) : (
                    selectedKps.length > 0 ? selectedKps.map(kp => <Badge key={kp} variant="outline">{kp}</Badge>) : <span className="text-zinc-400 italic">未选择则不设范围</span>
                  )}
                </div>
                <div className="flex gap-1.5 flex-wrap items-center mt-1">
                  <span className="font-semibold text-zinc-400">已选解题方法:</span>
                  {mode === 'daily' ? (
                    selectedSm ? <Badge variant="outline">{selectedSm}</Badge> : <span className="text-zinc-400 italic">未选择则不设范围</span>
                  ) : (
                    selectedSms.length > 0 ? selectedSms.map(sm => <Badge key={sm} variant="outline">{sm}</Badge>) : <span className="text-zinc-400 italic">未选择则不设范围</span>
                  )}
                </div>
              </div>

              {/* Counts config for Random Paper mode */}
              {mode === 'random' && (
                <div className="border-t border-zinc-100 dark:border-zinc-800 pt-5 space-y-3">
                  <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                    组卷题量配置
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-semibold text-zinc-500">单选题数量</span>
                      <input
                        type="number"
                        min="0"
                        max="50"
                        value={counts.singleChoice}
                        onChange={e =>
                          setCounts(prev => ({
                            ...prev,
                            singleChoice: Math.max(0, parseInt(e.target.value) || 0)
                          }))
                        }
                        className="w-full text-xs rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 text-center font-mono font-bold"
                      />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-semibold text-zinc-505">多选题数量</span>
                      <input
                        type="number"
                        min="0"
                        max="50"
                        value={counts.multiChoice}
                        onChange={e =>
                          setCounts(prev => ({
                            ...prev,
                            multiChoice: Math.max(0, parseInt(e.target.value) || 0)
                          }))
                        }
                        className="w-full text-xs rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 text-center font-mono font-bold"
                      />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-semibold text-zinc-505">填空题数量</span>
                      <input
                        type="number"
                        min="0"
                        max="50"
                        value={counts.fillBlank}
                        onChange={e =>
                          setCounts(prev => ({
                            ...prev,
                            fillBlank: Math.max(0, parseInt(e.target.value) || 0)
                          }))
                        }
                        className="w-full text-xs rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 outline-none focus:border-zinc-555 dark:border-zinc-800 dark:bg-zinc-900 text-center font-mono font-bold"
                      />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-semibold text-zinc-505">解答题数量</span>
                      <input
                        type="number"
                        min="0"
                        max="50"
                        value={counts.bigQuestion}
                        onChange={e =>
                          setCounts(prev => ({
                            ...prev,
                            bigQuestion: Math.max(0, parseInt(e.target.value) || 0)
                          }))
                        }
                        className="w-full text-xs rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 outline-none focus:border-zinc-555 dark:border-zinc-800 dark:bg-zinc-900 text-center font-mono font-bold"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Results Screen */
            <div className="flex h-full min-h-0 flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-zinc-200 dark:divide-zinc-800">
              {/* Left Side: Result content preview */}
              <div className="flex-1 overflow-y-auto p-6 bg-zinc-50/20 dark:bg-zinc-950/20">
                {dailyResult ? (
                  /* Daily Question Result */
                  <div className="space-y-6 text-left">
                    <div className="flex items-center justify-between">
                      <Badge variant="success">匹配题型: {dailyResult.question.questionType}</Badge>
                      <span className="text-[11px] text-zinc-400 font-mono">ID: #{dailyResult.question.id}</span>
                    </div>

                    <article className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
                      <QuestionMarkdownContent
                        className="text-[15px] leading-7"
                        content={dailyResult.markdown}
                        figures={dailyResult.question.figures}
                      />
                    </article>

                    {showDailyAnswer && (
                      <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-6 space-y-4 dark:border-zinc-800 dark:bg-zinc-900/20 animate-in slide-in-from-top-2 duration-300">
                        <div>
                          <h4 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">参考答案</h4>
                          <div className="mt-2 text-sm">
                            <QuestionMarkdownContent content={dailyResult.question.answerText || '暂无答案'} />
                          </div>
                        </div>
                        <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4">
                          <h4 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">详细解析</h4>
                          <div className="mt-2 text-sm">
                            <QuestionMarkdownContent
                              content={dailyResult.question.analysisMarkdown || '暂无解析'}
                              figures={dailyResult.question.figures.filter((f: any) => f.usage === 'analysis')}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Random Paper Result */
                  <div className="space-y-6 text-left pb-12">
                    {/* Warnings (Shortage banners) */}
                    {randomResult!.warnings.length > 0 && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50/55 p-4 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/10 dark:text-amber-400 space-y-1">
                        <h4 className="font-semibold flex items-center gap-1.5">
                          <AlertTriangle className="size-3.5" />
                          匹配提示
                        </h4>
                        <ul className="list-disc pl-4 space-y-0.5 mt-1 font-medium">
                          {randomResult!.warnings.map((warn, i) => (
                            <li key={i}>{warn}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="space-y-4">
                      {randomResult!.questions.map((question, index) => {
                        const showAnswer =
                          showGlobalRandomAnswers || localRandomAnswersVisible[question.id]
                        return (
                          <div
                            key={question.id}
                            className="border border-zinc-200 bg-white rounded-xl p-5 dark:border-zinc-800 dark:bg-zinc-900/30 flex items-start gap-4 hover:border-zinc-300 hover:shadow-sm transition-all duration-300"
                          >
                            <div className="flex flex-col items-center gap-1.5 shrink-0">
                              <span className="flex size-6 items-center justify-center rounded bg-zinc-900 text-xs font-mono font-bold text-white dark:bg-zinc-100 dark:text-zinc-950">
                                {index + 1}
                              </span>
                            </div>

                            <div className="flex-1 min-w-0 space-y-3">
                              {/* Metadata row */}
                              <div className="flex items-center justify-between text-[11px] text-zinc-400 dark:text-zinc-500 font-mono">
                                <span>
                                  {question.questionType} · {question.chapter || '未分类'} ·{' '}
                                  {question.difficultyLabel || '难度待定'}
                                </span>
                                <span>ID: #{question.id}</span>
                              </div>

                              {/* Question Stem */}
                              <div className="text-sm text-zinc-900 dark:text-zinc-100 leading-relaxed font-sans">
                                <QuestionMarkdownContent
                                  content={stripLeadingQuestionNo(question.stemMarkdown || '', question.questionNo || '')}
                                  figures={question.figures}
                                />
                              </div>

                              {/* Action Bar (Per-question answer toggle) */}
                              <div className="flex items-center justify-between pt-2.5 border-t border-zinc-100 dark:border-zinc-800">
                                <button
                                  onClick={() =>
                                    setLocalRandomAnswersVisible(prev => ({
                                      ...prev,
                                      [question.id]: !prev[question.id]
                                    }))
                                  }
                                  className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 font-semibold cursor-pointer"
                                >
                                  {showAnswer ? (
                                    <>
                                      <EyeOff className="size-3" />
                                      收起答案解析
                                    </>
                                  ) : (
                                    <>
                                      <Eye className="size-3" />
                                      展开答案解析
                                    </>
                                  )}
                                </button>
                              </div>

                              {/* Answer and Analysis Preview */}
                              {showAnswer && (
                                <div className="mt-3 rounded-lg bg-zinc-50/50 p-4 border border-zinc-100 dark:bg-zinc-900/10 dark:border-zinc-800 space-y-3 text-xs animate-in slide-in-from-top-1 duration-200">
                                  <div>
                                    <span className="font-bold text-zinc-400 dark:text-zinc-505 block mb-0.5">参考答案</span>
                                    <QuestionMarkdownContent content={question.answerText || '暂无答案'} />
                                  </div>
                                  <div className="border-t border-zinc-100 dark:border-zinc-800 pt-2">
                                    <span className="font-bold text-zinc-400 dark:text-zinc-505 block mb-0.5">详细解析</span>
                                    <QuestionMarkdownContent
                                      content={question.analysisMarkdown || '暂无解析'}
                                      figures={question.figures.filter((f: any) => f.usage === 'analysis')}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Side: Document Controls & Export Panel */}
              <div className="w-full lg:w-[320px] shrink-0 p-5 flex flex-col justify-between overflow-y-auto bg-white dark:bg-zinc-955 text-left select-none">
                <div className="space-y-5">
                  <div className="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-zinc-800">
                    <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-wider">
                      操作与输出控制
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
                      控制面板
                    </span>
                  </div>

                  {/* Answer Visibility Toggle */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 block">
                      参考答案显隐
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        if (dailyResult) setShowDailyAnswer(!showDailyAnswer)
                        else setShowGlobalRandomAnswers(!showGlobalRandomAnswers)
                      }}
                      className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold shadow-sm transition-all cursor-pointer ${
                        (dailyResult ? showDailyAnswer : showGlobalRandomAnswers)
                          ? 'bg-zinc-950 border-zinc-950 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-950 font-bold'
                          : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/80'
                      }`}
                    >
                      {(dailyResult ? showDailyAnswer : showGlobalRandomAnswers) ? (
                        <>
                          <EyeOff className="size-4" />
                          隐藏答案及解析
                        </>
                      ) : (
                        <>
                          <Eye className="size-4" />
                          显示答案及解析
                        </>
                      )}
                    </button>
                  </div>

                  {/* Actions for Daily Question */}
                  {dailyResult && (
                    <div className="space-y-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 block">
                        Markdown 导出
                      </label>
                      <button
                        onClick={() =>
                          handleCopyMarkdown(
                            `${dailyResult.markdown}\n\n${
                              showDailyAnswer ? dailyResult.answerMarkdown : ''
                            }`
                          )
                        }
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer transition-all"
                      >
                        <Copy className="size-3.5" />
                        复制 Markdown 源码
                      </button>
                    </div>
                  )}

                  {/* Actions for Random Paper */}
                  {randomResult && (
                    <div className="space-y-4 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                      {/* Save to basket */}
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 block mb-1.5">
                          快速备课
                        </label>
                        <button
                          onClick={handleAddToBasket}
                          className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
                            basketSuccess
                              ? 'bg-emerald-600 border-emerald-600 text-white dark:bg-emerald-500 font-bold'
                              : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
                          }`}
                        >
                          <ShoppingBag className="size-3.5" />
                          {basketSuccess ? '已成功添加至试题篮！' : '添加所有至当前试题篮'}
                        </button>
                      </div>

                      {/* Export Paper Section */}
                      <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 block">
                          导出并下载试卷
                        </label>
                        
                        {/* Format Selection */}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setExportFormat('Markdown')}
                            className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                              exportFormat === 'Markdown'
                                ? 'bg-zinc-950 border-zinc-950 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-950 font-bold'
                                : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/80'
                            }`}
                          >
                            <FileCode2 className="size-3.5" />
                            Markdown
                          </button>
                          <button
                            type="button"
                            onClick={() => setExportFormat('PDF')}
                            className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                              exportFormat === 'PDF'
                                ? 'bg-zinc-950 border-zinc-950 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-950 font-bold'
                                : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/80'
                            }`}
                          >
                            <FileText className="size-3.5" />
                            PDF
                          </button>
                        </div>

                        {/* Variant Selection */}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setExportVariant('student')}
                            className={`flex-1 rounded-lg border py-1.5 text-[11px] font-semibold transition-all cursor-pointer ${
                              exportVariant === 'student'
                                ? 'bg-zinc-950 border-zinc-950 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-950 font-bold'
                                : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/80'
                            }`}
                          >
                            学生版 (无答案)
                          </button>
                          <button
                            type="button"
                            onClick={() => setExportVariant('teacher')}
                            className={`flex-1 rounded-lg border py-1.5 text-[11px] font-semibold transition-all cursor-pointer ${
                              exportVariant === 'teacher'
                                ? 'bg-zinc-950 border-zinc-950 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-950 font-bold'
                                : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/80'
                            }`}
                          >
                            教师版 (含答案)
                          </button>
                        </div>

                        <button
                          disabled={isExporting}
                          onClick={handleExportPaper}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 px-3 py-2.5 text-xs font-semibold shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                        >
                          {isExporting ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <FileDown className="size-3.5" />
                          )}
                          {isExporting ? '正在生成并导出...' : '导出并打开试卷'}
                        </button>
                      </div>

                      {/* Save as new collection */}
                      <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 block">
                          新建独立试卷 (放入试卷库)
                        </label>
                        <input
                          type="text"
                          value={paperTitle}
                          onChange={e => setPaperTitle(e.target.value)}
                          placeholder="请输入试卷名称..."
                          className="w-full text-xs rounded-lg border border-zinc-200 bg-transparent px-3 py-2 outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"
                        />
                        <button
                          disabled={isSavingPaper || saveSuccess}
                          onClick={handleSaveAsPaper}
                          className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
                            saveSuccess
                              ? 'bg-emerald-600 border border-emerald-600 text-white font-bold'
                              : 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
                          }`}
                        >
                          {isSavingPaper ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <Save className="size-3.5" />
                          )}
                          {saveSuccess ? '已成功保存并同步！' : '保存并同步为新试卷'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Regenerate or change settings */}
                  <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex gap-2">
                    <button
                      onClick={handleGenerate}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
                    >
                      <RotateCcw className="size-3.5" />
                      重新生成
                    </button>
                    <button
                      onClick={handleReset}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 text-xs font-semibold py-2 cursor-pointer shadow-sm"
                    >
                      <ChevronLeft className="size-3.5" />
                      返回修改
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions for Configuration Screen */}
        {!hasResult && (
          <div className="flex flex-none items-center justify-end gap-3 border-t border-zinc-200 dark:border-zinc-800 px-6 py-4 bg-zinc-50/50 dark:bg-zinc-900/20">
            <button
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={handleGenerate}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 cursor-pointer"
            >
              {mode === 'daily' ? (
                <>
                  生成每日一题
                  <ChevronRight className="size-3.5" />
                </>
              ) : (
                <>
                  生成随机试卷
                  <ChevronRight className="size-3.5" />
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

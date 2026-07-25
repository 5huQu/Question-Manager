import {
  X,
  Sparkles,
  Flame,
  RotateCcw,
  LoaderCircle,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react'
import { Badge } from '../../ui'
import { TagTreeSelector } from './TagTreeSelector'
import { DailyResultView, RandomPaperResultView, ResultControlPanel } from './ResultPanels'
import { useQuickAction } from './useQuickAction'
import { difficultyOptions, matchModeOptions, type QuickActionMode } from './constants'

interface QuickActionDialogProps {
  initialMode: QuickActionMode
  onClose: () => void
}

export function QuickActionDialog({ initialMode, onClose }: QuickActionDialogProps) {
  const state = useQuickAction(initialMode, onClose)
  const {
    mode,
    setMode,
    loading,
    submitting,
    error,
    metadata,
    metadataLoading,
    kpChapters,
    smGroups,
    stageOptions,
    kpSearch,
    setKpSearch,
    smSearch,
    setSmSearch,
    expandedKpChapters,
    setExpandedKpChapters,
    expandedSmGroups,
    setExpandedSmGroups,
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
    dailyResult,
    randomResult,
    hasResult,
    handleGenerate,
    handleReset,
    setError,
  } = state

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

              {/* Stage selector */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                  学段范围
                </label>
                <div className="flex flex-wrap gap-2">
                  {['', ...stageOptions].map((stage) => {
                    const active = selectedStage === stage
                    return (
                      <button
                        key={stage || 'all'}
                        type="button"
                        onClick={() => setSelectedStage(stage)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                          active
                            ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950'
                            : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {stage || '全部'}
                      </button>
                    )
                  })}
                  {stageOptions.length === 0 && !metadataLoading && (
                    <span className="text-xs text-zinc-400">暂无已入库学段</span>
                  )}
                </div>
              </div>

              {/* Hierarchical Tag Selection Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 1. Knowledge Points Hierarchical Tree Selector */}
                <TagTreeSelector
                  title="选择知识点"
                  items={kpChapters}
                  searchValue={kpSearch}
                  onSearchChange={setKpSearch}
                  searchPlaceholder="搜索知识点..."
                  mode={mode}
                  selectedSingle={selectedKp}
                  onSelectSingle={setSelectedKp}
                  selectedMulti={selectedKps}
                  onSelectMulti={setSelectedKps}
                  expandedChapters={expandedKpChapters}
                  onExpandedChaptersChange={setExpandedKpChapters}
                  emptyText="暂无知识点数据"
                />

                {/* 2. Solution Methods Hierarchical Tree Selector */}
                <TagTreeSelector
                  title="选择解题方法"
                  items={smGroups}
                  searchValue={smSearch}
                  onSearchChange={setSmSearch}
                  searchPlaceholder="搜索解题方法..."
                  mode={mode}
                  selectedSingle={selectedSm}
                  onSelectSingle={setSelectedSm}
                  selectedMulti={selectedSms}
                  onSelectMulti={setSelectedSms}
                  expandedChapters={expandedSmGroups}
                  onExpandedChaptersChange={setExpandedSmGroups}
                  emptyText="暂无解题方法数据"
                />
              </div>

              {/* Show selected tags review summary */}
              <div className="flex flex-col gap-1.5 text-xs text-zinc-500 bg-zinc-50/30 p-3 rounded-lg border border-zinc-200 dark:bg-zinc-900/10 dark:border-zinc-800">
                <div className="flex gap-1.5 flex-wrap items-center">
                  <span className="font-semibold text-zinc-400">已选学段:</span>
                  <Badge variant="outline">{selectedStage || '全部'}</Badge>
                </div>
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
                <div className="border-t border-zinc-100 dark:border-zinc-800 pt-5 space-y-5">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                        匹配方式
                      </label>
                      <div className="flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
                        {matchModeOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setMatchMode(option.value)}
                            className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-all cursor-pointer ${
                              matchMode === option.value
                                ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-zinc-50'
                                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                        难度
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-3 gap-2">
                        {difficultyOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setDifficultyMode(option.value)}
                            className={`rounded-lg border px-2.5 py-2 text-left transition-all cursor-pointer ${
                              difficultyMode === option.value
                                ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950'
                                : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
                            }`}
                          >
                            <span className="block text-xs font-bold">{option.label}</span>
                            <span className={`block text-[10px] ${difficultyMode === option.value ? 'text-white/70 dark:text-zinc-600' : 'text-zinc-400'}`}>
                              {option.hint}
                            </span>
                          </button>
                        ))}
                      </div>
                      {difficultyMode === 'custom' && (
                        <div className="grid grid-cols-2 gap-3 pt-1">
                          <label className="space-y-1">
                            <span className="text-[10px] font-semibold text-zinc-500">最低难度</span>
                            <input
                              type="number"
                              min="1"
                              max="10"
                              value={difficultyRange.min}
                              onChange={(event) => {
                                const min = Math.min(10, Math.max(1, parseInt(event.target.value, 10) || 1))
                                setDifficultyRange((prev) => ({ min, max: Math.max(min, prev.max) }))
                              }}
                              className="w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 text-center text-xs font-bold outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[10px] font-semibold text-zinc-500">最高难度</span>
                            <input
                              type="number"
                              min="1"
                              max="10"
                              value={difficultyRange.max}
                              onChange={(event) => {
                                const max = Math.min(10, Math.max(1, parseInt(event.target.value, 10) || 10))
                                setDifficultyRange((prev) => ({ min: Math.min(prev.min, max), max }))
                              }}
                              className="w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 text-center text-xs font-bold outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                        题型数量
                      </label>
                      <span className="text-[11px] text-zinc-400">
                        总题数 {totalRequested} · 预计平均难度 {metadata?.averageDifficulty ? `${metadata.averageDifficulty}/10` : '待定'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {(metadata?.questionTypes ?? []).map((item) => {
                        const count = typeCounts[item.type] || 0
                        const overLimit = count > item.available
                        return (
                          <label
                            key={item.type}
                            className={`rounded-lg border p-3 transition-colors ${
                              overLimit
                                ? 'border-amber-300 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/10'
                                : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/30'
                            }`}
                          >
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-bold text-zinc-800 dark:text-zinc-200">{item.type}</span>
                              <span className={`text-[10px] font-semibold ${overLimit ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-400'}`}>
                                可用 {item.available}
                              </span>
                            </span>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={count}
                              onChange={(event) => {
                                const nextCount = Math.min(100, Math.max(0, parseInt(event.target.value, 10) || 0))
                                setTypeCounts((prev) => ({ ...prev, [item.type]: nextCount }))
                              }}
                              className="mt-2 w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 text-center text-xs font-mono font-bold outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"
                            />
                          </label>
                        )
                      })}
                    </div>

                    {metadataLoading && (
                      <p className="text-xs text-zinc-400">正在刷新可用题量...</p>
                    )}
                    {!metadataLoading && (metadata?.questionTypes.length ?? 0) === 0 && (
                      <p className="rounded-lg border border-dashed border-zinc-200 p-3 text-center text-xs text-zinc-400 dark:border-zinc-800">
                        当前题库暂无可用于出卷的题型。
                      </p>
                    )}
                    {typeCountWarnings.length > 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/10 dark:text-amber-400">
                        {typeCountWarnings.map((item) => (
                          <p key={item.type}>{item.type} 当前条件下可用 {item.available} 道，生成时可能不足。</p>
                        ))}
                      </div>
                    )}
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
                  <DailyResultView state={state} />
                ) : (
                  <RandomPaperResultView state={state} />
                )}
              </div>

              {/* Right Side: Document Controls & Export Panel */}
              <ResultControlPanel state={state} />
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
              disabled={mode === 'random' && totalRequested <= 0}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 cursor-pointer"
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

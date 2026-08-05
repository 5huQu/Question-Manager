import { useState } from 'react'
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { CustomCheckbox } from './QuestionBankDraftCard'

export function BankFilterSidebar({
  stage,
  setStage,
  questionType,
  setQuestionType,
  difficulty,
  setDifficulty,
  knowledgePoint,
  setKnowledgePoint,
  solutionMethod,
  setSolutionMethod,
  setPage,
  stageOptions,
  questionTypeOptions,
  difficultyOptions,
  kpChapters,
  smGroups,
  activeFiltersCount,
  onClearAll,
}: {
  stage: string
  setStage: (value: string) => void
  questionType: string
  setQuestionType: (value: string) => void
  difficulty: string
  setDifficulty: (value: string) => void
  knowledgePoint: string[]
  setKnowledgePoint: (value: string[] | ((curr: string[]) => string[])) => void
  solutionMethod: string[]
  setSolutionMethod: (value: string[] | ((curr: string[]) => string[])) => void
  setPage: (value: number | ((value: number) => number)) => void
  stageOptions: string[]
  questionTypeOptions: string[]
  difficultyOptions: string[]
  kpChapters: any[]
  smGroups: any[]
  activeFiltersCount: number
  onClearAll: () => void
}) {
  const [stageExpanded, setStageExpanded] = useState(false)
  const [questionTypeExpanded, setQuestionTypeExpanded] = useState(true)
  const [difficultyExpanded, setDifficultyExpanded] = useState(false)
  const [kpExpanded, setKpExpanded] = useState(false)
  const [smExpanded, setSmExpanded] = useState(false)
  const [kpSearch, setKpSearch] = useState('')
  const [smSearch, setSmSearch] = useState('')
  const [expandedChapters, setExpandedChapters] = useState<Record<string, boolean>>({})

  function updateFilter(setter: (value: string) => void, value: string) {
    setter(value)
    setPage(1)
  }

  function filterButtonClass(active: boolean) {
    return `flex w-full items-center justify-between rounded px-2.5 py-1.5 text-xs transition-colors ${
      active
        ? 'bg-zinc-100 font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
        : 'text-zinc-500 hover:bg-zinc-100/50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/40 dark:hover:text-zinc-200'
    }`
  }

  return (
    <aside className="question-edit-glass-aside flex h-full w-56 shrink-0 flex-col gap-4 overflow-y-auto rounded-2xl p-4 text-left border border-black/6 dark:border-white/8 backdrop-blur-md">
      {activeFiltersCount > 0 && (
        <div className="flex items-center justify-between rounded-md bg-zinc-100/50 px-2.5 py-1.5 text-xs border border-zinc-200/60 dark:bg-zinc-900/40 dark:border-zinc-800/60">
          <span className="text-zinc-500 dark:text-zinc-400 font-medium">已选 {activeFiltersCount} 个条件</span>
          <button
            onClick={onClearAll}
            className="font-bold text-zinc-900 hover:underline dark:text-zinc-100 cursor-pointer"
          >
            清空
          </button>
        </div>
      )}

      {/* 教学阶段 */}
      <div>
        <button
          type="button"
          onClick={() => setStageExpanded(!stageExpanded)}
          className="flex w-full items-center justify-between px-2 py-1 text-xs font-bold text-zinc-400 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
        >
          <span>教学阶段</span>
          <ChevronDown className={`size-3.5 transition-transform duration-250 ${stageExpanded ? 'rotate-180' : ''}`} />
        </button>
        <div className={`grid transition-all duration-250 ease-in-out ${stageExpanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}>
          <div className="overflow-hidden">
            <div className="space-y-0.5 pl-2 pb-1">
              {['全部', ...stageOptions].map((opt) => (
                <button
                  key={opt}
                  onClick={() => updateFilter(setStage, opt === '全部' ? '' : opt)}
                  className={filterButtonClass((opt === '全部' && !stage) || stage === opt)}
                >
                  <span>{opt}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-zinc-200 dark:bg-zinc-800" />

      {/* 试题题型 */}
      <div>
        <button
          type="button"
          onClick={() => setQuestionTypeExpanded(!questionTypeExpanded)}
          className="flex w-full items-center justify-between px-2 py-1 text-xs font-bold text-zinc-400 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
        >
          <span>试题题型</span>
          <ChevronDown className={`size-3.5 transition-transform duration-250 ${questionTypeExpanded ? 'rotate-180' : ''}`} />
        </button>
        <div className={`grid transition-all duration-250 ease-in-out ${questionTypeExpanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}>
          <div className="overflow-hidden">
            <div className="space-y-0.5 pl-2 pb-1">
              {['全部', ...questionTypeOptions].map((opt) => (
                <button
                  key={opt}
                  onClick={() => updateFilter(setQuestionType, opt === '全部' ? '' : opt)}
                  className={filterButtonClass((opt === '全部' && !questionType) || questionType === opt)}
                >
                  <span>{opt}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-zinc-200 dark:bg-zinc-800" />

      {/* 难度分级 */}
      <div>
        <button
          type="button"
          onClick={() => setDifficultyExpanded(!difficultyExpanded)}
          className="flex w-full items-center justify-between px-2 py-1 text-xs font-bold text-zinc-400 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
        >
          <span>难度分级</span>
          <ChevronDown className={`size-3.5 transition-transform duration-250 ${difficultyExpanded ? 'rotate-180' : ''}`} />
        </button>
        <div className={`grid transition-all duration-250 ease-in-out ${difficultyExpanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}>
          <div className="overflow-hidden">
            <div className="space-y-0.5 pl-2 pb-1">
              {['全部', ...difficultyOptions].map((opt) => (
                <button
                  key={opt}
                  onClick={() => updateFilter(setDifficulty, opt === '全部' ? '' : opt)}
                  className={filterButtonClass((opt === '全部' && !difficulty) || difficulty === opt)}
                >
                  <span>{opt}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-zinc-200 dark:bg-zinc-800" />

      {/* 知识点树形多选折叠组 */}
      <div>
        <button
          type="button"
          onClick={() => setKpExpanded(!kpExpanded)}
          className="flex w-full items-center justify-between px-2 py-1 text-xs font-bold text-zinc-400 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
        >
          <span>知识点</span>
          <ChevronDown className={`size-3.5 transition-transform duration-250 ${kpExpanded ? 'rotate-180' : ''}`} />
        </button>

        <div className={`grid transition-all duration-250 ease-in-out ${kpExpanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}>
          <div className="overflow-hidden">
            <div className="space-y-2 pb-1">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 size-3 text-zinc-400" />
                <input
                  type="text"
                  placeholder="搜索知识点..."
                  value={kpSearch}
                  onChange={(e) => setKpSearch(e.target.value)}
                  className="w-full rounded-md border border-zinc-200 bg-white pl-7 pr-6 py-1 text-xs outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 focus:ring-0"
                />
                {kpSearch && (
                  <button
                    type="button"
                    onClick={() => setKpSearch('')}
                    className="absolute right-2 top-2 text-zinc-400 hover:text-zinc-650 dark:hover:text-zinc-350"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>

              <div className="max-h-60 overflow-y-auto pr-1 space-y-2 select-none">
                {kpChapters.map((chapter: any) => {
                  const filteredKps = chapter.knowledgePoints.filter((kp: any) =>
                    kp.name.toLowerCase().includes(kpSearch.toLowerCase())
                  )
                  const chapterMatches = chapter.name.toLowerCase().includes(kpSearch.toLowerCase())
                  const displayKps = chapterMatches ? chapter.knowledgePoints : filteredKps

                  if (kpSearch && displayKps.length === 0 && !chapterMatches) {
                    return null
                  }

                  const isExpanded = expandedChapters[chapter.code] ?? (kpSearch ? true : false)
                  const kpNames = chapter.knowledgePoints.map((kp: any) => kp.name)
                  const selectedChildren = chapter.knowledgePoints.filter((kp: any) =>
                    knowledgePoint.includes(kp.name)
                  )
                  const isAllSelected = selectedChildren.length === chapter.knowledgePoints.length
                  const isIndeterminate = selectedChildren.length > 0 && selectedChildren.length < chapter.knowledgePoints.length

                  const handleChapterToggle = () => {
                    if (isAllSelected) {
                      setKnowledgePoint((curr: string[]) => curr.filter((name) => !kpNames.includes(name)))
                    } else {
                      setKnowledgePoint((curr: string[]) => {
                        const next = [...curr]
                        kpNames.forEach((name: string) => {
                          if (!next.includes(name)) next.push(name)
                        })
                        return next
                      })
                    }
                    setPage(1)
                  }

                  return (
                    <div key={chapter.code} className="space-y-1">
                      <div className="flex items-center gap-1.5 py-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedChapters((prev) => ({
                              ...prev,
                              [chapter.code]: !(prev[chapter.code] ?? (kpSearch ? true : false)),
                            }))
                          }
                          className="p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                        >
                          <ChevronRight className={`size-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        </button>
                        <CustomCheckbox
                          checked={isAllSelected}
                          indeterminate={isIndeterminate}
                          onChange={handleChapterToggle}
                        />
                        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 truncate cursor-pointer" onClick={() =>
                            setExpandedChapters((prev) => ({
                              ...prev,
                              [chapter.code]: !(prev[chapter.code] ?? (kpSearch ? true : false)),
                            }))
                          } title={chapter.name}>
                          {chapter.name}
                        </span>
                      </div>

                      {isExpanded && displayKps.length > 0 && (
                        <div className="pl-6 space-y-1 border-l border-zinc-100 dark:border-zinc-800 ml-2">
                          {displayKps.map((kp: any) => {
                            const isSelected = knowledgePoint.includes(kp.name)
                            const handleKpToggle = () => {
                              if (isSelected) {
                                setKnowledgePoint((curr: string[]) => curr.filter((name) => name !== kp.name))
                              } else {
                                setKnowledgePoint((curr: string[]) => [...curr, kp.name])
                              }
                              setPage(1)
                            }

                            return (
                              <div key={kp.code} className="flex items-center gap-1.5 py-0.5">
                                <CustomCheckbox checked={isSelected} onChange={handleKpToggle} />
                                <span className="text-[11px] text-zinc-600 dark:text-zinc-400 line-clamp-1 leading-snug cursor-pointer" onClick={handleKpToggle} title={kp.name}>
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
                  <div className="text-[10px] text-zinc-400 text-center py-2">暂无知识点库数据</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-zinc-200 dark:bg-zinc-800" />

      {/* 解题方法分组多选折叠组 */}
      <div>
        <button
          type="button"
          onClick={() => setSmExpanded(!smExpanded)}
          className="flex w-full items-center justify-between px-2 py-1 text-xs font-bold text-zinc-400 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
        >
          <span>解题方法</span>
          <ChevronDown className={`size-3.5 transition-transform duration-250 ${smExpanded ? 'rotate-180' : ''}`} />
        </button>

        <div className={`grid transition-all duration-250 ease-in-out ${smExpanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}>
          <div className="overflow-hidden">
            <div className="space-y-2 pb-1">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 size-3 text-zinc-400" />
                <input
                  type="text"
                  placeholder="搜索方法..."
                  value={smSearch}
                  onChange={(e) => setSmSearch(e.target.value)}
                  className="w-full rounded-md border border-zinc-200 bg-white pl-7 pr-6 py-1 text-xs outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 focus:ring-0"
                />
                {smSearch && (
                  <button
                    type="button"
                    onClick={() => setSmSearch('')}
                    className="absolute right-2 top-2 text-zinc-400 hover:text-zinc-650 dark:hover:text-zinc-350"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>

              <div className="max-h-60 overflow-y-auto pr-1 space-y-3 select-none">
                {smGroups.map((group: any) => {
                  const displayTags = group.knowledgePoints.filter((tag: any) =>
                    tag.name.toLowerCase().includes(smSearch.toLowerCase())
                  )

                  if (displayTags.length === 0) {
                    return null
                  }

                  return (
                    <div key={group.code} className="space-y-1.5">
                      <div className="px-2 text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                        {group.name}
                      </div>
                      <div className="space-y-1 pl-2">
                        {displayTags.map((tag: any) => {
                          const isSelected = solutionMethod.includes(tag.name)
                          const handleTagToggle = () => {
                            if (isSelected) {
                              setSolutionMethod((curr: string[]) => curr.filter((name) => name !== tag.name))
                            } else {
                              setSolutionMethod((curr: string[]) => [...curr, tag.name])
                            }
                            setPage(1)
                          }

                          return (
                            <div key={tag.code} className="flex items-center gap-1.5 py-0.5">
                              <CustomCheckbox checked={isSelected} onChange={handleTagToggle} />
                              <span className="text-[11px] text-zinc-600 dark:text-zinc-400 line-clamp-1 leading-snug cursor-pointer" onClick={handleTagToggle} title={tag.name}>
                                {tag.name}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                {smGroups.length === 0 && (
                  <div className="text-[10px] text-zinc-400 text-center py-2">暂无解题方法数据</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}

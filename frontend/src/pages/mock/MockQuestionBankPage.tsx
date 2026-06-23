import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  Grid,
  List,
  PlusSquare,
  ShoppingBag,
  Trash2,
  Tag,
  X,
  Plus,
  ArrowRight,
  BookOpen,
  Calendar,
  CheckCircle,
  HelpCircle,
  FileCheck
} from 'lucide-react'
import {
  INITIAL_MOCK_QUESTIONS,
  getMockBasket,
  saveMockBasket,
  MockQuestion
} from './mockData'
import { MockQuestionCard } from './MockQuestionCard'
import { MarkdownContent } from '@/components/MarkdownContent'

export default function MockQuestionBankPage() {
  const navigate = useNavigate()
  const [questions, setQuestions] = useState<MockQuestion[]>([])
  const [basket, setBasket] = useState<string[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card')
  const [searchQuery, setSearchQuery] = useState('')
  
  // Selected question ID for the right preview panel
  const [previewId, setPreviewId] = useState<string>('10294')

  // Filter state
  const [filters, setFilters] = useState({
    stage: '全部',
    questionType: '全部',
    difficultyLabel: '全部',
  })

  // Category filter lists for Left Sidebar
  const filterOptions = {
    // 注释：根据后台选择的教学阶段动态显示
    stage: ['全部', '高一上', '高二上', '高二下', '高三一轮'],
    questionType: ['全部', '单选题', '填空题', '解答题'],
    difficultyLabel: ['全部', '易', '中', '难'],
  }

  useEffect(() => {
    setQuestions(INITIAL_MOCK_QUESTIONS)
    setBasket(getMockBasket())

    const handleBasketChange = (event: Event) => {
      const ids = (event as CustomEvent<string[]>).detail
      setBasket(ids)
    }
    window.addEventListener('mock-basket-changed', handleBasketChange)
    return () => window.removeEventListener('mock-basket-changed', handleBasketChange)
  }, [])

  // Filtering logic
  const filteredQuestions = questions.filter((q) => {
    if (
      searchQuery &&
      !q.stemMarkdown.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !q.chapter.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !q.knowledgePoints.some((k) => k.toLowerCase().includes(searchQuery.toLowerCase()))
    ) {
      return false
    }

    if (filters.stage !== '全部' && q.stage !== filters.stage) return false
    if (filters.questionType !== '全部' && q.questionType !== filters.questionType) return false
    if (filters.difficultyLabel !== '全部' && q.difficultyLabel !== filters.difficultyLabel) return false

    return true
  })

  // Automatically update preview selection if current selection is filtered out
  useEffect(() => {
    if (filteredQuestions.length > 0) {
      const exists = filteredQuestions.some((q) => q.id === previewId)
      if (!exists) {
        setPreviewId(filteredQuestions[0].id)
      }
    }
  }, [filters, searchQuery, filteredQuestions, previewId])

  const handleToggleBasket = (id: string) => {
    if (basket.includes(id)) {
      const next = basket.filter((b) => b !== id)
      saveMockBasket(next)
    } else {
      const next = [...basket, id]
      saveMockBasket(next)
    }
  }

  const handleSelectAll = () => {
    if (selectedIds.length === filteredQuestions.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(filteredQuestions.map((q) => q.id))
    }
  }

  const handleSelectRow = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((x) => x !== id))
    } else {
      setSelectedIds([...selectedIds, id])
    }
  }

  const handleBatchAddToBasket = () => {
    const nextBasket = [...basket]
    selectedIds.forEach((id) => {
      if (!nextBasket.includes(id)) {
        nextBasket.push(id)
      }
    })
    saveMockBasket(nextBasket)
    setSelectedIds([])
  }

  const handleBatchRemove = () => {
    const nextQuestions = questions.filter((q) => !selectedIds.includes(q.id))
    setQuestions(nextQuestions)
    setSelectedIds([])
  }

  const activeQuestion = questions.find((q) => q.id === previewId)

  return (
    <div className="mock-page-root flex h-[calc(100vh-7rem)] overflow-hidden bg-background text-foreground relative border border-zinc-200 dark:border-zinc-800 rounded-lg">
      
      {/* Column 1: Left Filter Sidebar (220px wide) */}
      <aside className="w-52 shrink-0 border-r border-zinc-200 bg-zinc-50/30 p-4 flex flex-col gap-4 overflow-y-auto dark:border-zinc-800 dark:bg-zinc-950/20 text-left">
        <div>
          {/* 注释：根据后台选择的教学阶段动态显示 */}
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 mb-2.5 px-2">
            教学阶段
          </h3>
          <div className="space-y-0.5">
            {filterOptions.stage.map((opt) => (
              <button
                key={opt}
                onClick={() => setFilters({ ...filters, stage: opt })}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded transition-colors ${
                  filters.stage === opt
                    ? 'bg-zinc-100 font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-550 hover:bg-zinc-100/50 hover:text-zinc-900 dark:text-zinc-450 dark:hover:bg-zinc-900/40 dark:hover:text-zinc-200'
                }`}
              >
                <span>{opt}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="h-px bg-zinc-200 dark:bg-zinc-800" />

        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 mb-2.5 px-2">
            试题题型
          </h3>
          <div className="space-y-0.5">
            {filterOptions.questionType.map((opt) => (
              <button
                key={opt}
                onClick={() => setFilters({ ...filters, questionType: opt })}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded transition-colors ${
                  filters.questionType === opt
                    ? 'bg-zinc-100 font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-550 hover:bg-zinc-100/50 hover:text-zinc-900 dark:text-zinc-450 dark:hover:bg-zinc-900/40 dark:hover:text-zinc-200'
                }`}
              >
                <span>{opt}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="h-px bg-zinc-200 dark:bg-zinc-800" />

        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 mb-2.5 px-2">
            难度分级
          </h3>
          <div className="space-y-0.5">
            {filterOptions.difficultyLabel.map((opt) => (
              <button
                key={opt}
                onClick={() => setFilters({ ...filters, difficultyLabel: opt })}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded transition-colors ${
                  filters.difficultyLabel === opt
                    ? 'bg-zinc-100 font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-550 hover:bg-zinc-100/50 hover:text-zinc-900 dark:text-zinc-450 dark:hover:bg-zinc-900/40 dark:hover:text-zinc-200'
                }`}
              >
                <span>{opt}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Column 2: Middle Stream (Flexible width) */}
      <main className="flex-1 flex flex-col overflow-hidden border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/10 relative">
        
        {/* Compact Single-Row Toolbar */}
        <div className="h-11 shrink-0 border-b border-zinc-200 bg-white flex items-center px-4 gap-3 justify-between dark:bg-zinc-950 dark:border-zinc-850">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Search className="size-3.5 text-zinc-400 shrink-0" />
            <input
              type="text"
              placeholder="搜索题干、章节或知识点..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border-none bg-transparent outline-none text-xs text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 w-full focus:ring-0 p-0"
            />
          </div>

          {/* Active filters chips inline */}
          <div className="hidden md:flex items-center gap-1.5 shrink-0 overflow-x-auto max-w-[180px] py-1">
            {Object.entries(filters).map(([k, v]) => {
              if (v === '全部') return null
              return (
                <span
                  key={k}
                  className="inline-flex items-center gap-0.5 bg-zinc-100 text-zinc-650 px-1.5 py-0.5 rounded text-[10px] border border-zinc-200 font-medium dark:bg-zinc-850 dark:text-zinc-400 dark:border-zinc-800"
                >
                  {v}
                  <X
                    className="size-2.5 cursor-pointer text-zinc-400 hover:text-zinc-800"
                    onClick={() => setFilters({ ...filters, [k]: '全部' })}
                  />
                </span>
              )
            })}
          </div>

          {/* View switcher and Create Button */}
          <div className="flex items-center gap-2 shrink-0 border-l border-zinc-250 pl-3 dark:border-zinc-800">
            <div className="flex items-center bg-zinc-100 rounded-md p-0.5 dark:bg-zinc-900">
              <button
                onClick={() => setViewMode('card')}
                className={`p-1 rounded-sm transition-colors ${
                  viewMode === 'card'
                    ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-600'
                }`}
                title="卡片列表"
              >
                <Grid className="size-3" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1 rounded-sm transition-colors ${
                  viewMode === 'list'
                    ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-600'
                }`}
                title="表格视图"
              >
                <List className="size-3" />
              </button>
            </div>

            <button
              onClick={() => navigate('/mock/basket')}
              className="inline-flex items-center gap-1.5 border border-zinc-250 bg-white hover:bg-zinc-50 px-2.5 py-1 rounded text-[10.5px] font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-350 dark:hover:bg-zinc-850 transition-colors"
            >
              <ShoppingBag className="size-3.5" />
              试题篮 ({basket.length})
            </button>
          </div>
        </div>

        {/* Scrollable Question List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
              找到 {filteredQuestions.length} 道试题
            </span>
            <button
              onClick={handleSelectAll}
              className="text-[10px] font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
            >
              {selectedIds.length === filteredQuestions.length ? '清除选择' : '全选此页'}
            </button>
          </div>

          {filteredQuestions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-450 text-xs bg-white dark:bg-zinc-950/20">
              未找到匹配的试题
            </div>
          ) : viewMode === 'card' ? (
            /* Card view */
            <div className="space-y-3.5 pb-20">
              {filteredQuestions.map((question) => (
                <MockQuestionCard
                  key={question.id}
                  question={question}
                  isInBasket={basket.includes(question.id)}
                  onToggleBasket={handleToggleBasket}
                  onSelect={handleSelectRow}
                  isSelected={selectedIds.includes(question.id) || previewId === question.id}
                  showCheckbox
                  onClick={() => setPreviewId(question.id)}
                />
              ))}
            </div>
          ) : (
            /* Dense Table view */
            <div className="border border-zinc-200 rounded-lg bg-white overflow-hidden dark:border-zinc-800 dark:bg-zinc-900/10 pb-20">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-zinc-50 text-zinc-500 font-medium border-b border-zinc-200 dark:bg-zinc-900/60 dark:border-zinc-800">
                    <th className="p-2 w-8 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.length === filteredQuestions.length}
                        onChange={handleSelectAll}
                        className="size-3.5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-950 dark:border-zinc-700 dark:bg-zinc-800 cursor-pointer"
                      />
                    </th>
                    <th className="p-2 w-16 font-mono text-[10px] text-zinc-400">ID</th>
                    <th className="p-2 w-16">学段</th>
                    <th className="p-2 w-16">题型</th>
                    <th className="p-2">题干与章节大纲</th>
                    <th className="p-2 w-14 text-center">难度</th>
                    <th className="p-2 w-16 text-center">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQuestions.map((q) => {
                    const isChecked = selectedIds.includes(q.id)
                    const isInCart = basket.includes(q.id)
                    const isPreviewed = previewId === q.id
                    const previewText = q.stemMarkdown
                      .replace(/\$\$?([\s\S]*?)\$\$?/g, ' $1 ')
                      .replace(/[\n\r]+/g, ' ')
                      .slice(0, 40) + '...'

                    return (
                      <tr
                        key={q.id}
                        onClick={() => {
                          setPreviewId(q.id)
                          handleSelectRow(q.id)
                        }}
                        className={`border-b border-zinc-100 hover:bg-zinc-50/50 cursor-pointer transition-colors dark:border-zinc-850 dark:hover:bg-zinc-800/10 ${
                          isChecked || isPreviewed ? 'bg-zinc-50 dark:bg-zinc-900/20' : ''
                        }`}
                      >
                        <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleSelectRow(q.id)}
                            className="size-3.5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-950 dark:border-zinc-700 dark:bg-zinc-800 cursor-pointer"
                          />
                        </td>
                        <td className="p-2 font-mono text-[10px] text-zinc-400">#{q.id}</td>
                        <td className="p-2 text-zinc-650 dark:text-zinc-450">{q.stage}</td>
                        <td className="p-2 text-zinc-550 dark:text-zinc-450">{q.questionType}</td>
                        <td className="p-2 text-left">
                          <div className="font-bold text-zinc-850 dark:text-zinc-200 text-xs">
                            【{q.chapter}】
                          </div>
                          <div className="text-zinc-400 dark:text-zinc-550 truncate max-w-xs text-[11px] font-normal">
                            {previewText}
                          </div>
                        </td>
                        <td className="p-2 text-center">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${
                              q.difficultyLabel === '难'
                                ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900 font-semibold'
                                : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                            }`}
                          >
                            {q.difficultyLabel}
                          </span>
                        </td>
                        <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleToggleBasket(q.id)}
className={`p-1 rounded transition-colors ${
                              isInCart
                                ? 'text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                : 'text-zinc-300 hover:text-zinc-650 dark:text-zinc-750'
                            }`}
                          >
                            <ShoppingBag className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Floating Light Command Bar (shadcn/ui style Block) */}
        {selectedIds.length > 0 && (
          <div 
            className="fixed bottom-6 bg-card text-card-foreground border border-zinc-200 dark:border-zinc-800 rounded-full px-4 py-2 flex items-center gap-3.5 z-50 shadow-md select-none text-xs animate-command-bar"
            style={{ left: 'calc(50% + var(--sidebar-width) / 2)' }}
          >
            <div className="flex items-center gap-1.5 pl-1 shrink-0">
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-mono font-bold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                {selectedIds.length}
              </span>
              <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">已选择</span>
            </div>

            <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800 mx-1 shrink-0" />

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={handleBatchAddToBasket}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-zinc-900 text-zinc-50 hover:bg-zinc-800 font-semibold dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors shadow-xs whitespace-nowrap cursor-pointer"
              >
                <PlusSquare className="size-3.5" />
                <span>加入试题篮</span>
              </button>
              
              <button
                onClick={() => {
                  alert(`模拟批量分配标签，选中 ${selectedIds.length} 道题目`)
                  setSelectedIds([])
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:bg-zinc-100 text-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-850 transition-colors font-medium whitespace-nowrap cursor-pointer"
              >
                <Tag className="size-3.5" />
                <span>批量标记</span>
              </button>

              <button
                onClick={handleBatchRemove}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-red-600 hover:bg-red-50 hover:text-red-750 dark:text-red-400 dark:hover:bg-red-950/20 transition-colors font-medium whitespace-nowrap cursor-pointer"
              >
                <Trash2 className="size-3.5" />
                <span>批量删除</span>
              </button>
            </div>

            <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800 mx-1 shrink-0" />

            <button
              onClick={() => setSelectedIds([])}
              className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-655 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
              title="取消选择"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </main>

      {/* Column 3: Right Preview Details Panel (360px wide) */}
      <section className="w-[360px] shrink-0 overflow-y-auto bg-white p-5 flex flex-col gap-4 text-left select-text border-l border-zinc-200 dark:border-zinc-800 dark:bg-zinc-950">
        {activeQuestion ? (
          <>
            <div className="flex items-center justify-between border-b border-zinc-150 pb-3 dark:border-zinc-850">
              <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-650 uppercase tracking-wider">
                排版渲染即时预览
              </span>
              <span className="text-[10px] font-mono text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
                ID: #{activeQuestion.id}
              </span>
            </div>

            {/* Structured Properties */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-zinc-50/50 p-2.5 rounded border border-zinc-200/50 dark:bg-zinc-900/10 dark:border-zinc-800">
                <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">章节分类</span>
                <span className="font-bold text-zinc-850 dark:text-zinc-200 mt-0.5 block truncate">{activeQuestion.chapter}</span>
              </div>
              <div className="bg-zinc-50/50 p-2.5 rounded border border-zinc-200/50 dark:bg-zinc-900/10 dark:border-zinc-800">
                <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">题型难度</span>
                <span className="font-bold text-zinc-850 dark:text-zinc-200 mt-0.5 block">
                  {activeQuestion.questionType} ({activeQuestion.difficultyLabel})
                </span>
              </div>
            </div>

            {/* Clear Separation Content Blocks */}
            <div className="space-y-4 flex-1">
              {/* Stem Card */}
              <div className="space-y-1.5">
                <span className="text-[9px] font-bold text-zinc-450 dark:text-zinc-650 uppercase tracking-wider block">【题干】</span>
                <div className="text-xs text-zinc-900 leading-relaxed dark:text-zinc-100 bg-zinc-50/20 p-3 rounded border border-zinc-200/60 dark:border-zinc-900 dark:bg-zinc-950/10">
                  <MarkdownContent content={activeQuestion.stemMarkdown} />
                </div>
              </div>

              <div className="h-px bg-zinc-200/60 dark:bg-zinc-800" />

              {/* Answer Card */}
              <div className="space-y-1.5">
                <span className="text-[9px] font-bold text-zinc-450 dark:text-zinc-650 uppercase tracking-wider block">【参考答案】</span>
                <div className="text-xs text-zinc-900 leading-relaxed dark:text-zinc-100 bg-zinc-50/20 p-3 rounded border border-zinc-200/60 dark:border-zinc-900 dark:bg-zinc-950/10 font-semibold">
                  <MarkdownContent content={activeQuestion.answerText} />
                </div>
              </div>

              <div className="h-px bg-zinc-200/60 dark:bg-zinc-800" />

              {/* Analysis Card */}
              <div className="space-y-1.5">
                <span className="text-[9px] font-bold text-zinc-450 dark:text-zinc-650 uppercase tracking-wider block">【详细解析】</span>
                <div className="text-xs text-zinc-700 leading-relaxed dark:text-zinc-350 bg-zinc-50/20 p-3 rounded border border-zinc-200/60 dark:border-zinc-900 dark:bg-zinc-950/10">
                  <MarkdownContent content={activeQuestion.analysisMarkdown} />
                </div>
              </div>
            </div>

            {/* Knowledge points tags */}
            <div className="space-y-1.5 pt-3 border-t border-zinc-150 dark:border-zinc-800">
              <span className="text-[9px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-wider block">知识点分类</span>
              <div className="flex flex-wrap gap-1">
                {activeQuestion.knowledgePoints.map((kp) => (
                  <span
                    key={kp}
                    className="inline-block bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded text-[10px] font-semibold dark:bg-zinc-800 dark:text-zinc-400"
                  >
                    {kp}
                  </span>
                ))}
              </div>
            </div>

            {/* Basket Action from Preview */}
            <button
              onClick={() => handleToggleBasket(activeQuestion.id)}
              className={`w-full flex items-center justify-center gap-1.5 rounded py-2 text-xs font-bold mt-2 transition-colors ${
                basket.includes(activeQuestion.id)
                  ? 'bg-zinc-100 text-zinc-900 border border-zinc-200 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700'
                  : 'bg-zinc-900 text-zinc-50 hover:bg-zinc-850 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200'
              }`}
            >
              {basket.includes(activeQuestion.id) ? (
                <>
                  <CheckCircle className="size-3.5 text-emerald-600" />
                  已在试题篮中
                </>
              ) : (
                <>
                  <ShoppingBag className="size-3.5" />
                  加入试题篮
                </>
              )}
            </button>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-400 text-xs">
            选择题目查看公式排版渲染
          </div>
        )}
      </section>

    </div>
  )
}

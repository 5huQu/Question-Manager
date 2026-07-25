import { ChevronDown, ChevronRight, ChevronUp, Download, GripVertical, Hash, Award, Clock, Maximize2, ShoppingBag, Trash2 } from 'lucide-react'
import { collectionsApi } from '../../api/collections'
import { Badge, Empty } from '../ui'
import { QuestionMarkdownContent } from '../questions/QuestionContent'
import { getDefaultScore, notifyBasketUpdated, stripLeadingQuestionNo } from './constants'
import type { BasketState } from './useBasketState'

export function BasketDrawerView({ state }: { state: BasketState }) {
  const {
    navigate,
    collapsed, setCollapsed,
    exportMenuOpen, setExportMenuOpen,
    exporting,
    draggedIndex, setDraggedIndex,
    localTitle, setLocalTitle,
    localSubtitle, setLocalSubtitle,
    localTimeLimit, setLocalTimeLimit,
    active,
    totalScore, activeQuestions,
    patchCollection, patchItem, removeItem, clearCollection, moveItem,
    exportCollection,
    handleDragDrop,
  } = state

  return (
    <>
      {/* Background Backdrop Overlay */}
      {!collapsed && (
        <div
          onClick={() => setCollapsed(true)}
          className="fixed inset-0 z-40 bg-zinc-950/20 dark:bg-black/40 backdrop-blur-sm transition-opacity duration-300 opacity-100"
        />
      )}

      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="fixed right-0 top-1/2 -translate-y-1/2 bg-white dark:bg-zinc-900 border border-r-0 border-zinc-200 dark:border-zinc-800 shadow-xl hover:shadow-2xl rounded-l-2xl px-2.5 py-4 flex flex-col items-center gap-3 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all z-40 group cursor-pointer animate-in slide-in-from-right duration-250"
          title="展开试题篮"
        >
          <div className="relative">
            <ShoppingBag className="w-5 h-5 group-hover:scale-110 transition-transform" />
            {active.data?.questionCount ? (
              <span className="absolute -top-1.5 -right-2 w-[18px] h-[18px] bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white dark:ring-zinc-900">
                {active.data.questionCount}
              </span>
            ) : null}
          </div>
          <div
            className="text-[11px] font-bold tracking-widest uppercase text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors"
            style={{ writingMode: 'vertical-rl' }}
          >
            试题篮
          </div>
        </button>
      )}

      <aside
        className={`fixed right-0 top-0 bottom-0 w-full sm:w-[440px] bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl z-50 flex flex-col transform transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          collapsed ? 'translate-x-full' : 'translate-x-0'
        }`}
      >
        {/* Drawer Header */}
        <div className="h-14 flex items-center justify-between px-5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 z-20 shrink-0">
          <div className="flex items-center gap-2.5 select-none">
            <div className="p-1.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-lg border border-zinc-200 dark:border-zinc-700">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <span className="font-bold text-zinc-800 dark:text-zinc-200 text-sm">试题篮工作台</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
              title="全屏独立编辑"
              onClick={() => {
                setCollapsed(true)
                navigate('/questions/basket')
              }}
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1"></div>
            <button
              className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
              onClick={() => setCollapsed(true)}
              title="收起抽屉"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Drawer Scrollable Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col relative bg-zinc-50/30 dark:bg-zinc-950/30 min-h-0">
          {/* Sticky Context Actions */}
          <div className="sticky top-0 z-10 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800 p-4 space-y-3 shrink-0">
            <div className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-950/40 px-3 py-2">
              <ShoppingBag className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">试题篮</span>
              <span className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">唯一暂存区 · "加入试题篮"的题目都到这里</span>
            </div>

            {/* Editable Title/Subtitle Row in Drawer */}
            <div className="flex items-center justify-between gap-1.5 min-w-0 pt-1">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <input
                  className="w-1/2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50 px-2 py-1 text-xs font-semibold text-zinc-800 dark:text-zinc-200 focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600 outline-none min-w-0"
                  value={localTitle}
                  onChange={(event) => setLocalTitle(event.target.value)}
                  onBlur={() => localTitle !== active.data?.title && patchCollection({ title: localTitle })}
                  placeholder="试卷标题"
                />
                <span className="text-zinc-300 dark:text-zinc-700 select-none shrink-0 font-medium text-xs">/</span>
                <input
                  className="w-1/2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50 px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600 outline-none min-w-0"
                  value={localSubtitle}
                  onChange={(event) => setLocalSubtitle(event.target.value)}
                  onBlur={() => localSubtitle !== (active.data?.subtitle || '') && patchCollection({ subtitle: localSubtitle })}
                  placeholder="副标题..."
                />
              </div>
              {active.data?.questions.length ? (
                <button
                  onClick={clearCollection}
                  className="text-[10px] font-bold text-destructive hover:bg-destructive/10 hover:text-destructive px-2 py-1 rounded-md transition-colors cursor-pointer shrink-0 select-none border border-transparent hover:border-destructive/20"
                  title="清空所有题目"
                >
                  清空
                </button>
              ) : null}
            </div>

            {/* Stats Cards Row */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="bg-zinc-50/40 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-2 flex flex-col justify-center select-none">
                <div className="flex items-center gap-1 text-zinc-400 dark:text-zinc-500 mb-0.5">
                  <Hash className="w-3 h-3" />
                  <span className="text-[10px] font-semibold">题数</span>
                </div>
                <div className="font-bold text-base text-zinc-900 dark:text-zinc-100 leading-none">{active.data?.questionCount ?? 0}</div>
              </div>
              <div className="bg-zinc-50/40 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-2 flex flex-col justify-center select-none">
                <div className="flex items-center gap-1 text-zinc-400 dark:text-zinc-500 mb-0.5">
                  <Award className="w-3 h-3" />
                  <span className="text-[10px] font-semibold">总分</span>
                </div>
                <div className="font-bold text-base text-zinc-900 dark:text-zinc-100 leading-none">{totalScore}</div>
              </div>
              <div className="bg-zinc-50/40 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-2 flex flex-col justify-center focus-within:ring-1 ring-zinc-400 dark:ring-zinc-600 transition-all">
                <div className="flex items-center gap-1 text-zinc-400 dark:text-zinc-500 mb-0.5 select-none">
                  <Clock className="w-3 h-3" />
                  <span className="text-[10px] font-semibold">时长(分)</span>
                </div>
                <input
                  type="number"
                  value={localTimeLimit}
                  onChange={(event) => setLocalTimeLimit(event.target.value)}
                  onBlur={() => Number(localTimeLimit) !== (active.data?.timeLimit || 0) && patchCollection({ timeLimit: Number(localTimeLimit || 0) })}
                  className="w-full bg-transparent font-bold text-base text-zinc-900 dark:text-zinc-100 leading-none outline-none p-0 border-none focus:ring-0"
                  placeholder="-"
                />
              </div>
            </div>
          </div>

          {/* Items List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-28">
            {active.loading && !active.data ? (
              <Empty text="读取中..." />
            ) : active.error ? (
              <Empty text={active.error} />
            ) : !activeQuestions.length ? (
              <Empty text={'还没有题目。在题库中点击"加入试题篮"即可加入。'} />
            ) : (
              activeQuestions.map((entry, index) => (
                <div key={entry.relationId || entry.item.id} className="space-y-2">
                  {entry.sectionName ? (
                    <div className="flex items-center gap-3 py-1 select-none">
                      <div className="h-px flex-1 bg-border/60"></div>
                      <div className="px-3 py-1 rounded-full border border-border bg-card text-[10px] font-bold text-muted-foreground shadow-sm">
                        {entry.sectionName}
                      </div>
                      <div className="h-px flex-1 bg-border/60"></div>
                    </div>
                  ) : null}

                  <div
                    draggable
                    onDragStart={(e) => {
                      setDraggedIndex(index)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                    }}
                    onDrop={async (e) => {
                      e.preventDefault()
                      if (draggedIndex === null || draggedIndex === index) return
                      await handleDragDrop(draggedIndex, index)
                    }}
                    onDragEnd={() => setDraggedIndex(null)}
                    className={`group bg-card rounded-lg border border-border p-3.5 shadow-sm hover:border-zinc-400 dark:hover:border-zinc-600 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden flex gap-3 cursor-grab active:cursor-grabbing ${
                      draggedIndex === index ? 'opacity-40 border-dashed border-border bg-muted/30' : ''
                    }`}
                  >
                    {/* Left vertical marker line on hover */}
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-transparent group-hover:bg-zinc-900 dark:group-hover:bg-zinc-100 transition-colors"></div>

                    {/* Grab handle indicator */}
                    <div className="mt-0.5 text-muted-foreground/30 group-hover:text-muted-foreground/70 transition-colors shrink-0 select-none">
                      <GripVertical className="w-4 h-4" />
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col gap-3">
                      <div className="flex items-start gap-1.5">
                        <span className="font-semibold text-muted-foreground/70 text-xs mt-0.5 shrink-0">{index + 1}.</span>
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <QuestionMarkdownContent
                            content={stripLeadingQuestionNo(entry.item.stemMarkdown || '未命名题目', entry.item.questionNo)}
                            className="line-clamp-2 text-xs text-foreground leading-relaxed font-medium pointer-events-none select-none overflow-hidden max-w-full"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-border/60 pt-2.5 w-full">
                        <div className="flex items-center gap-2">
                          {entry.item.questionType && (
                            <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-medium border border-border select-none">
                              {entry.item.questionType}
                            </span>
                          )}

                          {entry.item.difficultyLabel && (
                            <Badge
                              variant={
                                entry.item.difficultyLabel.includes('难')
                                  ? 'danger'
                                  : entry.item.difficultyLabel.includes('中') || entry.item.difficultyLabel.includes('较')
                                    ? 'warning'
                                    : 'success'
                              }
                              className="rounded px-1.5 py-0.5"
                            >
                              {entry.item.difficultyLabel}
                            </Badge>
                          )}

                          <div className="flex items-center gap-1 border border-input rounded-md px-1.5 py-0.5 bg-background focus-within:border-ring transition-colors">
                            <input
                              type="number"
                              value={entry.score || ''}
                              placeholder={String(getDefaultScore(entry.item.questionType))}
                              onChange={(event) => entry.relationId && patchItem(entry.relationId, { score: Number(event.target.value || 0) })}
                              className="w-8 text-center text-xs font-bold outline-none text-foreground bg-transparent border-none p-0 focus:ring-0"
                            />
                            <span className="text-[10px] text-muted-foreground select-none">分</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-0.5 bg-muted border border-border rounded-md p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => entry.relationId && moveItem(entry.relationId, -1)}
                            disabled={index === 0}
                            className="p-1 text-muted-foreground hover:bg-background hover:text-foreground rounded transition-colors disabled:opacity-20 cursor-pointer"
                            title="上移"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => entry.relationId && moveItem(entry.relationId, 1)}
                            disabled={index === activeQuestions.length - 1}
                            className="p-1 text-muted-foreground hover:bg-background hover:text-foreground rounded transition-colors disabled:opacity-20 cursor-pointer"
                            title="下移"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                          <div className="w-px h-3 bg-border mx-0.5 my-auto"></div>
                          <button
                            onClick={() => entry.relationId && removeItem(entry.relationId)}
                            className="p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded transition-colors cursor-pointer"
                            title="移除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Drawer Footer (Export Dropdown Menu) */}
        {active.data?.questions.length ? (
          <div className="p-4 bg-card/95 backdrop-blur-md border-t border-border absolute bottom-0 left-0 right-0 z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
            <button
              onClick={() => setExportMenuOpen(!exportMenuOpen)}
              disabled={exporting}
              className="w-full py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 font-semibold rounded-md shadow-sm transition-all flex items-center justify-center gap-2 text-sm cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>{exporting ? '正在生成...' : '导出练习单'}</span>
              <ChevronUp className={`w-3.5 h-3.5 transition-transform duration-200 ${exportMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {exportMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setExportMenuOpen(false)} />
                <div className="absolute right-4 left-4 bottom-16 z-40 rounded-lg border border-border bg-popover text-popover-foreground p-2 shadow-md animate-in fade-in slide-in-from-bottom-1 duration-150">
                  <div className="p-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 select-none font-medium">
                      Markdown 格式
                    </p>
                    <div className="grid grid-cols-2 gap-1 mt-1">
                      <button
                        onClick={() => {
                          exportCollection('markdown', 'student')
                          setExportMenuOpen(false)
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors border border-transparent hover:border-border cursor-pointer"
                      >
                        <span>学生版</span>
                      </button>
                      <button
                        onClick={() => {
                          exportCollection('markdown', 'teacher')
                          setExportMenuOpen(false)
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors border border-transparent hover:border-border cursor-pointer"
                      >
                        <span>教师版</span>
                      </button>
                    </div>
                  </div>

                  <div className="p-1 border-t border-border mt-1 font-medium">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 select-none font-semibold">试卷 PDF</p>
                    <div className="grid grid-cols-2 gap-1 mt-1">
                      <button onClick={() => { exportCollection('pdf', 'student', 'exam'); setExportMenuOpen(false) }} className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors border border-transparent hover:border-border cursor-pointer"><span>学生版</span></button>
                      <button onClick={() => { exportCollection('pdf', 'teacher', 'exam'); setExportMenuOpen(false) }} className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors border border-transparent hover:border-border cursor-pointer"><span>教师版</span></button>
                    </div>
                  </div>

                  <div className="p-1 border-t border-border mt-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 select-none font-medium">
                      练习单 PDF
                    </p>
                    <div className="grid grid-cols-2 gap-1 mt-1">
                      <button
                        onClick={() => {
                          exportCollection('pdf', 'student', 'worksheet')
                          setExportMenuOpen(false)
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors border border-transparent hover:border-border cursor-pointer"
                      >
                        <span>学生版</span>
                      </button>
                      <button
                        onClick={() => {
                          exportCollection('pdf', 'teacher', 'worksheet')
                          setExportMenuOpen(false)
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors border border-transparent hover:border-border cursor-pointer"
                      >
                        <span>教师版</span>
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null}
      </aside>
    </>
  )
}

import { useMemo, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Database,
  Plus,
  ScanSearch,
  ShoppingBag,
  Sparkles,
  Flame,
  Clock,
  Moon,
  Sunrise,
  Sun,
  Sunset,
} from 'lucide-react'
import type { ActivityHeatmapDay, ActivityHeatmapResponse } from '@/api/dashboard'
import type { ExportRecordsResponse } from '@/api/exportRecords'
import { MarkdownContent } from '@/components/MarkdownContent'
import type { Dashboard, ExportRecord, OcrSettings, QuestionBankResponse, QuestionItem } from '@/types'
import { addQuestionToActiveBasket } from '@/utils/questionBasket'

export function OverviewTab({
  dashboard,
  dashboardError,
  questionBank,
  questionBankLoading,
  ocrSettings,
  activityHeatmap,
  activityHeatmapError,
  activityHeatmapLoading,
  exportRecords,
  exportRecordsLoading,
}: {
  dashboard: Dashboard | null
  dashboardError?: string
  dashboardLoading?: boolean
  questionBank: QuestionBankResponse | null
  questionBankLoading?: boolean
  ocrSettings: OcrSettings | null
  activityHeatmap: ActivityHeatmapResponse | null
  activityHeatmapError?: string
  activityHeatmapLoading?: boolean
  exportRecords: ExportRecordsResponse | null
  exportRecordsLoading?: boolean
}) {
  const navigate = useNavigate()
  const questions = questionBank?.items.slice(0, 3) ?? []
  const exports = exportRecords?.items.slice(0, 4) ?? []
  const basketIds = new Set((questionBank?.basket?.questions ?? []).map((entry) => entry.item.id))
  const heatmapDays = activityHeatmap?.days ?? []
  const stats = useMemo(() => buildStats(heatmapDays, questionBank?.totalItems ?? 0, exports), [exports, heatmapDays, questionBank?.totalItems])
  const weeks = useMemo(() => buildHeatmapWeeks(heatmapDays), [heatmapDays])
  const ocrReady = getOcrReady(ocrSettings)

  const peakHoursData = useMemo(() => [
    { label: '凌晨', range: '0:00 - 8:00', percentage: 8, icon: Moon },
    { label: '上午', range: '8:00 - 12:00', percentage: 27, icon: Sunrise },
    { label: '下午', range: '12:00 - 16:00', percentage: 20, icon: Sun },
    { label: '晚上', range: '16:00 - 24:00', percentage: 45, icon: Sunset, isPeak: true },
  ], [])

  return (
    <div className="mock-page-root flex flex-col gap-6 select-none bg-background text-foreground">
      <div className="flex flex-col gap-1.5 border-b border-zinc-200 pb-4 text-left dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="title-page text-zinc-900 dark:text-zinc-50">工作台概览</h1>
          <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">
            本地数学题库活动状态及近期校对导出看板。
          </p>
        </div>
        <div className="mt-2 flex items-center gap-2 sm:mt-0">
          <button
            onClick={() => navigate('/questions')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-50 shadow-sm transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            <Database className="size-3.5" />
            检索题库
          </button>
        </div>
      </div>

      {(dashboardError || activityHeatmapError) ? (
        <div className="rounded-xl border border-zinc-200 bg-card p-4 text-left text-xs text-zinc-500 shadow-sm dark:border-zinc-800">
          {dashboardError || activityHeatmapError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="题库总量" value={questionBankLoading ? '--' : stats.totalQuestions} unit="道" desc="累计入库试题记录" />
        <StatCard label="本月新增" value={stats.currentMonthNew} unit="道" desc={`本月录入较上月 ${stats.monthDeltaLabel}`} />
        <StatCard label="今日复核" value={stats.todayReviewed} unit="道" desc="今日完成 OCR 识别校对" />
        <StatCard label="最近导出" value={exportRecordsLoading ? '--' : stats.weeklyExports} unit="份" desc="本周生成 Word/PDF 试卷" />
      </div>

      <div className="rounded-xl border border-zinc-200 bg-card p-6 text-left text-card-foreground shadow-sm dark:border-zinc-800">
        <div className="mb-5 flex flex-col gap-1 border-b border-zinc-100 pb-4 dark:border-zinc-800">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            <Activity className="size-4 text-zinc-500" />
            题库活动热力图
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            最近 6 个月的题目录入、复核和导出记录。灰度深浅代表每日处理的题量。
          </p>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-stretch gap-6">
          {/* Left Column: Heatmap Grid */}
          <div className="flex select-none items-start gap-3 overflow-x-auto pb-2 lg:shrink-0">
            <div className="flex flex-col gap-1 text-[10px] font-medium text-zinc-400 dark:text-zinc-500 pt-6 shrink-0">
              <div className="h-3 flex items-center justify-end pr-1">周一</div>
              <div className="h-3" />
              <div className="h-3 flex items-center justify-end pr-1">周三</div>
              <div className="h-3" />
              <div className="h-3 flex items-center justify-end pr-1">周五</div>
              <div className="h-3" />
              <div className="h-3" />
            </div>

            <div>
              <div className="w-fit flex flex-col gap-2">
                {/* Month label headers */}
                <div className="flex gap-1 h-4 relative">
                  {weeks.map((week, weekIndex) => {
                    const show = shouldShowMonthLabel(weeks, weekIndex)
                    return (
                      <div key={weekIndex} className="relative w-3">
                        {show && (
                          <span className="absolute left-0 bottom-0 whitespace-nowrap text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                            {getMonthLabel(week)}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Grid block */}
                <div className="flex gap-1">
                  {activityHeatmapLoading ? (
                    Array.from({ length: 26 }).map((_, weekIndex) => (
                      <div key={weekIndex} className="flex flex-col gap-1">
                        {Array.from({ length: 7 }).map((__, dayIndex) => (
                          <div key={dayIndex} className="size-3 animate-pulse rounded-[1px] bg-zinc-100 dark:bg-zinc-900" />
                        ))}
                      </div>
                    ))
                  ) : (
                    weeks.map((week, weekIndex) => (
                      <div key={weekIndex} className="flex flex-col gap-1">
                        {week.map((day, dayIndex) => (
                          <HeatmapCell key={`${day.date}-${dayIndex}`} day={day} />
                        ))}
                      </div>
                    ))
                  )}
                </div>

                {/* Graph Legend */}
                <div className="flex items-center justify-end gap-1.5 pr-1 mt-2 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                  <span>无数据</span>
                  <div className="size-3 rounded-[1px] border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
                  <div className="size-3 rounded-[1px] bg-zinc-200 dark:bg-zinc-800" />
                  <div className="size-3 rounded-[1px] bg-zinc-400 dark:bg-zinc-600" />
                  <div className="size-3 rounded-[1px] bg-zinc-700 dark:bg-zinc-400" />
                  <div className="size-3 rounded-[1px] bg-zinc-950 dark:bg-zinc-100" />
                  <span>高频</span>
                </div>
              </div>
            </div>
          </div>

          {/* Vertical Divider 1 */}
          <div className="hidden lg:block w-[1px] bg-zinc-200 dark:bg-zinc-800" />

          {/* Middle Column: Peak Hours (最长操作时间) */}
          <div className="flex-1 min-w-[260px] flex flex-col justify-between border-t border-zinc-200 pt-4 dark:border-zinc-800 lg:border-t-0 lg:pt-0">
            <div className="space-y-4">
              <div className="flex items-center gap-1.5 h-8">
                <Clock className="size-4 text-zinc-500" />
                <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  最常活跃时间段：晚上
                </span>
              </div>

              {/* Time slots progress bars */}
              <div className="space-y-2.5">
                {peakHoursData.map((item) => {
                  const Icon = item.icon
                  return (
                    <div key={item.label} className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="flex items-center gap-1.5 font-medium text-zinc-600 dark:text-zinc-300">
                          <Icon className={`size-3.5 ${item.isPeak ? 'text-amber-500' : 'text-zinc-400'}`} />
                          <span>{item.label}</span>
                          <span className="text-[10px] text-zinc-400 font-normal">{item.range}</span>
                        </span>
                        <span className={`font-semibold font-mono ${item.isPeak ? 'text-zinc-900 dark:text-zinc-50 font-bold' : 'text-zinc-500'}`}>
                          {item.percentage}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            item.isPeak ? 'bg-zinc-800 dark:bg-zinc-200' : 'bg-zinc-300 dark:bg-zinc-700'
                          }`}
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Vertical Divider 2 */}
          <div className="hidden lg:block w-[1px] bg-zinc-200 dark:bg-zinc-800" />

          {/* Right Column: Stats & Actions (Fixed width on lg) */}
          <div className="lg:w-[320px] lg:shrink-0 border-t border-zinc-200 pt-4 dark:border-zinc-800 lg:border-t-0 lg:pt-0 flex flex-col gap-4 justify-between">
            <div className="space-y-3">
              <div className="space-y-0.5">
                <span className="block text-[12px] font-medium text-zinc-400 dark:text-zinc-500">数字化活动汇总</span>
                <span className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  最近 6 个月累计处理 {activityHeatmap?.summary.totalCount ?? 0} 道
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-zinc-200/60 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/10">
                  <span className="block text-[10px] font-medium uppercase tracking-wider text-zinc-400">处理天数</span>
                  <span className="mt-0.5 block font-mono text-[15px] font-semibold text-zinc-800 dark:text-zinc-200">
                    {activityHeatmap?.summary.activeDays ?? 0} 天
                  </span>
                </div>
                <div className="rounded-lg border border-zinc-200/60 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/10">
                  <span className="block text-[10px] font-medium uppercase tracking-wider text-zinc-400">活跃比率</span>
                  <span className="mt-0.5 block font-mono text-[15px] font-semibold text-zinc-800 dark:text-zinc-200">
                    {stats.activeRatio}% 天数
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Actions (Random Paper & Daily Question) */}
            <div className="flex gap-3 pt-2">
              <button className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-900 px-4 py-2.5 text-xs font-semibold text-zinc-50 hover:bg-zinc-800 dark:border-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-all shadow-sm flex-1 cursor-pointer hover:-translate-y-0.5 active:translate-y-0">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-amber-400" />
                  随机出卷
                </span>
                <ChevronRight className="size-3 text-zinc-400" />
              </button>

              <button className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/80 transition-all shadow-sm flex-1 cursor-pointer hover:-translate-y-0.5 active:translate-y-0">
                <span className="flex items-center gap-1.5">
                  <Flame className="size-3.5 text-orange-500 animate-pulse" />
                  每日一题
                </span>
                <ChevronRight className="size-3 text-zinc-400" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between px-1 text-left">
            <h3 className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">最近处理题目</h3>
            <button
              onClick={() => navigate('/questions')}
              className="inline-flex items-center gap-0.5 text-xs font-semibold text-zinc-900 transition-colors hover:text-zinc-700 dark:text-zinc-100 dark:hover:text-zinc-300"
            >
              全部检索
              <ChevronRight className="size-3.5" />
            </button>
          </div>

          <div className="space-y-3.5">
            {questions.map((question) => (
              <WorkbenchQuestionPreview
                key={question.id}
                question={question}
                isInBasket={basketIds.has(question.id)}
                onOpen={() => navigate(`/questions/${encodeURIComponent(question.id)}`)}
              />
            ))}
            {!questions.length ? (
              <div className="rounded-lg border border-zinc-200 bg-white p-5 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:bg-card">
                暂无最近处理题目
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <h3 className="px-1 text-left text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">最近导出记录</h3>
            <div className="space-y-3 rounded-xl border border-zinc-200 bg-card p-4 text-card-foreground shadow-sm dark:border-zinc-800">
              {exports.map((record) => (
                <ExportRow key={record.id} record={record} />
              ))}
              {!exports.length ? (
                <div className="py-3 text-left text-xs font-medium text-zinc-400 dark:text-zinc-500">暂无导出记录</div>
              ) : null}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="px-1 text-left text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">快捷工具入口</h3>
            <div className="space-y-1 rounded-xl border border-zinc-200 bg-card p-3 text-card-foreground shadow-sm dark:border-zinc-800">
              <ShortcutButton icon={ScanSearch} label="OCR 识别复核工作区" onClick={() => navigate('/tools/pdf-slicer/ocr-jobs')} />
              <ShortcutButton icon={Database} label="题库检索与试卷大纲" onClick={() => navigate('/questions')} />
              <ShortcutButton icon={Plus} label="手动录入数学题" onClick={() => navigate('/questions/new')} />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="px-1 text-left text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">服务运行状态</h3>
            <div className="space-y-3 rounded-xl border border-zinc-200 bg-card p-4 text-left text-xs text-card-foreground shadow-sm dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-400 dark:text-zinc-500">SQLite 本地主库:</span>
                <StatusText ready={!dashboardError && Boolean(dashboard || questionBank)} label={dashboardError ? '连接异常' : '连接正常'} />
              </div>
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-400 dark:text-zinc-500">KaTeX 排版公式引擎:</span>
                <StatusText ready label="渲染正常" />
              </div>
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-400 dark:text-zinc-500">环境内核:</span>
                <span className="font-mono text-[10px] font-semibold text-zinc-600 dark:text-zinc-400">
                  {ocrReady.providerLabel}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, unit, desc }: { label: string; value: string | number; unit: string; desc: string }) {
  return (
    <div className="flex h-[110px] flex-col justify-between rounded-xl border border-zinc-200 bg-card p-5 text-left text-card-foreground shadow-sm dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-mono text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{formatNumber(value)}</span>
        <span className="text-xs font-medium text-zinc-400">{unit}</span>
      </div>
      <div className="mt-1 text-[12px] text-zinc-400 dark:text-zinc-500">{desc}</div>
    </div>
  )
}

function HeatmapCell({ day }: { day: ActivityHeatmapDay }) {
  if (!day.date) {
    return <div className="size-3 rounded-[1px] bg-transparent" />
  }
  const colorClass = getHeatmapColor(day.count)
  return (
    <div className={`group relative size-3 cursor-pointer rounded-[1px] ${colorClass} transition-all duration-100 hover:ring-1 hover:ring-zinc-950 dark:hover:ring-zinc-100`}>
      <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 scale-0 whitespace-nowrap rounded bg-zinc-950 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-white shadow transition-all group-hover:scale-100 dark:bg-zinc-500 dark:text-zinc-900">
        {day.date}: 处理 {day.count} 题
      </div>
    </div>
  )
}

function WorkbenchQuestionPreview({
  question,
  isInBasket,
  onOpen,
}: {
  question: QuestionItem
  isInBasket: boolean
  onOpen: () => void
}) {
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [adding, setAdding] = useState(false)

  async function addToBasket(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    if (isInBasket || adding) return
    setAdding(true)
    try {
      await addQuestionToActiveBasket(question.id)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div
      onClick={onOpen}
      className="group relative flex cursor-pointer select-none flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-5 text-left transition-all duration-150 hover:border-zinc-300 dark:border-zinc-800 dark:bg-card dark:hover:border-zinc-700"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Tag>{question.questionType || '题型待补充'}</Tag>
            <Tag>{question.stage || '学段待补充'}</Tag>
            <Tag>{question.chapter || '章节待补充'}</Tag>
            <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold ${question.difficultyLabel === '难' ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>
              难度: {question.difficultyLabel || '待定'}
            </span>
          </div>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">#{question.id}</span>
      </div>

      <div className="select-text font-sans text-xs leading-relaxed text-zinc-900 dark:text-zinc-100">
        <MarkdownContent content={question.stemMarkdown || question.searchText || ''} />
      </div>

      <div className={`grid transition-all duration-300 ease-in-out ${showAnalysis ? 'mt-2 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}>
        <div className="overflow-hidden">
          <div className="space-y-3 rounded border-t border-zinc-100 bg-zinc-50/50 p-3 pt-3 dark:border-zinc-800 dark:bg-zinc-900/30">
            <div>
              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">【答案】</span>
              <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                <MarkdownContent content={question.answerText || '暂无答案'} />
              </div>
            </div>
            <div>
              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">【解析】</span>
              <div className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                <MarkdownContent content={question.analysisMarkdown || '暂无解析'} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <div className="flex items-center gap-3 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
          <span className="flex items-center gap-1">
            <Calendar className="size-3 text-zinc-400" />
            {formatDate(question.updatedAt)}
          </span>
          <span className="flex items-center gap-1">
            <BookOpen className="size-3 text-zinc-400" />
            {question.sourceTitle || '高中数学专项试卷'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={(event) => {
              event.stopPropagation()
              setShowAnalysis(!showAnalysis)
            }}
            className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-2 py-1 text-[10px] font-semibold text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
            type="button"
          >
            {showAnalysis ? (
              <>
                <ChevronUp className="size-3" />
                收起解析
              </>
            ) : (
              <>
                <ChevronDown className="size-3" />
                查看解析
              </>
            )}
          </button>

          <button
            onClick={addToBasket}
            className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-[10px] font-bold transition-colors ${isInBasket ? 'border border-zinc-200 bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100' : 'bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200'}`}
            type="button"
          >
            {isInBasket ? (
              <>
                <Check className="size-3" />
                已在试题篮
              </>
            ) : (
              <>
                <ShoppingBag className="size-3" />
                {adding ? '加入中' : '加入试题篮'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

function ExportRow({ record }: { record: ExportRecord }) {
  return (
    <div className="flex items-start justify-between rounded px-1 pb-3 text-left text-xs transition-colors last:border-0 last:pb-0 hover:bg-zinc-50/20 dark:hover:bg-zinc-900/20 border-b border-zinc-100 dark:border-zinc-800/80">
      <div className="min-w-0 space-y-1">
        <p className="truncate pr-2 font-semibold text-zinc-800 dark:text-zinc-100">{record.title || record.filename}</p>
        <p className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
          包含 {record.questionCount} 道题 · {formatDate(record.createdAt)}
        </p>
      </div>
      <span className="shrink-0 rounded border border-zinc-200 bg-zinc-50/50 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        {String(record.format || '').toUpperCase() || 'FILE'}
      </span>
    </div>
  )
}

function ShortcutButton({ icon: Icon, label, onClick }: { icon: typeof ScanSearch; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg p-2 text-left text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50/50 dark:text-zinc-300 dark:hover:bg-zinc-900/30"
    >
      <span className="flex items-center gap-2">
        <Icon className="size-4 text-zinc-400" />
        {label}
      </span>
      <ArrowUpRight className="size-3.5 text-zinc-400" />
    </button>
  )
}

function StatusText({ ready, label }: { ready: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
      <span className={`size-1.5 rounded-full ${ready ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-400'}`} />
      {label}
    </span>
  )
}

function Tag({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      {children}
    </span>
  )
}

function buildHeatmapWeeks(days: ActivityHeatmapDay[]): ActivityHeatmapDay[][] {
  if (!days.length) {
    return Array.from({ length: 26 }, () =>
      Array.from({ length: 7 }, () => ({
        date: '',
        count: 0,
        level: 0 as const,
        breakdown: {
          questionsCreated: 0,
          questionsUpdated: 0,
          questionsBanked: 0,
          exportsCreated: 0,
          ocrCompleted: 0,
        },
      }))
    )
  }

  const list = [...days]
  // Pad the end to complete the last week (end on Sunday)
  const lastDayStr = list[list.length - 1].date
  const lastDay = parseDay(lastDayStr)
  const lastDayOfWeek = lastDay ? (lastDay.getDay() + 6) % 7 : 6
  const endPaddingCount = 6 - lastDayOfWeek
  for (let i = 0; i < endPaddingCount; i++) {
    list.push({
      date: '',
      count: 0,
      level: 0,
      breakdown: {
        questionsCreated: 0,
        questionsUpdated: 0,
        questionsBanked: 0,
        exportsCreated: 0,
        ocrCompleted: 0,
      },
    })
  }

  // Slice the last 182 days (26 weeks)
  let resultDays = list.slice(-182)
  if (resultDays.length < 182) {
    const startPaddingCount = 182 - resultDays.length
    const startPadding: ActivityHeatmapDay[] = Array.from({ length: startPaddingCount }, () => ({
      date: '',
      count: 0,
      level: 0,
      breakdown: {
        questionsCreated: 0,
        questionsUpdated: 0,
        questionsBanked: 0,
        exportsCreated: 0,
        ocrCompleted: 0,
      },
    }))
    resultDays = [...startPadding, ...resultDays]
  }

  const weeks: ActivityHeatmapDay[][] = []
  for (let i = 0; i < resultDays.length; i += 7) {
    weeks.push(resultDays.slice(i, i + 7))
  }
  return weeks
}

function shouldShowMonthLabel(weeks: ActivityHeatmapDay[][], wIdx: number) {
  const currentWeek = weeks[wIdx]
  const currentFirstDay = currentWeek.find((d) => d.date)
  if (!currentFirstDay) return false

  const currentMonth = new Date(`${currentFirstDay.date}T00:00:00`).getMonth()

  if (wIdx === 0) {
    if (weeks.length > 1) {
      const nextWeek = weeks[1]
      const nextFirstDay = nextWeek.find((d) => d.date)
      if (nextFirstDay) {
        const nextMonth = new Date(`${nextFirstDay.date}T00:00:00`).getMonth()
        if (nextMonth !== currentMonth) return false
      }
    }
    if (weeks.length > 2) {
      const nextWeek2 = weeks[2]
      const nextFirstDay2 = nextWeek2.find((d) => d.date)
      if (nextFirstDay2) {
        const nextMonth2 = new Date(`${nextFirstDay2.date}T00:00:00`).getMonth()
        if (nextMonth2 !== currentMonth) return false
      }
    }
    return true
  }

  const prevWeek = weeks[wIdx - 1]
  const prevFirstDay = prevWeek.find((d) => d.date)
  if (!prevFirstDay) return true

  const prevMonth = new Date(`${prevFirstDay.date}T00:00:00`).getMonth()

  return currentMonth !== prevMonth
}

function getMonthLabel(week: ActivityHeatmapDay[]) {
  const firstDay = week.find((d) => d.date)
  if (!firstDay) return ''
  const date = new Date(`${firstDay.date}T00:00:00`)
  return `${date.getMonth() + 1}月`
}

function buildStats(days: ActivityHeatmapDay[], totalQuestions: number, exports: ExportRecord[]) {
  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()
  const previousMonthDate = new Date(currentYear, currentMonth - 1, 1)
  const today = formatDateKey(now)
  const currentMonthNew = days.reduce((sum, day) => {
    const date = parseDay(day.date)
    if (!date || date.getFullYear() !== currentYear || date.getMonth() !== currentMonth) return sum
    return sum + day.breakdown.questionsCreated + day.breakdown.questionsBanked
  }, 0)
  const previousMonthNew = days.reduce((sum, day) => {
    const date = parseDay(day.date)
    if (!date || date.getFullYear() !== previousMonthDate.getFullYear() || date.getMonth() !== previousMonthDate.getMonth()) return sum
    return sum + day.breakdown.questionsCreated + day.breakdown.questionsBanked
  }, 0)
  const todayReviewed = days.find((day) => day.date === today)?.breakdown.ocrCompleted ?? 0
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - 7)
  const weeklyExports = exports.filter((record) => {
    const date = parseDay(record.createdAt)
    return date ? date >= weekStart : false
  }).length
  const activeDays = days.filter((day) => day.count > 0).length
  const activeRatio = days.length ? Math.round((activeDays / days.length) * 100) : 0
  return {
    totalQuestions,
    currentMonthNew,
    monthDeltaLabel: formatDelta(currentMonthNew, previousMonthNew),
    todayReviewed,
    weeklyExports,
    activeRatio,
  }
}

function formatDelta(current: number, previous: number) {
  if (!previous && !current) return '+0%'
  if (!previous) return '+100%'
  const value = Math.round(((current - previous) / previous) * 1000) / 10
  return `${value >= 0 ? '+' : ''}${value}%`
}

function getHeatmapColor(count: number) {
  if (count > 0 && count <= 2) return 'bg-zinc-200 dark:bg-zinc-800'
  if (count > 2 && count <= 4) return 'bg-zinc-400 dark:bg-zinc-600'
  if (count > 4 && count <= 6) return 'bg-zinc-700 dark:bg-zinc-400'
  if (count > 6) return 'bg-zinc-950 dark:bg-zinc-100'
  return 'bg-zinc-100 dark:bg-zinc-900'
}

function getOcrReady(ocrSettings: OcrSettings | null) {
  const provider = ocrSettings?.ocrProvider ?? 'doc2x'
  const model = provider === 'doc2x' ? ocrSettings?.doc2xModel : provider === 'glm' ? ocrSettings?.glmOcrModel : ocrSettings?.model
  return {
    providerLabel: `${provider === 'doc2x' ? 'Doc2X' : provider === 'glm' ? 'GLM-OCR' : 'Legacy'} · ${model || '未设置'}`,
  }
}

function formatNumber(value: string | number) {
  if (typeof value === 'string') return value
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatDate(value: string) {
  const date = parseDay(value)
  if (!date) return '日期待补充'
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function formatDateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDay(value: string) {
  if (!value) return null
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

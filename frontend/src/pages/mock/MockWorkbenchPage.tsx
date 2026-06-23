import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileText,
  Plus,
  ScanSearch,
  ChevronRight,
  Database,
  TrendingUp,
  Activity,
  History,
  FileCheck,
  Cpu,
  ArrowUpRight
} from 'lucide-react'
import {
  INITIAL_MOCK_QUESTIONS,
  getMockBasket,
  addToMockBasket,
  removeFromMockBasket,
  generateHeatmapData,
  getMockExports,
  MockQuestion,
  MockExport,
  HeatmapDay
} from './mockData'
import { MockQuestionCard } from './MockQuestionCard'

export default function MockWorkbenchPage() {
  const navigate = useNavigate()
  const [questions, setQuestions] = useState<MockQuestion[]>([])
  const [basket, setBasket] = useState<string[]>([])
  const [exports, setExports] = useState<MockExport[]>([])
  const [heatmap, setHeatmap] = useState<HeatmapDay[]>([])

  useEffect(() => {
    setQuestions(INITIAL_MOCK_QUESTIONS.slice(0, 3))
    setBasket(getMockBasket())
    setExports(getMockExports().slice(0, 4))
    setHeatmap(generateHeatmapData())

    const handleBasketChange = (event: Event) => {
      const ids = (event as CustomEvent<string[]>).detail
      setBasket(ids)
    }
    const handleExportsChange = (event: Event) => {
      const list = (event as CustomEvent<MockExport[]>).detail
      setExports(list.slice(0, 4))
    }
    window.addEventListener('mock-basket-changed', handleBasketChange)
    window.addEventListener('mock-exports-changed', handleExportsChange)
    return () => {
      window.removeEventListener('mock-basket-changed', handleBasketChange)
      window.removeEventListener('mock-exports-changed', handleExportsChange)
    }
  }, [])

  const handleToggleBasket = (id: string) => {
    if (basket.includes(id)) {
      removeFromMockBasket(id)
    } else {
      addToMockBasket(id)
    }
  }

  // Group 182 days (26 weeks) into weeks of 7 days
  const weeks: HeatmapDay[][] = []
  if (heatmap.length > 0) {
    for (let i = 0; i < heatmap.length; i += 7) {
      weeks.push(heatmap.slice(i, i + 7))
    }
  }

  const months = ['1月', '2月', '3月', '4月', '5月', '6月']

  return (
    <div className="mock-page-root flex flex-col gap-6 select-none bg-background text-foreground">
      
      {/* Page Title & Action Header */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-200 pb-4 dark:border-zinc-800 text-left">
        <div>
          <h1 className="title-page text-zinc-900 dark:text-zinc-50">工作台概览</h1>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
            本地数学题库活动状态及近期校对导出看板。
          </p>
        </div>
        <div className="flex items-center gap-2 mt-2 sm:mt-0">
          <button
            onClick={() => navigate('/mock/question-bank')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 text-zinc-50 hover:bg-zinc-800 px-3 py-1.5 text-xs font-semibold dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors shadow-sm"
          >
            <Database className="size-3.5" />
            检索题库
          </button>
        </div>
      </div>

      {/* Row 1: Stats Grid (4 Cards in shadcn/ui style) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        
        {/* Card 1: Total */}
        <div className="rounded-xl border border-zinc-200 bg-card text-card-foreground shadow-sm p-5 dark:border-zinc-800 text-left flex flex-col justify-between h-[110px]">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">
              题库总量
            </span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 font-mono">
              14,290
            </span>
            <span className="text-xs font-medium text-zinc-400">道</span>
          </div>
          <div className="text-[12px] text-zinc-400 dark:text-zinc-500 mt-1">
            累计入库试题记录
          </div>
        </div>

        {/* Card 2: Monthly New */}
        <div className="rounded-xl border border-zinc-200 bg-card text-card-foreground shadow-sm p-5 dark:border-zinc-800 text-left flex flex-col justify-between h-[110px]">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">
              本月新增
            </span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 font-mono">
              312
            </span>
            <span className="text-xs font-medium text-zinc-400">道</span>
          </div>
          <div className="text-[12px] text-zinc-400 dark:text-zinc-500 mt-1">
            本月录入较上月 +8.4%
          </div>
        </div>

        {/* Card 3: Recent Review */}
        <div className="rounded-xl border border-zinc-200 bg-card text-card-foreground shadow-sm p-5 dark:border-zinc-800 text-left flex flex-col justify-between h-[110px]">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">
              今日复核
            </span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 font-mono">
              12
            </span>
            <span className="text-xs font-medium text-zinc-400">道</span>
          </div>
          <div className="text-[12px] text-zinc-400 dark:text-zinc-500 mt-1">
            今日完成 OCR 识别校对
          </div>
        </div>

        {/* Card 4: Recent Exports */}
        <div className="rounded-xl border border-zinc-200 bg-card text-card-foreground shadow-sm p-5 dark:border-zinc-800 text-left flex flex-col justify-between h-[110px]">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">
              最近导出
            </span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 font-mono">
              24
            </span>
            <span className="text-xs font-medium text-zinc-400">份</span>
          </div>
          <div className="text-[12px] text-zinc-400 dark:text-zinc-500 mt-1">
            本周生成 Word/PDF 试卷
          </div>
        </div>
      </div>

      {/* Row 2: Heatmap Contribution Card */}
      <div className="rounded-xl border border-zinc-200 bg-card text-card-foreground shadow-sm p-6 dark:border-zinc-800 text-left">
        <div className="flex flex-col gap-1 border-b border-zinc-100 pb-4 mb-5 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 flex items-center gap-1.5">
            <Activity className="size-4 text-zinc-500" />
            题库活动热力图
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-450">
            最近 6 个月的题目录入、复核和导出记录。灰度深浅代表每日处理的题量。
          </p>
        </div>

        {/* Dynamic Horizontal Split Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-center">
          
          {/* Left 3 Columns: Continuous Heatmap Matrix */}
          <div className="lg:col-span-3 flex items-start gap-3 w-full overflow-x-auto pb-2 select-none">
            {/* Y axis labels */}
            <div className="flex flex-col justify-between text-[10px] text-zinc-400 dark:text-zinc-550 h-[84px] pt-5 font-medium shrink-0">
              <span>周一</span>
              <span>周三</span>
              <span>周五</span>
            </div>

            {/* Heatmap Grid */}
            <div className="flex-1 flex flex-col gap-1.5 min-w-[500px]">
              {/* Month label headers */}
              <div className="flex justify-between text-[10px] text-zinc-450 dark:text-zinc-500 px-1 font-medium">
                {months.map((m) => (
                  <span key={m}>{m}</span>
                ))}
              </div>

              {/* Grid block */}
              <div className="flex gap-[3.5px]">
                {weeks.map((week, wIdx) => (
                  <div key={wIdx} className="flex flex-col gap-[3.5px]">
                    {week.map((day, dIdx) => {
                      let colorClass = 'bg-zinc-100 dark:bg-zinc-900'
                      // Grayscale colors
                      if (day.count > 0 && day.count <= 2) colorClass = 'bg-zinc-200 dark:bg-zinc-800'
                      else if (day.count > 2 && day.count <= 4) colorClass = 'bg-zinc-400 dark:bg-zinc-600'
                      else if (day.count > 4 && day.count <= 6) colorClass = 'bg-zinc-700 dark:bg-zinc-450'
                      else if (day.count > 6) colorClass = 'bg-zinc-950 dark:bg-zinc-100'

                      return (
                        <div
                          key={dIdx}
                          className={`size-2.5 rounded-[1px] ${colorClass} transition-all duration-100 hover:ring-1 hover:ring-zinc-950 dark:hover:ring-zinc-100 cursor-pointer group relative`}
                        >
                          {/* Hover Tooltip */}
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 scale-0 group-hover:scale-100 bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-900 text-[10px] font-mono px-2.5 py-0.5 rounded shadow pointer-events-none whitespace-nowrap z-50 transition-all font-semibold">
                            {day.date}: 处理 {day.count} 题
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>

              {/* Graph Legend */}
              <div className="flex items-center justify-end gap-1.5 text-[10px] text-zinc-450 dark:text-zinc-500 pr-1 mt-2 font-medium">
                <span>无数据</span>
                <div className="size-2.5 rounded-[1px] bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800" />
                <div className="size-2.5 rounded-[1px] bg-zinc-200 dark:bg-zinc-800" />
                <div className="size-2.5 rounded-[1px] bg-zinc-400 dark:bg-zinc-600" />
                <div className="size-2.5 rounded-[1px] bg-zinc-700 dark:bg-zinc-450" />
                <div className="size-2.5 rounded-[1px] bg-zinc-950 dark:bg-zinc-100" />
                <span>高频</span>
              </div>
            </div>
          </div>

          {/* Right 1 Column: Stats Panel */}
          <div className="lg:col-span-1 border-t lg:border-t-0 lg:border-l border-zinc-200 lg:pl-6 pt-4 lg:pt-0 dark:border-zinc-800 flex flex-col gap-3 justify-center">
            <div className="space-y-0.5">
              <span className="text-[12px] font-medium text-zinc-400 dark:text-zinc-500 block">数字化活动汇总</span>
              <span className="text-xs font-semibold text-zinc-850 dark:text-zinc-200 block">最近 6 个月累计处理 542 道</span>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-zinc-50/50 p-3 rounded-lg border border-zinc-200/60 dark:bg-zinc-900/10 dark:border-zinc-800">
                <span className="text-[10px] font-medium text-zinc-450 uppercase tracking-wider block">处理天数</span>
                <span className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200 font-mono mt-0.5 block">118 天</span>
              </div>
              <div className="bg-zinc-50/50 p-3 rounded-lg border border-zinc-200/60 dark:bg-zinc-900/10 dark:border-zinc-800">
                <span className="text-[10px] font-medium text-zinc-450 uppercase tracking-wider block">活跃比率</span>
                <span className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200 font-mono mt-0.5 block">82% 天数</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Row 3: Grid Details Section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left 2 columns: Recent Activity */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between px-1 text-left">
            <h3 className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">
              最近处理题目
            </h3>
            <button
              onClick={() => navigate('/mock/question-bank')}
              className="inline-flex items-center gap-0.5 text-xs font-semibold text-zinc-900 hover:text-zinc-700 dark:text-zinc-100 dark:hover:text-zinc-300 transition-colors"
            >
              全部检索
              <ChevronRight className="size-3.5" />
            </button>
          </div>

          <div className="space-y-3.5">
            {questions.map((question) => (
              <MockQuestionCard
                key={question.id}
                question={question}
                isInBasket={basket.includes(question.id)}
                onToggleBasket={handleToggleBasket}
              />
            ))}
          </div>
        </div>

        {/* Right 1 column: Exports & Tools */}
        <div className="space-y-6">
          {/* Recent Exports Card */}
          <div className="space-y-3">
            <h3 className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400 px-1 text-left">
              最近导出记录
            </h3>
            <div className="rounded-xl border border-zinc-200 bg-card text-card-foreground shadow-sm p-4 dark:border-zinc-800 space-y-3">
              {exports.map((exp) => (
                <div key={exp.id} className="flex items-start justify-between text-left text-xs pb-3 last:pb-0 border-b border-zinc-100 last:border-0 dark:border-zinc-800/80 hover:bg-zinc-50/20 dark:hover:bg-zinc-900/20 px-1 rounded transition-colors">
                  <div className="space-y-1 min-w-0">
                    <p className="font-semibold text-zinc-800 dark:text-zinc-100 truncate pr-2">
                      {exp.title}
                    </p>
                    <p className="text-[11px] text-zinc-450 dark:text-zinc-500 font-medium">
                      包含 {exp.questionCount} 道题 · {exp.date}
                    </p>
                  </div>
                  <span className="rounded border border-zinc-200 bg-zinc-50/50 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 font-semibold shrink-0">
                    {exp.format}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Shortcuts */}
          <div className="space-y-3">
            <h3 className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400 px-1 text-left">
              快捷工具入口
            </h3>
            <div className="rounded-xl border border-zinc-200 bg-card text-card-foreground shadow-sm p-3 dark:border-zinc-800 space-y-1">
              <button
                onClick={() => navigate('/mock/ocr-review')}
                className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 text-xs font-semibold text-zinc-700 dark:text-zinc-300 transition-colors text-left"
              >
                <span className="flex items-center gap-2">
                  <ScanSearch className="size-4 text-zinc-400" />
                  OCR 识别复核工作区
                </span>
                <ArrowUpRight className="size-3.5 text-zinc-400" />
              </button>
              <button
                onClick={() => navigate('/mock/question-bank')}
                className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 text-xs font-semibold text-zinc-700 dark:text-zinc-300 transition-colors text-left"
              >
                <span className="flex items-center gap-2">
                  <Database className="size-4 text-zinc-400" />
                  题库检索与试卷大纲
                </span>
                <ArrowUpRight className="size-3.5 text-zinc-400" />
              </button>
              <button
                onClick={() => navigate('/questions/new')}
                className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 text-xs font-semibold text-zinc-700 dark:text-zinc-300 transition-colors text-left"
              >
                <span className="flex items-center gap-2">
                  <Plus className="size-4 text-zinc-400" />
                  手动录入数学题
                </span>
                <ArrowUpRight className="size-3.5 text-zinc-400" />
              </button>
            </div>
          </div>

          {/* System status */}
          <div className="space-y-3">
            <h3 className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400 px-1 text-left">
              服务运行状态
            </h3>
            <div className="rounded-xl border border-zinc-200 bg-card text-card-foreground shadow-sm p-4 dark:border-zinc-800 space-y-3 text-xs text-left">
              <div className="flex items-center justify-between">
                <span className="text-zinc-450 dark:text-zinc-500 font-medium">SQLite 本地主库:</span>
                <span className="font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 text-[11px]">
                  <span className="size-1.5 rounded-full bg-emerald-500" /> 连接正常
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-450 dark:text-zinc-500 font-medium">KaTeX 排版公式引擎:</span>
                <span className="font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 text-[11px]">
                  <span className="size-1.5 rounded-full bg-emerald-500" /> 渲染正常
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-450 dark:text-zinc-500 font-medium">环境内核:</span>
                <span className="font-mono text-zinc-650 dark:text-zinc-400 font-semibold text-[10px]">
                  Electron v42 · Node 24
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

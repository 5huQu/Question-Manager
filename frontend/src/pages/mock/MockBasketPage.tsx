import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Trash2,
  ArrowUp,
  ArrowDown,
  FileDown,
  HelpCircle,
  FileText,
  CheckCircle2,
  AlertCircle,
  Settings2,
  FileCode2,
  Sparkles,
  RefreshCw,
  GripVertical
} from 'lucide-react'
import {
  INITIAL_MOCK_QUESTIONS,
  getMockBasket,
  saveMockBasket,
  clearMockBasket,
  addMockExport,
  MockQuestion
} from './mockData'
import { MarkdownContent } from '@/components/MarkdownContent'

interface BasketItem {
  question: MockQuestion
  score: number
}

export default function MockBasketPage() {
  const navigate = useNavigate()
  const [basketItems, setBasketItems] = useState<BasketItem[]>([])
  const [paperTitle, setPaperTitle] = useState('2026年高一年级下学期期末数学模拟卷')
  const [paperSubtitle, setPaperSubtitle] = useState('机密 · 启用前 | 考试时间：120分钟 | 满分：150分 | 命题人：数学教研组')
  const [paperSize, setPaperSize] = useState('A4')
  const [format, setFormat] = useState<'Markdown' | 'PDF' | 'LaTeX'>('Markdown')
  const [showAnswers, setShowAnswers] = useState<'none' | 'answers' | 'analysis'>('analysis')
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportStep, setExportStep] = useState('')
  const [showSuccessDialog, setShowSuccessDialog] = useState(false)
  const [generatedId, setGeneratedId] = useState('')

  // Drag and Drop state
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)

  useEffect(() => {
    loadBasket()
    const handleBasketChange = (event: Event) => {
      const ids = (event as CustomEvent<string[]>).detail
      syncBasketWithIds(ids)
    }
    window.addEventListener('mock-basket-changed', handleBasketChange)
    return () => window.removeEventListener('mock-basket-changed', handleBasketChange)
  }, [])

  const loadBasket = () => {
    const ids = getMockBasket()
    syncBasketWithIds(ids)
  }

  const syncBasketWithIds = (ids: string[]) => {
    const items = ids.map(id => {
      const q = INITIAL_MOCK_QUESTIONS.find(x => x.id === id)
      // Assign default scores based on question type
      let defaultScore = 5
      if (q) {
        if (q.questionType === '填空题') defaultScore = 5
        if (q.questionType === '解答题') defaultScore = 15
      }
      return q ? { question: q, score: defaultScore } : null
    }).filter((x): x is BasketItem => x !== null)
    setBasketItems(items)
  }

  const handleRemove = (id: string) => {
    const nextIds = basketItems
      .filter(item => item.question.id !== id)
      .map(item => item.question.id)
    saveMockBasket(nextIds)
  }

  const handleClear = () => {
    if (confirm('确定要清空试题篮中的所有题目吗？')) {
      clearMockBasket()
    }
  }

  const handleScoreChange = (index: number, val: number) => {
    const nextItems = [...basketItems]
    nextItems[index].score = isNaN(val) ? 0 : val
    setBasketItems(nextItems)
  }

  const totalScore = basketItems.reduce((sum, item) => sum + item.score, 0)

  // Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIdx(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', index.toString())
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedIdx === null || draggedIdx === index) return

    const reordered = [...basketItems]
    const [removed] = reordered.splice(draggedIdx, 1)
    reordered.splice(index, 0, removed)
    
    setBasketItems(reordered)
    saveMockBasket(reordered.map(item => item.question.id))
    setDraggedIdx(null)
  }

  const handleDragEnd = () => {
    setDraggedIdx(null)
  }

  const handleGenerate = () => {
    if (basketItems.length === 0) {
      alert('试题篮为空，请先前往题库管理添加题目！')
      return
    }

    setIsExporting(true)
    setExportProgress(10)
    setExportStep('正在分析排版布局...')

    const steps = [
      { progress: 30, text: '正在校对数学公式与 LaTeX 代码...' },
      { progress: 60, text: '正在渲染矢量图表与页眉页脚...' },
      { progress: 85, text: '正在打包压缩文档 (Markdown / PDF / LaTeX)...' },
      { progress: 100, text: '文件打包完成，正在上传到本地下载区...' }
    ]

    let currentStepIdx = 0
    const interval = setInterval(() => {
      if (currentStepIdx < steps.length) {
        setExportProgress(steps[currentStepIdx].progress)
        setExportStep(steps[currentStepIdx].text)
        currentStepIdx++
      } else {
        clearInterval(interval)
        setIsExporting(false)
        const expId = 'exp-' + Math.floor(Math.random() * 9000 + 1000)
        setGeneratedId(expId)
        
        // Add to mock export records database
        addMockExport({
          id: expId,
          title: paperTitle,
          format: format,
          questionCount: basketItems.length,
          date: new Date().toISOString().split('T')[0],
          status: 'success',
          questions: basketItems.map(item => item.question),
          paperSize: paperSize,
          showAnswers: showAnswers !== 'none'
        })

        setShowSuccessDialog(true)
      }
    }, 500)
  }

  return (
    <div className="mock-page-root flex h-[calc(100vh-6rem)] overflow-hidden bg-zinc-50/20 dark:bg-zinc-950 relative select-none">
      
      {/* Left Pane: Question Organizer & Basket List */}
      <main className="flex-1 flex flex-col overflow-hidden border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/10">
        
        {/* Header Toolbar */}
        <div className="h-12 shrink-0 border-b border-zinc-200 bg-white flex items-center justify-between px-4 dark:bg-zinc-900 dark:border-zinc-850">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
              试题大纲与分值分配 ({basketItems.length} 道试题)
            </span>
          </div>
          <div className="flex items-center gap-2">
            {basketItems.length > 0 && (
              <button
                onClick={handleClear}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-zinc-200 bg-white text-zinc-500 hover:text-red-650 hover:bg-red-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-red-400 transition-colors"
              >
                <Trash2 className="size-3.5" />
                清空列表
              </button>
            )}
          </div>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {basketItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-400 text-xs bg-white dark:bg-zinc-900/20">
              <HelpCircle className="size-8 text-zinc-300 dark:text-zinc-700 mb-2" />
              <span>你的试题篮是空的</span>
              <button
                onClick={() => navigate('/mock/question-bank')}
                className="mt-3 text-xs text-zinc-900 dark:text-zinc-100 font-semibold hover:underline"
              >
                前去题库管理添加题目 ➔
              </button>
            </div>
          ) : (
            <div className="space-y-3 pb-16">
              {basketItems.map((item, idx) => (
                <div
                  key={item.question.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragEnd={handleDragEnd}
                  onDrop={(e) => handleDrop(e, idx)}
                  className={`border border-zinc-200 bg-white rounded-lg p-4 dark:border-zinc-800 dark:bg-zinc-900/30 flex items-start gap-4 text-left group hover:border-zinc-300 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 cursor-grab active:cursor-grabbing ${
                    draggedIdx === idx ? 'opacity-40 border-dashed border-zinc-400 bg-zinc-50 dark:bg-zinc-900/10' : ''
                  }`}
                >
                  {/* Grip handle & index number */}
                  <div className="flex flex-col items-center gap-1.5 pt-0.5 shrink-0 select-none">
                    <span className="flex size-6 items-center justify-center rounded bg-zinc-900 text-xs font-mono font-bold text-white dark:bg-zinc-100 dark:text-zinc-950">
                      {idx + 1}
                    </span>
                    <div className="text-zinc-350 dark:text-zinc-700 mt-2 opacity-50 group-hover:opacity-100 transition-opacity">
                      <GripVertical className="size-4" />
                    </div>
                  </div>

                  {/* Question Content */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center justify-between text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
                      <span>{item.question.questionType} · {item.question.chapter} · {item.question.difficultyLabel}</span>
                      <span>ID: #{item.question.id}</span>
                    </div>

                    <div className="text-xs text-zinc-900 dark:text-zinc-100 leading-relaxed font-sans max-h-24 overflow-hidden text-ellipsis">
                      <MarkdownContent content={item.question.stemMarkdown} />
                    </div>

                    {/* Score and delete settings */}
                    <div className="flex items-center justify-between pt-2.5 border-t border-zinc-100 dark:border-zinc-800 mt-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-zinc-450 dark:text-zinc-550 uppercase tracking-wider">设定分值:</span>
                        <div className="flex items-center border border-zinc-200 dark:border-zinc-800 rounded bg-white dark:bg-zinc-900 px-1 py-0.5">
                          <input
                            type="number"
                            min="1"
                            max="100"
                            value={item.score}
                            onChange={(e) => handleScoreChange(idx, parseInt(e.target.value))}
                            className="w-10 border-none bg-transparent text-center font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-200 focus:ring-0 p-0 outline-none"
                          />
                          <span className="text-[9px] text-zinc-400 font-medium px-1">分</span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleRemove(item.question.id)}
                        className="p-1 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                        title="从试题篮移出"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Right Pane: Export configurations (360px wide) */}
      <aside className="w-[360px] shrink-0 border-l border-zinc-200 bg-white p-5 flex flex-col justify-between overflow-y-auto dark:border-zinc-800 dark:bg-zinc-950 text-left">
        <div className="space-y-5">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-zinc-800">
            <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-wider flex items-center gap-1.5">
              <Settings2 className="size-3.5" />
              组卷输出参数
            </span>
            <span className="text-[10px] font-mono text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
              配置参数
            </span>
          </div>

          {/* Title Config */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
              试卷大标题 (Header)
            </label>
            <input
              type="text"
              value={paperTitle}
              onChange={(e) => setPaperTitle(e.target.value)}
              className="w-full text-xs border border-zinc-200 dark:border-zinc-800 rounded bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-900 dark:focus:border-zinc-200"
              placeholder="请输入试卷标题"
            />
          </div>

          {/* Subtitle Config */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
              副标题与考试说明 (Info block)
            </label>
            <textarea
              value={paperSubtitle}
              onChange={(e) => setPaperSubtitle(e.target.value)}
              rows={2}
              className="w-full text-xs border border-zinc-200 dark:border-zinc-800 rounded bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-900 dark:focus:border-zinc-200 resize-none font-sans"
              placeholder="考试时间、分数、班级、姓名等信息栏说明"
            />
          </div>

          {/* Layout Setup - (试卷页面尺寸 has been removed) */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
              答案及解析排版
            </label>
            <select
              value={showAnswers}
              onChange={(e) => setShowAnswers(e.target.value as any)}
              className="w-full text-xs border border-zinc-200 dark:border-zinc-800 rounded bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-zinc-800 dark:text-zinc-200 outline-none cursor-pointer"
            >
              <option value="none">不显示 (仅试题卷)</option>
              <option value="answers">显示参考答案 (附卷末)</option>
              <option value="analysis">显示详尽解析 (教案版)</option>
            </select>
          </div>

          {/* Export Format */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
              输出目标格式
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setFormat('Markdown')}
                className={`flex flex-col items-center gap-1.5 p-2.5 border rounded-lg transition-colors ${
                  format === 'Markdown'
                    ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900/60 font-semibold'
                    : 'border-zinc-250 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-850'
                }`}
              >
                <FileCode2 className={`size-5 ${format === 'Markdown' ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400'}`} />
                <span className="text-[10px]">Markdown (.md)</span>
              </button>
              <button
                type="button"
                onClick={() => setFormat('PDF')}
                className={`flex flex-col items-center gap-1.5 p-2.5 border rounded-lg transition-colors ${
                  format === 'PDF'
                    ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900/60 font-semibold'
                    : 'border-zinc-250 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-850'
                }`}
              >
                <FileText className={`size-5 ${format === 'PDF' ? 'text-red-500' : 'text-zinc-400'}`} />
                <span className="text-[10px]">PDF 电子卷</span>
              </button>
              <button
                type="button"
                onClick={() => setFormat('LaTeX')}
                className={`flex flex-col items-center gap-1.5 p-2.5 border rounded-lg transition-colors ${
                  format === 'LaTeX'
                    ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900/60 font-semibold'
                    : 'border-zinc-250 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-850'
                }`}
              >
                <FileCode2 className={`size-5 ${format === 'LaTeX' ? 'text-emerald-500' : 'text-zinc-400'}`} />
                <span className="text-[10px]">LaTeX 源码</span>
              </button>
            </div>
          </div>

          {/* Paper Summary Check card */}
          <div className="border border-zinc-200 bg-zinc-50/50 p-4 rounded-lg dark:border-zinc-800 dark:bg-zinc-900/20 text-xs space-y-2">
            <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1">
              <Sparkles className="size-3 text-amber-500" />
              试卷质量审查
            </h4>
            <div className="flex items-center justify-between text-zinc-500">
              <span>试题数量:</span>
              <span className="font-bold text-zinc-850 dark:text-zinc-200">{basketItems.length} 道</span>
            </div>
            <div className="flex items-center justify-between text-zinc-500">
              <span>估算总分:</span>
              <span className="font-mono font-bold text-zinc-850 dark:text-zinc-200">{totalScore} 分</span>
            </div>
            <div className="flex items-center justify-between text-zinc-500">
              <span>公式匹配度:</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-500">100% 自动校验通过</span>
            </div>
          </div>
        </div>

        {/* Generate Button Area */}
        <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800">
          <button
            onClick={handleGenerate}
            disabled={isExporting}
            className="w-full flex items-center justify-center gap-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-50 text-xs font-semibold py-2.5 transition-colors disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 shadow-sm"
          >
            {isExporting ? (
              <>
                <RefreshCw className="size-3.5 animate-spin" />
                {exportProgress}% {exportStep}
              </>
            ) : (
              <>
                <FileDown className="size-3.5" />
                确认无误，导出试卷文档
              </>
            )}
          </button>
        </div>
      </aside>

      {/* SUCCESS DIALOG (shadcn/ui style Sheet/Dialog mockup using absolute positioning layer) */}
      {showSuccessDialog && (
        <div className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-zinc-200 dark:border-zinc-800 dark:bg-zinc-900 rounded-lg max-w-md w-full p-5 space-y-4 text-left shadow-lg">
            <div className="flex items-start gap-3">
              <div className="size-8 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <CheckCircle2 className="size-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  试卷排版生成成功
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-normal">
                  已根据你设定的排版规则完成数学试题的 LaTeX 重构和 Markdown 导出。
                </p>
              </div>
            </div>

            <div className="border border-zinc-200 bg-zinc-50 p-3 rounded dark:border-zinc-800 dark:bg-zinc-950 text-xs space-y-1.5 font-sans">
              <div className="flex justify-between">
                <span className="text-zinc-400">导出编码:</span>
                <span className="font-mono text-zinc-800 dark:text-zinc-200">{generatedId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">文档名称:</span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200 max-w-[200px] truncate">{paperTitle}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">文件格式:</span>
                <span className="font-bold text-zinc-850 dark:text-zinc-200">{format} 归档包</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">试题数量:</span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">{basketItems.length} 道题目</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  alert('试卷下载成功！已保存至系统的默认 Downloads 目录。')
                  setShowSuccessDialog(false)
                }}
                className="flex-1 inline-flex justify-center items-center gap-1 rounded bg-zinc-900 text-zinc-50 hover:bg-zinc-800 text-xs font-semibold py-2 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                下载文件
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSuccessDialog(false)
                  navigate('/mock/export-records')
                }}
                className="flex-1 inline-flex justify-center items-center gap-1 rounded border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 text-xs font-semibold py-2 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-880 transition-colors"
              >
                查看导出记录
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ZoomIn,
  ZoomOut,
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  FileImage,
  Layers,
  Save,
  Flag,
  Crop,
  X,
  Plus,
  Info,
  Check,
  RotateCcw,
  Trash2,
  HelpCircle
} from 'lucide-react'
import { MarkdownContent } from '@/components/MarkdownContent'
import { MockQuestion, INITIAL_MOCK_QUESTIONS } from './mockData'

export default function MockOcrReviewPage() {
  const navigate = useNavigate()
  const [currentIdx, setCurrentIdx] = useState(0)
  const [question, setQuestion] = useState<MockQuestion>(INITIAL_MOCK_QUESTIONS[0])
  
  // Editor state
  const [stemInput, setStemInput] = useState('')
  const [answerInput, setAnswerInput] = useState('')
  const [analysisInput, setAnalysisInput] = useState('')
  
  // Property state
  const [stage, setStage] = useState('')
  const [qType, setQType] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [chapter, setChapter] = useState('')

  // Zoom scale state for PDF slice image
  const [zoomScale, setZoomScale] = useState(1.0)
  const [activeTab, setActiveTab] = useState<'stem' | 'answer' | 'analysis' | 'metadata'>('stem')

  // Interactive Cropping states
  const [isCropMode, setIsCropMode] = useState(false)
  const [cropBox, setCropBox] = useState({ x: 35, y: 95, w: 280, h: 80 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [boxStart, setBoxStart] = useState({ x: 0, y: 0 })
  const [hasCropFigure, setHasCropFigure] = useState(false)

  // Tag Library states
  const [tagsList, setTagsList] = useState<string[]>([])
  const [isTagLibraryOpen, setIsTagLibraryOpen] = useState(false)

  // Math knowledge catalog simulation
  const KNOWLEDGE_CATALOG = [
    '函数单调性',
    '导数应用',
    '不等式恒成立',
    '棱锥的外接球',
    '空间折叠',
    '体积计算',
    '椭圆方程',
    '离心率',
    '焦点三角形',
    '正弦定理',
    '余弦定理',
    '三角恒等变换',
    '等差数列通项',
    '双曲线标准方程',
    '直线与双曲线相交'
  ]

  // Initialize fields on question change
  useEffect(() => {
    const q = INITIAL_MOCK_QUESTIONS[currentIdx]
    if (q) {
      setQuestion(q)
      setStemInput(q.stemMarkdown)
      setAnswerInput(q.answerText)
      setAnalysisInput(q.analysisMarkdown)
      setStage(q.stage)
      setQType(q.questionType)
      setDifficulty(q.difficultyLabel)
      setChapter(q.chapter)
      setTagsList(q.knowledgePoints)
      setHasCropFigure(q.hasFigures)
      setIsCropMode(false)
    }
  }, [currentIdx])

  const handleSaveAndNext = () => {
    alert(`【保存入库成功】\n题目 ID: #${question.id} 已成功校验并同步至本地 SQLite 主数据库。正在自动加载下一题。`)
    const nextIdx = (currentIdx + 1) % INITIAL_MOCK_QUESTIONS.length
    setCurrentIdx(nextIdx)
  }

  const handlePrevQuestion = () => {
    const prevIdx = (currentIdx - 1 + INITIAL_MOCK_QUESTIONS.length) % INITIAL_MOCK_QUESTIONS.length
    setCurrentIdx(prevIdx)
  }

  const checkMathUnbalanced = (text: string) => {
    let count = 0
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '$') {
        count++
      }
    }
    return count % 2 !== 0
  }

  const hasFormulaIssue = checkMathUnbalanced(stemInput) || checkMathUnbalanced(analysisInput)

  // Crop Dragging handlers
  const handlePointerDown = (e: React.PointerEvent<SVGRectElement>) => {
    e.stopPropagation()
    setIsDragging(true)
    setDragStart({ x: e.clientX, y: e.clientY })
    setBoxStart({ x: cropBox.x, y: cropBox.y })
  }

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDragging) return
    const dx = (e.clientX - dragStart.x) / zoomScale
    const dy = (e.clientY - dragStart.y) / zoomScale
    setCropBox({
      ...cropBox,
      x: Math.max(5, Math.min(345 - cropBox.w, boxStart.x + dx)),
      y: Math.max(5, Math.min(245 - cropBox.h, boxStart.y + dy))
    })
  }

  const handlePointerUp = () => {
    setIsDragging(false)
  }

  const handleConfirmCrop = () => {
    setHasCropFigure(true)
    setIsCropMode(false)
    alert('框选题图成功！已将框选区域切片并保存为题目的插图 [figure_ocr_crop.png]。')
  }

  // Tag list handlers
  const handleRemoveTag = (tagToRemove: string) => {
    setTagsList(tagsList.filter(t => t !== tagToRemove))
  }

  const handleToggleLibraryTag = (tag: string) => {
    if (tagsList.includes(tag)) {
      setTagsList(tagsList.filter(t => t !== tag))
    } else {
      setTagsList([...tagsList, tag])
    }
  }

  return (
    <div className="mock-page-root flex flex-col -mx-2 -my-2 md:-mx-4 md:-my-4 h-[calc(100vh-4.5rem)] overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-card text-card-foreground shadow-sm">
      
      {/* 1. 顶部任务 toolbar */}
      <div className="h-12 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/20 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
            <Layers className="size-3.5 text-zinc-500" />
            OCR 智能复核工作台
          </span>
          <span className="text-[10px] font-mono text-zinc-500 bg-zinc-100 border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 px-2 py-0.5 rounded font-medium">
            本地队列 ({INITIAL_MOCK_QUESTIONS.length} 题)
          </span>
        </div>

        {/* 题目切换器 */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handlePrevQuestion}
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-background text-zinc-700 hover:bg-muted dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-850 transition-colors"
            title="上一题"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 font-mono px-2">
            第 {currentIdx + 1} / {INITIAL_MOCK_QUESTIONS.length} 题
          </span>
          <button
            onClick={handleSaveAndNext}
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-background text-zinc-700 hover:bg-muted dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-850 transition-colors"
            title="下一题"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        {/* 动作区 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => alert('已重新激活本地 OCR 核心识别当前公式切图区域。')}
            className="h-8 inline-flex items-center gap-1.5 px-3 rounded-lg border border-zinc-200 bg-background text-xs font-semibold text-zinc-700 hover:bg-muted dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-850 transition-colors"
          >
            <RotateCcw className="size-3.5" />
            重新 OCR
          </button>
          <button
            onClick={() => {
              if (confirm('确定要删除这道题目吗？')) {
                alert('题目已成功从本地复核队列中移除。');
              }
            }}
            className="h-8 inline-flex items-center gap-1.5 px-3 rounded-lg border border-red-200 bg-red-50/20 text-xs font-semibold text-red-650 hover:bg-red-50 hover:text-red-700 dark:border-red-950/30 dark:bg-red-950/10 dark:text-red-400 dark:hover:bg-red-950/20 transition-colors"
          >
            <Trash2 className="size-3.5" />
            删除题目
          </button>
        </div>
      </div>
      
      {/* 2. 内部网格分栏 */}
      <div className="flex flex-1 overflow-hidden divide-x divide-zinc-200 dark:divide-zinc-800">
        
        {/* 左侧待审队列 */}
        <div className="w-56 shrink-0 flex flex-col bg-zinc-50/20 dark:bg-zinc-950/20 overflow-hidden">
          <div className="h-9 border-b border-zinc-200 dark:border-zinc-800 px-3 bg-muted/10 flex items-center justify-between text-[10px] font-bold text-zinc-500 uppercase tracking-wider shrink-0">
            待审切片列表
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 bg-muted/5">
            {INITIAL_MOCK_QUESTIONS.map((q, idx) => {
              const isActive = idx === currentIdx
              const hasFormulaErr = checkMathUnbalanced(q.stemMarkdown) || checkMathUnbalanced(q.analysisMarkdown)
              const textPreview = q.stemMarkdown.replace(/\$\$?([\s\S]*?)\$\$?/g, ' ').slice(0, 16) + '...'

              return (
                <div
                  key={q.id}
                  onClick={() => setCurrentIdx(idx)}
                  className={`relative p-2.5 rounded-lg border text-left cursor-pointer transition-all flex flex-col gap-1.5 pl-3.5 ${
                    isActive
                      ? 'bg-muted border-zinc-350 dark:border-zinc-700 font-semibold before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r before:bg-zinc-900 dark:before:bg-zinc-100'
                      : 'bg-background border-zinc-100 hover:bg-muted/30 dark:border-zinc-850 hover:border-zinc-300'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                    <span># {q.id}</span>
                    {hasFormulaErr ? (
                      <span className="border border-red-200 bg-red-50 text-red-750 px-1.5 py-0.5 rounded text-[9px] font-semibold dark:border-red-950/30 dark:bg-red-950/10 dark:text-red-400">
                        公式错
                      </span>
                    ) : (
                      <span className="border border-zinc-200 bg-zinc-50 text-zinc-500 px-1.5 py-0.5 rounded text-[9px] font-semibold dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
                        待核对
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400 h-[32px] overflow-hidden text-ellipsis line-clamp-2">
                    {textPreview}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 中间 PDF canvas */}
        <div className="flex-1 flex flex-col bg-zinc-100/40 dark:bg-zinc-900/40 overflow-hidden">
          {/* Canvas mini toolbar */}
          <div className="h-9 border-b border-zinc-200 dark:border-zinc-800 bg-background px-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-zinc-450 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1">
                <FileImage className="size-3.5" />
                第 1 / 1 页
              </span>
              <span className="h-3 w-px bg-zinc-200 dark:bg-zinc-800 mx-1" />
              <button
                onClick={() => setIsCropMode(!isCropMode)}
                className={`h-6 inline-flex items-center gap-1 px-2.5 rounded border text-[10px] font-semibold transition-colors ${
                  isCropMode
                    ? 'bg-zinc-900 border-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:border-zinc-100 dark:text-zinc-950'
                    : 'border-zinc-200 bg-background hover:bg-muted text-zinc-600 dark:border-zinc-850 dark:text-zinc-400'
                }`}
                title="在切片中拖拽框选题图"
              >
                <Crop className="size-3" />
                框选题图
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setZoomScale(Math.max(0.6, zoomScale - 0.1))}
                className="h-6 w-6 inline-flex items-center justify-center rounded border border-zinc-200 bg-background hover:bg-muted text-zinc-600 dark:border-zinc-850 dark:text-zinc-400"
                title="缩小"
              >
                <ZoomOut className="size-3" />
              </button>
              <span className="text-[10px] font-mono text-zinc-500 min-w-[32px] text-center">
                {Math.round(zoomScale * 100)}%
              </span>
              <button
                onClick={() => setZoomScale(Math.min(2.0, zoomScale + 0.1))}
                className="h-6 w-6 inline-flex items-center justify-center rounded border border-zinc-200 bg-background hover:bg-muted text-zinc-600 dark:border-zinc-850 dark:text-zinc-400"
                title="放大"
              >
                <ZoomIn className="size-3" />
              </button>
              <button
                onClick={() => setZoomScale(1.0)}
                className="h-6 px-1.5 inline-flex items-center justify-center rounded border border-zinc-200 bg-background hover:bg-muted text-[10px] font-semibold text-zinc-650 dark:border-zinc-855 dark:text-zinc-450"
                title="重置缩放"
              >
                1:1
              </button>
            </div>
          </div>

          {/* Canvas workspace area */}
          <div className="flex-1 overflow-auto p-8 flex items-center justify-center relative">
            <div
              style={{ transform: `scale(${zoomScale})`, transformOrigin: 'center center' }}
              className="transition-transform duration-700 ease-out select-none relative"
            >
              {/* PDF page block styled as a white sheet with border-shadow */}
              <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-850 shadow-sm rounded-xl p-5 w-[380px] aspect-[4/3] flex flex-col justify-between relative select-none">
                <svg
                  viewBox="0 0 350 250"
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                  className="w-full h-full bg-transparent select-none relative"
                >
                  {/* Grid guidelines */}
                  <line x1="10" y1="0" x2="10" y2="250" stroke="#f4f4f5" strokeWidth="0.5" />
                  <line x1="340" y1="0" x2="340" y2="250" stroke="#f4f4f5" strokeWidth="0.5" />
                  
                  {/* Outer dash bounding border */}
                  <rect x="5" y="10" width="340" height="220" fill="none" stroke="#27272a" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.4" />
                  
                  <text x="15" y="28" fill="#a1a1aa" fontSize="9" fontFamily="monospace" fontWeight="bold">
                    [SLICE_SOURCE_OCR_PAGE]
                  </text>
                  
                  {/* Scanned mathematics equations simulator */}
                  <text x="15" y="55" fill="#18181b" className="dark:fill-zinc-300" fontSize="11.5" fontFamily="serif" fontWeight="500">
                    已知函数 f(x) = ln(x² + 1) - ax 在区间 [1, +∞)
                  </text>
                  <text x="15" y="75" fill="#18181b" className="dark:fill-zinc-300" fontSize="11.5" fontFamily="serif" fontWeight="500">
                    上单调递增，则实数 a 的取值范围是 (  )
                  </text>
                  
                  <text x="15" y="105" fill="#18181b" className="dark:fill-zinc-300" fontSize="11" fontFamily="serif">
                    A. (-∞, 1]
                  </text>
                  <text x="15" y="125" fill="#18181b" className="dark:fill-zinc-300" fontSize="11" fontFamily="serif">
                    B. (-∞, 2]
                  </text>
                  <text x="15" y="145" fill="#18181b" className="dark:fill-zinc-300" fontSize="11" fontFamily="serif">
                    C. [1, +∞)
                  </text>
                  <text x="15" y="165" fill="#18181b" className="dark:fill-zinc-300" fontSize="11" fontFamily="serif">
                    D. [2, +∞)
                  </text>

                  {/* Figure highlight region */}
                  {hasCropFigure && (
                    <rect x="250" y="95" width="70" height="70" fill="rgba(9,9,11,0.02)" stroke="#27272a" strokeWidth="0.8" strokeDasharray="2 2" />
                  )}

                  {/* Red highlight circle on original scanned data */}
                  <ellipse cx="65" cy="52" rx="42" ry="12" fill="none" stroke="#ef4444" strokeWidth="1" strokeDasharray="2 2" />
                  <path d="M 110 50 L 155 30" fill="none" stroke="#ef4444" strokeWidth="0.8" />
                  <text x="160" y="28" fill="#ef4444" fontSize="8.5" fontWeight="bold">公式错配</text>

                  {/* Interactive Crop overlay */}
                  {isCropMode && (
                    <>
                      {/* Shaded boundaries */}
                      <rect x="0" y="0" width="350" height={cropBox.y} fill="rgba(9, 9, 11, 0.4)" />
                      <rect x="0" y={cropBox.y + cropBox.h} width="350" height={250 - (cropBox.y + cropBox.h)} fill="rgba(9, 9, 11, 0.4)" />
                      <rect x="0" y={cropBox.y} width={cropBox.x} height={cropBox.h} fill="rgba(9, 9, 11, 0.4)" />
                      <rect x={cropBox.x + cropBox.w} y={cropBox.y} width={350 - (cropBox.x + cropBox.w)} height={cropBox.h} fill="rgba(9, 9, 11, 0.4)" />

                      {/* Active highlight rect */}
                      <rect
                        x={cropBox.x}
                        y={cropBox.y}
                        width={cropBox.w}
                        height={cropBox.h}
                        fill="none"
                        stroke="#09090b"
                        strokeWidth="1.5"
                        strokeDasharray="2 2"
                        onPointerDown={handlePointerDown}
                        className="cursor-move"
                      />

                      {/* Corner nodes */}
                      <rect x={cropBox.x - 2.5} y={cropBox.y - 2.5} width="6" height="6" fill="#09090b" />
                      <rect x={cropBox.x + cropBox.w - 3.5} y={cropBox.y - 2.5} width="6" height="6" fill="#09090b" />
                      <rect x={cropBox.x - 2.5} y={cropBox.y + cropBox.h - 3.5} width="6" height="6" fill="#09090b" />
                      <rect x={cropBox.x + cropBox.w - 3.5} y={cropBox.y + cropBox.h - 3.5} width="6" height="6" fill="#09090b" />
                    </>
                  )}
                </svg>

                {/* Floating Cropper commands */}
                {isCropMode && (
                  <div className="absolute top-2 left-2 flex gap-1 bg-zinc-950 text-white rounded-md p-1 shadow-md z-40">
                    <button
                      onClick={handleConfirmCrop}
                      className="px-2 py-1 bg-zinc-800 text-[10px] rounded text-emerald-450 font-bold hover:bg-zinc-700"
                    >
                      确认切图
                    </button>
                    <button
                      onClick={() => setIsCropMode(false)}
                      className="px-2 py-1 bg-zinc-800 text-[10px] rounded text-zinc-450 hover:bg-zinc-700"
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 右侧复核编辑 panel */}
        <div className="w-[480px] shrink-0 flex flex-col bg-card overflow-hidden">
          {/* Tabs bar */}
          <div className="h-11 border-b border-zinc-200 dark:border-zinc-800 px-4 flex items-center bg-zinc-50/20 shrink-0">
            <div className="inline-flex h-8 items-center justify-start rounded-lg bg-muted p-1 text-muted-foreground w-full">
              <button
                onClick={() => setActiveTab('stem')}
                className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-semibold ring-offset-background transition-all ${
                  activeTab === 'stem'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                }`}
              >
                题干与选项
              </button>
              <button
                onClick={() => setActiveTab('answer')}
                className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-semibold ring-offset-background transition-all ${
                  activeTab === 'answer'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                }`}
              >
                参考答案
              </button>
              <button
                onClick={() => setActiveTab('analysis')}
                className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-semibold ring-offset-background transition-all ${
                  activeTab === 'analysis'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                }`}
              >
                解析步骤
              </button>
              <button
                onClick={() => setActiveTab('metadata')}
                className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-semibold ring-offset-background transition-all ${
                  activeTab === 'metadata'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                }`}
              >
                题目元数据
              </button>
            </div>
          </div>

          {/* Scrollable controls desk */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-background">
            
            {/* Editor Area inside Card */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-card text-card-foreground shadow-sm overflow-hidden">
              <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-muted/10 flex items-center justify-between">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                  {activeTab === 'stem' && '编辑题干与选项 (Markdown + $ 定界符)'}
                  {activeTab === 'answer' && '编辑参考答案'}
                  {activeTab === 'analysis' && '编辑解析步骤 (LaTeX)'}
                  {activeTab === 'metadata' && '题库标签数据关联与管理'}
                </span>
                <span className="text-[9px] font-mono text-zinc-400">
                  {activeTab !== 'metadata' && 'VITE-LATEX'}
                </span>
              </div>

              <div className="p-3">
                {activeTab === 'stem' && (
                  <textarea
                    value={stemInput}
                    onChange={(e) => setStemInput(e.target.value)}
                    className="w-full min-h-[140px] text-xs bg-transparent border-0 outline-none resize-none focus:ring-0 font-mono leading-relaxed text-zinc-900 dark:text-zinc-100"
                    placeholder="题干与选项（Markdown + $ 公式）"
                  />
                )}
                {activeTab === 'answer' && (
                  <textarea
                    value={answerInput}
                    onChange={(e) => setAnswerInput(e.target.value)}
                    className="w-full min-h-[100px] text-xs bg-transparent border-0 outline-none resize-none focus:ring-0 font-mono leading-relaxed text-zinc-900 dark:text-zinc-100"
                    placeholder="参考答案"
                  />
                )}
                {activeTab === 'analysis' && (
                  <textarea
                    value={analysisInput}
                    onChange={(e) => setAnalysisInput(e.target.value)}
                    className="w-full min-h-[140px] text-xs bg-transparent border-0 outline-none resize-none focus:ring-0 font-mono leading-relaxed text-zinc-900 dark:text-zinc-100"
                    placeholder="解析步骤（LaTeX）"
                  />
                )}
                {activeTab === 'metadata' && (
                  <div className="space-y-4 py-1 text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                          难度等级
                        </label>
                        <select
                          value={difficulty}
                          onChange={(e) => setDifficulty(e.target.value)}
                          className="w-full h-8 bg-background border border-zinc-200 dark:border-zinc-800 rounded-md px-2 font-medium text-zinc-850 dark:text-zinc-200 outline-none cursor-pointer"
                        >
                          <option value="易">易 (Easy)</option>
                          <option value="中">中 (Medium)</option>
                          <option value="难">难 (Hard)</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                          模块分类 (章节库)
                        </label>
                        <select
                          value={chapter}
                          onChange={(e) => setChapter(e.target.value)}
                          className="w-full h-8 bg-background border border-zinc-200 dark:border-zinc-800 rounded-md px-2 font-medium text-zinc-850 dark:text-zinc-200 outline-none cursor-pointer"
                        >
                          <option value="函数与导数">函数与导数</option>
                          <option value="立体几何">立体几何</option>
                          <option value="解析几何">解析几何</option>
                          <option value="三角函数与解三角形">三角函数与解三角形</option>
                          <option value="数列">数列</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                          教学学段
                        </label>
                        <select
                          value={stage}
                          onChange={(e) => setStage(e.target.value)}
                          className="w-full h-8 bg-background border border-zinc-200 dark:border-zinc-800 rounded-md px-2 font-medium text-zinc-850 dark:text-zinc-200 outline-none cursor-pointer"
                        >
                          <option value="高一上">高一上学期</option>
                          <option value="高一下">高一下学期</option>
                          <option value="高二上">高二上学期</option>
                          <option value="高二下">高二下学期</option>
                          <option value="高三一轮">高三一轮复习</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                          试卷题型
                        </label>
                        <select
                          value={qType}
                          onChange={(e) => setQType(e.target.value)}
                          className="w-full h-8 bg-background border border-zinc-200 dark:border-zinc-800 rounded-md px-2 font-medium text-zinc-850 dark:text-zinc-200 outline-none cursor-pointer"
                        >
                          <option value="单选题">单选题 (Single Choice)</option>
                          <option value="多选题">多选题 (Multiple Choice)</option>
                          <option value="填空题">填空题 (Fill in Blank)</option>
                          <option value="解答题">解答题 (Solving Question)</option>
                        </select>
                      </div>
                    </div>

                    {/* Tag list selectors */}
                    <div className="space-y-1.5 relative">
                      <label className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                        核心知识点 (调用标签库)
                      </label>
                      
                      <div className="flex flex-wrap gap-1.5 p-2 bg-zinc-50/50 border border-zinc-200 rounded-md dark:bg-zinc-900/50 dark:border-zinc-800 min-h-12 items-center">
                        {tagsList.map(tag => (
                          <span key={tag} className="inline-flex items-center gap-1 bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded text-[10px] font-semibold dark:bg-zinc-800 dark:text-zinc-300">
                            {tag}
                            <X className="size-2.5 cursor-pointer text-zinc-450 hover:text-zinc-800" onClick={() => handleRemoveTag(tag)} />
                          </span>
                        ))}
                        <button
                          type="button"
                          onClick={() => setIsTagLibraryOpen(!isTagLibraryOpen)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-dashed border-zinc-300 text-zinc-500 hover:text-zinc-800 dark:border-zinc-800 dark:hover:text-zinc-300 text-[10px] font-bold transition-colors cursor-pointer"
                        >
                          + 关联标签库
                        </button>
                      </div>

                      {/* Dropdown Catalog Popover */}
                      {isTagLibraryOpen && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-zinc-200 dark:border-zinc-800 dark:bg-zinc-900 rounded-md p-3 shadow-lg z-50 max-h-40 overflow-y-auto space-y-1.5">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 pb-1.5 border-b border-zinc-100 dark:border-zinc-800">
                            选择关联知识点
                          </p>
                          <div className="grid grid-cols-2 gap-1.5 pt-1.5">
                            {KNOWLEDGE_CATALOG.map(tag => {
                              const isSelected = tagsList.includes(tag)
                              return (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => handleToggleLibraryTag(tag)}
                                  className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] text-left border transition-all ${
                                    isSelected
                                      ? 'bg-zinc-900 border-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:border-zinc-100 dark:text-zinc-950 font-bold'
                                      : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-850 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800'
                                  }`}
                                >
                                  {isSelected ? <Check className="size-2.5 shrink-0 stroke-[3]" /> : <Plus className="size-2.5 shrink-0 text-zinc-400" />}
                                  <span className="truncate">{tag}</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Alert Indicator Area */}
            <div>
              {hasFormulaIssue ? (
                <div className="rounded-lg border border-red-200/60 bg-red-50/30 p-3 text-red-800 dark:border-red-950/30 dark:bg-red-950/10 dark:text-red-400 text-xs flex gap-2.5">
                  <AlertTriangle className="size-4 shrink-0 text-red-550 mt-0.5" />
                  <div className="space-y-0.5">
                    <span className="font-semibold block">公式检测异常</span>
                    <p className="text-[10px] text-red-750/80 leading-normal">
                      数学公式定界符 $ 未能正确闭合，可能导致渲染公式排版混乱，请手动校准匹配。
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-200/50 bg-emerald-50/20 p-3 text-emerald-800 dark:border-emerald-900/20 dark:bg-emerald-950/10 dark:text-emerald-450 text-xs flex gap-2.5">
                  <CheckCircle className="size-4 shrink-0 text-emerald-600 mt-0.5" />
                  <div className="space-y-0.5">
                    <span className="font-semibold block">排版语法校验通过</span>
                    <p className="text-[10px] text-emerald-700/80 leading-normal">
                      切图 OCR 已成功还原为规范 LaTeX 语法，未检测到公式语法异常，可以进行排版预览。
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Rendering Preview Card */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-card text-card-foreground shadow-sm overflow-hidden">
              <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-muted/10 flex items-center justify-between">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                  渲染效果实时排版 (KaTeX)
                </span>
                <HelpCircle className="size-3 text-zinc-400" />
              </div>

              <div className="p-4 bg-zinc-50/30 dark:bg-zinc-900/30 min-h-[140px] select-text text-xs leading-relaxed">
                {activeTab === 'stem' && <MarkdownContent content={stemInput} />}
                {activeTab === 'answer' && <MarkdownContent content={answerInput} />}
                {activeTab === 'analysis' && <MarkdownContent content={analysisInput} />}
                {activeTab === 'metadata' && (
                  <div className="space-y-3 text-left">
                    <p className="text-[11px] font-semibold text-zinc-500">试题元数据快照：</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10.5px]">
                      <div><span className="text-zinc-450">学段阶段:</span> <span className="font-semibold text-zinc-800 dark:text-zinc-200">{stage || '暂无'}</span></div>
                      <div><span className="text-zinc-450">题型归属:</span> <span className="font-semibold text-zinc-800 dark:text-zinc-200">{qType || '暂无'}</span></div>
                      <div><span className="text-zinc-450">难度等级:</span> <span className="font-semibold text-zinc-800 dark:text-zinc-200">{difficulty || '暂无'}</span></div>
                      <div><span className="text-zinc-450">关联章节:</span> <span className="font-semibold text-zinc-800 dark:text-zinc-200">{chapter || '暂无'}</span></div>
                    </div>
                    <div className="text-[10px] text-zinc-500 border-t border-zinc-150 dark:border-zinc-850 pt-2 flex flex-wrap gap-1 items-center">
                      <span className="text-zinc-450">知识点:</span>
                      {tagsList.length === 0 ? (
                        <span className="text-zinc-400">暂无关联标签</span>
                      ) : (
                        tagsList.map(t => (
                          <span key={t} className="bg-zinc-100 text-zinc-650 px-1.5 py-0.5 rounded text-[9.5px] font-semibold dark:bg-zinc-800 dark:text-zinc-400">
                            {t}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>

      </div>

      {/* 3. 底部固定 action bar */}
      <div className="h-14 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/20 px-6 flex items-center justify-between shrink-0">
        <div>
          <button
            onClick={() => alert('已将当前问题标记为【待补充图表】并挂起。')}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-background text-xs font-semibold text-zinc-600 hover:bg-muted dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-850 h-9 px-3.5 transition-colors"
            type="button"
          >
            <Flag className="size-3.5" />
            标记问题
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => alert('草稿已暂存至本地缓存。')}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-background text-xs font-semibold text-zinc-700 hover:bg-muted dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-850 h-9 px-4 transition-colors"
            type="button"
          >
            <Save className="size-3.5" />
            暂存草稿
          </button>

          <button
            onClick={handleSaveAndNext}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 text-zinc-50 hover:bg-zinc-800 text-xs font-bold h-9 px-4.5 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors shadow-sm"
            type="button"
          >
            保存并下一题
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

    </div>
  )
}

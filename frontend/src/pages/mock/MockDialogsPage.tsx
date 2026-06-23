import { useState } from 'react'
import {
  Layers,
  Scissors,
  Crop,
  CheckCircle2,
  Trash2,
  Plus,
  Combine,
  Split,
  Save,
  Play,
  RotateCcw,
  X,
  FileJson,
  Check,
  AlertTriangle,
  ChevronRight,
  Maximize2
} from 'lucide-react'

// Slice Review Mock Interfaces
interface MockSliceItem {
  id: string
  label: string
  page: number
  status: 'pending' | 'approved'
  height: string
  previewText: string
}

export default function MockDialogsPage() {
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [showCropModal, setShowCropModal] = useState(false)
  const [toastMessage, setToastMessage] = useState('')

  const triggerToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(''), 2500)
  }

  // === Modal 1: 切题复核 States ===
  const [sliceItems, setSliceItems] = useState<MockSliceItem[]>([
    { id: 's1', label: '1', page: 1, status: 'approved', height: '140px', previewText: '1. 下列关于细胞内化学元素的叙述，正确的是...' },
    { id: 's2', label: '2', page: 1, status: 'pending', height: '180px', previewText: '2. 如图所示，在倾角为 θ 的光滑斜面上，质量为 m 的小球...' },
    { id: 's3', label: '3', page: 2, status: 'pending', height: '160px', previewText: '3. 已知常温下 0.1 mol/L 的某一元弱酸 HA 溶液的 pH 为...' },
    { id: 's4', label: '4-stem', page: 2, status: 'pending', height: '120px', previewText: '4. (题干) 如图，在正四棱柱 ABCD-A1B1C1D1 中，E, F 分别是...' },
    { id: 's5', label: '4-options', page: 2, status: 'pending', height: '130px', previewText: 'A. AE ∥ CF  B. 平面 AEF ∥ 平面 C1D1  C. 异面直线...' },
    { id: 's6', label: '5', page: 3, status: 'pending', height: '220px', previewText: '5. 双缝干涉实验装置如图所示，若双缝之间的距离为 d...' }
  ])
  const [selectedSlices, setSelectedSlices] = useState<Set<string>>(new Set(['s2', 's3']))
  const [activeSliceId, setActiveSliceId] = useState('s2')
  const [editingLabel, setEditingLabel] = useState('2')
  const [splitActive, setSplitActive] = useState(false)
  const [splitY, setSplitY] = useState(55) // Percent down the image

  const activeSlice = sliceItems.find(s => s.id === activeSliceId) || sliceItems[0]

  // === Modal 2: 框选题图 States ===
  const [cropUsage, setCropUsage] = useState<'stem' | 'analysis' | 'option_a' | 'option_b'>('stem')
  const [croppedFigures, setCroppedFigures] = useState([
    { id: 'f1', type: 'stem', label: '题干插图 (fig_stem_0.png)', size: '240 × 160' },
    { id: 'f2', type: 'analysis', label: '解析示意图 (fig_analysis_1.png)', size: '320 × 200' }
  ])
  const [activeCropId, setActiveCropId] = useState<string | null>(null)
  const [cropBox, setCropBox] = useState({ x: 25, y: 30, w: 40, h: 35 }) // Percentage coordinates

  // Select Slice helper
  const toggleSelectSlice = (id: string) => {
    const next = new Set(selectedSlices)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setSelectedSlices(next)
  }

  // Merge selected helper
  const handleMergeSlices = () => {
    if (selectedSlices.size < 2) {
      triggerToast('请在左侧列表至少勾选 2 个切题进行合并')
      return
    }
    const mergeList = sliceItems.filter(s => selectedSlices.has(s.id))
    const firstItem = mergeList[0]
    const otherIds = new Set(mergeList.slice(1).map(s => s.id))
    
    // Create new merged items list
    const newItems = sliceItems.filter(s => !otherIds.has(s.id)).map(s => {
      if (s.id === firstItem.id) {
        return {
          ...s,
          label: `${s.label}-合并`,
          previewText: `${s.previewText} (已合并多个切片块)`
        }
      }
      return s
    })

    setSliceItems(newItems)
    setSelectedSlices(new Set())
    triggerToast(`成功将 ${mergeList.length} 个题块合并为 [${firstItem.label}-合并]`)
  }

  // Delete helper
  const handleDeleteSlices = () => {
    if (selectedSlices.size === 0) {
      triggerToast('请先勾选需要删除的切片')
      return
    }
    if (confirm(`确定要丢弃已勾选的 ${selectedSlices.size} 个题块切片吗？`)) {
      setSliceItems(sliceItems.filter(s => !selectedSlices.has(s.id)))
      setSelectedSlices(new Set())
      triggerToast('已丢弃指定题块切片')
    }
  }

  // Split helper
  const handleSplitSlice = () => {
    const target = sliceItems.find(s => s.id === activeSliceId)
    if (!target) return
    const index = sliceItems.findIndex(s => s.id === activeSliceId)
    
    const sliceA: MockSliceItem = {
      id: `${target.id}_a`,
      label: `${target.label}a`,
      page: target.page,
      status: 'pending',
      height: '90px',
      previewText: `[拆分上半部] ${target.previewText.substring(0, 20)}...`
    }
    const sliceB: MockSliceItem = {
      id: `${target.id}_b`,
      label: `${target.label}b`,
      page: target.page,
      status: 'pending',
      height: '90px',
      previewText: `[拆分下半部] 图形及次级内容项...`
    }

    const nextItems = [...sliceItems]
    nextItems.splice(index, 1, sliceA, sliceB)
    setSliceItems(nextItems)
    setActiveSliceId(sliceA.id)
    setSplitActive(false)
    triggerToast(`成功将题块 [${target.label}] 从 Y=${splitY}% 处拆分为 a/b 两部分`)
  }

  // Save Crop helper
  const handleAddCropFigure = () => {
    const usageLabels = {
      stem: '题干插图',
      analysis: '解析插图',
      option_a: '选项 A 插图',
      option_b: '选项 B 插图'
    }
    const newFig = {
      id: Math.random().toString(),
      type: cropUsage,
      label: `${usageLabels[cropUsage]} (crop_${Math.round(Math.random()*100)}.png)`,
      size: `${Math.round(cropBox.w * 8)} × ${Math.round(cropBox.h * 6)}`
    }
    setCroppedFigures([...croppedFigures, newFig])
    triggerToast(`已截取选区并保存为 ${usageLabels[cropUsage]}`)
  }

  return (
    <div className="mock-page-root flex flex-col gap-6 p-6 min-h-[calc(100vh-6rem)] overflow-y-auto bg-zinc-50/10 dark:bg-zinc-950/20 text-zinc-950 dark:text-zinc-50 select-none">
      
      {/* Page Header */}
      <div className="flex flex-col gap-1 border-b border-zinc-200 dark:border-zinc-800 pb-4 text-left">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">弹窗与工作流 Mock</h1>
        <p className="text-[13px] text-zinc-500 dark:text-zinc-400">本页面用于触发和评审复杂弹窗交互。以下弹窗完全沿用 shadcn 极简规范设计，用于细粒度的人工介入确认。</p>
      </div>

      {/* Grid Menu to Trigger Modals */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
        
        {/* Module 1 */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-zinc-100 dark:bg-zinc-900 rounded-lg text-zinc-800 dark:text-zinc-200">
              <Scissors className="size-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">切题批次人工复核 (Slice Review)</h3>
              <p className="text-xs text-zinc-450 dark:text-zinc-500">用于上传 PDF 切片后，人工确认题块边界、拆分误判题目或合并跨页题块。</p>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-zinc-500">复核器支持一键切换选中项、快速修改题号、图形分割线定位拖拽，并允许批量合并/丢弃。</p>
          <button
            onClick={() => setShowReviewModal(true)}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-850 text-zinc-50 text-xs font-semibold py-2.5 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 cursor-pointer"
          >
            打开切题复核弹窗
          </button>
        </div>

        {/* Module 2 */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-zinc-100 dark:bg-zinc-900 rounded-lg text-zinc-800 dark:text-zinc-200">
              <Crop className="size-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">题库几何插图框选 (Crop Figures)</h3>
              <p className="text-xs text-zinc-450 dark:text-zinc-500">支持在数学或理化题目的切片原图上进行自由框选，提取出插图插入到题干或选项中。</p>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-zinc-500">框选器内置比例换算校准，可为题干、解析及选择题 A/B/C/D 选项定制对应的截图插图文件。</p>
          <button
            onClick={() => setShowCropModal(true)}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-850 text-zinc-50 text-xs font-semibold py-2.5 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 cursor-pointer"
          >
            打开框选题图弹窗
          </button>
        </div>

      </div>

      {/* ========================================================================= */}
      {/* DIALOG 1: 切题复核弹窗 (SliceReviewDialog Mock) */}
      {/* ========================================================================= */}
      {showReviewModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none">
          <div className="w-full max-w-6xl h-[90vh] rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950 flex flex-col overflow-hidden animate-fade-in text-left">
            
            {/* Modal Header */}
            <div className="px-5 py-3.5 bg-zinc-50/70 border-b border-zinc-150 dark:bg-zinc-900/10 dark:border-zinc-850 flex items-center justify-between">
              <div>
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">切题人工复核控制台</span>
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500 block mt-0.5">
                  来源：2026年高考理综物理全国甲卷.pdf · 共 {sliceItems.length} 个题块 · 当前选中 {selectedSlices.size} 项
                </span>
              </div>
              <button 
                onClick={() => setShowReviewModal(false)}
                className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-850 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="size-4.5" />
              </button>
            </div>

            {/* Modal Workspace Splitter */}
            <div className="flex-1 min-h-0 flex overflow-hidden">
              
              {/* Left Column: Slices List */}
              <div className="w-80 shrink-0 border-r border-zinc-150 dark:border-zinc-850 flex flex-col bg-zinc-50/20">
                <div className="p-3 border-b border-zinc-150 dark:border-zinc-850 flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">切片队列</span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setSelectedSlices(new Set(sliceItems.map(s => s.id)))}
                      className="text-[10px] font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
                    >
                      全选
                    </button>
                    <span className="text-zinc-200">|</span>
                    <button
                      onClick={() => setSelectedSlices(new Set())}
                      className="text-[10px] font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
                    >
                      清空
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-900 p-2 space-y-1">
                  {sliceItems.map((item) => {
                    const isSelected = selectedSlices.has(item.id)
                    const isActive = item.id === activeSliceId
                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          setActiveSliceId(item.id)
                          setEditingLabel(item.label)
                        }}
                        className={`flex gap-2.5 p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                          isActive
                            ? 'border-zinc-900 bg-zinc-50/80 dark:border-zinc-100 dark:bg-zinc-900/60'
                            : 'border-zinc-100/50 bg-white hover:bg-zinc-50 dark:border-zinc-900 dark:bg-zinc-950'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectSlice(item.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5 cursor-pointer accent-zinc-950 dark:accent-zinc-50"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                              题号 {item.label}
                            </span>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-zinc-400 font-mono">P{item.page}</span>
                              <span className={`inline-flex items-center rounded px-1 py-0.5 text-[9px] font-medium border ${
                                item.status === 'approved'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30'
                                  : 'bg-amber-50 text-amber-700 border-amber-200/50 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30'
                              }`}>
                                {item.status === 'approved' ? '已通过' : '待复核'}
                              </span>
                            </div>
                          </div>
                          <p className="text-[11px] text-zinc-450 dark:text-zinc-500 truncate mt-1">
                            {item.previewText}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Batch Ops Footer */}
                <div className="p-3 border-t border-zinc-150 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10 flex gap-2">
                  <button
                    onClick={handleMergeSlices}
                    disabled={selectedSlices.size < 2}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded border border-zinc-200 bg-white hover:bg-zinc-50 py-1.5 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Combine className="size-3.5" />
                    合并 ({selectedSlices.size})
                  </button>
                  <button
                    onClick={handleDeleteSlices}
                    disabled={selectedSlices.size === 0}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded border border-red-200 bg-red-50/20 hover:bg-red-50/50 py-1.5 text-xs text-red-700 dark:border-red-950/30 dark:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="size-3.5" />
                    丢弃 ({selectedSlices.size})
                  </button>
                </div>
              </div>

              {/* Middle Area: Slice Image & Splitting Controller */}
              <div className="flex-1 flex flex-col min-w-0 bg-zinc-100 dark:bg-zinc-900">
                <div className="p-3.5 bg-zinc-50/50 border-b border-zinc-150 dark:border-zinc-850 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-zinc-500">当前预览：</span>
                    <span className="text-xs font-bold text-zinc-900 dark:text-zinc-50">
                      题号 [ {activeSlice.label} ] · 页面 P{activeSlice.page}
                    </span>
                  </div>
                  <button
                    onClick={() => setSplitActive(!splitActive)}
                    className={`inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-semibold ${
                      splitActive
                        ? 'border-zinc-900 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950'
                        : 'border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-350'
                    }`}
                  >
                    <Split className="size-3.5" />
                    {splitActive ? '取消拆分' : '在此处拆分题块'}
                  </button>
                </div>

                <div className="flex-1 overflow-auto p-4 flex items-center justify-center relative">
                  
                  {/* Mock Question Slice Box */}
                  <div className="relative w-full max-w-lg border border-zinc-200 bg-white p-6 shadow-sm rounded-lg text-left font-serif min-h-[300px]">
                    
                    {/* Visual watermark */}
                    <div className="absolute top-2 right-3 font-mono text-[9px] text-zinc-300 select-none">
                      RUN_BATCH_SLICE_2026_06
                    </div>

                    {/* Question Content Mock */}
                    <div className="space-y-4 text-zinc-800">
                      <span className="inline-block bg-zinc-100 px-1.5 py-0.5 rounded font-mono text-xs text-zinc-500 mr-1 font-semibold not-italic">
                        No. {activeSlice.label}
                      </span>
                      <p className="text-xs leading-relaxed text-zinc-900">
                        {activeSlice.label}. 如图所示，在倾角为 \(\theta\) 的光滑斜面上，放置一个质量为 \(m\) 的均匀小球。在挡板 AB 作用下小球处于静止状态。若将挡板由水平位置顺时针缓慢转动到与斜面垂直的位置，则小球对斜面的压力：
                      </p>
                      
                      {/* Geometry physics drawing mockup */}
                      <div className="mx-auto w-48 h-32 border border-zinc-100 rounded bg-zinc-50/50 flex items-center justify-center relative">
                        <svg className="size-full stroke-zinc-400 stroke-1 fill-none" viewBox="0 0 100 60">
                          {/* Triangle Slope */}
                          <path d="M 10 50 L 90 50 L 90 10 Z" className="stroke-zinc-400" />
                          <text x="75" y="45" className="fill-zinc-400 font-sans text-[6px]">θ</text>
                          {/* Sphere */}
                          <circle cx="50" cy="30" r="12" className="stroke-zinc-900 stroke-1.5 fill-zinc-100" />
                          <circle cx="50" cy="30" r="1" className="fill-zinc-900" />
                          {/* Block */}
                          <line x1="32" y1="20" x2="68" y2="40" className="stroke-zinc-950 stroke-1.5" />
                        </svg>
                        <span className="absolute bottom-1 right-2 text-[8px] font-mono text-zinc-300">图. 物理学重力模型</span>
                      </div>

                      <p className="text-xs leading-relaxed text-zinc-800">
                        A. 一直增大  &nbsp;&nbsp; B. 一直减小 &nbsp;&nbsp; C. 先增大后减小 &nbsp;&nbsp; D. 先减小后增大
                      </p>
                    </div>

                    {/* Bounding box outline */}
                    <div className="absolute inset-0 border-2 border-dashed border-zinc-350 pointer-events-none rounded-lg" />
                    
                    {/* Draggable/Configurable split line overlay */}
                    {splitActive && (
                      <div 
                        className="absolute left-0 right-0 h-1 bg-red-500 cursor-row-resize flex items-center justify-center z-10"
                        style={{ top: `${splitY}%` }}
                      >
                        <div className="absolute bg-red-500 text-white font-mono text-[9px] px-2 py-0.5 rounded shadow-sm flex items-center gap-1">
                          <span>拆分线 (Y={splitY}%)</span>
                          <span className="opacity-50">上下拖拽</span>
                        </div>
                        {/* Fake drag handles */}
                        <div className="absolute left-3 size-2 bg-red-500 rounded-full border border-white" />
                        <div className="absolute right-3 size-2 bg-red-500 rounded-full border border-white" />
                      </div>
                    )}
                  </div>

                  {/* Split Confirm Dialog Banner Overlay */}
                  {splitActive && (
                    <div className="absolute bottom-6 left-6 right-6 bg-white text-zinc-900 border border-zinc-200 rounded-lg p-3.5 shadow-lg flex items-center justify-between text-xs dark:bg-zinc-950 dark:text-white dark:border-zinc-800">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="size-4 text-amber-500 shrink-0" />
                        <span>在此分割线处将当前切片拆分为两道独立的题目？</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setSplitActive(false)}
                          className="bg-transparent border border-zinc-200 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900 px-3 py-1.5 rounded text-xs font-semibold text-zinc-600 dark:text-zinc-300 cursor-pointer"
                        >
                          取消
                        </button>
                        <button
                          onClick={handleSplitSlice}
                          className="bg-red-650 hover:bg-red-700 text-white px-3.5 py-1.5 rounded text-xs font-semibold cursor-pointer"
                        >
                          确认拆分
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Attribute Review Panel */}
              <div className="w-80 shrink-0 border-l border-zinc-150 dark:border-zinc-850 flex flex-col">
                <div className="p-4 border-b border-zinc-150 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">复核配置属性</h4>
                  <p className="text-[10px] text-zinc-400 mt-1">校对当前所选题目在切片中的映射设置，按需修剪或手动覆盖属性。</p>
                </div>

                <div className="flex-1 p-4 space-y-4 overflow-y-auto">
                  
                  {/* Option inputs */}
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">映射题号 (Question Label)</label>
                    <input
                      type="text"
                      value={editingLabel}
                      onChange={(e) => {
                        setEditingLabel(e.target.value)
                        setSliceItems(sliceItems.map(s => s.id === activeSlice.id ? { ...s, label: e.target.value } : s))
                      }}
                      className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">题目类型 (Kind)</label>
                    <select className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm outline-none cursor-pointer">
                      <option value="single">单项选择题</option>
                      <option value="multiple">多项选择题</option>
                      <option value="fill">填空题</option>
                      <option value="calculation">解答计算题</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">所属页面范围</label>
                    <input
                      type="text"
                      disabled
                      value={`第 ${activeSlice.page} 页`}
                      className="w-full rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-450 dark:border-zinc-800 dark:bg-zinc-900 font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">切片高度</label>
                    <input
                      type="text"
                      disabled
                      value={activeSlice.height}
                      className="w-full rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-450 dark:border-zinc-800 dark:bg-zinc-900 font-mono"
                    />
                  </div>

                  {/* Suspect warnings */}
                  <div className="rounded-lg border border-amber-250 bg-amber-50/30 p-3 text-[11px] text-amber-800 space-y-1 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300 leading-normal">
                    <div className="flex items-center gap-1.5 font-bold">
                      <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-450" />
                      <span>OCR 切题提醒</span>
                    </div>
                    <p>检测到该区域包含 1 个几何插图，稍后完成复核在录入题库时需注意框选。题号前可能存在 1 处微弱墨迹误判。</p>
                  </div>
                </div>

                {/* Submissions Action Area */}
                <div className="p-4 border-t border-zinc-150 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10 space-y-2.5">
                  <button
                    onClick={() => {
                      setSliceItems(sliceItems.map(s => s.id === activeSlice.id ? { ...s, status: 'approved' } : s))
                      triggerToast(`题块 [${activeSlice.label}] 已标记复核通过`)
                    }}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 py-2 text-xs font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 cursor-pointer"
                  >
                    <Check className="size-4 text-emerald-500" />
                    标记此题复核通过
                  </button>

                  <button
                    onClick={() => {
                      setShowReviewModal(false)
                      triggerToast('复核信息已提交保存，正在跳转至 JSON 校验导入')
                    }}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 py-2 text-xs font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 cursor-pointer"
                  >
                    <FileJson className="size-4" />
                    仅保存并手动导入
                  </button>

                  <button
                    onClick={() => {
                      setShowReviewModal(false)
                      triggerToast('已开始执行大模型批量 OCR 公式识别任务')
                    }}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-blue-950 hover:bg-blue-900 text-white py-2.5 text-xs font-semibold dark:bg-blue-900 dark:hover:bg-blue-800 cursor-pointer"
                  >
                    <CheckCircle2 className="size-4 text-emerald-500" />
                    确认提交并开始 OCR 任务
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DIALOG 2: 框选题图弹窗 (FigureCropDialog Mock) */}
      {/* ========================================================================= */}
      {showCropModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none animate-fade-in">
          <div className="w-full max-w-5xl h-[85vh] rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950 flex flex-col overflow-hidden text-left">
            
            {/* Header */}
            <div className="px-5 py-3.5 bg-zinc-50/70 border-b border-zinc-150 dark:bg-zinc-900/10 dark:border-zinc-850 flex items-center justify-between">
              <div>
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">框选题图</span>
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500 block mt-0.5">
                  从当前题目的切片原图里框选图形，提取并另存为 stem（题干）或 analysis（解析）等插图资源。
                </span>
              </div>
              <button 
                onClick={() => setShowCropModal(false)}
                className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-850 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="size-4.5" />
              </button>
            </div>

            {/* Splitter Panel */}
            <div className="flex-1 min-h-0 flex overflow-hidden">
              
              {/* Left/Center: Bounding Box drawing canvas */}
              <div className="flex-1 bg-zinc-150 dark:bg-zinc-900/60 p-4 overflow-auto flex items-center justify-center relative">
                
                {/* Simulated drawing canvas area */}
                <div 
                  className="relative cursor-crosshair border border-zinc-300 bg-zinc-50 p-4 rounded-xl shadow-xs"
                  style={{ width: '460px', height: '360px' }}
                >
                  <span className="absolute top-2 left-2 text-[9px] text-zinc-400 select-none">
                    切片原图分辨率: 960 × 720
                  </span>

                  {/* Math Drawing inside canvas */}
                  <div className="w-full h-full border border-dashed border-zinc-250 bg-white rounded-lg flex items-center justify-center relative">
                    <svg className="w-80 h-60 stroke-zinc-400 stroke-1.5 fill-none" viewBox="0 0 100 80">
                      {/* Grid background */}
                      <path d="M 0 10 H 100 M 0 20 H 100 M 0 30 H 100 M 0 40 H 100 M 0 50 H 100 M 0 60 H 100 M 0 70 H 100" className="stroke-zinc-100" />
                      <path d="M 10 0 V 80 M 20 0 V 80 M 30 0 V 80 M 40 0 V 80 M 50 0 V 80 M 60 0 V 80 M 70 0 V 80 M 80 0 V 80 M 90 0 V 80" className="stroke-zinc-100" />
                      {/* Triangle */}
                      <path d="M 30 20 L 75 20 L 50 65 Z" className="stroke-zinc-700 stroke-2" />
                      {/* Inscribed Circle */}
                      <circle cx="51.6" cy="35" r="15" className="stroke-zinc-900" />
                      {/* Triangle labels */}
                      <text x="25" y="18" className="fill-zinc-800 font-sans text-xs">A</text>
                      <text x="78" y="18" className="fill-zinc-800 font-sans text-xs">B</text>
                      <text x="48" y="75" className="fill-zinc-800 font-sans text-xs">C</text>
                      <text x="50" y="38" className="fill-zinc-500 font-sans text-[10px]">O</text>
                    </svg>

                    {/* Mask filter representing drag selection */}
                    <div className="absolute inset-0 bg-black/15 pointer-events-none" />

                    {/* Active crop box bounding selection */}
                    <div 
                      className="absolute border-2 border-red-500 bg-rose-50/40 cursor-move rounded"
                      style={{
                        left: `${cropBox.x}%`,
                        top: `${cropBox.y}%`,
                        width: `${cropBox.w}%`,
                        height: `${cropBox.h}%`
                      }}
                    >
                      {/* Selection label */}
                      <div className="absolute -top-6 left-0 bg-red-650 text-white font-mono text-[9px] px-2 py-0.5 rounded shadow-sm">
                        选区 240 × 180
                      </div>

                      {/* Resize handles */}
                      <div className="absolute -top-1.5 -left-1.5 size-3 rounded-full border-2 border-red-500 bg-white" />
                      <div className="absolute -top-1.5 -right-1.5 size-3 rounded-full border-2 border-red-500 bg-white" />
                      <div className="absolute -bottom-1.5 -left-1.5 size-3 rounded-full border-2 border-red-500 bg-white" />
                      <div className="absolute -bottom-1.5 -right-1.5 size-3 rounded-full border-2 border-red-500 bg-white" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Panel: Options & List of figures */}
              <div className="w-80 shrink-0 border-l border-zinc-150 dark:border-zinc-850 flex flex-col bg-zinc-50/20">
                <div className="p-4 border-b border-zinc-150 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10">
                  <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider block">截图插图提取</span>
                  <p className="text-[10px] text-zinc-400 mt-1">设置选区插图存储路径与用途属性。</p>
                </div>

                <div className="flex-1 p-4 space-y-4 overflow-y-auto">
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">保存为图片用途</label>
                    <select
                      value={cropUsage}
                      onChange={(e) => setCropUsage(e.target.value as any)}
                      className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm outline-none cursor-pointer"
                    >
                      <option value="stem">题干插图 (Stem Figure)</option>
                      <option value="analysis">解析说明插图 (Analysis Figure)</option>
                      <option value="option_a">选项 A 选项图 (Option A)</option>
                      <option value="option_b">选项 B 选项图 (Option B)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <button
                      onClick={handleAddCropFigure}
                      className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-850 text-white py-2 text-xs font-semibold dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 cursor-pointer"
                    >
                      <Plus className="size-4" />
                      确认截取当前选区
                    </button>
                    
                    <button
                      onClick={() => setCropBox({ x: 20, y: 20, w: 60, h: 50 })}
                      className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 py-1.5 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 cursor-pointer"
                    >
                      <RotateCcw className="size-3.5" />
                      重置选区中心
                    </button>
                  </div>

                  {/* List of figures already cropped */}
                  <div className="space-y-2 border-t border-zinc-100 dark:border-zinc-800 pt-4">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">已录入题图 ({croppedFigures.length})</span>
                      <button
                        onClick={() => {
                          setCroppedFigures([])
                          triggerToast('已清空全部题图截图。')
                        }}
                        className="text-[10px] text-zinc-450 hover:text-red-500 transition-colors"
                      >
                        清空所有
                      </button>
                    </div>

                    <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
                      {croppedFigures.map((fig) => (
                        <div
                          key={fig.id}
                          className="flex items-center justify-between border border-zinc-150 bg-white dark:border-zinc-900 dark:bg-zinc-950/40 rounded-lg p-2 hover:bg-zinc-50/50"
                        >
                          <div className="min-w-0">
                            <span className="block text-[11px] font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                              {fig.label}
                            </span>
                            <span className="block text-[9px] text-zinc-400 font-mono mt-0.5">
                              分辨率: {fig.size}
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              setCroppedFigures(croppedFigures.filter(f => f.id !== fig.id))
                              triggerToast('题图截图已移除')
                            }}
                            className="p-1 text-zinc-400 hover:text-red-500 rounded"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-zinc-150 dark:border-zinc-855 bg-zinc-50/50 dark:bg-zinc-900/10 flex justify-end">
                  <button
                    onClick={() => setShowCropModal(false)}
                    className="inline-flex items-center gap-1.5 rounded bg-zinc-950 hover:bg-zinc-850 text-zinc-50 text-xs font-semibold px-4 py-2 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
                  >
                    完成题图确认
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SAVE TOAST FEEDBACK BANNERS */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-zinc-950 border border-zinc-800 rounded-md px-3.5 py-2.5 flex items-center gap-2.5 z-50 text-zinc-50 shadow-lg text-xs animate-fade-in dark:bg-zinc-50 dark:border-zinc-200 dark:text-zinc-950">
          <CheckCircle2 className="size-4.5 text-emerald-500 shrink-0" />
          <div className="space-y-0.5 text-left">
            <span className="font-bold block">操作反馈</span>
            <span className="text-[10px] text-zinc-450 dark:text-zinc-550 block">{toastMessage}</span>
          </div>
        </div>
      )}

    </div>
  )
}

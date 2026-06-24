import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Plus,
  Save,
  Trash2,
  AlertTriangle,
  Layers,
  BookOpen,
  FileText,
  LoaderCircle,
  HelpCircle
} from 'lucide-react'
import { importV2Api } from '@/api/importV2'
import { pdfSlicerApi } from '@/api/pdfSlicer'
import { Button, Badge } from '@/components/ui'
import { BBoxCanvas, type BBoxCanvasBox } from '@/components/questions/BBoxCanvas'
import type { BBox } from '@/types'

interface Segment {
  page: number
  x: number
  y: number
  width: number
  height: number
}

interface Region {
  id: string
  sourceRunId: string
  kind: 'question' | 'solution' | 'shared_answer_key'
  questionLabel: string
  questionKeys?: string[]
  segments: Segment[]
  sortOrder: number
  note: string
}

function createRegionId() {
  return `reg_${globalThis.crypto.randomUUID()}`
}

export default function CandidateFixWorkbenchPage() {
  const { candidateId } = useParams<{ candidateId: string }>()
  const [searchParams] = useSearchParams()
  const sourceDocumentIdFromQuery = searchParams.get('sourceDocumentId') || ''
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [candidate, setCandidate] = useState<any>(null)
  const [session, setSession] = useState<any>(null)

  // Markdown Texts
  const [stemMarkdown, setStemMarkdown] = useState('')
  const [analysisMarkdown, setAnalysisMarkdown] = useState('')

  // Annotation Region state
  const [regions, setRegions] = useState<Region[]>([])
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)

  // PDF Page navigation
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [maxPages, setMaxPages] = useState<number>(1)
  const [pdfName, setPdfName] = useState('')

  // Canvas interaction
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  const [viewportWidth, setViewportWidth] = useState(0)
  const [rect, setRect] = useState<BBox>({ x: 0, y: 0, width: 0, height: 0 })

  const imageRef = useRef<HTMLImageElement | null>(null)

  // Load candidate and restore manual-fix session
  useEffect(() => {
    if (!candidateId) return
    loadCandidateAndSession()
  }, [candidateId])

  async function loadCandidateAndSession() {
    try {
      setLoading(true)
      // 1. 获取 Candidate 信息
      const data = await importV2Api.listCandidates(sourceDocumentIdFromQuery)
      const currentCandidate = data.items.find(item => item.id === candidateId)
      if (!currentCandidate) {
        throw new Error('未找到当前候选题目。')
      }
      setCandidate(currentCandidate)
      setStemMarkdown(currentCandidate.stemMarkdown || '')
      setAnalysisMarkdown(currentCandidate.analysisMarkdown || '')

      // 2. 创建或恢复修正 Session
      const sess = await importV2Api.createManualFixSession(candidateId)
      setSession(sess)
      setRegions(sess.regions || [])

      // 3. 从 Session Profile 里获取 PDF 基本信息
      const profile = JSON.parse(sess.sourceProfileJson || '{}')[currentCandidate.sourceDocumentId] || {}
      setMaxPages(profile.pageCount || 1)
      setPdfName(profile.pdfName || '原始 PDF 文件')

      // 4. 默认跳到第一个有标注的页面或第一页
      const firstReg = (sess.regions || []).find((r: any) => r.segments && r.segments.length > 0)
      if (firstReg && firstReg.segments[0]) {
        setCurrentPage(firstReg.segments[0].page)
      } else {
        setCurrentPage(1)
      }
    } catch (err) {
      console.error(err)
      window.alert('加载手动修正会话失败：' + (err instanceof Error ? err.message : String(err)))
      navigateBack()
    } finally {
      setLoading(false)
    }
  }

  function navigateBack() {
    if (sourceDocumentIdFromQuery) {
      navigate(`/tools/import?sourceDocumentId=${encodeURIComponent(sourceDocumentIdFromQuery)}`)
    } else {
      navigate('/tools/import')
    }
  }

  // Double columns layout helper
  function imageSize() {
    const bounds = imageRef.current?.getBoundingClientRect()
    return bounds ? { width: bounds.width, height: bounds.height } : { width: 0, height: 0 }
  }

  // Map absolute Display Rect (in pixels) to Relative Segment (%)
  function displayRectToSegment(displayRect: BBox, imgSize: { width: number; height: number }): Segment | null {
    if (imgSize.width <= 0 || imgSize.height <= 0 || displayRect.width <= 3 || displayRect.height <= 3) {
      return null
    }
    return {
      page: currentPage,
      x: displayRect.x / imgSize.width,
      y: displayRect.y / imgSize.height,
      width: displayRect.width / imgSize.width,
      height: displayRect.height / imgSize.height
    }
  }

  // Map Relative Segment (%) to absolute Display Rect (in pixels)
  function segmentToDisplayRect(segment: Segment, imgSize: { width: number; height: number }): BBox | null {
    if (imgSize.width <= 0 || imgSize.height <= 0) return null
    return {
      x: segment.x * imgSize.width,
      y: segment.y * imgSize.height,
      width: segment.width * imgSize.width,
      height: segment.height * imgSize.height
    }
  }

  // Handlers for BBox Selection
  const handleSelectBoxId = (boxId: string) => {
    if (!boxId) {
      setSelectedRegionId(null)
      setRect({ x: 0, y: 0, width: 0, height: 0 })
      return
    }
    const idx = parseInt(boxId, 10)
    const region = regions[idx]
    if (region) {
      setSelectedRegionId(region.id)
      const seg = region.segments[0]
      if (seg) {
        setCurrentPage(seg.page)
        const displayRect = segmentToDisplayRect(seg, imageSize())
        if (displayRect) setRect(displayRect)
      }
    }
  }

  // Handlers for drawing/updating boxes
  const handleRectChange = (newRect: BBox) => {
    setRect(newRect)
    if (!selectedRegionId) return

    // Auto update selected region's segment
    const imgSize = imageSize()
    const segment = displayRectToSegment(newRect, imgSize)
    if (segment) {
      setRegions(current => current.map(r => {
        if (r.id === selectedRegionId) {
          return { ...r, segments: [segment] }
        }
        return r
      }))
    }
  }

  // Auto-save draft region coordinates
  useEffect(() => {
    if (!session || regions.length === 0 || loading) return
    const timer = setTimeout(async () => {
      try {
        setSaving(true)
        const updated = await pdfSlicerApi.saveAnnotationRegions(session.id, regions, session.revision)
        setSession(updated)
      } catch (err) {
        console.error('Draft autosave failed:', err)
      } finally {
        setSaving(false)
      }
    }, 1200)
    return () => clearTimeout(timer)
  }, [regions])

  // Save drafts manually
  async function handleSaveDraft() {
    if (!session) return
    try {
      setSaving(true)
      const updated = await pdfSlicerApi.saveAnnotationRegions(session.id, regions, session.revision)
      setSession(updated)
      window.alert('草稿保存成功！')
    } catch (err) {
      window.alert('保存草稿失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  // Finalize manual correction
  async function handleFinalizeFix() {
    if (!session) return
    try {
      setFinalizing(true)
      // Save regions draft first
      const saved = await pdfSlicerApi.saveAnnotationRegions(session.id, regions, session.revision)
      setSession(saved)

      // Post finalize with payload containing edited Markdown texts
      const finalizeUrl = `/api/tools/pdf-slicer/annotation-sessions/${encodeURIComponent(session.id)}/finalize`
      const res = await fetch(finalizeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stemMarkdown, analysisMarkdown })
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || '提交裁剪与校对失败。')
      }

      window.alert('手动修正保存成功！')
      navigateBack()
    } catch (err) {
      window.alert('提交修正失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setFinalizing(false)
    }
  }

  // Add new region helper
  const handleAddNewRegion = (kind: 'question' | 'solution' | 'shared_answer_key') => {
    if (!candidate) return
    let label = '题干'
    let note = ''
    if (kind === 'solution') {
      label = '解析'
    } else if (kind === 'shared_answer_key') {
      label = '题图'
      note = 'stem' // Default usage
    }

    const newReg: Region = {
      id: createRegionId(),
      sourceRunId: candidate.sourceDocumentId,
      kind,
      questionLabel: label,
      questionKeys: [],
      segments: [],
      sortOrder: regions.length,
      note
    }

    setRegions([...regions, newReg])
    setSelectedRegionId(newReg.id)
    setRect({ x: 0, y: 0, width: 0, height: 0 })
  }

  // Delete selected region
  const handleDeleteSelected = () => {
    if (!selectedRegionId) return
    setRegions(current => current.filter(r => r.id !== selectedRegionId))
    setSelectedRegionId(null)
    setRect({ x: 0, y: 0, width: 0, height: 0 })
  }

  // Helpers for mapping regions to Canvas Boxes
  const canvasBoxes: BBoxCanvasBox[] = regions.flatMap((region, idx) => {
    const isSelected = selectedRegionId && region.id === selectedRegionId
    return region.segments
      .filter(seg => seg.page === currentPage)
      .map(seg => {
        let boxClass = 'border-zinc-400 bg-zinc-100/10'
        let labelClass = 'bg-zinc-500'
        if (region.kind === 'question') {
          boxClass = 'border-blue-500 bg-blue-100/15'
          labelClass = 'bg-blue-600'
        } else if (region.kind === 'solution') {
          boxClass = 'border-emerald-500 bg-emerald-100/15'
          labelClass = 'bg-emerald-600'
        } else {
          boxClass = 'border-purple-500 bg-purple-100/15'
          labelClass = 'bg-purple-600'
        }

        return {
          id: String(idx),
          x: seg.x,
          y: seg.y,
          width: seg.width,
          height: seg.height,
          label: region.questionLabel,
          boxClass,
          labelClass,
          title: region.note ? `用途: ${region.note}` : undefined
        }
      })
  })

  if (loading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <LoaderCircle className="size-8 animate-spin text-zinc-900 dark:text-zinc-100" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      {/* 顶部面包屑与操作栏 */}
      <div className="flex items-center justify-between border-b pb-3 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <button
            onClick={navigateBack}
            className="flex items-center justify-center p-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900 transition-colors"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">手动修正工作台</h2>
            <p className="text-[11px] text-zinc-500 max-w-lg truncate" title={pdfName}>
              试卷: {pdfName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saving && (
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
              <LoaderCircle className="size-3.5 animate-spin" /> 草稿保存中...
            </span>
          )}
          <Button variant="outline" size="sm" icon={Save} onClick={handleSaveDraft} disabled={saving || finalizing}>
            保存草稿
          </Button>
          <Button size="sm" icon={Save} onClick={handleFinalizeFix} disabled={finalizing}>
            {finalizing ? '正在提交...' : '保存修改并返回'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 h-[calc(100vh-10rem)] min-h-[600px] items-stretch overflow-hidden">
        {/* 左侧：PDF 渲染展示与划框区域 (7格) */}
        <div className="xl:col-span-7 flex flex-col border rounded-xl bg-zinc-50/50 dark:bg-zinc-955 overflow-hidden shadow-sm">
          {/* 页码与比例导航 */}
          <div className="border-b bg-white dark:bg-zinc-950 px-4 py-2 flex items-center justify-between shrink-0 text-xs text-zinc-500 select-none">
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">
              PDF 页面定位及选区划定
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={currentPage <= 1}
                onClick={() => {
                  setCurrentPage(prev => Math.max(1, prev - 1))
                  setRect({ x: 0, y: 0, width: 0, height: 0 })
                  setSelectedRegionId(null)
                }}
                className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="font-mono">
                {currentPage} / {maxPages} 页
              </span>
              <button
                disabled={currentPage >= maxPages}
                onClick={() => {
                  setCurrentPage(prev => Math.min(maxPages, prev + 1))
                  setRect({ x: 0, y: 0, width: 0, height: 0 })
                  setSelectedRegionId(null)
                }}
                className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>

          {/* 划框 Canvas 滚动区域 */}
          <div className="flex-1 overflow-auto p-4 flex items-start justify-center">
            {candidate && (
              <div className="w-full max-w-[800px]">
                <BBoxCanvas
                  imageUrl={`/api/import-flow-v2/source-documents/${candidate.sourceDocumentId}/pages/${currentPage}`}
                  boxes={canvasBoxes}
                  selectedBoxId={
                    selectedRegionId
                      ? String(regions.findIndex(r => r.id === selectedRegionId))
                      : undefined
                  }
                  onSelectBoxId={handleSelectBoxId}
                  rect={rect}
                  onRectChange={handleRectChange}
                  onDeleteSelectedBox={handleDeleteSelected}
                  naturalSizeReady={setNaturalSize}
                  imageRef={imageRef}
                />
              </div>
            )}
          </div>
        </div>

        {/* 右侧：编辑文本域与属性核对区 (5格) */}
        <div className="xl:col-span-5 flex flex-col border rounded-xl bg-white dark:bg-zinc-900 overflow-hidden shadow-sm min-w-0">
          <div className="border-b bg-zinc-50/50 dark:bg-zinc-950/20 px-4 py-2.5 flex items-center justify-between shrink-0">
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              异常题目文本及图框微调
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* 选区操作快捷按键 */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                1. 选区划定与微调
              </label>
              <div className="flex flex-wrap gap-1.5">
                <Button size="xs" variant="outline" icon={Plus} onClick={() => handleAddNewRegion('question')}>
                  新增题干范围
                </Button>
                <Button size="xs" variant="outline" icon={Plus} onClick={() => handleAddNewRegion('solution')}>
                  新增解析范围
                </Button>
                <Button size="xs" variant="outline" icon={Plus} onClick={() => handleAddNewRegion('shared_answer_key')}>
                  补充插图选区
                </Button>
              </div>

              {/* 当前选中选区信息与操作 */}
              {selectedRegionId && (
                <div className="mt-2.5 rounded-lg border border-zinc-150 bg-zinc-50/30 p-2.5 text-xs space-y-2 dark:border-zinc-800 dark:bg-zinc-955">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                      当前选中：{regions.find(r => r.id === selectedRegionId)?.questionLabel || '选区'}
                    </span>
                    <button
                      onClick={handleDeleteSelected}
                      className="text-red-500 hover:text-red-700 flex items-center gap-1 font-medium transition-colors cursor-pointer"
                    >
                      <Trash2 className="size-3.5" /> 删除该图框
                    </button>
                  </div>

                  {regions.find(r => r.id === selectedRegionId)?.kind === 'shared_answer_key' && (
                    <div className="flex items-center gap-3">
                      <span className="text-zinc-500 scale-95">插图位置:</span>
                      <select
                        value={regions.find(r => r.id === selectedRegionId)?.note || 'stem'}
                        onChange={(e) => {
                          const val = e.target.value
                          setRegions(current => current.map(r => {
                            if (r.id === selectedRegionId) {
                              return { ...r, note: val }
                            }
                            return r
                          }))
                        }}
                        className="h-7 rounded border border-zinc-200 bg-background px-2 text-[11px] outline-none"
                      >
                        <option value="stem">题干段落</option>
                        <option value="analysis">解析段落</option>
                      </select>
                    </div>
                  )}
                  <p className="text-[10px] text-zinc-400">
                    可以在左侧拖拽边缘调整框大小，或者按 Delete / Backspace 键快速删除。
                  </p>
                </div>
              )}
            </div>

            {/* 题干文本编辑 */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                2. 题干文本内容 (Markdown)
              </label>
              <textarea
                value={stemMarkdown}
                onChange={(e) => setStemMarkdown(e.target.value)}
                className="w-full h-40 rounded-lg border border-zinc-200 bg-background p-3 text-xs outline-none focus:ring-1 focus:ring-zinc-950 font-mono resize-y"
                placeholder="在此录入或修改识别出的题干内容..."
              />
            </div>

            {/* 解析步骤编辑 */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                3. 自动解析步骤 (Markdown)
              </label>
              <textarea
                value={analysisMarkdown}
                onChange={(e) => setAnalysisMarkdown(e.target.value)}
                className="w-full h-32 rounded-lg border border-zinc-200 bg-background p-3 text-xs outline-none focus:ring-1 focus:ring-zinc-950 font-mono resize-y"
                placeholder="在此输入参考答案与解析思路..."
              />
            </div>

            {/* 诊断小贴士 */}
            <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3 text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-955 leading-relaxed flex gap-2">
              <HelpCircle className="size-4 text-zinc-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-zinc-700 dark:text-zinc-300">💡 提示与说明</p>
                <p className="mt-1">
                  1. 拉框时请拖拽鼠标生成新红框，随后可点“新增”按钮自动转化为特定选区。
                </p>
                <p>
                  2. 补充插图选区在保存修改时会自动将其物理裁剪，并在“题干文本”尾部自动追加占位符代码。
                </p>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}

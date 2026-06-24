import { useEffect, useState, useRef, type MouseEvent } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Plus,
  Save,
  Trash2,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Sparkles,
  BookOpen,
  FileText
} from 'lucide-react'
import { pdfSlicerApi } from '@/api/pdfSlicer'
import { Button, Badge } from '@/components/ui'

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

interface RunInfo {
  runId: string
  pdfName: string
  fileRole: string
  pageCount: number
}

function createRegionId() {
  return `reg_${globalThis.crypto.randomUUID()}`
}

const SegmentPreview = ({ runId, segment }: { runId: string; segment: Segment }) => {
  const w = Math.max(segment.width, 0.01)
  const h = Math.max(segment.height, 0.01)
  return (
    <div className="w-full flex justify-center">
      <div 
        className="relative overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 group/preview"
        style={{
          width: '100%',
          maxHeight: '100px',
          aspectRatio: `${w} / ${h}`,
        }}
      >
        <img
          src={`/api/tools/pdf-slicer/runs/${runId}/pages/${segment.page}`}
          alt="crop"
          className="absolute select-none pointer-events-none max-w-none"
          style={{
            left: `-${(segment.x / w) * 100}%`,
            top: `-${(segment.y / h) * 100}%`,
            width: `${(1 / w) * 100}%`,
            height: `${(1 / h) * 100}%`,
          }}
          draggable={false}
        />
        <span className="absolute bottom-1 right-1 bg-zinc-900/60 dark:bg-zinc-950/70 backdrop-blur-xs text-white text-[8px] px-1 py-0.5 rounded font-mono scale-90 origin-bottom-right">
          P.{segment.page}
        </span>
      </div>
    </div>
  )
}

export default function AnnotationWorkbenchPage() {
  const { batchId } = useParams<{ batchId: string }>()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [session, setSession] = useState<any>(null)
  
  // Runs in this batch
  const [runs, setRuns] = useState<RunInfo[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string>('')
  
  // Selection / Editing State
  const [regions, setRegions] = useState<Region[]>([])
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  
  // Display State
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageByRunId, setPageByRunId] = useState<Record<string, number>>({})
  const [viewPositionBatchId, setViewPositionBatchId] = useState('')
  const [zoom, setZoom] = useState<number>(100) // percent
  const [fitMode, setFitMode] = useState<'width' | 'page' | 'none'>('width')
  const [isDrawing, setIsDrawing] = useState(false)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [tempRect, setTempRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  
  // Undo / Redo History
  const [history, setHistory] = useState<Region[][]>([])
  const [historyIndex, setHistoryIndex] = useState<number>(-1)

  // Drag & Resize State
  const [dragState, setDragState] = useState<{
    regionId: string
    segmentIdx: number
    action: 'move' | 'resize'
    handle?: string
    startX: number
    startY: number
    initialSeg: Segment
  } | null>(null)

  // Validation / Warnings
  const [validation, setValidation] = useState<{ errors: string[]; warnings: string[] }>({ errors: [], warnings: [] })
  const [showValidationModal, setShowValidationModal] = useState(false)
  const [showReviseModal, setShowReviseModal] = useState(false)
  // Collapsible state for question label groups
  const [collapsedLabels, setCollapsedLabels] = useState<Record<string, boolean>>({})

  const isFinalized = session?.status === 'finalized'

  function viewPositionStorageKey() {
    return batchId ? `pdf-slicer:annotation-view:${batchId}` : ''
  }

  function rememberPage(runId: string, page: number) {
    if (!runId) return
    setCurrentPage(page)
    setPageByRunId((current) => ({ ...current, [runId]: page }))
  }

  function switchRun(runId: string, requestedPage?: number) {
    const run = runs.find((item) => item.runId === runId)
    const maxPage = Math.max(1, run?.pageCount || 1)
    const savedPage = pageByRunId[runId] || 1
    const nextPage = Math.max(1, Math.min(maxPage, requestedPage ?? savedPage))
    setSelectedRunId(runId)
    rememberPage(runId, nextPage)
  }

  useEffect(() => {
    const storageKey = viewPositionStorageKey()
    if (!storageKey || viewPositionBatchId !== batchId) return
    window.sessionStorage.setItem(storageKey, JSON.stringify(pageByRunId))
  }, [batchId, pageByRunId, viewPositionBatchId])

  // Auto-expand accordion when a region is selected
  useEffect(() => {
    if (selectedRegionId) {
      const active = regions.find(r => r.id === selectedRegionId)
      if (active && active.questionLabel) {
        const label = active.questionLabel
        if (collapsedLabels[label] === true) {
          setCollapsedLabels(prev => ({
            ...prev,
            [label]: false
          }))
        }
      }
    }
  }, [selectedRegionId, regions, collapsedLabels])

  // Double columns view for wide screens
  const [isDoubleLayout, setIsDoubleLayout] = useState(false)

  const imageContainerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  // Debounced auto-save timer
  const autoSaveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!batchId) return
    loadBatchAndSession()
    
    // Check screen size for layout
    const checkLayout = () => {
      setIsDoubleLayout(window.innerWidth >= 1280)
    }
    checkLayout()
    window.addEventListener('resize', checkLayout)
    return () => {
      window.removeEventListener('resize', checkLayout)
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current)
    }
  }, [batchId])

  // Load session and runs info
  async function loadBatchAndSession() {
    try {
      setLoading(true)
      const batchData = await pdfSlicerApi.getBatch(batchId!)
      const batchRuns = ((batchData as any).runs || []).map((r: any) => {
        const diag = r.documentDiagnostics || {}
        return {
          runId: r.runId,
          pdfName: r.pdfName,
          fileRole: r.fileRole,
          pageCount: diag.profile?.pageCount || 0
        }
      })
      setRuns(batchRuns)

      let savedPages: Record<string, number> = {}
      try {
        const saved = window.sessionStorage.getItem(viewPositionStorageKey())
        if (saved) savedPages = JSON.parse(saved) as Record<string, number>
      } catch {
        savedPages = {}
      }
      setPageByRunId(savedPages)
      setViewPositionBatchId(batchId || '')

      // Automatically preselect a run (prefer questions run, else first run)
      const qRun = batchRuns.find((r: any) => r.fileRole === 'questions') || batchRuns[0]
      if (qRun) {
        setSelectedRunId(qRun.runId)
        setCurrentPage(Math.max(1, Math.min(qRun.pageCount || 1, savedPages[qRun.runId] || 1)))
      }

      const sess = await pdfSlicerApi.createOrRestoreAnnotationSession(batchId!)
      setSession(sess)
      const initialRegions = sess.regions || []
      setRegions(initialRegions)
      
      // Initialize history
      setHistory([initialRegions])
      setHistoryIndex(0)
    } catch (err) {
      console.error(err)
      window.alert('加载标注会话失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(false)
    }
  }

  // Pre-trigger background rendering for all runs
  useEffect(() => {
    if (runs.length > 0) {
      runs.forEach(run => {
        fetch(`/api/tools/pdf-slicer/runs/${run.runId}/render-pages`, { method: 'POST' }).catch(() => {})
      })
    }
  }, [runs])

  // Track history changes
  const pushHistory = (newRegions: Region[]) => {
    const nextHistory = history.slice(0, historyIndex + 1)
    nextHistory.push(newRegions)
    setHistory(nextHistory)
    setHistoryIndex(nextHistory.length - 1)
    setRegions(newRegions)
    
    // Trigger auto save
    triggerAutoSave(newRegions)
  }

  const handleUndo = () => {
    if (historyIndex > 0) {
      const nextIndex = historyIndex - 1
      setHistoryIndex(nextIndex)
      setRegions(history[nextIndex])
      triggerAutoSave(history[nextIndex])
    }
  }

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1
      setHistoryIndex(nextIndex)
      setRegions(history[nextIndex])
      triggerAutoSave(history[nextIndex])
    }
  }

  // Debounced auto-save draft
  const triggerAutoSave = (currentRegions: Region[]) => {
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = window.setTimeout(async () => {
      if (!session) return
      try {
        setSaving(true)
        const updated = await pdfSlicerApi.saveAnnotationRegions(session.id, currentRegions, session.revision)
        setSession(updated)
      } catch (err) {
        console.error('Auto save failed:', err)
      } finally {
        setSaving(false)
      }
    }, 1500) as unknown as number
  }

  // Manual Save
  async function handleSave() {
    if (!session) return
    try {
      setSaving(true)
      const updated = await pdfSlicerApi.saveAnnotationRegions(session.id, regions, session.revision)
      setSession(updated)
      window.alert('草稿已成功保存！')
    } catch (err) {
      window.alert('保存失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  // Quick Action: Add New Item
  const handleAddNewItem = (kind: 'question' | 'solution' | 'shared_answer_key') => {
    // Generate next consecutive number
    let nextLabel = '1'
    if (kind === 'question') {
      const qLabels = regions
        .filter(r => r.kind === 'question')
        .map(r => parseInt(r.questionLabel.replace(/\D/g, ''), 10))
        .filter(n => !isNaN(n))
      if (qLabels.length > 0) {
        nextLabel = String(Math.max(...qLabels) + 1)
      }
    } else if (kind === 'solution') {
      // Bind to current selected question if possible
      const selectedQuestion = regions.find(r => r.id === selectedRegionId && r.kind === 'question')
      if (selectedQuestion) {
        nextLabel = selectedQuestion.questionLabel
      } else {
        const sLabels = regions
          .filter(r => r.kind === 'solution')
          .map(r => parseInt(r.questionLabel.replace(/\D/g, ''), 10))
          .filter(n => !isNaN(n))
        if (sLabels.length > 0) {
          nextLabel = String(Math.max(...sLabels) + 1)
        }
      }
    } else {
      nextLabel = '1-5'
    }

    const newRegion: Region = {
      id: createRegionId(),
      sourceRunId: selectedRunId,
      kind,
      questionLabel: kind === 'shared_answer_key' ? '' : nextLabel,
      questionKeys: kind === 'shared_answer_key' ? ['1', '2', '3', '4', '5'] : [],
      segments: [],
      sortOrder: regions.length,
      note: ''
    }

    pushHistory([...regions, newRegion])
    setSelectedRegionId(newRegion.id)
  }

  const handleAddQuestion = () => {
    const questionRun = runs.find((run) => run.fileRole === 'questions') || runs[0]
    if (!questionRun) return
    const numbers = regions
      .filter((region) => region.kind === 'question')
      .map((region) => parseInt(region.questionLabel.replace(/\D/g, ''), 10))
      .filter((value) => !Number.isNaN(value))
    const nextLabel = String(numbers.length ? Math.max(...numbers) + 1 : 1)
    const newRegion: Region = {
      id: createRegionId(),
      sourceRunId: questionRun.runId,
      kind: 'question',
      questionLabel: nextLabel,
      segments: [],
      sortOrder: regions.length,
      note: '',
    }
    pushHistory([...regions, newRegion])
    setSelectedRegionId(newRegion.id)
    setCollapsedLabels(() => {
      const next: Record<string, boolean> = {}
      for (const region of regions) {
        if (region.kind !== 'shared_answer_key' && region.questionLabel) {
          next[region.questionLabel] = true
        }
      }
      next[nextLabel] = false
      return next
    })
    switchRun(questionRun.runId)
  }

  const handleAddNewItemForLabel = (label: string, kind: 'question' | 'solution') => {
    const targetRun = kind === 'solution'
      ? runs.find((run) => run.fileRole === 'solutions') || runs[0]
      : runs.find((run) => run.fileRole === 'questions') || runs[0]
    if (!targetRun) return
    const newRegion: Region = {
      id: createRegionId(),
      sourceRunId: targetRun.runId,
      kind,
      questionLabel: label,
      segments: [],
      sortOrder: regions.length,
      note: ''
    }
    pushHistory([...regions, newRegion])
    setSelectedRegionId(newRegion.id)
    switchRun(targetRun.runId)
  }

  // Delete Region
  const handleDeleteRegion = (id: string) => {
    const nextRegions = regions.filter(r => r.id !== id)
    pushHistory(nextRegions)
    if (selectedRegionId === id) {
      setSelectedRegionId(null)
    }
  }

  // Edit Label
  const handleLabelChange = (id: string, newLabel: string) => {
    const nextRegions = regions.map(r => r.id === id ? { ...r, questionLabel: newLabel } : r)
    setRegions(nextRegions)
    triggerAutoSave(nextRegions)
  }

  // Edit Note
  const handleNoteChange = (id: string, note: string) => {
    const nextRegions = regions.map(r => r.id === id ? { ...r, note } : r)
    setRegions(nextRegions)
    triggerAutoSave(nextRegions)
  }

  // Edit Shared Keys
  const handleSharedKeysChange = (id: string, keysStr: string) => {
    const keys = keysStr.split(/[,，、\s]+/).filter(k => k.trim())
    const nextRegions = regions.map(r => r.id === id ? { ...r, questionKeys: keys } : r)
    setRegions(nextRegions)
    triggerAutoSave(nextRegions)
  }

  // Canvas Mouse Draw / Drag handlers
  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (!selectedRegionId) return
    const container = imageContainerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    setIsDrawing(true)
    setDrawStart({ x, y })
    setTempRect({ x, y, w: 0, h: 0 })
  }

  const handleSegMouseDown = (e: React.MouseEvent, regionId: string, segmentIdx: number, seg: Segment) => {
    e.stopPropagation()
    setSelectedRegionId(regionId)
    if (isFinalized) return
    setDragState({
      regionId,
      segmentIdx,
      action: 'move',
      startX: e.clientX,
      startY: e.clientY,
      initialSeg: { ...seg }
    })
  }

  const handleHandleMouseDown = (e: React.MouseEvent, regionId: string, segmentIdx: number, seg: Segment, handle: string) => {
    if (isFinalized) return
    e.stopPropagation()
    setSelectedRegionId(regionId)
    setDragState({
      regionId,
      segmentIdx,
      action: 'resize',
      handle,
      startX: e.clientX,
      startY: e.clientY,
      initialSeg: { ...seg }
    })
  }

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (dragState) {
      const container = imageContainerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()

      const deltaX = (e.clientX - dragState.startX) / rect.width
      const deltaY = (e.clientY - dragState.startY) / rect.height

      let { x, y, width, height } = dragState.initialSeg

      if (dragState.action === 'move') {
        x = Math.max(0, Math.min(1 - width, x + deltaX))
        y = Math.max(0, Math.min(1 - height, y + deltaY))
      } else if (dragState.action === 'resize' && dragState.handle) {
        const h = dragState.handle
        const minSize = 0.005

        if (h.includes('e')) {
          width = Math.max(minSize, Math.min(1 - x, width + deltaX))
        }
        if (h.includes('w')) {
          const nextX = Math.max(0, Math.min(x + width - minSize, x + deltaX))
          width = width + (x - nextX)
          x = nextX
        }
        if (h.includes('s')) {
          height = Math.max(minSize, Math.min(1 - y, height + deltaY))
        }
        if (h.includes('n')) {
          const nextY = Math.max(0, Math.min(y + height - minSize, y + deltaY))
          height = height + (y - nextY)
          y = nextY
        }
      }

      const nextRegions = regions.map(r => {
        if (r.id === dragState.regionId) {
          const nextSegs = r.segments.map((seg, sIdx) => {
            if (sIdx === dragState.segmentIdx) {
              return { ...seg, x, y, width, height }
            }
            return seg
          })
          return { ...r, segments: nextSegs }
        }
        return r
      })
      setRegions(nextRegions)
      return
    }

    if (!isDrawing || !drawStart) return
    const container = imageContainerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const currentX = (e.clientX - rect.left) / rect.width
    const currentY = (e.clientY - rect.top) / rect.height

    const x = Math.min(drawStart.x, currentX)
    const y = Math.min(drawStart.y, currentY)
    const w = Math.abs(drawStart.x - currentX)
    const h = Math.abs(drawStart.y - currentY)

    setTempRect({ x, y, w, h })
  }

  const handleMouseUp = () => {
    if (dragState) {
      pushHistory(regions)
      setDragState(null)
      return
    }

    if (!isDrawing || !tempRect || !selectedRegionId) return
    setIsDrawing(false)

    // Add segment to selected region
    if (tempRect.w > 0.005 && tempRect.h > 0.005) {
      const activeReg = regions.find(r => r.id === selectedRegionId)
      if (activeReg) {
        const isSolutionsPDF = selectedRun?.fileRole !== 'questions'
        let targetRegionId = selectedRegionId
        let nextRegions = [...regions]

        if (isSolutionsPDF && activeReg.kind === 'question') {
          // Drawing on solutions PDF but active region is a question (题干)
          // Route to solutions region with the same label
          const existingSolution = regions.find(
            r => r.kind === 'solution' && r.questionLabel === activeReg.questionLabel
          )
          if (existingSolution) {
            targetRegionId = existingSolution.id
          } else {
            const newRegId = createRegionId()
            const newSolution: Region = {
              id: newRegId,
              sourceRunId: selectedRunId,
              kind: 'solution',
              questionLabel: activeReg.questionLabel,
              segments: [],
              sortOrder: regions.length,
              note: ''
            }
            nextRegions.push(newSolution)
            targetRegionId = newRegId
          }
        } else if (!isSolutionsPDF && activeReg.kind === 'solution') {
          // Drawing on questions PDF but active region is a solution (解析)
          // Route to questions region with the same label
          const existingQuestion = regions.find(
            r => r.kind === 'question' && r.questionLabel === activeReg.questionLabel
          )
          if (existingQuestion) {
            targetRegionId = existingQuestion.id
          } else {
            const newRegId = createRegionId()
            const newQuestion: Region = {
              id: newRegId,
              sourceRunId: selectedRunId,
              kind: 'question',
              questionLabel: activeReg.questionLabel,
              segments: [],
              sortOrder: regions.length,
              note: ''
            }
            nextRegions.push(newQuestion)
            targetRegionId = newRegId
          }
        }

        // Add the segment to the target region
        const updatedRegions = nextRegions.map(r => {
          if (r.id === targetRegionId) {
            const newSeg: Segment = {
              page: currentPage,
              x: Math.max(0, Math.min(1, tempRect.x)),
              y: Math.max(0, Math.min(1, tempRect.y)),
              width: Math.min(1 - tempRect.x, tempRect.w),
              height: Math.min(1 - tempRect.y, tempRect.h)
            }
            return {
              ...r,
              sourceRunId: selectedRunId,
              segments: [...r.segments, newSeg]
            }
          }
          return r
        })

        pushHistory(updatedRegions)
        setSelectedRegionId(targetRegionId) // Automatically switch selection to the correct region
      }
    }

    setDrawStart(null)
    setTempRect(null)
  }

  // Clear all segments for selected region
  const handleClearSegments = (id: string) => {
    const nextRegions = regions.map(r => r.id === id ? { ...r, segments: [] } : r)
    pushHistory(nextRegions)
  }

  // Submit / Finalize Annotation Slices
  async function handleFinalize() {
    if (!session) return
    try {
      setFinalizing(true)
      // Save latest draft first
      const saved = await pdfSlicerApi.saveAnnotationRegions(session.id, regions, session.revision)
      setSession(saved)

      // Validate
      const val = await pdfSlicerApi.validateAnnotationSession(session.id)
      setValidation(val)

      if (val.errors.length > 0) {
        setValidation(val)
        setShowValidationModal(true)
        return
      }

      if (val.warnings.length > 0) {
        setShowValidationModal(true)
        return
      }

      // No warning & error, execute directly
      await executeFinalize()
    } catch (err) {
      window.alert('校验或提交失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setFinalizing(false)
    }
  }

  async function executeFinalize() {
    try {
      setFinalizing(true)
      await pdfSlicerApi.finalizeAnnotationSession(session.id)
      window.alert('框选并配对完成！切题任务已顺利接入复核。')
      navigate('/tools/pdf-slicer')
    } catch (err) {
      window.alert('生成剪裁切片失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setFinalizing(false)
      setShowValidationModal(false)
    }
  }

  // Re-enable annotation after finalized (for revisions)
  async function handleRevise() {
    if (!session) return
    try {
      setFinalizing(true)
      const newSess = await pdfSlicerApi.reviseAnnotationSession(session.id)
      setSession(newSess)
      setRegions(newSess.regions || [])
      setHistory([newSess.regions || []])
      setHistoryIndex(0)
      setShowReviseModal(false)
      window.alert('已为您创建新的标注修订版草稿！')
    } catch (err) {
      window.alert('创建修订版失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setFinalizing(false)
    }
  }

  const selectedRun = runs.find(r => r.runId === selectedRunId)
  const orderedRuns = [...runs].sort((left, right) => {
    const order = (run: RunInfo) => run.fileRole === 'questions' ? 0 : run.fileRole === 'solutions' ? 1 : 2
    return order(left) - order(right)
  })
  const currentRunPages = selectedRun ? selectedRun.pageCount : 0

  // Filter regions by current file & page to display boxes overlay
  const pageRegions = regions.filter(r => 
    r.sourceRunId === selectedRunId && 
    r.segments.some(s => s.page === currentPage)
  )

  const activeRegion = regions.find(r => r.id === selectedRegionId)

  const allBlocks = regions.flatMap(r => 
    r.segments.map((seg, sIdx) => ({
      regionId: r.id,
      regionKind: r.kind,
      regionLabel: r.questionLabel,
      regionKeys: r.questionKeys,
      segmentIdx: sIdx,
      segment: seg,
      sourceRunId: r.sourceRunId
    }))
  )

  const handleBlockClick = (regionId: string, sourceRunId: string, page: number) => {
    setSelectedRegionId(regionId)
    switchRun(sourceRunId, page)
  }

  // Color mappings for UI aesthetics
  const getKindColorClass = (kind: string, isActive: boolean) => {
    if (kind === 'question') {
      return isActive 
        ? 'border-indigo-600 bg-indigo-50/40 dark:border-indigo-400 dark:bg-indigo-950/40' 
        : 'border-indigo-400/85 bg-indigo-50/15 hover:border-indigo-500 hover:bg-indigo-50/25 dark:border-indigo-800/80 dark:bg-indigo-950/15'
    } else if (kind === 'solution') {
      return isActive 
        ? 'border-amber-600 bg-amber-50/40 dark:border-amber-400 dark:bg-amber-950/40' 
        : 'border-amber-400 bg-amber-50/15 hover:border-amber-500 hover:bg-amber-50/25 dark:border-amber-800/80 dark:bg-amber-950/15'
    } else {
      return isActive 
        ? 'border-emerald-600 bg-emerald-50/40 dark:border-emerald-400 dark:bg-emerald-950/40' 
        : 'border-emerald-400 bg-emerald-50/15 hover:border-emerald-500 hover:bg-emerald-50/25 dark:border-emerald-800/80 dark:bg-emerald-950/15'
    }
  }

  const getHandleClassName = (kind: string) => {
    let colorClass = ''
    if (kind === 'question') {
      colorClass = 'border-indigo-600 dark:border-indigo-400'
    } else if (kind === 'solution') {
      colorClass = 'border-amber-600 dark:border-amber-400'
    } else {
      colorClass = 'border-emerald-600 dark:border-emerald-400'
    }
    return `absolute w-2.5 h-2.5 bg-white dark:bg-zinc-900 border-2 ${colorClass} rounded-full z-30 shadow-xs hover:scale-125 transition-transform`
  }

  const getBadgeColor = (kind: string) => {
    if (kind === 'question') return 'bg-indigo-50/50 text-indigo-700 border-indigo-200/50 dark:bg-indigo-950/20 dark:text-indigo-400 dark:border-indigo-900/30'
    if (kind === 'solution') return 'bg-amber-50/50 text-amber-700 border-amber-200/50 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30'
    return 'bg-emerald-50/50 text-emerald-700 border-emerald-200/50 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30'
  }

  const getLabelName = (kind: string) => {
    if (kind === 'question') return '题干'
    if (kind === 'solution') return '解析'
    return '公共答案表'
  }

  if (loading) {
    return (
      <div className="flex h-[80vh] items-center justify-center bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-950 border-t-transparent dark:border-zinc-50" />
          <span className="text-sm font-medium text-zinc-550 dark:text-zinc-400">正在进入人工标注工作台...</span>
        </div>
      </div>
    )
  }



  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
      {/* Top Header */}
      <header className="flex h-14 items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => navigate('/tools/pdf-slicer')}
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-50 transition-all cursor-pointer"
            title="返回批次列表"
          >
            <ArrowLeft className="size-5" />
          </button>
          <div className="flex flex-col">
            <h1 className="text-sm font-semibold flex items-center gap-1.5">
              <Sparkles className="size-4 text-zinc-900 dark:text-zinc-100 animate-pulse" />
              人工框选工作台
            </h1>
            <span className="text-[10px] text-zinc-500 truncate max-w-[200px] md:max-w-sm">
              批次: {batchId}
            </span>
          </div>
        </div>

        {/* Mid Options */}
        <div className="hidden md:flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-900 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-800">
          {orderedRuns.map(run => (
            <button
              key={run.runId}
              onClick={() => {
                switchRun(run.runId)
              }}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
                selectedRunId === run.runId
                  ? 'bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-xs border border-zinc-200/20'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50 hover:text-zinc-900 dark:hover:text-zinc-200 border border-transparent'
              }`}
            >
              {run.fileRole === 'questions' ? (
                <FileText className="size-3.5 text-zinc-500 dark:text-zinc-400" />
              ) : (
                <BookOpen className="size-3.5 text-zinc-500 dark:text-zinc-400" />
              )}
              {run.fileRole === 'questions' ? '原卷 PDF' : '解析 PDF'}
            </button>
          ))}
        </div>

        {/* Actions Button */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-900 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-800 mr-2">
            <button 
              onClick={handleUndo} 
              disabled={historyIndex <= 0 || isFinalized}
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 dark:text-zinc-400 hover:bg-white dark:hover:bg-zinc-950 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
              title="撤销"
            >
              <Undo2 className="size-4" />
            </button>
            <button 
              onClick={handleRedo} 
              disabled={historyIndex >= history.length - 1 || isFinalized}
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 dark:text-zinc-400 hover:bg-white dark:hover:bg-zinc-950 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
              title="重做"
            >
              <Redo2 className="size-4" />
            </button>
          </div>

          {isFinalized ? (
            <Button 
              onClick={() => setShowReviseModal(true)}
              variant="outline"
              className="h-8 text-xs font-medium border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              重新框选 (创建修订版)
            </Button>
          ) : (
            <>
              <Button 
                onClick={handleSave} 
                variant="outline" 
                disabled={saving}
                className="h-8 text-xs font-medium border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                <Save className="size-3.5 mr-1" />
                {saving ? '保存中...' : '保存草稿'}
              </Button>
              <Button 
                onClick={handleFinalize} 
                disabled={finalizing || regions.length === 0}
                className="h-8 text-xs font-semibold bg-zinc-900 text-zinc-50 hover:bg-zinc-900/90 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-50/90"
              >
                <CheckCircle2 className="size-3.5 mr-1" />
                完成框选并提交
              </Button>
            </>
          )}
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Bar: Items Queue */}
        <aside className="w-64 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950 flex flex-col">
          <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-4 py-3 bg-zinc-50/55 dark:bg-zinc-900/10">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">题目与选区列表</h2>
            {!isFinalized && (
              <div>
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50/50 px-2 text-[11px] font-medium text-indigo-700 shadow-2xs transition-all hover:bg-indigo-100/80 dark:border-indigo-900/30 dark:bg-indigo-950/20 dark:text-indigo-400 dark:hover:bg-indigo-900/40 cursor-pointer"
                  onClick={handleAddQuestion}
                  title="添加题目"
                >
                  <Plus className="size-3.5" /> 添加题目
                </button>
              </div>
            )}
          </div>
          {/* Queue Scroll List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-2 bg-transparent">
            {regions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-zinc-400 dark:text-zinc-600 text-xs text-center p-4 space-y-2">
                <Layers className="size-8 opacity-40" />
                <span>暂无标注区域。请点击“添加题目”开始框选题干。</span>
              </div>
            ) : (() => {
              // Group regions by label (excluding shared keys)
              const groupedRegions = regions.reduce((acc, r) => {
                if (r.kind === 'shared_answer_key') return acc
                const label = r.questionLabel || ''
                if (!acc[label]) {
                  acc[label] = { question: null, solution: null }
                }
                if (r.kind === 'question') {
                  acc[label].question = r
                } else if (r.kind === 'solution') {
                  acc[label].solution = r
                }
                return acc
              }, {} as Record<string, { question: Region | null; solution: Region | null }>)

              const sortedLabels = Object.keys(groupedRegions).sort((a, b) => {
                const numA = parseInt(a.replace(/\D/g, ''), 10)
                const numB = parseInt(b.replace(/\D/g, ''), 10)
                if (isNaN(numA) || isNaN(numB)) {
                  return a.localeCompare(b)
                }
                return numA - numB
              })

              // Get shared answer keys
              const sharedKeys = regions.filter(r => r.kind === 'shared_answer_key')

              return (
                <div className="space-y-2">
                  {/* 1. Grouped Questions Accordion */}
                  {sortedLabels.map(label => {
                    const q = groupedRegions[label].question
                    const s = groupedRegions[label].solution
                    
                    const isQActive = q && selectedRegionId === q.id
                    const isSActive = s && selectedRegionId === s.id

                    const isCollapsed = collapsedLabels[label] === true
                    const isExpanded = !isCollapsed

                    let statusText = '仅题干'
                    if (q && s) statusText = '题干+解析'
                    else if (s) statusText = '仅解析'

                    return (
                      <div 
                        key={label}
                        className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 rounded-xl overflow-hidden shadow-2xs"
                      >
                        {/* Accordion Header */}
                        <div 
                          onClick={() => {
                            setCollapsedLabels(prev => ({
                              ...prev,
                              [label]: !prev[label]
                            }))
                          }}
                          className="flex items-center justify-between px-3 py-2 bg-zinc-50/50 dark:bg-zinc-900/20 border-b border-zinc-150 dark:border-zinc-900 cursor-pointer select-none hover:bg-zinc-50 dark:hover:bg-zinc-900/30 transition-colors"
                        >
                          <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                            <BookOpen className="size-3.5 text-zinc-400 dark:text-zinc-500" />
                            第 {label} 题
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] px-1 py-0.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-500 font-medium scale-95 origin-right">
                              {statusText}
                            </span>
                            <ChevronRight 
                              className={`size-3.5 text-zinc-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} 
                            />
                          </div>
                        </div>

                        {/* Accordion Body */}
                        {isExpanded && (
                          <div className="p-1.5 space-y-1 bg-zinc-50/10 dark:bg-zinc-950/10 border-t border-zinc-100 dark:border-zinc-900/50">
                            {/* 题干 Sub-item */}
                            {q ? (
                              <div 
                                onClick={() => setSelectedRegionId(q.id)}
                                className={`group relative flex flex-col p-2 rounded-lg text-xs transition-all border cursor-pointer ${
                                  isQActive
                                    ? 'bg-zinc-100/80 dark:bg-zinc-900 text-indigo-700 dark:text-indigo-400 font-semibold border-zinc-300 dark:border-zinc-700 shadow-2xs'
                                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/40 text-zinc-650 dark:text-zinc-450 border-transparent'
                                }`}
                              >
                                <div className="flex items-center justify-between w-full">
                                  <div className="flex items-center gap-2">
                                    <Badge className="text-[9px] px-1 py-0 bg-indigo-50/50 text-indigo-700 border-indigo-200/50 dark:bg-indigo-950/20 dark:text-indigo-400">题干</Badge>
                                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{q.segments.length} 个选区</span>
                                  </div>
                                  
                                  {!isFinalized && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleDeleteRegion(q.id)
                                      }}
                                      className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-650 dark:hover:text-red-400 transition-opacity p-0.5"
                                      title="删除题干"
                                    >
                                      <Trash2 className="size-3" />
                                    </button>
                                  )}
                                </div>

                                {q.segments.length > 0 && (
                                  <div className="mt-2 space-y-1.5 w-full">
                                    {q.segments.map((seg, sIdx) => (
                                      <div 
                                        key={sIdx}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setSelectedRegionId(q.id)
                                          handleBlockClick(q.id, q.sourceRunId, seg.page)
                                        }}
                                        className="w-full hover:ring-1 hover:ring-indigo-500 rounded-md transition-all"
                                      >
                                        <SegmentPreview runId={q.sourceRunId} segment={seg} />
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              !isFinalized && (
                                <button
                                  type="button"
                                  onClick={() => handleAddNewItemForLabel(label, 'question')}
                                  className="flex items-center justify-center gap-1.5 p-2 rounded-lg text-[10px] text-zinc-500 dark:text-zinc-500 border border-dashed border-zinc-200 dark:border-zinc-800 hover:border-indigo-300 dark:hover:border-indigo-900/50 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/10 hover:text-indigo-700 dark:hover:text-indigo-400 transition-all w-full cursor-pointer"
                                >
                                  <Plus className="size-3" /> 补充该题题干
                                </button>
                              )
                            )}

                            {/* 解析 Sub-item */}
                            {s ? (
                              <div 
                                onClick={() => setSelectedRegionId(s.id)}
                                className={`group relative flex flex-col p-2 rounded-lg text-xs transition-all border cursor-pointer ${
                                  isSActive
                                    ? 'bg-zinc-100/80 dark:bg-zinc-900 text-amber-700 dark:text-amber-400 font-semibold border-zinc-300 dark:border-zinc-700 shadow-2xs'
                                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/40 text-zinc-650 dark:text-zinc-455 border-transparent'
                                }`}
                              >
                                <div className="flex items-center justify-between w-full">
                                  <div className="flex items-center gap-2">
                                    <Badge className="text-[9px] px-1 py-0 bg-amber-50/50 text-amber-700 border-amber-200/50 dark:bg-amber-950/20 dark:text-amber-400">解析</Badge>
                                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{s.segments.length} 个选区</span>
                                  </div>
                                  
                                  {!isFinalized && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleDeleteRegion(s.id)
                                      }}
                                      className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-655 dark:hover:text-red-400 transition-opacity p-0.5"
                                      title="删除解析"
                                    >
                                      <Trash2 className="size-3" />
                                    </button>
                                  )}
                                </div>

                                {s.segments.length > 0 && (
                                  <div className="mt-2 space-y-1.5 w-full">
                                    {s.segments.map((seg, sIdx) => (
                                      <div 
                                        key={sIdx}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setSelectedRegionId(s.id)
                                          handleBlockClick(s.id, s.sourceRunId, seg.page)
                                        }}
                                        className="w-full hover:ring-1 hover:ring-amber-500 rounded-md transition-all"
                                      >
                                        <SegmentPreview runId={s.sourceRunId} segment={seg} />
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              !isFinalized && (
                                <button
                                  type="button"
                                  onClick={() => handleAddNewItemForLabel(label, 'solution')}
                                  className="flex items-center justify-center gap-1.5 p-2 rounded-lg text-[10px] text-zinc-500 dark:text-zinc-500 border border-dashed border-zinc-200 dark:border-zinc-800 hover:border-amber-300 dark:hover:border-amber-900/50 hover:bg-amber-50/30 dark:hover:bg-amber-955/10 hover:text-amber-700 dark:hover:text-amber-400 transition-all w-full cursor-pointer"
                                >
                                  <Plus className="size-3" /> 补充该题解析
                                </button>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* 2. Shared Answer Keys Section */}
                  {sharedKeys.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-zinc-200 dark:border-zinc-800/80">
                      <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block px-1">
                        公共选区
                      </span>
                      {sharedKeys.map(r => {
                        const isSel = selectedRegionId === r.id
                        return (
                          <div
                            key={r.id}
                            onClick={() => setSelectedRegionId(r.id)}
                            className={`group relative flex flex-col p-2 rounded-lg border transition-all cursor-pointer text-xs ${
                              isSel
                                ? 'bg-zinc-100/80 dark:bg-zinc-900 border-zinc-900 dark:border-zinc-100 shadow-sm font-semibold text-zinc-900 dark:text-zinc-50'
                                : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50 text-zinc-650 dark:text-zinc-450'
                            }`}
                          >
                            <div className="flex items-center justify-between w-full">
                              <div className="flex items-center gap-2">
                                <Badge className="text-[9px] px-1 py-0 bg-emerald-50/50 text-emerald-700 border-emerald-200/50 dark:bg-emerald-950/20 dark:text-emerald-400">公共区</Badge>
                                <span className="truncate max-w-[100px]">
                                  {r.questionKeys?.join(',') || '未设置范围'}
                                </span>
                              </div>
                              <span className="text-[10px] text-zinc-500">
                                {r.segments.length} 个选区
                              </span>
                              
                              {!isFinalized && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDeleteRegion(r.id)
                                  }}
                                  className="absolute right-2 opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-650 transition-opacity p-0.5 cursor-pointer"
                                  title="删除此公共选区"
                                >
                                  <Trash2 className="size-3" />
                                </button>
                              )}
                            </div>

                            {r.segments.length > 0 && (
                              <div className="mt-2 space-y-1.5 w-full">
                                {r.segments.map((seg, sIdx) => (
                                  <div 
                                    key={sIdx}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setSelectedRegionId(r.id)
                                      handleBlockClick(r.id, r.sourceRunId, seg.page)
                                    }}
                                    className="w-full hover:ring-1 hover:ring-emerald-500 rounded-md transition-all"
                                  >
                                    <SegmentPreview runId={r.sourceRunId} segment={seg} />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        </aside>

        {/* Center: Canvas Workspace Area */}
        <main className="flex-1 flex flex-col bg-zinc-50 dark:bg-zinc-950 overflow-hidden relative">
          {/* Canvas Subheader with Controls */}
          <div className="flex h-11 items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 px-4">
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-zinc-500 flex items-center gap-1">
                <span>正在浏览:</span>
                <span className="font-semibold text-zinc-700 dark:text-zinc-300 truncate max-w-[120px] md:max-w-xs">{selectedRun?.pdfName}</span>
              </span>
              <div className="flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-900 rounded-lg p-0.5 border border-zinc-200 dark:border-zinc-800">
                <button
                  onClick={() => rememberPage(selectedRunId, Math.max(1, currentPage - 1))}
                  disabled={currentPage <= 1}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 dark:text-zinc-400 hover:bg-white dark:hover:bg-zinc-950 hover:text-zinc-900 dark:hover:text-zinc-50 disabled:opacity-30 transition-all cursor-pointer"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="text-xs font-semibold px-2 min-w-[50px] text-center text-zinc-700 dark:text-zinc-300">
                  {currentPage} / {currentRunPages || 1} 页
                </span>
                <button
                  onClick={() => rememberPage(selectedRunId, Math.min(currentRunPages, currentPage + 1))}
                  disabled={currentPage >= currentRunPages}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-555 dark:text-zinc-400 hover:bg-white dark:hover:bg-zinc-950 hover:text-zinc-900 dark:hover:text-zinc-50 disabled:opacity-30 transition-all cursor-pointer"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>

            {/* Layout controls */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-900 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-[11px] font-medium">
                <button 
                  onClick={() => setFitMode('width')}
                  className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${fitMode === 'width' ? 'bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-sm border border-zinc-200/20' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'}`}
                >
                  适应宽度
                </button>
                <button 
                  onClick={() => setFitMode('page')}
                  className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${fitMode === 'page' ? 'bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-sm border border-zinc-200/20' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'}`}
                >
                  适应全页
                </button>
              </div>

              <div className="flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-900 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-[11px] font-medium">
                <button 
                  onClick={() => setZoom(prev => Math.max(50, prev - 10))}
                  className="h-6 w-6 flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-white dark:hover:bg-zinc-950 hover:text-zinc-900 dark:hover:text-zinc-50 rounded-md transition-all cursor-pointer"
                >
                  <ZoomOut className="size-3.5" />
                </button>
                <span className="px-1 text-[11px] font-semibold min-w-[36px] text-center text-zinc-700 dark:text-zinc-300">
                  {zoom}%
                </span>
                <button 
                  onClick={() => setZoom(prev => Math.min(300, prev + 10))}
                  className="h-6 w-6 flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-white dark:hover:bg-zinc-950 hover:text-zinc-900 dark:hover:text-zinc-50 rounded-md transition-all cursor-pointer"
                >
                  <ZoomIn className="size-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Canvas Outer view */}
          <div className="flex-1 overflow-auto flex items-start justify-center p-4 bg-zinc-100/50 dark:bg-zinc-900/10">
            <div 
              ref={imageContainerRef}
              onMouseDown={isFinalized ? undefined : handleMouseDown}
              onMouseMove={isFinalized ? undefined : handleMouseMove}
              onMouseUp={isFinalized ? undefined : handleMouseUp}
              className="relative select-none bg-white shadow-md border border-zinc-200 dark:border-zinc-800 transition-all origin-top"
              style={{
                width: fitMode === 'width' ? '100%' : 'auto',
                maxWidth: fitMode === 'width' ? '900px' : 'none',
                height: fitMode === 'page' ? 'calc(100vh - 12rem)' : 'auto',
                transform: fitMode === 'none' ? `scale(${zoom / 100})` : 'none',
              }}
            >
              {selectedRunId ? (
                <img
                  ref={imageRef}
                  src={`/api/tools/pdf-slicer/runs/${selectedRunId}/pages/${currentPage}`}
                  alt={`PDF page ${currentPage}`}
                  className="w-full h-full object-contain select-none pointer-events-none"
                  draggable={false}
                />
              ) : null}

              {/* Drawn Regions overlay */}
              {pageRegions.map((region) => {
                const isSel = region.id === selectedRegionId
                return region.segments.map((seg, idx) => {
                  if (seg.page !== currentPage) return null
                  return (
                    <div
                      key={`${region.id}_${idx}`}
                      className={`absolute border-2 rounded transition-colors group/box flex flex-col justify-start items-start ${getKindColorClass(region.kind, isSel)} ${isFinalized ? '' : 'cursor-move'}`}
                      style={{
                        left: `${seg.x * 100}%`,
                        top: `${seg.y * 100}%`,
                        width: `${seg.width * 100}%`,
                        height: `${seg.height * 100}%`,
                      }}
                      onMouseDown={(e) => handleSegMouseDown(e, region.id, idx, seg)}
                    >
                      {/* Box badge info */}
                      <div className="absolute left-0 top-0 translate-y-[-100%] bg-zinc-900 text-zinc-50 dark:bg-zinc-150 dark:text-zinc-900 text-[9px] px-1.5 py-0.5 rounded-t-md font-semibold flex items-center gap-1 pointer-events-none select-none border border-b-0 border-zinc-850 dark:border-zinc-250">
                        <span>
                          {region.kind === 'shared_answer_key'
                            ? `公共:${region.questionKeys?.join(',')}`
                            : `${region.questionLabel}题`
                          }
                        </span>
                        {region.segments.length > 1 && (
                          <span className="opacity-60">({idx+1}/{region.segments.length})</span>
                        )}
                      </div>

                      {/* Hover delete handle for segments */}
                      {!isFinalized && (
                        <button
                          onMouseDown={(e) => e.stopPropagation()} // 防止触发拖拽
                          onClick={(e) => {
                            e.stopPropagation()
                            // Remove only this segment
                            const nextSegs = region.segments.filter((_, sIdx) => sIdx !== idx)
                            const nextRegions = regions.map(r => r.id === region.id ? { ...r, segments: nextSegs } : r)
                            pushHistory(nextRegions)
                          }}
                          className="absolute right-1 top-1 opacity-0 group-hover/box:opacity-100 bg-white dark:bg-zinc-900 text-red-600 dark:text-red-400 rounded-md border border-zinc-200 dark:border-zinc-800 p-0.5 hover:bg-red-50 dark:hover:bg-red-950/30 transition-opacity shadow-sm cursor-pointer z-20"
                          title="删除此选区"
                        >
                          <Trash2 className="size-2.5" />
                        </button>
                      )}

                      {/* Resize handles */}
                      {!isFinalized && isSel && (
                        <>
                          <div 
                            onMouseDown={(e) => handleHandleMouseDown(e, region.id, idx, seg, 'nw')}
                            className={`${getHandleClassName(region.kind)} top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize`} 
                          />
                          <div 
                            onMouseDown={(e) => handleHandleMouseDown(e, region.id, idx, seg, 'n')}
                            className={`${getHandleClassName(region.kind)} top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize`} 
                          />
                          <div 
                            onMouseDown={(e) => handleHandleMouseDown(e, region.id, idx, seg, 'ne')}
                            className={`${getHandleClassName(region.kind)} top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize`} 
                          />
                          <div 
                            onMouseDown={(e) => handleHandleMouseDown(e, region.id, idx, seg, 'e')}
                            className={`${getHandleClassName(region.kind)} top-1/2 right-0 translate-x-1/2 -translate-y-1/2 cursor-ew-resize`} 
                          />
                          <div 
                            onMouseDown={(e) => handleHandleMouseDown(e, region.id, idx, seg, 'se')}
                            className={`${getHandleClassName(region.kind)} bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize`} 
                          />
                          <div 
                            onMouseDown={(e) => handleHandleMouseDown(e, region.id, idx, seg, 's')}
                            className={`${getHandleClassName(region.kind)} bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize`} 
                          />
                          <div 
                            onMouseDown={(e) => handleHandleMouseDown(e, region.id, idx, seg, 'sw')}
                            className={`${getHandleClassName(region.kind)} bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize`} 
                          />
                          <div 
                            onMouseDown={(e) => handleHandleMouseDown(e, region.id, idx, seg, 'w')}
                            className={`${getHandleClassName(region.kind)} top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize`} 
                          />
                        </>
                      )}
                    </div>
                  )
                })
              })}

              {/* Temporary rect during drawing */}
              {tempRect && (
                <div
                  className="absolute border-2 border-dashed border-sky-400 bg-sky-400/10 pointer-events-none"
                  style={{
                    left: `${tempRect.x * 100}%`,
                    top: `${tempRect.y * 100}%`,
                    width: `${tempRect.w * 100}%`,
                    height: `${tempRect.h * 100}%`,
                  }}
                />
              )}

              {/* Click prompt overlay if no regions selected */}
              {!selectedRegionId && !isFinalized && (
                <div className="absolute inset-0 bg-zinc-500/5 flex items-center justify-center pointer-events-none">
                  <div className="bg-amber-50 dark:bg-amber-955/20 text-amber-800 dark:text-amber-400 border border-amber-250/80 dark:border-amber-900/50 rounded-xl px-4 py-2 text-xs flex items-center gap-2 shadow-sm font-medium">
                    <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
                    <span>请在左侧选择或新建题目，再在页面上拖拽框选。</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Double Column Split Layout Switch bar for wide layout */}
          {isDoubleLayout && runs.length > 1 && (
            <div className="absolute right-4 bottom-4 z-50 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900 shadow-sm"
                onClick={() => {
                  const alt = runs.find(r => r.runId !== selectedRunId)
                  if (alt) {
                    switchRun(alt.runId)
                  }
                }}
              >
                <Maximize2 className="size-3.5 mr-1" />
                切换至
                {runs.find(r => r.runId !== selectedRunId)?.fileRole === 'questions' ? '原卷 PDF' : '解析 PDF'}
              </Button>
            </div>
          )}
        </main>

        {/* Right Bar: Attribute settings panel */}
        <aside className="w-80 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex flex-col p-4 space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">选区属性面板</h2>

          {activeRegion ? (
            <div className="space-y-4 flex-1 flex flex-col">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 block">选区类型</label>
                <div className="grid grid-cols-3 gap-1 bg-zinc-100 dark:bg-zinc-900 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-800/85">
                  <button
                    disabled={isFinalized}
                    onClick={() => {
                      const next = regions.map(r => r.id === activeRegion.id ? { ...r, kind: 'question' as const } : r)
                      pushHistory(next)
                    }}
                    className={`py-1 text-[11px] rounded-md text-center font-medium cursor-pointer transition-all ${
                      activeRegion.kind === 'question' 
                        ? 'bg-white dark:bg-zinc-950 text-indigo-650 dark:text-indigo-400 shadow-sm border border-zinc-200/20' 
                        : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                    }`}
                  >
                    题干
                  </button>
                  <button
                    disabled={isFinalized}
                    onClick={() => {
                      const next = regions.map(r => r.id === activeRegion.id ? { ...r, kind: 'solution' as const } : r)
                      pushHistory(next)
                    }}
                    className={`py-1 text-[11px] rounded-md text-center font-medium cursor-pointer transition-all ${
                      activeRegion.kind === 'solution' 
                        ? 'bg-white dark:bg-zinc-950 text-amber-655 dark:text-amber-400 shadow-sm border border-zinc-200/20' 
                        : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                    }`}
                  >
                    解析
                  </button>
                  <button
                    disabled={isFinalized}
                    onClick={() => {
                      const next = regions.map(r => r.id === activeRegion.id ? { ...r, kind: 'shared_answer_key' as const } : r)
                      pushHistory(next)
                    }}
                    className={`py-1 text-[11px] rounded-md text-center font-medium cursor-pointer transition-all ${
                      activeRegion.kind === 'shared_answer_key' 
                        ? 'bg-white dark:bg-zinc-950 text-emerald-600 dark:text-emerald-400 shadow-sm border border-zinc-200/20' 
                        : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                    }`}
                  >
                    公共区
                  </button>
                </div>
              </div>

              {activeRegion.kind !== 'shared_answer_key' ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 block">绑定题号</label>
                    {!isFinalized && activeRegion.questionLabel !== '1' && (
                      <button
                        type="button"
                        onClick={() => handleLabelChange(activeRegion.id, '1')}
                        className="text-[10px] text-indigo-650 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 font-semibold cursor-pointer transition-colors"
                      >
                        设为第一题
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    disabled={isFinalized}
                    value={activeRegion.questionLabel}
                    onChange={(e) => handleLabelChange(activeRegion.id, e.target.value)}
                    className="flex h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus-visible:ring-1 focus-visible:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus-visible:ring-zinc-100"
                    placeholder="例如：5"
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 block">关联题目范围</label>
                  <input
                    type="text"
                    disabled={isFinalized}
                    value={activeRegion.questionKeys?.join(', ') || ''}
                    onChange={(e) => handleSharedKeysChange(activeRegion.id, e.target.value)}
                    className="flex h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus-visible:ring-1 focus-visible:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus-visible:ring-zinc-100"
                    placeholder="例如：1, 2, 3, 4, 5"
                  />
                  <p className="text-[10px] text-zinc-500 leading-normal">
                    框选区域将作为这些题目的补充解析（例如单选题快速答案表）。
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-zinc-550 dark:text-zinc-400 block">备注 / 说明</label>
                <textarea
                  disabled={isFinalized}
                  value={activeRegion.note}
                  onChange={(e) => handleNoteChange(activeRegion.id, e.target.value)}
                  className="flex min-h-[80px] w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus-visible:ring-1 focus-visible:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus-visible:ring-zinc-100 resize-y"
                  placeholder="可在此处填写该题的备注信息或文本内容..."
                />
              </div>

              {/* Segment List under active region */}
              <div className="flex-1 flex flex-col overflow-hidden min-h-[150px]">
                <div className="flex items-center justify-between border-t border-zinc-200 dark:border-zinc-800 pt-3 mb-2">
                  <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">已标注的框块</span>
                  {activeRegion.segments.length > 0 && !isFinalized && (
                    <button
                      onClick={() => handleClearSegments(activeRegion.id)}
                      className="text-[10px] text-red-600 hover:text-red-500 font-semibold cursor-pointer"
                    >
                      清空框块
                    </button>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                  {activeRegion.segments.length === 0 ? (
                    <div className="text-[10px] text-zinc-500 py-3.5 px-3.5 text-center leading-relaxed bg-zinc-50/50 dark:bg-zinc-900/30 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800">
                      该题目当前无标注框块。<br />
                      请在上方 PDF 画布中拖拽绘制。<br />
                      <div className="mt-2 text-indigo-600 dark:text-indigo-400 font-semibold flex items-center justify-center gap-0.5">
                        <span>💡 支持跨页题：</span>
                      </div>
                      <p className="text-[9px] text-zinc-400 mt-0.5">您可以直接翻页并在新页面继续绘制，所有框块均会关联到此题。</p>
                    </div>
                  ) : (
                    activeRegion.segments.map((seg, sIdx) => (
                      <div 
                        key={sIdx} 
                        onClick={() => handleBlockClick(activeRegion.id, activeRegion.sourceRunId, seg.page)}
                        className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-700 rounded-lg p-2 text-[10px] text-zinc-700 dark:text-zinc-400 flex items-center justify-between cursor-pointer transition-all shadow-2xs"
                      >
                        <div className="flex flex-col">
                          <span className="font-semibold text-zinc-800 dark:text-zinc-300">块 #{sIdx + 1}</span>
                          <span>第 {seg.page} 页 | X:{seg.x.toFixed(2)} Y:{seg.y.toFixed(2)}</span>
                        </div>
                        {!isFinalized && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              const nextSegs = activeRegion.segments.filter((_, idx) => idx !== sIdx)
                              const nextRegions = regions.map(r => r.id === activeRegion.id ? { ...r, segments: nextSegs } : r)
                              pushHistory(nextRegions)
                            }}
                            className="text-zinc-500 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                          >
                            删除
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
                {activeRegion.segments.length > 0 && !isFinalized && (
                  <div className="mt-2 text-[9px] text-zinc-400 dark:text-zinc-500 bg-zinc-50/50 dark:bg-zinc-900/30 p-2 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 leading-normal">
                    <span className="font-semibold text-zinc-500 dark:text-zinc-400">💡 跨页题提示：</span>
                    您可以直接翻页并在新页面继续框选，所有框块都将合并归属在此题下。
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden space-y-3">
              <div className="flex flex-col items-center justify-center p-4 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl bg-zinc-50/10 text-center">
                <FileText className="size-8 text-zinc-300 dark:text-zinc-700 mb-2" />
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-normal">
                  在左侧或页面中选择一个标注选区以查看或编辑其属性。
                </p>
              </div>

              {allBlocks.length > 0 && (
                <div className="flex-1 flex flex-col overflow-hidden min-h-[200px]">
                  <div className="border-t border-zinc-200 dark:border-zinc-800 pt-3 mb-2">
                    <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                      所有已标注框块 ({allBlocks.length})
                    </span>
                    <p className="text-[10px] text-zinc-400 mt-0.5">点击框块可快速选中并定位</p>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                    {allBlocks.map((item, idx) => {
                      const runInfo = runs.find(r => r.runId === item.sourceRunId)
                      const isQuestions = runInfo?.fileRole === 'questions'
                      return (
                        <div 
                          key={idx} 
                          onClick={() => handleBlockClick(item.regionId, item.sourceRunId, item.segment.page)}
                          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-700 rounded-lg p-2 text-[10px] text-zinc-650 dark:text-zinc-450 flex items-center justify-between cursor-pointer transition-all hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50 shadow-xs"
                        >
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <Badge className={`text-[9px] px-1.5 py-0 ${getBadgeColor(item.regionKind)}`}>
                                {getLabelName(item.regionKind)}
                              </Badge>
                              <span className="font-semibold text-zinc-800 dark:text-zinc-300">
                                {item.regionKind === 'shared_answer_key'
                                  ? `公共:${item.regionKeys?.join(',')}`
                                  : `第 ${item.regionLabel} 题`
                                }
                              </span>
                            </div>
                            <span className="text-[10px] text-zinc-500">
                              第 {item.segment.page} 页 | 块 #{item.segmentIdx + 1}
                            </span>
                          </div>
                          <Badge variant="outline" className="text-[9px] px-1 bg-zinc-50 dark:bg-zinc-950/20 text-zinc-500 border-zinc-200 dark:border-zinc-800">
                            {isQuestions ? '原卷' : '解析'}
                          </Badge>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Validation / Errors Dialog Modal */}
      {showValidationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 text-zinc-900 dark:text-zinc-50 shadow-lg animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-900 pb-3 mb-4">
              {validation.errors.length > 0 ? (
                <>
                  <AlertTriangle className="size-5 text-red-600 dark:text-red-400" />
                  <h3 className="text-base font-semibold">无法完成标注提交</h3>
                </>
              ) : (
                <>
                  <AlertTriangle className="size-5 text-amber-600 dark:text-amber-400" />
                  <h3 className="text-base font-semibold">校验警告提示</h3>
                </>
              )}
            </div>

            {/* Error logs */}
            {validation.errors.length > 0 && (
              <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50/30 p-3 text-red-800 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400 mb-4 max-h-48 overflow-y-auto">
                <AlertTriangle className="size-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                <div className="space-y-1 text-xs">
                  <p className="font-semibold text-red-900 dark:text-red-300">请修复以下阻断性错误后再重新提交：</p>
                  <ul className="list-disc pl-4 space-y-1 leading-normal text-red-800/90 dark:text-red-300/90">
                    {validation.errors.map((e, idx) => <li key={idx}>{e}</li>)}
                  </ul>
                </div>
              </div>
            )}

            {/* Warning logs */}
            {validation.warnings.length > 0 && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/30 p-3 text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-400 mb-6 max-h-48 overflow-y-auto">
                <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="space-y-1 text-xs">
                  <p className="font-semibold text-amber-900 dark:text-amber-300">
                    {validation.errors.length === 0 ? '检测到以下潜在的标注异常，您确认要直接忽略并强制提交吗？' : '其他潜在警告：'}
                  </p>
                  <ul className="list-disc pl-4 space-y-1 leading-normal text-amber-800/90 dark:text-amber-300/90">
                    {validation.warnings.map((w, idx) => <li key={idx}>{w}</li>)}
                  </ul>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-zinc-100 dark:border-zinc-900 pt-4">
              <Button
                variant="outline"
                className="h-9 text-xs border-zinc-200 bg-white text-zinc-705 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 h-9 px-4 py-2"
                onClick={() => setShowValidationModal(false)}
              >
                取消返回
              </Button>
              {validation.errors.length === 0 && (
                <Button
                  className="h-9 text-xs bg-zinc-900 text-zinc-50 hover:bg-zinc-900/90 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-50/90 font-semibold h-9 px-4 py-2"
                  disabled={finalizing}
                  onClick={executeFinalize}
                >
                  {finalizing ? '提交中...' : '忽略并强制提交'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Revise Revision Modal */}
      {showReviseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 text-zinc-900 dark:text-zinc-50 shadow-lg animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-semibold mb-2 text-zinc-900 dark:text-zinc-50">确认重新启用框选标注？</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-normal mb-5">
              此操作将为该批次文件创建一个新的标注修订版本（Revision Draft），当前已生成的题块结果将被保留以作追溯，您可以在新草稿上修改并再次提交物化。
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                className="h-9 text-xs border-zinc-200 bg-white text-zinc-705 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 h-9 px-4 py-2"
                onClick={() => setShowReviseModal(false)}
              >
                取消
              </Button>
              <Button
                className="h-9 text-xs bg-zinc-900 text-zinc-50 hover:bg-zinc-900/90 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-50/90 font-semibold h-9 px-4 py-2"
                disabled={finalizing}
                onClick={handleRevise}
              >
                {finalizing ? '创建中...' : '确认创建'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

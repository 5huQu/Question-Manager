import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import { importV2Api } from '@/api/importV2'
import { pdfSlicerApi } from '@/api/pdfSlicer'
import { Button } from '@/components/ui'
import { BBoxCanvas, type BBoxCanvasBox } from '@/components/questions/BBoxCanvas'
import type { BBox } from '@/types'
import {
  displayRectToSegment,
  figureIds,
  isHeaderFooterBbox,
  isHeaderFooterSegment,
  normalizeSegmentForSave,
  regionMatchesFigure,
  removeFigureMarkers,
  removeFigureMarkersByIds,
  segmentToDisplayRect,
} from '@/utils/manualFix'
import { ManualFixInspector } from '@/components/import-v2/manual-fix/ManualFixInspector'
import { ManualFixHeader } from '@/components/import-v2/manual-fix/ManualFixHeader'
import { ManualFixViewerToolbar } from '@/components/import-v2/manual-fix/ManualFixViewerToolbar'
import type { ManualFixRegion as Region, ManualFixSegment as Segment, ManualFixTab } from '@/components/import-v2/manual-fix/types'

interface SourceProfile {
  pageCount?: number
  pdfName?: string
}

function createRegionId() {
  return `reg_${globalThis.crypto.randomUUID()}`
}

export default function CandidateFixWorkbenchPage() {
  const { sourceDocumentId: sourceDocumentIdFromPath, candidateId } = useParams<{ sourceDocumentId: string; candidateId: string }>()
  const [searchParams] = useSearchParams()
  const sourceDocumentIdFromQuery = searchParams.get('sourceDocumentId') || ''
  const sourceDocumentId = sourceDocumentIdFromPath || sourceDocumentIdFromQuery
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [activeInspectorTab, setActiveInspectorTab] = useState<ManualFixTab>('content')
  const [candidate, setCandidate] = useState<any>(null)
  const [session, setSession] = useState<any>(null)

  // Markdown Texts
  const [stemMarkdown, setStemMarkdown] = useState('')
  const [answerText, setAnswerText] = useState('')
  const [analysisMarkdown, setAnalysisMarkdown] = useState('')
  const [figures, setFigures] = useState<any[]>([])

  // Annotation Region state
  const [regions, setRegions] = useState<Region[]>([])
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)

  // PDF Page navigation
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [sourceProfiles, setSourceProfiles] = useState<Record<string, SourceProfile>>({})
  const [activeSourceDocumentId, setActiveSourceDocumentId] = useState('')
  const [pageBrowseMode, setPageBrowseMode] = useState<'manual' | 'continuous'>('continuous')
  const [regionView, setRegionView] = useState<'all' | 'question' | 'solution'>('all')
  const [initialFocusTarget, setInitialFocusTarget] = useState<{ sourceRunId?: string; page: number; regionId?: string } | null>(null)

  // Canvas interaction
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  const [viewportWidth, setViewportWidth] = useState(0)
  const [rect, setRect] = useState<BBox>({ x: 0, y: 0, width: 0, height: 0 })

  const pageImageRefs = useRef<Map<number, { current: HTMLImageElement | null }>>(new Map())
  const pageContainerRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
  const activeProfile = sourceProfiles[activeSourceDocumentId] || (candidate?.sourceDocumentId ? sourceProfiles[candidate.sourceDocumentId] : undefined)
  const maxPages = Math.max(1, Number(activeProfile?.pageCount || 1))
  const pdfName = activeProfile?.pdfName || '原始 PDF 文件'
  const sourceProfileEntries = Object.entries(sourceProfiles)

  // Load candidate and restore manual-fix session
  useEffect(() => {
    if (!candidateId || !sourceDocumentId) return
    loadCandidateAndSession(sourceDocumentId, candidateId)
  }, [candidateId, sourceDocumentId])

  async function loadCandidateAndSession(nextSourceDocumentId: string, nextCandidateId: string) {
    try {
      setLoading(true)
      // 1. 获取 Candidate 信息
      const data = await importV2Api.listCandidates(nextSourceDocumentId)
      const currentCandidate = data.items.find(item => item.id === nextCandidateId)
      if (!currentCandidate) {
        throw new Error('未找到当前候选题目。')
      }
      setCandidate(currentCandidate)
      setStemMarkdown(currentCandidate.stemMarkdown || '')
      setAnswerText(currentCandidate.answerText || '')
      setAnalysisMarkdown(currentCandidate.analysisMarkdown || '')
      setFigures(currentCandidate.figures || [])

      // 2. 创建或恢复修正 Session
      const sess = await importV2Api.createManualFixSession(nextCandidateId)
      setSession(sess)
      setRegions(sess.regions || [])

      // 3. 从 Session Profile 里获取 PDF 基本信息
      const profiles = JSON.parse(sess.sourceProfileJson || '{}')
      setSourceProfiles(profiles)
      setActiveSourceDocumentId(currentCandidate.sourceDocumentId)

      // 4. 进入编辑时默认定位到题干选区开始处，而不是题图位置。
      const initialTarget = initialQuestionRegion(sess.regions || [])
      const initialRegion = initialTarget?.region
      const initialSegment = initialTarget?.segment
      const fallbackRegion = (sess.regions || []).find((r: any) => r.segments && r.segments.length > 0)
      const fallbackSegment = fallbackRegion?.segments?.[0]
      const targetRegion = initialRegion || fallbackRegion
      const targetSegment = initialSegment || fallbackSegment
      if (targetRegion && targetSegment) {
        setSelectedRegionId(targetRegion.id)
        setActiveSourceDocumentId(targetRegion.sourceRunId || currentCandidate.sourceDocumentId)
        setCurrentPage(targetSegment.page)
        setInitialFocusTarget({ sourceRunId: targetRegion.sourceRunId || currentCandidate.sourceDocumentId, page: targetSegment.page, regionId: targetRegion.id })
      } else {
        setCurrentPage(1)
        setInitialFocusTarget({ sourceRunId: currentCandidate.sourceDocumentId, page: 1 })
      }
    } catch (err) {
      console.error(err)
      window.alert('加载手动修正会话失败：' + (err instanceof Error ? err.message : String(err)))
      navigateBack()
    } finally {
      setLoading(false)
    }
  }

  function initialQuestionRegion(regionList: Region[]) {
    return regionList
      .filter((region) => region.kind === 'question' && region.segments.length > 0)
      .map((region) => ({
        region,
        firstSegment: [...region.segments].sort((left, right) => left.page - right.page || left.y - right.y)[0],
      }))
      .sort((left, right) => left.firstSegment.page - right.firstSegment.page || left.firstSegment.y - right.firstSegment.y)
      .map((item) => ({ region: item.region, segment: item.firstSegment }))[0] || null
  }

  useEffect(() => {
    if (loading || !initialFocusTarget) return
    const target = initialFocusTarget
    if (target.sourceRunId && target.sourceRunId !== activeSourceDocumentId) {
      setActiveSourceDocumentId(target.sourceRunId)
      return
    }
    const timer = window.setTimeout(() => {
      if (target.regionId) setSelectedRegionId(target.regionId)
      focusPage(target.page, { scroll: true })
      setInitialFocusTarget(null)
    }, 80)
    return () => window.clearTimeout(timer)
  }, [activeSourceDocumentId, initialFocusTarget, loading])

  useEffect(() => {
    setCurrentPage((page) => Math.min(maxPages, Math.max(1, page)))
  }, [activeSourceDocumentId, maxPages])

  function navigateBack() {
    const currentSourceDocumentId = candidate?.sourceDocumentId || sourceDocumentId
    if (currentSourceDocumentId && candidateId) {
      navigate(`/tools/import/documents/${encodeURIComponent(currentSourceDocumentId)}/candidates/${encodeURIComponent(candidateId)}`)
    } else if (currentSourceDocumentId) {
      navigate(`/tools/import/documents/${encodeURIComponent(currentSourceDocumentId)}/candidates`)
    } else {
      navigate('/tools/import')
    }
  }

  // Double columns layout helper
  function getPageImageRef(page: number) {
    const existing = pageImageRefs.current.get(page)
    if (existing) return existing
    const ref = { current: null as HTMLImageElement | null }
    pageImageRefs.current.set(page, ref)
    return ref
  }

  function imageSize(page = currentPage) {
    const bounds = getPageImageRef(page).current?.getBoundingClientRect()
    return bounds ? { width: bounds.width, height: bounds.height } : { width: 0, height: 0 }
  }

  // Map absolute Display Rect (in pixels) to Relative Segment (%)
  function normalizedRegionsForSave() {
    return regions.map((region) => ({
      ...region,
      segments: region.segments.map((segment) => normalizeSegmentForSave(segment, naturalSize)).filter(Boolean) as Segment[],
    }))
  }

  useEffect(() => {
    if (!selectedRegionId || naturalSize.width <= 0 || naturalSize.height <= 0) return
    const region = regions.find((item) => item.id === selectedRegionId)
    const segment = region?.segments.find((item) => item.page === currentPage)
    if (segment) setRectFromSegment(segment)
  }, [currentPage, naturalSize.height, naturalSize.width, regions, selectedRegionId])

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
      setActiveInspectorTab('regions')
      setSelectedRegionId(region.id)
      const seg = region.segments[0]
      if (seg) {
        focusRegion(region, seg)
      }
    }
  }

  // Handlers for drawing/updating boxes
  const handleRectChange = (newRect: BBox, page = currentPage) => {
    setCurrentPage(page)
    setRect(newRect)
    if (!selectedRegionId) return

    // Auto update selected region's segment
    const imgSize = imageSize(page)
    const segment = displayRectToSegment(newRect, imgSize, page)
    if (segment) {
      setRegions(current => current.map(r => {
        if (r.id === selectedRegionId) {
          return { ...r, segments: [segment] }
        }
        return r
      }))
    }
  }

  function setRectFromSegment(segment: Segment) {
    const displayRect = segmentToDisplayRect(segment, imageSize(segment.page))
    setRect(displayRect || { x: 0, y: 0, width: 0, height: 0 })
  }

  function focusPage(page: number, options: { scroll?: boolean } = {}) {
    const nextPage = Math.min(maxPages, Math.max(1, page))
    setCurrentPage(nextPage)
    if (options.scroll || pageBrowseMode === 'continuous') {
      window.setTimeout(() => {
        pageContainerRefs.current.get(nextPage)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
  }

  function scrollSegmentToCenter(segment: Segment) {
    const container = scrollAreaRef.current
    const image = getPageImageRef(segment.page).current
    if (!container || !image) {
      pageContainerRefs.current.get(segment.page)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    const containerRect = container.getBoundingClientRect()
    const imageRect = image.getBoundingClientRect()
    const centerY = imageRect.top - containerRect.top + container.scrollTop + (segment.y + segment.height / 2) * imageRect.height
    const centerX = imageRect.left - containerRect.left + container.scrollLeft + (segment.x + segment.width / 2) * imageRect.width
    container.scrollTo({
      top: Math.max(0, centerY - container.clientHeight / 2),
      left: Math.max(0, centerX - container.clientWidth / 2),
      behavior: 'smooth',
    })
  }

  function focusRegion(region: Region, segment = region.segments[0]) {
    if (!segment) return
    setSelectedRegionId(region.id)
    setActiveSourceDocumentId(region.sourceRunId || candidate?.sourceDocumentId || activeSourceDocumentId)
    setCurrentPage(segment.page)
    window.setTimeout(() => {
      setRectFromSegment(segment)
      scrollSegmentToCenter(segment)
    }, 120)
  }

  function inferredSourceDocumentIdForFigure(figure: any) {
    const explicitSourceDocumentId = String(figure.sourceDocumentId || '')
    if (explicitSourceDocumentId && sourceProfiles[explicitSourceDocumentId]) return explicitSourceDocumentId
    const path = String(figure.path || '')
    const match = /source-documents[\\/]+([^\\/]+)/.exec(path)
    if (match?.[1] && sourceProfiles[match[1]]) return match[1]
    if (String(figure.usage || '') === 'analysis') {
      const solutionEntry = sourceProfileEntries.find(([id]) => id !== candidate?.sourceDocumentId)
      if (solutionEntry?.[0]) return solutionEntry[0]
    }
    return ''
  }

  function figureRegion(figure: any) {
    const expectedSourceDocumentId = inferredSourceDocumentIdForFigure(figure)
    const matches = regions.filter((region) => regionMatchesFigure(region, figure))
    if (expectedSourceDocumentId) {
      return matches.find((region) => region.sourceRunId === expectedSourceDocumentId) || null
    }
    return matches[0] || null
  }

  function handleLocateFigure(figure: any) {
    setActiveInspectorTab('figures')
    const region = figureRegion(figure)
    if (region?.segments[0]) {
      focusRegion(region, region.segments[0])
      return
    }
    if (figure.pageNo) {
      const sourceId = sourceDocumentIdForFigure(figure)
      if (sourceId) setActiveSourceDocumentId(sourceId)
      setSelectedRegionId(null)
      setRect({ x: 0, y: 0, width: 0, height: 0 })
      const segment = segmentForFigure(figure)
      if (segment) {
        setCurrentPage(segment.page)
        window.setTimeout(() => scrollSegmentToCenter(segment), 120)
      } else {
        focusPage(Number(figure.pageNo), { scroll: true })
      }
    }
  }

  function sourceDocumentIdForFigure(figure: any) {
    const region = figureRegion(figure)
    if (region?.sourceRunId) return region.sourceRunId
    return inferredSourceDocumentIdForFigure(figure) || candidate?.sourceDocumentId || activeSourceDocumentId
  }

  function segmentForFigure(figure: any): Segment | null {
    const page = Number(figure.pageNo || 0)
    const bbox: number[] | null = Array.isArray(figure.bbox) ? figure.bbox.map(Number) : null
    if (!page || !bbox || bbox.length < 4 || !bbox.every(Number.isFinite)) return null
    const [left, top, right, bottom] = bbox
    if (right <= left || bottom <= top) return null
    if (bbox.every((value) => value >= 0 && value <= 1)) {
      return { page, x: left, y: top, width: right - left, height: bottom - top }
    }
    const image = getPageImageRef(page).current
    const naturalWidth = image?.naturalWidth || 0
    const naturalHeight = image?.naturalHeight || 0
    if (naturalWidth <= 0 || naturalHeight <= 0) return null
    return {
      page,
      x: left / naturalWidth,
      y: top / naturalHeight,
      width: (right - left) / naturalWidth,
      height: (bottom - top) / naturalHeight,
    }
  }

  function regionVisible(region: Region) {
    if (regionView === 'question') return region.kind === 'question'
    if (regionView === 'solution') return region.kind === 'solution'
    return true
  }

  function focusFirstRegion(nextView: 'all' | 'question' | 'solution') {
    const target = regions.find((region) => {
      if (!region.segments.length) return false
      if (nextView === 'question') return region.kind === 'question'
      if (nextView === 'solution') return region.kind === 'solution'
      return true
    })
    if (target) focusRegion(target, target.segments[0])
  }

  function handleRegionViewChange(nextView: 'all' | 'question' | 'solution') {
    setRegionView(nextView)
    focusFirstRegion(nextView)
  }

  function figureInHeaderFooterBand(figure: any) {
    const region = figureRegion(figure)
    if (region?.segments.some(isHeaderFooterSegment)) return true
    return isHeaderFooterBbox(figure.bbox)
  }

  function handleCleanHeaderFooter() {
    if (!window.confirm('将移除当前题目中位于页面顶部/底部窄条内的页眉、页脚图框与题图资源。确定继续吗？')) return
    const removedRegionIds = new Set(
      regions
        .filter((region) => region.segments.some(isHeaderFooterSegment))
        .map((region) => region.id)
    )
    const removedFigureIds = new Set<string>()
    const nextFigures = figures.filter((figure) => {
      const region = figureRegion(figure)
      const shouldRemove = (region && removedRegionIds.has(region.id)) || figureInHeaderFooterBand(figure)
      if (shouldRemove) figureIds(figure).forEach((id) => removedFigureIds.add(id))
      return !shouldRemove
    })

    setFigures(nextFigures)
    setRegions((current) => current.filter((region) => !removedRegionIds.has(region.id)))
    setStemMarkdown((current) => removeFigureMarkersByIds(current, removedFigureIds))
    setAnswerText((current) => removeFigureMarkersByIds(current, removedFigureIds))
    setAnalysisMarkdown((current) => removeFigureMarkersByIds(current, removedFigureIds))
    if (selectedRegionId && removedRegionIds.has(selectedRegionId)) {
      setSelectedRegionId(null)
      setRect({ x: 0, y: 0, width: 0, height: 0 })
    }
  }

  // Auto-save draft region coordinates
  useEffect(() => {
    if (!session || regions.length === 0 || loading) return
    const timer = setTimeout(async () => {
      try {
        setSaving(true)
        const updated = await pdfSlicerApi.saveAnnotationRegions(session.id, normalizedRegionsForSave(), session.revision)
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
      const updated = await pdfSlicerApi.saveAnnotationRegions(session.id, normalizedRegionsForSave(), session.revision)
      setSession(updated)
      if (candidateId) {
        const updatedCandidate = await importV2Api.updateCandidate(candidateId, {
          stemMarkdown,
          answerText,
          analysisMarkdown,
          figures,
        })
        setCandidate(updatedCandidate.candidate)
        setFigures(updatedCandidate.candidate.figures || [])
      }
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
      const saved = await pdfSlicerApi.saveAnnotationRegions(session.id, normalizedRegionsForSave(), session.revision)
      setSession(saved)
      if (candidateId) {
        const updated = await importV2Api.updateCandidate(candidateId, {
          stemMarkdown,
          answerText,
          analysisMarkdown,
          figures,
        })
        setCandidate(updated.candidate)
        setFigures(updated.candidate.figures || [])
      }

      // Post finalize with payload containing edited Markdown texts
      const finalizeUrl = `/api/tools/pdf-slicer/annotation-sessions/${encodeURIComponent(session.id)}/finalize`
      const res = await fetch(finalizeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stemMarkdown, answerText, analysisMarkdown })
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

    const sourceRunId = sourceRunIdForNewRegion(kind)
    const activeSourceId = activeSourceDocumentId || candidate.sourceDocumentId || ''
    const drawnSegment = sourceRunId === activeSourceId
      ? displayRectToSegment(rect, imageSize(currentPage), currentPage)
      : null
    const newReg: Region = {
      id: createRegionId(),
      sourceRunId,
      kind,
      questionLabel: label,
      questionKeys: [],
      segments: drawnSegment ? [drawnSegment] : [],
      sortOrder: regions.length,
      note
    }

    setRegions([...regions, newReg])
    setSelectedRegionId(newReg.id)
    setActiveSourceDocumentId(sourceRunId)
    if (!drawnSegment) {
      setRect({ x: 0, y: 0, width: 0, height: 0 })
    }
  }

  function sourceRunIdForNewRegion(kind: Region['kind']) {
    if (kind === 'solution') {
      return sourceProfileEntries.find(([id]) => id !== candidate?.sourceDocumentId)?.[0]
        || activeSourceDocumentId
        || candidate?.sourceDocumentId
        || ''
    }
    return activeSourceDocumentId || candidate?.sourceDocumentId || ''
  }

  // Delete selected region
  const handleDeleteSelected = () => {
    if (!selectedRegionId) return
    setRegions(current => current.filter(r => r.id !== selectedRegionId))
    setSelectedRegionId(null)
    setRect({ x: 0, y: 0, width: 0, height: 0 })
  }

  function handleDeleteFigure(figure: any) {
    if (!window.confirm('确定删除这张题图吗？相关正文占位符也会一并移除。')) return
    const ids = [figure.id, figure.blockId, figure.sourceBlockId].filter(Boolean).map(String)
    const matchesFigureRegion = (region: Region) => {
      if (region.kind !== 'shared_answer_key') return false
      const regionFigureIds = (region.questionKeys || []).map(String)
      if (ids.some((id) => regionFigureIds.includes(id))) return true
      const bbox = Array.isArray(figure.bbox) ? figure.bbox.map(Number) : null
      const segment = region.segments[0]
      if (!bbox || !segment || Number(segment.page) !== Number(figure.pageNo || 0)) return false
      const regionBbox = [segment.x, segment.y, segment.x + segment.width, segment.y + segment.height]
      return regionBbox.every((value, index) => Math.abs(value - bbox[index]) < 0.01)
    }
    setFigures((current) => current.filter((item) => item !== figure && item.id !== figure.id))
    setRegions((current) => current.filter((region) => !matchesFigureRegion(region)))
    if (selectedRegionId && regions.some((region) => region.id === selectedRegionId && matchesFigureRegion(region))) {
      setSelectedRegionId(null)
      setRect({ x: 0, y: 0, width: 0, height: 0 })
    }
    setStemMarkdown((current) => removeFigureMarkers(current, figure))
    setAnswerText((current) => removeFigureMarkers(current, figure))
    setAnalysisMarkdown((current) => removeFigureMarkers(current, figure))
  }

  // Helpers for mapping regions to Canvas Boxes
  function canvasBoxesForPage(page: number): BBoxCanvasBox[] {
    return regions.flatMap((region, idx) => {
      if (region.sourceRunId !== activeSourceDocumentId) return []
      if (!regionVisible(region)) return []
      return region.segments
        .filter(seg => seg.page === page)
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
  }

  function selectedBoxIdForPage(page: number) {
    if (!selectedRegionId) return undefined
    const idx = regions.findIndex(r => r.sourceRunId === activeSourceDocumentId && regionVisible(r) && r.id === selectedRegionId && r.segments.some(seg => seg.page === page))
    return idx >= 0 ? String(idx) : undefined
  }

  const visiblePageNumbers = regionView === 'all'
    ? Array.from({ length: maxPages }, (_, index) => index + 1)
    : Array.from(new Set(regions.filter((region) => region.sourceRunId === activeSourceDocumentId && regionVisible(region)).flatMap((region) => region.segments.map((segment) => segment.page)))).sort((left, right) => left - right)
  const pageNumbers = visiblePageNumbers.length ? visiblePageNumbers : [currentPage]

  if (loading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <LoaderCircle className="size-8 animate-spin text-zinc-900 dark:text-zinc-100" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <ManualFixHeader candidate={candidate} pdfName={pdfName} saving={saving} finalizing={finalizing} onBack={navigateBack} onSaveDraft={handleSaveDraft} onFinalize={handleFinalizeFix} />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 h-[calc(100vh-7rem)] min-h-[680px] items-stretch overflow-hidden">
        {/* 左侧：PDF 渲染展示与划框区域 (7格) */}
        <div className="xl:col-span-7 flex flex-col border rounded-xl bg-zinc-50/50 dark:bg-zinc-955 overflow-hidden shadow-sm">
          <ManualFixViewerToolbar pageBrowseMode={pageBrowseMode} regionView={regionView} sourceProfiles={sourceProfileEntries} activeSourceDocumentId={activeSourceDocumentId} currentPage={currentPage} maxPages={maxPages} onBrowseModeChange={setPageBrowseMode} onRegionViewChange={handleRegionViewChange} onSourceChange={(sourceId) => { setActiveSourceDocumentId(sourceId); setCurrentPage(1); setRect({ x: 0, y: 0, width: 0, height: 0 }); setSelectedRegionId(null) }} onPageChange={(page) => { setCurrentPage(Math.min(maxPages, Math.max(1, page))); setRect({ x: 0, y: 0, width: 0, height: 0 }); setSelectedRegionId(null) }} />

          {/* 划框 Canvas 滚动区域 */}
          <div ref={scrollAreaRef} className="flex-1 overflow-auto p-4">
            {candidate && pageBrowseMode === 'manual' ? (
              <div className="mx-auto w-full max-w-[800px]">
                <div
                  ref={(node) => { pageContainerRefs.current.set(currentPage, node) }}
                  className="scroll-mt-4"
                >
                  <BBoxCanvas
                    key={`${activeSourceDocumentId}:${currentPage}`}
                    imageUrl={`/api/import-flow-v2/source-documents/${activeSourceDocumentId || candidate.sourceDocumentId}/pages/${currentPage}`}
                    boxes={canvasBoxesForPage(currentPage)}
                    selectedBoxId={selectedBoxIdForPage(currentPage)}
                    onSelectBoxId={handleSelectBoxId}
                    rect={rect}
                    onRectChange={(nextRect) => handleRectChange(nextRect, currentPage)}
                    onDeleteSelectedBox={handleDeleteSelected}
                    naturalSizeReady={setNaturalSize}
                    imageRef={getPageImageRef(currentPage)}
                  />
                </div>
              </div>
            ) : null}
            {candidate && pageBrowseMode === 'continuous' ? (
              <div className="mx-auto flex w-full max-w-[800px] flex-col gap-5">
                {pageNumbers.map((page) => (
                  <div
                    key={`${activeSourceDocumentId}:${page}`}
                    ref={(node) => { pageContainerRefs.current.set(page, node) }}
                    className="scroll-mt-4"
                  >
                    <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-500">
                      <span className="font-semibold text-zinc-700 dark:text-zinc-300">第 {page} 页</span>
                      <button
                        type="button"
                        onClick={() => focusPage(page, { scroll: true })}
                        className="rounded border border-zinc-200 bg-white px-2 py-1 font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                      >
                        设为当前页
                      </button>
                    </div>
                    <BBoxCanvas
                      key={`${activeSourceDocumentId}:${page}`}
                      imageUrl={`/api/import-flow-v2/source-documents/${activeSourceDocumentId || candidate.sourceDocumentId}/pages/${page}`}
                      boxes={canvasBoxesForPage(page)}
                      selectedBoxId={selectedBoxIdForPage(page)}
                      onSelectBoxId={handleSelectBoxId}
                      rect={currentPage === page ? rect : { x: 0, y: 0, width: 0, height: 0 }}
                      onRectChange={(nextRect) => handleRectChange(nextRect, page)}
                      onDeleteSelectedBox={handleDeleteSelected}
                      naturalSizeReady={(size) => {
                        if (currentPage === page) setNaturalSize(size)
                      }}
                      imageRef={getPageImageRef(page)}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <ManualFixInspector
          activeTab={activeInspectorTab}
          onTabChange={setActiveInspectorTab}
          candidate={candidate}
          stemMarkdown={stemMarkdown}
          answerText={answerText}
          analysisMarkdown={analysisMarkdown}
          figures={figures}
          regions={regions}
          selectedRegionId={selectedRegionId}
          onStemChange={setStemMarkdown}
          onAnswerChange={setAnswerText}
          onAnalysisChange={setAnalysisMarkdown}
          onAddRegion={handleAddNewRegion}
          onDeleteSelected={handleDeleteSelected}
          onRegionNoteChange={(note) => setRegions((current) => current.map((region) => region.id === selectedRegionId ? { ...region, note } : region))}
          onCleanHeaderFooter={handleCleanHeaderFooter}
          onLocateFigure={handleLocateFigure}
          onDeleteFigure={handleDeleteFigure}
        />
      </div>
    </div>
  )
}

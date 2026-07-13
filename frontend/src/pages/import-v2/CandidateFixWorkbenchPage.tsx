import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import type { BBoxCanvasBox } from '@/components/questions/BBoxCanvas'
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
import { ManualFixDocumentViewer } from '@/components/import-v2/manual-fix/ManualFixDocumentViewer'
import type { ManualFixRegion as Region, ManualFixSegment as Segment, ManualFixTab } from '@/components/import-v2/manual-fix/types'
import { useCandidateFixSession } from '@/hooks/useCandidateFixSession'

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

  const { loading, saving, finalizing, candidate, session, loadError, saveError, textDirty, setTextDirty, saveDraft, saveRegions, finalize } = useCandidateFixSession(sourceDocumentId, candidateId)
  const [activeInspectorTab, setActiveInspectorTab] = useState<ManualFixTab>('content')

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

  // Restore editor-local state after the controller has loaded the candidate/session.
  useEffect(() => {
    if (!candidate || !session) return
    setStemMarkdown(candidate.stemMarkdown || '')
    setAnswerText(candidate.answerText || '')
    setAnalysisMarkdown(candidate.analysisMarkdown || '')
    setFigures(candidate.figures || [])
    setRegions(session.regions || [])
    let profiles: Record<string, SourceProfile> = {}
    try { profiles = JSON.parse(session.sourceProfileJson || '{}') } catch { /* fall back to the candidate source */ }
    setSourceProfiles(profiles)
    setActiveSourceDocumentId(candidate.sourceDocumentId)

      // 4. 进入编辑时默认定位到题干选区开始处，而不是题图位置。
      const initialTarget = initialQuestionRegion(session.regions || [])
      const initialRegion = initialTarget?.region
      const initialSegment = initialTarget?.segment
      const fallbackRegion = (session.regions || []).find((r: any) => r.segments && r.segments.length > 0)
      const fallbackSegment = fallbackRegion?.segments?.[0]
      const targetRegion = initialRegion || fallbackRegion
      const targetSegment = initialSegment || fallbackSegment
      if (targetRegion && targetSegment) {
        setSelectedRegionId(targetRegion.id)
        setActiveSourceDocumentId(targetRegion.sourceRunId || candidate.sourceDocumentId)
        setCurrentPage(targetSegment.page)
        setInitialFocusTarget({ sourceRunId: targetRegion.sourceRunId || candidate.sourceDocumentId, page: targetSegment.page, regionId: targetRegion.id })
      } else {
        setCurrentPage(1)
        setInitialFocusTarget({ sourceRunId: candidate.sourceDocumentId, page: 1 })
      }
  }, [candidate?.id, session?.id])

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

  function navigateBack(skipUnsavedCheck = false) {
    if (!skipUnsavedCheck && textDirty && !window.confirm('内容尚未保存，确定离开当前页面吗？')) return
    const currentSourceDocumentId = candidate?.sourceDocumentId || sourceDocumentId
    if (currentSourceDocumentId && candidateId) {
      navigate(`/tools/import/documents/${encodeURIComponent(currentSourceDocumentId)}/candidates/${encodeURIComponent(candidateId)}`)
    } else if (currentSourceDocumentId) {
      navigate(`/tools/import/documents/${encodeURIComponent(currentSourceDocumentId)}/candidates`)
    } else {
      navigate('/tools/import')
    }
  }

  useEffect(() => {
    if (!textDirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [textDirty])

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
    if (removedFigureIds.size > 0) setTextDirty(true)
    if (selectedRegionId && removedRegionIds.has(selectedRegionId)) {
      setSelectedRegionId(null)
      setRect({ x: 0, y: 0, width: 0, height: 0 })
    }
  }

  // Auto-save draft region coordinates
  useEffect(() => {
    if (!session || regions.length === 0 || loading) return
    const timer = setTimeout(() => { void saveRegions(normalizedRegionsForSave()) }, 1200)
    return () => clearTimeout(timer)
  // Region changes are the autosave trigger; session revision updates must not restart the timer.
  }, [regions])

  // Save drafts manually
  async function handleSaveDraft() {
    if (!session) return
    try {
      const result = await saveDraft(normalizedRegionsForSave(), { stemMarkdown, answerText, analysisMarkdown, figures })
      if (result) setFigures(result.candidate.figures || [])
    } catch (err) {
      console.error('保存草稿失败：', err)
    }
  }

  // Finalize manual correction
  async function handleFinalizeFix() {
    if (!session) return
    const done = await finalize(normalizedRegionsForSave(), { stemMarkdown, answerText, analysisMarkdown, figures })
    if (done) navigateBack(true)
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
    setFigures((current) => current.filter((item) => item !== figure && item.id !== figure.id))
    setRegions((current) => current.filter((region) => !regionMatchesFigure(region, figure)))
    if (selectedRegionId && regions.some((region) => region.id === selectedRegionId && regionMatchesFigure(region, figure))) {
      setSelectedRegionId(null)
      setRect({ x: 0, y: 0, width: 0, height: 0 })
    }
    setStemMarkdown((current) => removeFigureMarkers(current, figure))
    setAnswerText((current) => removeFigureMarkers(current, figure))
    setAnalysisMarkdown((current) => removeFigureMarkers(current, figure))
    setTextDirty(true)
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
            boxClass = 'border-zinc-900 bg-zinc-100/15 dark:border-zinc-100 dark:bg-zinc-800/15'
            labelClass = 'bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900'
          } else if (region.kind === 'solution') {
            boxClass = 'border-amber-600 bg-amber-100/15 dark:border-amber-500 dark:bg-amber-950/15'
            labelClass = 'bg-amber-700 dark:bg-amber-600'
          } else {
            boxClass = 'border-zinc-500 border-dashed bg-zinc-100/10 dark:border-zinc-400 dark:bg-zinc-800/10'
            labelClass = 'bg-zinc-600 dark:bg-zinc-500'
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

  if (loadError || !candidate || !session) {
    return <div className="rounded-lg border border-red-200 bg-red-50/30 p-4 text-sm text-red-800 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">加载手动修正会话失败：{loadError || '未找到可用的修正会话。'}</div>
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <ManualFixHeader candidate={candidate} pdfName={pdfName} saving={saving} finalizing={finalizing} textDirty={textDirty} saveError={saveError} onBack={() => navigateBack()} onSaveDraft={handleSaveDraft} onFinalize={handleFinalizeFix} />

      <div className="grid h-auto grid-cols-1 items-stretch gap-5 overflow-visible xl:h-[calc(100vh-7rem)] xl:min-h-[680px] xl:grid-cols-12 xl:overflow-hidden">
        {/* 左侧：PDF 渲染展示与划框区域 (7格) */}
        <div className="flex min-h-[640px] flex-col overflow-hidden rounded-xl border bg-zinc-50/50 shadow-sm xl:col-span-7 xl:min-h-0 dark:bg-zinc-955">
          <ManualFixViewerToolbar pageBrowseMode={pageBrowseMode} regionView={regionView} sourceProfiles={sourceProfileEntries} activeSourceDocumentId={activeSourceDocumentId} currentPage={currentPage} maxPages={maxPages} onBrowseModeChange={setPageBrowseMode} onRegionViewChange={handleRegionViewChange} onSourceChange={(sourceId) => { setActiveSourceDocumentId(sourceId); setCurrentPage(1); setRect({ x: 0, y: 0, width: 0, height: 0 }); setSelectedRegionId(null) }} onPageChange={(page) => { setCurrentPage(Math.min(maxPages, Math.max(1, page))); setRect({ x: 0, y: 0, width: 0, height: 0 }); setSelectedRegionId(null) }} />

          <ManualFixDocumentViewer candidate={candidate} activeSourceDocumentId={activeSourceDocumentId} currentPage={currentPage} pageBrowseMode={pageBrowseMode} pageNumbers={pageNumbers} rect={rect} scrollAreaRef={scrollAreaRef} pageContainerRefs={pageContainerRefs} getPageImageRef={getPageImageRef} canvasBoxesForPage={canvasBoxesForPage} selectedBoxIdForPage={selectedBoxIdForPage} onSelectBoxId={handleSelectBoxId} onRectChange={handleRectChange} onDeleteSelected={handleDeleteSelected} onNaturalSizeReady={(size, page) => { if (currentPage === page) setNaturalSize(size) }} onFocusPage={(page) => focusPage(page, { scroll: true })} />
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
          onStemChange={(value) => { setStemMarkdown(value); setTextDirty(true) }}
          onAnswerChange={(value) => { setAnswerText(value); setTextDirty(true) }}
          onAnalysisChange={(value) => { setAnalysisMarkdown(value); setTextDirty(true) }}
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

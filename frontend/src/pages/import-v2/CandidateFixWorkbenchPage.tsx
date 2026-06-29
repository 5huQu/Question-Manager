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
import { assetUrl } from '@/utils/questionDisplay'
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

function regionMatchesFigure(region: Region, figure: any) {
  if (region.kind !== 'shared_answer_key') return false
  const ids = [figure.id, figure.blockId, figure.sourceBlockId].filter(Boolean).map(String)
  const regionFigureIds = (region.questionKeys || []).map(String)
  if (ids.some((id) => regionFigureIds.includes(id))) return true
  const bbox = Array.isArray(figure.bbox) ? figure.bbox.map(Number) : null
  const segment = region.segments[0]
  if (!bbox || !segment || Number(segment.page) !== Number(figure.pageNo || 0)) return false
  const regionBbox = [segment.x, segment.y, segment.x + segment.width, segment.y + segment.height]
  return regionBbox.every((value, index) => Math.abs(value - bbox[index]) < 0.01)
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
  const [maxPages, setMaxPages] = useState<number>(1)
  const [pdfName, setPdfName] = useState('')
  const [pageBrowseMode, setPageBrowseMode] = useState<'manual' | 'continuous'>('continuous')
  const [regionView, setRegionView] = useState<'all' | 'question' | 'solution'>('all')
  const [initialFocusTarget, setInitialFocusTarget] = useState<{ page: number; regionId?: string } | null>(null)

  // Canvas interaction
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  const [viewportWidth, setViewportWidth] = useState(0)
  const [rect, setRect] = useState<BBox>({ x: 0, y: 0, width: 0, height: 0 })

  const pageImageRefs = useRef<Map<number, { current: HTMLImageElement | null }>>(new Map())
  const pageContainerRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)

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
      const profile = JSON.parse(sess.sourceProfileJson || '{}')[currentCandidate.sourceDocumentId] || {}
      setMaxPages(profile.pageCount || 1)
      setPdfName(profile.pdfName || '原始 PDF 文件')

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
        setCurrentPage(targetSegment.page)
        setInitialFocusTarget({ page: targetSegment.page, regionId: targetRegion.id })
      } else {
        setCurrentPage(1)
        setInitialFocusTarget({ page: 1 })
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
    const timer = window.setTimeout(() => {
      if (target.regionId) setSelectedRegionId(target.regionId)
      focusPage(target.page, { scroll: true })
      setInitialFocusTarget(null)
    }, 80)
    return () => window.clearTimeout(timer)
  }, [initialFocusTarget, loading])

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
  function displayRectToSegment(displayRect: BBox, imgSize: { width: number; height: number }, page = currentPage): Segment | null {
    if (imgSize.width <= 0 || imgSize.height <= 0 || displayRect.width <= 3 || displayRect.height <= 3) {
      return null
    }
    return {
      page,
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

  function normalizeSegmentForSave(segment: Segment): Segment | null {
    const values = [segment.page, segment.x, segment.y, segment.width, segment.height]
    if (!values.every(Number.isFinite) || segment.page < 1 || segment.width <= 0 || segment.height <= 0) return null
    if (segment.x >= 0 && segment.y >= 0 && segment.x + segment.width <= 1 && segment.y + segment.height <= 1) return segment
    if (naturalSize.width <= 0 || naturalSize.height <= 0) return null
    const next = {
      page: segment.page,
      x: segment.x / naturalSize.width,
      y: segment.y / naturalSize.height,
      width: segment.width / naturalSize.width,
      height: segment.height / naturalSize.height,
    }
    return next.x >= 0 && next.y >= 0 && next.width > 0 && next.height > 0 && next.x + next.width <= 1 && next.y + next.height <= 1
      ? next
      : null
  }

  function normalizedRegionsForSave() {
    return regions.map((region) => ({
      ...region,
      segments: region.segments.map(normalizeSegmentForSave).filter(Boolean) as Segment[],
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
    setCurrentPage(segment.page)
    window.setTimeout(() => {
      setRectFromSegment(segment)
      scrollSegmentToCenter(segment)
    }, 120)
  }

  function figureIds(figure: any) {
    return [figure.id, figure.blockId, figure.sourceBlockId].filter(Boolean).map(String)
  }

  function figureRegion(figure: any) {
    return regions.find((region) => regionMatchesFigure(region, figure)) || null
  }

  function handleLocateFigure(figure: any) {
    const region = figureRegion(figure)
    if (region?.segments[0]) {
      focusRegion(region, region.segments[0])
      return
    }
    if (figure.pageNo) {
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

  function isHeaderFooterSegment(segment: Segment) {
    const bottom = segment.y + segment.height
    const inTopBand = segment.y < 0.12 && bottom <= 0.13 && segment.height <= 0.06
    const inBottomBand = (segment.y >= 0.9 || bottom >= 0.97) && segment.height <= 0.08
    return inTopBand || inBottomBand
  }

  function figureInHeaderFooterBand(figure: any) {
    const region = figureRegion(figure)
    if (region?.segments.some(isHeaderFooterSegment)) return true
    const bbox: number[] | null = Array.isArray(figure.bbox) ? figure.bbox.map(Number) : null
    if (!bbox || !bbox.every(Number.isFinite)) return false
    if (bbox.every((value) => value >= 0 && value <= 1)) {
      const height = bbox[3] - bbox[1]
      return (bbox[1] < 0.12 && bbox[3] <= 0.13 && height <= 0.06)
        || ((bbox[1] >= 0.9 || bbox[3] >= 0.97) && height <= 0.08)
    }
    const height = bbox[3] - bbox[1]
    return (bbox[1] < 260 && bbox[3] <= 300 && height <= 180) || (height <= 180 && bbox[1] >= 2500)
  }

  function removeFigureMarkersByIds(markdown: string, ids: Set<string>) {
    let next = String(markdown || '')
    for (const id of ids) {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      next = next.replace(new RegExp(`\\n?\\s*<!--\\s*DOC2X_FIGURE:${escaped}\\s*-->\\s*\\n?`, 'g'), '\n')
    }
    return next.replace(/\n{3,}/g, '\n\n').trim()
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

  function removeFigureMarkers(markdown: string, figure: any) {
    const ids = [figure.id, figure.blockId, figure.sourceBlockId].filter(Boolean).map(String)
    let next = String(markdown || '')
    for (const id of ids) {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      next = next.replace(new RegExp(`\\n?\\s*<!--\\s*DOC2X_FIGURE:${escaped}\\s*-->\\s*\\n?`, 'g'), '\n')
    }
    return next.replace(/\n{3,}/g, '\n\n').trim()
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
    const idx = regions.findIndex(r => regionVisible(r) && r.id === selectedRegionId && r.segments.some(seg => seg.page === page))
    return idx >= 0 ? String(idx) : undefined
  }

  const visiblePageNumbers = regionView === 'all'
    ? Array.from({ length: maxPages }, (_, index) => index + 1)
    : Array.from(new Set(regions.filter(regionVisible).flatMap((region) => region.segments.map((segment) => segment.page)))).sort((left, right) => left - right)
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

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 h-[calc(100vh-7rem)] min-h-[680px] items-stretch overflow-hidden">
        {/* 左侧：PDF 渲染展示与划框区域 (7格) */}
        <div className="xl:col-span-7 flex flex-col border rounded-xl bg-zinc-50/50 dark:bg-zinc-955 overflow-hidden shadow-sm">
          {/* 页码与比例导航 */}
          <div className="border-b bg-white dark:bg-zinc-950 px-4 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0 text-xs text-zinc-500 select-none">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                PDF 页面定位及选区划定
              </span>
              <div className="flex flex-wrap gap-1.5">
                <div className="flex rounded-md border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-800 dark:bg-zinc-900">
                  {[
                    ['manual', '手动翻页'],
                    ['continuous', '连续翻页'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPageBrowseMode(value as 'manual' | 'continuous')}
                      className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                        pageBrowseMode === value
                          ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50'
                          : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex rounded-md border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-800 dark:bg-zinc-900">
                  {[
                    ['all', '全部显示'],
                    ['question', '只显示题干范围'],
                    ['solution', '只显示解析范围'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleRegionViewChange(value as 'all' | 'question' | 'solution')}
                      className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                        regionView === value
                          ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50'
                          : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={currentPage <= 1 || pageBrowseMode === 'continuous'}
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
                disabled={currentPage >= maxPages || pageBrowseMode === 'continuous'}
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
          <div ref={scrollAreaRef} className="flex-1 overflow-auto p-4">
            {candidate && pageBrowseMode === 'manual' ? (
              <div className="mx-auto w-full max-w-[800px]">
                <div
                  ref={(node) => { pageContainerRefs.current.set(currentPage, node) }}
                  className="scroll-mt-4"
                >
                  <BBoxCanvas
                    imageUrl={`/api/import-flow-v2/source-documents/${candidate.sourceDocumentId}/pages/${currentPage}`}
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
                    key={page}
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
                      imageUrl={`/api/import-flow-v2/source-documents/${candidate.sourceDocumentId}/pages/${page}`}
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

        {/* 右侧：编辑文本域与属性核对区 (5格) */}
        <div className="xl:col-span-5 flex flex-col border rounded-xl bg-white dark:bg-zinc-900 overflow-hidden shadow-sm min-w-0">
          <div className="border-b bg-zinc-50/50 dark:bg-zinc-950/20 px-4 py-2.5 flex items-center justify-between shrink-0">
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              异常题目文本及图框微调
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {/* 卡片一：选区与微调控制盒 */}
            <div className="rounded-xl border border-zinc-150 bg-zinc-50/10 p-4 shadow-xs space-y-3 dark:border-zinc-800 dark:bg-zinc-900/10">
              <label className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block select-none">
                1. 选区定界与微调
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
                <Button size="xs" variant="outline" icon={Trash2} onClick={handleCleanHeaderFooter}>
                  清理常规页脚
                </Button>
              </div>

              {/* 当前选中选区信息与操作 */}
              {selectedRegionId && (
                <div className="mt-1 rounded-lg border border-zinc-200/60 bg-white/50 p-3 text-xs space-y-2 dark:border-zinc-850 dark:bg-zinc-900/50">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                      当前选中：{regions.find(r => r.id === selectedRegionId)?.questionLabel || '选区'}
                    </span>
                    <button
                      onClick={handleDeleteSelected}
                      className="text-red-500 hover:text-red-700 flex items-center gap-1 font-medium transition-colors cursor-pointer text-xs"
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
                        className="h-7 rounded border border-zinc-200 bg-background px-2 text-[11px] outline-none transition-all focus:border-zinc-400"
                      >
                        <option value="stem">题干段落</option>
                        <option value="analysis">解析段落</option>
                      </select>
                    </div>
                  )}
                  <p className="text-[10px] text-zinc-400 leading-normal">
                    可以在左侧拖拽边缘调整框大小，或者按 Delete / Backspace 键快速删除。
                  </p>
                </div>
              )}
            </div>

            {/* 卡片二：题干与题图 */}
            <div className="rounded-xl border border-zinc-150 bg-white p-4 shadow-xs space-y-4 dark:border-zinc-800 dark:bg-zinc-955">
              {/* 题干文本编辑 */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block select-none">
                  2. 题干文本内容 (Markdown)
                </label>
                <textarea
                  value={stemMarkdown}
                  onChange={(e) => setStemMarkdown(e.target.value)}
                  className="w-full h-40 rounded-lg border border-zinc-200 bg-background p-3 text-xs outline-none focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800 font-mono resize-y transition-all leading-relaxed"
                  placeholder="在此录入或修改识别出的题干内容..."
                />
              </div>

              {/* 题图资源编辑 */}
              <div className="space-y-2 border-t border-zinc-100 dark:border-zinc-900 pt-3">
                <label className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block select-none">
                  3. 题图资源
                </label>
                {figures.length ? (
                  <div className="grid grid-cols-1 gap-2.5">
                    {figures.map((figure, index) => {
                      const path = String(figure.path || '')
                      const isRenderable = path && !path.trim().startsWith('<')
                      return (
                        <div
                          key={figure.id || `${path}-${index}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleLocateFigure(figure)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              handleLocateFigure(figure)
                            }
                          }}
                          className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50/30 p-2.5 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-955/30 dark:hover:bg-zinc-900 cursor-pointer"
                        >
                          <span className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-zinc-200 bg-white text-[10px] text-zinc-400 dark:border-zinc-800">
                            {isRenderable ? (
                              <img src={assetUrl(path)} alt={`题图 ${index + 1}`} className="h-full w-full object-contain" />
                            ) : (
                              <span>表格/内联资源</span>
                            )}
                          </span>
                          <span className="min-w-0 flex-1 text-[11px] text-zinc-500 leading-normal">
                            <span className="block font-semibold text-zinc-700 dark:text-zinc-300">题图 #{index + 1}</span>
                            <span className="block mt-0.5 text-[10px]">位置：{figure.usage || 'unknown'}{figure.pageNo ? ` · 第 ${figure.pageNo} 页` : ''}</span>
                          </span>
                          <Button
                            size="xs"
                            variant="outline"
                            icon={Trash2}
                            className="text-red-655 hover:bg-red-50 hover:text-red-700 border-zinc-200"
                            onClick={(event: any) => {
                              event.stopPropagation()
                              handleDeleteFigure(figure)
                            }}
                          >
                            删除
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-400 dark:border-zinc-800 select-none">
                    当前题目暂无题图资源。
                  </div>
                )}
              </div>
            </div>

            {/* 卡片三：解答内容 */}
            <div className="rounded-xl border border-zinc-150 bg-white p-4 shadow-xs space-y-4 dark:border-zinc-800 dark:bg-zinc-955">
              {/* 答案文本编辑 */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block select-none">
                  4. 答案文本内容 (Markdown)
                </label>
                <textarea
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  className="w-full h-24 rounded-lg border border-zinc-200 bg-background p-3 text-xs outline-none focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800 font-mono resize-y transition-all leading-relaxed"
                  placeholder="在此输入或修改答案..."
                />
              </div>

              {/* 解析步骤编辑 */}
              <div className="space-y-2 border-t border-zinc-100 dark:border-zinc-900 pt-3">
                <label className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block select-none">
                  5. 自动解析步骤 (Markdown)
                </label>
                <textarea
                  value={analysisMarkdown}
                  onChange={(e) => setAnalysisMarkdown(e.target.value)}
                  className="w-full h-32 rounded-lg border border-zinc-200 bg-background p-3 text-xs outline-none focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800 font-mono resize-y transition-all leading-relaxed"
                  placeholder="在此输入参考答案与解析思路..."
                />
              </div>
            </div>

            {/* 诊断小贴士 */}
            <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3 text-[11px] text-zinc-500 dark:text-zinc-400 dark:border-zinc-800/80 dark:bg-zinc-900/30 leading-relaxed flex gap-2">
              <HelpCircle className="size-4 text-zinc-400 dark:text-zinc-500 shrink-0 mt-0.5" />
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

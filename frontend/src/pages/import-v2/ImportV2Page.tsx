import { useEffect, useMemo, useState, useRef } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRightLeft,
  BadgeAlert,
  Check,
  CheckCircle2,
  Compass,
  Database,
  FileCheck2,
  FileText,
  HelpCircle,
  ImageIcon,
  Layers,
  LoaderCircle,
  Play,
  RefreshCcw,
  SkipForward,
  Upload,
  Trash2,
  PencilLine,
  ChevronLeft,
} from 'lucide-react'
import { importV2Api, type ImportFlowV2ParserConfig, type ImportParserPreset, type ImportV2ImportJob, type ImportV2ImportJobDocument, type ImportV2ImportJobDocumentDetail, type ImportV2OcrDocument, type ImportV2SourceDocument, type OcrFigureDiagnostics, type ParseCandidatesRequest, type ParseCandidatesResult } from '@/api/importV2'
import { settingsApi } from '@/api/settings'
import { MarkdownContent } from '@/components/MarkdownContent'
import { MarkdownStructurePreviewDialog, type MarkdownPreviewDocumentOption } from '@/components/import-v2/MarkdownStructurePreviewDialog'
import { ImportMetadataEditorDialog } from '@/components/import-v2/ImportMetadataEditorDialog'
import { ReviewActionMenu } from '@/components/import-v2/ReviewActionMenu'
import { FigureGallery, MarkdownWithInlineFigures, QuestionMarkdownContent } from '@/components/questions/QuestionContent'
import { PageTitle, Panel, Badge, Button, Empty } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling'
import { parserDiagnosticLabel } from '@/utils/importDiagnostics'
import { assetUrl } from '@/utils/questionDisplay'
import {
  fromCandidate,
  importJobDocumentRoleLabel,
  issueLabel,
  metadataDraftFromDoc,
  metadataPayload,
  normalizeSourceOcrProvider,
  paperKindOptions,
  questionReviewState,
  reviewTabFromQuery,
  sourceOcrProviderLabel,
  type SourceMetadataDraft,
  type UnifiedQuestion,
  type UploadDocumentMode,
} from './importV2PageModel'
import { buildCandidateReviewModel } from './candidateReviewModel'
import { candidateDetailPath, candidateReviewPath, importJobDocumentPath, importJobQuestionsPath, legacySourceDocumentPath } from './importV2Routes'
import { fetchCandidates, fetchImportJob, fetchOcrDocuments, fetchParserPresets, fetchSourceDocuments, invalidateImportV2Queries } from './importV2Queries'

export function ImportV2Workspace({ view }: { view: 'document' | 'candidate' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { jobId: importJobIdFromPath, sourceDocumentId: sourceDocumentIdFromPath, candidateId: candidateIdFromPath } = useParams<{ jobId: string; sourceDocumentId: string; candidateId: string }>()
  const [searchParams] = useSearchParams()
  const sourceDocumentIdFromQuery = searchParams.get('sourceDocumentId') || ''
  const importJobIdFromQuery = searchParams.get('importJobId') || ''
  const currentImportJobId = importJobIdFromPath || importJobIdFromQuery
  const isCandidatesRoute = view === 'candidate'
  const routeSyncKey = `${currentImportJobId || ''}:${sourceDocumentIdFromPath || ''}:${candidateIdFromPath || ''}:${isCandidatesRoute ? 'candidates' : 'document'}`

  const [sourceDocuments, setSourceDocuments] = useState<ImportV2SourceDocument[]>([])
  const [ocrDocuments, setOcrDocuments] = useState<ImportV2OcrDocument[]>([])
  const [selectedOcrId, setSelectedOcrId] = useState('')
  const [questions, setQuestions] = useState<UnifiedQuestion[]>([])
  const [committedIds, setCommittedIds] = useState<Set<string>>(new Set())

  // UI 交互状态
  const [activeStepTab, setActiveStepTab] = useState<'upload' | 'review'>('upload')
  const [selectedSourceDocId, setSelectedSourceDocId] = useState<string | null>(null)
  const [showCheckArea, setShowCheckArea] = useState(false)
  const [editingQuestionNo, setEditingQuestionNo] = useState('')
  const [savingQuestionType, setSavingQuestionType] = useState('')
  const [metadataDraft, setMetadataDraft] = useState<SourceMetadataDraft>(() => metadataDraftFromDoc())
  const [showMetadataEditor, setShowMetadataEditor] = useState(false)
  const [uploadDocumentMode, setUploadDocumentMode] = useState<UploadDocumentMode>('single_document')
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null)
  const [questionUploadFile, setQuestionUploadFile] = useState<File | null>(null)
  const [solutionUploadFile, setSolutionUploadFile] = useState<File | null>(null)
  const [activeImportJob, setActiveImportJob] = useState<ImportV2ImportJob | null>(null)
  const [activeImportJobDocuments, setActiveImportJobDocuments] = useState<ImportV2ImportJobDocumentDetail[]>([])
  const [parserPresets, setParserPresets] = useState<ImportParserPreset[]>([])
  const [selectedParserPresetId, setSelectedParserPresetId] = useState('')
  const [markdownPreviewTarget, setMarkdownPreviewTarget] = useState<{
    ocrDocumentId: string
    documentOptions?: MarkdownPreviewDocumentOption[]
    candidateId?: string
    candidateIds?: string[]
    questionNo?: string
    focusKind?: 'stem' | 'answer' | 'analysis'
    title?: string
  } | null>(null)

  const [uploading, setUploading] = useState(false)
  const [runningSourceDocumentId, setRunningSourceDocumentId] = useState('')
  const [sourceOcrErrors, setSourceOcrErrors] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState<'all' | 'ready' | 'warning' | 'error'>(() => reviewTabFromQuery(searchParams.get('tab')))
  const [activeDiagnosticCode, setActiveDiagnosticCode] = useState('')
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [diagnostics, setDiagnostics] = useState<OcrFigureDiagnostics | null>(null)
  const [figureAssignments, setFigureAssignments] = useState<Record<string, { candidateId: string; usage: 'stem' | 'analysis' }>>({})
  const [figureMoveDrafts, setFigureMoveDrafts] = useState<Record<string, { candidateId: string; usage: 'stem' | 'analysis' | 'options'; optionLabel: string }>>({})

  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const questionFileInputRef = useRef<HTMLInputElement>(null)
  const solutionFileInputRef = useRef<HTMLInputElement>(null)
  const checkAreaRef = useRef<HTMLDivElement>(null)
  const candidateListRef = useRef<HTMLDivElement>(null)
  const candidateItemRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const lastRouteSyncKeyRef = useRef('')
  const [dragOver, setDragOver] = useState(false)
  const ocrSettings = useAsync(() => settingsApi.getOcrSettings(), [])
  const currentOcrProvider = normalizeSourceOcrProvider(ocrSettings.data?.ocrProvider)
  const currentOcrProviderLabel = sourceOcrProviderLabel(currentOcrProvider)

  // JSON 模式下的已选择 OCR
  const selectedOcr = useMemo(() => ocrDocuments.find((item) => item.id === selectedOcrId) || null, [ocrDocuments, selectedOcrId])

  // 当前选中的资料
  const selectedDoc = useMemo(() => {
    return selectedSourceDocId ? sourceDocuments.find(d => d.id === selectedSourceDocId) || null : null
  }, [sourceDocuments, selectedSourceDocId])

  const runningSourceDocumentIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of sourceDocuments) {
      if (item.status === 'ocr_running') ids.add(item.id)
    }
    if (runningSourceDocumentId) ids.add(runningSourceDocumentId)
    return Array.from(ids).sort()
  }, [runningSourceDocumentId, sourceDocuments])
  const runningSourceDocumentKey = runningSourceDocumentIds.join('|')

  const selectedImportJobDocument = useMemo(() => {
    if (!selectedDoc) return null
    return activeImportJobDocuments.find((item) => item.sourceDocumentId === selectedDoc.id) || null
  }, [activeImportJobDocuments, selectedDoc?.id])

  const selectedDocOcr = useMemo(() => {
    return selectedDoc ? ocrDocuments.find((item) => item.sourceDocumentId === selectedDoc.id) || null : null
  }, [ocrDocuments, selectedDoc?.id])

  const activeImportJobQuestionDocument = useMemo(() => {
    return activeImportJobDocuments.find((item) => item.role === 'questions') || null
  }, [activeImportJobDocuments])

  const activeImportJobSolutionDocument = useMemo(() => {
    return activeImportJobDocuments.find((item) => item.role === 'solutions') || null
  }, [activeImportJobDocuments])

  const activeImportJobQuestionSource = useMemo(() => {
    return activeImportJobQuestionDocument ? sourceDocuments.find((item) => item.id === activeImportJobQuestionDocument.sourceDocumentId) || null : null
  }, [activeImportJobQuestionDocument?.sourceDocumentId, sourceDocuments])

  const activeImportJobSolutionSource = useMemo(() => {
    return activeImportJobSolutionDocument ? sourceDocuments.find((item) => item.id === activeImportJobSolutionDocument.sourceDocumentId) || null : null
  }, [activeImportJobSolutionDocument?.sourceDocumentId, sourceDocuments])

  const activeImportJobQuestionOcr = useMemo(() => {
    return activeImportJobQuestionDocument ? ocrDocuments.find((item) => item.sourceDocumentId === activeImportJobQuestionDocument.sourceDocumentId) || null : null
  }, [activeImportJobQuestionDocument?.sourceDocumentId, ocrDocuments])

  const activeImportJobSolutionOcr = useMemo(() => {
    return activeImportJobSolutionDocument ? ocrDocuments.find((item) => item.sourceDocumentId === activeImportJobSolutionDocument.sourceDocumentId) || null : null
  }, [activeImportJobSolutionDocument?.sourceDocumentId, ocrDocuments])

  const selectedDocIsImportJobQuestion = activeImportJob?.mode === 'separated_documents' && selectedImportJobDocument?.role === 'questions'
  const selectedDocIsImportJobSolution = activeImportJob?.mode === 'separated_documents' && selectedImportJobDocument?.role === 'solutions'
  const activeImportJobSolutionReady = !activeImportJobSolutionSource || ['ocr_succeeded', 'parsed', 'partially_parsed'].includes(activeImportJobSolutionSource.status)
  const selectedDocCommittedCount = selectedDoc?.importStats?.committedCount || 0
  const canReidentifySelectedDoc = Boolean(
    selectedDoc &&
    ['pdf', 'image'].includes(selectedDoc.fileType) &&
    selectedDocCommittedCount === 0 &&
    !['uploaded', 'ocr_running'].includes(selectedDoc.status)
  )
  const canRecleanSelectedDoc = Boolean(
    selectedDoc &&
    !selectedDocIsImportJobSolution &&
    selectedDocCommittedCount === 0 &&
    (selectedDoc.importStats?.candidateCount || questions.length) > 0 &&
    ['parsed', 'partially_parsed', 'ocr_succeeded'].includes(selectedDoc.status)
  )

  useEffect(() => {
    if (selectedDoc) {
      setMetadataDraft(metadataDraftFromDoc(selectedDoc))
    }
  }, [selectedDoc?.id, selectedDoc?.updatedAt])

  // 状态解析
  function getDocStatus(item: ImportV2SourceDocument) {
    if (item.status === 'ocr_running') return { label: '识别中', variant: 'warning' as const }
    if (item.status === 'ocr_failed') return { label: '识别失败', variant: 'danger' as const }
    if (item.importStats?.allCommitted) return { label: '导入完成', variant: 'success' as const }
    if (item.status === 'uploaded') return { label: '等待识别', variant: 'outline' as const }
    if (item.status === 'ocr_succeeded') return { label: '已识别', variant: 'default' as const }
    
    if (item.status === 'parsed' || item.status === 'partially_parsed') {
      const committed = item.importStats?.committedCount || 0
      if (committed > 0) {
        return { label: '部分入库', variant: 'warning' as const }
      }
      return { label: '待核对', variant: 'default' as const }
    }
    
    return { label: '等待识别', variant: 'outline' as const }
  }

  // 步骤进度计算
  const steps = useMemo(() => {
    if (!selectedDoc) return []
    
    let step1: 'todo' | 'current' | 'done' = 'done'
    let step2: 'todo' | 'current' | 'done' = 'todo'
    let step3: 'todo' | 'current' | 'done' = 'todo'
    const isAllCommitted = selectedDoc.importStats?.allCommitted || false
    const status = selectedDoc.status
    
    if (status === 'uploaded' || status === 'ocr_failed') {
      step1 = 'done'
      step2 = 'todo'
      step3 = 'todo'
    } else if (status === 'ocr_running') {
      step1 = 'done'
      step2 = 'current'
      step3 = 'todo'
    } else if (status === 'ocr_succeeded') {
      step1 = 'done'
      step2 = 'done'
      step3 = 'todo'
    } else if (status === 'parsed' || status === 'partially_parsed') {
      step1 = 'done'
      step2 = 'done'
      if (isAllCommitted) {
        step3 = 'done'
      } else {
        step3 = 'current'
      }
    }
    
    return [
      { title: '上传资料', state: step1 },
      { title: '自动识别', state: step2 },
      { title: '核对入库', state: step3 },
    ]
  }, [selectedDoc])

  function jobDocumentUrl(importJobId: string, sourceDocumentId: string) {
    return importJobDocumentPath(importJobId, sourceDocumentId)
  }

  function currentImportJobIdForSourceDocument(sourceDocumentId: string) {
    const jobDocument = activeImportJobDocuments.find((item) => item.sourceDocumentId === sourceDocumentId)
    return jobDocument?.jobId || ''
  }

  function documentUrl(sourceDocumentId: string) {
    const importJobId = currentImportJobIdForSourceDocument(sourceDocumentId)
    return importJobId
      ? jobDocumentUrl(importJobId, sourceDocumentId)
      : legacySourceDocumentPath(sourceDocumentId)
  }

  function candidatesUrl(sourceDocumentId: string) {
    return candidateReviewPath(documentUrl(sourceDocumentId), searchParams.toString())
  }

  function candidateUrl(sourceDocumentId: string, candidateId: string) {
    return candidateDetailPath(documentUrl(sourceDocumentId), candidateId, searchParams.toString())
  }

  function navigateToDocument(sourceDocumentId: string, options?: { replace?: boolean }) {
    navigate(documentUrl(sourceDocumentId), { replace: options?.replace ?? true })
  }

  function navigateToCandidates(sourceDocumentId: string, options?: { replace?: boolean }) {
    navigate(candidatesUrl(sourceDocumentId), { replace: options?.replace ?? true })
  }

  function navigateToCandidate(sourceDocumentId: string, candidateId: string, options?: { replace?: boolean }) {
    navigate(candidateUrl(sourceDocumentId, candidateId), { replace: options?.replace ?? true })
  }

  function setReviewTab(nextTab: 'all' | 'ready' | 'warning' | 'error') {
    setActiveTab(nextTab)
    setSelectedIds(new Set())
    if (!isCandidatesRoute) return
    const nextParams = new URLSearchParams(searchParams)
    if (nextTab === 'all') nextParams.delete('tab')
    else nextParams.set('tab', nextTab)
    const suffix = nextParams.toString() ? `?${nextParams.toString()}` : ''
    navigate(`${location.pathname}${suffix}`, { replace: true })
  }

  // 当选择不同资料时，重置核对区
  useEffect(() => {
    setQuestions([])
    setShowCheckArea(false)
    setDiagnostics(null)
  }, [selectedDoc?.id])

  // 自动滚动到核对区
  useEffect(() => {
    if (showCheckArea) {
      setTimeout(() => {
        checkAreaRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 100)
    }
  }, [showCheckArea])

  async function loadLists(options: { force?: boolean } = { force: true }) {
    if (options.force) invalidateImportV2Queries()
    const [sourceResult, ocrResult] = await Promise.all([
      fetchSourceDocuments(options),
      fetchOcrDocuments(options),
    ])
    setSourceDocuments(sourceResult.items)
    setOcrDocuments(ocrResult.items)
    const failedItems = sourceResult.items.filter((item) => item.status === 'ocr_failed')
    if (failedItems.length) {
      const errors = await Promise.all(failedItems.map(async (item) => {
        try {
          const status = await importV2Api.getSourceDocumentOcrStatus(item.id)
          return [item.id, status.task.error || 'OCR 识别失败。'] as const
        } catch {
          return [item.id, 'OCR 识别失败。'] as const
        }
      }))
      setSourceOcrErrors((current) => ({ ...current, ...Object.fromEntries(errors) }))
    }
    if (!selectedOcrId && ocrResult.items[0]) setSelectedOcrId(ocrResult.items[0].id)
  }

  useEffect(() => {
    loadLists({ force: false }).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  useEffect(() => {
    let active = true
    fetchParserPresets()
      .then((result) => {
        if (!active) return
        setParserPresets(result.items || [])
        if (!selectedParserPresetId && result.items?.[0]) setSelectedParserPresetId(result.items[0].id)
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      active = false
    }
  }, [selectedParserPresetId])

  useEffect(() => {
    if (!currentImportJobId) return undefined
    let active = true
    fetchImportJob(currentImportJobId)
      .then((result) => {
        if (!active) return
        setActiveImportJob(result.importJob)
        setActiveImportJobDocuments(result.documents || [])
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      active = false
    }
  }, [currentImportJobId])

  useEffect(() => {
    if (!importJobIdFromPath || sourceDocumentIdFromPath || !activeImportJobDocuments.length) return
    const primary = activeImportJobDocuments.find((item) => item.role === 'full')
      || activeImportJobDocuments.find((item) => item.role === 'questions')
      || activeImportJobDocuments[0]
    if (primary?.sourceDocumentId) {
      const baseUrl = jobDocumentUrl(importJobIdFromPath, primary.sourceDocumentId)
      const nextUrl = isCandidatesRoute
        ? `${baseUrl}/candidates${candidateIdFromPath ? `/${encodeURIComponent(candidateIdFromPath)}` : ''}`
        : baseUrl
      navigate(nextUrl, { replace: true })
    }
  }, [activeImportJobDocuments, candidateIdFromPath, importJobIdFromPath, isCandidatesRoute, navigate, sourceDocumentIdFromPath])

  useEffect(() => {
    if (!currentImportJobId || !sourceDocumentIdFromPath || !activeImportJobDocuments.length) return undefined
    if (activeImportJobDocuments.some((item) => item.sourceDocumentId === sourceDocumentIdFromPath)) return undefined
    let active = true
    importV2Api.resolveImportJobForSourceDocument(sourceDocumentIdFromPath, false)
      .then((detail) => {
        if (!active) return
        setActiveImportJob(detail.importJob)
        setActiveImportJobDocuments(detail.documents || [])
        const baseUrl = jobDocumentUrl(detail.importJob.id, sourceDocumentIdFromPath)
        const candidatesPath = isCandidatesRoute
          ? `/candidates${candidateIdFromPath ? `/${encodeURIComponent(candidateIdFromPath)}` : ''}`
          : ''
        const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
        navigate(`${baseUrl}${candidatesPath}${suffix}`, { replace: true })
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      active = false
    }
  }, [activeImportJobDocuments, candidateIdFromPath, currentImportJobId, isCandidatesRoute, navigate, searchParams, sourceDocumentIdFromPath])

  // 兼容旧链接：/tools/import?sourceDocumentId=xxx
  useEffect(() => {
    if (sourceDocumentIdFromQuery && !sourceDocumentIdFromPath) {
      navigateToDocument(sourceDocumentIdFromQuery, { replace: true })
    }
  }, [sourceDocumentIdFromPath, sourceDocumentIdFromQuery])

  // 兼容旧链接：/tools/import/documents/:sourceDocumentId
  useEffect(() => {
    if (!sourceDocumentIdFromPath || currentImportJobId || sourceDocumentIdFromQuery) return undefined
    let active = true
    importV2Api.resolveImportJobForSourceDocument(sourceDocumentIdFromPath, true)
      .then((detail) => {
        if (!active) return
        setActiveImportJob(detail.importJob)
        setActiveImportJobDocuments(detail.documents || [])
        navigate(jobDocumentUrl(detail.importJob.id, sourceDocumentIdFromPath), { replace: true })
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      active = false
    }
  }, [currentImportJobId, navigate, sourceDocumentIdFromPath, sourceDocumentIdFromQuery])

  useEffect(() => {
    setActiveTab(reviewTabFromQuery(searchParams.get('tab')))
  }, [searchParams])

  // 从 path 恢复当前资料和候选题目
  useEffect(() => {
    if (sourceDocumentIdFromQuery && !sourceDocumentIdFromPath) return
    if (!sourceDocumentIdFromPath) {
      setSelectedSourceDocId(null)
      setActiveStepTab('upload')
      lastRouteSyncKeyRef.current = ''
      return
    }
    if (sourceDocuments.length === 0) return

    const targetDoc = sourceDocuments.find(d => d.id === sourceDocumentIdFromPath)
    if (!targetDoc) {
      navigate('/tools/import', { replace: true })
      return
    }

    setSelectedSourceDocId(targetDoc.id)
    setActiveStepTab(isCandidatesRoute ? 'review' : 'upload')

    if (!isCandidatesRoute) {
      lastRouteSyncKeyRef.current = ''
      return
    }

    if (lastRouteSyncKeyRef.current === routeSyncKey) return
    lastRouteSyncKeyRef.current = routeSyncKey
    void loadCandidatesForSourceDocument(targetDoc, {
      activeCandidateId: candidateIdFromPath || undefined,
      showLoadedNotice: false,
    })
  }, [candidateIdFromPath, isCandidatesRoute, routeSyncKey, sourceDocumentIdFromPath, sourceDocumentIdFromQuery, sourceDocuments.length])

  useEffect(() => {
    if (!candidateIdFromPath) return
    if (questions.some((q) => q.id === candidateIdFromPath)) {
      setActiveQuestionId(candidateIdFromPath)
    }
  }, [candidateIdFromPath, questions])

  useVisibilityAwarePolling(async (signal) => {
    const runningIds = runningSourceDocumentKey.split('|').filter(Boolean)
    const settled = await Promise.all(runningIds.map(async (id) => {
      try {
        return { id, result: await importV2Api.getSourceDocumentOcrStatus(id) }
      } catch (err) {
        return { id, error: err }
      }
    }))
    if (signal.aborted) return

    const errors = settled.filter((item): item is { id: string; error: unknown } => 'error' in item)
    if (errors.length) {
      setError(errors[0].error instanceof Error ? errors[0].error.message : String(errors[0].error))
    }

    const results = settled
      .filter((item): item is { id: string; result: Awaited<ReturnType<typeof importV2Api.getSourceDocumentOcrStatus>> } => 'result' in item)
      .map((item) => item.result)
    if (!results.length) return

    const sourceById = new Map(results.map((result) => [result.sourceDocument.id, result.sourceDocument]))
    setSourceDocuments((items) => items.map((item) => sourceById.get(item.id) || item))

    const newOcrDocuments = results.map((result) => result.ocrDocument).filter(Boolean) as ImportV2OcrDocument[]
    if (newOcrDocuments.length) {
      setOcrDocuments((items) => {
        const byId = new Map(items.map((item) => [item.id, item]))
        for (const item of newOcrDocuments) byId.set(item.id, item)
        return Array.from(byId.values())
      })
    }

    const finished = results.filter((result) => ['ocr_succeeded', 'ocr_failed'].includes(result.task.status))
    if (!finished.length) return

    const finishedIds = new Set(finished.map((result) => result.sourceDocument.id))
    setRunningSourceDocumentId((current) => finishedIds.has(current) ? '' : current)

    const failed = finished.filter((result) => result.task.status === 'ocr_failed')
    if (failed.length) {
      const nextErrors = Object.fromEntries(failed.map((result) => [
        result.sourceDocument.id,
        result.task.error || 'OCR 识别失败。',
      ]))
      setSourceOcrErrors((current) => ({ ...current, ...nextErrors }))
      setError(Object.values(nextErrors)[0])
    }

    await loadLists()
    if (signal.aborted) return
    if (currentImportJobId) {
      try {
        const result = await fetchImportJob(currentImportJobId, { force: true })
        if (signal.aborted) return
        setActiveImportJob(result.importJob)
        setActiveImportJobDocuments(result.documents || [])
      } catch {
        // 列表状态已经刷新；批次详情刷新失败时不打断 OCR 状态轮询。
      }
    }
    const succeeded = finished.filter((result) => result.task.status === 'ocr_succeeded')
    const selectedFinished = selectedDoc?.id ? finished.some((result) => result.sourceDocument.id === selectedDoc.id) : false
    const firstSelectedOcr = results.find((result) => result.sourceDocument.id === selectedDoc?.id)?.ocrDocument
    if (firstSelectedOcr) setSelectedOcrId(firstSelectedOcr.id)
    if (succeeded.length && selectedFinished) {
      showNotice(succeeded.length > 1 ? `${succeeded.length} 份资料识别完成。` : '识别完成。请在右侧点击“生成待确认题目”继续。')
    }
  }, {
    enabled: Boolean(runningSourceDocumentKey),
    intervalMs: 3_000,
    immediate: true,
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  })

  // 清除通知和错误
  function showNotice(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3000)
  }

  function baseNameFromFile(file: File | null) {
    return file?.name.replace(/\.[^.]+$/i, '') || ''
  }

  function uploadMetadataForFile(file: File, roleLabel = '') {
    const metadata = metadataPayload(metadataDraft)
    const titleBase = metadata.paperTitle || baseNameFromFile(file)
    return {
      ...metadata,
      title: roleLabel ? `${titleBase}（${roleLabel}）` : titleBase,
    }
  }

  function handleUploadFileSelection(files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    setPendingUploadFile(file)
    setError('')
    setNotice('')
    setQuestions([])
    setActiveQuestionId(null)
    setSelectedIds(new Set())
    const titleFromFile = file.name.replace(/\.[^.]+$/i, '')
    setMetadataDraft((draft) => ({
      ...draft,
      paperTitle: draft.paperTitle.trim() ? draft.paperTitle : titleFromFile,
    }))
    showNotice('文件已选择，请填写资料信息后点击“开始上传”。')
  }

  function handleSeparatedFileSelection(role: 'questions' | 'solutions', files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    if (file.name.endsWith('.json')) {
      setError('双文档导入请上传 PDF 或 PNG/JPG 文件。JSON 模拟导入仍使用单文档模式。')
      return
    }
    if (role === 'questions') setQuestionUploadFile(file)
    else setSolutionUploadFile(file)
    setError('')
    setNotice('')
    setQuestions([])
    setActiveQuestionId(null)
    setSelectedIds(new Set())
    const titleFromFile = file.name.replace(/\.[^.]+$/i, '')
    setMetadataDraft((draft) => ({
      ...draft,
      paperTitle: draft.paperTitle.trim() ? draft.paperTitle : titleFromFile,
    }))
  }

  // 1. 上传真实 PDF/图片到 v2 专属资料区。
  async function handleStartUpload() {
    const file = pendingUploadFile
    if (!file) {
      setError('请先选择要上传的资料文件。')
      return
    }

    if (file.name.endsWith('.json')) {
      await handleJsonFile(file)
      setPendingUploadFile(null)
      return
    }

    setUploading(true)
    setError('')
    setNotice('')
    setQuestions([])
    setActiveQuestionId(null)
    setSelectedIds(new Set())

    try {
      const res = await importV2Api.uploadSourceDocument(file, metadataPayload(metadataDraft))
      const metadata = metadataPayload(metadataDraft)
      const jobRes = await importV2Api.createImportJob({
        title: metadata.paperTitle || res.sourceDocument.title || baseNameFromFile(file),
        mode: 'single_document',
        ...metadata,
      })
      await importV2Api.addSourceDocumentToImportJob(jobRes.importJob.id, {
        sourceDocumentId: res.sourceDocument.id,
        role: 'full',
        sortOrder: 0,
      })
      const hydratedJob = await importV2Api.getImportJob(jobRes.importJob.id)
      await loadLists()
      setSelectedSourceDocId(res.sourceDocument.id)
      setPendingUploadFile(null)
      setActiveImportJob(hydratedJob.importJob)
      setActiveImportJobDocuments(hydratedJob.documents || [])
      navigate(jobDocumentUrl(hydratedJob.importJob.id, res.sourceDocument.id))
      showNotice(`资料已保存，可启动 ${currentOcrProviderLabel} 识别。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleStartSeparatedUpload() {
    if (!questionUploadFile || !solutionUploadFile) {
      setError('请分别选择原卷文件和答案解析文件。')
      return
    }

    setUploading(true)
    setError('')
    setNotice('')
    setQuestions([])
    setActiveQuestionId(null)
    setSelectedIds(new Set())

    try {
      const metadata = metadataPayload(metadataDraft)
      const [questionRes, solutionRes] = await Promise.all([
        importV2Api.uploadSourceDocument(questionUploadFile, uploadMetadataForFile(questionUploadFile, '原卷')),
        importV2Api.uploadSourceDocument(solutionUploadFile, uploadMetadataForFile(solutionUploadFile, '答案解析')),
      ])
      const jobTitle = metadata.paperTitle || `${baseNameFromFile(questionUploadFile)} + ${baseNameFromFile(solutionUploadFile)}`
      const jobRes = await importV2Api.createImportJob({
        title: jobTitle,
        mode: 'separated_documents',
        ...metadata,
      })
      await Promise.all([
        importV2Api.addSourceDocumentToImportJob(jobRes.importJob.id, {
          sourceDocumentId: questionRes.sourceDocument.id,
          role: 'questions',
          sortOrder: 0,
        }),
        importV2Api.addSourceDocumentToImportJob(jobRes.importJob.id, {
          sourceDocumentId: solutionRes.sourceDocument.id,
          role: 'solutions',
          sortOrder: 1,
        }),
      ])
      const hydratedJob = await importV2Api.getImportJob(jobRes.importJob.id)
      await loadLists()
      setSelectedSourceDocId(questionRes.sourceDocument.id)
      setActiveImportJob(hydratedJob.importJob)
      setActiveImportJobDocuments(hydratedJob.documents || [])
      setQuestionUploadFile(null)
      setSolutionUploadFile(null)
      navigate(jobDocumentUrl(jobRes.importJob.id, questionRes.sourceDocument.id))
      showNotice('双文档导入任务已创建。请分别完成原卷和答案解析的 OCR 识别。')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
      if (questionFileInputRef.current) questionFileInputRef.current.value = ''
      if (solutionFileInputRef.current) solutionFileInputRef.current.value = ''
    }
  }

  async function startSourceOcr(sourceDocumentId: string, options: { force?: boolean } = {}) {
    setBusy(`ocr-${sourceDocumentId}`)
    setError('')
    setSourceOcrErrors((current) => {
      const next = { ...current }
      delete next[sourceDocumentId]
      return next
    })
    try {
      const result = await importV2Api.startSourceDocumentOcr(sourceDocumentId, options)
      await loadLists()
      setRunningSourceDocumentId(sourceDocumentId)
      showNotice(`${sourceOcrProviderLabel(normalizeSourceOcrProvider(result.task.provider))} 已启动，正在识别资料。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  async function handleReidentifySource(item: ImportV2SourceDocument) {
    if ((item.importStats?.committedCount || 0) > 0) {
      setError('该批次已有题目入库。为避免候选记录与题库记录不一致，暂不支持重新识别。')
      return
    }
    const ok = window.confirm('重新识别会重新调用 OCR，并清空本批次现有未入库候选题和手动修正草稿。确定继续吗？')
    if (!ok) return
    setQuestions([])
    setDiagnostics(null)
    setSelectedIds(new Set())
    setActiveQuestionId(null)
    setShowCheckArea(false)
    setActiveStepTab('upload')
    navigateToDocument(item.id)
    await startSourceOcr(item.id, { force: true })
  }

  async function handleGenerateCandidates(item: ImportV2SourceDocument) {
    setBusy(`action-${item.id}`)
    setError('')
    try {
      const jobDocument = activeImportJobDocuments.find((document) => document.sourceDocumentId === item.id)
      const parserPayload: ParseCandidatesRequest = selectedParserPresetId ? { presetId: selectedParserPresetId } : {}
      const shouldParseImportJob = Boolean(activeImportJob && (
        (activeImportJob.mode === 'single_document' && jobDocument?.role === 'full')
        || (activeImportJob.mode === 'separated_documents' && jobDocument?.role === 'questions')
      ))
      let result: ParseCandidatesResult & { importJob?: ImportV2ImportJob }
      if (shouldParseImportJob) {
        if (activeImportJob?.mode === 'separated_documents' && !activeImportJobSolutionReady) {
          throw new Error('答案解析文档尚未完成 OCR 识别，请先识别答案解析文档。')
        }
        result = await importV2Api.parseImportJobCandidates(activeImportJob!.id, parserPayload)
      } else if (activeImportJob?.mode === 'separated_documents' && jobDocument?.role === 'solutions') {
        throw new Error('答案解析文档只用于合并解析，请切换到原卷文档生成待确认题目。')
      } else {
        const ocrRes = await importV2Api.listOcrDocuments(item.id)
        const ocrDoc = ocrRes.items[0]
        if (!ocrDoc) {
          throw new Error('未找到该资料对应的 OCR 结果文件。')
        }
        setSelectedOcrId(ocrDoc.id)
        result = await importV2Api.parseCandidates(ocrDoc.id, parserPayload)
      }
      const unified = (result.items || []).map(fromCandidate)
      if ('importJob' in result && result.importJob) {
        setActiveImportJob(result.importJob)
      }
      setQuestions(unified)
      setDiagnostics(result.diagnostics || null)
      setCommittedIds(new Set(unified.filter((q) => q.status === 'committed').map((q) => q.id)))
      setSelectedIds(new Set())
      if (unified.length > 0) {
        setActiveQuestionId(unified[0].id)
      }
      await loadLists()
      setShowCheckArea(true)
      setActiveStepTab('review')
      const targetSourceDocumentId = shouldParseImportJob ? activeImportJobQuestionDocument?.sourceDocumentId || item.id : item.id
      navigateToCandidates(targetSourceDocumentId)
      showNotice(shouldParseImportJob ? '已合并原卷与答案解析，生成待核对题目' : '已自动提取并生成待核对题目')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  async function handleRecleanCandidates(item: ImportV2SourceDocument, payload: ParseCandidatesRequest = {}, options: { skipConfirm?: boolean; label?: string } = {}) {
    if ((item.importStats?.committedCount || 0) > 0) {
      setError('该批次已有题目入库。为避免候选记录与题库记录不一致，暂不支持重新清洗。')
      return
    }
    if (!options.skipConfirm) {
      const ok = window.confirm('重新清洗会使用当前导入规则重新生成本批次待核对题目，并替换现有未入库候选题。确定继续吗？')
      if (!ok) return
    }

    setBusy(`reclean-${item.id}`)
    setError('')
    try {
      const jobDocument = activeImportJobDocuments.find((document) => document.sourceDocumentId === item.id)
      const shouldParseImportJob = Boolean(activeImportJob && (
        (activeImportJob.mode === 'single_document' && jobDocument?.role === 'full')
        || (activeImportJob.mode === 'separated_documents' && jobDocument?.role === 'questions')
      ))
      let result: ParseCandidatesResult & { importJob?: ImportV2ImportJob }

      if (shouldParseImportJob) {
        if (activeImportJob?.mode === 'separated_documents' && !activeImportJobSolutionReady) {
          throw new Error('答案解析文档尚未完成 OCR 识别，请先识别答案解析文档。')
        }
        result = await importV2Api.parseImportJobCandidates(activeImportJob!.id, payload)
      } else {
        const ocrRes = await importV2Api.listOcrDocuments(item.id)
        const ocrDoc = ocrRes.items[0]
        if (!ocrDoc) {
          throw new Error('未找到该资料对应的 OCR 结果文件。')
        }
        setSelectedOcrId(ocrDoc.id)
        result = await importV2Api.parseCandidates(ocrDoc.id, payload)
      }

      const unified = (result.items || []).map(fromCandidate)
      if ('importJob' in result && result.importJob) {
        setActiveImportJob(result.importJob)
      }
      setQuestions(unified)
      setDiagnostics(result.diagnostics || null)
      setCommittedIds(new Set(unified.filter((q) => q.status === 'committed').map((q) => q.id)))
      setSelectedIds(new Set())
      setActiveQuestionId(unified[0]?.id || null)
      await loadLists()
      setShowCheckArea(true)
      setActiveStepTab('review')
      navigateToCandidates(shouldParseImportJob ? activeImportJobQuestionDocument?.sourceDocumentId || item.id : item.id)
      showNotice(options.label || '已使用当前导入规则重新生成待核对题目')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  async function handleContinueCheck(item: ImportV2SourceDocument) {
    navigateToCandidates(item.id)
  }

  async function loadCandidatesForSourceDocument(
    item: ImportV2SourceDocument,
    options: { activeCandidateId?: string; showLoadedNotice?: boolean } = {},
  ) {
    setBusy(`action-${item.id}`)
    setError('')
    try {
      const ocrRes = await importV2Api.listOcrDocuments(item.id)
      const ocrDoc = ocrRes.items[0]
      if (ocrDoc) {
        setSelectedOcrId(ocrDoc.id)
      }
      const result = await fetchCandidates(item.id, { force: Boolean(options.showLoadedNotice) })
      const unified = (result.items || []).map(fromCandidate)
      setQuestions(unified)
      setDiagnostics(result.diagnostics || null)
      setCommittedIds(new Set(unified.filter((q) => q.status === 'committed').map((q) => q.id)))
      setSelectedIds(new Set())
      if (options.activeCandidateId && unified.some((q) => q.id === options.activeCandidateId)) {
        setActiveQuestionId(options.activeCandidateId)
      } else if (unified.length > 0) {
        setActiveQuestionId(unified[0].id)
        if (options.activeCandidateId) {
          navigateToCandidates(item.id, { replace: true })
        }
      } else {
        setActiveQuestionId(null)
      }
      await loadLists()
      setShowCheckArea(true)
      setActiveStepTab('review')
      if (options.showLoadedNotice !== false) showNotice('已加载当前识别记录的待确认题目')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  async function handleDeleteSourceDoc(id: string) {
    if (!window.confirm('确定要删除该资料吗？此操作将同步清除与之关联的 OCR 记录、待核对题目及本地裁图缓存，且不可恢复。')) {
      return
    }
    setBusy(`delete-${id}`)
    setError('')
    try {
      await importV2Api.deleteSourceDocument(id)
      showNotice('资料已成功删除。')
      if (selectedSourceDocId === id) {
        setSelectedSourceDocId(null)
        setQuestions([])
        setShowCheckArea(false)
      }
      if (sourceDocumentIdFromPath === id) {
        navigate('/tools/import', { replace: true })
      }
      await loadLists()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  function openEditModal() {
    if (!activeImportJob) return
    setMetadataDraft({
      paperTitle: activeImportJob.paperTitle || activeImportJob.title || '',
      batchName: activeImportJob.batchName || '',
      stage: activeImportJob.stage || '高中',
      subject: activeImportJob.subject || '数学',
      province: activeImportJob.province || '',
      city: activeImportJob.city || '',
      paperKind: activeImportJob.paperKind || 'unknown',
      examYear: activeImportJob.examYear ? String(activeImportJob.examYear) : '',
      sourceOrg: activeImportJob.sourceOrg || '',
      hasWatermark: false,
      watermarkTerms: '',
    })
    setShowMetadataEditor(true)
  }

  async function handleSaveSourceMetadata() {
    if (!activeImportJob) return
    setBusy(`metadata-${activeImportJob.id}`)
    setError('')
    try {
      await importV2Api.updateImportJob(activeImportJob.id, {
        title: metadataDraft.paperTitle,
        paperTitle: metadataDraft.paperTitle,
        batchName: metadataDraft.batchName,
        stage: metadataDraft.stage,
        subject: metadataDraft.subject,
        province: metadataDraft.province,
        city: metadataDraft.city,
        paperKind: metadataDraft.paperKind,
        examYear: Number(metadataDraft.examYear) || 0,
        sourceOrg: metadataDraft.sourceOrg,
      } as any)
      showNotice('资料与试卷批次信息已保存，已同步到子文档和候选试题。')
      setShowMetadataEditor(false)
      if (currentImportJobId) {
        const result = await importV2Api.getImportJob(currentImportJobId)
        setActiveImportJob(result.importJob)
        setActiveImportJobDocuments(result.documents || [])
      }
      await loadLists()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  // 2. 处理本地模拟 JSON 文件导入
  async function handleJsonFile(file: File) {
    setBusy('import')
    setError('')
    try {
      const text = await file.text()
      const payload = JSON.parse(text)
      const result = await importV2Api.importOcrDocumentJson({
        ocrDocument: payload.ocrDocument || payload,
        sourceDocument: {
          title: file.name.replace(/\.json$/i, ''),
          originalFileName: file.name,
        },
      })
      await loadLists()
      setSelectedOcrId(result.ocrDocument.id)
      setQuestions([])
      setDiagnostics(null)
      showNotice('本地模拟 OCRDocument JSON 导入完成，请点击下方生成题目。')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // 4. JSON 模式：生成待核对题目
  async function parseSelectedOcr() {
    if (!selectedOcrId) return
    setBusy('parse')
    setError('')
    try {
      const result = await importV2Api.parseCandidates(selectedOcrId, selectedParserPresetId ? { presetId: selectedParserPresetId } : {})
      const unified = (result.items || []).map(fromCandidate)
      setQuestions(unified)
      setDiagnostics(result.diagnostics || null)
      setCommittedIds(new Set(unified.filter((item) => item.status === 'committed').map((item) => item.id)))
      setSelectedIds(new Set())
      if (unified.length > 0) {
        setActiveQuestionId(unified[0].id)
      }
      await loadLists()
      setShowCheckArea(true)
      setActiveStepTab('review')
      if (selectedOcr?.sourceDocumentId) navigateToCandidates(selectedOcr.sourceDocumentId)
      showNotice('已自动提取并生成待核对题目')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  // 5. JSON 模式：查看已有候选
  async function loadCandidatesForSelected() {
    if (!selectedOcr) return
    setBusy('load-candidates')
    setError('')
    try {
      const result = await fetchCandidates(selectedOcr.sourceDocumentId)
      const unified = (result.items || []).map(fromCandidate)
      setQuestions(unified)
      setDiagnostics(result.diagnostics || null)
      setCommittedIds(new Set(unified.filter((item) => item.status === 'committed').map((item) => item.id)))
      setSelectedIds(new Set())
      if (unified.length > 0) {
        setActiveQuestionId(unified[0].id)
      }
      setShowCheckArea(true)
      setActiveStepTab('review')
      navigateToCandidates(selectedOcr.sourceDocumentId)
      showNotice('已加载当前识别记录的历史题目')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  // 6. 单题确认存入题库
  async function commitSingleQuestion(q: UnifiedQuestion) {
    setBusy(q.id)
    setError('')
    try {
      const result = await importV2Api.commitCandidate(q.id)
      const committed = fromCandidate(result.candidate)
      setQuestions((items) => items.map((item) => item.id === q.id ? committed : item))
      setCommittedIds((prev) => new Set([...prev, q.id]))
      showNotice('该题目已成功确认入库')
      await loadLists()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  async function startManualFix(candidateId: string, mode: 'stem' | 'analysis' | 'figure') {
    try {
      setBusy(candidateId)
      await importV2Api.createManualFixSession(candidateId)
      const sourceDocId = activeQuestion?.rawItem?.sourceDocumentId || selectedDoc?.id || selectedOcr?.sourceDocumentId || sourceDocumentIdFromPath || ''
      navigate(`${documentUrl(sourceDocId)}/candidates/${encodeURIComponent(candidateId)}/manual-fix?mode=${mode}`)
    } catch (err) {
      window.alert('初始化手动修正失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy('')
    }
  }

  async function handleSaveQuestionNo() {
    if (!activeQuestion) return
    const trimmed = editingQuestionNo.trim()
    if (trimmed === activeQuestion.questionNo) return
    
    try {
      const res = await importV2Api.updateCandidate(activeQuestion.id, { questionNo: trimmed })
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === activeQuestion.id ? fromCandidate(res.candidate) : q
        )
      )
      showNotice('题号已成功更新')
      await loadLists()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleSaveQuestionType(nextType: string) {
    if (!activeQuestion) return
    if (nextType === activeQuestion.questionType) return
    setSavingQuestionType(activeQuestion.id)
    setError('')
    try {
      const res = await importV2Api.updateCandidate(activeQuestion.id, { questionType: nextType })
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === activeQuestion.id ? fromCandidate(res.candidate) : q
        )
      )
      showNotice('题型已更新')
      await loadLists()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingQuestionType('')
    }
  }

  async function handleResolveUnplacedFigure(blockId: string, action: 'assign' | 'ignore') {
    if (!activeQuestion) return
    const assignmentKey = `${activeQuestion.id}:${blockId}`
    const assignment = figureAssignments[assignmentKey] || { candidateId: activeQuestion.id, usage: 'stem' as const }
    setBusy(`figure-${blockId}`)
    setError('')
    try {
      await importV2Api.resolveUnplacedFigure(activeQuestion.id, blockId, {
        action,
        targetCandidateId: assignment.candidateId,
        usage: assignment.usage,
      })
      const sourceDocumentId = String(activeQuestion.rawItem?.sourceDocumentId || selectedDoc?.id || sourceDocumentIdFromPath || '')
      if (sourceDocumentId) {
        invalidateImportV2Queries()
        const result = await fetchCandidates(sourceDocumentId, { force: true })
        setQuestions((result.items || []).map(fromCandidate))
        setDiagnostics(result.diagnostics || null)
      }
      setFigureAssignments((current) => {
        const next = { ...current }
        delete next[assignmentKey]
        return next
      })
      showNotice(action === 'ignore' ? '已忽略该图片，核对提示已解除。' : '图片归属已保存。')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  async function handleMoveCandidateFigure(figure: UnifiedQuestion['figures'][number]) {
    if (!activeQuestion) return
    const draftKey = `${activeQuestion.id}:${figure.id}`
    const currentUsage = figure.usage === 'analysis' ? 'analysis' : figure.usage === 'options' ? 'options' : 'stem'
    const draft = figureMoveDrafts[draftKey] || {
      candidateId: activeQuestion.id,
      usage: currentUsage,
      optionLabel: figure.optionLabel || 'A',
    }
    const target = questions.find((question) => question.id === draft.candidateId)
    if (!target) return

    setBusy(`move-figure-${figure.id}`)
    setError('')
    try {
      await importV2Api.moveCandidateFigure(activeQuestion.id, figure.id, {
        targetCandidateId: target.id,
        usage: draft.usage,
        optionLabel: draft.usage === 'options' ? draft.optionLabel : undefined,
        sourceExpectedContentRevision: activeQuestion.rawItem?.contentRevision,
        targetExpectedContentRevision: target.rawItem?.contentRevision,
      })
      const sourceDocumentId = String(activeQuestion.rawItem?.sourceDocumentId || selectedDoc?.id || sourceDocumentIdFromPath || '')
      if (sourceDocumentId) {
        invalidateImportV2Queries()
        const result = await fetchCandidates(sourceDocumentId, { force: true })
        setQuestions((result.items || []).map(fromCandidate))
        setDiagnostics(result.diagnostics || null)
      }
      setFigureMoveDrafts((current) => {
        const next = { ...current }
        delete next[draftKey]
        return next
      })
      showNotice(target.id === activeQuestion.id
        ? '图片用途已更新。'
        : `图片已移动到第 ${target.questionNo || '未编号'} 题。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  async function handleDeleteCandidate(candidateId: string) {
    if (!window.confirm('确定要删除这道待确认的题目吗？此操作将同步清除与之关联的标注框选等草稿数据，且不可恢复。')) {
      return
    }
    setBusy(candidateId)
    setError('')
    try {
      await importV2Api.deleteQuestionCandidate(candidateId)
      showNotice('题目已成功删除。')
      
      // Select next active question
      if (activeQuestionId === candidateId) {
        const activeIdx = filteredQuestions.findIndex((q) => q.id === candidateId)
        const sourceDocId = selectedDoc?.id || sourceDocumentIdFromPath
        if (filteredQuestions.length > 1) {
          const nextIdx = activeIdx === filteredQuestions.length - 1 ? activeIdx - 1 : activeIdx + 1
          const nextCandidateId = filteredQuestions[nextIdx].id
          setActiveQuestionId(nextCandidateId)
          if (sourceDocId) navigateToCandidate(sourceDocId, nextCandidateId, { replace: true })
        } else {
          setActiveQuestionId(null)
          if (sourceDocId) navigateToCandidates(sourceDocId, { replace: true })
        }
      }
      
      // Update local list
      setQuestions((prev) => prev.filter((q) => q.id !== candidateId))
      
      // Clear selected list if deleted
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(candidateId)
        return next
      })

      await loadLists()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  function markdownPreviewDocumentOption(
    role: ImportV2ImportJobDocument['role'],
    ocrDocumentId: string,
    source?: ImportV2SourceDocument | null,
  ): MarkdownPreviewDocumentOption {
    return {
      role,
      ocrDocumentId,
      label: importJobDocumentRoleLabel(role) || '识别稿',
      description: source?.originalFileName || source?.title || '',
    }
  }

  function appendMarkdownPreviewDocumentOption(options: MarkdownPreviewDocumentOption[], option: MarkdownPreviewDocumentOption) {
    if (!option.ocrDocumentId || options.some((item) => item.ocrDocumentId === option.ocrDocumentId)) return
    options.push(option)
  }

  async function resolveOcrDocumentForSource(sourceDocumentId?: string, cached?: ImportV2OcrDocument | null) {
    if (!sourceDocumentId) return null
    if (cached?.sourceDocumentId === sourceDocumentId) return cached
    const local = ocrDocuments.find((item) => item.sourceDocumentId === sourceDocumentId)
    if (local) return local
    const result = await importV2Api.listOcrDocuments(sourceDocumentId)
    const items = result.items || []
    if (items.length) {
      setOcrDocuments((current) => {
        const next = [...current]
        for (const item of items) {
          if (!next.some((existing) => existing.id === item.id)) next.push(item)
        }
        return next
      })
    }
    return items[0] || null
  }

  async function markdownPreviewDocumentsForSelectedDoc() {
    const options: MarkdownPreviewDocumentOption[] = []

    if (activeImportJob?.mode === 'separated_documents') {
      const questionOcr = await resolveOcrDocumentForSource(activeImportJobQuestionDocument?.sourceDocumentId, activeImportJobQuestionOcr)
      const solutionOcr = await resolveOcrDocumentForSource(activeImportJobSolutionDocument?.sourceDocumentId, activeImportJobSolutionOcr)
      if (questionOcr) appendMarkdownPreviewDocumentOption(options, markdownPreviewDocumentOption('questions', questionOcr.id, activeImportJobQuestionSource))
      if (solutionOcr) appendMarkdownPreviewDocumentOption(options, markdownPreviewDocumentOption('solutions', solutionOcr.id, activeImportJobSolutionSource))

      const preferredOcrDocumentId = selectedImportJobDocument?.role === 'solutions'
        ? solutionOcr?.id
        : selectedImportJobDocument?.role === 'questions'
          ? questionOcr?.id
          : selectedDocOcr?.id
      const fallbackOcrDocumentId = selectedDocOcr?.id || selectedOcrId || options[0]?.ocrDocumentId || ''
      if (!options.length && fallbackOcrDocumentId) {
        appendMarkdownPreviewDocumentOption(options, markdownPreviewDocumentOption(selectedImportJobDocument?.role || 'full', fallbackOcrDocumentId, selectedDoc))
      }
      return {
        ocrDocumentId: preferredOcrDocumentId || fallbackOcrDocumentId,
        documentOptions: options,
      }
    }

    const ocrDocumentId = selectedDocOcr?.id || selectedOcrId || ''
    if (ocrDocumentId) {
      appendMarkdownPreviewDocumentOption(options, markdownPreviewDocumentOption(selectedImportJobDocument?.role || 'full', ocrDocumentId, selectedDoc))
    }
    return { ocrDocumentId, documentOptions: options }
  }

  async function markdownPreviewDocumentsForActiveQuestion(focusKind: 'stem' | 'answer' | 'analysis') {
    const options: MarkdownPreviewDocumentOption[] = []

    if (activeImportJob?.mode === 'separated_documents') {
      const questionSourceDocumentId = activeImportJobQuestionDocument?.sourceDocumentId || activeQuestion?.rawItem?.sourceDocumentId || ''
      const solutionSourceDocumentId = activeImportJobSolutionDocument?.sourceDocumentId || ''
      const questionOcr = await resolveOcrDocumentForSource(questionSourceDocumentId, activeImportJobQuestionOcr)
      const solutionOcr = await resolveOcrDocumentForSource(solutionSourceDocumentId, activeImportJobSolutionOcr)
      const questionOcrDocumentId = questionOcr?.id || activeQuestion?.rawItem?.ocrDocumentId || (selectedDocIsImportJobQuestion ? selectedDocOcr?.id : '') || ''
      const solutionOcrDocumentId = solutionOcr?.id || ''

      if (questionOcrDocumentId) {
        appendMarkdownPreviewDocumentOption(options, markdownPreviewDocumentOption('questions', questionOcrDocumentId, activeImportJobQuestionSource))
      }
      if (solutionOcrDocumentId) {
        appendMarkdownPreviewDocumentOption(options, markdownPreviewDocumentOption('solutions', solutionOcrDocumentId, activeImportJobSolutionSource))
      }

      return {
        ocrDocumentId: focusKind === 'stem'
          ? questionOcrDocumentId || solutionOcrDocumentId
          : solutionOcrDocumentId || questionOcrDocumentId,
        documentOptions: options,
      }
    }

    const sourceDocumentId = activeQuestion?.rawItem?.sourceDocumentId || selectedDoc?.id || ''
    const source = sourceDocumentId ? sourceDocuments.find((item) => item.id === sourceDocumentId) || selectedDoc : selectedDoc
    const ocrDocumentId = activeQuestion?.rawItem?.ocrDocumentId || selectedDocOcr?.id || selectedOcrId || ''
    if (ocrDocumentId) {
      appendMarkdownPreviewDocumentOption(options, markdownPreviewDocumentOption(selectedImportJobDocument?.role || 'full', ocrDocumentId, source))
    }
    return { ocrDocumentId, documentOptions: options }
  }

  async function openSelectedDocMarkdownPreview() {
    const { ocrDocumentId, documentOptions } = await markdownPreviewDocumentsForSelectedDoc()
    if (!ocrDocumentId) {
      setError('当前资料尚未生成 OCR 识别稿。')
      return
    }
    setMarkdownPreviewTarget({
      ocrDocumentId,
      documentOptions,
      candidateIds: questions.map((item) => item.id),
      title: selectedDoc?.originalFileName ? `模型识别稿：${selectedDoc.originalFileName}` : '模型识别稿',
    })
  }

  async function handleApplySelectedParserPreset() {
    if (!selectedDoc) return
    const preset = parserPresets.find((item) => item.id === selectedParserPresetId)
    if (!preset) {
      setError('请先选择导入规则预设。')
      return
    }
    const ok = window.confirm(`将使用预设「${preset.name}」重新生成本批次未入库候选题。确定继续吗？`)
    if (!ok) return
    await handleRecleanCandidates(selectedDoc, { presetId: preset.id }, { skipConfirm: true, label: `已使用预设「${preset.name}」重新生成待核对题目` })
  }

  async function handleApplyPreviewParserConfig(config: ImportFlowV2ParserConfig) {
    if (!selectedDoc) {
      setError('请先选择要重解析的资料。')
      return
    }
    const ok = window.confirm('将使用预览窗口中的当前策略重新生成本批次未入库候选题。确定继续吗？')
    if (!ok) return
    setMarkdownPreviewTarget(null)
    await handleRecleanCandidates(selectedDoc, { configOverride: config }, { skipConfirm: true, label: '已使用预览策略重新生成待核对题目' })
  }

  async function openActiveQuestionMarkdownPreview(focusKind: 'stem' | 'answer' | 'analysis') {
    if (!activeQuestion) return
    const { ocrDocumentId, documentOptions } = await markdownPreviewDocumentsForActiveQuestion(focusKind)
    if (!ocrDocumentId) {
      setError(focusKind === 'stem' ? '当前题目尚未关联 OCR 识别稿。' : '当前批次尚未找到答案解析 OCR 识别稿。')
      return
    }
    setMarkdownPreviewTarget({
      ocrDocumentId,
      documentOptions,
      candidateId: activeQuestion.id,
      candidateIds: questions.map((item) => item.id),
      questionNo: activeQuestion.questionNo,
      focusKind,
      title: `第 ${activeQuestion.questionNo || '？'} 题${focusKind === 'stem' ? '题干' : focusKind === 'answer' ? '答案' : '解析'}来源诊断`,
    })
  }

  // 7. 多选/批量确认存入题库
  async function handleBulkConfirm() {
    if (selectedIds.size === 0) return
    const idsArray = Array.from(selectedIds)
    setBusy('bulk-confirm')
    setError('')
    try {
      const result = await importV2Api.commitCandidates(idsArray)
      const committedIdsSet = new Set(idsArray.filter((id) => !result.errors?.some((error) => error.id === id)))
      setQuestions((items) => items.map((item) => committedIdsSet.has(item.id) ? { ...item, status: 'committed' } : item))
      showNotice(`批量确认完成：成功入库 ${result.success} 题${result.failed ? `，失败 ${result.failed} 题` : ''}。`)

      setCommittedIds((prev) => {
        const next = new Set(prev)
        committedIdsSet.forEach(id => next.add(id))
        return next
      })
      setSelectedIds(new Set())
      await loadLists()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  // 8. 跳过的候选题会从待审核集合中永久移除，不会进入题库。
  async function handleBulkSkip() {
    if (selectedIds.size === 0) return
    const idsArray = Array.from(selectedIds)
    const skippedIds = new Set(idsArray)
    setBusy('bulk-skip')
    setError('')
    try {
      const result = await importV2Api.skipCandidates(idsArray)
      const remainingFiltered = filteredQuestions.filter((item) => !skippedIds.has(item.id))
      if (activeQuestionId && skippedIds.has(activeQuestionId)) {
        const activeIndex = filteredQuestions.findIndex((item) => item.id === activeQuestionId)
        const nextQuestion = remainingFiltered[Math.min(Math.max(activeIndex, 0), remainingFiltered.length - 1)]
        setActiveQuestionId(nextQuestion?.id || null)
        const sourceDocId = selectedDoc?.id || sourceDocumentIdFromPath
        if (sourceDocId) {
          if (nextQuestion) navigateToCandidate(sourceDocId, nextQuestion.id, { replace: true })
          else navigateToCandidates(sourceDocId, { replace: true })
        }
      }
      setQuestions((items) => items.filter((item) => !skippedIds.has(item.id)))
      setCommittedIds((prev) => {
        const next = new Set(prev)
        idsArray.forEach((id) => next.delete(id))
        return next
      })
      setSelectedIds(new Set())
      showNotice(`已跳过并移除 ${result.success} 道题，这些题目不会入库。`)
      await loadLists()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  const reviewModel = useMemo(() => buildCandidateReviewModel({
    questions,
    activeQuestionId,
    activeTab,
    activeDiagnosticCode,
    committedIds,
  }), [activeDiagnosticCode, activeQuestionId, activeTab, committedIds, questions])
  const {
    activeQuestion,
    activeQuestionCommitted,
    activeQuestionReviewState,
    committedQuestionCount,
    filteredQuestions,
    parseDiagnosticCounts,
    reviewTabs,
    selectableList,
    visibleActiveParseDiagnostics,
  } = reviewModel

  useEffect(() => {
    if (activeQuestion) {
      setEditingQuestionNo(activeQuestion.questionNo || '')
    } else {
      setEditingQuestionNo('')
    }
  }, [activeQuestion?.id, activeQuestion?.questionNo])

  useEffect(() => {
    if (!activeQuestionId) return
    const frame = window.requestAnimationFrame(() => {
      const list = candidateListRef.current
      const item = candidateItemRefs.current.get(activeQuestionId)
      if (!list || !item) return
      const listRect = list.getBoundingClientRect()
      const itemRect = item.getBoundingClientRect()
      if (itemRect.top < listRect.top) list.scrollTop -= listRect.top - itemRect.top
      else if (itemRect.bottom > listRect.bottom) list.scrollTop += itemRect.bottom - listRect.bottom
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeQuestionId, filteredQuestions])

  const allSelected = useMemo(() => {
    return selectableList.length > 0 && selectableList.every(q => selectedIds.has(q.id))
  }, [selectableList, selectedIds])

  function handleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(selectableList.map(q => q.id)))
    }
  }

  function handleSelectToggle(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className={activeStepTab === 'review' ? 'flex min-h-0 flex-col gap-3' : 'space-y-6'}>
      {activeStepTab === 'review' && selectedDoc ? (
        <section className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="返回导入批次列表"
              title="返回导入批次列表"
              onClick={() => navigate('/tools/import')}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="size-4" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-foreground">
                {activeImportJob?.paperTitle || activeImportJob?.title || selectedDoc.paperTitle || selectedDoc.originalFileName || '未命名资料'}
              </h1>
              <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <button
                  type="button"
                  onClick={() => navigateToDocument(selectedDoc.id)}
                  className="shrink-0 transition-colors hover:text-foreground"
                >
                  资料与识别
                </button>
                <ChevronLeft className="size-3 rotate-180" />
                <span className="shrink-0 font-medium text-foreground">题目核对</span>
                <span aria-hidden="true">·</span>
                <span className="truncate">{questions.length} 题，{committedQuestionCount} 题已入库</span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <select
              aria-label="导入规则预设"
              className="h-8 min-w-0 max-w-44 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground outline-none focus:ring-2 focus:ring-ring"
              value={selectedParserPresetId}
              onChange={(event) => setSelectedParserPresetId(event.target.value)}
              disabled={Boolean(busy)}
              title="导入规则预设"
            >
              {parserPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name}</option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              icon={FileText}
              disabled={!selectedDocOcr && !selectedOcrId}
              onClick={openSelectedDocMarkdownPreview}
              className="hidden xl:inline-flex"
            >
              模型识别稿
            </Button>
            <ReviewActionMenu
              label="批次操作"
              actions={[
                {
                  label: '查看模型识别稿',
                  hint: '检查 OCR 原文与候选题来源定位',
                  icon: FileText,
                  disabled: !selectedDocOcr && !selectedOcrId,
                  onSelect: openSelectedDocMarkdownPreview,
                },
                {
                  label: '编辑批次信息',
                  icon: PencilLine,
                  onSelect: openEditModal,
                },
                {
                  label: '按当前预设重解析',
                  hint: '替换本批次尚未入库的候选题',
                  icon: RefreshCcw,
                  disabled: Boolean(busy) || !selectedParserPresetId || !canRecleanSelectedDoc,
                  onSelect: handleApplySelectedParserPreset,
                  separatorBefore: true,
                },
                {
                  label: busy === `ocr-${selectedDoc.id}` ? '识别中...' : '重新识别',
                  hint: selectedDocCommittedCount > 0 ? '已有题目入库，当前不可用' : '重新调用 OCR 并清空未入库候选题',
                  icon: busy === `ocr-${selectedDoc.id}` ? LoaderCircle : RefreshCcw,
                  disabled: Boolean(busy) || !canReidentifySelectedDoc,
                  onSelect: () => handleReidentifySource(selectedDoc),
                },
                {
                  label: busy === `reclean-${selectedDoc.id}` ? '清洗中...' : '重新清洗',
                  hint: selectedDocCommittedCount > 0 ? '已有题目入库，当前不可用' : '按当前清洗脚本重新生成候选题',
                  icon: busy === `reclean-${selectedDoc.id}` ? LoaderCircle : RefreshCcw,
                  disabled: Boolean(busy) || !canRecleanSelectedDoc,
                  onSelect: () => handleRecleanCandidates(selectedDoc),
                },
              ]}
            />
          </div>
        </section>
      ) : (
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" icon={ChevronLeft} onClick={() => navigate('/tools/import')}>
            返回列表
          </Button>
          <PageTitle
            title="资料导入工作台"
            desc="核对题干、答案、解析和题图后，确认入库。"
            path="/tools/import"
          />
        </div>
      )}


      {/* 消息提示框 */}
      {notice ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-4 py-2.5 text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200 flex items-center gap-2 shadow-sm animate-in fade-in duration-200">
          <Check className="size-3.5 text-zinc-900 dark:text-zinc-50" />
          <span>{notice}</span>
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50/20 px-4 py-2.5 text-xs text-red-700 dark:border-red-900/30 dark:bg-red-950/10 dark:text-red-400 flex items-center gap-2 shadow-sm animate-in fade-in duration-200">
          <BadgeAlert className="size-3.5" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* 上传页保留流程切换；核对页使用上方紧凑上下文栏。 */}
      {activeStepTab === 'upload' ? (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex bg-zinc-100/80 dark:bg-zinc-900/80 p-0.5 rounded-lg border border-zinc-200/50 dark:border-zinc-800/50 w-full sm:w-80 select-none">
          <button
            onClick={() => {
              if (selectedDoc) navigateToDocument(selectedDoc.id)
              else setActiveStepTab('upload')
            }}
            className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-zinc-200/20 bg-white py-1.5 text-xs font-semibold text-zinc-900 shadow-xs dark:bg-zinc-950 dark:text-zinc-50"
          >
            1. 资料上传与识别
          </button>
          <button
            onClick={() => {
              if (selectedDoc) navigateToCandidates(selectedDoc.id)
              else setActiveStepTab('review')
            }}
            className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-300"
          >
            2. 题目核对区
            {questions.length > 0 && (
              <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-[9px] bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-950 font-bold ml-1">
                {questions.filter(q => q.status !== 'committed' && !committedIds.has(q.id)).length}
              </span>
            )}
          </button>
        </div>

      </div>
      ) : null}

      {/* 第一步：上传与识别 */}
      {activeStepTab === 'upload' && (
        <div className="grid gap-6 lg:grid-cols-12 items-start">
          {/* 左栏：上传与列表 */}
          <div className="lg:col-span-4 space-y-4 flex flex-col">
            <Panel
              title="试卷与批次信息"
              actions={selectedDoc ? (
                <button
                  type="button"
                  onClick={openEditModal}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
                >
                  <PencilLine className="size-3.5" />
                  编辑
                </button>
              ) : null}
            >
              {selectedDoc && (
                <div className="space-y-2 text-[11px] text-zinc-500">
                  <div className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                    {activeImportJob?.paperTitle || activeImportJob?.title || selectedDoc.paperTitle || '未命名资料'}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline">{paperKindOptions.find((item) => item.value === (activeImportJob?.paperKind || selectedDoc.paperKind))?.label || '未分类'}</Badge>
                    <Badge variant="outline">{activeImportJob?.stage || selectedDoc.stage || '高三'}</Badge>
                    <Badge variant="outline">{activeImportJob?.subject || selectedDoc.subject || '数学'}</Badge>
                  </div>
                  <div className="truncate">
                    {[activeImportJob?.province || selectedDoc.province, activeImportJob?.city || selectedDoc.city, activeImportJob?.examYear || selectedDoc.examYear || '', activeImportJob?.sourceOrg || selectedDoc.sourceOrg].filter(Boolean).join(' · ') || '未填写地区、年份和来源机构'}
                  </div>
                </div>
              )}
            </Panel>

            {/* 资料列表 */}
            <Panel title="批次内文档列表">
              <div className="space-y-2.5 max-h-[450px] overflow-y-auto pr-1">
                {activeImportJobDocuments.length === 0 ? (
                  <Empty text="此批次暂无关联文档" />
                ) : (
                  activeImportJobDocuments.map((jobDoc) => {
                    const item = jobDoc.sourceDocument
                    const statusInfo = getDocStatus(item)
                    const isSelected = selectedDoc?.id === item.id
                    
                    return (
                      <div
                        key={item.id}
                        onClick={() => navigateToDocument(item.id)}
                        className={`group border rounded-xl p-3 cursor-pointer transition-all ${
                          isSelected
                            ? 'border-zinc-900 bg-zinc-50/40 dark:border-zinc-100 dark:bg-zinc-900/40'
                            : 'border-zinc-200 bg-white hover:bg-zinc-50/10 dark:border-zinc-800 dark:bg-zinc-955'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200 max-w-[65%]" title={item.originalFileName || item.title}>
                            {item.originalFileName || item.title}
                          </p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Badge variant={jobDoc.role === 'solutions' ? 'warning' : 'outline'}>{importJobDocumentRoleLabel(jobDoc.role)}</Badge>
                            <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                            <button
                              disabled={busy === `delete-${item.id}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleDeleteSourceDoc(item.id)
                              }}
                              className="text-zinc-400 hover:text-red-600 dark:text-zinc-500 dark:hover:text-red-400 p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900/50 transition-colors cursor-pointer"
                              title="删除资料"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                        
                        <div className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400 space-y-0.5">
                          {item.importStats && item.importStats.candidateCount > 0 ? (
                            <>
                              <div>已生成 {item.importStats.candidateCount} 道待确认题目</div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span>已入库 {item.importStats.committedCount} / {item.importStats.candidateCount}</span>
                                {(item.importStats.needsManualFixCount + item.importStats.blockedCount) > 0 && (
                                  <span className="text-red-500 font-medium">需要修正 {(item.importStats.needsManualFixCount + item.importStats.blockedCount)}</span>
                                )}
                                {item.importStats.needsReviewCount > 0 && (
                                  <span className="text-amber-600 font-medium">建议核对 {item.importStats.needsReviewCount}</span>
                                )}
                                {item.importStats.parseDiagnosticCount > 0 && (
                                  <span className="text-sky-600 font-medium dark:text-sky-400">结构诊断 {item.importStats.parseDiagnosticCount}</span>
                                )}
                              </div>
                            </>
                          ) : (
                            <div className="italic text-zinc-400">暂无识别题目</div>
                          )}
                          
                          {item.status === 'ocr_failed' && sourceOcrErrors[item.id] && (
                            <p className="text-red-500 truncate mt-1" title={sourceOcrErrors[item.id]}>
                              错误: {sourceOcrErrors[item.id]}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </Panel>
          </div>

          {/* 右栏：导入工作流操作 */}
          <div className="lg:col-span-8 space-y-4">
            {selectedDoc ? (
              <Panel title="导入工作流操作">
                <div className="space-y-6">
                  {/* 标题 & 状态 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4 dark:border-zinc-800">
                    <div className="space-y-1 min-w-0 flex-1">
                      <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 truncate pr-4" title={selectedDoc.originalFileName || selectedDoc.title}>
                        {selectedDoc.originalFileName || selectedDoc.title}
                      </h2>
                      <p className="text-[10px] text-zinc-400">
                        创建时间: {new Date(selectedDoc.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <Badge variant={getDocStatus(selectedDoc).variant} className="text-xs px-2.5 py-1">
                        {getDocStatus(selectedDoc).label}
                      </Badge>
                    </div>
                  </div>

                  {/* 页面主流程 - Stepper */}
                  <div className="bg-zinc-50/30 dark:bg-zinc-900/5 p-4 rounded-xl border border-zinc-150 dark:border-zinc-800">
                    <div className="flex items-center w-full select-none">
                      {steps.map((step, idx) => (
                        <div key={idx} className="flex items-center flex-1 last:flex-initial">
                          <div className="flex items-center gap-2">
                            <div className={`flex size-7 items-center justify-center rounded-full border text-xs font-semibold transition-all ${
                              step.state === 'done'
                                ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
                                : step.state === 'current'
                                  ? 'bg-zinc-900 border-zinc-900 text-white dark:bg-zinc-100 dark:border-zinc-100 dark:text-zinc-950 shadow-md ring-2 ring-zinc-500/20'
                                  : 'bg-zinc-100 border-zinc-200 text-zinc-400 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-500'
                            }`}>
                              {step.state === 'done' ? <Check className="size-4 stroke-[3]" /> : idx + 1}
                            </div>
                            <span className={`text-xs font-semibold whitespace-nowrap ${
                              step.state === 'done'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : step.state === 'current'
                                  ? 'text-zinc-900 dark:text-zinc-100'
                                  : 'text-zinc-400 dark:text-zinc-500'
                            }`}>
                              {step.title}
                            </span>
                          </div>
                          {idx < steps.length - 1 && (
                            <div className={`h-[2px] flex-1 mx-4 rounded min-w-[20px] transition-all ${
                              step.state === 'done' ? 'bg-emerald-500' : 'bg-zinc-200 dark:bg-zinc-800'
                            }`} />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {!selectedDocIsImportJobSolution && parserPresets.length > 0 ? (
                    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50/30 p-3 dark:border-zinc-800 dark:bg-zinc-900/20 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">导入规则预设</p>
                        <p className="mt-0.5 text-[11px] text-zinc-400">生成或重解析候选题时使用。</p>
                      </div>
                      <select
                        className="h-8 min-w-56 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
                        value={selectedParserPresetId}
                        onChange={(event) => setSelectedParserPresetId(event.target.value)}
                        disabled={Boolean(busy)}
                      >
                        {parserPresets.map((preset) => (
                          <option key={preset.id} value={preset.id}>{preset.name}</option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  {/* 核心操作区域 */}
                  <div className="bg-white dark:bg-zinc-955 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs space-y-4">
                    {/* uploaded */}
                    {selectedDoc.status === 'uploaded' && (
                      <div className="space-y-4">
                        <p className="text-xs text-zinc-500 leading-relaxed">
                          资料已成功保存。点击“开始自动识别”将通过 {currentOcrProviderLabel} 自动提取试卷题目、公式及插图。
                        </p>
                        <Button
                          size="default"
                          icon={Play}
                          disabled={Boolean(busy)}
                          onClick={() => startSourceOcr(selectedDoc.id)}
                          className="w-full sm:w-auto"
                        >
                          {busy === `ocr-${selectedDoc.id}` ? '正在启动...' : '开始自动识别'}
                        </Button>
                      </div>
                    )}

                    {/* ocr_failed */}
                    {selectedDoc.status === 'ocr_failed' && (
                      <div className="space-y-4">
                        <div className="rounded-lg bg-red-50/20 border border-red-200/30 p-3 text-xs text-red-700 dark:text-red-400">
                          <p className="font-semibold mb-1">OCR 识别失败错误信息：</p>
                          <p className="font-mono">{sourceOcrErrors[selectedDoc.id] || '未知识别错误。'}</p>
                        </div>
                        <Button
                          size="default"
                          icon={Play}
                          disabled={Boolean(busy)}
                          onClick={() => startSourceOcr(selectedDoc.id)}
                          className="w-full sm:w-auto"
                        >
                          重新识别
                        </Button>
                      </div>
                    )}

                    {/* ocr_running */}
                    {selectedDoc.status === 'ocr_running' && (
                      <div className="flex flex-col items-center justify-center py-6 text-center space-y-3">
                        <LoaderCircle className="size-8 animate-spin text-zinc-500" />
                        <p className="text-xs text-zinc-500 font-medium">
                          识别中，可能需要几十秒到数分钟，系统正在后台轮询...
                        </p>
                      </div>
                    )}

                    {/* ocr_succeeded 且 candidateCount = 0 */}
                    {selectedDoc.status === 'ocr_succeeded' && (selectedDoc.importStats?.candidateCount || 0) === 0 && (
                      <div className="space-y-4">
                        {selectedDocIsImportJobSolution ? (
                          <>
                            <p className="text-xs text-zinc-500 leading-relaxed">
                              答案解析文档已识别完成。它会在原卷生成候选题时自动参与合并。
                            </p>
                            {activeImportJobQuestionSource ? (
                              <div className="flex flex-wrap gap-3">
                                <Button
                                  size="default"
                                  icon={FileText}
                                  variant="outline"
                                  onClick={() => navigateToDocument(activeImportJobQuestionSource.id)}
                                  className="w-full sm:w-auto"
                                >
                                  切换到原卷
                                </Button>
                                <Button
                                  size="default"
                                  variant="outline"
                                  icon={busy === `ocr-${selectedDoc.id}` ? LoaderCircle : RefreshCcw}
                                  disabled={Boolean(busy) || !canReidentifySelectedDoc}
                                  title={selectedDocCommittedCount > 0 ? '该批次已有题目入库，暂不支持重新识别。' : '重新调用 OCR，并清空未入库候选题。'}
                                  onClick={() => handleReidentifySource(selectedDoc)}
                                  className="w-full sm:w-auto"
                                >
                                  {busy === `ocr-${selectedDoc.id}` ? '识别中...' : '重新识别'}
                                </Button>
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <p className="text-xs text-zinc-500 leading-relaxed">
                              {selectedDocIsImportJobQuestion
                                ? activeImportJobSolutionReady
                                  ? '原卷与答案解析均已准备好。现在可合并生成待核对的题目草稿列表。'
                                  : '原卷已识别完成。请先完成答案解析文档 OCR，再合并生成待核对题目。'
                                : 'OCR 智能识别已完成，现在可分析并生成待核对的题目草稿列表。'}
                            </p>
                            {selectedDocIsImportJobQuestion && activeImportJobSolutionSource ? (
                              <div className="rounded-lg border border-zinc-200 bg-zinc-50/40 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/30">
                                答案解析：{activeImportJobSolutionSource.originalFileName || activeImportJobSolutionSource.title} · {getDocStatus(activeImportJobSolutionSource).label}
                              </div>
                            ) : null}
                            <div className="flex flex-wrap gap-3">
                              <Button
                                size="default"
                                icon={Play}
                                disabled={Boolean(busy) || (selectedDocIsImportJobQuestion && !activeImportJobSolutionReady)}
                                onClick={() => handleGenerateCandidates(selectedDoc)}
                                className="w-full sm:w-auto"
                              >
                                {busy === `action-${selectedDoc.id}` ? '生成中...' : selectedDocIsImportJobQuestion ? '合并生成待确认题目' : '生成待确认题目'}
                              </Button>
                              <Button
                                size="default"
                                variant="outline"
                                icon={busy === `ocr-${selectedDoc.id}` ? LoaderCircle : RefreshCcw}
                                disabled={Boolean(busy) || !canReidentifySelectedDoc}
                                title={selectedDocCommittedCount > 0 ? '该批次已有题目入库，暂不支持重新识别。' : '重新调用 OCR，并清空未入库候选题。'}
                                onClick={() => handleReidentifySource(selectedDoc)}
                                className="w-full sm:w-auto"
                              >
                                {busy === `ocr-${selectedDoc.id}` ? '识别中...' : '重新识别'}
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* parsed / partially_parsed 且 allCommitted = false */}
                    {(selectedDoc.status === 'parsed' || selectedDoc.status === 'partially_parsed') && !selectedDoc.importStats?.allCommitted && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <div className="border border-zinc-100 dark:border-zinc-800 rounded-lg p-3 bg-zinc-50/10">
                            <span className="text-[10px] text-zinc-400 block">已入库</span>
                            <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">
                              {selectedDoc.importStats?.committedCount || 0} / {selectedDoc.importStats?.candidateCount || 0}
                            </span>
                          </div>
                          <div className="border border-zinc-100 dark:border-zinc-800 rounded-lg p-3 bg-zinc-50/10">
                            <span className="text-[10px] text-zinc-400 block">剩余待核对</span>
                            <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">
                              {selectedDoc.importStats?.uncommittedCount || 0} 题
                            </span>
                          </div>
                          <div className="border border-zinc-100 dark:border-zinc-800 rounded-lg p-3 bg-zinc-50/10 col-span-2 sm:col-span-1">
                            <span className="text-[10px] text-zinc-400 block font-medium">需要修正</span>
                            <span className="text-sm font-bold text-red-500">
                              {(selectedDoc.importStats?.needsManualFixCount || 0) + (selectedDoc.importStats?.blockedCount || 0)} 题
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap gap-3 pt-2">
                          <Button
                            size="default"
                            icon={CheckCircle2}
                            disabled={Boolean(busy)}
                            onClick={() => handleContinueCheck(selectedDoc)}
                            className="w-full sm:w-auto"
                          >
                            进入题目核对区
                          </Button>
                          <Button
                            size="default"
                            variant="outline"
                            icon={busy === `ocr-${selectedDoc.id}` ? LoaderCircle : RefreshCcw}
                            disabled={Boolean(busy) || !canReidentifySelectedDoc}
                            title={selectedDocCommittedCount > 0 ? '该批次已有题目入库，暂不支持重新识别。' : '重新调用 OCR，并清空未入库候选题。'}
                            onClick={() => handleReidentifySource(selectedDoc)}
                            className="w-full sm:w-auto"
                          >
                            {busy === `ocr-${selectedDoc.id}` ? '识别中...' : '重新识别'}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* allCommitted = true */}
                    {selectedDoc.importStats?.allCommitted && (
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                          <CheckCircle2 className="size-4" />
                          <span>所有题目均已确认存入题库！</span>
                        </div>
                        <Button
                          size="default"
                          icon={Database}
                          disabled={!activeImportJob?.id}
                          onClick={() => {
                            if (!activeImportJob?.id) {
                              setError('当前资料尚未关联导入批次，请刷新页面完成迁移后再查看。')
                              return
                            }
                            navigate(importJobQuestionsPath(activeImportJob.id))
                          }}
                          className="w-full sm:w-auto"
                        >
                          在题库中查看
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </Panel>
            ) : (
              <Panel title="工作流操作">
                <div className="h-48 flex items-center justify-center text-xs text-zinc-400 bg-zinc-50/10 border border-dashed rounded-xl">
                  请在左侧资料列表中选择一份资料以开始，或上传新文件。
                </div>
              </Panel>
            )}

          </div>
        </div>
      )}

      {/* 第二步：题目核对区 */}
      {activeStepTab === 'review' && (
        questions.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl bg-zinc-50/10 min-h-[400px] animate-in fade-in duration-200">
            <Layers className="size-8 text-zinc-300 dark:text-zinc-700 mb-3" />
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-4">暂无待核对题目。请先在“1. 资料上传与识别”标签页中选择资料并生成/继续核对题目。</p>
            <Button size="sm" onClick={() => selectedDoc ? navigateToDocument(selectedDoc.id) : setActiveStepTab('upload')}>
              返回第一步
            </Button>
          </div>
        ) : null
      )}

      {/* ── 模块 4-8：题目核对区 (生成完题目后展示) ── */}
      {activeStepTab === 'review' && questions.length > 0 && showCheckArea && (
        <div ref={checkAreaRef} className="flex h-auto min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background lg:h-[calc(100vh-10rem)] lg:min-h-[32rem] lg:flex-row">
          <aside className="flex w-full shrink-0 flex-col bg-muted/20 lg:w-72 xl:w-80 2xl:w-[22rem] lg:border-r lg:border-border">
            <div className="shrink-0 border-b border-border bg-background">
              <nav aria-label="候选题状态筛选" className="flex h-10 items-end overflow-x-auto px-2">
                {reviewTabs.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setReviewTab(item.key)}
                    className={`relative flex h-10 shrink-0 items-center gap-1.5 px-2 text-[11px] transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 ${
                      activeTab === item.key
                        ? 'font-semibold text-foreground after:bg-primary'
                        : 'text-muted-foreground hover:text-foreground after:bg-transparent'
                    }`}
                  >
                    <span>{item.label}</span>
                    <span className="font-mono text-[10px] opacity-70">{item.count}</span>
                  </button>
                ))}
              </nav>
              <div className="flex min-h-10 items-center gap-2 border-t border-border/60 px-3">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="flex min-w-0 flex-1 items-center gap-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span className={`flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors ${
                    allSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background'
                  }`}>
                    {allSelected ? <Check className="size-2.5 stroke-[3]" /> : null}
                  </span>
                  <span className="truncate">{selectedIds.size ? `已选择 ${selectedIds.size} 题` : `${selectableList.length} 题可批量处理`}</span>
                </button>
                {parseDiagnosticCounts.length > 0 ? (
                  <select
                    aria-label="结构诊断筛选"
                    value={activeDiagnosticCode}
                    onChange={(event) => {
                      setActiveDiagnosticCode(event.target.value)
                      setSelectedIds(new Set())
                    }}
                    className="h-7 min-w-0 max-w-32 rounded-md border border-input bg-background px-1.5 text-[10px] text-muted-foreground outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">结构诊断</option>
                    {parseDiagnosticCounts.slice(0, 8).map((item) => (
                      <option key={item.code} value={item.code}>{parserDiagnosticLabel(item.code)} {item.count}</option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>

            <div ref={candidateListRef} data-testid="candidate-list-scroll" className="flex-1 overflow-y-auto overscroll-contain bg-background">
              {filteredQuestions.length === 0 ? (
                <div className="flex h-48 items-center justify-center px-6 text-center text-xs text-muted-foreground">此筛选条件下暂无题目</div>
              ) : (
                filteredQuestions.map((q) => {
                  const isCommitted = q.status === 'committed' || committedIds.has(q.id)
                  const isSelected = selectedIds.has(q.id)
                  const isActive = q.id === activeQuestionId
                  const preview = q.stemMarkdown.replace(/\$\$?[^$]+\$\$?/g, '[公式]').replace(/[#*_~`>|\\]/g, '').trim().slice(0, 50)
                  const reviewState = questionReviewState(q, isCommitted)

                  return (
                    <div
                      key={q.id}
                      ref={(node) => {
                        if (node) candidateItemRefs.current.set(q.id, node)
                        else candidateItemRefs.current.delete(q.id)
                      }}
                      className={`relative flex min-h-[4.5rem] items-start border-b border-border/70 transition-colors before:absolute before:inset-y-0 before:left-0 before:w-0.5 ${
                        isActive ? 'bg-accent/70 before:bg-primary' : 'bg-background hover:bg-muted/50 before:bg-transparent'
                      }`}
                    >
                      <button
                        type="button"
                        aria-label={`选择第 ${q.questionNo || '未编号'} 题`}
                        disabled={isCommitted}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSelectToggle(q.id)
                        }}
                        className={`ml-3 mt-4 flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors ${isCommitted ? 'cursor-not-allowed opacity-25' : ''} ${isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background hover:border-foreground/40'}`}
                      >
                        {isSelected ? <Check className="size-2.5 stroke-[3]" /> : null}
                      </button>
                      <button
                        type="button"
                        aria-label={`打开第 ${q.questionNo || '未编号'} 题`}
                        aria-current={isActive ? 'true' : undefined}
                        onClick={() => {
                          setActiveQuestionId(q.id)
                          const sourceDocId = q.rawItem?.sourceDocumentId || selectedDoc?.id || sourceDocumentIdFromPath
                          if (sourceDocId) navigateToCandidate(sourceDocId, q.id)
                        }}
                        className="min-w-0 flex-1 px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="text-xs font-semibold text-foreground">第 {q.questionNo || '？'} 题</span>
                          {q.questionType ? <span className="truncate text-[10px] text-muted-foreground">{q.questionType}</span> : null}
                          {q.hasFigures ? <ImageIcon className="size-3 shrink-0 text-muted-foreground" aria-label="包含题图" /> : null}
                          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px]">
                            <span className={`size-1.5 rounded-full ${reviewState.dotClass}`} />
                            <span className={reviewState.textClass}>{reviewState.label}</span>
                          </span>
                        </div>
                        {preview ? (
                          <p className="mt-1 line-clamp-2 text-[11px] leading-[1.55] text-muted-foreground">{preview}</p>
                        ) : (
                          <p className="mt-1 text-[11px] italic text-muted-foreground">题干识别为空</p>
                        )}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
            {selectedIds.size > 0 ? (
              <div className="flex shrink-0 items-center gap-2 border-t border-border bg-background p-2.5">
                <span className="min-w-0 flex-1 truncate pl-1 text-[11px] font-medium text-muted-foreground">已选 {selectedIds.size} 题</span>
                <Button size="xs" variant="outline" icon={SkipForward} disabled={Boolean(busy)} onClick={handleBulkSkip}>跳过</Button>
                <Button size="xs" icon={CheckCircle2} disabled={Boolean(busy)} onClick={handleBulkConfirm}>批量入库</Button>
              </div>
            ) : null}
          </aside>

          {/* 右侧：唯一的主要校对画布 */}
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
            {activeQuestion ? (
              <div className="flex flex-1 flex-col overflow-hidden">
                <header className="flex shrink-0 items-center gap-4 border-b border-border bg-background px-5 py-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
                    <h2 className="flex shrink-0 items-center gap-1 text-sm font-semibold text-foreground">
                      <span>第</span>
                        <input
                          type="text"
                          value={editingQuestionNo}
                          onChange={(e) => setEditingQuestionNo(e.target.value)}
                          onBlur={handleSaveQuestionNo}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleSaveQuestionNo()
                              e.currentTarget.blur()
                            }
                          }}
                          disabled={activeQuestionCommitted}
                          aria-label="题号"
                          className="h-7 w-11 rounded-md border border-input bg-background px-1 text-center text-xs font-semibold text-foreground outline-none transition-colors focus:ring-2 focus:ring-ring disabled:opacity-50"
                        />
                      <span>题</span>
                    </h2>
                    <span className="hidden h-4 w-px bg-border sm:block" />
                    <select
                      aria-label="题型"
                      className="h-7 min-w-24 shrink-0 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground outline-none transition-colors focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      value={activeQuestion.questionType || ''}
                      disabled={activeQuestionCommitted || savingQuestionType === activeQuestion.id}
                      onChange={(event) => handleSaveQuestionType(event.target.value)}
                    >
                      <option value="">自动判断题型</option>
                      <option value="单选题">单选题</option>
                      <option value="多选题">多选题</option>
                      <option value="填空题">填空题</option>
                      <option value="解答题">解答题</option>
                    </select>
                    {activeQuestionReviewState ? (
                      <span className={`hidden shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] xl:flex ${activeQuestionReviewState.textClass}`}>
                        <span className={`size-1.5 rounded-full ${activeQuestionReviewState.dotClass}`} />
                        {savingQuestionType === activeQuestion.id ? '保存中...' : activeQuestionReviewState.label}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      icon={PencilLine}
                      disabled={activeQuestionCommitted || Boolean(busy)}
                      onClick={() => startManualFix(activeQuestion.id, 'stem')}
                    >
                      编辑
                    </Button>
                    <Button
                      size="sm"
                      icon={activeQuestionCommitted || busy !== activeQuestion.id ? CheckCircle2 : LoaderCircle}
                      disabled={activeQuestionCommitted || busy === activeQuestion.id || !activeQuestion.stemMarkdown.trim()}
                      onClick={() => commitSingleQuestion(activeQuestion)}
                    >
                      {activeQuestionCommitted ? '已入库' : '确认入库'}
                    </Button>
                    <ReviewActionMenu
                      label={`第 ${activeQuestion.questionNo || '未编号'} 题更多操作`}
                      actions={[
                        {
                          label: '查看题干来源',
                          icon: FileText,
                          onSelect: () => openActiveQuestionMarkdownPreview('stem'),
                        },
                        {
                          label: '删除候选题',
                          hint: '同时清除关联的框选草稿',
                          icon: Trash2,
                          danger: true,
                          disabled: activeQuestionCommitted || Boolean(busy),
                          separatorBefore: true,
                          onSelect: () => handleDeleteCandidate(activeQuestion.id),
                        },
                      ]}
                    />
                  </div>
                </header>

                {/* 题目内容滚动的预览渲染面板 */}
                <div
                  data-testid="candidate-review-content"
                  tabIndex={0}
                  aria-label="当前题校对内容"
                  className="flex-1 overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <div className="mx-auto w-full max-w-5xl px-6 py-5 xl:px-9">
                  {/* 异常警示 Banner (如果检测到重复或格式问题) */}
                  {activeQuestion.similarQuestions && activeQuestion.similarQuestions.length > 0 && (
                    <div className="mb-5 flex items-start gap-2.5 border-l-2 border-amber-500 bg-amber-50/50 px-4 py-3 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <div className="space-y-1">
                        <p className="font-semibold">重复入库预警</p>
                        <p className="leading-relaxed">
                          AI 检测到该题与系统中已有题目内容高度相似（重合度 {Math.round((activeQuestion.similarQuestions[0].similarity || 0.9) * 100)}%）。请确认是否属于相同试题。
                        </p>
                        <p className="pt-1 text-[10px] opacity-80">
                          <strong>相似题来源：</strong> {activeQuestion.similarQuestions[0].sourceTitle || '外部题库'} (第 {activeQuestion.similarQuestions[0].questionNo} 题)
                        </p>
                      </div>
                    </div>
                  )}

                  {activeQuestion.issues && activeQuestion.issues.length > 0 && (
                    <div className="mb-5 flex items-start gap-2.5 border-l-2 border-red-500 bg-red-50/50 px-4 py-3 text-xs text-red-800 dark:bg-red-950/20 dark:text-red-300">
                      <BadgeAlert className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
                      <div className="space-y-1">
                        <p className="font-semibold">核对提示</p>
                        <ul className="list-disc pl-4 space-y-1">
                          {activeQuestion.issues.map((issue, idx) => (
                            <li key={idx} className="leading-relaxed">
                              {issueLabel(issue.code) ? <span className="font-semibold">【{issueLabel(issue.code)}】</span> : null}
                              {issue.message}
                              {['missing_answer', 'missing_analysis', 'missing_solution', 'solution_conflict', 'unmatched_solution'].includes(issue.code || '') ? (
                                <button
                                  type="button"
                                  onClick={() => openActiveQuestionMarkdownPreview(issue.code === 'missing_answer' ? 'answer' : 'analysis')}
                                  className="ml-2 inline-flex items-center gap-1 rounded border border-red-200/70 bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300"
                                >
                                  <HelpCircle className="size-3" />
                                  查看原因
                                </button>
                              ) : null}
                              {issue.code === 'unplaced_figure' && issue.relatedFigures?.length ? (
                                <div className="mt-2 rounded-md border border-red-200/70 bg-white/80 p-2.5 text-zinc-700 dark:border-red-900/40 dark:bg-zinc-950/60 dark:text-zinc-300">
                                  <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                                    <span className="font-semibold text-zinc-700 dark:text-zinc-300">待判断归属的原图</span>
                                    {issue.relatedFigures.map((figure) => (
                                      <span key={figure.id}>
                                        {figure.pageNo ? `第 ${figure.pageNo} 页` : '页码未知'}
                                        {figure.sourceBlockId || figure.blockId ? ` · 块 ${figure.sourceBlockId || figure.blockId}` : ''}
                                      </span>
                                    ))}
                                    <span>点击图片可放大查看</span>
                                  </div>
                                  <div className="space-y-3">
                                    {issue.relatedFigures.map((figure) => {
                                      const blockId = String(figure.sourceBlockId || figure.blockId || issue.relatedBlockIds?.[0] || '')
                                      const assignmentKey = `${activeQuestion.id}:${blockId}`
                                      const assignment = figureAssignments[assignmentKey] || { candidateId: activeQuestion.id, usage: 'stem' as const }
                                      const resolving = busy === `figure-${blockId}`
                                      return (
                                        <div className="grid gap-3 rounded-md border border-zinc-200 bg-zinc-50/40 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/30 md:grid-cols-[10rem_minmax(0,1fr)]" key={figure.id}>
                                          <FigureGallery figures={[{
                                            ...figure,
                                            pageNumber: figure.pageNo,
                                            bbox: undefined,
                                          }]} compact />
                                          <div className="flex min-w-0 flex-col justify-center gap-2">
                                            <label className="grid gap-1 text-[10px] font-medium text-zinc-500">
                                              归属题目
                                              <select
                                                className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                                                disabled={resolving}
                                                onChange={(event) => setFigureAssignments((current) => ({
                                                  ...current,
                                                  [assignmentKey]: { ...assignment, candidateId: event.target.value },
                                                }))}
                                                value={assignment.candidateId}
                                              >
                                                {questions.filter((question) => question.status !== 'committed' && !committedIds.has(question.id)).map((question) => (
                                                  <option key={question.id} value={question.id}>第 {question.questionNo || '未编号'} 题{question.id === activeQuestion.id ? '（当前）' : ''}</option>
                                                ))}
                                              </select>
                                            </label>
                                            <label className="grid gap-1 text-[10px] font-medium text-zinc-500">
                                              图片用途
                                              <select
                                                className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                                                disabled={resolving}
                                                onChange={(event) => setFigureAssignments((current) => ({
                                                  ...current,
                                                  [assignmentKey]: { ...assignment, usage: event.target.value === 'analysis' ? 'analysis' : 'stem' },
                                                }))}
                                                value={assignment.usage}
                                              >
                                                <option value="stem">题干图</option>
                                                <option value="analysis">解析图</option>
                                              </select>
                                            </label>
                                            <div className="flex flex-wrap gap-2 pt-1">
                                              <Button
                                                size="xs"
                                                disabled={!blockId || resolving}
                                                onClick={() => handleResolveUnplacedFigure(blockId, 'assign')}
                                              >
                                                {resolving ? '处理中…' : '确认归属'}
                                              </Button>
                                              <Button
                                                size="xs"
                                                variant="outline"
                                                disabled={!blockId || resolving}
                                                onClick={() => handleResolveUnplacedFigure(blockId, 'ignore')}
                                              >
                                                不作为题图
                                              </Button>
                                            </div>
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              ) : issue.code === 'unplaced_figure' ? (
                                <p className="mt-1 text-[10px] text-red-500 dark:text-red-400">未找到对应图片文件，可尝试重新识别后再核对。</p>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {visibleActiveParseDiagnostics.length > 0 && (
                    <div className="mb-5 flex items-start gap-2.5 border-l-2 border-amber-500 bg-amber-50/40 px-4 py-3 text-xs text-amber-800 dark:bg-amber-950/15 dark:text-amber-300">
                      <HelpCircle className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-semibold">结构诊断</p>
                        <ul className="list-disc pl-4 space-y-1">
                          {visibleActiveParseDiagnostics.slice(0, 6).map((diagnostic, idx) => (
                            <li key={`${diagnostic.code}:${idx}`} className="leading-relaxed">
                              <span className="font-semibold">【{parserDiagnosticLabel(diagnostic.code)}】</span>{diagnostic.message}
                              <button
                                type="button"
                                onClick={() => openActiveQuestionMarkdownPreview(diagnostic.code.includes('answer') ? 'answer' : 'analysis')}
                                className="ml-2 inline-flex items-center gap-1 rounded border border-amber-200/70 bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 hover:bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300"
                              >
                                <HelpCircle className="size-3" />
                                查看来源
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  <section className="pb-6">
                    <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                      <Layers className="size-3.5 text-muted-foreground" />
                      <span>题干内容</span>
                    </div>
                    <div className="mt-4 text-[15px] leading-8 text-foreground">
                      <QuestionMarkdownContent content={activeQuestion.stemMarkdown || '（空）'} figures={activeQuestion.figures} className="text-sm font-normal" />
                    </div>
                  </section>

                  {activeQuestion.figures.length ? (
                    <section className="border-t border-border py-6">
                      <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                        <ImageIcon className="size-3.5 text-muted-foreground" />
                        <span>题图管理</span>
                        <span className="font-normal text-muted-foreground">{activeQuestion.figures.length} 张</span>
                      </div>
                      <div className="mt-4 divide-y divide-border rounded-md border border-border">
                        {activeQuestion.figures.map((figure, index) => {
                          const draftKey = `${activeQuestion.id}:${figure.id}`
                          const currentUsage = figure.usage === 'analysis' ? 'analysis' : figure.usage === 'options' ? 'options' : 'stem'
                          const draft = figureMoveDrafts[draftKey] || {
                            candidateId: activeQuestion.id,
                            usage: currentUsage,
                            optionLabel: figure.optionLabel || 'A',
                          }
                          const moving = busy === `move-figure-${figure.id}`
                          const unchanged = draft.candidateId === activeQuestion.id
                            && draft.usage === currentUsage
                            && (draft.usage !== 'options' || draft.optionLabel === (figure.optionLabel || 'A'))
                          return (
                            <div className="grid gap-3 p-3 md:grid-cols-[7rem_minmax(0,1fr)_auto] md:items-center" key={figure.id || `${figure.path}-${index}`}>
                              <button
                                type="button"
                                className="flex h-20 w-28 items-center justify-center overflow-hidden rounded-md border border-border bg-white"
                                onClick={() => window.open(assetUrl(figure.path), '_blank', 'noopener,noreferrer')}
                                title="查看原图"
                              >
                                <img src={assetUrl(figure.path)} alt={`题图 ${index + 1}`} className="h-full w-full object-contain" />
                              </button>
                              <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(9rem,1fr)_minmax(8rem,0.8fr)_4.5rem]">
                                <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
                                  归属题目
                                  <select
                                    aria-label={`题图 ${index + 1} 归属题目`}
                                    className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                                    disabled={activeQuestionCommitted || Boolean(busy)}
                                    value={draft.candidateId}
                                    onChange={(event) => setFigureMoveDrafts((current) => ({
                                      ...current,
                                      [draftKey]: { ...draft, candidateId: event.target.value },
                                    }))}
                                  >
                                    {questions.filter((question) => ['ready', 'needs_review', 'needs_manual_fix', 'blocked'].includes(question.status) && !committedIds.has(question.id)).map((question) => (
                                      <option key={question.id} value={question.id}>第 {question.questionNo || '未编号'} 题{question.id === activeQuestion.id ? '（当前）' : ''}</option>
                                    ))}
                                  </select>
                                </label>
                                <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
                                  图片用途
                                  <select
                                    aria-label={`题图 ${index + 1} 图片用途`}
                                    className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                                    disabled={activeQuestionCommitted || Boolean(busy)}
                                    value={draft.usage}
                                    onChange={(event) => setFigureMoveDrafts((current) => ({
                                      ...current,
                                      [draftKey]: { ...draft, usage: event.target.value as 'stem' | 'analysis' | 'options' },
                                    }))}
                                  >
                                    <option value="stem">题干图</option>
                                    <option value="options">选项图</option>
                                    <option value="analysis">解析图</option>
                                  </select>
                                </label>
                                {draft.usage === 'options' ? (
                                  <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
                                    选项
                                    <select
                                      aria-label={`题图 ${index + 1} 对应选项`}
                                      className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                                      disabled={activeQuestionCommitted || Boolean(busy)}
                                      value={draft.optionLabel}
                                      onChange={(event) => setFigureMoveDrafts((current) => ({
                                        ...current,
                                        [draftKey]: { ...draft, optionLabel: event.target.value },
                                      }))}
                                    >
                                      {['A', 'B', 'C', 'D'].map((label) => <option key={label} value={label}>{label}</option>)}
                                    </select>
                                  </label>
                                ) : null}
                              </div>
                              <Button
                                size="xs"
                                variant="outline"
                                icon={moving ? LoaderCircle : ArrowRightLeft}
                                disabled={activeQuestionCommitted || Boolean(busy) || unchanged}
                                onClick={() => handleMoveCandidateFigure(figure)}
                              >
                                {moving ? '处理中…' : draft.candidateId === activeQuestion.id ? '应用' : '移动'}
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    </section>
                  ) : null}

                  <section className="border-t border-border py-6">
                    <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                      <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>自动识别答案</span>
                      <button
                        type="button"
                        onClick={() => openActiveQuestionMarkdownPreview('answer')}
                        aria-label="查看答案来源"
                        className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        title="查看答案来源"
                      >
                        <FileText className="size-3.5" />
                      </button>
                    </div>
                    <div className="mt-4 text-[15px] leading-8 text-foreground">
                      <MarkdownWithInlineFigures content={activeQuestion.answerText || '（无）'} figures={activeQuestion.figures} className="text-sm font-normal" />
                    </div>
                  </section>

                  <section className="border-t border-border py-6">
                    <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                      <Compass className="size-3.5 text-muted-foreground" />
                      <span>自动解析步骤</span>
                      <button
                        type="button"
                        onClick={() => openActiveQuestionMarkdownPreview('analysis')}
                        aria-label="查看解析来源"
                        className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        title="查看解析来源"
                      >
                        <FileText className="size-3.5" />
                      </button>
                    </div>
                    <div className="mt-4 text-[15px] leading-8 text-foreground">
                      <MarkdownWithInlineFigures content={activeQuestion.analysisMarkdown || '（无）'} figures={activeQuestion.figures} className="text-sm font-normal" />
                    </div>
                  </section>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
                请从左侧选择题目
              </div>
            )}
          </main>
        </div>
      )}

      {showMetadataEditor ? (
        <ImportMetadataEditorDialog
          draft={metadataDraft}
          setDraft={setMetadataDraft}
          teachingStages={ocrSettings.data?.teachingStages}
          saving={busy === `metadata-${activeImportJob?.id}`}
          onClose={() => setShowMetadataEditor(false)}
          onSave={handleSaveSourceMetadata}
        />
      ) : null}

      <MarkdownStructurePreviewDialog
        key={markdownPreviewTarget ? `${markdownPreviewTarget.ocrDocumentId}:${markdownPreviewTarget.candidateId || ''}:${markdownPreviewTarget.focusKind || ''}` : 'closed'}
        open={Boolean(markdownPreviewTarget)}
        ocrDocumentId={markdownPreviewTarget?.ocrDocumentId}
        documentOptions={markdownPreviewTarget?.documentOptions}
        candidateId={markdownPreviewTarget?.candidateId}
        candidateIds={markdownPreviewTarget?.candidateIds}
        questionNo={markdownPreviewTarget?.questionNo}
        focusKind={markdownPreviewTarget?.focusKind}
        title={markdownPreviewTarget?.title}
        applying={busy === `reclean-${selectedDoc?.id || ''}`}
        onApplyConfig={selectedDoc && canRecleanSelectedDoc ? handleApplyPreviewParserConfig : undefined}
        onClose={() => setMarkdownPreviewTarget(null)}
      />

    </div>
  )
}

import { useEffect, useMemo, useState, useRef } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { importV2Api, type ImportParserPreset, type ImportV2ImportJob, type ImportV2ImportJobDocumentDetail, type ImportV2OcrDocument, type ImportV2SourceDocument, type OcrFigureDiagnostics, type ParseCandidatesRequest, type ParseCandidatesResult } from '@/api/importV2'
import { settingsApi } from '@/api/settings'
import { unsupportedImportReason } from '@/utils/importFiles'
import { type MarkdownPreviewDocumentOption } from '@/components/import-v2/MarkdownStructurePreviewDialog'
import type { WatermarkCleanupDraft } from '@/components/import-v2/WatermarkCleanupDialog'
import { useAsync } from '@/hooks/useAsync'
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling'
import {
  fromCandidate,
  importJobDocumentRoleLabel,
  metadataDraftFromDoc,
  metadataPayload,
  normalizeSourceOcrProvider,
  reviewTabFromQuery,
  sourceOcrProviderLabel,
  type SourceMetadataDraft,
  type UnifiedQuestion,
  type UploadDocumentMode,
} from './importV2PageModel'
import { buildCandidateReviewModel } from './candidateReviewModel'
import { candidateDetailPath, candidateReviewPath, importJobDocumentPath, legacySourceDocumentPath } from './importV2Routes'
import { fetchCandidates, fetchImportJob, fetchOcrDocuments, fetchParserPresets, fetchSourceDocuments, invalidateImportV2Queries } from './importV2Queries'

export function useImportV2Workspace(view: 'document' | 'candidate') {
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

  const [activeStepTab, setActiveStepTab] = useState<'upload' | 'review'>('upload')
  const [selectedSourceDocId, setSelectedSourceDocId] = useState<string | null>(null)
  const [showCheckArea, setShowCheckArea] = useState(false)
  const [editingQuestionNo, setEditingQuestionNo] = useState('')
  const [savingQuestionType, setSavingQuestionType] = useState('')
  const [metadataDraft, setMetadataDraft] = useState<SourceMetadataDraft>(() => metadataDraftFromDoc())
  const [showMetadataEditor, setShowMetadataEditor] = useState(false)
  const [watermarkCleanupDraft, setWatermarkCleanupDraft] = useState<WatermarkCleanupDraft>({ enabled: false, terms: '' })
  const [showWatermarkCleanupEditor, setShowWatermarkCleanupEditor] = useState(false)
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

  // --- Derived state ---
  const selectedOcr = useMemo(() => ocrDocuments.find((item) => item.id === selectedOcrId) || null, [ocrDocuments, selectedOcrId])

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

  // --- Effects ---
  useEffect(() => {
    if (selectedDoc) {
      setMetadataDraft(metadataDraftFromDoc(selectedDoc))
    }
  }, [selectedDoc?.id, selectedDoc?.updatedAt])

  function getDocStatus(item: ImportV2SourceDocument) {
    if (item.status === 'ocr_running') return { label: '识别中', variant: 'warning' as const }
    if (item.status === 'ocr_failed') return { label: '识别失败', variant: 'danger' as const }
    if (item.importStats?.allCommitted) return { label: '导入完成', variant: 'success' as const }
    if (item.status === 'uploaded') return { label: '等待识别', variant: 'outline' as const }
    if (item.status === 'ocr_succeeded') return { label: '已识别', variant: 'default' as const }
    if (item.status === 'parsed' || item.status === 'partially_parsed') {
      const committed = item.importStats?.committedCount || 0
      if (committed > 0) return { label: '部分入库', variant: 'warning' as const }
      return { label: '待核对', variant: 'default' as const }
    }
    return { label: '等待识别', variant: 'outline' as const }
  }

  const steps = useMemo(() => {
    if (!selectedDoc) return []
    let step1: 'todo' | 'current' | 'done' = 'done'
    let step2: 'todo' | 'current' | 'done' = 'todo'
    let step3: 'todo' | 'current' | 'done' = 'todo'
    const isAllCommitted = selectedDoc.importStats?.allCommitted || false
    const status = selectedDoc.status
    if (status === 'uploaded' || status === 'ocr_failed') { step1 = 'done'; step2 = 'todo'; step3 = 'todo' }
    else if (status === 'ocr_running') { step1 = 'done'; step2 = 'current'; step3 = 'todo' }
    else if (status === 'ocr_succeeded') { step1 = 'done'; step2 = 'done'; step3 = 'todo' }
    else if (status === 'parsed' || status === 'partially_parsed') {
      step1 = 'done'; step2 = 'done'
      step3 = isAllCommitted ? 'done' : 'current'
    }
    return [
      { title: '上传资料', state: step1 },
      { title: '自动识别', state: step2 },
      { title: '核对入库', state: step3 },
    ]
  }, [selectedDoc])

  // --- Navigation helpers ---
  function jobDocumentUrl(importJobId: string, sourceDocumentId: string) {
    return importJobDocumentPath(importJobId, sourceDocumentId)
  }

  function currentImportJobIdForSourceDocument(sourceDocumentId: string) {
    const jobDocument = activeImportJobDocuments.find((item) => item.sourceDocumentId === sourceDocumentId)
    return jobDocument?.jobId || ''
  }

  function documentUrl(sourceDocumentId: string) {
    const importJobId = currentImportJobIdForSourceDocument(sourceDocumentId)
    return importJobId ? jobDocumentUrl(importJobId, sourceDocumentId) : legacySourceDocumentPath(sourceDocumentId)
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

  // Reset review area on doc switch
  useEffect(() => {
    setQuestions([])
    setShowCheckArea(false)
    setDiagnostics(null)
  }, [selectedDoc?.id])

  useEffect(() => {
    if (showCheckArea) {
      setTimeout(() => { checkAreaRef.current?.scrollIntoView({ behavior: 'smooth' }) }, 100)
    }
  }, [showCheckArea])

  // --- Data loading ---
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
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : String(err)) })
    return () => { active = false }
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
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : String(err)) })
    return () => { active = false }
  }, [currentImportJobId])

  // Route: redirect bare job URL to primary document
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

  // Route: resolve import job for source doc not in current job
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
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : String(err)) })
    return () => { active = false }
  }, [activeImportJobDocuments, candidateIdFromPath, currentImportJobId, isCandidatesRoute, navigate, searchParams, sourceDocumentIdFromPath])

  // Legacy redirect: /tools/import?sourceDocumentId=xxx
  useEffect(() => {
    if (sourceDocumentIdFromQuery && !sourceDocumentIdFromPath) {
      navigateToDocument(sourceDocumentIdFromQuery, { replace: true })
    }
  }, [sourceDocumentIdFromPath, sourceDocumentIdFromQuery])

  // Legacy redirect: /tools/import/documents/:sourceDocumentId
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
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : String(err)) })
    return () => { active = false }
  }, [currentImportJobId, navigate, sourceDocumentIdFromPath, sourceDocumentIdFromQuery])

  useEffect(() => {
    setActiveTab(reviewTabFromQuery(searchParams.get('tab')))
  }, [searchParams])

  // Restore selected doc & candidates from path
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
    if (!isCandidatesRoute) { lastRouteSyncKeyRef.current = ''; return }
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

  // --- OCR polling ---
  useVisibilityAwarePolling(async (signal) => {
    const runningIds = runningSourceDocumentKey.split('|').filter(Boolean)
    const settled = await Promise.all(runningIds.map(async (id) => {
      try { return { id, result: await importV2Api.getSourceDocumentOcrStatus(id) } }
      catch (err) { return { id, error: err } }
    }))
    if (signal.aborted) return

    const errors = settled.filter((item): item is { id: string; error: unknown } => 'error' in item)
    if (errors.length) setError(errors[0].error instanceof Error ? errors[0].error.message : String(errors[0].error))

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
      const nextErrors = Object.fromEntries(failed.map((result) => [result.sourceDocument.id, result.task.error || 'OCR 识别失败。']))
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
      } catch { /* non-critical */ }
    }
    const succeeded = finished.filter((result) => result.task.status === 'ocr_succeeded')
    const selectedFinished = selectedDoc?.id ? finished.some((result) => result.sourceDocument.id === selectedDoc.id) : false
    const firstSelectedOcr = results.find((result) => result.sourceDocument.id === selectedDoc?.id)?.ocrDocument
    if (firstSelectedOcr) setSelectedOcrId(firstSelectedOcr.id)
    if (succeeded.length && selectedFinished) {
      showNotice(succeeded.length > 1 ? `${succeeded.length} 份资料识别完成。` : '识别完成。请在右侧点击"生成待确认题目"继续。')
    }
  }, {
    enabled: Boolean(runningSourceDocumentKey),
    intervalMs: 3_000,
    immediate: true,
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  })

  // --- Feedback helpers ---
  function showNotice(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3000)
  }

  // --- Upload handlers ---
  function baseNameFromFile(file: File | null) {
    return file?.name.replace(/\.[^.]+$/i, '') || ''
  }

  function uploadMetadataForFile(file: File, roleLabel = '') {
    const metadata = metadataPayload(metadataDraft)
    const titleBase = metadata.paperTitle || baseNameFromFile(file)
    return { ...metadata, title: roleLabel ? `${titleBase}（${roleLabel}）` : titleBase }
  }

  function handleUploadFileSelection(files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    const unsupportedReason = unsupportedImportReason(file.name, { allowJson: true })
    if (unsupportedReason) {
      setPendingUploadFile(null)
      setError(unsupportedReason)
      setNotice('')
      return
    }
    setPendingUploadFile(file)
    setError(''); setNotice(''); setQuestions([]); setActiveQuestionId(null); setSelectedIds(new Set())
    const titleFromFile = file.name.replace(/\.[^.]+$/i, '')
    setMetadataDraft((draft) => ({ ...draft, paperTitle: draft.paperTitle.trim() ? draft.paperTitle : titleFromFile }))
    showNotice('文件已选择，请填写资料信息后点击"开始上传"。')
  }

  function handleSeparatedFileSelection(role: 'questions' | 'solutions', files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    const unsupportedReason = unsupportedImportReason(file.name)
    if (unsupportedReason) {
      if (role === 'questions') setQuestionUploadFile(null)
      else setSolutionUploadFile(null)
      setError(unsupportedReason)
      return
    }
    if (role === 'questions') setQuestionUploadFile(file)
    else setSolutionUploadFile(file)
    setError(''); setNotice(''); setQuestions([]); setActiveQuestionId(null); setSelectedIds(new Set())
    const titleFromFile = file.name.replace(/\.[^.]+$/i, '')
    setMetadataDraft((draft) => ({ ...draft, paperTitle: draft.paperTitle.trim() ? draft.paperTitle : titleFromFile }))
  }

  async function handleStartUpload() {
    const file = pendingUploadFile
    if (!file) { setError('请先选择要上传的资料文件。'); return }
    if (file.name.toLowerCase().endsWith('.json')) { await handleJsonFile(file); setPendingUploadFile(null); return }

    setUploading(true); setError(''); setNotice(''); setQuestions([]); setActiveQuestionId(null); setSelectedIds(new Set())
    try {
      const res = await importV2Api.uploadSourceDocument(file, metadataPayload(metadataDraft))
      const metadata = metadataPayload(metadataDraft)
      const jobRes = await importV2Api.createImportJob({
        title: metadata.paperTitle || res.sourceDocument.title || baseNameFromFile(file),
        mode: 'single_document',
        ...metadata,
      })
      await importV2Api.addSourceDocumentToImportJob(jobRes.importJob.id, { sourceDocumentId: res.sourceDocument.id, role: 'full', sortOrder: 0 })
      const hydratedJob = await importV2Api.getImportJob(jobRes.importJob.id)
      await loadLists()
      setSelectedSourceDocId(res.sourceDocument.id)
      setPendingUploadFile(null)
      setActiveImportJob(hydratedJob.importJob)
      setActiveImportJobDocuments(hydratedJob.documents || [])
      navigate(jobDocumentUrl(hydratedJob.importJob.id, res.sourceDocument.id))
      showNotice(`资料已保存，可启动 ${currentOcrProviderLabel} 识别。`)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  async function handleStartSeparatedUpload() {
    if (!questionUploadFile || !solutionUploadFile) { setError('请分别选择原卷文件和答案解析文件。'); return }
    setUploading(true); setError(''); setNotice(''); setQuestions([]); setActiveQuestionId(null); setSelectedIds(new Set())
    try {
      const metadata = metadataPayload(metadataDraft)
      const [questionRes, solutionRes] = await Promise.all([
        importV2Api.uploadSourceDocument(questionUploadFile, uploadMetadataForFile(questionUploadFile, '原卷')),
        importV2Api.uploadSourceDocument(solutionUploadFile, uploadMetadataForFile(solutionUploadFile, '答案解析')),
      ])
      const jobTitle = metadata.paperTitle || `${baseNameFromFile(questionUploadFile)} + ${baseNameFromFile(solutionUploadFile)}`
      const jobRes = await importV2Api.createImportJob({ title: jobTitle, mode: 'separated_documents', ...metadata })
      await Promise.all([
        importV2Api.addSourceDocumentToImportJob(jobRes.importJob.id, { sourceDocumentId: questionRes.sourceDocument.id, role: 'questions', sortOrder: 0 }),
        importV2Api.addSourceDocumentToImportJob(jobRes.importJob.id, { sourceDocumentId: solutionRes.sourceDocument.id, role: 'solutions', sortOrder: 1 }),
      ])
      const hydratedJob = await importV2Api.getImportJob(jobRes.importJob.id)
      await loadLists()
      setSelectedSourceDocId(questionRes.sourceDocument.id)
      setActiveImportJob(hydratedJob.importJob)
      setActiveImportJobDocuments(hydratedJob.documents || [])
      setQuestionUploadFile(null); setSolutionUploadFile(null)
      navigate(jobDocumentUrl(jobRes.importJob.id, questionRes.sourceDocument.id))
      showNotice('双文档导入任务已创建。请分别完成原卷和答案解析的 OCR 识别。')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally {
      setUploading(false)
      if (questionFileInputRef.current) questionFileInputRef.current.value = ''
      if (solutionFileInputRef.current) solutionFileInputRef.current.value = ''
    }
  }

  // --- OCR handlers ---
  async function startSourceOcr(sourceDocumentId: string, options: { force?: boolean } = {}) {
    setBusy(`ocr-${sourceDocumentId}`); setError('')
    setSourceOcrErrors((current) => { const next = { ...current }; delete next[sourceDocumentId]; return next })
    try {
      const result = await importV2Api.startSourceDocumentOcr(sourceDocumentId, options)
      await loadLists()
      setRunningSourceDocumentId(sourceDocumentId)
      showNotice(`${sourceOcrProviderLabel(normalizeSourceOcrProvider(result.task.provider))} 已启动，正在识别资料。`)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy('') }
  }

  async function handleReidentifySource(item: ImportV2SourceDocument) {
    if ((item.importStats?.committedCount || 0) > 0) {
      setError('该批次已有题目入库。为避免候选记录与题库记录不一致，暂不支持重新识别。')
      return
    }
    const ok = window.confirm('重新识别会重新调用 OCR，并清空本批次现有未入库候选题和手动修正草稿。确定继续吗？')
    if (!ok) return
    setQuestions([]); setDiagnostics(null); setSelectedIds(new Set()); setActiveQuestionId(null)
    setShowCheckArea(false); setActiveStepTab('upload')
    navigateToDocument(item.id)
    await startSourceOcr(item.id, { force: true })
  }

  // --- Candidate generation ---
  async function handleGenerateCandidates(item: ImportV2SourceDocument) {
    setBusy(`action-${item.id}`); setError('')
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
        if (!ocrDoc) throw new Error('未找到该资料对应的 OCR 结果文件。')
        setSelectedOcrId(ocrDoc.id)
        result = await importV2Api.parseCandidates(ocrDoc.id, parserPayload)
      }
      const unified = (result.items || []).map(fromCandidate)
      if ('importJob' in result && result.importJob) setActiveImportJob(result.importJob)
      setQuestions(unified)
      setDiagnostics(result.diagnostics || null)
      setCommittedIds(new Set(unified.filter((q) => q.status === 'committed').map((q) => q.id)))
      setSelectedIds(new Set())
      if (unified.length > 0) setActiveQuestionId(unified[0].id)
      await loadLists()
      setShowCheckArea(true); setActiveStepTab('review')
      const targetSourceDocumentId = shouldParseImportJob ? activeImportJobQuestionDocument?.sourceDocumentId || item.id : item.id
      navigateToCandidates(targetSourceDocumentId)
      showNotice(shouldParseImportJob ? '已合并原卷与答案解析，生成待核对题目' : '已自动提取并生成待核对题目')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy('') }
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
    setBusy(`reclean-${item.id}`); setError('')
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
        if (!ocrDoc) throw new Error('未找到该资料对应的 OCR 结果文件。')
        setSelectedOcrId(ocrDoc.id)
        result = await importV2Api.parseCandidates(ocrDoc.id, payload)
      }
      const unified = (result.items || []).map(fromCandidate)
      if ('importJob' in result && result.importJob) setActiveImportJob(result.importJob)
      setQuestions(unified)
      setDiagnostics(result.diagnostics || null)
      setCommittedIds(new Set(unified.filter((q) => q.status === 'committed').map((q) => q.id)))
      setSelectedIds(new Set())
      setActiveQuestionId(unified[0]?.id || null)
      await loadLists()
      setShowCheckArea(true); setActiveStepTab('review')
      navigateToCandidates(shouldParseImportJob ? activeImportJobQuestionDocument?.sourceDocumentId || item.id : item.id)
      showNotice(options.label || '已使用当前导入规则重新生成待核对题目')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy('') }
  }

  async function handleContinueCheck(item: ImportV2SourceDocument) {
    if ((item.importStats?.candidateCount || 0) > 0) navigateToCandidates(item.id)
    else navigateToDocument(item.id)
  }

  async function loadCandidatesForSourceDocument(
    item: ImportV2SourceDocument,
    options: { activeCandidateId?: string; showLoadedNotice?: boolean } = {},
  ) {
    setBusy(`action-${item.id}`); setError('')
    try {
      const ocrRes = await importV2Api.listOcrDocuments(item.id)
      const ocrDoc = ocrRes.items[0]
      if (ocrDoc) setSelectedOcrId(ocrDoc.id)
      const result = await fetchCandidates(item.id, { force: Boolean(options.showLoadedNotice) })
      const unified = (result.items || []).map(fromCandidate)
      if (isCandidatesRoute && unified.length === 0) {
        setShowCheckArea(false); setActiveStepTab('upload')
        navigateToDocument(item.id, { replace: true })
        return
      }
      setQuestions(unified)
      setDiagnostics(result.diagnostics || null)
      setCommittedIds(new Set(unified.filter((q) => q.status === 'committed').map((q) => q.id)))
      setSelectedIds(new Set())
      if (options.activeCandidateId && unified.some((q) => q.id === options.activeCandidateId)) {
        setActiveQuestionId(options.activeCandidateId)
      } else if (unified.length > 0) {
        setActiveQuestionId(unified[0].id)
        if (options.activeCandidateId) navigateToCandidates(item.id, { replace: true })
      } else {
        setActiveQuestionId(null)
      }
      await loadLists()
      setShowCheckArea(true); setActiveStepTab('review')
      if (options.showLoadedNotice !== false) showNotice('已加载当前识别记录的待确认题目')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy('') }
  }

  // --- Source document management ---
  async function handleDeleteSourceDoc(id: string) {
    if (!window.confirm('确定要删除该资料吗？此操作将同步清除与之关联的 OCR 记录、待核对题目及本地裁图缓存，且不可恢复。')) return
    setBusy(`delete-${id}`); setError('')
    try {
      await importV2Api.deleteSourceDocument(id)
      showNotice('资料已成功删除。')
      if (selectedSourceDocId === id) { setSelectedSourceDocId(null); setQuestions([]); setShowCheckArea(false) }
      if (sourceDocumentIdFromPath === id) navigate('/tools/import', { replace: true })
      await loadLists()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy('') }
  }

  // --- Metadata / Import Job ---
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

  function openWatermarkCleanupModal() {
    if (!selectedDoc) return
    const watermark = selectedDoc.metadata && typeof selectedDoc.metadata.watermark === 'object' && !Array.isArray(selectedDoc.metadata.watermark)
      ? selectedDoc.metadata.watermark as { enabled?: unknown; terms?: unknown }
      : {}
    const terms = Array.isArray(watermark.terms)
      ? watermark.terms.map((item) => String(item || '')).filter(Boolean).join('\n')
      : typeof watermark.terms === 'string' ? watermark.terms : ''
    setWatermarkCleanupDraft({ enabled: Boolean(watermark.enabled), terms })
    setShowWatermarkCleanupEditor(true)
  }

  async function handleSaveWatermarkCleanup() {
    if (!activeImportJob || !selectedDoc) return
    const terms = watermarkCleanupDraft.terms.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    if (watermarkCleanupDraft.enabled && !terms.length) {
      setError('启用水印清洗时，请至少填写一个排除词。')
      return
    }
    const targetIds = activeImportJobDocuments.length
      ? activeImportJobDocuments.map((document) => document.sourceDocumentId)
      : [selectedDoc.id]
    const targets = targetIds.map((id) => sourceDocuments.find((document) => document.id === id)).filter(Boolean) as ImportV2SourceDocument[]
    if (!targets.length) {
      setError('未找到本批次关联的资料，无法保存水印清洗设置。')
      return
    }

    setBusy(`watermark-${activeImportJob.id}`); setError('')
    try {
      await Promise.all(targets.map((document) => importV2Api.updateSourceDocument(document.id, {
        metadata: {
          ...document.metadata,
          watermark: { enabled: watermarkCleanupDraft.enabled, terms },
        },
      })))
      setShowWatermarkCleanupEditor(false)
      await loadLists()
      if (canRecleanSelectedDoc) {
        await handleRecleanCandidates(selectedDoc, {}, {
          skipConfirm: true,
          label: '水印清洗设置已保存，并已重新生成候选题',
        })
      } else {
        showNotice('水印清洗设置已保存。已有入库题目未重新处理。')
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy('') }
  }

  async function handleSaveSourceMetadata() {
    if (!activeImportJob) return
    setBusy(`metadata-${activeImportJob.id}`); setError('')
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
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy('') }
  }

  // --- JSON import ---
  async function handleJsonFile(file: File) {
    setBusy('import'); setError('')
    try {
      const text = await file.text()
      const payload = JSON.parse(text)
      const result = await importV2Api.importOcrDocumentJson({
        ocrDocument: payload.ocrDocument || payload,
        sourceDocument: { title: file.name.replace(/\.json$/i, ''), originalFileName: file.name },
      })
      await loadLists()
      setSelectedOcrId(result.ocrDocument.id)
      setQuestions([]); setDiagnostics(null)
      showNotice('本地模拟 OCRDocument JSON 导入完成，请点击下方生成题目。')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(''); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  async function parseSelectedOcr() {
    if (!selectedOcrId) return
    setBusy('parse'); setError('')
    try {
      const result = await importV2Api.parseCandidates(selectedOcrId, selectedParserPresetId ? { presetId: selectedParserPresetId } : {})
      const unified = (result.items || []).map(fromCandidate)
      setQuestions(unified)
      setDiagnostics(result.diagnostics || null)
      setCommittedIds(new Set(unified.filter((item) => item.status === 'committed').map((item) => item.id)))
      setSelectedIds(new Set())
      if (unified.length > 0) setActiveQuestionId(unified[0].id)
      await loadLists()
      setShowCheckArea(true); setActiveStepTab('review')
      if (selectedOcr?.sourceDocumentId) navigateToCandidates(selectedOcr.sourceDocumentId)
      showNotice('已自动提取并生成待核对题目')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy('') }
  }

  async function loadCandidatesForSelected() {
    if (!selectedOcr) return
    setBusy('load-candidates'); setError('')
    try {
      const result = await fetchCandidates(selectedOcr.sourceDocumentId)
      const unified = (result.items || []).map(fromCandidate)
      setQuestions(unified)
      setDiagnostics(result.diagnostics || null)
      setCommittedIds(new Set(unified.filter((item) => item.status === 'committed').map((item) => item.id)))
      setSelectedIds(new Set())
      if (unified.length > 0) setActiveQuestionId(unified[0].id)
      setShowCheckArea(true); setActiveStepTab('review')
      navigateToCandidates(selectedOcr.sourceDocumentId)
      showNotice('已加载当前识别记录的历史题目')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy('') }
  }

  // --- Candidate commit / skip / delete ---
  async function commitSingleQuestion(q: UnifiedQuestion) {
    setBusy(q.id); setError('')
    try {
      const result = await importV2Api.commitCandidate(q.id)
      const committed = fromCandidate(result.candidate)
      setQuestions((items) => items.map((item) => item.id === q.id ? committed : item))
      setCommittedIds((prev) => new Set([...prev, q.id]))
      showNotice('该题目已成功确认入库')
      await loadLists()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy('') }
  }

  async function startManualFix(candidateId: string, mode: 'stem' | 'analysis' | 'figure') {
    try {
      setBusy(candidateId)
      await importV2Api.createManualFixSession(candidateId)
      const sourceDocId = activeQuestion?.rawItem?.sourceDocumentId || selectedDoc?.id || selectedOcr?.sourceDocumentId || sourceDocumentIdFromPath || ''
      navigate(`${documentUrl(sourceDocId)}/candidates/${encodeURIComponent(candidateId)}/manual-fix?mode=${mode}`)
    } catch (err) {
      window.alert('初始化手动修正失败：' + (err instanceof Error ? err.message : String(err)))
    } finally { setBusy('') }
  }

  async function handleSaveQuestionNo() {
    if (!activeQuestion) return
    const trimmed = editingQuestionNo.trim()
    if (trimmed === activeQuestion.questionNo) return
    try {
      const res = await importV2Api.updateCandidate(activeQuestion.id, { questionNo: trimmed })
      setQuestions((prev) => prev.map((q) => q.id === activeQuestion.id ? fromCandidate(res.candidate) : q))
      showNotice('题号已成功更新')
      await loadLists()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  async function handleSaveQuestionType(nextType: string) {
    if (!activeQuestion) return
    if (nextType === activeQuestion.questionType) return
    setSavingQuestionType(activeQuestion.id); setError('')
    try {
      const res = await importV2Api.updateCandidate(activeQuestion.id, { questionType: nextType })
      setQuestions((prev) => prev.map((q) => q.id === activeQuestion.id ? fromCandidate(res.candidate) : q))
      showNotice('题型已更新')
      await loadLists()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setSavingQuestionType('') }
  }

  // --- Figure management ---
  async function handleResolveUnplacedFigure(blockId: string, action: 'assign' | 'ignore') {
    if (!activeQuestion) return
    const assignmentKey = `${activeQuestion.id}:${blockId}`
    const assignment = figureAssignments[assignmentKey] || { candidateId: activeQuestion.id, usage: 'stem' as const }
    setBusy(`figure-${blockId}`); setError('')
    try {
      await importV2Api.resolveUnplacedFigure(activeQuestion.id, blockId, {
        action, targetCandidateId: assignment.candidateId, usage: assignment.usage,
      })
      const sourceDocumentId = String(activeQuestion.rawItem?.sourceDocumentId || selectedDoc?.id || sourceDocumentIdFromPath || '')
      if (sourceDocumentId) {
        invalidateImportV2Queries()
        const result = await fetchCandidates(sourceDocumentId, { force: true })
        setQuestions((result.items || []).map(fromCandidate))
        setDiagnostics(result.diagnostics || null)
      }
      setFigureAssignments((current) => { const next = { ...current }; delete next[assignmentKey]; return next })
      showNotice(action === 'ignore' ? '已忽略该图片，核对提示已解除。' : '图片归属已保存。')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy('') }
  }

  async function handleMoveCandidateFigure(figure: UnifiedQuestion['figures'][number]) {
    if (!activeQuestion) return
    const draftKey = `${activeQuestion.id}:${figure.id}`
    const currentUsage = figure.usage === 'analysis' ? 'analysis' : figure.usage === 'options' ? 'options' : 'stem'
    const draft = figureMoveDrafts[draftKey] || { candidateId: activeQuestion.id, usage: currentUsage, optionLabel: figure.optionLabel || 'A' }
    const target = questions.find((question) => question.id === draft.candidateId)
    if (!target) return
    setBusy(`move-figure-${figure.id}`); setError('')
    try {
      await importV2Api.moveCandidateFigure(activeQuestion.id, figure.id, {
        targetCandidateId: target.id, usage: draft.usage,
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
      setFigureMoveDrafts((current) => { const next = { ...current }; delete next[draftKey]; return next })
      showNotice(target.id === activeQuestion.id ? '图片用途已更新。' : `图片已移动到第 ${target.questionNo || '未编号'} 题。`)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy('') }
  }

  async function handleDeleteCandidateFigure(figure: UnifiedQuestion['figures'][number]) {
    if (!activeQuestion || activeQuestionCommitted) return
    if (!window.confirm(`确定删除题图 ${figure.id || ''} 吗？正文中的对应图片占位符也会一并移除。`)) return
    const identifiers = [figure.id, figure.blockId, figure.sourceBlockId].filter(Boolean).map(String)
    const removeMarkers = (value: string) => {
      let next = String(value || '')
      for (const identifier of identifiers) {
        const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        next = next.replace(new RegExp(`\\n?\\s*<!--\\s*DOC2X_FIGURE:${escaped}\\s*-->\\s*\\n?`, 'g'), '\n')
      }
      return next.replace(/\n{3,}/g, '\n\n').trim()
    }
    const nextFigures = activeQuestion.figures.filter((item) => item !== figure && item.id !== figure.id)
    setBusy(`delete-figure-${figure.id}`); setError('')
    try {
      await importV2Api.updateCandidate(activeQuestion.id, {
        figures: nextFigures,
        stemMarkdown: removeMarkers(activeQuestion.stemMarkdown),
        answerText: removeMarkers(activeQuestion.answerText),
        analysisMarkdown: removeMarkers(activeQuestion.analysisMarkdown),
      }, activeQuestion.rawItem?.contentRevision)
      const sourceDocumentId = String(activeQuestion.rawItem?.sourceDocumentId || selectedDoc?.id || sourceDocumentIdFromPath || '')
      if (sourceDocumentId) {
        invalidateImportV2Queries()
        const result = await fetchCandidates(sourceDocumentId, { force: true })
        setQuestions((result.items || []).map(fromCandidate))
        setDiagnostics(result.diagnostics || null)
      }
      setFigureMoveDrafts((current) => { const next = { ...current }; delete next[`${activeQuestion.id}:${figure.id}`]; return next })
      showNotice('题图已删除。')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy('') }
  }

  async function handleDeleteCandidate(candidateId: string) {
    if (!window.confirm('确定要删除这道待确认的题目吗？此操作将同步清除与之关联的标注框选等草稿数据，且不可恢复。')) return
    setBusy(candidateId); setError('')
    try {
      await importV2Api.deleteQuestionCandidate(candidateId)
      showNotice('题目已成功删除。')
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
      setQuestions((prev) => prev.filter((q) => q.id !== candidateId))
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(candidateId); return next })
      await loadLists()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy('') }
  }

  // --- Markdown preview ---
  function markdownPreviewDocumentOption(
    role: string,
    ocrDocumentId: string,
    source?: ImportV2SourceDocument | null,
  ): MarkdownPreviewDocumentOption {
    return {
      role: role as any,
      ocrDocumentId,
      label: importJobDocumentRoleLabel(role as any) || '识别稿',
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
        for (const item of items) { if (!next.some((existing) => existing.id === item.id)) next.push(item) }
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
      const preferredOcrDocumentId = selectedImportJobDocument?.role === 'solutions' ? solutionOcr?.id
        : selectedImportJobDocument?.role === 'questions' ? questionOcr?.id : selectedDocOcr?.id
      const fallbackOcrDocumentId = selectedDocOcr?.id || selectedOcrId || options[0]?.ocrDocumentId || ''
      if (!options.length && fallbackOcrDocumentId) {
        appendMarkdownPreviewDocumentOption(options, markdownPreviewDocumentOption(selectedImportJobDocument?.role || 'full', fallbackOcrDocumentId, selectedDoc))
      }
      return { ocrDocumentId: preferredOcrDocumentId || fallbackOcrDocumentId, documentOptions: options }
    }
    const ocrDocumentId = selectedDocOcr?.id || selectedOcrId || ''
    if (ocrDocumentId) appendMarkdownPreviewDocumentOption(options, markdownPreviewDocumentOption(selectedImportJobDocument?.role || 'full', ocrDocumentId, selectedDoc))
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
      if (questionOcrDocumentId) appendMarkdownPreviewDocumentOption(options, markdownPreviewDocumentOption('questions', questionOcrDocumentId, activeImportJobQuestionSource))
      if (solutionOcrDocumentId) appendMarkdownPreviewDocumentOption(options, markdownPreviewDocumentOption('solutions', solutionOcrDocumentId, activeImportJobSolutionSource))
      return {
        ocrDocumentId: focusKind === 'stem' ? questionOcrDocumentId || solutionOcrDocumentId : solutionOcrDocumentId || questionOcrDocumentId,
        documentOptions: options,
      }
    }
    const sourceDocumentId = activeQuestion?.rawItem?.sourceDocumentId || selectedDoc?.id || ''
    const source = sourceDocumentId ? sourceDocuments.find((item) => item.id === sourceDocumentId) || selectedDoc : selectedDoc
    const ocrDocumentId = activeQuestion?.rawItem?.ocrDocumentId || selectedDocOcr?.id || selectedOcrId || ''
    if (ocrDocumentId) appendMarkdownPreviewDocumentOption(options, markdownPreviewDocumentOption(selectedImportJobDocument?.role || 'full', ocrDocumentId, source))
    return { ocrDocumentId, documentOptions: options }
  }

  async function openSelectedDocMarkdownPreview() {
    const { ocrDocumentId, documentOptions } = await markdownPreviewDocumentsForSelectedDoc()
    if (!ocrDocumentId) { setError('当前资料尚未生成 OCR 识别稿。'); return }
    setMarkdownPreviewTarget({
      ocrDocumentId, documentOptions,
      candidateIds: questions.map((item) => item.id),
      title: selectedDoc?.originalFileName ? `模型识别稿：${selectedDoc.originalFileName}` : '模型识别稿',
    })
  }

  async function handleApplySelectedParserPreset() {
    if (!selectedDoc) return
    const preset = parserPresets.find((item) => item.id === selectedParserPresetId)
    if (!preset) { setError('请先选择导入规则预设。'); return }
    const ok = window.confirm(`将使用预设「${preset.name}」重新生成本批次未入库候选题。确定继续吗？`)
    if (!ok) return
    await handleRecleanCandidates(selectedDoc, { presetId: preset.id }, { skipConfirm: true, label: `已使用预设「${preset.name}」重新生成待核对题目` })
  }

  async function handleApplyPreviewParserRequest(payload: ParseCandidatesRequest) {
    if (!selectedDoc) { setError('请先选择要重解析的资料。'); return }
    const preset = payload.presetId ? parserPresets.find((item) => item.id === payload.presetId) : undefined
    const settingLabel = preset ? `预设「${preset.name}」` : '预览窗口中的自定义设置'
    const ok = window.confirm(`将使用${settingLabel}重新生成本批次未入库候选题。确定继续吗？`)
    if (!ok) return
    setMarkdownPreviewTarget(null)
    await handleRecleanCandidates(selectedDoc, payload, {
      skipConfirm: true,
      label: preset ? `已使用预设「${preset.name}」重新生成待核对题目` : '已使用预览窗口中的自定义设置重新生成待核对题目',
    })
  }

  async function openActiveQuestionMarkdownPreview(focusKind: 'stem' | 'answer' | 'analysis') {
    if (!activeQuestion) return
    const { ocrDocumentId, documentOptions } = await markdownPreviewDocumentsForActiveQuestion(focusKind)
    if (!ocrDocumentId) {
      setError(focusKind === 'stem' ? '当前题目尚未关联 OCR 识别稿。' : '当前批次尚未找到答案解析 OCR 识别稿。')
      return
    }
    setMarkdownPreviewTarget({
      ocrDocumentId, documentOptions,
      candidateId: activeQuestion.id,
      candidateIds: questions.map((item) => item.id),
      questionNo: activeQuestion.questionNo,
      focusKind,
      title: `第 ${activeQuestion.questionNo || '？'} 题${focusKind === 'stem' ? '题干' : focusKind === 'answer' ? '答案' : '解析'}来源诊断`,
    })
  }

  // --- Bulk operations ---
  async function handleBulkConfirm() {
    if (selectedIds.size === 0) return
    const idsArray = Array.from(selectedIds)
    setBusy('bulk-confirm'); setError('')
    try {
      const result = await importV2Api.commitCandidates(idsArray)
      const committedIdsSet = new Set(idsArray.filter((id) => !result.errors?.some((error) => error.id === id)))
      setQuestions((items) => items.map((item) => committedIdsSet.has(item.id) ? { ...item, status: 'committed' } : item))
      showNotice(`批量确认完成：成功入库 ${result.success} 题${result.failed ? `，失败 ${result.failed} 题` : ''}。`)
      setCommittedIds((prev) => { const next = new Set(prev); committedIdsSet.forEach(id => next.add(id)); return next })
      setSelectedIds(new Set())
      await loadLists()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy('') }
  }

  async function handleBulkSkip() {
    if (selectedIds.size === 0) return
    const idsArray = Array.from(selectedIds)
    const skippedIds = new Set(idsArray)
    setBusy('bulk-skip'); setError('')
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
      setCommittedIds((prev) => { const next = new Set(prev); idsArray.forEach((id) => next.delete(id)); return next })
      setSelectedIds(new Set())
      showNotice(`已跳过并移除 ${result.success} 道题，这些题目不会入库。`)
      await loadLists()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy('') }
  }

  // --- Review model ---
  const reviewModel = useMemo(() => buildCandidateReviewModel({
    questions, activeQuestionId, activeTab, activeDiagnosticCode, committedIds,
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
    if (activeQuestion) setEditingQuestionNo(activeQuestion.questionNo || '')
    else setEditingQuestionNo('')
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
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(selectableList.map(q => q.id)))
  }

  function handleSelectToggle(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return {
    // Navigation
    navigate,
    navigateToDocument,
    navigateToCandidates,
    navigateToCandidate,
    documentUrl,
    // State
    sourceDocuments,
    ocrDocuments,
    questions,
    committedIds,
    activeStepTab,
    setActiveStepTab,
    selectedDoc,
    selectedSourceDocId,
    showCheckArea,
    editingQuestionNo,
    setEditingQuestionNo,
    savingQuestionType,
    metadataDraft,
    setMetadataDraft,
    showMetadataEditor,
    setShowMetadataEditor,
    watermarkCleanupDraft,
    setWatermarkCleanupDraft,
    showWatermarkCleanupEditor,
    setShowWatermarkCleanupEditor,
    uploadDocumentMode,
    setUploadDocumentMode,
    pendingUploadFile,
    questionUploadFile,
    solutionUploadFile,
    activeImportJob,
    activeImportJobDocuments,
    parserPresets,
    selectedParserPresetId,
    setSelectedParserPresetId,
    markdownPreviewTarget,
    setMarkdownPreviewTarget,
    uploading,
    sourceOcrErrors,
    activeTab,
    activeDiagnosticCode,
    setActiveDiagnosticCode,
    activeQuestionId,
    setActiveQuestionId,
    selectedIds,
    diagnostics,
    figureAssignments,
    setFigureAssignments,
    figureMoveDrafts,
    setFigureMoveDrafts,
    busy,
    notice,
    error,
    dragOver,
    setDragOver,
    // Refs
    fileInputRef,
    questionFileInputRef,
    solutionFileInputRef,
    checkAreaRef,
    candidateListRef,
    candidateItemRefs,
    // Derived
    selectedOcr,
    selectedDocOcr,
    selectedImportJobDocument,
    selectedDocIsImportJobQuestion,
    selectedDocIsImportJobSolution,
    activeImportJobSolutionReady,
    activeImportJobQuestionSource,
    activeImportJobSolutionSource,
    selectedDocCommittedCount,
    canReidentifySelectedDoc,
    canRecleanSelectedDoc,
    currentOcrProviderLabel,
    steps,
    ocrSettings,
    // Review model
    activeQuestion,
    activeQuestionCommitted,
    activeQuestionReviewState,
    committedQuestionCount,
    filteredQuestions,
    parseDiagnosticCounts,
    reviewTabs,
    selectableList,
    visibleActiveParseDiagnostics,
    allSelected,
    // Handlers
    getDocStatus,
    setReviewTab,
    handleUploadFileSelection,
    handleSeparatedFileSelection,
    handleStartUpload,
    handleStartSeparatedUpload,
    startSourceOcr,
    handleReidentifySource,
    handleGenerateCandidates,
    handleRecleanCandidates,
    handleContinueCheck,
    handleDeleteSourceDoc,
    openEditModal,
    handleSaveSourceMetadata,
    openWatermarkCleanupModal,
    handleSaveWatermarkCleanup,
    commitSingleQuestion,
    startManualFix,
    handleSaveQuestionNo,
    handleSaveQuestionType,
    handleResolveUnplacedFigure,
    handleMoveCandidateFigure,
    handleDeleteCandidateFigure,
    handleDeleteCandidate,
    openSelectedDocMarkdownPreview,
    handleApplySelectedParserPreset,
    handleApplyPreviewParserRequest,
    openActiveQuestionMarkdownPreview,
    handleBulkConfirm,
    handleBulkSkip,
    handleSelectAll,
    handleSelectToggle,
    showNotice,
  }
}

export type ImportV2WorkspaceState = ReturnType<typeof useImportV2Workspace>

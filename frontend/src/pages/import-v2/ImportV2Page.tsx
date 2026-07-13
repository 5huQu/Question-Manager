import { useEffect, useMemo, useState, useRef } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
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
import { importV2Api, type ImportFlowV2ParserConfig, type ImportParserPreset, type ImportV2Candidate, type ImportV2ImportJob, type ImportV2ImportJobDocument, type ImportV2ImportJobDocumentDetail, type ImportV2OcrDocument, type ImportV2SourceDocument, type OcrFigureDiagnostics, type ParseCandidatesRequest, type ParseCandidatesResult } from '@/api/importV2'
import { settingsApi } from '@/api/settings'
import { MarkdownContent } from '@/components/MarkdownContent'
import { MarkdownStructurePreviewDialog, type MarkdownPreviewDocumentOption } from '@/components/import-v2/MarkdownStructurePreviewDialog'
import { MarkdownWithInlineFigures, QuestionMarkdownContent } from '@/components/questions/QuestionContent'
import { PageTitle, Panel, Badge, Button, Empty } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { Modal } from '@/components/dialogs/Modal'
import { importIssueLabel, parserDiagnosticLabel } from '@/utils/importDiagnostics'
import { assetUrl } from '@/utils/questionDisplay'
import { ensureStageValue, gradeOptionsForTeachingStages } from '@/utils/stages'

// ── 统一数据适配层 (Unified Model Adapter) ─────────────────────────────

type UnifiedQuestion = {
  id: string
  questionNo: string
  questionType: string
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  status: 'ready' | 'needs_review' | 'needs_manual_fix' | 'blocked' | 'committed' | 'banked' | 'skipped'
  issues: Array<{ severity: 'warning' | 'error'; message: string; code?: string }>
  figures: Array<{ id: string; usage: string; path: string; pageNo?: number; blockId?: string; sourceBlockId?: string; bbox?: any; inlineMarker?: string; optionLabel?: string }>
  hasFigures: boolean
  similarQuestions?: any[]
  parseDiagnostics: Array<{ code: string; severity: 'info' | 'warning' | 'error'; message: string; questionNo?: string }>
  rawItem: any
}

type PaperKind = ImportV2SourceDocument['paperKind']
type UploadDocumentMode = 'single_document' | 'separated_documents'
type SourceOcrProvider = 'doc2x' | 'glm'

type SourceMetadataDraft = {
  paperTitle: string
  batchName: string
  stage: string
  subject: string
  province: string
  city: string
  paperKind: PaperKind
  examYear: string
  sourceOrg: string
  hasWatermark: boolean
  watermarkTerms: string
}

const paperKindOptions: Array<{ value: PaperKind; label: string }> = [
  { value: 'gaokao_real', label: '高考真题' },
  { value: 'local_real', label: '地方真题' },
  { value: 'mock', label: '模拟题' },
  { value: 'school_exam', label: '校内考试' },
  { value: 'lecture', label: '讲义' },
  { value: 'daily_practice', label: '日常练习' },
  { value: 'unknown', label: '未分类' },
]

const subjectOptions = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理']

const gaokaoRegionOptions = [
  {
    value: '全国一卷 / 新课标全国 I 卷',
    label: '全国一卷 / 新课标全国 I 卷',
    provinces: '浙江、山东、江苏、河北、福建、湖北、湖南、广东、江西、安徽、河南',
  },
  {
    value: '全国二卷 / 新课标全国 II 卷',
    label: '全国二卷 / 新课标全国 II 卷',
    provinces: '海南、重庆、贵州、广西、甘肃、四川、云南、辽宁、吉林、黑龙江、内蒙古、陕西、青海、宁夏、山西、新疆、西藏',
  },
  { value: '北京', label: '北京', provinces: '' },
  { value: '上海', label: '上海', provinces: '' },
  { value: '天津', label: '天津', provinces: '' },
]

function isGaokaoRegion(value: string) {
  return gaokaoRegionOptions.some((item) => item.value === value)
}

function metadataDraftFromDoc(doc?: Partial<ImportV2SourceDocument> | null): SourceMetadataDraft {
  const watermark = doc?.metadata && typeof doc.metadata.watermark === 'object' && !Array.isArray(doc.metadata.watermark)
    ? doc.metadata.watermark as { enabled?: unknown; terms?: unknown }
    : {}
  const watermarkTerms = Array.isArray(watermark.terms)
    ? watermark.terms.map((item) => String(item || '')).filter(Boolean).join('\n')
    : ''
  return {
    paperTitle: doc?.paperTitle || '',
    batchName: doc?.batchName || '',
    stage: doc?.stage || '高三',
    subject: doc?.subject || '数学',
    province: doc?.province || '',
    city: doc?.city || '',
    paperKind: doc?.paperKind || 'unknown',
    examYear: doc?.examYear ? String(doc.examYear) : '',
    sourceOrg: doc?.sourceOrg || '',
    hasWatermark: Boolean(watermark.enabled),
    watermarkTerms,
  }
}

function metadataPayload(draft: SourceMetadataDraft) {
  const isGaokaoReal = draft.paperKind === 'gaokao_real'
  const gaokaoProvince = isGaokaoReal && isGaokaoRegion(draft.province) ? draft.province.trim() : ''
  const paperTitle = draft.paperTitle.trim()
  return {
    paperTitle,
    batchName: draft.batchName.trim() || paperTitle,
    stage: draft.stage.trim() || '高三',
    subject: draft.subject.trim() || '数学',
    province: isGaokaoReal ? gaokaoProvince : draft.province.trim(),
    city: isGaokaoReal ? '' : draft.city.trim(),
    paperKind: draft.paperKind || 'unknown',
    examYear: Number(draft.examYear || 0) || 0,
    sourceOrg: isGaokaoReal ? '' : draft.sourceOrg.trim(),
    metadata: {
      watermark: {
        enabled: draft.hasWatermark,
        terms: draft.watermarkTerms.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      },
    },
  }
}

function hasVisibleFigureMarkup(...contents: string[]) {
  return contents.some((content) =>
    /!\[[^\]]*]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))\s*\)/.test(String(content || '')) ||
    /<!--\s*DOC2X_FIGURE:([^\s>]+)\s*-->/.test(String(content || ''))
  )
}

function fromCandidate(c: ImportV2Candidate): UnifiedQuestion {
  return {
    id: c.id,
    questionNo: c.questionNo || '',
    questionType: c.questionType || '',
    stemMarkdown: c.stemMarkdown || '',
    answerText: c.answerText || '',
    analysisMarkdown: c.analysisMarkdown || '',
    status: c.status === 'committed' ? 'committed' : c.status === 'ready' ? 'ready' : c.status === 'blocked' ? 'blocked' : 'needs_review',
    issues: (c.issues || []).map(iss => ({ severity: iss.severity, message: iss.message, code: iss.code })),
    figures: (c.figures || []).map(fig => ({
      id: fig.id,
      usage: fig.usage,
      path: fig.path,
      pageNo: fig.pageNo,
      blockId: fig.blockId,
      sourceBlockId: fig.sourceBlockId,
      bbox: fig.bbox,
      inlineMarker: fig.inlineMarker,
      optionLabel: fig.optionLabel,
    })),
    hasFigures: hasVisibleFigureMarkup(c.stemMarkdown, c.answerText, c.analysisMarkdown),
    parseDiagnostics: (c.parseDiagnostics || []).map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      questionNo: diagnostic.questionNo,
    })),
    rawItem: c
  }
}

function issueLabel(code?: string) {
  return importIssueLabel(code)
}

function importJobDocumentRoleLabel(role?: ImportV2ImportJobDocument['role']) {
  return ({
    full: '完整文档',
    questions: '原卷',
    solutions: '答案解析',
  } as Record<string, string>)[role || ''] || ''
}

function normalizeSourceOcrProvider(value: unknown): SourceOcrProvider {
  return String(value || '').toLowerCase() === 'glm' ? 'glm' : 'doc2x'
}

function sourceOcrProviderLabel(provider: SourceOcrProvider) {
  return provider === 'glm' ? 'GLM-OCR' : 'Doc2X'
}

function reviewTabFromQuery(value: string | null): 'all' | 'ready' | 'warning' | 'error' {
  return value === 'ready' || value === 'warning' || value === 'error' ? value : 'all'
}

export default function ImportV2Page() {
  const navigate = useNavigate()
  const location = useLocation()
  const { jobId: importJobIdFromPath, sourceDocumentId: sourceDocumentIdFromPath, candidateId: candidateIdFromPath } = useParams<{ jobId: string; sourceDocumentId: string; candidateId: string }>()
  const [searchParams] = useSearchParams()
  const sourceDocumentIdFromQuery = searchParams.get('sourceDocumentId') || ''
  const importJobIdFromQuery = searchParams.get('importJobId') || ''
  const currentImportJobId = importJobIdFromPath || importJobIdFromQuery
  const isCandidatesRoute = Boolean(location.pathname.includes('/candidates'))
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

  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const questionFileInputRef = useRef<HTMLInputElement>(null)
  const solutionFileInputRef = useRef<HTMLInputElement>(null)
  const checkAreaRef = useRef<HTMLDivElement>(null)
  const lastRouteSyncKeyRef = useRef('')
  const [dragOver, setDragOver] = useState(false)
  const ocrSettings = useAsync(() => settingsApi.getOcrSettings(), [])
  const currentOcrProvider = normalizeSourceOcrProvider(ocrSettings.data?.ocrProvider)
  const currentOcrProviderLabel = sourceOcrProviderLabel(currentOcrProvider)
  const configuredStageOptions = gradeOptionsForTeachingStages(ocrSettings.data?.teachingStages)
  const stageOptions = metadataDraft.stage && !configuredStageOptions.includes(metadataDraft.stage)
    ? [metadataDraft.stage, ...configuredStageOptions]
    : configuredStageOptions
  const selectedStage = ensureStageValue(metadataDraft.stage, stageOptions)
  const metadataSubject = metadataDraft.subject || '数学'
  const visibleSubjectOptions = subjectOptions.includes(metadataSubject) ? subjectOptions : [metadataSubject, ...subjectOptions]

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
    return `/tools/import/jobs/${encodeURIComponent(importJobId)}/documents/${encodeURIComponent(sourceDocumentId)}`
  }

  function currentImportJobIdForSourceDocument(sourceDocumentId: string) {
    const jobDocument = activeImportJobDocuments.find((item) => item.sourceDocumentId === sourceDocumentId)
    return jobDocument?.jobId || ''
  }

  function documentUrl(sourceDocumentId: string) {
    const importJobId = currentImportJobIdForSourceDocument(sourceDocumentId)
    return importJobId
      ? jobDocumentUrl(importJobId, sourceDocumentId)
      : `/tools/import/documents/${encodeURIComponent(sourceDocumentId)}`
  }

  function candidatesUrl(sourceDocumentId: string) {
    const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
    return `${documentUrl(sourceDocumentId)}/candidates${suffix}`
  }

  function candidateUrl(sourceDocumentId: string, candidateId: string) {
    const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
    return `${documentUrl(sourceDocumentId)}/candidates/${encodeURIComponent(candidateId)}${suffix}`
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

  async function loadLists() {
    const [sourceResult, ocrResult] = await Promise.all([
      importV2Api.listSourceDocuments(),
      importV2Api.listOcrDocuments(),
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
    loadLists().catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  useEffect(() => {
    let active = true
    importV2Api.listParserPresets()
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
    importV2Api.getImportJob(currentImportJobId)
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

  useEffect(() => {
    if (!runningSourceDocumentKey) return undefined
    let active = true
    const runningIds = runningSourceDocumentKey.split('|').filter(Boolean)
    const poll = async () => {
      const settled = await Promise.all(runningIds.map(async (id) => {
        try {
          return { id, result: await importV2Api.getSourceDocumentOcrStatus(id) }
        } catch (err) {
          return { id, error: err }
        }
      }))
      if (!active) return

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
      if (!active) return
      if (currentImportJobId) {
        try {
          const result = await importV2Api.getImportJob(currentImportJobId)
          if (!active) return
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
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 3000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [currentImportJobId, runningSourceDocumentKey, selectedDoc?.id])

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
      const result = await importV2Api.listCandidates(item.id)
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
      const result = await importV2Api.listCandidates(selectedOcr.sourceDocumentId)
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

  // 8. 批量跳过操作仅在当前界面标记，v2 跳过持久化尚未接入。
  async function handleBulkSkip() {
    if (selectedIds.size === 0) return
    const idsArray = Array.from(selectedIds)
    setBusy('bulk-skip')
    try {
      setCommittedIds((prev) => {
        const next = new Set(prev)
        idsArray.forEach(id => next.add(id))
        return next
      })
      setSelectedIds(new Set())
      showNotice('已跳过选中的题目')
      await loadLists()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  // 多选与过滤计算
  const activeQuestion = useMemo(() => {
    return questions.find(q => q.id === activeQuestionId) || null
  }, [questions, activeQuestionId])

  useEffect(() => {
    if (activeQuestion) {
      setEditingQuestionNo(activeQuestion.questionNo || '')
    } else {
      setEditingQuestionNo('')
    }
  }, [activeQuestion?.id, activeQuestion?.questionNo])

  const visibleActiveParseDiagnostics = useMemo(() => {
    if (!activeQuestion) return []
    const issueCodes = new Set((activeQuestion.issues || []).map((issue) => issue.code).filter(Boolean))
    return (activeQuestion.parseDiagnostics || []).filter((diagnostic) => !issueCodes.has(diagnostic.code))
  }, [activeQuestion])

  const filteredQuestions = useMemo(() => {
    return questions.filter(q => {
      if (activeDiagnosticCode && !q.parseDiagnostics.some((diagnostic) => diagnostic.code === activeDiagnosticCode)) {
        return false
      }
      if (activeTab === 'ready') {
        return q.status === 'ready' && q.issues.length === 0
      }
      if (activeTab === 'warning') {
        return q.issues.some(iss => iss.severity === 'warning') || (q.similarQuestions && q.similarQuestions.length > 0)
      }
      if (activeTab === 'error') {
        return q.status === 'blocked' || q.status === 'needs_manual_fix' || q.issues.some(iss => iss.severity === 'error')
      }
      return true
    })
  }, [questions, activeTab, activeDiagnosticCode])

  const parseDiagnosticCounts = useMemo(() => {
    const counts = new Map<string, { code: string; count: number; severity: 'info' | 'warning' | 'error' }>()
    for (const question of questions) {
      const seen = new Set<string>()
      for (const diagnostic of question.parseDiagnostics || []) {
        if (!diagnostic.code || seen.has(diagnostic.code)) continue
        seen.add(diagnostic.code)
        const current = counts.get(diagnostic.code) || { code: diagnostic.code, count: 0, severity: diagnostic.severity }
        current.count += 1
        if (diagnostic.severity === 'error' || (diagnostic.severity === 'warning' && current.severity === 'info')) current.severity = diagnostic.severity
        counts.set(diagnostic.code, current)
      }
    }
    return Array.from(counts.values()).sort((left, right) => {
      const severityOrder = { error: 0, warning: 1, info: 2 }
      return severityOrder[left.severity] - severityOrder[right.severity] || right.count - left.count || left.code.localeCompare(right.code)
    })
  }, [questions])

  // 批量全选判断
  const selectableList = useMemo(() => {
    return filteredQuestions.filter(q => q.status !== 'committed' && !committedIds.has(q.id))
  }, [filteredQuestions, committedIds])

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
    <div className="space-y-6">
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

      {/* 步骤分标签工作台导航 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex bg-zinc-100/80 dark:bg-zinc-900/80 p-0.5 rounded-lg border border-zinc-200/50 dark:border-zinc-800/50 w-full sm:w-80 select-none">
          <button
            onClick={() => {
              if (selectedDoc) navigateToDocument(selectedDoc.id)
              else setActiveStepTab('upload')
            }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeStepTab === 'upload'
                ? 'bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-xs border border-zinc-200/20'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
            }`}
          >
            1. 资料上传与识别
          </button>
          <button
            onClick={() => {
              if (selectedDoc) navigateToCandidates(selectedDoc.id)
              else setActiveStepTab('review')
            }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeStepTab === 'review'
                ? 'bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-xs border border-zinc-200/20'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
            }`}
          >
            2. 题目核对区
            {questions.length > 0 && (
              <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-[9px] bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-950 font-bold ml-1">
                {questions.filter(q => q.status !== 'committed' && !committedIds.has(q.id)).length}
              </span>
            )}
          </button>
        </div>

        {activeStepTab === 'review' && selectedDoc ? (
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-8 max-w-56 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
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
              icon={RefreshCcw}
              disabled={Boolean(busy) || !selectedParserPresetId || !canRecleanSelectedDoc}
              onClick={handleApplySelectedParserPreset}
            >
              按预设重解析
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={FileText}
              disabled={!selectedDocOcr && !selectedOcrId}
              onClick={openSelectedDocMarkdownPreview}
            >
              查看模型识别稿
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={busy === `ocr-${selectedDoc.id}` ? LoaderCircle : RefreshCcw}
              disabled={Boolean(busy) || !canReidentifySelectedDoc}
              title={selectedDocCommittedCount > 0 ? '该批次已有题目入库，暂不支持重新识别。' : '重新调用 OCR，并清空未入库候选题。'}
              onClick={() => handleReidentifySource(selectedDoc)}
            >
              {busy === `ocr-${selectedDoc.id}` ? '识别中...' : '重新识别'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={busy === `reclean-${selectedDoc.id}` ? LoaderCircle : RefreshCcw}
              disabled={Boolean(busy) || !canRecleanSelectedDoc}
              title={selectedDocCommittedCount > 0 ? '该批次已有题目入库，暂不支持重新清洗。' : '使用当前清洗脚本重新生成本批次候选题。'}
              onClick={() => handleRecleanCandidates(selectedDoc)}
            >
              {busy === `reclean-${selectedDoc.id}` ? '清洗中...' : '重新清洗'}
            </Button>
          </div>
        ) : null}
      </div>

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
                            navigate(`/tools/import/jobs/${encodeURIComponent(activeImportJob.id)}/questions`)
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
        <div ref={checkAreaRef} className="flex h-auto min-h-0 flex-col items-stretch gap-4 lg:h-[calc(100vh-12rem)] lg:min-h-[700px] lg:flex-row">
          {/* 左侧：题目列表卡片栏 (35% 宽度) */}
          <div className="w-full lg:w-[35%] shrink-0 flex flex-col border rounded-xl bg-white dark:bg-zinc-955 overflow-hidden shadow-sm">
            {/* 分类过滤器 */}
            <div className="border-b border-zinc-100 bg-white dark:border-zinc-900 p-3 select-none">
              <div className="bg-zinc-100/80 dark:bg-zinc-900/80 p-0.5 rounded-lg border border-zinc-200/50 dark:border-zinc-800/50 flex gap-0.5 w-full">
                {[
                  { key: 'all', label: '全部', count: questions.length },
                  { key: 'ready', label: '可以入库', count: questions.filter(q => q.status === 'ready' && q.issues.length === 0).length },
                  { key: 'warning', label: '建议核对', count: questions.filter(q => q.issues.some(iss => iss.severity === 'warning') || q.similarQuestions && q.similarQuestions.length > 0).length },
                  { key: 'error', label: '需要修正', count: questions.filter(q => q.status === 'blocked' || q.status === 'needs_manual_fix' || q.issues.some(iss => iss.severity === 'error')).length },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setReviewTab(tab.key as 'all' | 'ready' | 'warning' | 'error')}
                    className={`flex-1 inline-flex items-center justify-center py-1.5 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                      activeTab === tab.key
                        ? 'bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-xs border border-zinc-200/20 font-semibold'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className={`ml-1.5 px-1.5 py-0.25 rounded-full text-[9px] font-mono leading-none ${
                      activeTab === tab.key
                        ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-950'
                        : 'bg-zinc-200/60 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}>
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {parseDiagnosticCounts.length > 0 ? (
              <div className="border-b border-zinc-100 bg-white px-3 py-2 dark:border-zinc-900 dark:bg-zinc-955">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-zinc-500">结构诊断</span>
                  {activeDiagnosticCode ? (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveDiagnosticCode('')
                        setSelectedIds(new Set())
                      }}
                      className="text-[10px] font-medium text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                    >
                      清除诊断过滤
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {parseDiagnosticCounts.slice(0, 8).map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => {
                        setActiveDiagnosticCode(activeDiagnosticCode === item.code ? '' : item.code)
                        setSelectedIds(new Set())
                      }}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors ${
                        activeDiagnosticCode === item.code
                          ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950'
                          : item.severity === 'warning'
                            ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300'
                            : item.severity === 'error'
                              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300'
                              : 'border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300'
                      }`}
                    >
                      <span>{parserDiagnosticLabel(item.code)}</span>
                      <span>{item.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* 批量多选控制条 */}
            <div className="border-b border-zinc-100 dark:border-zinc-900 px-4 py-2.5 flex items-center justify-between text-xs text-zinc-500">
              <button
                onClick={handleSelectAll}
                className="flex items-center gap-2 hover:text-zinc-900 dark:hover:text-zinc-55 transition-colors font-medium cursor-pointer"
              >
                <span className={`flex items-center justify-center size-3.5 rounded border transition-all ${
                  allSelected
                    ? 'bg-zinc-900 border-zinc-900 text-zinc-55 dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-950'
                    : 'bg-white border-zinc-300 dark:bg-zinc-955 dark:border-zinc-700 hover:border-zinc-400'
                }`}>
                  {allSelected ? <Check className="size-2.5 stroke-[3.5]" /> : null}
                </span>
                <span>
                  {selectedIds.size > 0 ? `已选择 ${selectedIds.size} 题` : `本组共 ${selectableList.length} 题待存入`}
                </span>
              </button>

              {activeTab !== 'all' && (
                <button
                  onClick={() => setReviewTab('all')}
                  className="hover:underline text-[11px]"
                >
                  清除过滤
                </button>
              )}
            </div>

            {/* 题目卡片列表滚动容器 */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-zinc-50/20 dark:bg-zinc-900/10">
              {filteredQuestions.length === 0 ? (
                <div className="h-48 flex items-center justify-center">
                  <Empty text="此分类下暂无试题" />
                </div>
              ) : (
                filteredQuestions.map((q) => {
                  const isCommitted = q.status === 'committed' || committedIds.has(q.id)
                  const isSelected = selectedIds.has(q.id)
                  const isActive = q.id === activeQuestionId
                  const preview = q.stemMarkdown.replace(/\$\$?[^$]+\$\$?/g, '[公式]').replace(/[#*_~`>|\\]/g, '').trim().slice(0, 50)

                  return (
                    <div
                      key={q.id}
                      onClick={() => {
                        setActiveQuestionId(q.id)
                        const sourceDocId = q.rawItem?.sourceDocumentId || selectedDoc?.id || sourceDocumentIdFromPath
                        if (sourceDocId) navigateToCandidate(sourceDocId, q.id)
                      }}
                      className={`flex items-start gap-3 rounded-lg border p-3 transition-all cursor-pointer shadow-sm relative overflow-hidden pl-3.5 ${
                        isActive
                          ? 'border-zinc-950 bg-zinc-50/40 dark:border-zinc-50 dark:bg-zinc-900/40 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-zinc-950 dark:before:bg-zinc-50'
                          : 'border-zinc-200 bg-white hover:bg-zinc-50/10 dark:border-zinc-800 dark:bg-zinc-955 dark:hover:bg-zinc-900/20'
                      }`}
                    >
                      {/* 多选框 (已入库题目不允许再次勾选) */}
                      <button
                        disabled={isCommitted}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSelectToggle(q.id)
                        }}
                        className={`mt-0.5 shrink-0 flex items-center justify-center size-4 rounded border transition-all ${
                          isCommitted
                            ? 'cursor-not-allowed opacity-20 border-zinc-200 dark:border-zinc-800'
                            : 'cursor-pointer'
                        } ${
                          isSelected
                            ? 'bg-zinc-900 border-zinc-900 text-zinc-55 dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-950'
                            : 'bg-white border-zinc-300 dark:bg-zinc-955 dark:border-zinc-700 hover:border-zinc-400'
                        }`}
                      >
                        {isSelected ? <Check className="size-2.5 stroke-[3]" /> : null}
                      </button>

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                            第 {q.questionNo || '？'} 题
                          </span>

                          {/* 状态指示徽章 */}
                          {isCommitted ? (
                            <Badge variant="success">已入库</Badge>
                          ) : q.status === 'blocked' || q.status === 'needs_manual_fix' || q.issues.some(iss => iss.severity === 'error') ? (
                            <Badge variant="danger">需要修正</Badge>
                          ) : q.issues.some(iss => iss.severity === 'warning') || q.similarQuestions?.length ? (
                            <Badge variant="warning">建议核对</Badge>
                          ) : (
                            <Badge variant="outline">无需修改</Badge>
                          )}

                          {q.hasFigures && (
                            <span className="inline-flex items-center text-zinc-400 dark:text-zinc-500" title="包含题图">
                              <ImageIcon className="size-3" />
                            </span>
                          )}
                        </div>

                        {preview ? (
                          <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400 line-clamp-2">
                            {preview}
                          </p>
                        ) : (
                          <p className="text-[11px] leading-relaxed text-zinc-400 italic">
                            题干识别为空
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* 右侧：预览详情面板 (65% 宽度) */}
          <div className="flex-1 flex flex-col border rounded-xl bg-white dark:bg-zinc-955 overflow-hidden shadow-sm min-w-0">
            {activeQuestion ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* 详情头部操作区 */}
                <div className="border-b border-zinc-100 bg-zinc-50/50 dark:border-zinc-900 dark:bg-zinc-900/10 px-5 py-3 shrink-0 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="space-y-0.5">
                      <h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-1.5">
                        第
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
                          disabled={activeQuestion.status === 'committed' || committedIds.has(activeQuestion.id)}
                          className="w-12 h-6 text-center border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 rounded text-xs font-semibold text-zinc-900 dark:text-zinc-50 focus:outline-hidden focus:ring-1 focus:ring-zinc-950 dark:focus:ring-zinc-300 transition-all disabled:opacity-50"
                        />
                        题 详细内容核对
                      </h3>
                      <p className="text-[11px] text-zinc-500">
                        检查公式和插图，确认后即可存入主库。
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="font-medium text-zinc-500 dark:text-zinc-400">题型</span>
                        <select
                          className="h-7 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-900 outline-none transition-colors focus:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                          value={activeQuestion.questionType || ''}
                          disabled={activeQuestion.status === 'committed' || committedIds.has(activeQuestion.id) || savingQuestionType === activeQuestion.id}
                          onChange={(event) => handleSaveQuestionType(event.target.value)}
                        >
                          <option value="">自动判断</option>
                          <option value="单选题">单选题</option>
                          <option value="多选题">多选题</option>
                          <option value="填空题">填空题</option>
                          <option value="解答题">解答题</option>
                        </select>
                        {savingQuestionType === activeQuestion.id ? (
                          <span className="text-zinc-400">保存中...</span>
                        ) : activeQuestion.questionType ? (
                          <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">已识别</span>
                        ) : null}
                      </div>
                    </div>

                    {/* 核对操作按钮 */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        icon={Trash2}
                        disabled={activeQuestion.status === 'committed' || committedIds.has(activeQuestion.id) || Boolean(busy)}
                        onClick={() => handleDeleteCandidate(activeQuestion.id)}
                        className="!border-red-200/60 !bg-red-50/20 !text-red-700 hover:!bg-red-50 dark:!border-red-900/30 dark:!bg-red-950/20 dark:!text-red-400 dark:hover:!bg-red-950/40"
                      >
                        删除
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        icon={PencilLine}
                        disabled={activeQuestion.status === 'committed' || committedIds.has(activeQuestion.id) || Boolean(busy)}
                        onClick={() => startManualFix(activeQuestion.id, 'stem')}
                      >
                        编辑信息
                      </Button>
                      <Button
                        size="sm"
                        icon={activeQuestion.status === 'committed' || committedIds.has(activeQuestion.id) ? CheckCircle2 : busy === activeQuestion.id ? LoaderCircle : CheckCircle2}
                        disabled={activeQuestion.status === 'committed' || committedIds.has(activeQuestion.id) || busy === activeQuestion.id || !activeQuestion.stemMarkdown.trim()}
                        onClick={() => commitSingleQuestion(activeQuestion)}
                      >
                        {activeQuestion.status === 'committed' || committedIds.has(activeQuestion.id) ? '已入库' : '确认入库'}
                      </Button>
                    </div>
                  </div>
                  
                  {/* 提示文案 */}
                  <div className="text-[10px] text-zinc-500 bg-zinc-100/50 dark:bg-zinc-900/50 px-3 py-1.5 rounded-md border border-zinc-200/50 dark:border-zinc-800/50 leading-relaxed">
                    💡 <strong>说明：</strong>当前框选主要用于补充题图和记录原文区域；题干、解析文字请在修正页中手动编辑。后续可接入局部 OCR。
                  </div>
                </div>

                {/* 题目内容滚动的预览渲染面板 */}
                <div className="flex-1 overflow-y-auto p-5 space-y-6">
                  {/* 异常警示 Banner (如果检测到重复或格式问题) */}
                  {activeQuestion.similarQuestions && activeQuestion.similarQuestions.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/20 p-3.5 text-xs text-amber-800 dark:border-amber-900/30 dark:bg-amber-95/10 dark:text-amber-400 flex items-start gap-2.5 animate-in slide-in-from-top-1 duration-200">
                      <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-semibold">⚠️ 重复入库预警：</p>
                        <p className="leading-relaxed">
                          AI 检测到该题与系统中已有题目内容高度相似（重合度 {Math.round((activeQuestion.similarQuestions[0].similarity || 0.9) * 100)}%）。请确认是否属于相同试题。
                        </p>
                        <div className="mt-2 text-[10px] bg-amber-50/40 dark:bg-amber-95/20 p-2 rounded border border-amber-100 dark:border-amber-900/20">
                          <strong>相似题来源：</strong> {activeQuestion.similarQuestions[0].sourceTitle || '外部题库'} (第 {activeQuestion.similarQuestions[0].questionNo} 题)
                        </div>
                      </div>
                    </div>
                  )}

                  {activeQuestion.issues && activeQuestion.issues.length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50/20 p-3.5 text-xs text-red-700 dark:border-red-900/30 dark:bg-red-95/10 dark:text-red-400 flex items-start gap-2.5 animate-in slide-in-from-top-1 duration-200">
                      <BadgeAlert className="size-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-semibold">⚠️ 智能核对提示：</p>
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
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {visibleActiveParseDiagnostics.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/20 p-3.5 text-xs text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/10 dark:text-amber-300 flex items-start gap-2.5 animate-in slide-in-from-top-1 duration-200">
                      <HelpCircle className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-semibold">结构诊断：</p>
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

                  {/* 题干排版预览 */}
                  <div className="rounded-xl border border-zinc-150 bg-white dark:border-zinc-800 dark:bg-zinc-955 overflow-hidden shadow-xs">
                    <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/50 px-4 py-2.5 dark:border-zinc-900 dark:bg-zinc-900/20 text-xs font-semibold text-zinc-700 dark:text-zinc-300 select-none">
                      <Layers className="size-3.5 text-zinc-400" />
                      <span>题干内容</span>
                    </div>
                    <div className="p-5 leading-relaxed bg-white dark:bg-zinc-955">
                      <QuestionMarkdownContent content={activeQuestion.stemMarkdown || '（空）'} figures={activeQuestion.figures} className="text-sm font-normal" />
                    </div>
                  </div>

                  {/* 自动识别答案 */}
                  <div className="rounded-xl border border-zinc-150 bg-white dark:border-zinc-800 dark:bg-zinc-955 overflow-hidden shadow-xs border-l-2 border-l-emerald-500">
                    <div className="flex items-center gap-2 border-b border-zinc-100 bg-emerald-50/10 px-4 py-2.5 dark:border-zinc-900 dark:bg-emerald-950/5 text-xs font-semibold text-emerald-800 dark:text-emerald-450 select-none">
                      <CheckCircle2 className="size-3.5 text-emerald-500" />
                      <span>自动识别答案</span>
                      <button
                        type="button"
                        onClick={() => openActiveQuestionMarkdownPreview('answer')}
                        className="ml-auto inline-flex size-6 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-100/50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                        title="查看答案来源"
                      >
                        <HelpCircle className="size-3.5" />
                      </button>
                    </div>
                    <div className="p-5 leading-relaxed bg-white dark:bg-zinc-955">
                      <MarkdownWithInlineFigures content={activeQuestion.answerText || '（无）'} figures={activeQuestion.figures} className="text-sm font-normal" />
                    </div>
                  </div>

                  {/* 自动解析步骤 */}
                  <div className="rounded-xl border border-zinc-150 bg-white dark:border-zinc-800 dark:bg-zinc-955 overflow-hidden shadow-xs border-l-2 border-l-zinc-400">
                    <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/40 px-4 py-2.5 dark:border-zinc-900 dark:bg-zinc-900/10 text-xs font-semibold text-zinc-700 dark:text-zinc-300 select-none">
                      <Compass className="size-3.5 text-zinc-400" />
                      <span>自动解析步骤</span>
                      <button
                        type="button"
                        onClick={() => openActiveQuestionMarkdownPreview('analysis')}
                        className="ml-auto inline-flex size-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                        title="查看解析来源"
                      >
                        <HelpCircle className="size-3.5" />
                      </button>
                    </div>
                    <div className="p-5 leading-relaxed bg-white dark:bg-zinc-955">
                      <MarkdownWithInlineFigures content={activeQuestion.analysisMarkdown || '（无）'} figures={activeQuestion.figures} className="text-sm font-normal" />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-zinc-400">
                <Empty text="请从左侧选择题目以开始查看核对" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 动态悬浮底部批量确认入库条 ── */}
      {activeStepTab === 'review' && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-2xl border border-zinc-200/50 bg-white/45 py-2.5 pl-5 pr-3 backdrop-blur-xl dark:border-zinc-800/60 dark:bg-zinc-950/45 flex items-center justify-between shadow-[0_12px_30px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_30px_rgba(0,0,0,0.25)] rounded-full transition-all duration-300 animate-in fade-in slide-in-from-bottom-4 select-none">
          <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 flex items-center gap-2">
            <span className="flex size-5 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900 font-mono leading-none">
              {selectedIds.size}
            </span>
            <span>已勾选 {selectedIds.size} 道题目，可一键批量确认入库</span>
          </span>
          <div className="flex items-center gap-1.5">
            <Button size="xs" icon={CheckCircle2} disabled={Boolean(busy)} onClick={handleBulkConfirm} className="rounded-full px-4 h-8 text-[11px] font-semibold">
              确认入库
            </Button>
            <Button size="xs" variant="outline" icon={SkipForward} disabled={Boolean(busy)} onClick={handleBulkSkip} className="rounded-full px-4 h-8 text-[11px] font-medium border-zinc-200/80 bg-transparent hover:bg-zinc-50 dark:border-zinc-800">
              跳过所选
            </Button>
          </div>
        </div>
      )}

      {showMetadataEditor && (
        <Modal
          title="修改试卷批次属性"
          desc="修改此批次会将属性同步写入底下的所有关联文档以及所有的待确认题目记录中。"
          onClose={() => setShowMetadataEditor(false)}
        >
          <div className="space-y-4 py-2">
            <div className="space-y-4">
              {/* 第一部分：基本档案 */}
              <div className="space-y-3">
                <label className="space-y-1.5 block">
                  <span className="text-[13px] font-medium text-zinc-500">试卷名称</span>
                  <input
                    className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800 transition-all"
                    value={metadataDraft.paperTitle}
                    onChange={(event) => setMetadataDraft((draft) => ({ ...draft, paperTitle: event.target.value }))}
                  />
                </label>
                <label className="space-y-1.5 block">
                  <span className="text-[13px] font-medium text-zinc-500">批次名称</span>
                  <input
                    className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800 transition-all"
                    value={metadataDraft.batchName}
                    onChange={(event) => setMetadataDraft((draft) => ({ ...draft, batchName: event.target.value }))}
                  />
                </label>
              </div>

              {/* 第二部分：分类属性 */}
              <div className="p-3.5 bg-zinc-50/50 dark:bg-zinc-900/20 border border-zinc-150 dark:border-zinc-800 rounded-xl">
                <div className="mb-2.5 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                  分类与年份信息
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1.5 block">
                    <span className="text-[13px] font-medium text-zinc-500">学段/年级</span>
                    <select
                      className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800 transition-all"
                      value={selectedStage}
                      onChange={(event) => setMetadataDraft((draft) => ({ ...draft, stage: event.target.value }))}
                    >
                      {stageOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1.5 block">
                    <span className="text-[13px] font-medium text-zinc-500">学科</span>
                    <select
                      className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800 transition-all"
                      value={metadataSubject}
                      onChange={(event) => setMetadataDraft((draft) => ({ ...draft, subject: event.target.value }))}
                    >
                      {visibleSubjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1.5 block">
                    <span className="text-[13px] font-medium text-zinc-500">资料类型</span>
                    <select
                      className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800 transition-all"
                      value={metadataDraft.paperKind}
                      onChange={(event) => setMetadataDraft((draft) => {
                        const paperKind = event.target.value as PaperKind
                        if (paperKind === 'gaokao_real') {
                          return { ...draft, paperKind, province: isGaokaoRegion(draft.province) ? draft.province : '', city: '', sourceOrg: '' }
                        }
                        return { ...draft, paperKind }
                      })}
                    >
                      {paperKindOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1.5 block">
                    <span className="text-[13px] font-medium text-zinc-500">年份</span>
                    <input
                      type="number"
                      min="0"
                      className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800 transition-all"
                      value={metadataDraft.examYear}
                      onChange={(event) => setMetadataDraft((draft) => ({ ...draft, examYear: event.target.value }))}
                    />
                  </label>
                </div>
              </div>

              {/* 第三部分：归属来源 */}
              <div className="p-3.5 bg-zinc-50/50 dark:bg-zinc-900/20 border border-zinc-150 dark:border-zinc-800 rounded-xl">
                <div className="mb-2.5 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                  归属与来源机构
                </div>
                {metadataDraft.paperKind === 'gaokao_real' ? (
                  <label className="space-y-1.5 block">
                    <span className="text-[13px] font-medium text-zinc-500">试卷适用地区</span>
                    <select
                      className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800 transition-all"
                      value={isGaokaoRegion(metadataDraft.province) ? metadataDraft.province : ''}
                      onChange={(event) => setMetadataDraft((draft) => ({ ...draft, province: event.target.value, city: '', sourceOrg: '' }))}
                    >
                      <option value="">请选择全国卷或直辖市</option>
                      {gaokaoRegionOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="space-y-1.5 block">
                        <span className="text-[13px] font-medium text-zinc-500">省份</span>
                        <input
                          className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800 transition-all"
                          value={metadataDraft.province}
                          onChange={(event) => setMetadataDraft((draft) => ({ ...draft, province: event.target.value }))}
                        />
                      </label>
                      <label className="space-y-1.5 block">
                        <span className="text-[13px] font-medium text-zinc-500">城市</span>
                        <input
                          className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800 transition-all"
                          value={metadataDraft.city}
                          onChange={(event) => setMetadataDraft((draft) => ({ ...draft, city: event.target.value }))}
                        />
                      </label>
                    </div>
                    <label className="space-y-1.5 block">
                      <span className="text-[13px] font-medium text-zinc-500">来源机构</span>
                      <input
                        className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800 transition-all"
                        value={metadataDraft.sourceOrg}
                        onChange={(event) => setMetadataDraft((draft) => ({ ...draft, sourceOrg: event.target.value }))}
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t border-zinc-100 dark:border-zinc-900 mt-4">
              <Button variant="outline" onClick={() => setShowMetadataEditor(false)}>
                取消
              </Button>
              <Button disabled={Boolean(busy)} onClick={handleSaveSourceMetadata}>
                {busy === `metadata-${activeImportJob?.id}` ? '保存中...' : '保存修改'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <MarkdownStructurePreviewDialog
        key={markdownPreviewTarget ? `${markdownPreviewTarget.ocrDocumentId}:${markdownPreviewTarget.candidateId || ''}:${markdownPreviewTarget.focusKind || ''}` : 'closed'}
        open={Boolean(markdownPreviewTarget)}
        ocrDocumentId={markdownPreviewTarget?.ocrDocumentId}
        documentOptions={markdownPreviewTarget?.documentOptions}
        candidateId={markdownPreviewTarget?.candidateId}
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

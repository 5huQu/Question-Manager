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
  ImageIcon,
  Layers,
  LoaderCircle,
  Play,
  SkipForward,
  Upload,
  Trash2,
  PencilLine,
} from 'lucide-react'
import { importV2Api, type ImportV2Candidate, type ImportV2ImportJob, type ImportV2ImportJobDocument, type ImportV2OcrDocument, type ImportV2SourceDocument, type OcrFigureDiagnostics, type ParseCandidatesResult } from '@/api/importV2'
import { settingsApi } from '@/api/settings'
import { MarkdownContent } from '@/components/MarkdownContent'
import { MarkdownWithInlineFigures, QuestionMarkdownContent } from '@/components/questions/QuestionContent'
import { PageTitle, Panel, Badge, Button, Empty } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
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
  rawItem: any
}

type PaperKind = ImportV2SourceDocument['paperKind']
type UploadDocumentMode = 'single_document' | 'separated_documents'

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
    rawItem: c
  }
}

function issueLabel(code?: string) {
  return ({
    duplicate_question_no: '重复题号',
    unplaced_figure: '图片待核对',
    missing_answer: '缺少答案',
    missing_analysis: '缺少解析',
    missing_solution: '缺少解析文档匹配',
    solution_conflict: '解析冲突',
    unmatched_solution: '多余解析',
  } as Record<string, string>)[code || '']
}

function importJobDocumentRoleLabel(role?: ImportV2ImportJobDocument['role']) {
  return ({
    full: '完整文档',
    questions: '原卷',
    solutions: '答案解析',
  } as Record<string, string>)[role || ''] || ''
}

function reviewTabFromQuery(value: string | null): 'all' | 'ready' | 'warning' | 'error' {
  return value === 'ready' || value === 'warning' || value === 'error' ? value : 'all'
}

export default function ImportV2Page() {
  const navigate = useNavigate()
  const location = useLocation()
  const { sourceDocumentId: sourceDocumentIdFromPath, candidateId: candidateIdFromPath } = useParams<{ sourceDocumentId: string; candidateId: string }>()
  const [searchParams] = useSearchParams()
  const sourceDocumentIdFromQuery = searchParams.get('sourceDocumentId') || ''
  const importJobIdFromQuery = searchParams.get('importJobId') || ''
  const isCandidatesRoute = Boolean(sourceDocumentIdFromPath && location.pathname.includes('/candidates'))
  const routeSyncKey = `${sourceDocumentIdFromPath || ''}:${candidateIdFromPath || ''}:${isCandidatesRoute ? 'candidates' : 'document'}`

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
  const [activeImportJobDocuments, setActiveImportJobDocuments] = useState<ImportV2ImportJobDocument[]>([])

  const [uploading, setUploading] = useState(false)
  const [runningSourceDocumentId, setRunningSourceDocumentId] = useState('')
  const [sourceOcrErrors, setSourceOcrErrors] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState<'all' | 'ready' | 'warning' | 'error'>(() => reviewTabFromQuery(searchParams.get('tab')))
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

  const selectedImportJobDocument = useMemo(() => {
    if (!selectedDoc) return null
    return activeImportJobDocuments.find((item) => item.sourceDocumentId === selectedDoc.id) || null
  }, [activeImportJobDocuments, selectedDoc?.id])

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

  const selectedDocIsImportJobQuestion = activeImportJob?.mode === 'separated_documents' && selectedImportJobDocument?.role === 'questions'
  const selectedDocIsImportJobSolution = activeImportJob?.mode === 'separated_documents' && selectedImportJobDocument?.role === 'solutions'
  const activeImportJobSolutionReady = !activeImportJobSolutionSource || ['ocr_succeeded', 'parsed', 'partially_parsed'].includes(activeImportJobSolutionSource.status)

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

  function documentUrl(sourceDocumentId: string) {
    return `/tools/import/documents/${encodeURIComponent(sourceDocumentId)}`
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
    navigate(documentUrl(sourceDocumentId), { replace: options?.replace })
  }

  function navigateToCandidates(sourceDocumentId: string, options?: { replace?: boolean }) {
    navigate(candidatesUrl(sourceDocumentId), { replace: options?.replace })
  }

  function navigateToCandidate(sourceDocumentId: string, candidateId: string, options?: { replace?: boolean }) {
    navigate(candidateUrl(sourceDocumentId, candidateId), { replace: options?.replace })
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
    if (!importJobIdFromQuery) return undefined
    let active = true
    importV2Api.getImportJob(importJobIdFromQuery)
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
  }, [importJobIdFromQuery])

  // 兼容旧链接：/tools/import?sourceDocumentId=xxx
  useEffect(() => {
    if (sourceDocumentIdFromQuery && !sourceDocumentIdFromPath) {
      navigateToDocument(sourceDocumentIdFromQuery, { replace: true })
    }
  }, [sourceDocumentIdFromPath, sourceDocumentIdFromQuery])

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
    if (!runningSourceDocumentId) return undefined
    let active = true
    const poll = async () => {
      try {
        const result = await importV2Api.getSourceDocumentOcrStatus(runningSourceDocumentId)
        if (!active) return
        setSourceDocuments((items) => items.map((item) => item.id === result.sourceDocument.id ? result.sourceDocument : item))
        if (result.task.status === 'ocr_succeeded') {
          await loadLists()
          if (!active) return
          if (result.ocrDocument) setSelectedOcrId(result.ocrDocument.id)
          setRunningSourceDocumentId('')
          showNotice('识别完成。请在右侧点击“生成待确认题目”继续。')
        } else if (result.task.status === 'ocr_failed') {
          setRunningSourceDocumentId('')
          const message = result.task.error || 'OCR 识别失败。'
          setSourceOcrErrors((current) => ({ ...current, [runningSourceDocumentId]: message }))
          setError(message)
        }
      } catch (err) {
        if (!active) return
        setRunningSourceDocumentId('')
        setError(err instanceof Error ? err.message : String(err))
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 3000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [runningSourceDocumentId])

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
      await loadLists()
      setSelectedSourceDocId(res.sourceDocument.id)
      setPendingUploadFile(null)
      setActiveImportJob(null)
      setActiveImportJobDocuments([])
      navigateToDocument(res.sourceDocument.id)
      showNotice('资料已保存，可启动 GLM-OCR 识别。')
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
      navigate(`${documentUrl(questionRes.sourceDocument.id)}?importJobId=${encodeURIComponent(jobRes.importJob.id)}`)
      showNotice('双文档导入任务已创建。请分别完成原卷和答案解析的 OCR 识别。')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
      if (questionFileInputRef.current) questionFileInputRef.current.value = ''
      if (solutionFileInputRef.current) solutionFileInputRef.current.value = ''
    }
  }

  async function startGlmOcr(sourceDocumentId: string) {
    setBusy(`ocr-${sourceDocumentId}`)
    setError('')
    setSourceOcrErrors((current) => {
      const next = { ...current }
      delete next[sourceDocumentId]
      return next
    })
    try {
      await importV2Api.startSourceDocumentOcr(sourceDocumentId)
      await loadLists()
      setRunningSourceDocumentId(sourceDocumentId)
      showNotice('GLM-OCR 已启动，正在识别资料。')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  async function handleGenerateCandidates(item: ImportV2SourceDocument) {
    setBusy(`action-${item.id}`)
    setError('')
    try {
      const jobDocument = activeImportJobDocuments.find((document) => document.sourceDocumentId === item.id)
      const shouldParseImportJob = activeImportJob?.mode === 'separated_documents' && jobDocument?.role === 'questions'
      let result: ParseCandidatesResult & { importJob?: ImportV2ImportJob }
      if (shouldParseImportJob) {
        if (!activeImportJobSolutionReady) {
          throw new Error('答案解析文档尚未完成 OCR 识别，请先识别答案解析文档。')
        }
        result = await importV2Api.parseImportJobCandidates(activeImportJob.id)
      } else if (activeImportJob?.mode === 'separated_documents' && jobDocument?.role === 'solutions') {
        throw new Error('答案解析文档只用于合并解析，请切换到原卷文档生成待确认题目。')
      } else {
        const ocrRes = await importV2Api.listOcrDocuments(item.id)
        const ocrDoc = ocrRes.items[0]
        if (!ocrDoc) {
          throw new Error('未找到该资料对应的 OCR 结果文件。')
        }
        setSelectedOcrId(ocrDoc.id)
        result = await importV2Api.parseCandidates(ocrDoc.id)
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

  async function handleSaveSourceMetadata() {
    if (!selectedDoc) return
    setBusy(`metadata-${selectedDoc.id}`)
    setError('')
    try {
      const res = await importV2Api.updateSourceDocument(selectedDoc.id, metadataPayload(metadataDraft))
      setSourceDocuments((items) => items.map((item) => item.id === selectedDoc.id ? res.sourceDocument : item))
      showNotice('资料信息已保存。')
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
      const result = await importV2Api.parseCandidates(selectedOcrId)
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

  // 7. 多选/批量确认存入题库
  async function handleBulkConfirm() {
    if (selectedIds.size === 0) return
    const idsArray = Array.from(selectedIds)
    setBusy('bulk-confirm')
    setError('')
    try {
      const results = await Promise.all(idsArray.map(id => importV2Api.commitCandidate(id)))
      const committedById = new Map(results.map((result) => [result.candidate.id, fromCandidate(result.candidate)]))
      setQuestions((items) => items.map((item) => committedById.get(item.id) || item))
      showNotice(`批量确认完成：成功入库 ${idsArray.length} 题。`)

      setCommittedIds((prev) => {
        const next = new Set(prev)
        idsArray.forEach(id => next.add(id))
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

  const filteredQuestions = useMemo(() => {
    return questions.filter(q => {
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
  }, [questions, activeTab])

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
      <PageTitle
        title="资料导入"
        desc="上传试卷或讲义，系统会自动识别题目。请核对题干、答案、解析和题图后再入库。"
        path="/tools/import"
      />

      {/* 明确提示文案 */}
      <div className="rounded-lg border border-amber-200 bg-amber-50/20 p-3.5 text-xs text-amber-800 dark:border-amber-900/30 dark:bg-amber-95/10 dark:text-amber-400 flex items-center gap-2.5 shadow-sm animate-in fade-in duration-200">
        <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <span>资料导入不会直接进入题库。请核对后点击确认入库。</span>
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

      {/* 第一步：上传与识别 */}
      {activeStepTab === 'upload' && (
        <div className="grid gap-6 lg:grid-cols-12 items-start">
          {/* 左栏：上传与列表 */}
          <div className="lg:col-span-4 space-y-4 flex flex-col">
            {/* 上传卡片 */}
            <Panel title="上传新资料">
              <div className="space-y-3">
                <div className="grid grid-cols-2 rounded-lg border border-zinc-200 bg-zinc-100/70 p-0.5 dark:border-zinc-800 dark:bg-zinc-900/70">
                  <button
                    type="button"
                    onClick={() => {
                      setUploadDocumentMode('single_document')
                      setQuestionUploadFile(null)
                      setSolutionUploadFile(null)
                    }}
                    className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-all ${
                      uploadDocumentMode === 'single_document'
                        ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-950 dark:text-zinc-50'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    <FileText className="size-3.5" />
                    单文档
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadDocumentMode('separated_documents')
                      setPendingUploadFile(null)
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    }}
                    className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-all ${
                      uploadDocumentMode === 'separated_documents'
                        ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-950 dark:text-zinc-50'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    <Layers className="size-3.5" />
                    双文档
                  </button>
                </div>

                {uploadDocumentMode === 'single_document' ? (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragOver(false)
                      if (e.dataTransfer.files) {
                        handleUploadFileSelection(e.dataTransfer.files)
                      }
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center ${
                      dragOver
                        ? 'border-zinc-900 bg-zinc-50/30 dark:border-zinc-100 dark:bg-zinc-900/30'
                        : 'border-zinc-200 bg-white hover:bg-zinc-50/10 dark:border-zinc-800 dark:bg-zinc-955'
                    }`}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      accept="application/json,.json,application/pdf,.pdf,image/png,image/jpeg,image/jpg"
                      onChange={(e) => {
                        if (e.target.files) {
                          handleUploadFileSelection(e.target.files)
                        }
                      }}
                    />
                    {uploading ? (
                      <LoaderCircle className="size-7 animate-spin text-zinc-500 mb-2" />
                    ) : (
                      <Upload className="size-7 text-zinc-400 dark:text-zinc-500 mb-2" />
                    )}
                    <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                      {uploading ? '文件保存中...' : pendingUploadFile ? pendingUploadFile.name : '点击选择或拖拽资料至此处'}
                    </p>
                    <p className="text-[10px] text-zinc-400 mt-1">
                      {pendingUploadFile ? '已选择文件，填写资料信息后开始上传' : '支持 PDF、PNG/JPG'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input
                      type="file"
                      ref={questionFileInputRef}
                      className="hidden"
                      accept="application/pdf,.pdf,image/png,image/jpeg,image/jpg"
                      onChange={(event) => handleSeparatedFileSelection('questions', event.target.files)}
                    />
                    <input
                      type="file"
                      ref={solutionFileInputRef}
                      className="hidden"
                      accept="application/pdf,.pdf,image/png,image/jpeg,image/jpg"
                      onChange={(event) => handleSeparatedFileSelection('solutions', event.target.files)}
                    />
                    <button
                      type="button"
                      onClick={() => questionFileInputRef.current?.click()}
                      className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-left transition-colors hover:bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-955 dark:hover:bg-zinc-900/40"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                        <FileText className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-zinc-900 dark:text-zinc-50">原卷文件</span>
                        <span className="block truncate text-[10px] text-zinc-400">{questionUploadFile?.name || '题干文档、学生版或原卷 PDF/图片'}</span>
                      </span>
                      {questionUploadFile ? (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation()
                            setQuestionUploadFile(null)
                            if (questionFileInputRef.current) questionFileInputRef.current.value = ''
                          }}
                          className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-900"
                          title="清除原卷文件"
                        >
                          <Trash2 className="size-3.5" />
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => solutionFileInputRef.current?.click()}
                      className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-left transition-colors hover:bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-955 dark:hover:bg-zinc-900/40"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                        <FileCheck2 className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-zinc-900 dark:text-zinc-50">答案解析文件</span>
                        <span className="block truncate text-[10px] text-zinc-400">{solutionUploadFile?.name || '答案、详解或教师版 PDF/图片'}</span>
                      </span>
                      {solutionUploadFile ? (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation()
                            setSolutionUploadFile(null)
                            if (solutionFileInputRef.current) solutionFileInputRef.current.value = ''
                          }}
                          className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-900"
                          title="清除答案解析文件"
                        >
                          <Trash2 className="size-3.5" />
                        </span>
                      ) : null}
                    </button>
                  </div>
                )}
              </div>
            </Panel>

            <Panel
              title="资料信息"
              actions={selectedDoc ? (
                <button
                  type="button"
                  onClick={() => setShowMetadataEditor((value) => !value)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
                >
                  <PencilLine className="size-3.5" />
                  {showMetadataEditor ? '收起' : '编辑'}
                </button>
              ) : null}
            >
              {selectedDoc && !showMetadataEditor ? (
                <div className="space-y-2 text-[11px] text-zinc-500">
                  <div className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                    {selectedDoc.paperTitle || selectedDoc.title || selectedDoc.originalFileName || '未命名资料'}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline">{paperKindOptions.find((item) => item.value === selectedDoc.paperKind)?.label || '未分类'}</Badge>
                    <Badge variant="outline">{selectedDoc.stage || '高三'}</Badge>
                    <Badge variant="outline">{selectedDoc.subject || '数学'}</Badge>
                  </div>
                  <div className="truncate">
                    {[selectedDoc.province, selectedDoc.city, selectedDoc.examYear || '', selectedDoc.sourceOrg].filter(Boolean).join(' · ') || '未填写地区、年份和来源机构'}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[10px] font-medium text-zinc-500">试卷名称</span>
                      <input className="h-8 w-full rounded-md border border-zinc-200 bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800" value={metadataDraft.paperTitle} onChange={(event) => setMetadataDraft((draft) => ({ ...draft, paperTitle: event.target.value }))} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-medium text-zinc-500">批次名称</span>
                      <input className="h-8 w-full rounded-md border border-zinc-200 bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800" value={metadataDraft.batchName} onChange={(event) => setMetadataDraft((draft) => ({ ...draft, batchName: event.target.value }))} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-medium text-zinc-500">学段/年级</span>
                      <select
                        className="h-8 w-full rounded-md border border-zinc-200 bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                        value={selectedStage}
                        onChange={(event) => setMetadataDraft((draft) => ({ ...draft, stage: event.target.value }))}
                      >
                        {stageOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-medium text-zinc-500">学科</span>
                      <select
                        className="h-8 w-full rounded-md border border-zinc-200 bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                        value={metadataSubject}
                        onChange={(event) => setMetadataDraft((draft) => ({ ...draft, subject: event.target.value }))}
                      >
                        {visibleSubjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-medium text-zinc-500">资料类型</span>
                      <select
                        className="h-8 w-full rounded-md border border-zinc-200 bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
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
                    <label className="space-y-1">
                      <span className="text-[10px] font-medium text-zinc-500">年份</span>
                      <input type="number" min="0" className="h-8 w-full rounded-md border border-zinc-200 bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800" value={metadataDraft.examYear} onChange={(event) => setMetadataDraft((draft) => ({ ...draft, examYear: event.target.value }))} />
                    </label>
                    {metadataDraft.paperKind === 'gaokao_real' ? (
                      <label className="col-span-2 space-y-1">
                        <span className="text-[10px] font-medium text-zinc-500">试卷适用地区</span>
                        <select
                          className="h-8 w-full rounded-md border border-zinc-200 bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                          value={isGaokaoRegion(metadataDraft.province) ? metadataDraft.province : ''}
                          onChange={(event) => setMetadataDraft((draft) => ({ ...draft, province: event.target.value, city: '', sourceOrg: '' }))}
                        >
                          <option value="">请选择全国卷或直辖市</option>
                          {gaokaoRegionOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select>
                        {gaokaoRegionOptions.find((item) => item.value === metadataDraft.province)?.provinces ? (
                          <p className="text-[10px] leading-4 text-zinc-400">
                            {gaokaoRegionOptions.find((item) => item.value === metadataDraft.province)?.provinces}
                          </p>
                        ) : null}
                      </label>
                    ) : (
                      <>
                        <label className="space-y-1">
                          <span className="text-[10px] font-medium text-zinc-500">省份</span>
                          <input className="h-8 w-full rounded-md border border-zinc-200 bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800" value={metadataDraft.province} onChange={(event) => setMetadataDraft((draft) => ({ ...draft, province: event.target.value }))} />
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10px] font-medium text-zinc-500">城市</span>
                          <input className="h-8 w-full rounded-md border border-zinc-200 bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800" value={metadataDraft.city} onChange={(event) => setMetadataDraft((draft) => ({ ...draft, city: event.target.value }))} />
                        </label>
                        <label className="col-span-2 space-y-1">
                          <span className="text-[10px] font-medium text-zinc-500">来源机构</span>
                          <input className="h-8 w-full rounded-md border border-zinc-200 bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800" value={metadataDraft.sourceOrg} onChange={(event) => setMetadataDraft((draft) => ({ ...draft, sourceOrg: event.target.value }))} />
                        </label>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedDoc ? (
                      <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={handleSaveSourceMetadata}>
                        {busy === `metadata-${selectedDoc.id}` ? '保存中...' : '保存资料信息'}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      disabled={uploading || Boolean(busy) || (uploadDocumentMode === 'single_document' ? !pendingUploadFile : !questionUploadFile || !solutionUploadFile)}
                      onClick={uploadDocumentMode === 'single_document' ? handleStartUpload : handleStartSeparatedUpload}
                    >
                      {uploading ? '上传中...' : uploadDocumentMode === 'single_document' ? '开始上传' : '创建双文档任务'}
                    </Button>
                  </div>
                </div>
              )}
            </Panel>

            {/* 资料列表 */}
            <Panel title="资料列表">
              <div className="space-y-2.5 max-h-[450px] overflow-y-auto pr-1">
                {sourceDocuments.filter((item) => item.fileType === 'pdf' || item.fileType === 'image').length === 0 ? (
                  <Empty text="暂无资料，请先上传" />
                ) : (
                  sourceDocuments.filter((item) => item.fileType === 'pdf' || item.fileType === 'image').map((item) => {
                    const statusInfo = getDocStatus(item)
                    const isSelected = selectedDoc?.id === item.id
                    const importJobDocument = activeImportJobDocuments.find((document) => document.sourceDocumentId === item.id)
                    
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
                            {importJobDocument ? (
                              <Badge variant={importJobDocument.role === 'solutions' ? 'warning' : 'outline'}>{importJobDocumentRoleLabel(importJobDocument.role)}</Badge>
                            ) : null}
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

                  {/* 核心操作区域 */}
                  <div className="bg-white dark:bg-zinc-955 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs space-y-4">
                    {/* uploaded */}
                    {selectedDoc.status === 'uploaded' && (
                      <div className="space-y-4">
                        <p className="text-xs text-zinc-500 leading-relaxed">
                          资料已成功保存。点击“开始自动识别”将通过 GLM-OCR 自动提取试卷题目、公式及插图。
                        </p>
                        <Button
                          size="default"
                          icon={Play}
                          disabled={Boolean(busy)}
                          onClick={() => startGlmOcr(selectedDoc.id)}
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
                          onClick={() => startGlmOcr(selectedDoc.id)}
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
                              <Button
                                size="default"
                                icon={FileText}
                                variant="outline"
                                onClick={() => navigateToDocument(activeImportJobQuestionSource.id)}
                                className="w-full sm:w-auto"
                              >
                                切换到原卷
                              </Button>
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
                            <Button
                              size="default"
                              icon={Play}
                              disabled={Boolean(busy) || (selectedDocIsImportJobQuestion && !activeImportJobSolutionReady)}
                              onClick={() => handleGenerateCandidates(selectedDoc)}
                              className="w-full sm:w-auto"
                            >
                              {busy === `action-${selectedDoc.id}` ? '生成中...' : selectedDocIsImportJobQuestion ? '合并生成待确认题目' : '生成待确认题目'}
                            </Button>
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
                          onClick={() => navigate(`/tools/pdf-slicer/runs/${encodeURIComponent(`ifv2:${selectedDoc.id}`)}/questions`)}
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
        <div ref={checkAreaRef} className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-12rem)] min-h-[700px] items-stretch">
          {/* 左侧：题目列表卡片栏 (35% 宽度) */}
          <div className="w-full lg:w-[35%] shrink-0 flex flex-col border rounded-xl bg-white dark:bg-zinc-955 overflow-hidden shadow-sm">
            {/* 分类过滤器 */}
            <div className="border-b border-zinc-100 bg-zinc-50/50 dark:border-zinc-900 dark:bg-zinc-900/10 p-2 flex flex-wrap gap-1">
              {[
                { key: 'all', label: '全部', count: questions.length },
                { key: 'ready', label: '可以入库', count: questions.filter(q => q.status === 'ready' && q.issues.length === 0).length },
                { key: 'warning', label: '建议核对', count: questions.filter(q => q.issues.some(iss => iss.severity === 'warning') || q.similarQuestions && q.similarQuestions.length > 0).length },
                { key: 'error', label: '需要修正', count: questions.filter(q => q.status === 'blocked' || q.status === 'needs_manual_fix' || q.issues.some(iss => iss.severity === 'error')).length },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setReviewTab(tab.key as 'all' | 'ready' | 'warning' | 'error')}
                  className={`inline-flex items-center justify-center px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                    activeTab === tab.key
                      ? 'bg-zinc-900 text-zinc-55 dark:bg-zinc-50 dark:text-zinc-950 font-semibold shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                  }`}
                >
                  {tab.label}
                  <span className={`ml-1 px-1 rounded-sm text-[9px] ${
                    activeTab === tab.key
                      ? 'bg-zinc-800 text-zinc-400 dark:bg-zinc-200 dark:text-zinc-700'
                      : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

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
                      className={`flex items-start gap-3 rounded-lg border p-3 transition-all cursor-pointer shadow-sm relative overflow-hidden ${
                        isActive
                          ? 'border-zinc-950 bg-zinc-50/40 dark:border-zinc-50 dark:bg-zinc-900/40'
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
                            <li key={idx} className="leading-relaxed">{issueLabel(issue.code) ? <span className="font-semibold">【{issueLabel(issue.code)}】</span> : null}{issue.message}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* 题干排版预览 */}
                  <section className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 border-b pb-1 dark:border-zinc-800">
                      <Layers className="size-3.5 text-zinc-400" />
                      <span>题干内容</span>
                    </div>
                    <div className="bg-zinc-50/30 dark:bg-zinc-900/5 p-4 rounded-lg border border-zinc-100 dark:border-zinc-900 min-h-16 leading-relaxed">
                      <QuestionMarkdownContent content={activeQuestion.stemMarkdown || '（空）'} figures={activeQuestion.figures} className="text-sm font-normal" />
                    </div>
                  </section>

                  {/* 自动识别答案 */}
                  <section className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 border-b pb-1 dark:border-zinc-800">
                      <CheckCircle2 className="size-3.5 text-zinc-400" />
                      <span>自动识别答案</span>
                    </div>
                    <div className="bg-zinc-50/30 dark:bg-zinc-900/5 p-4 rounded-lg border border-zinc-100 dark:border-zinc-900 min-h-12 leading-relaxed">
                      <MarkdownWithInlineFigures content={activeQuestion.answerText || '（无）'} figures={activeQuestion.figures} className="text-sm font-normal" />
                    </div>
                  </section>

                  {/* 自动解析步骤 */}
                  <section className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 border-b pb-1 dark:border-zinc-800">
                      <Compass className="size-3.5 text-zinc-400" />
                      <span>自动解析步骤</span>
                    </div>
                    <div className="bg-zinc-50/30 dark:bg-zinc-900/5 p-4 rounded-lg border border-zinc-100 dark:border-zinc-900 min-h-12 leading-relaxed">
                      <MarkdownWithInlineFigures content={activeQuestion.analysisMarkdown || '（无）'} figures={activeQuestion.figures} className="text-sm font-normal" />
                    </div>
                  </section>
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
        <div className="sticky bottom-0 z-50 w-full border border-zinc-200 bg-white/80 py-4 px-6 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80 flex items-center justify-between shadow-[0_-4px_20px_rgba(0,0,0,0.03)] rounded-xl mt-4">
          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            已勾选 {selectedIds.size} 道题目，可一键批量确认存库。
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" icon={CheckCircle2} disabled={Boolean(busy)} onClick={handleBulkConfirm}>
              确认入库这 {selectedIds.size} 题
            </Button>
            <Button size="sm" variant="outline" icon={SkipForward} disabled={Boolean(busy)} onClick={handleBulkSkip}>
              跳过所选
            </Button>
          </div>
        </div>
      )}

    </div>
  )
}

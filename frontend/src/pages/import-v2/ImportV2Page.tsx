import { useEffect, useMemo, useState, useRef, type ChangeEvent } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BadgeAlert,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  Crop,
  Database,
  Edit3,
  FileJson,
  FileText,
  ImageIcon,
  Inbox,
  Layers,
  LoaderCircle,
  Play,
  RefreshCcw,
  SkipForward,
  Sparkles,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { importV2Api, type ImportV2Candidate, type ImportV2OcrDocument, type ImportV2SourceDocument } from '@/api/importV2'
import { ocrApi } from '@/api/ocr'
import { pdfSlicerApi } from '@/api/pdfSlicer'
import { pendingBankApi } from '@/api/pendingBank'
import { questionBankApi } from '@/api/questionBank'
import { settingsApi } from '@/api/settings'
import { MarkdownContent } from '@/components/MarkdownContent'
import { PageTitle, Panel, Badge, Button, Empty } from '@/components/ui'
import { EditDialog } from '@/components/questions/EditDialog'
import { FigureCropDialog } from '@/components/questions/FigureDialogs'
import type { ApiRun, QuestionItem, QuestionFigure } from '@/types'
import { assetUrl } from '@/utils/questionDisplay'

// ── 统一数据适配层 (Unified Model Adapter) ─────────────────────────────

type UnifiedQuestion = {
  id: string
  questionNo: string
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  status: 'ready' | 'needs_review' | 'needs_manual_fix' | 'blocked' | 'banked' | 'skipped'
  issues: Array<{ severity: 'warning' | 'error'; message: string; code?: string }>
  figures: Array<{ id: string; usage: string; path: string; pageNo?: number; bbox?: any }>
  hasFigures: boolean
  similarQuestions?: any[]
  isOcrRun: boolean
  rawItem: any
}

function fromCandidate(c: ImportV2Candidate): UnifiedQuestion {
  return {
    id: c.id,
    questionNo: c.questionNo || '',
    stemMarkdown: c.stemMarkdown || '',
    answerText: c.answerText || '',
    analysisMarkdown: c.analysisMarkdown || '',
    status: c.status === 'ready' ? 'ready' : c.status === 'blocked' ? 'blocked' : 'needs_review',
    issues: (c.issues || []).map(iss => ({ severity: iss.severity, message: iss.message, code: iss.code })),
    figures: (c.figures || []).map(fig => ({ id: fig.id, usage: fig.usage, path: fig.path, pageNo: fig.pageNo })),
    hasFigures: (c.figures || []).length > 0,
    isOcrRun: false,
    rawItem: c
  }
}

function fromQuestionItem(q: QuestionItem): UnifiedQuestion {
  let status: UnifiedQuestion['status'] = 'ready'
  if (q.bankStatus === 'banked') status = 'banked'
  else if (q.bankStatus === 'skipped') status = 'skipped'
  else if (q.bankStatus === 'blocked') status = 'needs_manual_fix'

  const issues: UnifiedQuestion['issues'] = []
  if (q.formatIssue) {
    issues.push({
      severity: q.formatIssue.code === 'inline_image_reference_mismatch' ? 'error' : 'warning',
      message: q.formatIssue.message || '',
      code: q.formatIssue.code
    })
  }

  return {
    id: q.id,
    questionNo: q.questionNo || '',
    stemMarkdown: q.stemMarkdown || '',
    answerText: q.answerText || '',
    analysisMarkdown: q.analysisMarkdown || '',
    status,
    issues,
    figures: (q.figures || []).map(fig => ({ id: fig.id || '', usage: fig.usage || 'stem', path: fig.path || '', pageNo: fig.pageNumber, bbox: fig.bbox })),
    hasFigures: q.hasFigures || (q.figures || []).length > 0,
    similarQuestions: q.similarQuestions,
    isOcrRun: true,
    rawItem: q
  }
}

// ── 步骤与进度辅助 (Step Mapping Helper) ───────────────────────────────

function getFriendlyProgressStage(run: ApiRun | undefined) {
  if (!run) return { step: 1, text: '等待上传试卷...' }
  const status = run.ocrStatus
  const percent = run.progressPercent || 0

  if (status === 'starting' || status === 'preupload') {
    return { step: 1, text: '正在准备试卷传输通道...' }
  }
  if (status === 'uploading') {
    return { step: 1, text: '正在上传试卷文件至云端服务器...' }
  }
  if (status === 'parsing') {
    return { step: 2, text: `AI 正在逐页转译文字和公式符号... (${percent}%)` }
  }
  if (status === 'normalizing' || status === 'downloading_assets') {
    return { step: 3, text: '正在进行版面智能重排并分割试题范围...' }
  }
  if (status === 'importing') {
    return { step: 4, text: '智能题号校验，正在生成待确认题目...' }
  }
  if (status === 'succeeded') {
    return { step: 4, text: '试题智能提取已完成！请在下方核对。' }
  }
  if (status === 'failed') {
    return { step: 4, text: `解析失败：${run.ocrError || '请联系管理员或尝试重跑。'}` }
  }
  return { step: 2, text: 'AI 识别处理中...' }
}

export default function ImportV2Page() {
  const [sourceDocuments, setSourceDocuments] = useState<ImportV2SourceDocument[]>([])
  const [ocrDocuments, setOcrDocuments] = useState<ImportV2OcrDocument[]>([])
  const [selectedOcrId, setSelectedOcrId] = useState('')
  const [questions, setQuestions] = useState<UnifiedQuestion[]>([])
  const [committedIds, setCommittedIds] = useState<Set<string>>(new Set())

  // UI 交互状态
  const [ocrProvider, setOcrProvider] = useState<'glm' | 'doc2x'>('glm')
  const [uploading, setUploading] = useState(false)
  const [runningRunId, setRunningRunId] = useState('')
  const [ocrProgress, setOcrProgress] = useState<ApiRun | undefined>(undefined)
  const [isJSONMode, setIsJSONMode] = useState(false)
  const [activeTab, setActiveTab] = useState<'all' | 'ready' | 'warning' | 'error'>('all')
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // 编辑与裁剪弹窗
  const [editingItem, setEditingItem] = useState<any | null>(null)
  const [editingDraft, setEditingDraft] = useState<any>({})
  const [croppingItem, setCroppingItem] = useState<QuestionItem | null>(null)

  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  // JSON 模式下的已选择 OCR
  const selectedOcr = useMemo(() => ocrDocuments.find((item) => item.id === selectedOcrId) || null, [ocrDocuments, selectedOcrId])

  async function loadLists() {
    const [sourceResult, ocrResult] = await Promise.all([
      importV2Api.listSourceDocuments(),
      importV2Api.listOcrDocuments(),
    ])
    setSourceDocuments(sourceResult.items)
    setOcrDocuments(ocrResult.items)
    if (!selectedOcrId && ocrResult.items[0]) setSelectedOcrId(ocrResult.items[0].id)
  }

  useEffect(() => {
    loadLists().catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  // 轮询 OCR 识别进度
  useEffect(() => {
    if (!runningRunId) return undefined

    const fetchProgress = async () => {
      try {
        const progressRes = await ocrApi.getOcrProgress(runningRunId)
        setOcrProgress(progressRes.run)
        
        const status = progressRes.run.ocrStatus
        if (status === 'succeeded') {
          // 识别成功，重置轮询并加载题目
          setRunningRunId('')
          showNotice('文件解析成功！已自动分割出题目。')
          await loadOcrQuestions(runningRunId)
        } else if (status === 'failed' || status === 'interrupted') {
          setRunningRunId('')
          setError(`识别出错：${progressRes.run.ocrError || '任务已被中断。'}`)
        }
      } catch (err) {
        setRunningRunId('')
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    // 立即执行一次，随后每隔 3.5 秒轮询
    fetchProgress()
    const timer = window.setInterval(fetchProgress, 3500)
    return () => window.clearInterval(timer)
  }, [runningRunId])

  // 清除通知和错误
  function showNotice(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3000)
  }

  // 1. 上传真实试卷 PDF/图片 并自动启动 OCR 识别
  async function handlePdfUpload(files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]

    // 如果是 JSON 文件，则自动转换到高级 JSON 模拟模式
    if (file.name.endsWith('.json')) {
      setIsJSONMode(true)
      await handleJsonFile(file)
      return
    }

    setUploading(true)
    setError('')
    setNotice('')
    setQuestions([])
    setActiveQuestionId(null)
    setSelectedIds(new Set())

    try {
      const form = new FormData()
      form.append('files', file)
      form.append('materialType', 'exam') // 默认为试卷
      form.append('fileRole', 'full') // 默认为一体解析版

      // 上传文件
      const uploadRes = await pdfSlicerApi.upload(form) as { manualAnnotationBatchId?: string; runId?: string }
      const runId = uploadRes.runId || uploadRes.manualAnnotationBatchId || ''
      if (!runId) {
        throw new Error('上传失败，未能获取批次任务 ID。')
      }

      // 设置分类 (隐藏了切题流程，默认一体化试卷)
      await pdfSlicerApi.updateRunClassification(runId, { materialType: 'exam', fileRole: 'full' })

      // 把在 UI 选择的 OCR Provider 写入系统设置，然后再启动 OCR
      await Promise.all([
        settingsApi.updateSettings({ ocrProvider }),
        settingsApi.updateOcrSettings({ ocrProvider })
      ])

      // 启动 OCR 运行
      await ocrApi.startOcr(runId)
      setRunningRunId(runId)
      showNotice('文件已成功上传，自动识别提取已启动...')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  // 2. 加载普通 PDF/图片 OCR 成功后的题目列表
  async function loadOcrQuestions(runId: string) {
    setBusy('load-questions')
    try {
      const res = await pendingBankApi.getPendingBank(runId)
      const unified = (res.items || []).map(fromQuestionItem)
      setQuestions(unified)
      if (unified.length > 0) {
        setActiveQuestionId(unified[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  // 3. 处理本地模拟 JSON 文件导入
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
      setCommittedIds(new Set())
      if (unified.length > 0) {
        setActiveQuestionId(unified[0].id)
      }
      await loadLists()
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
      if (unified.length > 0) {
        setActiveQuestionId(unified[0].id)
      }
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
      if (q.isOcrRun) {
        // 普通 OCR
        const runId = q.rawItem.sourceRunId
        await pendingBankApi.bulkConfirm(runId, { questionIds: [q.id] })
      } else {
        // JSON 模拟
        await importV2Api.commitCandidate(q.id)
      }
      setCommittedIds((prev) => new Set([...prev, q.id]))
      showNotice('该题目已成功确认入库')
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
      const firstQ = questions.find(q => q.id === idsArray[0])
      if (!firstQ) return

      if (firstQ.isOcrRun) {
        const runId = firstQ.rawItem.sourceRunId
        const result = await pendingBankApi.bulkConfirm(runId, { questionIds: idsArray })
        showNotice(`批量确认完成：成功入库 ${result.success} 题。`)
      } else {
        // JSON 模拟下循环单题入库
        await Promise.all(idsArray.map(id => importV2Api.commitCandidate(id)))
        showNotice(`批量确认完成：成功入库 ${idsArray.length} 题。`)
      }

      setCommittedIds((prev) => {
        const next = new Set(prev)
        idsArray.forEach(id => next.add(id))
        return next
      })
      setSelectedIds(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  // 8. 批量跳过/删除操作 (仅 OCR Run 模式下原生支持，JSON 模式只在界面移除)
  async function handleBulkSkip() {
    if (selectedIds.size === 0) return
    const idsArray = Array.from(selectedIds)
    setBusy('bulk-skip')
    try {
      const firstQ = questions.find(q => q.id === idsArray[0])
      if (firstQ && firstQ.isOcrRun) {
        const runId = firstQ.rawItem.sourceRunId
        await pendingBankApi.bulkSkip(runId, { questionIds: idsArray })
      }
      // 界面标记为已跳过
      setCommittedIds((prev) => {
        const next = new Set(prev)
        idsArray.forEach(id => next.add(id))
        return next
      })
      setSelectedIds(new Set())
      showNotice('已跳过选中的题目')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  // 9. 打开内容编辑弹窗 (修正范围)
  function openEditor(q: UnifiedQuestion) {
    setEditingItem(q.rawItem)
    setEditingDraft(q.rawItem)
  }

  // 10. 保存修改内容
  async function saveEditedQuestion() {
    if (!editingItem || !activeQuestion) return
    setBusy('save-edit')
    try {
      if (activeQuestion.isOcrRun) {
        const saved = await questionBankApi.updateItem(editingItem.id, editingDraft)
        const nextUnified = fromQuestionItem(saved)
        setQuestions(prev => prev.map(q => q.id === editingItem.id ? nextUnified : q))
      } else {
        const result = await importV2Api.updateCandidate(editingItem.id, editingDraft)
        const nextUnified = fromCandidate(result.candidate)
        setQuestions(prev => prev.map(q => q.id === editingItem.id ? nextUnified : q))
      }
      setEditingItem(null)
      setEditingDraft({})
      showNotice('试题内容修改已保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  // 11. 手动框选截取题图 (FigureCropDialog 实现在大图上框选)
  async function handleCropSave(payload: { usage: string; optionLabel?: string; bbox: Record<string, number>; sourcePath?: string }) {
    if (!activeQuestion) throw new Error('没有选中的活动题目。')
    const figure = await questionBankApi.createFigure(activeQuestion.id, { ...payload, pageNumber: 1 })
    
    // 局部同步更新本地 UnifiedQuestion figures 状态，带给用户零迟延响应
    const raw = { ...activeQuestion.rawItem }
    raw.figures = [...(raw.figures || []), figure]
    raw.hasFigures = true
    const nextUnified = fromQuestionItem(raw)
    setQuestions(prev => prev.map(q => q.id === activeQuestion.id ? nextUnified : q))
    return figure
  }

  async function handleCropUpdate(figureId: string, payload: { usage: string; optionLabel?: string; bbox: Record<string, number>; sourcePath?: string }) {
    if (!activeQuestion) throw new Error('没有选中的活动题目。')
    const figure = await questionBankApi.updateFigure(activeQuestion.id, figureId, { ...payload, pageNumber: 1 })
    
    const raw = { ...activeQuestion.rawItem }
    raw.figures = (raw.figures || []).map((f: any) => f.id === figureId ? figure : f)
    const nextUnified = fromQuestionItem(raw)
    setQuestions(prev => prev.map(q => q.id === activeQuestion.id ? nextUnified : q))
    return figure
  }

  async function handleCropDelete(figureId: string) {
    if (!activeQuestion) return
    await questionBankApi.deleteFigure(activeQuestion.id, figureId)
    
    const raw = { ...activeQuestion.rawItem }
    raw.figures = (raw.figures || []).filter((f: any) => f.id !== figureId)
    raw.hasFigures = raw.figures.length > 0
    const nextUnified = fromQuestionItem(raw)
    setQuestions(prev => prev.map(q => q.id === activeQuestion.id ? nextUnified : q))
  }

  // 多选与过滤计算
  const activeQuestion = useMemo(() => {
    return questions.find(q => q.id === activeQuestionId) || null
  }, [questions, activeQuestionId])

  const filteredQuestions = useMemo(() => {
    return questions.filter(q => {
      if (activeTab === 'ready') {
        return q.status === 'ready' && q.issues.length === 0
      }
      if (activeTab === 'warning') {
        return q.issues.some(iss => iss.severity === 'warning') || q.similarQuestions && q.similarQuestions.length > 0
      }
      if (activeTab === 'error') {
        return q.status === 'blocked' || q.status === 'needs_manual_fix' || q.issues.some(iss => iss.severity === 'error')
      }
      return true
    })
  }, [questions, activeTab])

  // 批量全选判断
  const selectableList = useMemo(() => {
    return filteredQuestions.filter(q => !committedIds.has(q.id))
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

  // 进度状态解析
  const friendlyProgress = getFriendlyProgressStage(ocrProgress)

  return (
    <div className="space-y-6">
      <PageTitle
        title="资料导入与自动分割"
        desc="上传试卷或讲义，AI 会自动识别文字和公式并按题号分割。请在此页面核对并存入系统题库。"
        path="/tools/import"
      />

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

      {/* ── 模块 1 & 2：上传与通道配置 (隐藏运行状态) ── */}
      {!runningRunId && (
        <div className="grid gap-6 md:grid-cols-12">
          <div className="md:col-span-8 space-y-4">
            <Panel title="第一步：上传试卷文档">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={async (e) => {
                  e.preventDefault()
                  setDragOver(false)
                  if (e.dataTransfer.files) {
                    await handlePdfUpload(e.dataTransfer.files)
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center ${
                  dragOver
                    ? 'border-zinc-900 bg-zinc-50/30 dark:border-zinc-100 dark:bg-zinc-900/30'
                    : 'border-zinc-200 bg-white hover:bg-zinc-50/10 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/20'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="application/json,.json,application/pdf,.pdf,image/png,image/jpeg,image/jpg"
                  onChange={async (e) => {
                    if (e.target.files) {
                      await handlePdfUpload(e.target.files)
                    }
                  }}
                />
                {uploading ? (
                  <LoaderCircle className="size-8 animate-spin text-zinc-500 mb-3" />
                ) : (
                  <Upload className="size-8 text-zinc-400 dark:text-zinc-500 mb-3" />
                )}
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {uploading ? '文件正上传中...' : '点击选择或拖拽试卷文件至此处'}
                </p>
                <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
                  支持 PDF 文档、PNG/JPG 图片以及本地模拟解析 JSON 文件
                </p>
              </div>
            </Panel>

            <Panel title="第二步：选择 AI 识别通道">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div
                  onClick={() => setOcrProvider('glm')}
                  className={`border rounded-lg p-4 cursor-pointer transition-all ${
                    ocrProvider === 'glm'
                      ? 'border-zinc-950 bg-zinc-50/50 dark:border-zinc-50 dark:bg-zinc-900/50'
                      : 'border-zinc-200 bg-white hover:bg-zinc-50/10 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/20'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 flex size-4 items-center justify-center rounded-full border transition-all ${
                      ocrProvider === 'glm' ? 'border-zinc-950 dark:border-zinc-50' : 'border-zinc-300'
                    }`}>
                      {ocrProvider === 'glm' && <span className="size-2 rounded-full bg-zinc-950 dark:bg-zinc-50" />}
                    </span>
                    <div>
                      <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">高速图文识别通道 (GLM-OCR)</h4>
                      <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                        解析处理耗时短，擅长还原页面版面结构，强力推荐语文、英语、政史地等以文本为主的试卷使用。
                      </p>
                    </div>
                  </div>
                </div>

                <div
                  onClick={() => setOcrProvider('doc2x')}
                  className={`border rounded-lg p-4 cursor-pointer transition-all ${
                    ocrProvider === 'doc2x'
                      ? 'border-zinc-950 bg-zinc-50/50 dark:border-zinc-50 dark:bg-zinc-900/50'
                      : 'border-zinc-200 bg-white hover:bg-zinc-50/10 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/20'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 flex size-4 items-center justify-center rounded-full border transition-all ${
                      ocrProvider === 'doc2x' ? 'border-zinc-950 dark:border-zinc-50' : 'border-zinc-300'
                    }`}>
                      {ocrProvider === 'doc2x' && <span className="size-2 rounded-full bg-zinc-950 dark:bg-zinc-50" />}
                    </span>
                    <div>
                      <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">高精度公式识别通道 (Doc2X)</h4>
                      <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                        云端排版与理科数学物理等公式识别精确度极高，复杂公式极少出现符号乱码。
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </Panel>
          </div>

          <div className="md:col-span-4 space-y-4">
            <Panel title="高级调试与模拟导入">
              <div className="space-y-4 text-xs">
                <p className="text-zinc-500 leading-relaxed">
                  在进行本地集成或离线测试时，可以通过模拟 JSON 输入快速校验试题提取的匹配性。
                </p>

                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">本地模拟 JSON 流</span>
                  <input
                    type="checkbox"
                    checked={isJSONMode}
                    onChange={(e) => setIsJSONMode(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300 cursor-pointer text-zinc-950 focus:ring-zinc-950"
                  />
                </div>

                {isJSONMode && (
                  <div className="space-y-3 pt-2 border-t border-zinc-100 dark:border-zinc-800 animate-in slide-in-from-top-1 duration-200">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-zinc-500">后端已有 OCRDocument</label>
                      <select
                        className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-zinc-950"
                        value={selectedOcrId}
                        onChange={(event) => {
                          setSelectedOcrId(event.target.value)
                          setQuestions([])
                        }}
                      >
                        <option value="">请选择 OCR 试卷</option>
                        {ocrDocuments.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.id.slice(0, 10)} · {item.provider} · {item.createdAt.slice(0, 10)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex gap-2">
                      <Button size="sm" icon={Play} onClick={parseSelectedOcr} disabled={!selectedOcrId || Boolean(busy)}>
                        提取题目
                      </Button>
                      <Button size="sm" icon={Database} variant="outline" onClick={loadCandidatesForSelected} disabled={!selectedOcr || Boolean(busy)}>
                        查看历史候选
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Panel>
          </div>
        </div>
      )}

      {/* ── 模块 3：自动识别进度条 (仅运行状态显示) ── */}
      {runningRunId && (
        <Panel title="试卷云端识别与题目自动提取进度" className="border-zinc-200 dark:border-zinc-800 shadow-md">
          <div className="py-6 px-4 space-y-8">
            <div className="flex items-center gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm animate-pulse">
                <Sparkles className="size-5 text-zinc-900 dark:text-zinc-50 animate-bounce" />
              </div>
              <div className="space-y-1 min-w-0">
                <h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {friendlyProgress.text}
                </h3>
                <p className="text-xs text-zinc-500 truncate" title={runningRunId}>
                  任务标识：{runningRunId}
                </p>
              </div>
            </div>

            {/* 4 步骤进度条结构 */}
            <div className="relative">
              {/* 背景导轨 */}
              <div className="absolute top-1/2 left-0 h-0.5 w-full bg-zinc-100 dark:bg-zinc-800 -translate-y-1/2" />
              {/* 填充活跃区 */}
              <div
                className="absolute top-1/2 left-0 h-0.5 bg-zinc-900 dark:bg-zinc-55 -translate-y-1/2 transition-all duration-500 ease-out"
                style={{ width: `${Math.min(100, Math.max(0, (friendlyProgress.step - 1) * 33.3))}%` }}
              />

              <div className="relative flex justify-between">
                {[
                  { step: 1, label: '上传试卷文件' },
                  { step: 2, label: '云端 AI 识别' },
                  { step: 3, label: '自动切题提取' },
                  { step: 4, label: '加载待确认' },
                ].map((item) => {
                  const isActive = friendlyProgress.step >= item.step
                  const isCurrent = friendlyProgress.step === item.step
                  return (
                    <div key={item.step} className="flex flex-col items-center space-y-2">
                      <div className={`z-10 flex size-7 items-center justify-center rounded-full border transition-all duration-300 ${
                        isActive
                          ? 'border-zinc-900 bg-zinc-900 text-zinc-55 dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950 font-semibold'
                          : 'border-zinc-200 bg-white text-zinc-400 dark:border-zinc-800 dark:bg-zinc-955'
                      } ${isCurrent ? 'ring-4 ring-zinc-100 dark:ring-zinc-900 scale-110' : ''}`}>
                        {isActive && friendlyProgress.step > item.step ? (
                          <Check className="size-3.5 stroke-[3]" />
                        ) : (
                          <span className="text-[11px]">{item.step}</span>
                        )}
                      </div>
                      <span className={`text-[11px] font-medium transition-colors ${
                        isActive ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-400'
                      }`}>
                        {item.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </Panel>
      )}

      {/* ── 模块 4-8：题目核对区 (生成完题目后展示) ── */}
      {questions.length > 0 && (
        <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-12rem)] min-h-[700px] items-stretch">
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
                  onClick={() => {
                    setActiveTab(tab.key as any)
                    setSelectedIds(new Set())
                  }}
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
                className="flex items-center gap-2 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors font-medium cursor-pointer"
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
                  onClick={() => {
                    setActiveTab('all')
                    setSelectedIds(new Set())
                  }}
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
                  const isCommitted = committedIds.has(q.id)
                  const isSelected = selectedIds.has(q.id)
                  const isActive = q.id === activeQuestionId
                  const preview = q.stemMarkdown.replace(/\$\$?[^$]+\$\$?/g, '[公式]').replace(/[#*_~`>|\\]/g, '').trim().slice(0, 50)

                  return (
                    <div
                      key={q.id}
                      onClick={() => setActiveQuestionId(q.id)}
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

          {/* 右侧：预览与修正详情面板 (65% 宽度) */}
          <div className="flex-1 flex flex-col border rounded-xl bg-white dark:bg-zinc-955 overflow-hidden shadow-sm min-w-0">
            {activeQuestion ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* 详情头部操作区 */}
                <div className="border-b border-zinc-100 bg-zinc-50/50 dark:border-zinc-900 dark:bg-zinc-900/10 px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                      第 {activeQuestion.questionNo || '？'} 题 详细内容核对
                    </h3>
                    <p className="text-[11px] text-zinc-500">
                      检查公式和插图，确认后即可存入主库。
                    </p>
                  </div>

                  {/* 核对操作按钮 */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Button
                      size="sm"
                      icon={committedIds.has(activeQuestion.id) ? CheckCircle2 : busy === activeQuestion.id ? LoaderCircle : CheckCircle2}
                      disabled={committedIds.has(activeQuestion.id) || busy === activeQuestion.id || !activeQuestion.stemMarkdown.trim()}
                      onClick={() => commitSingleQuestion(activeQuestion)}
                    >
                      {committedIds.has(activeQuestion.id) ? '已入库' : '确认入库'}
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      icon={Edit3}
                      disabled={Boolean(busy)}
                      onClick={() => openEditor(activeQuestion)}
                    >
                      修正题目内容
                    </Button>

                    {/* 普通 PDF OCR 模式下才开启“手动框选截图修正范围 & 题图” */}
                    {activeQuestion.isOcrRun && (
                      <Button
                        size="sm"
                        variant="outline"
                        icon={Crop}
                        disabled={Boolean(busy)}
                        onClick={() => setCroppingItem(activeQuestion.rawItem)}
                      >
                        手动修正识别范围 & 题图
                      </Button>
                    )}
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
                            <li key={idx} className="leading-relaxed">{issue.message}</li>
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
                      <MarkdownContent content={activeQuestion.stemMarkdown || '（空，请点击上方“修改内容”补充）'} className="text-sm font-normal" />
                    </div>
                  </section>

                  {/* 已剪裁题图展示 */}
                  {activeQuestion.figures && activeQuestion.figures.length > 0 && (
                    <section className="space-y-1.5 animate-in fade-in duration-200">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 border-b pb-1 dark:border-zinc-800">
                        <ImageIcon className="size-3.5 text-zinc-400" />
                        <span>已提取的题目插图 ({activeQuestion.figures.length})</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {activeQuestion.figures.map((fig, idx) => (
                          <div key={fig.id || idx} className="rounded-lg border bg-zinc-50/10 dark:bg-zinc-900/5 p-2 flex flex-col items-center justify-center space-y-1">
                            {fig.path ? (
                              <img
                                src={assetUrl(fig.path)}
                                alt={`插图 ${idx + 1}`}
                                className="max-h-24 object-contain rounded border border-zinc-200 dark:border-zinc-800 bg-white"
                              />
                            ) : (
                              <div className="h-16 flex items-center justify-center text-zinc-400 italic text-[10px]">无法加载图片</div>
                            )}
                            <span className="text-[10px] text-zinc-400 font-medium">插图 {idx + 1} ({fig.usage === 'analysis' ? '解析图' : '题干图'})</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* 答案与解析分栏预览 */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <section className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 border-b pb-1 dark:border-zinc-800">
                        <CheckCircle2 className="size-3.5 text-zinc-400" />
                        <span>自动识别答案</span>
                      </div>
                      <div className="bg-zinc-50/30 dark:bg-zinc-900/5 p-4 rounded-lg border border-zinc-100 dark:border-zinc-900 min-h-12 leading-relaxed">
                        <MarkdownContent content={activeQuestion.answerText || '（无）'} className="text-sm font-normal" />
                      </div>
                    </section>

                    <section className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 border-b pb-1 dark:border-zinc-800">
                        <Compass className="size-3.5 text-zinc-400" />
                        <span>自动解析步骤</span>
                      </div>
                      <div className="bg-zinc-50/30 dark:bg-zinc-900/5 p-4 rounded-lg border border-zinc-100 dark:border-zinc-900 min-h-12 leading-relaxed">
                        <MarkdownContent content={activeQuestion.analysisMarkdown || '（无）'} className="text-sm font-normal" />
                      </div>
                    </section>
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
      {selectedIds.size > 0 && (
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

      {/* ── 修正内容对话框 (EditDialog) ── */}
      {editingItem && (
        <EditDialog
          draft={editingDraft}
          setDraft={setEditingDraft}
          onClose={() => {
            setEditingItem(null)
            setEditingDraft({})
          }}
          onSave={saveEditedQuestion}
        />
      )}

      {/* ── 手动修正截取范围 & 题图画框 (FigureCropDialog) ── */}
      {croppingItem && (
        <FigureCropDialog
          question={croppingItem}
          onClose={async (changed) => {
            setCroppingItem(null)
            if (changed && ocrProgress?.runId) {
              await loadOcrQuestions(ocrProgress.runId)
            }
          }}
          onDelete={handleCropDelete}
          onSave={handleCropSave}
          onUpdate={handleCropUpdate}
        />
      )}
    </div>
  )
}

import { useEffect, useMemo, useState, useRef } from 'react'
import {
  AlertTriangle,
  BadgeAlert,
  Check,
  CheckCircle2,
  Compass,
  Database,
  ImageIcon,
  Layers,
  LoaderCircle,
  Play,
  SkipForward,
  Upload,
} from 'lucide-react'
import { importV2Api, type ImportV2Candidate, type ImportV2OcrDocument, type ImportV2SourceDocument, type OcrFigureDiagnostics } from '@/api/importV2'
import { MarkdownContent } from '@/components/MarkdownContent'
import { MarkdownWithInlineFigures } from '@/components/questions/QuestionContent'
import { PageTitle, Panel, Badge, Button, Empty } from '@/components/ui'
import { assetUrl } from '@/utils/questionDisplay'

// ── 统一数据适配层 (Unified Model Adapter) ─────────────────────────────

type UnifiedQuestion = {
  id: string
  questionNo: string
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  status: 'ready' | 'needs_review' | 'needs_manual_fix' | 'blocked' | 'committed' | 'banked' | 'skipped'
  issues: Array<{ severity: 'warning' | 'error'; message: string; code?: string }>
  figures: Array<{ id: string; usage: string; path: string; pageNo?: number; bbox?: any }>
  hasFigures: boolean
  similarQuestions?: any[]
  rawItem: any
}

function fromCandidate(c: ImportV2Candidate): UnifiedQuestion {
  return {
    id: c.id,
    questionNo: c.questionNo || '',
    stemMarkdown: c.stemMarkdown || '',
    answerText: c.answerText || '',
    analysisMarkdown: c.analysisMarkdown || '',
    status: c.status === 'committed' ? 'committed' : c.status === 'ready' ? 'ready' : c.status === 'blocked' ? 'blocked' : 'needs_review',
    issues: (c.issues || []).map(iss => ({ severity: iss.severity, message: iss.message, code: iss.code })),
    figures: (c.figures || []).map(fig => ({ id: fig.id, usage: fig.usage, path: fig.path, pageNo: fig.pageNo })),
    hasFigures: (c.figures || []).length > 0,
    rawItem: c
  }
}

function issueLabel(code?: string) {
  return ({
    duplicate_question_no: '重复题号',
    unplaced_figure: '图片待核对',
    missing_answer: '缺少答案',
    missing_analysis: '缺少解析',
  } as Record<string, string>)[code || '']
}

export default function ImportV2Page() {
  const [sourceDocuments, setSourceDocuments] = useState<ImportV2SourceDocument[]>([])
  const [ocrDocuments, setOcrDocuments] = useState<ImportV2OcrDocument[]>([])
  const [selectedOcrId, setSelectedOcrId] = useState('')
  const [questions, setQuestions] = useState<UnifiedQuestion[]>([])
  const [committedIds, setCommittedIds] = useState<Set<string>>(new Set())

  // UI 交互状态
  const [uploading, setUploading] = useState(false)
  const [runningSourceDocumentId, setRunningSourceDocumentId] = useState('')
  const [sourceOcrErrors, setSourceOcrErrors] = useState<Record<string, string>>({})
  const [isJSONMode, setIsJSONMode] = useState(false)
  const [activeTab, setActiveTab] = useState<'all' | 'ready' | 'warning' | 'error'>('all')
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [diagnostics, setDiagnostics] = useState<OcrFigureDiagnostics | null>(null)

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
          setIsJSONMode(true)
          setRunningSourceDocumentId('')
          showNotice('识别完成。请点击“生成待确认题目”继续。')
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

  // 1. 上传真实 PDF/图片到 v2 专属资料区。
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
      await importV2Api.uploadSourceDocument(file)
      await loadLists()
      showNotice('资料已保存，可启动 GLM-OCR 识别。')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
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
        desc="上传资料后可使用 GLM-OCR 自动识别；识别完成后生成待确认题目。"
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

      <div className="grid gap-6 md:grid-cols-12">
        <div className="md:col-span-8">
          <Panel title="上传资料">
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
                  {uploading ? '文件正保存中...' : '点击选择或拖拽资料文件至此处'}
                </p>
                <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
                  支持 PDF、PNG/JPG；上传后先保存原始资料，再点击“开始自动识别”。
                </p>
              </div>
              {sourceDocuments.filter((item) => item.fileType === 'pdf' || item.fileType === 'image').length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-[11px] font-semibold text-zinc-500">已保存资料</p>
                  {sourceDocuments.filter((item) => item.fileType === 'pdf' || item.fileType === 'image').slice(0, 5).map((item) => {
                    const isRunning = item.id === runningSourceDocumentId || item.status === 'ocr_running'
                    const canStart = item.status === 'uploaded' || item.status === 'ocr_failed'
                    const statusLabel = item.status === 'ocr_running'
                      ? '识别中'
                      : item.status === 'ocr_succeeded' || item.status === 'parsed' || item.status === 'partially_parsed'
                        ? '已识别'
                        : item.status === 'ocr_failed'
                          ? '识别失败'
                          : '等待识别'
                    return (
                      <div key={item.id} className="flex items-center gap-3 rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-800">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">{item.originalFileName || item.title}</p>
                          <p className="text-[10px] text-zinc-500">{statusLabel}</p>
                          {item.status === 'ocr_failed' && sourceOcrErrors[item.id] ? (
                            <p className="mt-0.5 truncate text-[10px] text-red-600 dark:text-red-400" title={sourceOcrErrors[item.id]}>
                              {sourceOcrErrors[item.id]}
                            </p>
                          ) : null}
                        </div>
                        {isRunning ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500"><LoaderCircle className="size-3 animate-spin" /> 识别中</span>
                        ) : canStart ? (
                          <Button size="sm" icon={Play} disabled={Boolean(busy)} onClick={() => startGlmOcr(item.id)}>
                            {item.status === 'ocr_failed' ? '重试自动识别' : '开始自动识别'}
                          </Button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
          </Panel>
        </div>

        <div className="md:col-span-4">
          <Panel title="OCRDocument 候选生成">
              <div className="space-y-4 text-xs">
                <p className="text-zinc-500 leading-relaxed">
                  可导入模拟 JSON，或选择 GLM-OCR 已生成的 OCRDocument；候选生成不会自动执行。
                </p>

                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">导入模拟 JSON</span>
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
                        生成待确认题目
                      </Button>
                      <Button size="sm" icon={Database} variant="outline" onClick={loadCandidatesForSelected} disabled={!selectedOcr || Boolean(busy)}>
                        查看历史候选
                      </Button>
                    </div>
                  </div>
                )}

                {diagnostics && (
                  <div className="mt-4 space-y-2 rounded-lg border border-zinc-100 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/10">
                    <h4 className="font-semibold text-zinc-700 dark:text-zinc-300">试卷图源诊断信息</h4>
                    <div className="grid grid-cols-2 gap-y-1.5 text-[11px] text-zinc-500">
                      <div>Markdown 占位符数量:</div>
                      <div className="font-medium text-zinc-800 dark:text-zinc-200">{diagnostics.placeholderCount}</div>
                      <div>Assets 资产数量:</div>
                      <div className="font-medium text-zinc-800 dark:text-zinc-200">{diagnostics.assetsCount}</div>
                      <div>未匹配 Asset 的占位符:</div>
                      <div className="font-medium text-zinc-800 dark:text-zinc-200">{diagnostics.unmatchedPlaceholderCount}</div>
                      <div>Candidate 未使用的 Asset:</div>
                      <div className="font-medium text-zinc-800 dark:text-zinc-200">{diagnostics.unusedAssetsCount}</div>
                      <div>远程图片下载失败数量:</div>
                      <div className="font-medium text-zinc-800 dark:text-zinc-200">{diagnostics.failedDownloadCount}</div>
                    </div>
                  </div>
                )}
              </div>
          </Panel>
        </div>
      </div>

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
                  const isCommitted = q.status === 'committed' || committedIds.has(q.id)
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

          {/* 右侧：预览详情面板 (65% 宽度) */}
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
                      icon={activeQuestion.status === 'committed' || committedIds.has(activeQuestion.id) ? CheckCircle2 : busy === activeQuestion.id ? LoaderCircle : CheckCircle2}
                      disabled={activeQuestion.status === 'committed' || committedIds.has(activeQuestion.id) || busy === activeQuestion.id || !activeQuestion.stemMarkdown.trim()}
                      onClick={() => commitSingleQuestion(activeQuestion)}
                    >
                      {activeQuestion.status === 'committed' || committedIds.has(activeQuestion.id) ? '已入库' : '确认入库'}
                    </Button>
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
                      <MarkdownWithInlineFigures content={activeQuestion.stemMarkdown || '（空）'} figures={activeQuestion.figures} className="text-sm font-normal" />
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

    </div>
  )
}

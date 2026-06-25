import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Crop,
  Edit3,
  Eye,
  ImageIcon,
  Inbox,
  LoaderCircle,
  RefreshCcw,
  ScanSearch,
  SkipForward,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { pendingBankApi } from '../api/pendingBank'
import { questionBankApi } from '../api/questionBank'
import { MarkdownContent } from '../components/MarkdownContent'
import { EditDialog } from '../components/questions/EditDialog'
import { FigureCropDialog } from '../components/questions/FigureDialogs'
import { MarkdownWithInlineFigures, QuestionMarkdownContent } from '../components/questions/QuestionContent'
import { figuresByUsage } from '../utils/questionDisplay'
import { Badge, Button, Empty } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import type {
  ApiRun,
  BulkActionResult,
  PendingBankFilter,
  PendingBankResponse,
  PendingBankSummary,
  QuestionFigure,
  QuestionItem,
} from '../types'

// ── Custom Spec Components ──────────────────────────────────────────

function SpecBadge({ children, variant = 'default', className = '' }: { children: ReactNode; variant?: 'default' | 'success' | 'warning' | 'danger'; className?: string }) {
  const variants = {
    default: 'bg-zinc-100 text-zinc-800 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/50',
    warning: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/50',
    danger: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/50',
  }
  return (
    <span className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-[11px] font-medium tracking-wide transition-colors border h-5 ${variants[variant]} ${className}`}>
      {children}
    </span>
  )
}

function SpecEmpty({ text, description }: { text: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl bg-zinc-50/10">
      <Inbox className="size-8 text-zinc-300 dark:text-zinc-700 mb-3" />
      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{text}</p>
      {description ? <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">{description}</p> : null}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────

function canConfirmDirectly(item: QuestionItem) {
  return !item.pendingBankReadOnly && item.bankStatus === 'ready' && Boolean(item.stemMarkdown?.trim())
}

function canSelectForBulk(item: QuestionItem) {
  return !item.pendingBankReadOnly
}

function hasFormulaRenderRisk(item: QuestionItem) {
  return ['katex_parse_error', 'math_delimiter_unclosed', 'latex_left_right_unbalanced'].includes(String(item.formatIssue?.code || ''))
}

function similarItems(items: QuestionItem[]) {
  return items.filter((item) => (item.similarQuestions?.length ?? 0) > 0)
}

function isSameRunSimilarQuestion(item: Pick<QuestionItem, 'sourceRunId'>, candidate: Pick<NonNullable<QuestionItem['similarQuestions']>[number], 'sourceRunId'>) {
  return Boolean(item.sourceRunId) && Boolean(candidate.sourceRunId) && item.sourceRunId === candidate.sourceRunId
}

function similarQuestionOriginLabel(item: Pick<QuestionItem, 'sourceRunId'>, candidate: Pick<NonNullable<QuestionItem['similarQuestions']>[number], 'sourceRunId'>) {
  return isSameRunSimilarQuestion(item, candidate) ? '本批次内重复' : '题库历史重复'
}

type SimilarityReviewDialogProps = {
  items: QuestionItem[]
  confirmText: string
  onProceed: () => void | Promise<void>
  onCancel: () => void
}

export default function PendingBankPage() {
  const { runId = '' } = useParams()
  const navigate = useNavigate()
  const decodedRunId = decodeURIComponent(runId)
  const [filter, setFilter] = useState<PendingBankFilter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<QuestionItem | null>(null)
  const [editingDraft, setEditingDraft] = useState<Partial<QuestionItem>>({})
  const [croppingItem, setCroppingItem] = useState<QuestionItem | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogProps | null>(null)
  const [similarityReview, setSimilarityReview] = useState<SimilarityReviewDialogProps | null>(null)
  const [actionNotice, setActionNotice] = useState('')
  const [actionBusy, setActionBusy] = useState(false)

  const pendingBankParams = useMemo(() => ({ filter }), [filter])
  const { data, error, loading, reload } = useAsync<PendingBankResponse>(() => pendingBankApi.getPendingBank(decodedRunId, pendingBankParams), [decodedRunId, pendingBankParams])

  const activeItem = useMemo(() => {
    if (!activeId || !data) return null
    return data.items.find((item) => item.id === activeId) ?? null
  }, [activeId, data])

  // Auto-select first item
  useEffect(() => {
    if (data?.items.length && !activeId) {
      setActiveId(data.items[0].id)
    }
  }, [data, activeId])

  // Clear selections when filter changes
  useEffect(() => {
    setSelectedIds(new Set())
  }, [filter])

  // ── Action helpers ──

  function showNotice(msg: string) {
    setActionNotice(msg)
    setTimeout(() => setActionNotice(''), 3000)
  }

  function openSimilarityReview(items: QuestionItem[], confirmText: string, onProceed: () => void | Promise<void>) {
    setSimilarityReview({
      items: similarItems(items),
      confirmText,
      onProceed,
      onCancel: () => setSimilarityReview(null),
    })
  }

  function openEditor(item: QuestionItem) {
    setEditingItem(item)
    setEditingDraft(item.pendingBankReadOnly
      ? {
          ...item,
          bankStatus: 'ready',
          stemMarkdown: '',
          answerText: '',
          analysisMarkdown: '',
          problemBlocks: [],
          answerBlocks: [],
          analysisBlocks: [],
        }
      : item)
  }

  async function saveEditedQuestion(nextDraft = editingDraft) {
    if (!editingItem) return
    const saved = editingItem.pendingBankReadOnly
      ? await pendingBankApi.createManualCandidate(decodedRunId, nextDraft)
      : await questionBankApi.updateItem(editingItem.id, nextDraft)
    setActiveId(saved.id)
    setEditingItem(null)
    setEditingDraft({})
    await reload({ silent: true })
    showNotice('题目已保存')
  }

  async function runBulkAction(label: string, endpoint: string, ids: string[], extraBody: Record<string, unknown> = {}) {
    setActionBusy(true)
    setActionNotice(`${label}中...`)
    try {
      const payload = { questionIds: ids, ...extraBody }
      const result = endpoint === 'bulk-confirm'
        ? await pendingBankApi.bulkConfirm(decodedRunId, payload)
        : endpoint === 'bulk-skip'
          ? await pendingBankApi.bulkSkip(decodedRunId, { questionIds: ids })
          : await pendingBankApi.bulkDelete(decodedRunId, { questionIds: ids })
      setSelectedIds(new Set())
      await reload({ silent: true })
      const warnText = result.warnings?.length ? ` (${result.warnings.length} 条警告)` : ''
      showNotice(`${label}完成：成功 ${result.success} 题${result.failed ? `，失败 ${result.failed} 题` : ''}${warnText}`)
    } catch (err) {
      showNotice(`${label}失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setActionBusy(false)
    }
  }

  async function confirmAll(force = false) {
    const riskyItems = data ? similarItems(data.items.filter((item) => canSelectForBulk(item) && item.bankStatus !== 'banked' && item.bankStatus !== 'skipped')) : []
    if (!force && riskyItems.length) {
      openSimilarityReview(riskyItems, '仍然全部入库', async () => {
        setSimilarityReview(null)
        await confirmAll(true)
      })
      return
    }
    setActionBusy(true)
    setActionNotice('全部入库中...')
    try {
      const result = await pendingBankApi.bulkConfirm(decodedRunId, { all: true })
      setSelectedIds(new Set())
      await reload({ silent: true })
      const warnText = result.warnings?.length ? ` (${result.warnings.length} 条警告)` : ''
      showNotice(`全部入库完成：成功 ${result.success} 题${result.failed ? `，失败 ${result.failed} 题` : ''}${warnText}`)
    } catch (err) {
      showNotice(`全部入库失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setActionBusy(false)
    }
  }

  async function confirmSingle(id: string, force = false) {
    const item = data?.items.find((entry) => entry.id === id)
    const needsImageConfirmation = item?.formatIssue?.code === 'inline_image_reference_mismatch'
    if (needsImageConfirmation && !force) {
      setConfirmDialog({
        title: '确认题图缺口',
        message: `${item?.formatIssue?.message || '图片引用与切分题图数量不一致。'}。未匹配的位置将不会自动使用其他题目的图片，是否确认按当前结果入库？`,
        danger: false,
        onConfirm: async () => { setConfirmDialog(null); await confirmSingle(id, true) },
        onCancel: () => setConfirmDialog(null),
      })
      return
    }
    if (!force && item?.similarQuestions?.length) {
      openSimilarityReview([item], '仍然入库', async () => {
        setSimilarityReview(null)
        await confirmSingle(id, true)
      })
      return
    }
    await runBulkAction('确认入库', 'bulk-confirm', [id], needsImageConfirmation ? { confirmImageReview: true } : {})
  }

  async function skipSingle(id: string) {
    await runBulkAction('跳过', 'bulk-skip', [id])
  }

  async function deleteSingle(id: string) {
    setConfirmDialog({
      title: '确认删除',
      message: '删除后无法恢复，确定删除此题？',
      danger: true,
      onConfirm: async () => {
        setConfirmDialog(null)
        await runBulkAction('删除', 'bulk-delete', [id])
        if (activeId === id) setActiveId(null)
      },
      onCancel: () => setConfirmDialog(null),
    })
  }

  async function saveQuestionInline(id: string, patch: Partial<QuestionItem>) {
    setActionBusy(true)
    try {
      const item = data?.items.find((entry) => entry.id === id)
      if (!item) return
      const nextDraft = {
        ...item,
        ...patch,
      }
      await questionBankApi.updateItem(id, nextDraft)
      await reload({ silent: true })
      showNotice('图片定位已保存')
    } catch (err) {
      alert(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setActionBusy(false)
    }
  }

  async function reOcrSingle(id: string) {
    const item = data?.items.find((entry) => entry.id === id)
    setConfirmDialog({
      title: '重新 OCR',
      message: '重新 OCR 会覆盖当前识别内容，请确认后继续。',
      danger: false,
      onConfirm: async () => {
        setConfirmDialog(null)
        setActionBusy(true)
        setActionNotice('重新 OCR 中...')
        try {
          if (item?.pendingBankReadOnly) {
            await pendingBankApi.rerunOcr(decodedRunId, id)
          } else {
            await questionBankApi.rerunItemOcr(id, { route: 'whole_question_json' })
          }
          await reload({ silent: true })
          showNotice('已启动当前题重新 OCR')
        } catch (err) {
          showNotice(`重新 OCR 失败：${err instanceof Error ? err.message : String(err)}`)
        } finally {
          setActionBusy(false)
        }
      },
      onCancel: () => setConfirmDialog(null),
    })
  }

  async function addFigure(questionId: string, payload: { usage: string; optionLabel?: string; bbox: Record<string, number> }) {
    return questionBankApi.createFigure(questionId, { ...payload, pageNumber: 1 })
  }

  async function updateFigure(questionId: string, figureId: string, payload: { usage: string; optionLabel?: string; bbox: Record<string, number> }) {
    return questionBankApi.updateFigure(questionId, figureId, { ...payload, pageNumber: 1 })
  }

  async function deleteFigure(questionId: string, figureId: string) {
    await questionBankApi.deleteFigure(questionId, figureId)
  }

  // ── Bulk actions ──

  function handleBulkConfirm() {
    const ids = [...selectedIds]
    const selectedItems = data?.items.filter((item) => ids.includes(item.id)) ?? []
    const duplicateLikeCount = similarItems(selectedItems).length
    if (duplicateLikeCount > 0) {
      openSimilarityReview(selectedItems, '仍然入库', async () => {
        setSimilarityReview(null)
        await runBulkAction('批量确认入库', 'bulk-confirm', ids)
      })
      return
    }
    const blockedCount = data?.items.filter((item) => ids.includes(item.id) && item.bankStatus === 'blocked').length ?? 0
    if (blockedCount > 0) {
      setConfirmDialog({
        title: '存在风险题目',
        message: `你选择的题目中有 ${blockedCount} 题仍存在识别风险。建议先处理后再入库。`,
        danger: false,
        confirmText: '仍然入库',
        cancelText: '返回处理',
        onConfirm: async () => {
          setConfirmDialog(null)
          await runBulkAction('批量确认入库', 'bulk-confirm', ids)
        },
        onCancel: () => setConfirmDialog(null),
      })
    } else {
      runBulkAction('批量确认入库', 'bulk-confirm', ids)
    }
  }

  function handleBulkSkip() {
    runBulkAction('批量跳过', 'bulk-skip', [...selectedIds])
  }

  function handleBulkDelete() {
    const ids = [...selectedIds]
    setConfirmDialog({
      title: '批量删除',
      message: `确定删除已选的 ${ids.length} 道题目？此操作不可恢复。`,
      danger: true,
      onConfirm: async () => {
        setConfirmDialog(null)
        await runBulkAction('批量删除', 'bulk-delete', ids)
      },
      onCancel: () => setConfirmDialog(null),
    })
  }

  // ── Select helpers ──

  function toggleSelect(id: string) {
    const item = data?.items.find((entry) => entry.id === id)
    if (item && !canSelectForBulk(item)) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    if (!data) return
    const candidates = filter === 'all' ? data.items.filter(canConfirmDirectly) : data.items.filter(canSelectForBulk)
    const allIds = candidates.map((item) => item.id)
    const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id))
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allIds))
    }
  }

  // ── Render ──

  if (loading && !data) return <SpecEmpty text="读取中..." />
  if (error || !data) return <SpecEmpty text={error || '批次不存在或无数据'} />

  const { run, summary, items } = data
  const selectableItems = filter === 'all' ? items.filter(canConfirmDirectly) : items.filter(canSelectForBulk)
  const allSelectableSelected = selectableItems.length > 0 && selectableItems.every((item) => selectedIds.has(item.id))
  const confirmAllCount = items.filter((item) => canSelectForBulk(item) && item.bankStatus !== 'banked' && item.bankStatus !== 'skipped').length
  const selectLabel = selectedIds.size > 0
    ? `已选 ${selectedIds.size} 题`
    : filter === 'all'
      ? `可选 ${selectableItems.length}/${items.length} 题`
      : `共 ${items.length} 题`

  return (
    <section className="mock-page-root flex h-[calc(100vh-8rem)] min-h-[900px] flex-col overflow-hidden bg-zinc-50/30 p-0 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      {/* Header */}
      <div className="shrink-0 space-y-4">
        <div className="flex flex-col gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">OCR 队列 / 待入库确认</p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              待入库确认
            </h1>
            <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">复核 OCR 结果，确认后进入题库核心主库。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={BadgeCheck} disabled={actionBusy || confirmAllCount === 0} onClick={() => confirmAll()}>全部入库</Button>
            <Button size="sm" variant="outline" asLink to={`/tools/pdf-slicer/runs/${encodeURIComponent(decodedRunId)}/questions`}>查看切题结果</Button>
            <Button size="sm" variant="outline" asLink to="/tools/pdf-slicer/ocr-jobs">OCR 队列</Button>
            <Button size="sm" variant="outline" onClick={() => navigate(-1)}>返回上一页</Button>
            <Button size="sm" variant="outline" onClick={() => reload()} icon={RefreshCcw}>刷新</Button>
          </div>
        </div>

        {/* Batch Overview */}
        <BatchOverview run={run} summary={summary} />

        {/* Filter bar */}
        <FilterBar filter={filter} summary={summary} onFilterChange={setFilter} />
      </div>

      {/* Action notice */}
      {actionNotice ? (
        <div className="mt-2 flex shrink-0 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
          {actionBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4 text-emerald-500" />}
          <span>{actionNotice}</span>
        </div>
      ) : null}

      {/* Main content: left list + right preview */}
      <div className="mt-3 flex min-h-0 flex-1 gap-3">
        {/* Left: Question list */}
        <div className="flex w-[38%] min-w-[280px] shrink-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
          <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/50 px-4 py-2.5 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/10 dark:text-zinc-400">
            <button
              onClick={selectAll}
              className="flex cursor-pointer items-center gap-2 transition-colors hover:text-zinc-950 dark:hover:text-zinc-50"
            >
              <span className={`flex items-center justify-center size-3.5 rounded border transition-all duration-150 ${
                allSelectableSelected
                  ? 'bg-zinc-900 border-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-900'
                  : 'bg-white border-zinc-300 dark:bg-zinc-950 dark:border-zinc-700 hover:border-zinc-400'
              }`}>
                {allSelectableSelected ? <Check className="size-2.5 stroke-[3.5]" /> : null}
              </span>
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">{selectLabel}</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-zinc-50/30 dark:bg-zinc-900/10">
            {items.length === 0 ? (
              <SpecEmpty text="无可用数据" description="当前筛选条件下没有题目数据" />
            ) : (
              items.map((item) => (
                <QuestionCard
                  key={item.id}
                  item={item}
                  active={item.id === activeId}
                  selected={selectedIds.has(item.id)}
                  selectable={canSelectForBulk(item)}
                  onSelect={() => toggleSelect(item.id)}
                  onClick={() => setActiveId(item.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right: Preview panel */}
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-zinc-200 bg-white text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
          {activeItem ? (
            <PreviewPanel
              item={activeItem}
              busy={actionBusy}
              onConfirm={() => confirmSingle(activeItem.id)}
              onEdit={() => openEditor(activeItem)}
              onReOcr={() => reOcrSingle(activeItem.id)}
              rerunUnavailable={data?.run.ocrProvider === 'doc2x'}
              onCrop={() => setCroppingItem(activeItem)}
              onSkip={() => skipSingle(activeItem.id)}
              onDelete={() => deleteSingle(activeItem.id)}
              onSaveInline={saveQuestionInline}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6">
              <SpecEmpty text="未选中任何题目" description="请从左侧列表中点击题目以查看详细内容" />
            </div>
          )}
        </div>
      </div>

      {/* Bulk action bar at the very bottom */}
      {selectedIds.size > 0 ? (
        <BulkActionBar
          count={selectedIds.size}
          busy={actionBusy}
          onConfirm={handleBulkConfirm}
          onSkip={handleBulkSkip}
          onDelete={handleBulkDelete}
        />
      ) : null}

      {/* Modals */}
      {editingItem ? (
        <EditDialog
          draft={editingDraft}
          setDraft={setEditingDraft}
          onClose={() => {
            setEditingItem(null)
            setEditingDraft({})
          }}
          onSave={saveEditedQuestion}
        />
      ) : null}
      {croppingItem ? <FigureCropDialog
        question={croppingItem}
        onClose={async (changed) => { setCroppingItem(null); if (changed) await reload({ silent: true }) }}
        onDelete={(figureId) => deleteFigure(croppingItem.id, figureId)}
        onSave={(payload) => addFigure(croppingItem.id, payload)}
        onUpdate={(figureId, payload) => updateFigure(croppingItem.id, figureId, payload)}
      /> : null}
      {confirmDialog ? <ConfirmDialog {...confirmDialog} /> : null}
      {similarityReview ? <SimilarityReviewDialog {...similarityReview} /> : null}
    </section>
  )
}

// ── Batch Overview ──────────────────────────────────────────────────

function BatchOverview({ run, summary }: { run: ApiRun; summary: PendingBankSummary }) {
  const [collapsed, setCollapsed] = useState(false)

  const statusMessage = useMemo(() => {
    if (summary.total === 0) return '本批次暂无识别结果。'
    const pending = summary.ready + summary.blocked
    if (pending === 0) return '本批次已全部处理完成。'
    const parts: string[] = []
    if (summary.ready > 0) parts.push(`${summary.ready} 题可直接入库`)
    if (summary.blocked > 0) parts.push(`${summary.blocked} 题需要处理`)
    if (summary.ocrFailed > 0) parts.push(`其中 ${summary.ocrFailed} 题识别失败`)
    return `本批次已识别完成，${parts.join('，')}。`
  }, [summary])

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 shadow-sm overflow-hidden transition-all duration-200">
      <div className="p-3 border-b border-zinc-100 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-900/10 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{run.paperTitle || run.pdfName}</p>
          {collapsed ? (
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-1.5">
              <span>总数 <strong className="text-zinc-700 dark:text-zinc-300">{summary.total}</strong></span>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <span className="text-emerald-700 dark:text-emerald-400">可入库 <strong className="font-bold">{summary.ready}</strong></span>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <span className="text-amber-700 dark:text-amber-400">需处理 <strong className="font-bold">{summary.blocked}</strong></span>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <span>已入库 <strong className="text-zinc-700 dark:text-zinc-300">{summary.banked}</strong></span>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <span>已跳过 <strong className="text-zinc-700 dark:text-zinc-300">{summary.skipped}</strong></span>
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{statusMessage}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <SpecBadge variant={run.sourceFileKind === '讲义型' ? 'warning' : 'default'}>
            {run.sourceFileKind || '未确认'}
          </SpecBadge>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-md text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer"
            title={collapsed ? '展开批次面板' : '折叠批次面板'}
          >
            {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </button>
        </div>
      </div>
      {!collapsed ? (
        <div className="p-3 bg-white dark:bg-zinc-950">
          <div className="grid grid-cols-5 gap-2">
            <MetricChip label="总题数" value={summary.total} />
            <MetricChip label="可入库" value={summary.ready} color="emerald" />
            <MetricChip label="需处理" value={summary.blocked} color="amber" />
            <MetricChip label="已入库" value={summary.banked} color="neutral" />
            <MetricChip label="已跳过" value={summary.skipped} color="muted" />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MetricChip({ label, value, color }: { label: string; value: number; color?: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-50/50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/10 dark:text-emerald-400 dark:border-emerald-900/20',
    amber: 'bg-amber-50/50 text-amber-700 border-amber-100 dark:bg-amber-950/10 dark:text-amber-400 dark:border-amber-900/20',
    neutral: 'bg-zinc-50/50 text-zinc-900 border-zinc-100 dark:bg-zinc-900/10 dark:text-zinc-50 dark:border-zinc-800/50',
    muted: 'bg-zinc-50/30 text-zinc-500 border-zinc-100 dark:bg-zinc-900/5 dark:text-zinc-400 dark:border-zinc-800/30',
  }
  const colorClasses = color && colorMap[color]
    ? colorMap[color]
    : 'bg-white text-zinc-900 border-zinc-200 dark:bg-zinc-950 dark:text-zinc-50 dark:border-zinc-800'

  return (
    <div className={`rounded-lg border px-2 py-1.5 text-center transition-all ${colorClasses}`}>
      <p className="text-[9px] font-semibold uppercase tracking-wider opacity-85">{label}</p>
      <p className="mt-0.5 text-base font-bold leading-none">{value}</p>
    </div>
  )
}

// ── Filter Bar ──────────────────────────────────────────────────────

function FilterBar({ filter, summary, onFilterChange }: { filter: PendingBankFilter; summary: PendingBankSummary; onFilterChange: (f: PendingBankFilter) => void }) {
  const tabs: Array<{ key: PendingBankFilter; label: string; count: number }> = [
    { key: 'all', label: '全部', count: summary.total },
    { key: 'ready', label: '可入库', count: summary.ready },
    { key: 'blocked', label: '需处理', count: summary.blocked },
    { key: 'ocr_failed', label: '识别失败', count: summary.ocrFailed },
    { key: 'has_figures', label: '有题图', count: summary.hasFigures },
    { key: 'banked', label: '已入库', count: summary.banked },
    { key: 'skipped', label: '已跳过', count: summary.skipped },
  ]

  return (
    <div className="inline-flex h-9 max-w-full shrink-0 items-center justify-start gap-1 overflow-x-auto bg-zinc-100/80 dark:bg-zinc-900/80 p-0.5 rounded-lg border border-zinc-200/50 dark:border-zinc-800/50">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onFilterChange(tab.key)}
          className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 h-7 text-xs font-medium transition-all cursor-pointer select-none
            ${filter === tab.key
              ? 'bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-xs border border-zinc-200/20'
              : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
            }`}
        >
          {tab.label}
          <span className={`ml-1.5 rounded-sm px-1.5 py-0.5 text-[9px] font-bold transition-all
            ${filter === tab.key
              ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400'
              : 'bg-zinc-200/50 text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400'
            }`}>
            {tab.count}
          </span>
        </button>
      ))}
    </div>
  )
}

// ── Question Card ───────────────────────────────────────────────────

function bankStatusLabel(status: string, item: QuestionItem): string {
  if ((!item.stemMarkdown || item.stemMarkdown.trim() === '') && status !== 'banked' && status !== 'skipped') return '识别失败'
  if (status === 'ready') return '可入库'
  if (status === 'blocked') return '需处理'
  if (status === 'banked') return '已入库'
  if (status === 'skipped') return '已跳过'
  return '可入库'
}

function bankStatusVariant(status: string, item: QuestionItem): 'success' | 'warning' | 'danger' | 'default' {
  if ((!item.stemMarkdown || item.stemMarkdown.trim() === '') && status !== 'banked' && status !== 'skipped') return 'danger'
  if (status === 'ready') return 'success'
  if (status === 'blocked') return 'warning'
  if (status === 'banked') return 'default'
  if (status === 'skipped') return 'default'
  return 'success'
}

function mergeStatusLabel(status: string): string {
  return {
    merged: '已合并解析',
    waiting_solution: '等待解析合并',
    missing_solution: '缺少解析',
    duplicate_solution: '解析题号重复',
    missing_question_no: '原卷题号缺失',
  }[status] || status
}

function QuestionCard({ item, active, selected, selectable, onSelect, onClick }: {
  item: QuestionItem
  active: boolean
  selected: boolean
  selectable: boolean
  onSelect: () => void
  onClick: () => void
}) {
  const preview = (item.stemMarkdown || '').replace(/\$\$?[^$]+\$\$?/g, '[公式]').replace(/[#*_~`>|\\]/g, '').trim().slice(0, 80)

  return (
    <div
      onClick={onClick}
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all duration-150 shadow-sm
        ${active
          ? 'border-zinc-900 bg-zinc-50/40 dark:border-zinc-100 dark:bg-zinc-900/40'
          : 'border-zinc-200 bg-white hover:bg-zinc-50/50 dark:border-zinc-800/80 dark:bg-zinc-950 dark:hover:bg-zinc-900/30'
        }`}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onSelect() }}
        disabled={!selectable}
        className={`mt-0.5 shrink-0 flex items-center justify-center size-4 rounded border transition-all duration-150 ${
          !selectable
            ? 'cursor-not-allowed opacity-30 border-zinc-200 dark:border-zinc-800'
            : 'cursor-pointer'
        } ${
          selected
            ? 'bg-zinc-900 border-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-900'
            : 'bg-white border-zinc-300 dark:bg-zinc-950 dark:border-zinc-700 hover:border-zinc-400'
        }`}
      >
        {selected ? <Check className="size-2.5 stroke-[3]" /> : null}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
            {item.questionNo ? `第 ${item.questionNo} 题` : `#${item.serialNo ?? item.id.slice(0, 6)}`}
          </span>
          {item.formatIssue?.code === 'inline_image_reference_mismatch' ? (
            <SpecBadge variant="danger">题图风险</SpecBadge>
          ) : null}
          {hasFormulaRenderRisk(item) ? (
            <SpecBadge variant="warning">公式未规范</SpecBadge>
          ) : null}
          <SpecBadge variant={bankStatusVariant(item.bankStatus, item)}>
            {bankStatusLabel(item.bankStatus, item)}
          </SpecBadge>
          {item.questionType && item.questionType !== 'OCR题' ? (
            <SpecBadge variant="default" className="text-zinc-600 dark:text-zinc-400">{item.questionType}</SpecBadge>
          ) : null}
          {item.pendingBankReadOnly ? (
            <SpecBadge variant="danger">无候选</SpecBadge>
          ) : null}
          {item.similarQuestions?.length ? (
            <SpecBadge variant="warning">疑似重复</SpecBadge>
          ) : null}
        </div>
        {item.hasFigures || item.similarQuestions?.length ? (
          <div className="flex items-center gap-2 mt-1.5">
            {item.hasFigures ? <ImageIcon className="size-3.5 text-zinc-400 dark:text-zinc-500" /> : null}
            {item.similarQuestions?.length ? <AlertTriangle className="size-3.5 text-amber-500 animate-pulse" /> : null}
          </div>
        ) : null}
        {preview ? (
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 font-normal">{preview}</p>
        ) : null}
      </div>
    </div>
  )
}

// ── Bulk Action Bar ─────────────────────────────────────────────────

function BulkActionBar({ count, busy, onConfirm, onSkip, onDelete }: {
  count: number
  busy: boolean
  onConfirm: () => void
  onSkip: () => void
  onDelete: () => void
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  return (
    <div className="sticky bottom-0 z-50 w-full border-t border-zinc-200 bg-white/80 py-4 px-6 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80 flex items-center justify-between shadow-[0_-4px_20px_rgba(0,0,0,0.03)] mt-4 rounded-xl border">
      <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">已选择 {count} 道题目，可执行批量操作</span>
      <div className="flex items-center gap-2">
        <Button size="sm" icon={BadgeCheck} disabled={busy} onClick={onConfirm}>确认入库 {count} 题</Button>
        <Button size="sm" variant="outline" icon={SkipForward} disabled={busy} onClick={onSkip}>跳过</Button>
        <div className="relative">
          <Button size="sm" variant="outline" icon={ChevronDown} disabled={busy} onClick={() => setMoreOpen(!moreOpen)}>更多</Button>
          {moreOpen ? (
            <div className="absolute right-0 bottom-full z-10 mb-1.5 w-36 rounded-md border border-zinc-200 bg-white/95 py-1 text-zinc-950 shadow-md backdrop-blur-sm animate-in fade-in-50 duration-100 dark:border-zinc-800 dark:bg-zinc-950/95 dark:text-zinc-50">
              <button
                className="w-full text-left px-3 py-2 text-xs hover:bg-red-50 dark:hover:bg-red-950/20 text-red-600 flex items-center gap-2 cursor-pointer transition-colors"
                onClick={() => { setMoreOpen(false); onDelete() }}
              >
                <Trash2 className="size-3.5" />批量删除
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// ── Preview Panel ───────────────────────────────────────────────────

function PreviewPanel({ item, busy, onConfirm, onEdit, onReOcr, rerunUnavailable, onCrop, onSkip, onDelete, onSaveInline }: {
  item: QuestionItem
  busy: boolean
  onConfirm: () => void
  onEdit: () => void
  onReOcr: () => void
  rerunUnavailable: boolean
  onCrop: () => void
  onSkip: () => void
  onDelete: () => void
  onSaveInline?: (id: string, patch: Partial<QuestionItem>) => Promise<void>
}) {
  const [previewMode, setPreviewMode] = useState<'content' | 'images'>('content')
  const analysisFigures = figuresByUsage(item.figures, 'analysis')
  const isOcrFailed = !item.stemMarkdown || item.stemMarkdown.trim() === ''
  const readOnlyFailure = Boolean(item.pendingBankReadOnly)
  const hasImageAssets = Boolean(item.sliceImagePath || item.solutionImagePath || item.ocrSegmentImages?.length)

  useEffect(() => {
    setPreviewMode('content')
  }, [item.id])

  return (
    <div className="flex h-full flex-col">
      {/* Action bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-zinc-100 bg-zinc-50/50 px-5 py-4 dark:border-zinc-900 dark:bg-zinc-900/10">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {item.questionNo ? `第 ${item.questionNo} 题` : `#${item.serialNo ?? item.id.slice(0, 6)}`}
          </span>
          <SpecBadge variant={bankStatusVariant(item.bankStatus, item)}>
            {bankStatusLabel(item.bankStatus, item)}
          </SpecBadge>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="bg-zinc-100/80 dark:bg-zinc-900/80 p-0.5 rounded-lg border border-zinc-200/50 dark:border-zinc-800/50 inline-flex h-8 select-none items-center justify-center">
            <button
              className={`cursor-pointer rounded-sm px-2.5 py-1 text-xs font-medium transition-all select-none ${previewMode === 'content' ? 'bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-xs border border-zinc-200/20' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'}`}
              onClick={() => setPreviewMode('content')}
            >
              识别结果
            </button>
            <button
              className={`cursor-pointer rounded-sm px-2.5 py-1 text-xs font-medium transition-all select-none ${previewMode === 'images' ? 'bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-xs border border-zinc-200/20' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'}`}
              onClick={() => setPreviewMode('images')}
            >
              原图 / OCR 图块
            </button>
          </div>
          <Button size="sm" icon={BadgeCheck} disabled={busy || readOnlyFailure || isOcrFailed || item.bankStatus === 'banked'} onClick={onConfirm}>确认入库</Button>
          <Button size="sm" variant="outline" icon={Edit3} disabled={busy} onClick={onEdit}>编辑题目</Button>
          <Button size="sm" variant="outline" icon={Crop} disabled={busy || readOnlyFailure} onClick={onCrop}>框选题图</Button>
          <MoreActionsDropdown busy={busy || readOnlyFailure} onReOcr={rerunUnavailable ? undefined : onReOcr} onSkip={onSkip} onDelete={onDelete} />
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {item.mergeStatus ? (
          <div className={`flex items-start gap-3 rounded-lg border p-3 text-xs ${
            item.mergeStatus === 'merged'
              ? 'border-emerald-200 bg-emerald-50/30 text-emerald-800 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-400'
              : 'border-amber-200 bg-amber-50/30 text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-400'
          }`}>
            <AlertTriangle className={`size-4 mt-0.5 shrink-0 ${item.mergeStatus === 'merged' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`} />
            <div>
              <p className="font-semibold text-[13px]">{mergeStatusLabel(item.mergeStatus)}</p>
              {item.mergeNote ? <p className="mt-1 text-zinc-600 dark:text-zinc-400 leading-relaxed">{item.mergeNote}</p> : null}
            </div>
          </div>
        ) : null}
        {item.needsFormatReview && item.formatIssue ? (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/30 p-3 text-xs text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-400">
            <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-[13px]">
                {item.formatIssue.code === 'inline_image_reference_mismatch'
                  ? '需要确认题图'
                  : item.formatIssue.code === 'unplaced_attachment'
                  ? '有人工图框未在文本中定位'
                  : '公式未规范化'}
              </p>
              <p className="mt-1 text-zinc-600 dark:text-zinc-400 leading-relaxed">{item.formatIssue.message || '可阅读，入库和导出前需修复。'}</p>
            </div>
          </div>
        ) : null}
        {(() => {
          const unplaced = (item.figures ?? []).filter((f: any) => f.ocrBinding?.enabled && f.ocrBinding?.status === 'unplaced')
          if (!unplaced.length) return null
          return (
            <div className="rounded-xl border border-orange-200 bg-orange-50/20 p-4 shadow-sm dark:border-orange-900/30 dark:bg-orange-950/10">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="size-4.5 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm text-orange-900 dark:text-orange-400">检测到 {unplaced.length} 张未定位的人工框选图</p>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">请选择将其放置在文本中（追加在段尾）或忽略该警告：</p>
                  
                  <div className="mt-3.5 space-y-3">
                    {unplaced.map((fig: any) => {
                      const figureId = fig.ocrBinding.attachmentId || fig.id
                      const blockId = `cut_inline_${fig.usage || 'stem'}_${figureId}`
                      const imageUrl = fig.path ? `/assets/${fig.path}` : ''
                      return (
                        <div key={fig.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-zinc-200/60 bg-white p-3 rounded-lg dark:border-zinc-800 dark:bg-zinc-950/80">
                          <div className="flex items-center gap-3">
                            {imageUrl ? (
                              <img
                                src={imageUrl}
                                alt={figureId}
                                className="h-12 w-auto max-w-[120px] rounded border border-zinc-200 object-contain dark:border-zinc-800 bg-zinc-50"
                              />
                            ) : (
                              <div className="h-12 w-16 rounded border border-zinc-200 bg-zinc-100 flex items-center justify-center text-[10px] text-zinc-400">无图</div>
                            )}
                            <div>
                              <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">附件 {figureId}</span>
                              <span className="ml-2 rounded-md bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                                {fig.usage === 'options' ? `选项 ${fig.optionLabel || ''}` : fig.usage === 'analysis' ? '解析' : '题干'}
                              </span>
                            </div>
                          </div>
                          
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                const newFigures = item.figures.map((f: any) => {
                                  if (f.id === fig.id) {
                                    return { ...f, usage: 'stem', category: 'stem', blockId, ocrBinding: { ...f.ocrBinding, status: 'bound' } }
                                  }
                                  return f
                                })
                                const newStem = `${item.stemMarkdown || ''}\n\n<!-- DOC2X_FIGURE:${blockId} -->\n\n`
                                await onSaveInline?.(item.id, { stemMarkdown: newStem, figures: newFigures })
                              }}
                            >
                              插入题干
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                const newFigures = item.figures.map((f: any) => {
                                  if (f.id === fig.id) {
                                    return { ...f, usage: 'analysis', category: 'analysis', blockId, ocrBinding: { ...f.ocrBinding, status: 'bound' } }
                                  }
                                  return f
                                })
                                const newAnalysis = `${item.analysisMarkdown || ''}\n\n<!-- DOC2X_FIGURE:${blockId} -->\n\n`
                                await onSaveInline?.(item.id, { analysisMarkdown: newAnalysis, figures: newFigures })
                              }}
                            >
                              插入解析
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                const newFigures = item.figures.map((f: any) => {
                                  if (f.id === fig.id) {
                                    return { ...f, ocrBinding: { ...f.ocrBinding, status: 'ignored' } }
                                  }
                                  return f
                                })
                                await onSaveInline?.(item.id, { figures: newFigures })
                              }}
                            >
                              忽略
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )
        })()}
        {previewMode === 'images' ? (
          hasImageAssets ? (
            <div className="space-y-4">
              {item.sliceImagePath ? (
                <ContentSection title="原题切片">
                  <img
                    src={`/assets/${item.sliceImagePath}`}
                    alt="原题切片"
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700"
                    loading="lazy"
                  />
                </ContentSection>
              ) : null}

              {item.solutionImagePath ? (
                <ContentSection title="解析裁图">
                  <img
                    src={`/assets/${item.solutionImagePath}`}
                    alt="解析裁图"
                    className="max-h-[42rem] w-auto max-w-full rounded-lg border border-zinc-200 bg-white dark:border-zinc-700"
                  />
                </ContentSection>
              ) : null}

              {item.ocrSegmentImages?.length ? (
                <ContentSection title="OCR 图块">
                  <div className="grid grid-cols-3 gap-2">
                    {item.ocrSegmentImages.map((seg, i) => (
                      <div key={i} className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-white dark:bg-zinc-950">
                        <img src={`/assets/${seg.path}`} alt={seg.label} className="w-full" loading="lazy" />
                        <p className="text-[10px] text-center py-1 text-zinc-500 dark:text-zinc-400 bg-zinc-50/50 dark:bg-zinc-900/30 border-t border-zinc-100 dark:border-zinc-900">{seg.label}</p>
                      </div>
                    ))}
                  </div>
                </ContentSection>
              ) : null}
            </div>
          ) : (
            <SpecEmpty text="无可用图像" description="当前题目没有关联的原图或 OCR 图块" />
          )
        ) : (
          <>
            {/* OCR Failed notice */}
            {isOcrFailed ? (
              <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50/30 p-3 text-xs text-red-800 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">
                <AlertTriangle className="size-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-[13px]">识别失败</p>
                  <p className="mt-1 text-zinc-600 dark:text-zinc-400 leading-relaxed">OCR 未能提取到可用内容。{rerunUnavailable ? 'Doc2X 首版请使用整批完全重跑，或手动编辑补录。' : '建议重新 OCR。'}</p>
                  {readOnlyFailure ? <p className="mt-1 text-zinc-500 dark:text-zinc-500">这道题尚未生成待入库候选，可打开编辑题目手动补录，或只重跑当前题 OCR。</p> : null}
                </div>
              </div>
            ) : null}

            {/* Stem */}
            {item.stemMarkdown ? (
              <ContentSection title="题干">
                <QuestionMarkdownContent content={item.stemMarkdown} figures={item.figures} />
              </ContentSection>
            ) : null}

            {/* Answer */}
            {item.answerText ? (
              <ContentSection title="答案">
                <MarkdownWithInlineFigures content={item.answerText} figures={item.figures} />
              </ContentSection>
            ) : null}

            {/* Analysis */}
            {item.analysisMarkdown ? (
              <ContentSection title="解析">
                <MarkdownWithInlineFigures content={item.analysisMarkdown} figures={analysisFigures} />
                {analysisFigures.filter((figure) => !String(item.analysisMarkdown || '').includes(`DOC2X_FIGURE:${String(figure.blockId || figure.id)}`)).length ? (
                  <div className="mt-3 flex gap-2 flex-wrap">
                    {analysisFigures.filter((figure) => !String(item.analysisMarkdown || '').includes(`DOC2X_FIGURE:${String(figure.blockId || figure.id)}`)).map((fig, i) => (
                      <img key={i} src={`/assets/${fig.path}`} alt={`解析图 ${i + 1}`} className="max-h-40 rounded-lg border border-zinc-200 dark:border-zinc-800" loading="lazy" />
                    ))}
                  </div>
                ) : null}
              </ContentSection>
            ) : null}

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-3">
              {item.knowledgePoints?.length ? (
                <MetaField label="知识点" value={item.knowledgePoints.filter(Boolean).join('、') || '—'} />
              ) : null}
              {item.solutionMethods?.length ? (
                <MetaField label="解题方法" value={item.solutionMethods.filter(Boolean).join('、') || '—'} />
              ) : null}
              <MetaField label="难度" value={item.difficultyLabel || `${item.difficultyScore10 || item.difficultyScore || '—'}`} />
              <MetaField label="题型" value={item.questionType || '—'} />
            </div>

            {item.similarQuestions?.length ? (
              <div className="flex items-start gap-3 rounded-lg border border-amber-250 bg-amber-50/30 p-3 text-xs text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-400">
                <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[13px]">疑似重复</p>
                  <div className="mt-2 space-y-2">
                    {item.similarQuestions.map((candidate) => (
                      <div key={candidate.id} className="rounded-xl border border-amber-200/50 bg-white/80 p-3 shadow-xs dark:border-amber-900/30 dark:bg-zinc-950/80">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-zinc-900 dark:text-zinc-50">
                            {candidate.questionNo ? `第 ${candidate.questionNo} 题` : candidate.id.slice(0, 8)}
                          </span>
                          <SpecBadge variant="warning">{Math.round(candidate.similarity * 100)}% 相似度</SpecBadge>
                        </div>
                        <p className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                          {similarQuestionOriginLabel(item, candidate)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{candidate.sourceTitle || '题库主库'}</p>
                        {candidate.stemPreview ? <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300 line-clamp-2">{candidate.stemPreview}</p> : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

          </>
        )}
      </div>
    </div>
  )
}

function ContentSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="p-4 border-b border-zinc-100 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-900/10 py-2.5">
        <p className="text-xs font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</p>
      </div>
      <div className="p-4 text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-300">{children}</div>
    </div>
  )
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-950 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 truncate text-sm font-bold text-zinc-900 dark:text-zinc-50" title={value}>{value}</p>
    </div>
  )
}

function MoreActionsDropdown({ busy, onReOcr, onSkip, onDelete }: {
  busy: boolean
  onReOcr?: () => void
  onSkip: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button size="sm" variant="outline" icon={ChevronDown} disabled={busy} onClick={() => setOpen(!open)}>更多</Button>
      {open ? (
        <div className="absolute right-0 top-full z-10 mt-1.5 w-36 rounded-md border border-zinc-200 bg-white/95 py-1 text-zinc-950 shadow-md backdrop-blur-sm animate-in fade-in-50 duration-100 dark:border-zinc-800 dark:bg-zinc-950/95 dark:text-zinc-50">
          {onReOcr ? <DropdownItem icon={ScanSearch} label="重新 OCR" onClick={() => { setOpen(false); onReOcr() }} /> : null}
          <DropdownItem icon={SkipForward} label="跳过此题" onClick={() => { setOpen(false); onSkip() }} />
          <DropdownItem icon={Trash2} label="删除此题" danger onClick={() => { setOpen(false); onDelete() }} />
        </div>
      ) : null}
    </div>
  )
}

function DropdownItem({ icon: Icon, label, danger, onClick }: { icon: typeof RefreshCcw; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 cursor-pointer transition-colors
        ${danger
          ? 'hover:bg-red-50 dark:hover:bg-red-950/20 text-red-600'
          : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900'
        }`}
      onClick={onClick}
    >
      <Icon className="size-3.5" />{label}
    </button>
  )
}

// ── Similarity Review Dialog ────────────────────────────────────────

function questionTitle(item: Pick<QuestionItem, 'questionNo' | 'serialNo' | 'id'>) {
  return item.questionNo ? `第 ${item.questionNo} 题` : `#${item.serialNo ?? item.id.slice(0, 6)}`
}

function SimilarityReviewDialog({ items, confirmText, onProceed, onCancel }: SimilarityReviewDialogProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [candidateIndexByItem, setCandidateIndexByItem] = useState<Record<string, number>>({})
  const activeItem = items[Math.min(activeIndex, Math.max(items.length - 1, 0))]
  const candidates = activeItem?.similarQuestions ?? []
  const candidateIndex = Math.min(candidateIndexByItem[activeItem?.id || ''] ?? 0, Math.max(candidates.length - 1, 0))
  const candidate = candidates[candidateIndex]
  const sameRun = activeItem && candidate ? isSameRunSimilarQuestion(activeItem, candidate) : false

  useEffect(() => {
    if (activeIndex >= items.length) setActiveIndex(0)
  }, [activeIndex, items.length])

  if (!activeItem || !candidate) return null

  function setCandidateIndex(index: number) {
    setCandidateIndexByItem((prev) => ({ ...prev, [activeItem.id]: index }))
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="flex h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-2xl animate-in zoom-in-95 duration-150">
        <div className="shrink-0 border-b border-zinc-100 dark:border-zinc-900 px-5 py-4 bg-zinc-50/50 dark:bg-zinc-900/10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">存在疑似重复题</h3>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                检测到 {items.length} 组相似内容。请核对两侧题目，确认不是重复后再入库。当前右侧显示的是{sameRun ? '本批次内重复' : '题库历史重复'}。
              </p>
            </div>
            <button
              className="rounded-lg p-2 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors cursor-pointer"
              onClick={onCancel}
              aria-label="关闭"
            >
              <X className="size-5" />
            </button>
          </div>

          {items.length > 1 ? (
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {items.map((item, index) => {
                const top = item.similarQuestions?.[0]
                return (
                  <button
                    key={item.id}
                    className={`shrink-0 rounded-md border px-3 py-2 text-left text-xs transition-all cursor-pointer ${
                      index === activeIndex
                        ? 'border-zinc-900 bg-zinc-900 text-zinc-50 dark:border-zinc-100 dark:bg-zinc-50 dark:text-zinc-900 font-semibold'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900'
                    }`}
                    onClick={() => setActiveIndex(index)}
                  >
                    <span className="font-semibold">{questionTitle(item)}</span>
                    {top ? <span className="ml-2 opacity-80">{Math.round(top.similarity * 100)}%</span> : null}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 bg-zinc-50/10 dark:bg-zinc-900/5">
          <div className="grid min-h-full grid-cols-2 gap-4">
            <SimilarityQuestionPane
              label="待入库题"
              title={questionTitle(activeItem)}
              sourceTitle={activeItem.sourceTitle}
              questionType={activeItem.questionType}
              stemMarkdown={activeItem.stemMarkdown}
              answerText={activeItem.answerText}
              analysisMarkdown={activeItem.analysisMarkdown}
            />
            <SimilarityQuestionPane
              label={sameRun ? '本批次相似题' : '题库相似题'}
              title={candidate.questionNo ? `第 ${candidate.questionNo} 题` : candidate.id.slice(0, 8)}
              sourceTitle={candidate.sourceTitle}
              originLabel={similarQuestionOriginLabel(activeItem, candidate)}
              questionType={candidate.questionType}
              similarity={candidate.similarity}
              stemMarkdown={candidate.stemMarkdown || candidate.stemPreview}
              answerText={candidate.answerText}
              analysisMarkdown={candidate.analysisMarkdown}
              candidates={candidates}
              candidateIndex={candidateIndex}
              onCandidateChange={setCandidateIndex}
            />
          </div>
        </div>

        <div className="shrink-0 border-t border-zinc-100 dark:border-zinc-900 bg-zinc-50/10 dark:bg-zinc-900/5 px-5 py-4">
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onCancel}>返回核对</Button>
            <Button size="sm" onClick={onProceed}>{confirmText}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SimilarityQuestionPane({
  label,
  title,
  sourceTitle,
  originLabel,
  questionType,
  similarity,
  stemMarkdown,
  answerText,
  analysisMarkdown,
  candidates,
  candidateIndex,
  onCandidateChange,
}: {
  label: string
  title: string
  sourceTitle?: string
  originLabel?: string
  questionType?: string
  similarity?: number
  stemMarkdown: string
  answerText?: string
  analysisMarkdown?: string
  candidates?: NonNullable<QuestionItem['similarQuestions']>
  candidateIndex?: number
  onCandidateChange?: (index: number) => void
}) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
      <div className="shrink-0 border-b border-zinc-100 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-900/10 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>
            <h4 className="mt-1 truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</h4>
            <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">{sourceTitle || '未标注来源'}{questionType ? ` · ${questionType}` : ''}</p>
            {originLabel ? <p className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">{originLabel}</p> : null}
          </div>
          {typeof similarity === 'number' ? (
            <div className="shrink-0 rounded-lg bg-amber-50 text-amber-700 border border-amber-100 px-2.5 py-1 text-sm font-semibold dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30">
              {Math.round(similarity * 100)}% 相似度
            </div>
          ) : null}
        </div>
        {candidates && candidates.length > 1 && onCandidateChange ? (
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            {candidates.map((candidate, index) => (
              <button
                key={candidate.id}
                className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-all cursor-pointer ${
                  index === candidateIndex
                    ? 'bg-zinc-950 text-white shadow-sm dark:bg-zinc-50 dark:text-zinc-950 font-semibold'
                    : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-950 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
                onClick={() => onCandidateChange(index)}
              >
                相似题 {index + 1} · {Math.round(candidate.similarity * 100)}%
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
        <ContentSection title="题干">
          {stemMarkdown ? <QuestionMarkdownContent content={stemMarkdown} /> : <span className="text-zinc-400">暂无题干</span>}
        </ContentSection>
        {answerText ? (
          <ContentSection title="答案">
            <MarkdownContent content={answerText} />
          </ContentSection>
        ) : null}
        {analysisMarkdown ? (
          <ContentSection title="解析">
            <MarkdownContent content={analysisMarkdown} />
          </ContentSection>
        ) : null}
      </div>
    </div>
  )
}

// ── Confirm Dialog ──────────────────────────────────────────────────

type ConfirmDialogProps = {
  title: string
  message: string
  danger: boolean
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({ title, message, danger, confirmText = '确认', cancelText = '取消', onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-2xl p-5 space-y-4 animate-in zoom-in-95 duration-100">
        <div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</h3>
          <p className="mt-1.5 whitespace-pre-line text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">{message}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onCancel}>{cancelText}</Button>
          <Button size="sm" variant={danger ? 'danger' : 'default'} onClick={onConfirm}>{confirmText}</Button>
        </div>
      </div>
    </div>
  )
}

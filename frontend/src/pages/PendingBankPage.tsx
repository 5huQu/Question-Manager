import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  CheckSquare,
  ChevronDown,
  Edit3,
  Eye,
  ImageIcon,
  LoaderCircle,
  RefreshCcw,
  ScanSearch,
  SkipForward,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { api, jsonHeaders } from '../api/client'
import { MarkdownContent } from '../components/MarkdownContent'
import { EditDialog } from '../components/questions/EditDialog'
import { MarkdownWithInlineFigures, QuestionMarkdownContent } from '../components/questions/QuestionContent'
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

// ── Main Page ────────────────────────────────────────────────────────

function canConfirmDirectly(item: QuestionItem) {
  return !item.pendingBankReadOnly && item.bankStatus === 'ready' && Boolean(item.stemMarkdown?.trim())
}

function canSelectForBulk(item: QuestionItem) {
  return !item.pendingBankReadOnly
}

function similarItems(items: QuestionItem[]) {
  return items.filter((item) => (item.similarQuestions?.length ?? 0) > 0)
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
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogProps | null>(null)
  const [similarityReview, setSimilarityReview] = useState<SimilarityReviewDialogProps | null>(null)
  const [actionNotice, setActionNotice] = useState('')
  const [actionBusy, setActionBusy] = useState(false)

  const url = useMemo(() => {
    const params = new URLSearchParams()
    if (filter !== 'all') params.set('filter', filter)
    return `/api/tools/pdf-slicer/runs/${encodeURIComponent(decodedRunId)}/pending-bank?${params.toString()}`
  }, [decodedRunId, filter])

  const { data, error, loading, reload } = useAsync<PendingBankResponse>(() => api(url), [url])

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
      ? await api<QuestionItem>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(decodedRunId)}/pending-bank/manual-candidate`, {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({ item: nextDraft }),
        })
      : await api<QuestionItem>(`/api/question-bank/items/${encodeURIComponent(editingItem.id)}`, {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify({ item: nextDraft }),
        })
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
      const result = await api<BulkActionResult>(
        `/api/tools/pdf-slicer/runs/${encodeURIComponent(decodedRunId)}/pending-bank/${endpoint}`,
        { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ questionIds: ids, ...extraBody }) }
      )
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
      const result = await api<BulkActionResult>(
        `/api/tools/pdf-slicer/runs/${encodeURIComponent(decodedRunId)}/pending-bank/bulk-confirm`,
        { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ all: true }) }
      )
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
            await api(`/api/tools/pdf-slicer/runs/${encodeURIComponent(decodedRunId)}/pending-bank/${encodeURIComponent(id)}/rerun-ocr`, { method: 'POST' })
          } else {
            await api(`/api/question-bank/items/${encodeURIComponent(id)}/rerun-ocr`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ route: 'whole_question_json' }) })
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

  if (loading && !data) return <Empty text="读取中..." />
  if (error || !data) return <Empty text={error || '批次不存在或无数据'} />

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
    <section className="flex h-[calc(100vh-3rem)] flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">系统功能 / OCR 队列 / 待入库确认</p>
            <h2 className="text-base font-bold mt-0.5 text-zinc-900 dark:text-zinc-50">
              待入库确认
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">复核 OCR 结果，确认后进入题库核心主库。</p>
          </div>
          <div className="flex gap-2">
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
        <div className="shrink-0 flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 mt-2 mx-1">
          {actionBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4 text-emerald-500" />}
          <span>{actionNotice}</span>
        </div>
      ) : null}

      {/* Bulk action bar */}
      {selectedIds.size > 0 ? (
        <BulkActionBar
          count={selectedIds.size}
          busy={actionBusy}
          onConfirm={handleBulkConfirm}
          onSkip={handleBulkSkip}
          onDelete={handleBulkDelete}
        />
      ) : null}

      {/* Main content: left list + right preview */}
      <div className="flex flex-1 min-h-0 mt-2 gap-3">
        {/* Left: Question list */}
        <div className="w-[38%] min-w-[280px] shrink-0 flex flex-col border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-500 dark:text-zinc-400">
            <button onClick={selectAll} className="flex items-center gap-1.5 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer transition-colors">
              {allSelectableSelected
                ? <CheckSquare className="size-3.5 text-zinc-900 dark:text-white" />
                : <Square className="size-3.5" />
              }
              <span>{selectLabel}</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-6 text-center text-sm text-zinc-400">当前筛选条件下没有题目</div>
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
        <div className="flex-1 min-w-0 border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 overflow-hidden">
          {activeItem ? (
            <PreviewPanel
              item={activeItem}
              busy={actionBusy}
              onConfirm={() => confirmSingle(activeItem.id)}
              onEdit={() => openEditor(activeItem)}
              onReOcr={() => reOcrSingle(activeItem.id)}
              rerunUnavailable={data?.run.ocrProvider === 'doc2x'}
              onSkip={() => skipSingle(activeItem.id)}
              onDelete={() => deleteSingle(activeItem.id)}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-zinc-400 dark:text-zinc-500">
              <div className="text-center space-y-2">
                <Eye className="size-8 mx-auto opacity-40" />
                <p>点击左侧题目查看详情</p>
              </div>
            </div>
          )}
        </div>
      </div>

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
      {confirmDialog ? <ConfirmDialog {...confirmDialog} /> : null}
      {similarityReview ? <SimilarityReviewDialog {...similarityReview} /> : null}
    </section>
  )
}

// ── Batch Overview ──────────────────────────────────────────────────

function BatchOverview({ run, summary }: { run: ApiRun; summary: PendingBankSummary }) {
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
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate">{run.paperTitle || run.pdfName}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{statusMessage}</p>
        </div>
        <Badge variant={run.sourceFileKind === '讲义型' ? 'warning' : 'default'}>
          {run.sourceFileKind || '未确认'}
        </Badge>
      </div>
      <div className="grid grid-cols-5 gap-2">
        <MetricChip label="总题数" value={summary.total} />
        <MetricChip label="可入库" value={summary.ready} color="emerald" />
        <MetricChip label="需处理" value={summary.blocked} color="amber" />
        <MetricChip label="已入库" value={summary.banked} color="blue" />
        <MetricChip label="已跳过" value={summary.skipped} color="zinc" />
      </div>
    </div>
  )
}

function MetricChip({ label, value, color }: { label: string; value: number; color?: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    blue: 'text-blue-600 dark:text-blue-400',
    zinc: 'text-zinc-500 dark:text-zinc-400',
  }
  const valueColor = color ? colorMap[color] || '' : 'text-zinc-900 dark:text-zinc-100'
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 px-2.5 py-2 text-center">
      <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={`mt-0.5 text-lg font-bold ${valueColor}`}>{value}</p>
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
    <div className="flex gap-1.5 flex-wrap">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onFilterChange(tab.key)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all cursor-pointer
            ${filter === tab.key
              ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-sm'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
            }`}
        >
          {tab.label}
          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold
            ${filter === tab.key
              ? 'bg-white/20 dark:bg-zinc-900/20'
              : 'bg-zinc-200 dark:bg-zinc-700'
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
      className={`flex items-start gap-2 px-3 py-2.5 cursor-pointer border-b border-zinc-100 dark:border-zinc-800 transition-colors
        ${active ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onSelect() }}
        disabled={!selectable}
        className={`mt-0.5 shrink-0 ${selectable ? 'cursor-pointer' : 'cursor-not-allowed opacity-30'}`}
      >
        {selected
          ? <CheckSquare className="size-4 text-zinc-900 dark:text-white" />
          : <Square className="size-4 text-zinc-400" />
        }
      </button>
      <div className="min-w-0 flex-1" onClick={onClick}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {item.questionNo ? `第 ${item.questionNo} 题` : `#${item.serialNo ?? item.id.slice(0, 6)}`}
          </span>
          <Badge variant={bankStatusVariant(item.bankStatus, item)}>
            {bankStatusLabel(item.bankStatus, item)}
          </Badge>
          {item.questionType && item.questionType !== 'OCR题' ? (
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{item.questionType}</span>
          ) : null}
          {item.pendingBankReadOnly ? (
            <span className="text-[10px] text-red-500 dark:text-red-400">未生成候选</span>
          ) : null}
          {item.similarQuestions?.length ? (
            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">疑似重复</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 mt-1">
          {item.hasFigures ? <ImageIcon className="size-3 text-zinc-400" /> : null}
          {item.similarQuestions?.length ? <AlertTriangle className="size-3 text-amber-500" /> : null}
        </div>
        {preview ? (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed line-clamp-2">{preview}</p>
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
    <div className="shrink-0 flex items-center gap-2 mt-2 mx-1 px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 shadow-sm">
      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mr-1">已选 {count} 题</span>
      <Button size="sm" icon={BadgeCheck} disabled={busy} onClick={onConfirm}>确认入库 {count} 题</Button>
      <Button size="sm" variant="outline" icon={SkipForward} disabled={busy} onClick={onSkip}>跳过</Button>
      <div className="relative">
        <Button size="sm" variant="outline" icon={ChevronDown} disabled={busy} onClick={() => setMoreOpen(!moreOpen)}>更多</Button>
        {moreOpen ? (
          <div className="absolute top-full left-0 mt-1 z-10 w-36 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg py-1">
            <button
              className="w-full text-left px-3 py-2 text-xs hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 flex items-center gap-2 cursor-pointer"
              onClick={() => { setMoreOpen(false); onDelete() }}
            >
              <Trash2 className="size-3.5" />批量删除
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ── Preview Panel ───────────────────────────────────────────────────

function figuresByUsage(figures: QuestionFigure[], usage: string) {
  return figures.filter((fig) => String(fig.usage || 'stem') === usage)
}

function PreviewPanel({ item, busy, onConfirm, onEdit, onReOcr, rerunUnavailable, onSkip, onDelete }: {
  item: QuestionItem
  busy: boolean
  onConfirm: () => void
  onEdit: () => void
  onReOcr: () => void
  rerunUnavailable: boolean
  onSkip: () => void
  onDelete: () => void
}) {
  const [previewMode, setPreviewMode] = useState<'content' | 'images'>('content')
  const analysisFigures = figuresByUsage(item.figures, 'analysis')
  const isOcrFailed = !item.stemMarkdown || item.stemMarkdown.trim() === ''
  const readOnlyFailure = Boolean(item.pendingBankReadOnly)
  const hasImageAssets = Boolean(item.sliceImagePath || item.ocrSegmentImages?.length)

  useEffect(() => {
    setPreviewMode('content')
  }, [item.id])

  return (
    <div className="flex flex-col h-full">
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 shrink-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
            {item.questionNo ? `第 ${item.questionNo} 题` : `#${item.serialNo ?? item.id.slice(0, 6)}`}
          </span>
          <Badge variant={bankStatusVariant(item.bankStatus, item)}>
            {bankStatusLabel(item.bankStatus, item)}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-0.5">
            <button
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${previewMode === 'content' ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
              onClick={() => setPreviewMode('content')}
            >
              识别结果
            </button>
            <button
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${previewMode === 'images' ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
              onClick={() => setPreviewMode('images')}
            >
              原图 / OCR 图块
            </button>
          </div>
          <Button size="sm" icon={BadgeCheck} disabled={busy || readOnlyFailure || isOcrFailed || item.bankStatus === 'banked'} onClick={onConfirm}>确认入库</Button>
          <Button size="sm" variant="outline" icon={Edit3} disabled={busy} onClick={onEdit}>编辑题目</Button>
          {!rerunUnavailable ? <Button size="sm" variant="outline" icon={ScanSearch} disabled={busy} onClick={onReOcr}>重新 OCR</Button> : null}
          <MoreActionsDropdown busy={busy || readOnlyFailure} onSkip={onSkip} onDelete={onDelete} />
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {item.mergeStatus ? (
          <div className={`rounded-xl border px-3 py-2 text-xs ${
            item.mergeStatus === 'merged'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400'
              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400'
          }`}>
            <p className="font-semibold">{mergeStatusLabel(item.mergeStatus)}</p>
            {item.mergeNote ? <p className="mt-1">{item.mergeNote}</p> : null}
          </div>
        ) : null}
        {item.needsFormatReview && item.formatIssue ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <p className="font-semibold">需要确认题图</p>
            <p className="mt-1 leading-5">{item.formatIssue.message || '图片引用与本地切分题图不一致。'}</p>
          </div>
        ) : null}
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

              {item.ocrSegmentImages?.length ? (
                <ContentSection title="OCR 图块">
                  <div className="grid grid-cols-3 gap-2">
                    {item.ocrSegmentImages.map((seg, i) => (
                      <div key={i} className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                        <img src={`/assets/${seg.path}`} alt={seg.label} className="w-full" loading="lazy" />
                        <p className="text-[10px] text-center py-1 text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800">{seg.label}</p>
                      </div>
                    ))}
                  </div>
                </ContentSection>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-700 px-4 py-8 text-center text-sm text-zinc-400">
              当前题目没有原图或 OCR 图块。
            </div>
          )
        ) : (
          <>
            {/* OCR Failed notice */}
            {isOcrFailed ? (
              <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                <p className="font-semibold">识别失败</p>
                <p className="mt-1 text-xs">OCR 未能提取到可用内容。{rerunUnavailable ? 'Doc2X 首版请使用整批完全重跑，或手动编辑补录。' : '建议重新 OCR。'}</p>
                {readOnlyFailure ? <p className="mt-1 text-xs">这道题尚未生成待入库候选，可打开编辑题目手动补录，或只重跑当前题 OCR。</p> : null}
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
                  <div className="mt-2 flex gap-2 flex-wrap">
                    {analysisFigures.filter((figure) => !String(item.analysisMarkdown || '').includes(`DOC2X_FIGURE:${String(figure.blockId || figure.id)}`)).map((fig, i) => (
                      <img key={i} src={`/assets/${fig.path}`} alt={`解析图 ${i + 1}`} className="max-h-40 rounded-lg border" loading="lazy" />
                    ))}
                  </div>
                ) : null}
              </ContentSection>
            ) : null}

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-2">
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
              <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <p className="font-semibold">疑似重复</p>
                <div className="mt-2 space-y-2">
                  {item.similarQuestions.map((candidate) => (
                    <div key={candidate.id} className="rounded-lg border border-amber-200/70 dark:border-amber-800/70 bg-white/60 dark:bg-zinc-900/40 px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {candidate.questionNo ? `第 ${candidate.questionNo} 题` : candidate.id.slice(0, 8)}
                        </span>
                        <span>{Math.round(candidate.similarity * 100)}%</span>
                      </div>
                      <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">{candidate.sourceTitle || '题库主库'}</p>
                      {candidate.stemPreview ? <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300 line-clamp-2">{candidate.stemPreview}</p> : null}
                    </div>
                  ))}
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
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/30 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800/60">
        <p className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{title}</p>
      </div>
      <div className="px-3 py-2.5 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">{children}</div>
    </div>
  )
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/30 px-3 py-2">
      <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-0.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">{value}</p>
    </div>
  )
}

function MoreActionsDropdown({ busy, onSkip, onDelete }: {
  busy: boolean
  onSkip: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button size="sm" variant="outline" icon={ChevronDown} disabled={busy} onClick={() => setOpen(!open)}>更多</Button>
      {open ? (
        <div className="absolute top-full right-0 mt-1 z-10 w-36 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg py-1">
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
          ? 'hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300'
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

  useEffect(() => {
    if (activeIndex >= items.length) setActiveIndex(0)
  }, [activeIndex, items.length])

  if (!activeItem || !candidate) return null

  function setCandidateIndex(index: number) {
    setCandidateIndexByItem((prev) => ({ ...prev, [activeItem.id]: index }))
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
      <div className="flex h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-950">
        <div className="shrink-0 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">存在疑似重复题</h3>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                检测到 {items.length} 组相似内容。请核对两侧题目，确认不是重复后再入库。
              </p>
            </div>
            <button
              className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
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
                    className={`shrink-0 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      index === activeIndex
                        ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950'
                        : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
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

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
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
              label="题库相似题"
              title={candidate.questionNo ? `第 ${candidate.questionNo} 题` : candidate.id.slice(0, 8)}
              sourceTitle={candidate.sourceTitle}
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

        <div className="shrink-0 border-t border-zinc-200 bg-zinc-50 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
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
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="shrink-0 border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</p>
            <h4 className="mt-1 truncate text-base font-semibold text-zinc-950 dark:text-zinc-50">{title}</h4>
            <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">{sourceTitle || '未标注来源'}{questionType ? ` · ${questionType}` : ''}</p>
          </div>
          {typeof similarity === 'number' ? (
            <div className="shrink-0 rounded-lg bg-amber-100 px-2.5 py-1 text-sm font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
              {Math.round(similarity * 100)}%
            </div>
          ) : null}
        </div>
        {candidates && candidates.length > 1 && onCandidateChange ? (
          <div className="mt-3 flex gap-1.5 overflow-x-auto">
            {candidates.map((candidate, index) => (
              <button
                key={candidate.id}
                className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  index === candidateIndex
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 p-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
          <p className="mt-1.5 whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">{message}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onCancel}>{cancelText}</Button>
          <Button size="sm" variant={danger ? 'danger' : 'default'} onClick={onConfirm}>{confirmText}</Button>
        </div>
      </div>
    </div>
  )
}

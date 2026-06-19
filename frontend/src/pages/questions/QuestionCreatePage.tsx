import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  Check,
  CheckCircle,
  CheckSquare,
  Code,
  Columns3,
  Copy,
  Eye,
  EyeOff,
  FileStack,
  FileText,
  FolderOpen,
  Info as InfoIcon,
  PencilLine,
  PictureInPicture2,
  Plus,
  RefreshCcw,
  Scissors,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react'
import { api, jsonHeaders } from '@/api/client'
import { Modal } from '@/components/dialogs/Modal'
import { QuestionContent } from '@/components/questions/QuestionContent'
import { Button } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { Dashboard, QuestionItem, RichBlock, SliceReviewItem, TagLibraries } from '@/types'
import { buildFullPaperOcrPrompt, singleQuestionOcrPrompt } from '@/constants/ocrPrompts'
import {
  buildJsonParseHint,
  cleanAiJsonText,
  cleanJsonBackslashes,
  comparableQuestionNo,
  jsonErrorPosition,
  jsonErrorSnippet,
  paragraphBlocksFromText,
  parsePaperQuestionsFromJsonText,
  questionField,
} from '@/utils/jsonCleanup'

type NoticeType = 'info' | 'success' | 'error'
type Draft = {
  questionNo: string
  stage: string
  questionType: string
  sourceTitle: string
  problemText: string
  answerText: string
  analysisText: string
}

const editorInputClass = 'w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-xs outline-none transition-all placeholder:text-zinc-400 focus:border-sky-600 focus:ring-2 focus:ring-sky-600/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-sky-400 dark:focus:ring-sky-400/15'
const smallLabelClass = 'block text-[10px] font-bold text-zinc-400 dark:text-zinc-500'

function questionFromUnknown(question: unknown, fallback: Draft): Draft {
  return {
    questionNo: questionField(question, ['question_no', 'questionNo']) || fallback.questionNo,
    stage: questionField(question, ['stage']) || fallback.stage,
    questionType: questionField(question, ['question_type', 'questionType']) || fallback.questionType,
    sourceTitle: questionField(question, ['source_title', 'sourceTitle', 'paperTitle']) || fallback.sourceTitle,
    problemText: questionField(question, ['problem_text', 'stemMarkdown', 'problemText']) || fallback.problemText,
    answerText: questionField(question, ['answer', 'answerText']) || fallback.answerText,
    analysisText: questionField(question, ['analysis', 'analysisMarkdown', 'analysisText']) || fallback.analysisText,
  }
}

function statusTone(text: string): NoticeType {
  if (text.includes('失败') || text.includes('没有') || text.includes('错误') || text.includes('不一致') || text.includes('请选择')) return 'error'
  if (text.includes('已') || text.includes('成功') || text.includes('通过')) return 'success'
  return 'info'
}

export function QuestionCreatePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [target, setTarget] = useState<'single' | 'paper'>('single')
  const [method, setMethod] = useState<'direct' | 'ai'>('direct')
  const [singleMethod, setSingleMethod] = useState<'form' | 'json'>('form')
  const [layoutMode, setLayoutMode] = useState<'split' | 'tabs'>('split')
  const [notice, setNoticeText] = useState('')
  const [noticeType, setNoticeType] = useState<NoticeType>('info')
  const [pendingBankUrl, setPendingBankUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [promptModalOpen, setPromptModalOpen] = useState(false)
  const [importingPaper, setImportingPaper] = useState(false)
  const [showAnswerPreview, setShowAnswerPreview] = useState(false)
  const [singleJsonText, setSingleJsonText] = useState('')
  const [singleDraft, setSingleDraft] = useState<Draft>({
    questionNo: '',
    stage: '高三',
    questionType: '单选题',
    sourceTitle: '',
    problemText: '',
    answerText: '',
    analysisText: '',
  })
  const [choiceOptions, setChoiceOptions] = useState({ A: '', B: '', C: '', D: '' })
  const [choiceAnswers, setChoiceAnswers] = useState({ A: false, B: false, C: false, D: false })
  const [paperDraft, setPaperDraft] = useState({ sourceTitle: '', stage: '高三', jsonText: '' })
  const [paperImportSource, setPaperImportSource] = useState<'plain' | 'slices'>('plain')
  const [selectedSliceRunId, setSelectedSliceRunId] = useState('')
  const [stemTab, setStemTab] = useState<'edit' | 'preview'>('edit')
  const [analysisTab, setAnalysisTab] = useState<'edit' | 'preview'>('edit')
  const [paperJsonScrollTop, setPaperJsonScrollTop] = useState(0)
  const problemTextRef = useRef<HTMLTextAreaElement>(null)
  const analysisTextRef = useRef<HTMLTextAreaElement>(null)
  const paperJsonLineCount = useMemo(() => Math.max(1, paperDraft.jsonText.split('\n').length), [paperDraft.jsonText])

  function setNotice(text: string, type: NoticeType = statusTone(text)) {
    setNoticeText(text)
    setNoticeType(type)
  }

  const paperJsonStatus = useMemo(() => {
    const text = paperDraft.jsonText.trim()
    if (!text) return { status: 'empty' as const }
    try {
      const parsed = parsePaperQuestionsFromJsonText(text)
      if (parsed.questions.length > 0) {
        return {
          status: 'valid' as const,
          count: parsed.questions.length,
          cleanedText: parsed.cleaned,
          changes: parsed.changes,
          questions: parsed.questions,
          previews: parsed.previews,
          issueCount: parsed.previews.reduce((sum, item) => sum + item.issues.length + (item.needsHumanReview ? 1 : 0), 0),
        }
      }
      return { status: 'empty_array' as const, error: '未找到含有题目的 questions 数组或数组为空', cleanedText: parsed.cleaned, changes: parsed.changes }
    } catch (e) {
      const prepared = cleanAiJsonText(text)
      const { rawMessage, position } = jsonErrorPosition(e)
      return {
        status: 'invalid' as const,
        error: buildJsonParseHint(rawMessage, prepared.cleaned, position),
        cleanedText: prepared.cleaned,
        changes: prepared.changes,
        snippet: jsonErrorSnippet(prepared.cleaned, position),
      }
    }
  }, [paperDraft.jsonText])

  const singleJsonStatus = useMemo(() => {
    const text = singleJsonText.trim()
    if (!text) return { status: 'empty' as const }
    try {
      const parsed = parsePaperQuestionsFromJsonText(text)
      if (parsed.questions.length !== 1) return { status: 'invalid_count' as const, count: parsed.questions.length, cleanedText: parsed.cleaned, changes: parsed.changes }
      return { status: 'valid' as const, cleanedText: parsed.cleaned, changes: parsed.changes, question: parsed.questions[0], preview: parsed.previews[0] }
    } catch (e) {
      const prepared = cleanAiJsonText(text)
      const { rawMessage, position } = jsonErrorPosition(e)
      return {
        status: 'invalid' as const,
        error: buildJsonParseHint(rawMessage, prepared.cleaned, position),
        cleanedText: prepared.cleaned,
        changes: prepared.changes,
        snippet: jsonErrorSnippet(prepared.cleaned, position),
      }
    }
  }, [singleJsonText])

  const sliceDashboard = useAsync<Dashboard>(() => api('/api/tools/pdf-slicer/dashboard'), [])
  const selectableSliceRuns = useMemo(() => {
    return (sliceDashboard.data?.runs ?? [])
      .filter((run) => run.totalQuestions > 0 || run.approvedQuestions > 0)
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
  }, [sliceDashboard.data?.runs])
  const selectedSliceRun = selectableSliceRuns.find((run) => run.runId === selectedSliceRunId) ?? null
  const sliceReview = useAsync<{ summary: Record<string, number>; items: SliceReviewItem[] }>(() => {
    if (!selectedSliceRunId) return Promise.resolve({ summary: {}, items: [] })
    return api(`/api/tools/pdf-slicer/runs/${encodeURIComponent(selectedSliceRunId)}/slice-review/items`)
  }, [selectedSliceRunId])
  const slicePairStatus = useMemo(() => {
    if (paperImportSource !== 'slices') return null
    const items = sliceReview.data?.items ?? []
    const questions = paperJsonStatus.status === 'valid' ? paperJsonStatus.questions : []
    const rows = Array.from({ length: Math.max(items.length, questions.length) }, (_, index) => {
      const item = items[index]
      const preview = paperJsonStatus.status === 'valid' ? paperJsonStatus.previews[index] : undefined
      const sliceNo = item?.questionLabel || String(index + 1)
      const jsonNo = preview?.questionNo || ''
      const sliceComparable = comparableQuestionNo(sliceNo)
      const jsonComparable = comparableQuestionNo(jsonNo)
      const status = !item
        ? 'missing_slice'
        : !preview
          ? 'missing_json'
          : sliceComparable && jsonComparable && sliceComparable !== jsonComparable
            ? 'mismatch'
            : 'ok'
      return { index, item, preview, sliceNo, jsonNo, status }
    })
    return {
      rows,
      blockingCount: rows.filter((row) => row.status !== 'ok').length,
      pendingReviewCount: items.filter((item) => item.reviewStatus !== 'ready_for_ocr').length,
      itemCount: items.length,
      jsonCount: questions.length,
    }
  }, [paperImportSource, paperJsonStatus, sliceReview.data?.items])
  const sliceAlreadyImported = paperImportSource === 'slices'
    && Boolean(selectedSliceRun && slicePairStatus?.itemCount)
    && (selectedSliceRun?.importedQuestions ?? 0) >= (slicePairStatus?.itemCount ?? 0)
  const canImportPaper = paperJsonStatus.status === 'valid' && (paperImportSource !== 'slices' || Boolean(selectedSliceRunId && slicePairStatus && slicePairStatus.blockingCount === 0))
  const createTagLibraries = useAsync<TagLibraries>(() => api('/api/question-bank/tag-libraries'), [])
  const fullPaperAiPrompt = useMemo(() => buildFullPaperOcrPrompt(createTagLibraries.data), [createTagLibraries.data])
  const activeAiPrompt = target === 'single' ? singleQuestionOcrPrompt : fullPaperAiPrompt

  useEffect(() => {
    const queryTarget = searchParams.get('target')
    const queryMethod = searchParams.get('method')
    const querySource = searchParams.get('source')
    const queryRunId = searchParams.get('runId')
    const queryPrompt = searchParams.get('prompt')
    if (queryTarget === 'paper') setTarget('paper')
    if (queryMethod === 'direct' || queryMethod === 'ai') setMethod(queryMethod)
    if (querySource === 'slices') setPaperImportSource('slices')
    if (queryRunId) setSelectedSliceRunId(queryRunId)
    if (queryPrompt === 'paper') setPromptModalOpen(true)
  }, [searchParams])

  useEffect(() => {
    if (!selectedSliceRun || paperDraft.sourceTitle.trim()) return
    setPaperDraft((current) => ({ ...current, sourceTitle: selectedSliceRun.paperTitle || selectedSliceRun.pdfName || current.sourceTitle }))
  }, [paperDraft.sourceTitle, selectedSliceRun])

  function updateDraft(patch: Partial<Draft>) {
    setSingleDraft((current) => ({ ...current, ...patch }))
  }

  function insertLatex(type: 'math' | 'block' | 'frac' | 'sqrt' | 'alpha' | 'theta', field: 'problemText' | 'analysisText') {
    const snippets = {
      math: '$$',
      block: '$$\n\n$$',
      frac: '\\frac{}{}',
      sqrt: '\\sqrt{}',
      alpha: '\\alpha',
      theta: '\\theta',
    }
    const snippet = snippets[type]
    const textarea = field === 'problemText' ? problemTextRef.current : analysisTextRef.current
    const start = textarea?.selectionStart ?? singleDraft[field].length
    const end = textarea?.selectionEnd ?? start
    const nextValue = `${singleDraft[field].slice(0, start)}${snippet}${singleDraft[field].slice(end)}`
    const cursorOffset = type === 'math' ? 1 : type === 'block' ? 3 : snippet.length
    setSingleDraft((current) => ({ ...current, [field]: nextValue }))
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(start + cursorOffset, start + cursorOffset)
    })
    setNotice(`已插入 LaTeX 占位符: ${snippet}`, 'info')
  }

  function toggleAnswer(option: keyof typeof choiceAnswers) {
    setChoiceAnswers((current) => {
      const next = { ...current, [option]: !current[option] }
      const answerText = (['A', 'B', 'C', 'D'] as const).filter((key) => next[key]).join(', ')
      updateDraft({ answerText })
      setNotice(answerText ? `已将答案设置为 ${answerText}` : '已清空选择题答案', 'success')
      return next
    })
  }

  async function createQuestionFromDraft(draft: Draft) {
    const isChoice = draft.questionType === '单选题' || draft.questionType === '多选题'
    const choiceBlock: RichBlock[] = isChoice
      ? [{
        type: 'choices',
        options: ['A', 'B', 'C', 'D'].map((labelText) => ({
          label: labelText,
          blocks: paragraphBlocksFromText(choiceOptions[labelText as keyof typeof choiceOptions].trim()),
        })).filter((option) => option.blocks.length),
      }]
      : []
    const item = await api<QuestionItem>('/api/question-bank/items', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        ...draft,
        sourceTitle: draft.sourceTitle.trim() || '手动创建',
        stemMarkdown: draft.problemText,
        analysisMarkdown: draft.analysisText,
        problemBlocks: [...paragraphBlocksFromText(draft.problemText), ...choiceBlock],
        answerBlocks: paragraphBlocksFromText(draft.answerText),
        analysisBlocks: paragraphBlocksFromText(draft.analysisText),
      }),
    })
    navigate(`/questions/${encodeURIComponent(item.id)}`)
  }

  async function createSingle(event: FormEvent) {
    event.preventDefault()
    await createQuestionFromDraft(singleDraft)
  }

  async function createSingleFromJson(event: FormEvent) {
    event.preventDefault()
    if (singleJsonStatus.status !== 'valid') {
      setNotice('请先修正 JSON，确保只包含 1 道题。', 'error')
      return
    }
    await createQuestionFromDraft(questionFromUnknown(singleJsonStatus.question, singleDraft))
  }

  async function importPaper(event: FormEvent) {
    event.preventDefault()
    setPendingBankUrl('')
    if (paperJsonStatus.status !== 'valid') {
      setNotice('请先修正 JSON，直到检查结果显示可以导入。', 'error')
      return
    }
    if (paperImportSource === 'slices') {
      if (!selectedSliceRunId) {
        setNotice('请选择一个已切分的 PDF 批次。', 'error')
        return
      }
      if (!slicePairStatus || slicePairStatus.blockingCount > 0) {
        setNotice('题块与 JSON 的数量或题号仍不一致，请修正后再导入。', 'error')
        return
      }
      if (sliceAlreadyImported) {
        navigate(`/tools/pdf-slicer/runs/${encodeURIComponent(selectedSliceRunId)}/pending-bank`)
        return
      }
    }
    setImportingPaper(true)
    try {
      const endpoint = paperImportSource === 'slices' ? '/api/question-bank/import-json-from-slices' : '/api/question-bank/import-json'
      const result = await api<{ items: QuestionItem[]; count: number; pendingBankUrl?: string }>(endpoint, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          questions: paperJsonStatus.questions,
          runId: selectedSliceRunId,
          sourceTitle: paperDraft.sourceTitle || selectedSliceRun?.paperTitle || 'AI 识别导入',
          stage: paperDraft.stage,
        }),
      })
      if (result.pendingBankUrl) {
        setPendingBankUrl(result.pendingBankUrl)
        setNotice(`已导入 ${result.count} 道题，题号校验通过。请进入待入库确认完成最终入库。`, 'success')
        return
      }
      setNotice(`已导入 ${result.count} 道题。`, 'success')
      if (result.items[0]?.id) navigate(`/questions/${encodeURIComponent(result.items[0].id)}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setImportingPaper(false)
    }
  }

  function cleanPaperJsonBackslashes() {
    const { cleaned, changed } = cleanJsonBackslashes(paperDraft.jsonText)
    setPaperDraft({ ...paperDraft, jsonText: cleaned })
    setNotice(changed > 0 ? `已清洗 ${changed} 处反斜杠。` : '未发现需要清洗的反斜杠。', changed > 0 ? 'success' : 'info')
  }

  function applyPaperJsonCleanup() {
    if (!('cleanedText' in paperJsonStatus) || !paperJsonStatus.cleanedText) return
    setPaperDraft({ ...paperDraft, jsonText: paperJsonStatus.cleanedText })
    setNotice('已应用自动预处理结果。', 'success')
  }

  function applySingleJsonCleanup() {
    if (!('cleanedText' in singleJsonStatus) || !singleJsonStatus.cleanedText) return
    setSingleJsonText(singleJsonStatus.cleanedText)
    setNotice('已应用单题 JSON 自动预处理结果。', 'success')
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(activeAiPrompt)
    setCopied(true)
    setNotice('提示词已成功复制到剪贴板！', 'success')
    setTimeout(() => setCopied(false), 2000)
  }

  async function copyFullPaperPrompt() {
    await navigator.clipboard.writeText(fullPaperAiPrompt)
    setCopied(true)
    setNotice('整套导入提示词已复制到剪贴板。', 'success')
    setTimeout(() => setCopied(false), 2000)
  }

  async function openSelectedPdfFolder() {
    if (!selectedSliceRunId) return
    await api(`/api/tools/pdf-slicer/runs/${encodeURIComponent(selectedSliceRunId)}/open-folder`, { method: 'POST' })
  }

  const choiceEntries = ['A', 'B', 'C', 'D'] as const
  const previewBlocks = useMemo(() => paragraphBlocksFromText(singleDraft.problemText), [singleDraft.problemText])
  const answerPreviewBlocks = useMemo(() => paragraphBlocksFromText(singleDraft.answerText), [singleDraft.answerText])
  const analysisPreviewBlocks = useMemo(() => paragraphBlocksFromText(singleDraft.analysisText), [singleDraft.analysisText])

  function renderNotice() {
    if (!notice) return null
    const tone = {
      success: 'border-emerald-200 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200',
      error: 'border-red-200 bg-red-50/80 text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-200',
      info: 'border-sky-200 bg-sky-50/80 text-sky-800 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-200',
    }[noticeType]
    const Icon = noticeType === 'success' ? CheckCircle : noticeType === 'error' ? AlertTriangle : InfoIcon
    return (
      <div className={`flex items-start gap-3 rounded-2xl border p-4 text-xs font-semibold shadow-sm ${tone}`}>
        <Icon className="mt-0.5 size-4 shrink-0" />
        <span className="flex-1 leading-normal">{notice}</span>
        {pendingBankUrl && notice.includes('待入库确认') ? (
          <Button asLink to={pendingBankUrl} size="sm" icon={BadgeCheck} className="shrink-0">
            进入待入库确认
          </Button>
        ) : null}
        <button type="button" onClick={() => { setNoticeText(''); setPendingBankUrl('') }} className="opacity-60 transition-opacity hover:opacity-100">
          <X className="size-4" />
        </button>
      </div>
    )
  }

  function renderJsonLineNumbers(lineCount: number, scrollTop = 0) {
    return (
      <div className="w-11 shrink-0 overflow-hidden border-r border-zinc-800 bg-zinc-900/70 py-3.5 font-mono text-[10px] leading-5 text-zinc-500 select-none">
        <div style={{ transform: `translateY(-${scrollTop}px)` }}>
          {Array.from({ length: lineCount }, (_, index) => <div key={index + 1} className="pr-2 text-right tabular-nums">{index + 1}</div>)}
        </div>
      </div>
    )
  }

  function renderJsonError(status: Extract<typeof paperJsonStatus | typeof singleJsonStatus, { status: 'invalid' }>) {
    return (
      <div className="space-y-3 rounded-xl border border-red-200/60 bg-red-50/60 p-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-200">
        <div className="flex items-start gap-2">
          <X className="mt-0.5 size-3.5 shrink-0" />
          <span>JSON 语法错误: <code className="rounded bg-red-100/60 px-1 py-0.5 font-mono text-[10px] break-all dark:bg-red-900/40">{status.error}</code></span>
        </div>
        {status.snippet ? (
          <div className="overflow-hidden rounded-lg border border-red-200/50 bg-white/80 font-mono text-[10px] leading-5 text-zinc-700 dark:border-red-900/40 dark:bg-zinc-950/60 dark:text-zinc-200">
            {status.snippet.rows.map((row) => (
              <div key={row.line} className={row.active ? 'bg-red-100/70 dark:bg-red-950/40' : ''}>
                <span className="inline-block w-10 select-none border-r border-red-100 px-2 text-right text-zinc-400 dark:border-red-900/40">{row.line}</span>
                <span className="whitespace-pre-wrap px-2">{row.content || ' '}</span>
                {row.active ? (
                  <div>
                    <span className="inline-block w-10 border-r border-red-100 px-2 dark:border-red-900/40" />
                    <span className="px-2 text-red-600">{`${' '.repeat(Math.max(0, status.snippet.column - 1))}^ 第 ${status.snippet.column} 列`}</span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <section className="space-y-6">
      {promptModalOpen ? (
        <Modal title="整套 JSON 导入提示词" desc="复制后发送给大模型，再把返回的 JSON 粘贴到本页导入。" onClose={() => setPromptModalOpen(false)} wide>
          <div className="grid gap-4 lg:grid-cols-[3fr_1fr]">
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-950 text-zinc-100 shadow-md dark:border-zinc-800">
              <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="size-3 rounded-full bg-red-500/85" />
                  <span className="size-3 rounded-full bg-amber-500/85" />
                  <span className="size-3 rounded-full bg-emerald-500/85" />
                  <span className="ml-2 font-mono text-[10px] font-semibold text-zinc-400">paper_ocr_prompt.md</span>
                </div>
                <button type="button" onClick={copyFullPaperPrompt} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-800 px-3 text-[10px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white">
                  {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                  {copied ? '已复制' : '复制提示词'}
                </button>
              </div>
              <pre className="max-h-[62vh] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-5 text-zinc-300 select-all">{fullPaperAiPrompt}</pre>
            </div>
            <aside className="space-y-3">
              <div className="rounded-xl border bg-white p-4 text-xs text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                <h4 className="flex items-center gap-2 border-b pb-2 font-bold text-zinc-800 dark:text-zinc-100"><BookOpen className="size-4 text-sky-600" />AI 识别说明</h4>
                <ol className="mt-3 list-decimal space-y-2 pl-4 leading-5">
                  <li>复制左侧代码窗口右上角的预设提示词。</li>
                  <li>将提示词与题图或 PDF 一并发送给大模型。</li>
                  <li>复制返回的 JSON，回到本页导入。</li>
                </ol>
              </div>
              {selectedSliceRunId ? <Button className="w-full justify-start" variant="outline" icon={FolderOpen} onClick={openSelectedPdfFolder}>打开 PDF 文件夹</Button> : null}
            </aside>
          </div>
        </Modal>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">新建试题 / 试卷导入</h1>
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">通过公式助手和分屏实时渲染编辑单题，或使用 JSON 解析器进行单题与整卷结构化导入。</p>
        </div>
        <span className="w-fit rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-700 dark:bg-sky-950/30 dark:text-sky-300">Premium Layout v2</span>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-6">
          <div className="space-y-5 rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900">
            <div>
              <h3 className="text-xs font-bold tracking-wide text-zinc-900 dark:text-white">录入配置</h3>
              <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">快速设定您的录入工作模式</p>
            </div>
            <div className="space-y-2">
              <label className="block text-[9px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">创建对象</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'single' as const, title: '单道试题', desc: '单题精细/源码录入', Icon: FileText },
                  { key: 'paper' as const, title: '整套试卷', desc: '粘贴 JSON 批量导入', Icon: FileStack },
                ].map(({ key, title, desc, Icon }) => (
                  <button key={key} type="button" onClick={() => setTarget(key)} className={`flex flex-col rounded-xl border p-3 text-left transition-all ${target === key ? 'border-sky-600 bg-sky-50/60 text-sky-800 shadow-[0_0_12px_rgba(2,132,199,0.08)] dark:border-sky-400 dark:bg-sky-950/20 dark:text-sky-300' : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:border-zinc-700'}`}>
                    <span className="flex items-center justify-between gap-2 text-xs font-bold">{title}<Icon className="size-3.5 opacity-70" /></span>
                    <span className="mt-1.5 text-[9px] leading-normal text-zinc-400 dark:text-zinc-500">{desc}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-[9px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">录入方式</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'direct' as const, title: '直接录入', desc: target === 'single' ? '表单填写/源码导入' : '粘贴 JSON 导入', Icon: PencilLine },
                  { key: 'ai' as const, title: 'AI 辅助', desc: '获取 OCR 提示词模板', Icon: Sparkles },
                ].map(({ key, title, desc, Icon }) => (
                  <button key={key} type="button" onClick={() => setMethod(key)} className={`flex flex-col rounded-xl border p-3 text-left transition-all ${method === key ? 'border-sky-600 bg-sky-50/60 text-sky-800 shadow-[0_0_12px_rgba(2,132,199,0.08)] dark:border-sky-400 dark:bg-sky-950/20 dark:text-sky-300' : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:border-zinc-700'}`}>
                    <span className="flex items-center justify-between gap-2 text-xs font-bold">{title}<Icon className="size-3.5 opacity-70" /></span>
                    <span className="mt-1.5 text-[9px] leading-normal text-zinc-400 dark:text-zinc-500">{desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {method === 'ai' ? (
            <div className="space-y-4 rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-5 dark:border-zinc-800/80 dark:bg-zinc-900/40">
              <h4 className="flex items-center gap-2 border-b border-zinc-100 pb-2.5 text-xs font-bold text-zinc-800 dark:border-zinc-800 dark:text-zinc-200"><BookOpen className="size-4 text-sky-600 dark:text-sky-400" />AI 识别说明</h4>
              <ol className="list-decimal space-y-3.5 pl-4 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                <li>复制右侧面板中的专用 OCR 提示词。</li>
                <li>打开大模型平台，将提示词与试卷图片/PDF 文件一并发送。</li>
                <li>将模型生成的 JSON 复制回来。</li>
                <li><button type="button" className="font-bold text-sky-700 underline dark:text-sky-300" onClick={() => setMethod('direct')}>切回直接录入</button>，粘贴 JSON 后导入。</li>
              </ol>
            </div>
          ) : null}

          {renderNotice()}
        </aside>

        <div className="min-w-0 space-y-6">
          {method === 'direct' && target === 'single' ? (
            <div className="space-y-6">
              <div className="flex gap-1 rounded-2xl border border-zinc-200/80 bg-white p-1.5 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900">
                <button type="button" onClick={() => setSingleMethod('form')} className={`flex-1 rounded-xl py-2 text-xs font-semibold transition-all flex items-center justify-center gap-2 ${singleMethod === 'form' ? 'bg-sky-700 text-white shadow-md shadow-sky-500/10' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-200'}`}><PencilLine className="size-4" />手动表单录入</button>
                <button type="button" onClick={() => setSingleMethod('json')} className={`flex-1 rounded-xl py-2 text-xs font-semibold transition-all flex items-center justify-center gap-2 ${singleMethod === 'json' ? 'bg-sky-700 text-white shadow-md shadow-sky-500/10' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-200'}`}><Code className="size-4" />JSON 单题录入</button>
              </div>

              {singleMethod === 'form' ? (
                <form className="space-y-6" onSubmit={createSingle}>
                  <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900">
                    <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/40 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/40"><Settings2 className="size-4 text-sky-600 dark:text-sky-400" /><h2 className="text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">1. 基本属性设定</h2></div>
                    <div className="grid gap-4 p-6 grid-cols-2 md:grid-cols-4">
                      <label className="space-y-1.5"><span className={smallLabelClass}>题号 / 序号</span><input className={editorInputClass} placeholder="例：1" value={singleDraft.questionNo} onChange={(e) => updateDraft({ questionNo: e.target.value })} /></label>
                      <label className="space-y-1.5"><span className={smallLabelClass}>学段</span><input className={editorInputClass} placeholder="例：高三" value={singleDraft.stage} onChange={(e) => updateDraft({ stage: e.target.value })} /></label>
                      <label className="space-y-1.5"><span className={smallLabelClass}>题型</span><select className={editorInputClass} value={singleDraft.questionType} onChange={(e) => updateDraft({ questionType: e.target.value })}><option value="单选题">单选题</option><option value="多选题">多选题</option><option value="填空题">填空题</option><option value="解答题">解答题</option></select></label>
                      <label className="space-y-1.5"><span className={smallLabelClass}>来源 / 试卷</span><input className={editorInputClass} placeholder="例：2026年深圳一调物理" value={singleDraft.sourceTitle} onChange={(e) => updateDraft({ sourceTitle: e.target.value })} /></label>
                    </div>
                  </section>

                  <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900">
                    <div className="flex flex-col gap-3 border-b border-zinc-100 bg-zinc-50/40 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/40 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2"><FileText className="size-4 text-sky-600 dark:text-sky-400" /><h2 className="text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">2. 题干与选项设定</h2></div>
                      <div className="flex w-fit rounded-lg border border-zinc-200/60 bg-zinc-100/70 p-0.5 text-[9px] dark:border-zinc-800 dark:bg-zinc-800">
                        <button type="button" onClick={() => setLayoutMode('split')} className={`flex items-center gap-1 rounded-md px-2 py-0.5 ${layoutMode === 'split' ? 'bg-white font-bold text-sky-700 shadow-sm dark:bg-zinc-700 dark:text-white' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}><Columns3 className="size-3" />实时分屏</button>
                        <button type="button" onClick={() => setLayoutMode('tabs')} className={`flex items-center gap-1 rounded-md px-2 py-0.5 ${layoutMode === 'tabs' ? 'bg-white font-bold text-sky-700 shadow-sm dark:bg-zinc-700 dark:text-white' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}><PictureInPicture2 className="size-3" />单栏标签</button>
                      </div>
                    </div>
                    <div className="space-y-6 p-6">
                      {layoutMode === 'split' ? (
                        <div className="grid gap-6 lg:grid-cols-2">
                          <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/50 dark:border-zinc-700 dark:bg-zinc-950/20">
                            <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-100/50 px-3.5 py-2 dark:border-zinc-700 dark:bg-zinc-900/60"><span className="font-mono text-[9px] font-bold uppercase tracking-widest text-zinc-400">LaTeX Source Editor</span><span className="size-2 rounded-full bg-sky-500" /></div>
                            <textarea ref={problemTextRef} className="min-h-40 w-full resize-y border-0 bg-transparent p-4 font-mono text-xs leading-relaxed outline-none text-zinc-800 dark:text-zinc-100" placeholder="请输入题干，数学公式请使用 $...$ 或 $$...$$" value={singleDraft.problemText} onChange={(e) => updateDraft({ problemText: e.target.value })} />
                            <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-200 bg-zinc-100/40 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/40">
                              <span className="mr-1 text-[8px] font-bold uppercase tracking-wide text-zinc-400">公式快捷键:</span>
                              {(['math', 'block', 'frac', 'sqrt', 'alpha', 'theta'] as const).map((type) => <button key={type} type="button" onClick={() => insertLatex(type, 'problemText')} className="h-6 rounded border border-zinc-200 bg-white px-2 font-mono text-[10px] text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">{type === 'math' ? '$...$' : type === 'block' ? '$$...$$' : `\\${type}`}</button>)}
                            </div>
                          </div>
                          <div className="paper-grid flex flex-col overflow-hidden rounded-xl border border-zinc-200 shadow-sm dark:border-zinc-700">
                            <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-100/40 px-3.5 py-2 dark:border-zinc-700 dark:bg-zinc-900/60"><span className="font-mono text-[9px] font-bold uppercase tracking-widest text-zinc-400">Live Paper Render</span><span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[8px] font-bold uppercase text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">Realtime</span></div>
                            <div className="min-h-40 flex-1 overflow-y-auto p-5 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                              <div className="flex gap-2"><span className="font-bold text-zinc-950 dark:text-white">{singleDraft.questionNo ? `${singleDraft.questionNo}.` : '1.'}</span><div className="min-w-0 flex-1">{singleDraft.problemText.trim() ? <QuestionContent blocks={previewBlocks} /> : <p className="text-xs italic text-zinc-400">无内容，请在左侧编辑器中输入文本或 LaTeX</p>}</div></div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">题干内容</span><div className="flex rounded-lg border border-zinc-200 bg-zinc-100 p-0.5 text-[10px] dark:border-zinc-700 dark:bg-zinc-800"><button type="button" onClick={() => setStemTab('edit')} className={`rounded px-2.5 py-0.5 ${stemTab === 'edit' ? 'bg-white font-bold shadow-sm dark:bg-zinc-700' : 'text-zinc-500'}`}>编辑</button><button type="button" onClick={() => setStemTab('preview')} className={`rounded px-2.5 py-0.5 ${stemTab === 'preview' ? 'bg-white font-bold shadow-sm dark:bg-zinc-700' : 'text-zinc-500'}`}>预览</button></div></div>
                          {stemTab === 'edit' ? <textarea ref={problemTextRef} className={`${editorInputClass} min-h-32 font-mono leading-relaxed`} value={singleDraft.problemText} onChange={(e) => updateDraft({ problemText: e.target.value })} /> : <div className="min-h-32 rounded-xl border border-zinc-200 bg-white/60 p-4 text-sm dark:border-zinc-700 dark:bg-zinc-900/40">{singleDraft.problemText.trim() ? <QuestionContent blocks={previewBlocks} /> : <span className="text-xs italic text-zinc-400">无内容预览。</span>}</div>}
                        </div>
                      )}

                      {(singleDraft.questionType === '单选题' || singleDraft.questionType === '多选题') ? (
                        <div className="space-y-3 pt-2">
                          <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">选择题选项（点击字母或 Check 设为正确答案）</label>
                          <div className="grid gap-3 sm:grid-cols-2">
                            {choiceEntries.map((labelText) => (
                              <div key={labelText} className={`relative flex items-center gap-3 overflow-hidden rounded-xl border bg-white px-3.5 py-2.5 shadow-sm transition-all dark:bg-zinc-900 ${choiceAnswers[labelText] ? 'border-emerald-500 ring-2 ring-emerald-500/10' : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600'}`}>
                                {choiceAnswers[labelText] ? <div className="absolute inset-y-0 left-0 w-1 bg-emerald-500" /> : null}
                                <button type="button" onClick={() => toggleAnswer(labelText)} className={`flex size-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold transition-colors ${choiceAnswers[labelText] ? 'bg-emerald-500 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'}`}>{labelText}</button>
                                <input className="min-w-0 flex-1 bg-transparent text-xs outline-none" placeholder={`请输入选项 ${labelText}`} value={choiceOptions[labelText]} onChange={(e) => setChoiceOptions({ ...choiceOptions, [labelText]: e.target.value })} />
                                <button type="button" onClick={() => toggleAnswer(labelText)} className={`rounded-lg p-1 transition-colors ${choiceAnswers[labelText] ? 'text-emerald-500' : 'text-zinc-300 hover:bg-zinc-100 hover:text-zinc-500 dark:hover:bg-zinc-800'}`}><Check className="size-4" /></button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </section>

                  <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900">
                    <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/40 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/40"><CheckSquare className="size-4 text-sky-600 dark:text-sky-400" /><h2 className="text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">3. 答案与详细解析</h2></div>
                    <div className="grid gap-6 p-6 md:grid-cols-2">
                      <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/50 dark:border-zinc-700 dark:bg-zinc-950/20"><div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-100/50 px-3.5 py-2.5 dark:border-zinc-700 dark:bg-zinc-900/60"><span className="font-mono text-[9px] font-bold uppercase tracking-widest text-zinc-400">Correct Answer</span><CheckCircle className="size-3.5 text-zinc-400" /></div><textarea className="min-h-36 w-full resize-y border-0 bg-transparent p-4 font-mono text-xs leading-relaxed outline-none" placeholder="请输入答案内容。若为选择题，建议使用上方 Check 自动填入。" value={singleDraft.answerText} onChange={(e) => updateDraft({ answerText: e.target.value })} /></div>
                      <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/50 dark:border-zinc-700 dark:bg-zinc-950/20"><div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-100/50 px-3.5 py-2.5 dark:border-zinc-700 dark:bg-zinc-900/60"><span className="font-mono text-[9px] font-bold uppercase tracking-widest text-zinc-400">Detailed Analysis</span><div className="flex gap-1.5">{(['math', 'block', 'frac'] as const).map((type) => <button key={type} type="button" onClick={() => insertLatex(type, 'analysisText')} className="rounded border border-zinc-200 bg-white px-1 font-mono text-[8px] text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">{type === 'math' ? '$' : type === 'block' ? '$$' : '\\frac'}</button>)}</div></div><textarea ref={analysisTextRef} className="min-h-36 w-full resize-y border-0 bg-transparent p-4 font-mono text-xs leading-relaxed outline-none" placeholder="输入解题思路与解析步骤，公式请使用 LaTeX。" value={singleDraft.analysisText} onChange={(e) => updateDraft({ analysisText: e.target.value })} /></div>
                    </div>
                    <div className="flex flex-col gap-4 border-t border-zinc-100 px-6 pb-6 pt-2 dark:border-zinc-800">
                      <div className="flex justify-center"><button type="button" onClick={() => setShowAnswerPreview((v) => !v)} className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-700 shadow-sm transition-all hover:border-sky-500 hover:bg-sky-50/20 hover:text-sky-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-sky-300">{showAnswerPreview ? <EyeOff className="size-4" /> : <Eye className="size-4" />}{showAnswerPreview ? '收起答案与解析渲染预览' : '展开答案与解析渲染预览'}</button></div>
                      {showAnswerPreview ? <div className="paper-grid grid gap-6 rounded-xl border border-sky-200 bg-zinc-50/50 p-5 dark:border-sky-900/40 dark:bg-zinc-950/20 md:grid-cols-2"><div className="space-y-2"><span className="font-mono text-[9px] font-bold uppercase tracking-widest text-zinc-400">Answer Live Render</span><div className="min-h-24 rounded-lg border border-zinc-200/60 bg-white/95 p-4 text-xs leading-relaxed shadow-sm dark:border-zinc-800 dark:bg-zinc-900/95">{singleDraft.answerText.trim() ? <QuestionContent blocks={answerPreviewBlocks} /> : <span className="text-zinc-400">暂无答案。</span>}</div></div><div className="space-y-2"><span className="font-mono text-[9px] font-bold uppercase tracking-widest text-zinc-400">Analysis Live Render</span><div className="min-h-24 rounded-lg border border-zinc-200/60 bg-white/95 p-4 text-xs leading-relaxed shadow-sm dark:border-zinc-800 dark:bg-zinc-900/95">{singleDraft.analysisText.trim() ? <QuestionContent blocks={analysisPreviewBlocks} /> : <span className="text-zinc-400">暂无解析。</span>}</div></div></div> : null}
                    </div>
                  </section>
                  <div className="flex justify-end"><Button type="submit" icon={Plus}>创建题目</Button></div>
                </form>
              ) : (
                <form className="space-y-4 rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900" onSubmit={createSingleFromJson}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white"><Code className="size-4 text-sky-600" />JSON 单题录入</h2><p className="mt-1 text-[10px] text-zinc-400">支持单个题目对象、含 1 道题的 questions 数组或代码块粘贴。</p></div>{'changes' in singleJsonStatus && singleJsonStatus.changes.length ? <Button type="button" variant="outline" size="sm" icon={Check} onClick={applySingleJsonCleanup}>应用修复</Button> : null}</div>
                  <div className="flex h-80 overflow-hidden rounded-2xl border border-zinc-200/80 bg-zinc-950 focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/10 dark:border-zinc-800">{renderJsonLineNumbers(Math.max(1, singleJsonText.split('\n').length))}<textarea className="h-full min-w-0 flex-1 resize-none border-0 bg-transparent px-4 py-3.5 font-mono text-[11px] leading-5 text-zinc-100 outline-none placeholder:text-zinc-600" placeholder='例：{"questionNo":"1","questionType":"单选题","problemText":"已知...","answerText":"A","analysisText":"因为..."}' value={singleJsonText} onChange={(e) => setSingleJsonText(e.target.value)} spellCheck={false} /></div>
                  {singleJsonStatus.status === 'valid' ? <div className="rounded-xl border border-emerald-200/50 bg-emerald-50/60 p-3 text-xs text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200"><CheckCircle className="mr-2 inline size-4" />检查通过，题号 {singleJsonStatus.preview.questionNo || '1'}，可以创建。</div> : null}
                  {singleJsonStatus.status === 'invalid_count' ? <div className="rounded-xl border border-amber-200/60 bg-amber-50/60 p-3 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">当前 JSON 解析到 {singleJsonStatus.count} 道题；单题录入只接受 1 道题。多题请切换到整套试卷。</div> : null}
                  {singleJsonStatus.status === 'invalid' ? renderJsonError(singleJsonStatus) : null}
                  <div className="flex justify-end"><Button type="submit" icon={Plus} disabled={singleJsonStatus.status !== 'valid'}>创建题目</Button></div>
                </form>
              )}
            </div>
          ) : null}

          {method === 'direct' && target === 'paper' ? (
            <form className="space-y-6 rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900" onSubmit={importPaper}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5"><span className={smallLabelClass}>试卷名称 / 来源</span><input className={editorInputClass} placeholder="例：2026届广东省高三一调数学试题" value={paperDraft.sourceTitle} onChange={(e) => setPaperDraft({ ...paperDraft, sourceTitle: e.target.value })} /></label>
                <label className="space-y-1.5"><span className={smallLabelClass}>学段</span><input className={editorInputClass} placeholder="例：高三" value={paperDraft.stage} onChange={(e) => setPaperDraft({ ...paperDraft, stage: e.target.value })} /></label>
              </div>

              <section className="space-y-3 rounded-xl border border-zinc-200/60 bg-zinc-50/60 p-5 dark:border-zinc-800 dark:bg-zinc-900/40">
                <h4 className="flex items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-300"><Scissors className="size-4 text-zinc-400" />题块绑定</h4>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" aria-pressed={paperImportSource === 'plain'} onClick={() => setPaperImportSource('plain')} className={`relative rounded-xl border-2 px-3.5 py-3 text-left text-xs transition-all ${paperImportSource === 'plain' ? 'border-sky-600 bg-sky-50 text-sky-900 shadow-sm ring-2 ring-sky-500/20 dark:border-sky-400 dark:bg-sky-950/30 dark:text-sky-200' : 'border-zinc-200 bg-white/60 text-zinc-500 hover:border-zinc-300 hover:text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400'}`}>{paperImportSource === 'plain' ? <CheckCircle className="absolute right-3 top-3 size-4 text-sky-600 dark:text-sky-400" /> : null}<span className="block pr-6 font-semibold">仅导入 JSON</span><span className={`mt-0.5 block text-[10px] ${paperImportSource === 'plain' ? 'text-sky-700 dark:text-sky-300' : 'text-zinc-500'}`}>不关联 PDF 切分题块。</span></button>
                  <button type="button" aria-pressed={paperImportSource === 'slices'} onClick={() => setPaperImportSource('slices')} className={`relative rounded-xl border-2 px-3.5 py-3 text-left text-xs transition-all ${paperImportSource === 'slices' ? 'border-sky-600 bg-sky-50 text-sky-900 shadow-sm ring-2 ring-sky-500/20 dark:border-sky-400 dark:bg-sky-950/30 dark:text-sky-200' : 'border-zinc-200 bg-white/60 text-zinc-500 hover:border-zinc-300 hover:text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400'}`}>{paperImportSource === 'slices' ? <CheckCircle className="absolute right-3 top-3 size-4 text-sky-600 dark:text-sky-400" /> : null}<span className="block pr-6 font-semibold">关联已切分题块</span><span className={`mt-0.5 block text-[10px] ${paperImportSource === 'slices' ? 'text-sky-700 dark:text-sky-300' : 'text-zinc-500'}`}>按顺序校验数量和题号后入库。</span></button>
                </div>
                {paperImportSource === 'slices' ? (
                  <div className="space-y-3">
                    <select className={editorInputClass} value={selectedSliceRunId} onChange={(e) => setSelectedSliceRunId(e.target.value)}><option value="">请选择切分批次</option>{selectableSliceRuns.map((run) => <option key={run.runId} value={run.runId}>{(run.paperTitle || run.pdfName || run.runId)} · {run.totalQuestions || run.approvedQuestions || 0} 题</option>)}</select>
                    {sliceDashboard.loading ? <div className="rounded-lg border border-sky-200/40 bg-sky-50/60 px-3 py-2 text-xs text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300">正在加载切分批次...</div> : selectableSliceRuns.length === 0 ? <div className="rounded-lg border border-amber-200/40 bg-amber-50/60 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">还没有可关联的切分批次。</div> : null}
                    {selectedSliceRun && slicePairStatus ? <div className="space-y-2"><div className={`flex items-center gap-2 rounded-xl border px-3.5 py-3 text-xs ${slicePairStatus.blockingCount > 0 ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300'}`}>{slicePairStatus.blockingCount > 0 ? <InfoIcon className="size-4" /> : <CheckCircle className="size-4" />}<span>切分题块 {slicePairStatus.itemCount} 个，JSON 题目 {slicePairStatus.jsonCount} 道{slicePairStatus.blockingCount > 0 ? `，${slicePairStatus.blockingCount} 处需要处理。` : '，可以按顺序绑定。'}{slicePairStatus.pendingReviewCount > 0 ? ` 另有 ${slicePairStatus.pendingReviewCount} 个题块尚未标记为复核通过。` : ''}</span></div><div className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white dark:border-zinc-800 dark:bg-zinc-950"><div className="grid grid-cols-[52px_88px_88px_minmax(0,1fr)_80px] gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-2 text-[10px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60"><span>顺序</span><span>题块题号</span><span>JSON 题号</span><span>题干预览</span><span>状态</span></div><div className="max-h-56 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">{slicePairStatus.rows.map((row) => <div key={row.index} className="grid grid-cols-[52px_88px_88px_minmax(0,1fr)_80px] gap-2 px-3 py-2 text-xs"><span className="font-mono text-zinc-500">{row.index + 1}</span><span className="truncate">{row.item ? row.sliceNo : '缺题块'}</span><span className="truncate">{row.preview ? row.jsonNo : '缺 JSON'}</span><span className="line-clamp-1 min-w-0 text-zinc-700 dark:text-zinc-200">{row.preview?.problemText || '题干为空'}</span><span className={row.status === 'ok' ? 'text-emerald-600' : 'text-amber-600'}>{row.status === 'ok' ? '通过' : row.status === 'mismatch' ? '题号冲突' : row.status === 'missing_slice' ? '缺题块' : '缺 JSON'}</span></div>)}</div></div></div> : null}
                  </div>
                ) : null}
              </section>

              <section className="space-y-4 rounded-xl border border-zinc-200/60 bg-zinc-50/60 p-5 dark:border-zinc-800 dark:bg-zinc-900/40">
                <div className="flex flex-col gap-2 border-b border-zinc-100 pb-2 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between"><h4 className="flex items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-300"><Code className="size-4 text-zinc-400" />试卷 JSON 数组内容</h4><div className="flex gap-2"><Button type="button" variant="outline" size="sm" icon={RefreshCcw} onClick={cleanPaperJsonBackslashes}>清洗反斜杠</Button>{'changes' in paperJsonStatus && paperJsonStatus.changes.length > 0 ? <Button type="button" variant="outline" size="sm" icon={Check} onClick={applyPaperJsonCleanup}>应用修复</Button> : null}</div></div>
                <div className="flex h-72 overflow-hidden rounded-2xl border border-zinc-200/80 bg-zinc-950 focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/10 dark:border-zinc-800">{renderJsonLineNumbers(paperJsonLineCount, paperJsonScrollTop)}<textarea className="h-full min-w-0 flex-1 resize-none border-0 bg-transparent px-4 py-3.5 font-mono text-[11px] leading-5 text-zinc-100 outline-none placeholder:text-zinc-600" placeholder='粘贴 {"questions": [...] } 或 [...] 格式' value={paperDraft.jsonText} onChange={(e) => setPaperDraft({ ...paperDraft, jsonText: e.target.value })} onScroll={(e) => setPaperJsonScrollTop(e.currentTarget.scrollTop)} spellCheck={false} /></div>
                {paperJsonStatus.status === 'valid' ? <div className="space-y-3"><div className="flex items-center gap-2 rounded-xl border border-emerald-200/50 bg-emerald-50/60 px-3.5 py-3 text-xs text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200"><CheckCircle className="size-4" />JSON 语法解析成功，共检测到 <strong>{paperJsonStatus.count}</strong> 道题目。{paperJsonStatus.issueCount > 0 ? `其中 ${paperJsonStatus.issueCount} 项需要注意。` : '字段完整，可以确认导入。'}</div><div className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"><div className="grid grid-cols-[56px_minmax(0,1.5fr)_72px_72px_96px] gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-2 text-[10px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60"><span>题号</span><span>题干预览</span><span>答案</span><span>解析</span><span>状态</span></div><div className="max-h-72 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">{paperJsonStatus.previews.map((item) => <div key={`${item.index}-${item.questionNo}`} className="grid grid-cols-[56px_minmax(0,1.5fr)_72px_72px_96px] gap-2 px-3 py-2 text-xs"><span className="font-mono text-zinc-500">{item.questionNo}</span><span className="line-clamp-2 min-w-0 text-zinc-800 dark:text-zinc-100">{item.problemText || '题干为空'}</span><span className={item.answerText.trim() ? 'text-zinc-600 dark:text-zinc-300' : 'text-amber-600'}>{item.answerText.trim() ? '有' : '缺失'}</span><span className={item.analysisText.trim() ? 'text-zinc-600 dark:text-zinc-300' : 'text-amber-600'}>{item.analysisText.trim() ? '有' : '缺失'}</span><span className={item.issues.length || item.needsHumanReview ? 'text-amber-600' : 'text-emerald-600'}>{item.needsHumanReview ? '需复核' : item.issues[0] || '可导入'}</span></div>)}</div></div></div> : null}
                {paperJsonStatus.status === 'invalid' ? renderJsonError(paperJsonStatus) : null}
                {paperJsonStatus.status === 'empty_array' ? <div className="flex items-center gap-2 rounded-xl border border-amber-200/60 bg-amber-50/60 px-3.5 py-3 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200"><InfoIcon className="size-4" />{paperJsonStatus.error}</div> : null}
              </section>

              <div className="flex justify-end">{pendingBankUrl ? <Button asLink to={pendingBankUrl} icon={BadgeCheck}>前往待入库确认</Button> : <Button type="submit" icon={FileStack} disabled={!canImportPaper || importingPaper}>{importingPaper ? '导入中...' : sliceAlreadyImported ? '进入待入库确认' : paperJsonStatus.status === 'valid' ? `确认导入 ${paperJsonStatus.count} 道题` : '导入试卷'}</Button>}</div>
            </form>
          ) : null}

          {method === 'ai' ? (
            <div className="space-y-4 rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900">
              <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-950 font-mono text-xs text-zinc-100 shadow-md dark:border-zinc-800">
                <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-2.5">
                  <div className="flex items-center gap-2"><span className="size-3 rounded-full bg-red-500/80" /><span className="size-3 rounded-full bg-amber-500/80" /><span className="size-3 rounded-full bg-emerald-500/80" /><span className="ml-2 font-mono text-[10px] font-semibold text-zinc-400">ocr_prompt.md</span></div>
                  <button type="button" onClick={copyPrompt} className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-1 text-[10px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white">{copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}{copied ? '已复制！' : '复制提示词'}</button>
                </div>
                <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap p-4 font-mono leading-5 text-zinc-300 select-all">{activeAiPrompt}</pre>
              </div>
              <div className="flex flex-wrap items-center gap-2 px-1 py-0.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">快速打开 AI 平台：</span>{[['Gemini', 'https://gemini.google.com'], ['ChatGPT', 'https://chatgpt.com'], ['Claude', 'https://claude.ai'], ['QwenStudio', 'https://chat.qwen.ai/'], ['豆包', 'https://www.doubao.com']].map(([label, href]) => <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-md bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">{label}</a>)}</div>
              <div className="flex items-start gap-2.5 rounded-xl border border-sky-100 bg-sky-50/40 p-3.5 text-xs leading-relaxed text-sky-900 dark:border-sky-950 dark:bg-sky-950/10 dark:text-sky-200"><FileText className="mt-0.5 size-4 shrink-0" /><div><span className="font-bold">提示：</span>把此提示词与你的试卷图片或 PDF 文件一并发送给大模型，然后复制输出的 JSON 并切换回本页面的 <button type="button" className="font-bold underline" onClick={() => setMethod('direct')}>直接录入</button> 即可。</div></div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export default QuestionCreatePage

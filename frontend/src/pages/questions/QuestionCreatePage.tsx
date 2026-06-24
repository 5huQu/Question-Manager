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
  Copy,
  Eye,
  EyeOff,
  FileStack,
  FileText,
  FolderOpen,
  Info as InfoIcon,
  PencilLine,
  Plus,
  RefreshCcw,
  Scissors,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react'
import { pdfSlicerApi } from '@/api/pdfSlicer'
import { questionBankApi } from '@/api/questionBank'
import { Modal } from '@/components/dialogs/Modal'
import { QuestionContent } from '@/components/questions/QuestionContent'
import { Button } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { Dashboard, QuestionItem, RichBlock, SliceReviewItem } from '@/types'
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

const editorInputClass = 'flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 py-1 text-sm shadow-sm outline-none placeholder:text-zinc-400 focus-visible:ring-1 focus-visible:ring-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:placeholder:text-zinc-650 dark:focus-visible:ring-zinc-300'
const textareaClass = 'w-full rounded-md border border-zinc-200 bg-white p-3 text-sm leading-relaxed shadow-sm outline-none placeholder:text-zinc-400 focus-visible:ring-1 focus-visible:ring-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:placeholder:text-zinc-650 dark:focus-visible:ring-zinc-300'
const smallLabelClass = 'text-[13px] font-medium text-zinc-500 dark:text-zinc-400'
const sectionClass = 'rounded-xl border border-zinc-200 bg-white text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50'
const sectionHeaderClass = 'flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/50 px-6 py-4 dark:border-zinc-900 dark:bg-zinc-900/10'
const inputTabClass = 'flex rounded-lg border border-zinc-200/50 bg-zinc-100/80 p-0.5 shadow-sm dark:border-zinc-800/50 dark:bg-zinc-900/80'
const inputTabButtonClass = (active: boolean) => `flex-1 rounded-md py-1.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${active ? 'bg-white text-zinc-900 shadow-xs border border-zinc-200/20 dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-300'}`
const optionButtonClass = (active: boolean) => `flex flex-col rounded-lg border p-3 text-left transition-all cursor-pointer ${active ? 'border-zinc-950 bg-zinc-50/60 text-zinc-950 ring-1 ring-zinc-950 shadow-sm dark:border-zinc-300 dark:bg-zinc-900/40 dark:text-zinc-50 dark:ring-1 dark:ring-zinc-300' : 'border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50/50 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100'}`
const miniTabClass = (active: boolean) => `rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors ${active ? 'bg-white text-zinc-900 shadow-xs border border-zinc-200/20 dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-300'}`

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
  const problemTextRef = useRef<HTMLTextAreaElement>(null)
  const analysisTextRef = useRef<HTMLTextAreaElement>(null)

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

  const sliceDashboard = useAsync<Dashboard>(() => pdfSlicerApi.getDashboard(), [])
  const selectableSliceRuns = useMemo(() => {
    return (sliceDashboard.data?.runs ?? [])
      .filter((run) => run.totalQuestions > 0 || run.approvedQuestions > 0)
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
  }, [sliceDashboard.data?.runs])
  const selectedSliceRun = selectableSliceRuns.find((run) => run.runId === selectedSliceRunId) ?? null
  const sliceReview = useAsync<{ summary: Record<string, number>; items: SliceReviewItem[] }>(() => {
    if (!selectedSliceRunId) return Promise.resolve({ summary: {}, items: [] })
    return pdfSlicerApi.getSliceReviewItems(selectedSliceRunId)
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
  const fullPaperAiPrompt = useMemo(() => buildFullPaperOcrPrompt(), [])
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
    const item = await questionBankApi.createItem({
      ...draft,
      sourceTitle: draft.sourceTitle.trim() || '手动创建',
      stemMarkdown: draft.problemText,
      analysisMarkdown: draft.analysisText,
      problemBlocks: [...paragraphBlocksFromText(draft.problemText), ...choiceBlock],
      answerBlocks: paragraphBlocksFromText(draft.answerText),
      analysisBlocks: paragraphBlocksFromText(draft.analysisText),
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
      const payload = {
        questions: paperJsonStatus.questions,
        runId: selectedSliceRunId,
        sourceTitle: paperDraft.sourceTitle || selectedSliceRun?.paperTitle || 'AI 识别导入',
        stage: paperDraft.stage,
      }
      const result = paperImportSource === 'slices'
        ? await questionBankApi.importJsonItemsFromSlices(payload)
        : await questionBankApi.importJsonItems(payload)
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
    await pdfSlicerApi.openRunFolder(selectedSliceRunId)
  }

  const choiceEntries = ['A', 'B', 'C', 'D'] as const
  const previewBlocks = useMemo(() => paragraphBlocksFromText(singleDraft.problemText), [singleDraft.problemText])
  const answerPreviewBlocks = useMemo(() => paragraphBlocksFromText(singleDraft.answerText), [singleDraft.answerText])
  const analysisPreviewBlocks = useMemo(() => paragraphBlocksFromText(singleDraft.analysisText), [singleDraft.analysisText])

  function renderNotice() {
    if (!notice) return null
    const tone = {
      success: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400',
      error: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400',
      info: 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300',
    }[noticeType]
    const Icon = noticeType === 'success' ? CheckCircle : noticeType === 'error' ? AlertTriangle : InfoIcon
    return (
      <div className={`flex items-start gap-3 rounded-xl border p-4 text-xs font-semibold shadow-sm ${tone}`}>
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

  function renderJsonError(status: Extract<typeof paperJsonStatus | typeof singleJsonStatus, { status: 'invalid' }>) {
    const snippet = status.snippet
    return (
      <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/30 p-3 text-xs text-red-800 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">
        <div className="flex items-start gap-2">
          <X className="mt-0.5 size-3.5 shrink-0" />
          <span>JSON 语法错误: <code className="rounded bg-red-100/30 px-1 py-0.5 font-mono text-[10px] break-all dark:bg-red-900/30">{status.error}</code></span>
        </div>
        {snippet ? (
          <div className="overflow-hidden rounded-lg border border-red-200 bg-white/40 font-mono text-[10px] leading-5 text-zinc-700 dark:border-red-900/30 dark:bg-zinc-950/30 dark:text-zinc-300">
            {snippet.rows.map((row) => (
              <div key={row.line} className={row.active ? 'bg-red-100/30 dark:bg-red-950/30' : ''}>
                <span className="inline-block w-10 select-none border-r border-red-100/30 px-2 text-right text-muted-foreground dark:border-red-900/30">{row.line}</span>
                <span className="whitespace-pre-wrap px-2">{row.content || ' '}</span>
                {row.active ? (
                  <div>
                    <span className="inline-block w-10 border-r border-red-100/30 px-2 dark:border-red-900/30" />
                    <span className="px-2 text-red-600 dark:text-red-400">{`${' '.repeat(Math.max(0, snippet.column - 1))}^ 第 ${snippet.column} 列`}</span>
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
    <section className="mock-page-root min-h-[calc(100vh-6rem)] space-y-6 overflow-y-auto bg-zinc-50/30 p-6 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      {promptModalOpen ? (
        <Modal title="整套 JSON 导入提示词" desc="复制后发送给大模型，再把返回的 JSON 粘贴到本页导入。这里只做忠实转写，不补写、不分类。" onClose={() => setPromptModalOpen(false)} wide>
          <div className="grid gap-4 lg:grid-cols-[3fr_1fr]">
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
              <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
                <span className="font-mono text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">paper_ocr_prompt.md</span>
                <Button type="button" variant="outline" size="sm" icon={copied ? Check : Copy} onClick={copyFullPaperPrompt}>{copied ? '已复制' : '复制提示词'}</Button>
              </div>
              <pre className="max-h-[62vh] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed text-zinc-950 select-all dark:text-zinc-50">{fullPaperAiPrompt}</pre>
            </div>
            <aside className="space-y-3">
              <div className={`${sectionClass} p-4 text-xs text-zinc-500 dark:text-zinc-400`}>
                <h4 className="flex items-center gap-2 border-b border-zinc-200 pb-2 font-bold text-zinc-950 dark:border-zinc-800 dark:text-zinc-50"><BookOpen className="size-4 text-zinc-500" />AI 转写说明</h4>
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

      <div className="border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">新建试题 / 试卷导入</h1>
        <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">通过表单和分屏渲染编辑单题，或使用 JSON 解析器进行结构化导入。</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-6">
          <div className={`${sectionClass} space-y-5 p-5`}>
            <div>
              <h3 className="text-sm font-semibold">录入配置</h3>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">快速设定录入工作模式</p>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">创建对象</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'single' as const, title: '单道试题', desc: '精细/源码录入', Icon: FileText },
                  { key: 'paper' as const, title: '整套试卷', desc: '粘贴 JSON 批量导入', Icon: FileStack },
                ].map(({ key, title, desc, Icon }) => (
                  <button key={key} type="button" onClick={() => setTarget(key)} className={optionButtonClass(target === key)}>
                    <span className="flex items-center justify-between gap-2 text-xs font-bold">{title}<Icon className="size-3.5 opacity-70" /></span>
                    <span className={`mt-1 text-[10px] leading-normal ${target === key ? 'text-white/70 dark:text-zinc-950/70' : 'text-zinc-500 dark:text-zinc-400'}`}>{desc}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">录入方式</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'direct' as const, title: '直接录入', desc: target === 'single' ? '表单/源码导入' : '粘贴 JSON 导入', Icon: PencilLine },
                  { key: 'ai' as const, title: 'AI 辅助', desc: 'OCR 转写提示词', Icon: Sparkles },
                ].map(({ key, title, desc, Icon }) => (
                  <button key={key} type="button" onClick={() => setMethod(key)} className={optionButtonClass(method === key)}>
                    <span className="flex items-center justify-between gap-2 text-xs font-bold">{title}<Icon className="size-3.5 opacity-70" /></span>
                    <span className={`mt-1 text-[10px] leading-normal ${method === key ? 'text-white/70 dark:text-zinc-950/70' : 'text-zinc-500 dark:text-zinc-400'}`}>{desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {method === 'ai' ? (
            <div className={`${sectionClass} space-y-4 p-5`}>
              <h4 className="flex items-center gap-2 border-b border-zinc-200 pb-2.5 text-xs font-bold dark:border-zinc-800"><BookOpen className="size-4 text-zinc-500" />AI 转写说明</h4>
              <ol className="list-decimal space-y-3.5 pl-4 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                <li>复制右侧面板中的专用 OCR 提示词。</li>
                <li>打开大模型平台，将提示词与试卷图片/PDF 文件一并发送。</li>
                <li>将模型生成的 JSON 复制回来。</li>
                <li><button type="button" className="font-bold text-zinc-900 underline dark:text-zinc-50" onClick={() => setMethod('direct')}>切回直接录入</button>，粘贴 JSON 后导入。</li>
              </ol>
            </div>
          ) : null}

          {renderNotice()}
        </aside>

        <div className="min-w-0 space-y-6">
          {method === 'direct' && target === 'single' ? (
            <div className="space-y-6">
              <div className={inputTabClass}>
                <button type="button" onClick={() => setSingleMethod('form')} className={inputTabButtonClass(singleMethod === 'form')}><PencilLine className="size-3.5" />手动表单录入</button>
                <button type="button" onClick={() => setSingleMethod('json')} className={inputTabButtonClass(singleMethod === 'json')}><Code className="size-3.5" />JSON 单题录入</button>
              </div>

              {singleMethod === 'form' ? (
                <form className="space-y-6" onSubmit={createSingle}>
                  <section className={sectionClass}>
                    <div className={sectionHeaderClass}><Settings2 className="size-4 text-zinc-500" /><h2 className="text-xs font-bold uppercase tracking-wider">1. 基本属性设定</h2></div>
                    <div className="grid gap-6 p-6 sm:grid-cols-2 lg:grid-cols-4">
                      <label className="space-y-2"><span className={smallLabelClass}>学段</span><input className={editorInputClass} placeholder="例：高三" value={singleDraft.stage} onChange={(e) => updateDraft({ stage: e.target.value })} /></label>
                      <label className="space-y-2"><span className={smallLabelClass}>题型</span><select className={editorInputClass} value={singleDraft.questionType} onChange={(e) => updateDraft({ questionType: e.target.value })}><option value="单选题">单选题</option><option value="多选题">多选题</option><option value="填空题">填空题</option><option value="解答题">解答题</option></select></label>
                      <label className="space-y-2"><span className={smallLabelClass}>题号</span><input className={editorInputClass} placeholder="例: 1" value={singleDraft.questionNo} onChange={(e) => updateDraft({ questionNo: e.target.value })} /></label>
                      <label className="space-y-2"><span className={smallLabelClass}>来源</span><input className={editorInputClass} placeholder="例: 2026高考模拟" value={singleDraft.sourceTitle} onChange={(e) => updateDraft({ sourceTitle: e.target.value })} /></label>
                    </div>
                  </section>

                  <section className={sectionClass}>
                    <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50/50 px-6 py-4 dark:border-zinc-900 dark:bg-zinc-900/10">
                      <div className="flex items-center gap-2"><PencilLine className="size-4 text-zinc-500" /><h2 className="text-xs font-bold uppercase tracking-wider">2. 题干与选项设定</h2></div>
                      <div className="flex rounded-lg border border-zinc-200/50 bg-zinc-100/80 p-0.5 dark:border-zinc-800/50 dark:bg-zinc-900/80">
                        <button type="button" onClick={() => setStemTab('edit')} className={miniTabClass(stemTab === 'edit')}>编辑</button>
                        <button type="button" onClick={() => setStemTab('preview')} className={miniTabClass(stemTab === 'preview')}>预览</button>
                      </div>
                    </div>
                    <div className="space-y-6 p-6">
                      {stemTab === 'edit' ? (
                        <div className="flex flex-col">
                          <div className="flex flex-wrap gap-1.5 border border-b-0 border-zinc-200 bg-zinc-50/50 p-2 rounded-t-md dark:border-zinc-800 dark:bg-zinc-900/30">
                            {(['math', 'block', 'frac', 'sqrt', 'alpha', 'theta'] as const).map((type) => (
                              <button key={type} type="button" onClick={() => insertLatex(type, 'problemText')} className="inline-flex items-center rounded border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[10px] text-zinc-500 transition-colors hover:bg-zinc-55 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100">
                                {type === 'math' ? '$公式$' : type === 'block' ? '$$区块$$' : type === 'frac' ? '\\frac' : type === 'sqrt' ? '\\sqrt' : type === 'alpha' ? '\\alpha' : '\\theta'}
                              </button>
                            ))}
                          </div>
                          <textarea ref={problemTextRef} className={`${textareaClass} rounded-t-none border-t-0 h-32 font-mono`} placeholder="请输入题目题干 (支持 Markdown & LaTeX)..." value={singleDraft.problemText} onChange={(e) => updateDraft({ problemText: e.target.value })} />
                        </div>
                      ) : (
                        <div className="min-h-32 rounded-md border border-zinc-200 bg-white p-4 text-sm leading-relaxed dark:border-zinc-800 dark:bg-zinc-950">
                          {singleDraft.problemText.trim() ? (
                            <div className="flex gap-2"><span className="font-bold">{singleDraft.questionNo ? `${singleDraft.questionNo}.` : '1.'}</span><div className="min-w-0 flex-1"><QuestionContent blocks={previewBlocks} /></div></div>
                          ) : <span className="text-xs italic text-zinc-500 dark:text-zinc-400">无内容预览。</span>}
                        </div>
                      )}

                      {(singleDraft.questionType === '单选题' || singleDraft.questionType === '多选题') ? (
                        <div className="space-y-3.5 border-t border-zinc-100 dark:border-zinc-900 pt-5">
                          <label className={smallLabelClass}>选项列表 (勾选正确答案)</label>
                          <div className="grid gap-4 sm:grid-cols-2">
                            {choiceEntries.map((labelText) => (
                              <div key={labelText} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-950">
                                <button type="button" onClick={() => toggleAnswer(labelText)} aria-pressed={choiceAnswers[labelText]} className={`flex size-4 shrink-0 items-center justify-center rounded border border-zinc-300 dark:border-zinc-700 ${choiceAnswers[labelText] ? 'bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950' : 'bg-white text-transparent hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900'}`}><Check className="size-3" /></button>
                                <span className="text-xs font-bold">{labelText}</span>
                                <input className="flex h-8 min-w-0 flex-1 border-0 bg-transparent px-2 text-sm outline-none" placeholder={`选项 ${labelText}`} value={choiceOptions[labelText]} onChange={(e) => setChoiceOptions({ ...choiceOptions, [labelText]: e.target.value })} />
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </section>

                  <section className={sectionClass}>
                    <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50/50 px-6 py-4 dark:border-zinc-900 dark:bg-zinc-900/10">
                      <div className="flex items-center gap-2"><CheckSquare className="size-4 text-zinc-500" /><h2 className="text-xs font-bold uppercase tracking-wider">3. 答案与解析设定</h2></div>
                      <div className="flex rounded-lg border border-zinc-200/50 bg-zinc-100/80 p-0.5 dark:border-zinc-800/50 dark:bg-zinc-900/80">
                        <button type="button" onClick={() => setAnalysisTab('edit')} className={miniTabClass(analysisTab === 'edit')}>编辑</button>
                        <button type="button" onClick={() => setAnalysisTab('preview')} className={miniTabClass(analysisTab === 'preview')}>预览</button>
                      </div>
                    </div>
                    <div className="space-y-6 p-6">
                      {analysisTab === 'edit' ? (
                        <>
                          <label className="space-y-2"><span className={smallLabelClass}>参考答案</span><input className={editorInputClass} placeholder="例: A 或 15" value={singleDraft.answerText} onChange={(e) => updateDraft({ answerText: e.target.value })} /></label>
                          <div className="space-y-2">
                            <span className={smallLabelClass}>详细解析 (Markdown & LaTeX)</span>
                            <div className="flex flex-col">
                              <div className="flex flex-wrap gap-1.5 border border-b-0 border-zinc-200 bg-zinc-50/50 p-2 rounded-t-md dark:border-zinc-800 dark:bg-zinc-900/30">
                                {(['math', 'block', 'frac', 'sqrt', 'alpha', 'theta'] as const).map((type) => (
                                  <button key={type} type="button" onClick={() => insertLatex(type, 'analysisText')} className="inline-flex items-center rounded border border-zinc-200 bg-white px-2.5 py-0.5 font-mono text-[10px] text-zinc-500 transition-colors hover:bg-zinc-55 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100">
                                    {type === 'math' ? '$公式$' : type === 'block' ? '$$区块$$' : type === 'frac' ? '\\frac' : type === 'sqrt' ? '\\sqrt' : type === 'alpha' ? '\\alpha' : '\\theta'}
                                  </button>
                                ))}
                              </div>
                              <textarea ref={analysisTextRef} className={`${textareaClass} rounded-t-none border-t-0 h-32 font-mono`} placeholder="请输入详解步骤..." value={singleDraft.analysisText} onChange={(e) => updateDraft({ analysisText: e.target.value })} />
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2"><span className={smallLabelClass}>参考答案预览</span><div className="min-h-24 rounded-md border border-zinc-200 bg-white p-4 text-sm leading-relaxed dark:border-zinc-800 dark:bg-zinc-950">{singleDraft.answerText.trim() ? <QuestionContent blocks={answerPreviewBlocks} /> : <span className="text-xs text-zinc-500 dark:text-zinc-400">暂无答案。</span>}</div></div>
                          <div className="space-y-2"><span className={smallLabelClass}>详细解析预览</span><div className="min-h-24 rounded-md border border-zinc-200 bg-white p-4 text-sm leading-relaxed dark:border-zinc-800 dark:bg-zinc-950">{singleDraft.analysisText.trim() ? <QuestionContent blocks={analysisPreviewBlocks} /> : <span className="text-xs text-zinc-500 dark:text-zinc-400">暂无解析。</span>}</div></div>
                        </div>
                      )}
                      <button type="button" onClick={() => setShowAnswerPreview((v) => !v)} className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
                        {showAnswerPreview ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}{showAnswerPreview ? '隐藏完整渲染' : '显示完整渲染'}
                      </button>
                      {showAnswerPreview ? <div className="grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60 md:grid-cols-2"><div className="space-y-2"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Answer Render</span><div className="min-h-24 rounded-md border border-zinc-200 bg-white p-4 text-sm leading-relaxed dark:border-zinc-800 dark:bg-zinc-950">{singleDraft.answerText.trim() ? <QuestionContent blocks={answerPreviewBlocks} /> : <span className="text-zinc-500 dark:text-zinc-400">暂无答案。</span>}</div></div><div className="space-y-2"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Analysis Render</span><div className="min-h-24 rounded-md border border-zinc-200 bg-white p-4 text-sm leading-relaxed dark:border-zinc-800 dark:bg-zinc-950">{singleDraft.analysisText.trim() ? <QuestionContent blocks={analysisPreviewBlocks} /> : <span className="text-zinc-500 dark:text-zinc-400">暂无解析。</span>}</div></div></div> : null}
                    </div>
                  </section>
                  <div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => { setSingleDraft({ questionNo: '', stage: '高三', questionType: '单选题', sourceTitle: '', problemText: '', answerText: '', analysisText: '' }); setChoiceOptions({ A: '', B: '', C: '', D: '' }); setChoiceAnswers({ A: false, B: false, C: false, D: false }) }}>重置表单</Button><Button type="submit" icon={Check}>保存并入库</Button></div>
                </form>
              ) : (
                <form className={`${sectionClass} space-y-4 p-5`} onSubmit={createSingleFromJson}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><Code className="size-4 text-zinc-500" />JSON 单题录入</h2><p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">支持单个题目对象、含 1 道题的 questions 数组或代码块粘贴。</p></div>{'changes' in singleJsonStatus && (singleJsonStatus.changes?.length ?? 0) > 0 ? <Button type="button" variant="outline" size="sm" icon={Check} onClick={applySingleJsonCleanup}>应用修复</Button> : null}</div>
                  <label className="space-y-2"><span className={smallLabelClass}>单题 JSON 代码</span><textarea className={`${textareaClass} h-80 font-mono`} placeholder='{"questionNo":"1","questionType":"单选题",...}' value={singleJsonText} onChange={(e) => setSingleJsonText(e.target.value)} spellCheck={false} /></label>
                  {singleJsonStatus.status === 'valid' ? <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300"><CheckCircle className="mr-2 inline size-4 text-emerald-600" />检查通过，题号 {singleJsonStatus.preview.questionNo || '1'}，可以创建。</div> : null}
                  {singleJsonStatus.status === 'empty' ? <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">请输入 JSON 格式代码</div> : null}
                  {singleJsonStatus.status === 'invalid_count' ? <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">当前 JSON 解析到 {singleJsonStatus.count} 道题；单题录入只接受 1 道题。多题请切换到整套试卷。</div> : null}
                  {singleJsonStatus.status === 'invalid' ? renderJsonError(singleJsonStatus) : null}
                  <div className="flex justify-end"><Button type="submit" icon={Plus} disabled={singleJsonStatus.status !== 'valid'}>解析并保存</Button></div>
                </form>
              )}
            </div>
          ) : null}

          {method === 'direct' && target === 'paper' ? (
            <form className={`${sectionClass} space-y-4 p-5`} onSubmit={importPaper}>
              <h3 className="text-sm font-semibold">试卷批量导入</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5"><span className={smallLabelClass}>试卷名称</span><input className={editorInputClass} placeholder="输入试卷名称" value={paperDraft.sourceTitle} onChange={(e) => setPaperDraft({ ...paperDraft, sourceTitle: e.target.value })} /></label>
                <label className="space-y-1.5"><span className={smallLabelClass}>全局学段</span><input className={editorInputClass} placeholder="例：高三" value={paperDraft.stage} onChange={(e) => setPaperDraft({ ...paperDraft, stage: e.target.value })} /></label>
              </div>

              <section className="space-y-3">
                <div className={inputTabClass}>
                  <button type="button" onClick={() => setPaperImportSource('plain')} className={inputTabButtonClass(paperImportSource === 'plain')}>普通文本导入</button>
                  <button type="button" onClick={() => setPaperImportSource('slices')} className={inputTabButtonClass(paperImportSource === 'slices')}>绑定切片导入</button>
                </div>
                {paperImportSource === 'slices' ? (
                  <div className="space-y-3">
                    <select className={editorInputClass} value={selectedSliceRunId} onChange={(e) => setSelectedSliceRunId(e.target.value)}><option value="">请选择切分批次</option>{selectableSliceRuns.map((run) => <option key={run.runId} value={run.runId}>{(run.paperTitle || run.pdfName || run.runId)} · {run.totalQuestions || run.approvedQuestions || 0} 题</option>)}</select>
                    {sliceDashboard.loading ? <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">正在加载切分批次...</div> : selectableSliceRuns.length === 0 ? <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">还没有可关联的切分批次。</div> : null}
                    {selectedSliceRun && slicePairStatus ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50/50 px-3.5 py-3 text-xs text-zinc-650 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-300">
                          {slicePairStatus.blockingCount > 0 ? (
                            <InfoIcon className="size-4 text-amber-600 dark:text-amber-400" />
                          ) : (
                            <CheckCircle className="size-4 text-emerald-600 dark:text-emerald-400" />
                          )}
                          <span>
                            切分题块 {slicePairStatus.itemCount} 个，JSON 题目 {slicePairStatus.jsonCount} 道
                            {slicePairStatus.blockingCount > 0
                              ? `，${slicePairStatus.blockingCount} 处需要处理。`
                              : '，可以按顺序绑定。'}
                            {slicePairStatus.pendingReviewCount > 0
                              ? ` 另有 ${slicePairStatus.pendingReviewCount} 个题块尚未标记为复核通过。`
                              : ''}
                          </span>
                        </div>
                        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
                          <div className="grid grid-cols-[52px_88px_88px_minmax(0,1fr)_80px] gap-2 border-b border-zinc-200 bg-zinc-50/70 px-3 py-2.5 text-[11px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
                            <span>顺序</span>
                            <span>题块题号</span>
                            <span>JSON 题号</span>
                            <span>题干预览</span>
                            <span>状态</span>
                          </div>
                          <div className="max-h-56 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-900">
                            {slicePairStatus.rows.map((row) => (
                              <div key={row.index} className="grid grid-cols-[52px_88px_88px_minmax(0,1fr)_80px] gap-2 px-3 py-2.5 text-xs hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 transition-colors">
                                <span className="font-mono text-zinc-400 dark:text-zinc-550">{row.index + 1}</span>
                                <span className="truncate text-zinc-700 dark:text-zinc-300">{row.item ? row.sliceNo : '缺题块'}</span>
                                <span className="truncate text-zinc-700 dark:text-zinc-300">{row.preview ? row.jsonNo : '缺 JSON'}</span>
                                <span className="line-clamp-1 min-w-0 text-zinc-650 dark:text-zinc-450">{row.preview?.problemText || '题干为空'}</span>
                                <span className={row.status === 'ok' ? 'text-emerald-700 dark:text-emerald-450 font-medium' : 'text-amber-700 dark:text-amber-450 font-medium'}>
                                  {row.status === 'ok' ? '通过' : row.status === 'mismatch' ? '题号冲突' : row.status === 'missing_slice' ? '缺题块' : '缺 JSON'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <section className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><h4 className="flex items-center gap-2 text-xs font-medium"><Code className="size-4 text-zinc-500" />试卷 JSON 数组内容</h4><div className="flex gap-2"><Button type="button" variant="outline" size="sm" icon={RefreshCcw} onClick={cleanPaperJsonBackslashes}>清洗反斜杠</Button>{'changes' in paperJsonStatus && (paperJsonStatus.changes?.length ?? 0) > 0 ? <Button type="button" variant="outline" size="sm" icon={Check} onClick={applyPaperJsonCleanup}>应用修复</Button> : null}</div></div>
                <textarea className={`${textareaClass} h-60 font-mono`} placeholder='{"questions": [...]}' value={paperDraft.jsonText} onChange={(e) => setPaperDraft({ ...paperDraft, jsonText: e.target.value })} spellCheck={false} />
                {paperJsonStatus.status === 'empty' ? <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">请输入符合 JSON 格式的 questions 数组</div> : null}
                {paperJsonStatus.status === 'valid' ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300">
                      <CheckCircle className="size-4 text-emerald-600 dark:text-emerald-450" />
                      <span>
                        JSON 语法解析成功，共检测到 <strong>{paperJsonStatus.count}</strong> 道题目。
                        {paperJsonStatus.issueCount > 0 ? `其中 ${paperJsonStatus.issueCount} 项需要注意。` : '字段完整，可以确认导入。'}
                      </span>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
                      <div className="grid grid-cols-[56px_minmax(0,1.5fr)_72px_72px_96px] gap-2 border-b border-zinc-200 bg-zinc-50/70 px-3 py-2.5 text-[11px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
                        <span>题号</span>
                        <span>题干预览</span>
                        <span>答案</span>
                        <span>解析</span>
                        <span>状态</span>
                      </div>
                      <div className="max-h-72 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-900">
                        {paperJsonStatus.previews.map((item) => (
                          <div key={`${item.index}-${item.questionNo}`} className="grid grid-cols-[56px_minmax(0,1.5fr)_72px_72px_96px] gap-2 px-3 py-2.5 text-xs hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 transition-colors">
                            <span className="font-mono text-zinc-400 dark:text-zinc-550">{item.questionNo}</span>
                            <span className="line-clamp-2 min-w-0 text-zinc-700 dark:text-zinc-300">{item.problemText || '题干为空'}</span>
                            <span className={item.answerText.trim() ? 'text-zinc-500 dark:text-zinc-400' : 'text-amber-700 dark:text-amber-450 font-medium'}>
                              {item.answerText.trim() ? '有' : '缺失'}
                            </span>
                            <span className={item.analysisText.trim() ? 'text-zinc-500 dark:text-zinc-400' : 'text-amber-700 dark:text-amber-450 font-medium'}>
                              {item.analysisText.trim() ? '有' : '缺失'}
                            </span>
                            <span className={item.issues.length || item.needsHumanReview ? 'text-amber-700 dark:text-amber-450 font-medium' : 'text-emerald-700 dark:text-emerald-450 font-medium'}>
                              {item.needsHumanReview ? '需复核' : item.issues[0] || '可导入'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                {paperJsonStatus.status === 'invalid' ? renderJsonError(paperJsonStatus) : null}
                {paperJsonStatus.status === 'empty_array' ? (
                  <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400">
                    <InfoIcon className="size-4" />
                    {paperJsonStatus.error}
                  </div>
                ) : null}
              </section>

              <div className="flex justify-end">{pendingBankUrl ? <Button asLink to={pendingBankUrl} icon={BadgeCheck}>前往待入库确认</Button> : <Button type="submit" icon={FileStack} disabled={!canImportPaper || importingPaper}>{importingPaper ? '导入中...' : sliceAlreadyImported ? '进入待入库确认' : paperJsonStatus.status === 'valid' ? `确认导入 ${paperJsonStatus.count} 道题` : '导入试卷'}</Button>}</div>
            </form>
          ) : null}

          {method === 'ai' ? (
            <div className={`${sectionClass} space-y-4 p-5`}>
              <div className="flex items-start justify-between gap-4">
                <div><h3 className="text-sm font-semibold">AI 智能录入提示词 (OCR)</h3><p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">复制提示词，配合大模型把 OCR 文本转成标准 JSON；只做转写，不补写、不分类、不改题意。</p></div>
                <Button type="button" variant="outline" size="sm" icon={copied ? Check : Copy} onClick={copyPrompt}>{copied ? '已复制' : '复制提示词'}</Button>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
                <div className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
                  <span className="font-mono text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">ocr_prompt.md</span>
                </div>
                <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed text-zinc-950 select-all dark:text-zinc-50">{activeAiPrompt}</pre>
              </div>
              <div className="flex flex-wrap items-center gap-2 px-1 py-0.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">快速打开 AI 平台：</span>{[['Gemini', 'https://gemini.google.com'], ['ChatGPT', 'https://chatgpt.com'], ['Claude', 'https://claude.ai'], ['QwenStudio', 'https://chat.qwen.ai/'], ['豆包', 'https://www.doubao.com']].map(([label, href]) => <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">{label}</a>)}</div>
              <div className="flex items-start gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300"><FileText className="mt-0.5 size-4 shrink-0" /><div><span className="font-bold">提示：</span>把此提示词与你的试卷图片或 PDF 文件一并发送给大模型，然后复制输出的 JSON，再切回本页面的 <button type="button" className="font-bold underline" onClick={() => setMethod('direct')}>直接录入</button> 即可。</div></div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export default QuestionCreatePage

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BadgeCheck, BookOpen, Check, Copy, FileStack, FileText, FolderOpen, Info as InfoIcon, PencilLine, Plus, RefreshCcw, Scissors, Settings2, X } from 'lucide-react'
import { api, jsonHeaders } from '@/api/client'
import { MarkdownContent } from '@/components/MarkdownContent'
import { Modal } from '@/components/dialogs/Modal'
import { QuestionContent } from '@/components/questions/QuestionContent'
import { Button, PageTitle, Panel } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { Dashboard, QuestionItem, RichBlock, SliceReviewItem, TagLibraries } from '@/types'
import { buildFullPaperOcrPrompt, singleQuestionOcrPrompt } from '@/constants/ocrPrompts'
import { buildJsonParseHint, cleanAiJsonText, cleanJsonBackslashes, comparableQuestionNo, jsonErrorPosition, jsonErrorSnippet, paragraphBlocksFromText, parsePaperQuestionsFromJsonText } from '@/utils/jsonCleanup'

export function QuestionCreatePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [target, setTarget] = useState<'single' | 'paper'>('single')
  const [method, setMethod] = useState<'direct' | 'ai'>('direct')
  const [notice, setNotice] = useState('')
  const [pendingBankUrl, setPendingBankUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [promptModalOpen, setPromptModalOpen] = useState(false)
  const [importingPaper, setImportingPaper] = useState(false)
  const [singleDraft, setSingleDraft] = useState({
    questionNo: '',
    stage: '高三',
    questionType: '单选题',
    sourceTitle: '',
    problemText: '',
    answerText: '',
    analysisText: '',
  })
  const [choiceOptions, setChoiceOptions] = useState({ A: '', B: '', C: '', D: '' })
  const [paperDraft, setPaperDraft] = useState({
    sourceTitle: '',
    stage: '高三',
    jsonText: '',
  })
  const [paperImportSource, setPaperImportSource] = useState<'plain' | 'slices'>('plain')
  const [selectedSliceRunId, setSelectedSliceRunId] = useState('')

  const [stemTab, setStemTab] = useState<'edit' | 'preview'>('edit')
  const [analysisTab, setAnalysisTab] = useState<'edit' | 'preview'>('edit')
  const [paperJsonScrollTop, setPaperJsonScrollTop] = useState(0)
  const paperJsonLineCount = useMemo(() => Math.max(1, paperDraft.jsonText.split('\n').length), [paperDraft.jsonText])

  const paperJsonStatus = useMemo(() => {
    const text = paperDraft.jsonText.trim()
    if (!text) return { status: 'empty' }
    try {
      const parsed = parsePaperQuestionsFromJsonText(text)
      const questions = parsed.questions
      if (questions.length > 0) {
        return {
          status: 'valid',
          count: questions.length,
          cleanedText: parsed.cleaned,
          changes: parsed.changes,
          questions,
          previews: parsed.previews,
          issueCount: parsed.previews.reduce((sum, item) => sum + item.issues.length + (item.needsHumanReview ? 1 : 0), 0),
        }
      } else {
        return { status: 'empty_array', error: '未找到含有题目的 questions 数组或数组为空', cleanedText: parsed.cleaned, changes: parsed.changes }
      }
    } catch (e) {
      const prepared = cleanAiJsonText(text)
      const { rawMessage, position } = jsonErrorPosition(e)
      return {
        status: 'invalid',
        error: buildJsonParseHint(rawMessage, prepared.cleaned, position),
        cleanedText: prepared.cleaned,
        changes: prepared.changes,
        snippet: jsonErrorSnippet(prepared.cleaned, position),
      }
    }
  }, [paperDraft.jsonText])

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
    const maxCount = Math.max(items.length, questions.length)
    const rows = Array.from({ length: maxCount }, (_, index) => {
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
    const blockingCount = rows.filter((row) => row.status !== 'ok').length
    const pendingReviewCount = items.filter((item) => item.reviewStatus !== 'ready_for_ocr').length
    return { rows, blockingCount, pendingReviewCount, itemCount: items.length, jsonCount: questions.length }
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

  async function createSingle(event: FormEvent) {
    event.preventDefault()
    const isChoice = singleDraft.questionType === '单选题' || singleDraft.questionType === '多选题'
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
        ...singleDraft,
        sourceTitle: singleDraft.sourceTitle.trim() || '手动创建',
        problemBlocks: [...paragraphBlocksFromText(singleDraft.problemText), ...choiceBlock],
        answerBlocks: paragraphBlocksFromText(singleDraft.answerText),
        analysisBlocks: paragraphBlocksFromText(singleDraft.analysisText),
      }),
    })
    navigate(`/questions/${encodeURIComponent(item.id)}`)
  }

  async function importPaper(event: FormEvent) {
    event.preventDefault()
    setPendingBankUrl('')
    if (paperJsonStatus.status !== 'valid') {
      setNotice('请先修正 JSON，直到检查结果显示可以导入。')
      return
    }
    if (paperImportSource === 'slices') {
      if (!selectedSliceRunId) {
        setNotice('请选择一个已切分的 PDF 批次。')
        return
      }
      if (!slicePairStatus || slicePairStatus.blockingCount > 0) {
        setNotice('题块与 JSON 的数量或题号仍不一致，请修正后再导入。')
        return
      }
      if (sliceAlreadyImported) {
        navigate(`/tools/pdf-slicer/runs/${encodeURIComponent(selectedSliceRunId)}/pending-bank`)
        return
      }
    }
    const questions = paperJsonStatus.questions
    if (!questions.length) {
      setNotice('没有找到 questions 数组。')
      return
    }
    const endpoint = paperImportSource === 'slices' ? '/api/question-bank/import-json-from-slices' : '/api/question-bank/import-json'
    setImportingPaper(true)
    try {
      const result = await api<{ items: QuestionItem[]; count: number; pendingBankUrl?: string }>(endpoint, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ questions, runId: selectedSliceRunId, sourceTitle: paperDraft.sourceTitle || selectedSliceRun?.paperTitle || 'AI 识别导入', stage: paperDraft.stage }),
      })
      if (result.pendingBankUrl) {
        setPendingBankUrl(result.pendingBankUrl)
        setNotice(`已导入 ${result.count} 道题，题号校验通过。请进入待入库确认完成最终入库。`)
        return
      }
      setNotice(`已导入 ${result.count} 道题。`)
      if (result.items[0]?.id) navigate(`/questions/${encodeURIComponent(result.items[0].id)}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setImportingPaper(false)
    }
  }

  function cleanPaperJsonBackslashes() {
    const { cleaned, changed } = cleanJsonBackslashes(paperDraft.jsonText)
    setPaperDraft({ ...paperDraft, jsonText: cleaned })
    setNotice(changed > 0 ? `已清洗 ${changed} 处反斜杠。` : '未发现需要清洗的反斜杠。')
  }

  function applyPaperJsonCleanup() {
    if (!('cleanedText' in paperJsonStatus) || !paperJsonStatus.cleanedText) return
    setPaperDraft({ ...paperDraft, jsonText: paperJsonStatus.cleanedText })
    setNotice('已应用自动预处理结果。')
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(activeAiPrompt)
    setCopied(true)
    setNotice('提示词已成功复制到剪贴板！')
    setTimeout(() => setCopied(false), 2000)
  }

  async function copyFullPaperPrompt() {
    await navigator.clipboard.writeText(fullPaperAiPrompt)
    setCopied(true)
    setNotice('整套导入提示词已复制到剪贴板。')
    setTimeout(() => setCopied(false), 2000)
  }

  async function openSelectedPdfFolder() {
    if (!selectedSliceRunId) return
    await api(`/api/tools/pdf-slicer/runs/${encodeURIComponent(selectedSliceRunId)}/open-folder`, { method: 'POST' })
  }

  const targetCards = [
    { key: 'single' as const, title: '单道试题', desc: '人工录入或单题识别。' },
    { key: 'paper' as const, title: '整套试卷', desc: '批量粘贴 JSON 数组导入。' },
  ]
  const methodCards = [
    { key: 'direct' as const, title: '手动录入', desc: target === 'single' ? '填写题干、选项与答案。' : '粘贴 questions JSON 字段。' },
    { key: 'ai' as const, title: 'AI 辅助', desc: '复制专用 OCR 提示词。' },
  ]

  function renderNotice() {
    if (!notice) return null
    const isError = notice.includes('失败') || notice.includes('没有') || notice.includes('错误')
    const isSuccess = notice.includes('已') || notice.includes('成功')

    let bg = 'bg-indigo-50/70 border-indigo-200 text-indigo-800 dark:bg-indigo-950/20 dark:border-indigo-900/40 dark:text-indigo-200'
    let Icon = FileText
    if (isError) {
      bg = 'bg-red-50/70 border-red-200 text-red-800 dark:bg-red-950/20 dark:border-red-900/40 dark:text-red-200'
      Icon = X
    } else if (isSuccess) {
      bg = 'bg-emerald-50/70 border-emerald-200 text-emerald-800 dark:bg-emerald-950/20 dark:border-emerald-900/40 dark:text-emerald-200'
      Icon = Check
    }

    return (
      <div className={`flex items-start gap-2.5 rounded-xl border p-3.5 text-xs font-semibold ${bg} shadow-sm transition-all duration-300`}>
        <Icon className="size-4 shrink-0 mt-0.5" />
        <span className="flex-1 leading-normal">{notice}</span>
        {pendingBankUrl && notice.includes('待入库确认') ? (
          <Button asLink to={pendingBankUrl} size="sm" icon={BadgeCheck} className="shrink-0">
            进入待入库确认
          </Button>
        ) : null}
        <button type="button" onClick={() => { setNotice(''); setPendingBankUrl('') }} className="opacity-60 hover:opacity-100 transition-opacity cursor-pointer">
          <X className="size-3.5" />
        </button>
      </div>
    )
  }

  return (
    <section className="space-y-5">
      {promptModalOpen ? (
        <Modal
          title="整套 JSON 导入提示词"
          desc="复制后发送给大模型，再把返回的 JSON 粘贴到本页导入。"
          onClose={() => setPromptModalOpen(false)}
          wide
        >
          <div className="grid gap-4 lg:grid-cols-[3fr_1fr]">
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-950 text-zinc-100 shadow-md dark:border-zinc-800">
              <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="size-3 rounded-full bg-red-500/85" />
                  <span className="size-3 rounded-full bg-amber-500/85" />
                  <span className="size-3 rounded-full bg-emerald-500/85" />
                  <span className="ml-2 font-mono text-[10px] font-semibold text-zinc-400">paper_ocr_prompt.md</span>
                </div>
                <button
                  type="button"
                  onClick={copyFullPaperPrompt}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-800 px-3 text-[10px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
                >
                  {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                  {copied ? '已复制' : '复制提示词'}
                </button>
              </div>
              <pre className="max-h-[62vh] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-5 text-zinc-300 select-all">{fullPaperAiPrompt}</pre>
            </div>

            <aside className="space-y-3">
              <div className="rounded-xl border bg-white p-4 text-xs text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                <h4 className="flex items-center gap-2 border-b pb-2 font-bold text-zinc-800 dark:text-zinc-100">
                  <BookOpen className="size-4 text-zinc-500" />
                  AI 识别说明
                </h4>
                <ol className="mt-3 list-decimal space-y-2 pl-4 leading-5">
                  <li>复制左侧代码窗口右上角的预设提示词。</li>
                  <li>前往第三方大模型平台，粘贴提示词并发送题图或文档。</li>
                  <li>将大模型返回的 JSON 代码复制回来。</li>
                  <li>回到本页粘贴 JSON 数据并导入。</li>
                </ol>
              </div>

              <div className="rounded-xl border bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">快速打开 AI 平台</p>
                <div className="mt-3 grid gap-2">
                  {[
                    ['Gemini', 'https://gemini.google.com'],
                    ['ChatGPT', 'https://chatgpt.com'],
                    ['Claude', 'https://claude.ai'],
                    ['QwenStudio', 'https://chat.qwen.ai/'],
                    ['豆包', 'https://www.doubao.com'],
                  ].map(([labelText, href]) => (
                    <a key={labelText} href={href} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-white dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700">
                      {labelText}
                    </a>
                  ))}
                </div>
              </div>

              {selectedSliceRunId ? (
                <Button className="w-full justify-start" variant="outline" icon={FolderOpen} onClick={openSelectedPdfFolder}>
                  打开 PDF 文件夹
                </Button>
              ) : null}
            </aside>
          </div>
        </Modal>
      ) : null}
      <PageTitle title="新建题目/试卷" desc="选择录入对象和方式，手动输入题目信息或利用大模型识别并批量导入 JSON 数据。" path="/questions/new" />

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] items-start">
        {/* Left column: controls and guide */}
        <aside className="space-y-4 lg:sticky lg:top-6">
          <div className="rounded-2xl border bg-white dark:bg-zinc-900 p-5 shadow-sm space-y-4">
            <div>
              <h3 className="font-bold text-xs text-zinc-900 dark:text-white">录入配置</h3>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">定制您的题目入库方式</p>
            </div>

            {/* Create Object Selection */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">创建对象</label>
              <div className="grid grid-cols-2 gap-2">
                {targetCards.map((card) => (
                  <button
                    key={card.key}
                    type="button"
                    onClick={() => setTarget(card.key)}
                    className={`flex flex-col p-3 rounded-xl border text-left transition-all duration-150 cursor-pointer ${
                      target === card.key
                        ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-200 dark:bg-white dark:text-zinc-950 shadow-sm'
                        : 'border-zinc-200 bg-white hover:border-zinc-400 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300'
                    }`}
                  >
                    <span className="text-xs font-bold">{card.title}</span>
                    <span className={`text-[9px] mt-1 leading-normal line-clamp-2 ${target === card.key ? 'text-zinc-300 dark:text-zinc-500' : 'text-zinc-400'}`}>
                      {card.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Input Method Selection */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">录入方式</label>
              <div className="grid grid-cols-2 gap-2">
                {methodCards.map((card) => (
                  <button
                    key={card.key}
                    type="button"
                    onClick={() => setMethod(card.key)}
                    className={`flex flex-col p-3 rounded-xl border text-left transition-all duration-150 cursor-pointer ${
                      method === card.key
                        ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-200 dark:bg-white dark:text-zinc-950 shadow-sm'
                        : 'border-zinc-200 bg-white hover:border-zinc-400 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300'
                    }`}
                  >
                    <span className="text-xs font-bold">{card.title}</span>
                    <span className={`text-[9px] mt-1 leading-normal line-clamp-2 ${method === card.key ? 'text-zinc-300 dark:text-zinc-500' : 'text-zinc-400'}`}>
                      {card.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Guide steps (only show in AI helper mode) */}
          {method === 'ai' && (
            <div className="rounded-2xl border bg-zinc-50 dark:bg-zinc-900/40 p-4 border-zinc-200/60 dark:border-zinc-800/40 space-y-3">
              <h4 className="text-xs font-bold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5 border-b pb-2">
                <BookOpen className="size-3.5 text-zinc-500" />
                AI 识别说明
              </h4>
              <ol className="space-y-2 text-[11px] text-zinc-600 dark:text-zinc-400 pl-4 list-decimal leading-relaxed">
                <li>
                  点击右侧代码窗口右上角的按钮，<span className="font-semibold text-zinc-800 dark:text-zinc-200">复制预设提示词</span>；
                </li>
                <li>
                  前往第三方大模型平台，粘贴提示词并发送题图或文档；
                </li>
                <li>
                  将大模型返回的 JSON 代码复制下来；
                </li>
                <li>
                  切回本页面的 <span className="underline font-bold cursor-pointer hover:text-zinc-950 dark:hover:text-white" onClick={() => setMethod('direct')}>手动录入</span> 方式，粘贴 JSON 数据一键导入。
                </li>
              </ol>
            </div>
          )}

          {/* Show notices here */}
          {notice ? renderNotice() : null}
        </aside>

        {/* Right column: work area form */}
        <div className="min-w-0">
          {method === 'direct' && target === 'single' ? (
            <Panel title="手动录入单道题目" className="shadow-sm">
              <form className="space-y-4" onSubmit={createSingle}>
                {/* 1. Basic Metadata Section */}
                <div className="bg-zinc-50 dark:bg-zinc-900/40 rounded-xl p-4 border border-zinc-200/60 dark:border-zinc-800/40 space-y-3">
                  <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 border-b pb-2">
                    <Settings2 className="size-3.5" />
                    基本属性
                  </h4>
                  <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                    <div>
                      <label className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 block mb-1">题号 / 序号</label>
                      <input
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-850 px-3 py-1.5 text-xs focus:ring-1 focus:ring-zinc-950 focus:border-zinc-950 dark:focus:ring-zinc-200 dark:focus:border-zinc-200 outline-none transition-all"
                        placeholder="例：1"
                        value={singleDraft.questionNo}
                        onChange={(event) => setSingleDraft({ ...singleDraft, questionNo: event.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 block mb-1">学段</label>
                      <input
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-850 px-3 py-1.5 text-xs focus:ring-1 focus:ring-zinc-950 focus:border-zinc-950 dark:focus:ring-zinc-200 dark:focus:border-zinc-200 outline-none transition-all"
                        placeholder="例：高三"
                        value={singleDraft.stage}
                        onChange={(event) => setSingleDraft({ ...singleDraft, stage: event.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 block mb-1">题型</label>
                      <select
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-850 px-3 py-1.5 text-xs focus:ring-1 focus:ring-zinc-950 focus:border-zinc-950 dark:focus:ring-zinc-200 dark:focus:border-zinc-200 outline-none transition-all cursor-pointer"
                        value={singleDraft.questionType}
                        onChange={(event) => setSingleDraft({ ...singleDraft, questionType: event.target.value })}
                      >
                        <option value="单选题">单选题</option>
                        <option value="多选题">多选题</option>
                        <option value="填空题">填空题</option>
                        <option value="解答题">解答题</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 block mb-1">来源/试卷（选填）</label>
                      <input
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-850 px-3 py-1.5 text-xs focus:ring-1 focus:ring-zinc-950 focus:border-zinc-950 dark:focus:ring-zinc-200 dark:focus:border-zinc-200 outline-none transition-all"
                        placeholder="手动创建"
                        value={singleDraft.sourceTitle}
                        onChange={(event) => setSingleDraft({ ...singleDraft, sourceTitle: event.target.value })}
                      />
                    </div>
                  </div>
                </div>

                {/* 2. Question Stem and Option fields */}
                <div className="bg-zinc-50 dark:bg-zinc-900/40 rounded-xl p-4 border border-zinc-200/60 dark:border-zinc-800/40 space-y-3">
                  <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 border-b pb-2">
                    <FileText className="size-3.5" />
                    题干与选项
                  </h4>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 block">题干内容 (支持 Markdown & LaTeX)</label>
                      <div className="flex gap-1 bg-zinc-150 dark:bg-zinc-800 p-0.5 rounded-md text-[10px] border border-zinc-200 dark:border-zinc-750">
                        <button
                          type="button"
                          onClick={() => setStemTab('edit')}
                          className={`px-2 py-0.5 rounded transition-all cursor-pointer font-medium ${stemTab === 'edit' ? 'bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-150 font-bold shadow-sm' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-350'}`}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => setStemTab('preview')}
                          className={`px-2 py-0.5 rounded transition-all cursor-pointer font-medium ${stemTab === 'preview' ? 'bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-150 font-bold shadow-sm' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-350'}`}
                        >
                          预览
                        </button>
                      </div>
                    </div>
                    {stemTab === 'edit' ? (
                      <textarea
                        className="w-full min-h-28 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-850 px-3 py-2 text-xs leading-5 focus:ring-1 focus:ring-zinc-950 focus:border-zinc-950 dark:focus:ring-zinc-200 dark:focus:border-zinc-200 outline-none transition-all font-mono"
                        placeholder="例：已知集合 A = {x | x^2 - x < 0}，求..."
                        value={singleDraft.problemText}
                        onChange={(event) => setSingleDraft({ ...singleDraft, problemText: event.target.value })}
                      />
                    ) : (
                      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-850/30 p-3.5 min-h-28 text-sm overflow-auto">
                        {singleDraft.problemText.trim() ? (
                          <QuestionContent blocks={paragraphBlocksFromText(singleDraft.problemText)} />
                        ) : (
                          <span className="text-zinc-400 dark:text-zinc-500 text-xs italic">无内容预览</span>
                        )}
                      </div>
                    )}
                  </div>
                  {(singleDraft.questionType === '单选题' || singleDraft.questionType === '多选题') ? (
                    <div className="space-y-2 pt-1">
                      <label className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 block">选择题选项</label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(['A', 'B', 'C', 'D'] as const).map((labelText) => (
                          <label key={labelText} className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-850/50 px-3 py-1.5 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors">
                            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-zinc-950 text-[10px] font-bold text-white dark:bg-zinc-200 dark:text-zinc-950">{labelText}</span>
                            <input
                              className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                              placeholder={`输入选项 ${labelText}`}
                              value={choiceOptions[labelText]}
                              onChange={(event) => setChoiceOptions({ ...choiceOptions, [labelText]: event.target.value })}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* 3. Answers and Analysis */}
                <div className="bg-zinc-50 dark:bg-zinc-900/40 rounded-xl p-4 border border-zinc-200/60 dark:border-zinc-800/40 space-y-3">
                  <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 border-b pb-2">
                    <PencilLine className="size-3.5" />
                    答案与解析
                  </h4>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 block mb-1">答案文本</label>
                      <textarea
                        className="w-full min-h-24 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-850 px-3 py-2 text-xs leading-5 focus:ring-1 focus:ring-zinc-950 focus:border-zinc-950 dark:focus:ring-zinc-200 dark:focus:border-zinc-200 outline-none transition-all"
                        placeholder="请输入答案内容..."
                        value={singleDraft.answerText}
                        onChange={(event) => setSingleDraft({ ...singleDraft, answerText: event.target.value })}
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 block">解析内容 (支持 Markdown & LaTeX)</label>
                        <div className="flex gap-1 bg-zinc-150 dark:bg-zinc-800 p-0.5 rounded-md text-[10px] border border-zinc-200 dark:border-zinc-750">
                          <button
                            type="button"
                            onClick={() => setAnalysisTab('edit')}
                            className={`px-2 py-0.5 rounded transition-all cursor-pointer font-medium ${analysisTab === 'edit' ? 'bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-150 font-bold shadow-sm' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-350'}`}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            onClick={() => setAnalysisTab('preview')}
                            className={`px-2 py-0.5 rounded transition-all cursor-pointer font-medium ${analysisTab === 'preview' ? 'bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-150 font-bold shadow-sm' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-350'}`}
                          >
                            预览
                          </button>
                        </div>
                      </div>
                      {analysisTab === 'edit' ? (
                        <textarea
                          className="w-full min-h-24 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-850 px-3 py-2 text-xs leading-5 focus:ring-1 focus:ring-zinc-950 focus:border-zinc-950 dark:focus:ring-zinc-200 dark:focus:border-zinc-200 outline-none transition-all font-mono"
                          placeholder="请输入解析详情..."
                        value={singleDraft.analysisText}
                        onChange={(event) => setSingleDraft({ ...singleDraft, analysisText: event.target.value })}
                        />
                      ) : (
                        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-850/30 p-3.5 min-h-24 text-sm overflow-auto">
                          {singleDraft.analysisText.trim() ? (
                            <QuestionContent blocks={paragraphBlocksFromText(singleDraft.analysisText)} />
                          ) : (
                            <span className="text-zinc-400 dark:text-zinc-500 text-xs italic">无内容预览</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <Button type="submit" icon={Plus}>创建题目</Button>
                </div>
              </form>
            </Panel>
          ) : null}

          {method === 'direct' && target === 'paper' ? (
            <Panel title="直接导入整卷 JSON" className="shadow-sm">
              <form className="space-y-4" onSubmit={importPaper}>
                {/* Paper settings */}
                <div className="bg-zinc-50 dark:bg-zinc-900/40 rounded-xl p-4 border border-zinc-200/60 dark:border-zinc-800/40 space-y-3">
                  <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 border-b pb-2">
                    <Settings2 className="size-3.5" />
                    整卷信息
                  </h4>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 block mb-1">试卷名称 / 来源</label>
                      <input
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-850 px-3 py-1.5 text-xs focus:ring-1 focus:ring-zinc-950 focus:border-zinc-950 dark:focus:ring-zinc-200 dark:focus:border-zinc-200 outline-none transition-all"
                        placeholder="例：2026届广东省高三一调数学试题"
                        value={paperDraft.sourceTitle}
                        onChange={(event) => setPaperDraft({ ...paperDraft, sourceTitle: event.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 block mb-1">学段</label>
                      <input
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-850 px-3 py-1.5 text-xs focus:ring-1 focus:ring-zinc-950 focus:border-zinc-950 dark:focus:ring-zinc-200 dark:focus:border-zinc-200 outline-none transition-all"
                        placeholder="例：高三"
                        value={paperDraft.stage}
                        onChange={(event) => setPaperDraft({ ...paperDraft, stage: event.target.value })}
                      />
                    </div>
	                  </div>
	                </div>

	                <div className="bg-zinc-50 dark:bg-zinc-900/40 rounded-xl p-4 border border-zinc-200/60 dark:border-zinc-800/40 space-y-3">
	                  <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 border-b pb-2">
	                    <Scissors className="size-3.5" />
	                    题块绑定
	                  </h4>
	                  <div className="grid gap-2 sm:grid-cols-2">
	                    <button
	                      type="button"
	                      onClick={() => setPaperImportSource('plain')}
	                      className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${paperImportSource === 'plain' ? 'border-zinc-950 bg-white text-zinc-950 dark:border-zinc-200 dark:bg-zinc-850 dark:text-zinc-50' : 'border-zinc-200 bg-white/60 text-zinc-500 hover:text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400'}`}
	                    >
	                      <span className="block font-semibold">仅导入 JSON</span>
	                      <span className="mt-0.5 block text-[10px] text-zinc-500">不关联 PDF 切分题块。</span>
	                    </button>
	                    <button
	                      type="button"
	                      onClick={() => setPaperImportSource('slices')}
	                      className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${paperImportSource === 'slices' ? 'border-zinc-950 bg-white text-zinc-950 dark:border-zinc-200 dark:bg-zinc-850 dark:text-zinc-50' : 'border-zinc-200 bg-white/60 text-zinc-500 hover:text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400'}`}
	                    >
	                      <span className="block font-semibold">关联已切分题块</span>
	                      <span className="mt-0.5 block text-[10px] text-zinc-500">按顺序校验数量和题号后入库。</span>
	                    </button>
	                  </div>
	                  {paperImportSource === 'slices' ? (
	                    <div className="space-y-3">
	                      <div>
	                        <label className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 block mb-1">选择 PDF 切分批次</label>
	                        <select
	                          className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-850 px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-950 dark:focus:ring-zinc-200"
	                          value={selectedSliceRunId}
	                          onChange={(event) => setSelectedSliceRunId(event.target.value)}
	                        >
	                          <option value="">请选择切分批次</option>
	                          {selectableSliceRuns.map((run) => (
	                            <option key={run.runId} value={run.runId}>
	                              {(run.paperTitle || run.pdfName || run.runId)} · {run.totalQuestions || run.approvedQuestions || 0} 题
	                            </option>
	                          ))}
	                        </select>
	                      </div>
	                      {sliceDashboard.loading ? (
	                        <div className="rounded-lg border border-blue-200/40 bg-blue-50/60 px-3 py-2 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-300">正在加载切分批次...</div>
	                      ) : selectableSliceRuns.length === 0 ? (
	                        <div className="rounded-lg border border-amber-200/40 bg-amber-50/60 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">还没有可关联的切分批次。</div>
	                      ) : null}
	                      {selectedSliceRun && slicePairStatus ? (
	                        <div className="space-y-2">
	                          <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${slicePairStatus.blockingCount > 0 ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300'}`}>
	                            {slicePairStatus.blockingCount > 0 ? <InfoIcon className="size-3.5" /> : <Check className="size-3.5" />}
	                            <span>
	                              切分题块 {slicePairStatus.itemCount} 个，JSON 题目 {slicePairStatus.jsonCount} 道
	                              {slicePairStatus.blockingCount > 0 ? `，${slicePairStatus.blockingCount} 处需要处理。` : '，可以按顺序绑定。'}
	                              {slicePairStatus.pendingReviewCount > 0 ? ` 另有 ${slicePairStatus.pendingReviewCount} 个题块尚未标记为复核通过。` : ''}
	                            </span>
	                          </div>
	                          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
	                            <div className="grid grid-cols-[52px_88px_88px_minmax(0,1fr)_80px] gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-2 text-[10px] font-semibold text-zinc-500 dark:border-zinc-850 dark:bg-zinc-900/60 dark:text-zinc-400">
	                              <span>顺序</span>
	                              <span>题块题号</span>
	                              <span>JSON 题号</span>
	                              <span>题干预览</span>
	                              <span>状态</span>
	                            </div>
	                            <div className="max-h-56 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-850">
	                              {slicePairStatus.rows.map((row) => (
	                                <div key={row.index} className="grid grid-cols-[52px_88px_88px_minmax(0,1fr)_80px] gap-2 px-3 py-2 text-xs">
	                                  <span className="font-mono text-zinc-500">{row.index + 1}</span>
	                                  <span className="truncate">{row.item ? row.sliceNo : '缺题块'}</span>
	                                  <span className="truncate">{row.preview ? row.jsonNo : '缺 JSON'}</span>
	                                  <span className="line-clamp-1 min-w-0 text-zinc-700 dark:text-zinc-200">{row.preview?.problemText || '题干为空'}</span>
	                                  <span className={row.status === 'ok' ? 'text-emerald-600' : 'text-amber-600'}>
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
	                </div>

	                {/* JSON Input */}
	                <div className="bg-zinc-50 dark:bg-zinc-900/40 rounded-xl p-4 border border-zinc-200/60 dark:border-zinc-800/40 space-y-3">
                  <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 border-b pb-2">
                    <FileText className="size-3.5" />
                    试卷 JSON 数组
                  </h4>
                  <div className="space-y-2.5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <label className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 block">请在下方粘贴包含 questions 数组的 JSON 数据</label>
                      <Button type="button" variant="outline" size="sm" icon={RefreshCcw} onClick={cleanPaperJsonBackslashes}>
                        清洗反斜杠
                      </Button>
                    </div>
                    <div className="flex h-72 overflow-hidden rounded-lg border border-zinc-200 bg-white focus-within:border-zinc-950 focus-within:ring-1 focus-within:ring-zinc-950 dark:border-zinc-700 dark:bg-zinc-850 dark:focus-within:border-zinc-200 dark:focus-within:ring-zinc-200">
                      <div className="w-12 shrink-0 overflow-hidden border-r border-zinc-100 bg-zinc-50 py-2 font-mono text-[11px] leading-5 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/60">
                        <div style={{ transform: `translateY(-${paperJsonScrollTop}px)` }}>
                          {Array.from({ length: paperJsonLineCount }, (_, index) => (
                            <div key={index + 1} className="pr-2 text-right tabular-nums">{index + 1}</div>
                          ))}
                        </div>
                      </div>
                      <textarea
                        className="h-full min-w-0 flex-1 resize-none border-0 bg-transparent px-3 py-2 font-mono text-[11px] leading-5 outline-none"
                        placeholder='粘贴 {"questions": [...] } 或 [...] 格式'
                        value={paperDraft.jsonText}
                        onChange={(event) => setPaperDraft({ ...paperDraft, jsonText: event.target.value })}
                        onScroll={(event) => setPaperJsonScrollTop(event.currentTarget.scrollTop)}
                        spellCheck={false}
                      />
                    </div>
                    {'changes' in paperJsonStatus && paperJsonStatus.changes.length > 0 ? (
                      <div className="rounded-lg border border-blue-200/40 bg-blue-50/60 px-3 py-2 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-300">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="space-y-1">
                            <p className="font-semibold">已识别到可自动预处理的问题</p>
                            {paperJsonStatus.changes.map((change) => <p key={change}>{change}</p>)}
                          </div>
                          <Button type="button" variant="outline" size="sm" icon={Check} onClick={applyPaperJsonCleanup}>
                            应用修复
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {paperJsonStatus.status === 'valid' && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-405 bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-2 rounded-lg border border-emerald-200/20">
                          <Check className="size-3.5" />
                          <span>检查通过，共检测到 <strong>{paperJsonStatus.count}</strong> 道题目。{paperJsonStatus.issueCount > 0 ? `其中 ${paperJsonStatus.issueCount} 项需要注意。` : '字段完整，可以确认导入。'}</span>
                        </div>
                        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                          <div className="grid grid-cols-[56px_minmax(0,1.5fr)_72px_72px_96px] gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-2 text-[10px] font-semibold text-zinc-500 dark:border-zinc-850 dark:bg-zinc-900/60 dark:text-zinc-400">
                            <span>题号</span>
                            <span>题干预览</span>
                            <span>答案</span>
                            <span>解析</span>
                            <span>状态</span>
                          </div>
                          <div className="max-h-72 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-850">
                            {paperJsonStatus.previews.map((item) => (
                              <div key={`${item.index}-${item.questionNo}`} className="grid grid-cols-[56px_minmax(0,1.5fr)_72px_72px_96px] gap-2 px-3 py-2 text-xs">
                                <span className="font-mono text-zinc-500">{item.questionNo}</span>
                                <span className="line-clamp-2 min-w-0 text-zinc-800 dark:text-zinc-100">{item.problemText || '题干为空'}</span>
                                <span className={item.answerText.trim() ? 'text-zinc-600 dark:text-zinc-300' : 'text-amber-600'}>{item.answerText.trim() ? '有' : '缺失'}</span>
                                <span className={item.analysisText.trim() ? 'text-zinc-600 dark:text-zinc-300' : 'text-amber-600'}>{item.analysisText.trim() ? '有' : '缺失'}</span>
                                <span className={item.issues.length || item.needsHumanReview ? 'text-amber-600' : 'text-emerald-600'}>
                                  {item.needsHumanReview ? '需复核' : item.issues[0] || '可导入'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    {paperJsonStatus.status === 'invalid' && (
                      <div className="space-y-2 text-xs text-red-600 dark:text-red-405 bg-red-50/50 dark:bg-red-950/20 px-3 py-2 rounded-lg border border-red-200/20">
                        <div className="flex items-start gap-2">
                        <X className="size-3.5 shrink-0 mt-0.5" />
                        <span>JSON 语法错误: <code className="font-mono text-[10px] bg-red-100/50 dark:bg-red-900/40 px-1 py-0.5 rounded break-all">{paperJsonStatus.error}</code></span>
                        </div>
                        {paperJsonStatus.snippet ? (
                          <div className="overflow-hidden rounded-md border border-red-200/40 bg-white/70 font-mono text-[10px] leading-5 text-zinc-700 dark:border-red-900/40 dark:bg-zinc-950/50 dark:text-zinc-200">
                            {paperJsonStatus.snippet.rows.map((row) => (
                              <div key={row.line} className={row.active ? 'bg-red-100/70 dark:bg-red-950/40' : ''}>
                                <span className="inline-block w-10 select-none border-r border-red-100 px-2 text-right text-zinc-400 dark:border-red-900/40">{row.line}</span>
                                <span className="whitespace-pre-wrap px-2">{row.content || ' '}</span>
                                {row.active ? (
                                  <div>
                                    <span className="inline-block w-10 border-r border-red-100 px-2 dark:border-red-900/40" />
                                    <span className="px-2 text-red-600">{`${' '.repeat(Math.max(0, paperJsonStatus.snippet.column - 1))}^ 第 ${paperJsonStatus.snippet.column} 列`}</span>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )}
                    {paperJsonStatus.status === 'empty_array' && (
                      <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-405 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2 rounded-lg border border-amber-200/20">
                        <InfoIcon className="size-3.5" />
                        <span>{paperJsonStatus.error}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2 pt-1">
                  {notice ? (
                    <div className={`rounded-lg border px-3 py-2 text-xs ${notice.includes('失败') || notice.includes('已有') || notice.includes('请选择') || notice.includes('不一致') || notice.includes('没有') ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                      {notice}
                    </div>
                  ) : null}
                  <div className="flex justify-end">
                    {pendingBankUrl ? (
                      <Button asLink to={pendingBankUrl} icon={BadgeCheck}>
                        前往待入库确认
                      </Button>
                    ) : (
                      <Button type="submit" icon={FileStack} disabled={!canImportPaper || importingPaper}>
                        {importingPaper
                          ? '导入中...'
                          : sliceAlreadyImported
                            ? '进入待入库确认'
                            : paperJsonStatus.status === 'valid'
                              ? `确认导入 ${paperJsonStatus.count} 道题`
                              : '导入试卷'}
                      </Button>
                    )}
                  </div>
                </div>
              </form>
            </Panel>
          ) : null}

          {method === 'ai' ? (
            <Panel
              title={target === 'single' ? 'AI 辅助识别单题 Prompt 模板' : 'AI 辅助识别整卷 Prompt 模板'}
              className="shadow-sm"
            >
              <div className="space-y-4">
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-zinc-950 text-zinc-100 font-mono text-xs shadow-md">
                  <div className="bg-zinc-900 border-b border-zinc-850 px-4 py-2.5 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1.5">
                        <span className="size-3 rounded-full bg-red-500/80"></span>
                        <span className="size-3 rounded-full bg-amber-500/80"></span>
                        <span className="size-3 rounded-full bg-emerald-500/80"></span>
                      </div>
                      <span className="text-zinc-400 font-semibold text-[10px] ml-2 font-mono">ocr_prompt.md</span>
                    </div>
                    <button
                      type="button"
                      onClick={copyPrompt}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white font-sans transition-colors cursor-pointer"
                    >
                      {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                      {copied ? '已复制！' : '复制提示词'}
                    </button>
	                  </div>
	                  <pre className="max-h-[420px] overflow-auto p-4 whitespace-pre-wrap leading-5 text-zinc-300 font-mono select-all">
	                    {activeAiPrompt}
	                  </pre>
	                </div>

                <div className="flex flex-wrap items-center gap-2 py-0.5 px-1">
                  <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">快速打开 AI 平台：</span>
                  <a href="https://gemini.google.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-zinc-150 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-semibold transition-colors">
                    Gemini
                  </a>
                  <a href="https://chatgpt.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-zinc-150 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-semibold transition-colors">
                    ChatGPT
                  </a>
                  <a href="https://claude.ai" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-zinc-150 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-semibold transition-colors">
                    Claude
                  </a>
                  <a href="https://chat.qwen.ai/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-zinc-150 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-semibold transition-colors">
                    QwenStudio
                  </a>
                  <a href="https://www.doubao.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-zinc-150 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-semibold transition-colors">
                    豆包
                  </a>
                </div>

                <div className="rounded-xl border border-indigo-100 dark:border-indigo-950 bg-indigo-50/30 dark:bg-indigo-950/10 p-3.5 flex items-start gap-2.5 text-xs text-indigo-800 dark:text-indigo-300">
                  <FileText className="size-4 shrink-0 mt-0.5" />
                  <div className="leading-relaxed">
                    <span className="font-bold">提示：</span>
                    把此提示词与你的试卷图片或 PDF 文件一并发送给 Gemini 或 GPT，然后复制它输出的 JSON 并切换回本页面的 <span className="underline font-bold cursor-pointer hover:text-indigo-900 dark:hover:text-indigo-100" onClick={() => setMethod('direct')}>手动录入</span> 即可。
                  </div>
                </div>
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </section>
  )
}




export default QuestionCreatePage

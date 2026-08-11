import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  Check,
  CheckCircle,
  Code,
  Copy,
  FileStack,
  FileText,
  Info,
  PencilLine,
  Plus,
  Sparkles,
  X,
} from 'lucide-react'
import { questionBankApi } from '@/api/questionBank'
import { settingsApi } from '@/api/settings'
import { QuestionContentEditor, splitChoices, type QuestionContentValue } from '@/components/questions/editor'
import { SearchableSelect } from '@/components/SearchableSelect'
import { Button } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { useQuestionEditorDraft } from '@/hooks/useQuestionEditorDraft'
import type { RichBlock } from '@/types'
import { buildFullPaperOcrPrompt, singleQuestionOcrPrompt } from '@/constants/ocrPrompts'
import { ensureStageValue, gradeOptionsForTeachingStages } from '@/utils/stages'
import {
  formatJsonParseError,
  jsonErrorPosition,
  jsonErrorSnippet,
  paragraphBlocksFromText,
  parseStrictQuestionsFromJsonText,
  questionField,
} from '@/utils/jsonCleanup'

type NoticeType = 'info' | 'success' | 'error'
type WorkspaceTab = 'single-json' | 'single-form' | 'paper-json' | 'ai-prompt'

type StrictJsonStatus =
  | { status: 'empty' }
  | { status: 'valid'; count: number; questions: unknown[]; previews: ReturnType<typeof parseStrictQuestionsFromJsonText>['previews'] }
  | { status: 'invalid'; error: string; snippet: ReturnType<typeof jsonErrorSnippet> }

export type Draft = {
  questionNo: string
  stage: string
  questionType: string
  sourceTitle: string
  problemText: string
  answerText: string
  analysisText: string
}

const EMPTY_CONTENT: QuestionContentValue = { stemMarkdown: '', answerText: '', analysisMarkdown: '' }
const EMPTY_DRAFT: Draft = {
  questionNo: '',
  stage: '高三',
  questionType: '单选题',
  sourceTitle: '',
  problemText: '',
  answerText: '',
  analysisText: '',
}

const inputClass = 'flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 py-1 text-sm shadow-sm outline-none placeholder:text-zinc-400 focus-visible:ring-1 focus-visible:ring-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:focus-visible:ring-zinc-300'
const textareaClass = 'w-full rounded-md border border-zinc-200 bg-white p-3 font-mono text-sm leading-relaxed shadow-sm outline-none placeholder:text-zinc-400 focus-visible:ring-1 focus-visible:ring-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:focus-visible:ring-zinc-300'
const labelClass = 'text-[13px] font-medium text-zinc-500 dark:text-zinc-400'
const panelClass = 'rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950'

function strictJsonStatus(text: string): StrictJsonStatus {
  if (!text.trim()) return { status: 'empty' }
  try {
    const parsed = parseStrictQuestionsFromJsonText(text)
    return { status: 'valid', count: parsed.questions.length, questions: parsed.questions, previews: parsed.previews }
  } catch (error) {
    const { position } = jsonErrorPosition(error)
    return {
      status: 'invalid',
      error: formatJsonParseError(error, text),
      snippet: jsonErrorSnippet(text, position),
    }
  }
}

export function buildManualQuestionPayload(draft: Draft) {
  const isChoice = draft.questionType === '单选题' || draft.questionType === '多选题'
  const structuredStem = splitChoices(draft.problemText)
  const choiceBlock: RichBlock[] = isChoice
    ? [{
      type: 'choices',
      options: structuredStem.choices.map((choice) => ({
        label: choice.label,
        blocks: paragraphBlocksFromText(choice.content),
      })).filter((option) => option.blocks.length),
    }]
    : []
  return {
    ...draft,
    sourceTitle: draft.sourceTitle.trim() || '手动创建',
    stemMarkdown: draft.problemText,
    analysisMarkdown: draft.analysisText,
    problemBlocks: [...paragraphBlocksFromText(isChoice ? structuredStem.body : draft.problemText), ...choiceBlock],
    answerBlocks: paragraphBlocksFromText(draft.answerText),
    analysisBlocks: paragraphBlocksFromText(draft.analysisText),
  }
}

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

export function buildSingleQuestionImportPayload(question: unknown, fallback: Draft) {
  const draft = questionFromUnknown(question, fallback)
  return {
    draft,
    payload: {
      questions: [question],
      sourceTitle: draft.sourceTitle.trim() || '手动创建',
      stage: draft.stage,
    },
  }
}

function noticeTone(text: string): NoticeType {
  if (text.includes('失败') || text.includes('错误') || text.includes('请') || text.includes('必须')) return 'error'
  if (text.includes('成功') || text.includes('已')) return 'success'
  return 'info'
}

export function QuestionCreatePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('single-json')
  const [notice, setNoticeText] = useState('')
  const [noticeType, setNoticeType] = useState<NoticeType>('info')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [promptKind, setPromptKind] = useState<'single' | 'paper'>('single')
  const [singleJsonText, setSingleJsonText] = useState('')
  const [singleDraft, setSingleDraft] = useState<Draft>(EMPTY_DRAFT)
  const [paperDraft, setPaperDraft] = useState({ sourceTitle: '', stage: '高三', jsonText: '' })
  const singleContentDraft = useQuestionEditorDraft({
    entityType: 'question',
    entityId: 'new',
    initialValue: EMPTY_CONTENT,
  })

  const ocrSettings = useAsync(() => settingsApi.getOcrSettings(), [])
  const configuredStageOptions = gradeOptionsForTeachingStages(ocrSettings.data?.teachingStages)
  const singleStageOptions = singleDraft.stage && !configuredStageOptions.includes(singleDraft.stage)
    ? [singleDraft.stage, ...configuredStageOptions]
    : configuredStageOptions
  const paperStageOptions = paperDraft.stage && !configuredStageOptions.includes(paperDraft.stage)
    ? [paperDraft.stage, ...configuredStageOptions]
    : configuredStageOptions

  const singleJson = useMemo(() => strictJsonStatus(singleJsonText), [singleJsonText])
  const paperJson = useMemo(() => strictJsonStatus(paperDraft.jsonText), [paperDraft.jsonText])
  const activePrompt = promptKind === 'single' ? singleQuestionOcrPrompt : buildFullPaperOcrPrompt()

  useEffect(() => {
    if (searchParams.get('method') === 'ai' || searchParams.get('prompt')) {
      setPromptKind(searchParams.get('target') === 'paper' || searchParams.get('prompt') === 'paper' ? 'paper' : 'single')
      setActiveTab('ai-prompt')
    } else if (searchParams.get('target') === 'paper') {
      setActiveTab('paper-json')
    }
  }, [searchParams])

  function setNotice(text: string, type: NoticeType = noticeTone(text)) {
    setNoticeText(text)
    setNoticeType(type)
  }

  async function createQuestion(draft: Draft) {
    if (!draft.problemText.trim()) throw new Error('请填写题干。')
    const item = await questionBankApi.createItem(buildManualQuestionPayload(draft))
    setNotice(`已创建题目 ${item.serialNo ?? item.questionNo ?? item.id}。`, 'success')
    navigate('/questions')
  }

  async function createFromEditor(content: QuestionContentValue) {
    setSaving(true)
    try {
      await createQuestion({
        ...singleDraft,
        problemText: content.stemMarkdown,
        answerText: content.answerText,
        analysisText: content.analysisMarkdown,
      })
      singleContentDraft.markSaved(content)
    } finally {
      setSaving(false)
    }
  }

  async function createSingleFromJson(event: FormEvent) {
    event.preventDefault()
    if (singleJson.status !== 'valid' || singleJson.count !== 1) {
      setNotice('单题 JSON 必须严格合法且只包含一道题。', 'error')
      return
    }
    setSaving(true)
    try {
      const { draft, payload } = buildSingleQuestionImportPayload(singleJson.questions[0], singleDraft)
      if (!draft.problemText.trim()) throw new Error('请填写题干。')
      const result = await questionBankApi.importJsonItems(payload)
      const item = result.items[0]
      setNotice(`已创建题目 ${item?.serialNo ?? item?.questionNo ?? ''}。`, 'success')
      navigate('/questions')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function importPaper(event: FormEvent) {
    event.preventDefault()
    if (paperJson.status !== 'valid' || paperJson.count === 0) {
      setNotice('试卷 JSON 必须严格合法且至少包含一道题。', 'error')
      return
    }
    setSaving(true)
    try {
      const result = await questionBankApi.importJsonItems({
        questions: paperJson.questions,
        sourceTitle: paperDraft.sourceTitle.trim() || 'JSON 批量导入',
        stage: paperDraft.stage,
      })
      setNotice(`已导入 ${result.count} 道题。`, 'success')
      navigate('/questions')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(activePrompt)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const tabs: Array<{ key: WorkspaceTab; title: string; description: string; Icon: typeof Code }> = [
    { key: 'single-json', title: 'JSON 单题录入', description: '严格解析单题', Icon: Code },
    { key: 'single-form', title: '表单录入', description: '编辑题目内容', Icon: PencilLine },
    { key: 'paper-json', title: '整套试卷 JSON', description: '批量预览导入', Icon: FileStack },
    { key: 'ai-prompt', title: 'AI 转写提示词', description: '复制标准模板', Icon: Sparkles },
  ]

  return (
    <section className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">新建题目</h1>
        <p className="mt-1 text-[13px] text-zinc-500">录入单题或导入标准 JSON。</p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4" role="tablist" aria-label="录入方式">
        {tabs.map(({ key, title, description, Icon }) => {
          const active = activeTab === key
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(key)}
              className={`flex min-h-16 items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${active ? 'border-zinc-900 bg-zinc-50 text-zinc-950 dark:border-zinc-100 dark:bg-zinc-900 dark:text-zinc-50' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900'}`}
            >
              <Icon className="size-4 shrink-0" />
              <span className="min-w-0"><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-zinc-500">{description}</span></span>
            </button>
          )
        })}
      </div>

      {notice ? <Notice text={notice} type={noticeType} onClose={() => setNoticeText('')} /> : null}

      {activeTab === 'single-json' ? (
        <form className={`${panelClass} space-y-5 p-5`} onSubmit={createSingleFromJson}>
          <PanelHeading icon={Code} title="JSON 单题录入" description="输入严格合法的 JSON。" />
          <textarea className={`${textareaClass} min-h-80`} value={singleJsonText} onChange={(event) => setSingleJsonText(event.target.value)} placeholder='{"questionNo":"1","problemText":"...","answerText":"..."}' spellCheck={false} />
          <JsonStatus status={singleJson} expected="single" />
          <div className="flex justify-end"><Button type="submit" icon={Plus} disabled={saving || singleJson.status !== 'valid' || singleJson.count !== 1}>{saving ? '保存中…' : '解析并保存'}</Button></div>
        </form>
      ) : null}

      {activeTab === 'single-form' ? (
        <div className="space-y-5">
          <div className={`${panelClass} p-5`}>
            <PanelHeading icon={PencilLine} title="题目属性" description="设置题号、类型、学段和来源。" />
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5"><span className={labelClass}>题号</span><input className={inputClass} value={singleDraft.questionNo} onChange={(event) => setSingleDraft({ ...singleDraft, questionNo: event.target.value })} /></label>
              <label className="space-y-1.5"><span className={labelClass}>来源名称</span><input className={inputClass} value={singleDraft.sourceTitle} onChange={(event) => setSingleDraft({ ...singleDraft, sourceTitle: event.target.value })} /></label>
              <label className="space-y-1.5"><span className={labelClass}>题型</span><select className={inputClass} value={singleDraft.questionType} onChange={(event) => setSingleDraft({ ...singleDraft, questionType: event.target.value })}>{['单选题', '多选题', '填空题', '解答题'].map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="space-y-1.5"><span className={labelClass}>学段</span><SearchableSelect value={ensureStageValue(singleDraft.stage, singleStageOptions)} options={singleStageOptions} onChange={(stage) => setSingleDraft({ ...singleDraft, stage })} searchPlaceholder="搜索学段" /></label>
            </div>
          </div>
          {singleContentDraft.hasRecoveredDraft ? (
            <div role="status" className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/30 p-3 text-xs text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span className="flex-1">已恢复本机保存的未完成内容{singleContentDraft.recoveredAt ? `（${singleContentDraft.recoveredAt.toLocaleString()}）` : ''}。</span>
              <button type="button" className="font-medium" onClick={singleContentDraft.discardDraft}>放弃草稿</button>
            </div>
          ) : null}
          <QuestionContentEditor
            entityKey="question:new"
            title="题干、答案与解析"
            questionType={singleDraft.questionType}
            value={singleContentDraft.value}
            savedValue={EMPTY_CONTENT}
            onChange={singleContentDraft.setValue}
            onSave={createFromEditor}
            saving={saving}
            dirty={singleContentDraft.dirty}
          />
        </div>
      ) : null}

      {activeTab === 'paper-json' ? (
        <form className={`${panelClass} space-y-5 p-5`} onSubmit={importPaper}>
          <PanelHeading icon={FileStack} title="整套试卷 JSON" description="预览题目后批量导入题库。" />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5"><span className={labelClass}>试卷名称</span><input className={inputClass} value={paperDraft.sourceTitle} onChange={(event) => setPaperDraft({ ...paperDraft, sourceTitle: event.target.value })} /></label>
            <label className="space-y-1.5"><span className={labelClass}>全局学段</span><SearchableSelect value={ensureStageValue(paperDraft.stage, paperStageOptions)} options={paperStageOptions} onChange={(stage) => setPaperDraft({ ...paperDraft, stage })} searchPlaceholder="搜索学段" /></label>
          </div>
          <textarea className={`${textareaClass} min-h-64`} value={paperDraft.jsonText} onChange={(event) => setPaperDraft({ ...paperDraft, jsonText: event.target.value })} placeholder='{"questions":[...]}' spellCheck={false} />
          <JsonStatus status={paperJson} expected="paper" />
          {paperJson.status === 'valid' && paperJson.count > 0 ? <QuestionPreview rows={paperJson.previews} /> : null}
          <div className="flex justify-end"><Button type="submit" icon={FileStack} disabled={saving || paperJson.status !== 'valid' || paperJson.count === 0}>{saving ? '导入中…' : paperJson.status === 'valid' && paperJson.count > 0 ? `确认导入 ${paperJson.count} 道题` : '导入试卷'}</Button></div>
        </form>
      ) : null}

      {activeTab === 'ai-prompt' ? (
        <div className={`${panelClass} space-y-5 p-5`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <PanelHeading icon={Sparkles} title="AI 转写提示词" description="生成题库标准 JSON 的转写模板。" />
            <div className="flex shrink-0 rounded-lg border border-zinc-200/50 bg-zinc-100/80 p-0.5 dark:border-zinc-800/50 dark:bg-zinc-900/80">
              {(['single', 'paper'] as const).map((kind) => <button key={kind} type="button" className={`h-8 rounded-md px-3 text-xs font-medium ${promptKind === kind ? 'border border-zinc-200/50 bg-white text-zinc-900 shadow-xs dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500'}`} onClick={() => setPromptKind(kind)}>{kind === 'single' ? '单题' : '整套试卷'}</button>)}
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800"><span className="font-mono text-xs text-zinc-500">ocr_prompt.md</span><Button type="button" variant="outline" size="sm" icon={copied ? Check : Copy} onClick={copyPrompt}>{copied ? '已复制' : '复制'}</Button></div>
            <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed text-zinc-900 dark:text-zinc-100">{activePrompt}</pre>
          </div>
          <div className="flex flex-wrap gap-2">{[['ChatGPT', 'https://chatgpt.com'], ['Gemini', 'https://gemini.google.com'], ['Claude', 'https://claude.ai'], ['Qwen', 'https://chat.qwen.ai/']].map(([label, href]) => <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900">{label}</a>)}</div>
        </div>
      ) : null}
    </section>
  )
}

function PanelHeading({ icon: Icon, title, description }: { icon: typeof Code; title: string; description: string }) {
  return <div className="flex items-start gap-3"><Icon className="mt-0.5 size-4 shrink-0 text-zinc-500" /><div><h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h2><p className="mt-1 text-[13px] text-zinc-500">{description}</p></div></div>
}

function Notice({ text, type, onClose }: { text: string; type: NoticeType; onClose: () => void }) {
  const tone = type === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400'
    : type === 'error'
      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400'
      : 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300'
  const Icon = type === 'success' ? CheckCircle : type === 'error' ? AlertTriangle : Info
  return <div role={type === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-lg border p-3 text-xs ${tone}`}><Icon className="mt-0.5 size-4 shrink-0" /><span className="flex-1">{text}</span><button type="button" aria-label="关闭提示" onClick={onClose}><X className="size-4" /></button></div>
}

function JsonStatus({ status, expected }: { status: StrictJsonStatus; expected: 'single' | 'paper' }) {
  if (status.status === 'empty') return <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300"><FileText className="size-4" />等待输入 JSON</div>
  if (status.status === 'invalid') return (
    <div role="alert" className="space-y-3 rounded-lg border border-red-200 bg-red-50/30 p-3 text-xs text-red-800 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">
      <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>{status.error}</span></div>
      {status.snippet ? <div className="overflow-x-auto rounded border border-red-200/70 bg-white/70 p-2 font-mono dark:border-red-900/40 dark:bg-zinc-950/50">{status.snippet.rows.map((row) => <div key={row.line} className={row.active ? 'font-semibold' : 'opacity-70'}>{String(row.line).padStart(4, ' ')} | {row.content}</div>)}</div> : null}
    </div>
  )
  const countValid = expected === 'single' ? status.count === 1 : status.count > 0
  return <div className={`flex items-center gap-2 rounded-lg border p-3 text-xs ${countValid ? 'border-emerald-200 bg-emerald-50/50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400' : 'border-amber-200 bg-amber-50/50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400'}`}>{countValid ? <CheckCircle className="size-4" /> : <AlertTriangle className="size-4" />}{expected === 'single' && status.count !== 1 ? `检测到 ${status.count} 道题，单题录入必须恰好包含一道题。` : `严格 JSON 校验通过，检测到 ${status.count} 道题。`}</div>
}

function QuestionPreview({ rows }: { rows: ReturnType<typeof parseStrictQuestionsFromJsonText>['previews'] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="grid grid-cols-[64px_minmax(0,1fr)_72px_72px_88px] gap-2 border-b border-zinc-200 bg-zinc-50/70 px-3 py-2 text-xs font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40"><span>题号</span><span>题干</span><span>答案</span><span>解析</span><span>状态</span></div>
      <div className="max-h-72 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-900">{rows.map((row) => <div key={`${row.index}-${row.questionNo}`} className="grid grid-cols-[64px_minmax(0,1fr)_72px_72px_88px] gap-2 px-3 py-2.5 text-xs"><span className="font-mono text-zinc-500">{row.questionNo}</span><span className="line-clamp-2 min-w-0 text-zinc-700 dark:text-zinc-300">{row.problemText || '题干为空'}</span><span className={row.answerText.trim() ? 'text-zinc-500' : 'text-amber-700'}>{row.answerText.trim() ? '有' : '缺失'}</span><span className={row.analysisText.trim() ? 'text-zinc-500' : 'text-amber-700'}>{row.analysisText.trim() ? '有' : '缺失'}</span><span className={row.issues.length || row.needsHumanReview ? 'text-amber-700' : 'text-emerald-700'}>{row.needsHumanReview ? '需复核' : row.issues[0] || '可导入'}</span></div>)}</div>
    </div>
  )
}

export default QuestionCreatePage

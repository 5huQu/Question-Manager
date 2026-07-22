import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, FileStack, Plus } from 'lucide-react'
import { questionBankApi } from '@/api/questionBank'
import { Button } from '@/components/ui'
import type { RichBlock } from '@/types'
import { splitChoices } from '@/components/questions/editor'
import { paragraphBlocksFromText, parsePaperQuestionsFromJsonText } from '@/utils/jsonCleanup'

export type Draft = {
  questionNo: string
  stage: string
  questionType: string
  sourceTitle: string
  problemText: string
  answerText: string
  analysisText: string
}

const emptyDraft: Draft = {
  questionNo: '',
  stage: '高三',
  questionType: '单选题',
  sourceTitle: '',
  problemText: '',
  answerText: '',
  analysisText: '',
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

export function QuestionCreatePage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'single' | 'batch'>('single')
  const [draft, setDraft] = useState(emptyDraft)
  const [jsonText, setJsonText] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)

  const batchPreview = useMemo(() => {
    if (!jsonText.trim()) return { count: 0, error: '' }
    try {
      const parsed = parsePaperQuestionsFromJsonText(jsonText)
      return { count: parsed.questions.length, questions: parsed.questions, error: '' }
    } catch (error) {
      return { count: 0, error: error instanceof Error ? error.message : String(error) }
    }
  }, [jsonText])

  async function submitSingle(event: FormEvent) {
    event.preventDefault()
    if (!draft.problemText.trim()) {
      setNotice('请填写题干。')
      return
    }
    setSaving(true)
    try {
      await questionBankApi.createItem(buildManualQuestionPayload(draft))
      navigate('/questions')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function submitBatch(event: FormEvent) {
    event.preventDefault()
    if (!batchPreview.count || !batchPreview.questions) {
      setNotice(batchPreview.error || '请输入包含 questions 数组的 JSON。')
      return
    }
    setSaving(true)
    try {
      await questionBankApi.importJsonItems({ questions: batchPreview.questions })
      navigate('/questions')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-zinc-950 dark:border-zinc-800 dark:bg-zinc-950'
  const textareaClass = `${inputClass} min-h-28 font-mono`

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">新建题目</h1>
        <p className="mt-1 text-sm text-zinc-500">手动录入单题，或导入标准 JSON。旧版 PDF 切题入口已退役。</p>
      </div>
      <div className="flex gap-2">
        <Button variant={mode === 'single' ? 'default' : 'outline'} onClick={() => setMode('single')}>单题录入</Button>
        <Button variant={mode === 'batch' ? 'default' : 'outline'} onClick={() => setMode('batch')}>JSON 批量导入</Button>
      </div>
      {notice ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{notice}</div> : null}
      {mode === 'single' ? (
        <form className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950" onSubmit={submitSingle}>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className={inputClass} placeholder="题号" value={draft.questionNo} onChange={(event) => setDraft({ ...draft, questionNo: event.target.value })} />
            <input className={inputClass} placeholder="来源名称" value={draft.sourceTitle} onChange={(event) => setDraft({ ...draft, sourceTitle: event.target.value })} />
            <select className={inputClass} value={draft.questionType} onChange={(event) => setDraft({ ...draft, questionType: event.target.value })}>
              {['单选题', '多选题', '填空题', '解答题'].map((value) => <option key={value}>{value}</option>)}
            </select>
            <input className={inputClass} placeholder="学段" value={draft.stage} onChange={(event) => setDraft({ ...draft, stage: event.target.value })} />
          </div>
          <textarea className={textareaClass} placeholder="题干 Markdown" value={draft.problemText} onChange={(event) => setDraft({ ...draft, problemText: event.target.value })} />
          <textarea className={textareaClass} placeholder="答案 Markdown" value={draft.answerText} onChange={(event) => setDraft({ ...draft, answerText: event.target.value })} />
          <textarea className={textareaClass} placeholder="解析 Markdown" value={draft.analysisText} onChange={(event) => setDraft({ ...draft, analysisText: event.target.value })} />
          <div className="flex justify-end"><Button type="submit" icon={Plus} disabled={saving}>{saving ? '保存中…' : '创建题目'}</Button></div>
        </form>
      ) : (
        <form className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950" onSubmit={submitBatch}>
          <textarea className={`${textareaClass} min-h-80`} placeholder='{"questions": [...]}' value={jsonText} onChange={(event) => setJsonText(event.target.value)} />
          {batchPreview.count > 0 ? <div className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle className="size-4" />检测到 {batchPreview.count} 道题</div> : null}
          {batchPreview.error ? <div className="text-sm text-red-600">{batchPreview.error}</div> : null}
          <div className="flex justify-end"><Button type="submit" icon={FileStack} disabled={saving || !batchPreview.count}>{saving ? '导入中…' : '确认导入'}</Button></div>
        </form>
      )}
    </div>
  )
}

export default QuestionCreatePage

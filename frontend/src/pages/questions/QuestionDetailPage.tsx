import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Check, Crop, FolderArchive, LoaderCircle, PencilLine, ScanSearch, Scissors, Trash2, X } from 'lucide-react'
import { api, jsonHeaders } from '@/api/client'
import { FigureCropDialog } from '@/components/questions/FigureDialogs'
import { EditDialog } from '@/components/questions/EditDialog'
import { QuestionMarkdownContent, SolutionDisclosure } from '@/components/questions/QuestionContent'
import { Badge, Button, Empty, PageTitle, Panel } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { OcrProgress, QuestionFigure, QuestionItem } from '@/types'
import { addQuestionToActiveBasket } from '@/utils/questionBasket'
import { difficultyLabel10, label } from '@/utils/questionDisplay'
import { richBlocksPlainText } from '@/components/RichContent'

export function QuestionDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const decodedId = decodeURIComponent(id)
  const { data, error, loading, reload } = useAsync<QuestionItem>(() => api(`/api/question-bank/items/${encodeURIComponent(decodedId)}`), [decodedId])
  const [cropOpen, setCropOpen] = useState(false)
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null)
  const [editing, setEditing] = useState(false)
  const [editNotice, setEditNotice] = useState<null | { kind: 'success' | 'error'; text: string }>(null)
  const [ocrAction, setOcrAction] = useState('')
  const [draft, setDraft] = useState<Partial<QuestionItem>>({})
  useEffect(() => {
    if (data) setDraft(data)
  }, [data])
  async function save(nextDraft = draft) {
    setEditNotice(null)
    await api(`/api/question-bank/items/${encodeURIComponent(decodedId)}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ item: nextDraft }) })
    setDraft(nextDraft)
    setEditing(false)
    setEditNotice({ kind: 'success', text: '已保存当前 JSON/Markdown，并完成格式校验。' })
    reload()
  }
  async function addFigure(payload: { usage: string; optionLabel?: string; bbox: Record<string, number> }) {
    return api<QuestionFigure>(`/api/question-bank/items/${encodeURIComponent(decodedId)}/figures`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ usage: payload.usage, optionLabel: payload.optionLabel, pageNumber: 1, bbox: payload.bbox }) })
  }
  async function updateFigure(figureId: string, payload: { usage: string; optionLabel?: string; bbox: Record<string, number> }) {
    return api<QuestionFigure>(`/api/question-bank/items/${encodeURIComponent(decodedId)}/figures/${encodeURIComponent(figureId)}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ usage: payload.usage, optionLabel: payload.optionLabel, pageNumber: 1, bbox: payload.bbox }) })
  }
  async function deleteFigure(figureId: string) {
    await api(`/api/question-bank/items/${encodeURIComponent(decodedId)}/figures/${encodeURIComponent(figureId)}`, { method: 'DELETE' })
  }
  async function loadQuestionOcrProgress(runId: string) {
    const next = await api<OcrProgress>(`/api/tools/pdf-slicer/runs/${runId}/ocr-progress`)
    setOcrProgress(next)
    return next
  }
  async function quickOcr() {
    if (!data.sourceRunId) return
    setOcrAction('whole')
    try {
      await api(`/api/tools/pdf-slicer/runs/${data.sourceRunId}/start-ocr`, { method: 'POST' })
      const runId = data.sourceRunId
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const next = await loadQuestionOcrProgress(runId)
        const status = next.run?.ocrStatus
        if (status === 'succeeded') {
          await reload()
          return
        }
        if (status === 'failed') return
        await new Promise((resolve) => window.setTimeout(resolve, 1000))
      }
    } finally {
      setOcrAction('')
    }
  }
  async function chunkOcr() {
    if (!data.sourceRunId) return
    const confirmed = window.confirm('分块 OCR 会重新识别并覆盖当前题干、答案和解析。仅在整图 OCR 效果不好时使用，是否继续？')
    if (!confirmed) return
    setOcrAction('region')
    setEditNotice(null)
    try {
      const task = await api<{ runId: string; message?: string }>(`/api/question-bank/items/${encodeURIComponent(decodedId)}/rerun-ocr`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ route: 'region_chunks' }),
      })
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const next = await loadQuestionOcrProgress(task.runId)
        const status = next.run?.ocrStatus
        if (status === 'succeeded') {
          await reload()
          setEditNotice({ kind: 'success', text: task.message || '分块 OCR 已完成并回填当前题。' })
          return
        }
        if (status === 'failed') {
          setEditNotice({ kind: 'error', text: next.run?.ocrError || '分块 OCR 失败，请查看 OCR 队列日志。' })
          return
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000))
      }
      setEditNotice({ kind: 'error', text: '分块 OCR 已启动，但等待超时；请到 OCR 队列查看进度。' })
    } catch (error) {
      setEditNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setOcrAction('')
    }
  }
  async function deleteQuestion() {
    await api(`/api/question-bank/items/${encodeURIComponent(decodedId)}`, { method: 'DELETE' })
    navigate('/questions')
  }
  useEffect(() => {
    if (!data?.sourceRunId) return
    loadQuestionOcrProgress(data.sourceRunId).catch(() => undefined)
    const timer = window.setInterval(() => loadQuestionOcrProgress(data.sourceRunId).catch(() => undefined), 2500)
    return () => window.clearInterval(timer)
  }, [data?.sourceRunId])
  if (loading) return <Empty text="读取中..." />
  if (error || !data) return <Empty text={error || '题目不存在'} />
  return (
    <section className="space-y-4 xl:flex xl:h-[calc(100vh-4rem)] xl:min-h-0 xl:flex-col xl:overflow-hidden">
      <PageTitle title="题目详情" desc="左侧信息，中间题目内容预览，右侧集中放快捷操作。" path={`/questions/${decodedId}`} />
      <div className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[260px_minmax(0,1fr)_280px] xl:overflow-hidden">
        <Panel title="题目信息" className="xl:self-start">
          <div className="space-y-4">
            {/* Primary Grid info */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border bg-zinc-100 p-2.5 flex flex-col justify-between">
                <span className="text-[10px] text-zinc-400 font-medium">学段</span>
                <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 mt-1">{data.stage || '未设学段'}</span>
              </div>
              <div className="rounded-xl border bg-zinc-100 p-2.5 flex flex-col justify-between">
                <span className="text-[10px] text-zinc-400 font-medium">题型</span>
                <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 mt-1">{data.questionType || '未设题型'}</span>
              </div>
              <div className="rounded-xl border bg-zinc-100 p-2.5 flex flex-col justify-between col-span-2">
                <span className="text-[10px] text-zinc-400 font-medium">来源</span>
                <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 mt-1 truncate" title={data.sourceTitle}>{data.sourceTitle || '来源待补充'}</span>
              </div>
              <div className="col-span-2 mt-1">
                <Badge variant={
                  (data.difficultyScore10 >= 8 || data.difficultyScore === 'hard' || data.difficultyScore === 'expert') ? 'danger' :
                  (data.difficultyScore10 >= 5 || data.difficultyScore === 'medium') ? 'warning' :
                  (data.difficultyScore10 >= 3) ? 'default' : 'success'
                }>
                  {difficultyLabel10(data)}
                </Badge>
              </div>
            </div>

            {/* Knowledge points & Solution methods */}
            <div className="space-y-3 pt-2 border-t">
              <div className="space-y-1.5">
                <span className="text-[10px] text-zinc-400 font-semibold block">知识点</span>
                <div className="flex flex-wrap gap-1">
                  {((data.knowledgePoints?.length ? data.knowledgePoints : [data.chapter]).filter(Boolean).length > 0) ? (
                    (data.knowledgePoints?.length ? data.knowledgePoints : [data.chapter]).filter(Boolean).map((kp, i) => (
                      <span key={i} className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50">
                        {kp}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-zinc-400 italic">知识点未设置</span>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[10px] text-zinc-400 font-semibold block">解题方法</span>
                <div className="flex flex-wrap gap-1">
                  {data.solutionMethods?.length ? (
                    data.solutionMethods.map((sm, i) => (
                      <span key={i} className="solution-method-tag text-[11px] font-medium px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100">
                        {sm}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-zinc-400 italic">方法未设置</span>
                  )}
                </div>
              </div>
            </div>

            {/* Database & Resource info */}
            <div className="pt-2 border-t space-y-1.5 text-xs text-zinc-500">
              <div className="flex justify-between items-center py-1">
                <span>题图资源</span>
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">{data.figures.length} 个</span>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="题目内容预览" className="xl:flex xl:min-h-0 xl:flex-col" bodyClassName="xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overflow-x-hidden">
          <article className="space-y-4 rounded-2xl border bg-white p-5 xl:min-h-full">
            <QuestionMarkdownContent
              className="text-sm leading-7"
              content={data.stemMarkdown || richBlocksPlainText(data.problemBlocks)}
              figures={data.figures}
              prefix={`#${data.serialNo ?? data.questionNo}`}
            />
            <SolutionDisclosure
              answerText={data.answerText || richBlocksPlainText(data.answerBlocks)}
              analysisMarkdown={data.analysisMarkdown || richBlocksPlainText(data.analysisBlocks)}
              figures={data.figures}
              className="border-t pt-3"
            />
          </article>
        </Panel>

        <Panel title="快捷操作" className="xl:self-start">
          <div className="space-y-4">
            {/* Primary Action Buttons */}
            <div className="space-y-2">
              <span className="text-[10px] text-zinc-400 font-semibold block">题目工具</span>
              <div className="grid gap-2">
	                <Button
	                  className="w-full justify-start text-[13px] font-medium"
	                  icon={ScanSearch}
	                  disabled={!data.sourceRunId || ocrProgress?.active || Boolean(ocrAction)}
	                  onClick={quickOcr}
	                >
	                  {ocrAction === 'whole' ? '整图 OCR 中...' : '重新 OCR'}
	                </Button>
	                <Button
	                  className="w-full justify-start text-[13px] font-medium"
	                  variant="outline"
	                  icon={Scissors}
	                  disabled={!data.sourceRunId || ocrProgress?.active || Boolean(ocrAction)}
	                  onClick={chunkOcr}
	                >
	                  {ocrAction === 'region' ? '分块 OCR 中...' : '分块 OCR'}
	                </Button>
                <Button
                  className="w-full justify-start text-[13px] font-medium"
                  variant="outline"
                  icon={FolderArchive}
                  onClick={() => addQuestionToActiveBasket(data.id)}
                >
                  加入试题篮
                </Button>
                <Button
                  className="w-full justify-start text-[13px] font-medium"
                  variant="outline"
                  icon={Crop}
                  onClick={() => setCropOpen(true)}
                >
                  框选题图
                </Button>
              </div>
            </div>

            {/* Editing actions */}
            <div className="space-y-2 pt-2 border-t">
              <span className="text-[10px] text-zinc-400 font-semibold block">数据维护</span>
              <div className="grid gap-2">
                <Button
                  className="w-full justify-start text-[13px] font-medium"
                  variant="outline"
                  icon={PencilLine}
                  onClick={() => setEditing(true)}
                >
                  编辑题目
                </Button>
              </div>
              {editNotice ? (
                <div className={`rounded-xl border px-3 py-2 text-xs leading-5 ${
                  editNotice.kind === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-red-200 bg-red-50 text-red-700'
                }`}>
                  {editNotice.text}
                </div>
              ) : null}
            </div>

            {/* Danger actions */}
            <div className="space-y-2 pt-2 border-t">
              <span className="text-[10px] text-zinc-400 font-semibold block">危险操作</span>
              <Button
                className="w-full justify-start text-[13px] font-medium"
                variant="danger"
                icon={Trash2}
                onClick={deleteQuestion}
              >
                删除题目
              </Button>
            </div>

            {/* Status Info / Progress */}
            {(() => {
              const ocrStatus = ocrProgress?.run?.ocrStatus || 'succeeded'
              const isFailed = ocrStatus === 'failed' || ocrStatus === 'error'
              const isSucceeded = ocrStatus === 'succeeded'
              const isRunning = ocrStatus === 'running' || ocrStatus === 'queued'

              const boxClass = isFailed
                ? 'bg-red-50 border-red-200 text-red-700'
                : isSucceeded
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : isRunning
                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : 'bg-zinc-100 border-zinc-200 text-zinc-700'

              const labelText = isFailed
                ? 'OCR 识别失败'
                : isSucceeded
                  ? 'OCR 识别已完成'
                  : isRunning
                    ? 'OCR 识别进行中'
                    : `OCR 状态：${label(ocrStatus)}`

              return (
                <div className="space-y-2 pt-2 border-t">
                  <span className="text-[10px] text-zinc-400 font-semibold block">识别状态</span>
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${boxClass}`}>
                    {isSucceeded && <Check className="size-4 shrink-0" />}
                    {isFailed && <X className="size-4 shrink-0" />}
                    {isRunning && <LoaderCircle className="size-4 shrink-0 animate-spin" />}
                    {!isSucceeded && !isFailed && !isRunning && <LoaderCircle className="size-4 shrink-0" />}
                    <span className="text-xs font-semibold">{labelText}</span>
                  </div>
                </div>
              )
            })()}
          </div>
        </Panel>
      </div>
      {editing ? <EditDialog draft={draft} setDraft={setDraft} onClose={() => setEditing(false)} onSave={save} /> : null}
      {cropOpen ? <FigureCropDialog question={data} onClose={(changed) => { setCropOpen(false); if (changed) reload() }} onDelete={deleteFigure} onSave={addFigure} onUpdate={updateFigure} /> : null}
    </section>
  )
}


export default QuestionDetailPage

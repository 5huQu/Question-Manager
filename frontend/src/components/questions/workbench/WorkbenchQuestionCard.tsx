import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, Calendar, Check, CheckCircle, ChevronDown, ChevronUp, Crop, PencilLine, ShoppingBag, Trash2 } from 'lucide-react'
import { questionBankApi } from '@/api/questionBank'
import { FigureCropDialog } from '@/components/questions/FigureDialogs'
import { EditDialog } from '@/components/questions/EditDialog'
import { MarkdownWithInlineFigures, QuestionMarkdownContent } from '@/components/questions/QuestionContent'
import type { QuestionItem } from '@/types'
import { difficultyLabel10, displaySource } from '@/utils/questionDisplay'
import { richBlocksPlainText } from '@/components/RichContent'

export function WorkbenchQuestionCard({
  item,
  onAddToBasket,
  onDelete,
  onReload,
  onQuestionSaved,
  isInBasket = false,
  showFigureAction = true,
  expandAll,
}: {
  item: QuestionItem
  onAddToBasket: (id: string) => void
  onDelete: (id: string) => void
  onReload: () => void
  onQuestionSaved?: (item: QuestionItem) => void
  isInBasket?: boolean
  showFigureAction?: boolean
  expandAll?: boolean
}) {
  const [cropOpen, setCropOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Partial<QuestionItem>>(item)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [saveNotice, setSaveNotice] = useState('')

  useEffect(() => {
    setDraft(item)
  }, [item])

  useEffect(() => {
    if (expandAll !== undefined) setShowAnalysis(expandAll)
  }, [expandAll])

  async function addFigure(payload: { usage: string; optionLabel?: string; bbox: Record<string, number> }) {
    return questionBankApi.createFigure(item.id, { usage: payload.usage, optionLabel: payload.optionLabel, pageNumber: 1, bbox: payload.bbox })
  }
  async function deleteFigure(figureId: string) {
    await questionBankApi.deleteFigure(item.id, figureId)
  }
  async function updateFigure(figureId: string, payload: { usage: string; optionLabel?: string; bbox: Record<string, number> }) {
    return questionBankApi.updateFigure(item.id, figureId, { usage: payload.usage, optionLabel: payload.optionLabel, pageNumber: 1, bbox: payload.bbox })
  }
  function closeCropDialog(changed?: boolean) {
    setCropOpen(false)
    if (changed) onReload()
  }
  async function saveEditedQuestion(nextDraft = draft) {
    const saved = await questionBankApi.updateItem(item.id, nextDraft, item.contentRevision)
    setDraft(saved)
    setEditing(false)
    setSaveNotice('题目已保存')
    window.setTimeout(() => setSaveNotice(''), 3000)
    if (onQuestionSaved) onQuestionSaved(saved)
    else onReload()
  }

  const stem = item.stemMarkdown || richBlocksPlainText(item.problemBlocks)
  const answer = item.answerText || richBlocksPlainText(item.answerBlocks)
  const analysis = item.analysisMarkdown || richBlocksPlainText(item.analysisBlocks)
  const chapter = item.chapter || item.knowledgePoints?.[0] || '未分类'
  const date = item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : ''

  const btnOutlineClass = "inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white h-7 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 cursor-pointer shadow-xs"
  const btnDangerClass = "inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50/20 h-7 px-2.5 text-xs font-medium text-red-700 hover:bg-red-50 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-950 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400 dark:hover:bg-red-950/30 cursor-pointer shadow-xs"

  return (
    <article
      className="group relative flex flex-col gap-3 rounded-lg border bg-white p-5 text-left transition-all duration-200 border-zinc-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:hover:border-zinc-700 dark:bg-zinc-950"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {[item.questionType || '未设题型', item.stage || '未设学段', chapter].map((tag) => (
              <span key={tag} className="inline-flex items-center rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {tag}
              </span>
            ))}
            <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold ${String(difficultyLabel10(item)).includes('难') ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>
              难度: {difficultyLabel10(item)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {saveNotice ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle className="size-3.5" />{saveNotice}</span> : null}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={btnOutlineClass}
          >
            <PencilLine className="size-3.5" />
            编辑
          </button>
          {showFigureAction ? (
            <button
              type="button"
              onClick={() => setCropOpen(true)}
              className={btnOutlineClass}
            >
              <Crop className="size-3.5" />
              框选题图
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onDelete(item.id)}
            className={btnDangerClass}
          >
            <Trash2 className="size-3.5" />
            删除
          </button>
          <span className="shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500 ml-1">
            #{item.serialNo ?? item.questionNo ?? item.id.slice(0, 6)}
          </span>
        </div>
      </div>

      <div className="select-text font-sans text-xs leading-relaxed text-zinc-900 dark:text-zinc-100">
        <QuestionMarkdownContent content={stem || '题干为空'} figures={item.figures} />
      </div>

      {item.knowledgePoints && item.knowledgePoints.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {item.knowledgePoints.map((kp) => (
            <span
              key={kp}
              className="inline-flex items-center rounded bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 border border-zinc-200/60 dark:bg-zinc-900/30 dark:text-zinc-400 dark:border-zinc-800/80"
            >
              {kp}
            </span>
          ))}
        </div>
      )}

      <div className={`grid transition-all duration-300 ease-in-out ${showAnalysis ? 'mt-2 grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="space-y-3 rounded border-t border-zinc-200 bg-zinc-50/50 p-3 pt-3 dark:border-zinc-800 dark:bg-zinc-900/30">
            <div>
              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">【答案】</span>
              <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                <MarkdownWithInlineFigures content={answer || '暂无答案'} figures={item.figures} />
              </div>
            </div>
            <div>
              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">【解析】</span>
              <div className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                <MarkdownWithInlineFigures content={analysis || '暂无解析'} figures={item.figures} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={`mt-1 flex items-center justify-between pt-3 ${showAnalysis ? '' : 'border-t border-zinc-200 dark:border-zinc-800'}`}>
        <div className="flex items-center gap-3 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
          {date ? <span className="flex items-center gap-1"><Calendar className="size-3 text-zinc-400" />{date}</span> : null}
          <span className="flex items-center gap-1"><BookOpen className="size-3 text-zinc-400" />{displaySource(item.sourceTitle || '') || '高中数学专项试卷'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setShowAnalysis((value) => !value)
            }}
            className={btnOutlineClass}
          >
            {showAnalysis ? <><ChevronUp className="size-3.5" />收起解析</> : <><ChevronDown className="size-3.5" />查看解析</>}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onAddToBasket(item.id)
            }}
            className={`inline-flex items-center gap-1.5 rounded-md h-7 px-3 text-xs font-medium transition-all ${
              isInBasket
                ? 'border border-zinc-200 bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100'
                : 'bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 cursor-pointer'
            }`}
          >
            {isInBasket ? <><Check className="size-3.5" />已在试题篮</> : <><ShoppingBag className="size-3.5" />加入试题篮</>}
          </button>
        </div>
      </div>

      {editing ? createPortal(<EditDialog draft={draft} setDraft={setDraft} onClose={() => setEditing(false)} onSave={saveEditedQuestion} onManageFigures={() => { setEditing(false); setCropOpen(true) }} />, document.body) : null}
      {cropOpen ? createPortal(<FigureCropDialog question={item} onClose={closeCropDialog} onDelete={deleteFigure} onSave={addFigure} onUpdate={updateFigure} />, document.body) : null}
    </article>
  )
}

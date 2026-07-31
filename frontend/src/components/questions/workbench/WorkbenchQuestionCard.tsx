import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, CheckCircle, ChevronDown, ChevronUp, Crop, PencilLine, ShoppingBag, Trash2 } from 'lucide-react'
import { questionBankApi } from '@/api/questionBank'
import { FigureCropDialog } from '@/components/questions/FigureDialogs'
import { EditDialog } from '@/components/questions/EditDialog'
import type { QuestionItem } from '@/types'
import {
  QuestionCardContextLabel,
  QuestionCardFooter,
  QuestionCardFrame,
  QuestionCardHeader,
  QuestionCardKnowledge,
  QuestionCardSolution,
  QuestionCardStem,
  questionCardCompletedButtonClass,
  questionCardDangerButtonClass,
  questionCardOutlineButtonClass,
  questionCardPrimaryButtonClass,
} from './QuestionCard'

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

  return (
    <QuestionCardFrame>
      <QuestionCardHeader
        item={item}
        leading={<QuestionCardContextLabel>导入审核</QuestionCardContextLabel>}
        actions={
          <>
            {saveNotice ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle className="size-3.5" />{saveNotice}</span> : null}
            <button type="button" onClick={() => setEditing(true)} className={questionCardOutlineButtonClass}>
              <PencilLine className="size-3.5" />编辑
            </button>
            {showFigureAction ? (
              <button type="button" onClick={() => setCropOpen(true)} className={questionCardOutlineButtonClass}>
                <Crop className="size-3.5" />框选题图
              </button>
            ) : null}
            <button type="button" onClick={() => onDelete(item.id)} className={questionCardDangerButtonClass}>
              <Trash2 className="size-3.5" />删除
            </button>
          </>
        }
      />
      <QuestionCardStem item={item} />
      <QuestionCardKnowledge item={item} />
      <QuestionCardSolution item={item} open={showAnalysis} />
      <QuestionCardFooter
        item={item}
        open={showAnalysis}
        actions={
          <>
            <button type="button" onClick={() => setShowAnalysis((value) => !value)} className={questionCardOutlineButtonClass}>
              {showAnalysis ? <><ChevronUp className="size-3.5" />收起解析</> : <><ChevronDown className="size-3.5" />查看解析</>}
            </button>
            <button type="button" onClick={() => onAddToBasket(item.id)} className={isInBasket ? questionCardCompletedButtonClass : questionCardPrimaryButtonClass}>
              {isInBasket ? <><Check className="size-3.5" />已在试题篮</> : <><ShoppingBag className="size-3.5" />加入试题篮</>}
            </button>
          </>
        }
      />

      {editing ? createPortal(<EditDialog draft={draft} setDraft={setDraft} onClose={() => setEditing(false)} onSave={saveEditedQuestion} onManageFigures={() => { setEditing(false); setCropOpen(true) }} />, document.body) : null}
      {cropOpen ? createPortal(<FigureCropDialog question={item} onClose={closeCropDialog} onDelete={deleteFigure} onSave={addFigure} onUpdate={updateFigure} />, document.body) : null}
    </QuestionCardFrame>
  )
}

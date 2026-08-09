import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, CheckCircle, ChevronDown, ChevronUp, PencilLine, ShoppingBag, Trash2 } from 'lucide-react'
import { questionBankApi } from '@/api/questionBank'
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
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Partial<QuestionItem>>(item)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [saveNotice, setSaveNotice] = useState('')
  const [figuresChanged, setFiguresChanged] = useState(false)

  useEffect(() => {
    setDraft(item)
  }, [item])

  useEffect(() => {
    if (expandAll !== undefined) setShowAnalysis(expandAll)
  }, [expandAll])

  async function saveEditedQuestion(nextDraft = draft) {
    const saved = await questionBankApi.updateItem(item.id, nextDraft, item.contentRevision)
    setDraft(saved)
    setFiguresChanged(false)
    setEditing(false)
    setSaveNotice('题目已保存')
    window.setTimeout(() => setSaveNotice(''), 3000)
    if (onQuestionSaved) onQuestionSaved(saved)
    else onReload()
  }

  function closeEditor() {
    setEditing(false)
    if (!figuresChanged) return
    setFiguresChanged(false)
    // Figure resources are written immediately, but the surrounding card
    // should remain stable while its editor is open. Refresh only after close.
    onReload()
  }

  return (
    <QuestionCardFrame>
      <QuestionCardHeader
        item={item}
        leading={<QuestionCardContextLabel>导入审核</QuestionCardContextLabel>}
        actions={
          <>
            {saveNotice ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle className="size-3.5" />{saveNotice}</span> : null}
            <button type="button" onClick={() => { setFiguresChanged(false); setEditing(true) }} className={questionCardOutlineButtonClass}>
              <PencilLine className="size-3.5" />编辑
            </button>
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

      {editing ? createPortal(<EditDialog draft={draft} setDraft={setDraft} onClose={closeEditor} onSave={saveEditedQuestion} onFiguresChanged={() => setFiguresChanged(true)} />, document.body) : null}
    </QuestionCardFrame>
  )
}

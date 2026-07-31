import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, CheckCircle, ChevronDown, ChevronUp, PencilLine, ShoppingBag } from 'lucide-react'
import { questionBankApi } from '@/api/questionBank'
import { EditDialog } from '@/components/questions/EditDialog'
import type { QuestionItem } from '@/types'
import {
  QuestionCardFooter,
  QuestionCardFrame,
  QuestionCardHeader,
  QuestionCardKnowledge,
  QuestionCardSolution,
  QuestionCardStem,
  questionCardCompletedButtonClass,
  questionCardOutlineButtonClass,
  questionCardPrimaryButtonClass,
} from './QuestionCard'

export function CustomCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
      className={`flex size-3.5 shrink-0 items-center justify-center rounded border transition-all duration-150 cursor-pointer ${
        checked || indeterminate
          ? 'bg-zinc-900 border-zinc-900 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-900'
          : 'border-zinc-300 hover:border-zinc-400 bg-white dark:border-zinc-700 dark:hover:border-zinc-700 dark:bg-zinc-900'
      }`}
    >
      {checked && <Check className="size-2.5 stroke-[3px]" />}
      {!checked && indeterminate && <div className="h-[2px] w-1.5 bg-current rounded-xs" />}
    </button>
  )
}

export function QuestionBankDraftCard({
  item,
  isInBasket,
  isSelected,
  onToggleBasket,
  onSelect,
  onClick,
  onQuestionSaved,
}: {
  item: QuestionItem
  isInBasket: boolean
  isSelected: boolean
  onToggleBasket: (id: string) => void
  onSelect: (id: string) => void
  onClick: () => void
  onQuestionSaved?: (item: QuestionItem) => void
}) {
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Partial<QuestionItem>>(item)
  const [saveNotice, setSaveNotice] = useState('')
  useEffect(() => {
    setDraft(item)
  }, [item])

  async function saveEditedQuestion(nextDraft = draft) {
    const saved = await questionBankApi.updateItem(item.id, nextDraft, item.contentRevision)
    setDraft(saved)
    setEditing(false)
    setSaveNotice('题目已保存')
    window.setTimeout(() => setSaveNotice(''), 3000)
    onQuestionSaved?.(saved)
  }

  return (
    <QuestionCardFrame
      onClick={onClick}
      selected={isSelected}
      className="cursor-pointer select-none"
    >
      <QuestionCardHeader
        item={item}
        leading={
          <div
            onClick={(event) => {
              event.stopPropagation()
              onSelect(item.id)
            }}
            className={`flex size-4 shrink-0 items-center justify-center rounded border transition-all ${
              isSelected
                ? 'border-zinc-900 bg-zinc-900 text-white ring-2 ring-zinc-950/10 dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 dark:ring-zinc-50/10'
                : 'border-zinc-300 bg-white group-hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900'
            }`}
          >
            {isSelected ? <Check className="size-3 stroke-[3]" /> : null}
          </div>
        }
        actions={
          <>
          {saveNotice ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle className="size-3.5" />{saveNotice}</span> : null}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setEditing(true)
            }}
            className={questionCardOutlineButtonClass}
          >
            <PencilLine className="size-3.5" />
            编辑
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
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setShowAnalysis((value) => !value)
            }}
            className={questionCardOutlineButtonClass}
          >
            {showAnalysis ? <><ChevronUp className="size-3.5" />收起解析</> : <><ChevronDown className="size-3.5" />查看解析</>}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              if (!isInBasket) onToggleBasket(item.id)
            }}
            className={isInBasket ? questionCardCompletedButtonClass : questionCardPrimaryButtonClass}
          >
            {isInBasket ? <><Check className="size-3.5" />已在试题篮</> : <><ShoppingBag className="size-3.5" />加入试题篮</>}
          </button>
          </>
        }
      />
      {editing ? createPortal(<EditDialog draft={draft} setDraft={setDraft} onClose={() => setEditing(false)} onSave={saveEditedQuestion} />, document.body) : null}
    </QuestionCardFrame>
  )
}

/**
 * 题目内容编辑弹窗（全屏 portal）
 * 复用 QuestionContentEditor；保存时进入"保存方式确认"步：
 * 回填到题库（PATCH updateItem，带 contentRevision 冲突处理）或仅保存在本文档（localContent 覆盖）
 */

import { useMemo, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Database, FileText, HelpCircle, Image, LoaderCircle } from 'lucide-react'
import type { QuestionItem } from '@/types'
import type { QuestionContentDraft } from '@/types/questionContent'
import type { QuestionBlock } from '@/types/teachingDocument'
import { questionBankApi } from '@/api/questionBank'
import { ApiError } from '@/api/client'
import { QuestionContentEditor, type QuestionEditorConflict } from '@/components/questions/editor/QuestionContentEditor'
import { QuestionFigureManager } from '@/components/questions/QuestionFigureManager'
import { contentEquals, type QuestionContentValue } from '@/components/questions/editor/model'

export function QuestionEditDialog(props: {
  block: QuestionBlock
  question: QuestionItem
  onClose: () => void
  /** 回填题库成功：页面刷新 questionMap 并清除该块 localContent */
  onWrittenBack: (item: QuestionItem) => void
  /** 仅保存在本文档：页面写入 localContent */
  onKeepLocal: (draft: QuestionContentDraft) => void
  /** 题图资源保存后同步当前文档的题目缓存 */
  onFiguresChanged?: (figures: QuestionItem['figures']) => void
}) {
  const { block, question } = props
  const initialValue = useMemo<QuestionContentValue>(() => ({
    stemMarkdown: block.localContent?.stemMarkdown ?? question.stemMarkdown ?? '',
    answerText: block.localContent?.answerText ?? question.answerText ?? '',
    analysisMarkdown: block.localContent?.analysisMarkdown ?? question.analysisMarkdown ?? '',
  }), []) // eslint-disable-line react-hooks/exhaustive-deps -- 仅取打开弹窗时的快照
  const [draft, setDraft] = useState<QuestionContentValue>(initialValue)
  const [step, setStep] = useState<'edit' | 'confirm' | 'discard'>('edit')
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<QuestionEditorConflict | null>(null)
  const [writeError, setWriteError] = useState('')
  const [editPanel, setEditPanel] = useState<'content' | 'figures'>('content')

  const dirty = !contentEquals(draft, initialValue)
  const dialogTitle = `编辑题目内容 · ${question.questionNo || block.questionId}`

  function requestClose() {
    if (dirty && step === 'edit') {
      setStep('discard')
      return
    }
    props.onClose()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      requestClose()
    }
  }

  async function writeBack() {
    setSaving(true)
    setWriteError('')
    try {
      const updated = await questionBankApi.updateItem(question.id, draft, question.contentRevision)
      props.onWrittenBack(updated)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const actual = error.payload?.actualContentRevision
        setConflict({
          message: '题库中的题目已被其他页面更新，可重试回填，或改存为本文档本地内容。',
          actualContentRevision: typeof actual === 'number' ? actual : undefined,
        })
        setStep('edit')
      } else {
        setWriteError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setSaving(false)
    }
  }

  function keepLocal() {
    props.onKeepLocal({
      stemMarkdown: draft.stemMarkdown,
      answerText: draft.answerText,
      analysisMarkdown: draft.analysisMarkdown,
    })
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={dialogTitle}
      className="question-edit-glass-backdrop fixed inset-0 z-[90] flex items-center justify-center p-4 md:p-8"
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose() }}
    >
      <div className="question-edit-glass-dialog flex h-full max-h-[56rem] w-full max-w-4xl flex-col overflow-hidden">
        {step === 'edit' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-2.5">
            <div role="tablist" aria-label="题目编辑面板" className="question-edit-glass-tabs inline-flex w-fit shrink-0 items-center gap-0.5">
              <button
                type="button"
                role="tab"
                aria-selected={editPanel === 'content'}
                onClick={() => setEditPanel('content')}
                className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 text-xs font-medium"
              >
                <FileText className="size-3.5" />内容编辑
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={editPanel === 'figures'}
                onClick={() => setEditPanel('figures')}
                className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 text-xs font-medium"
              >
                <Image className="size-3.5" />题图管理
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {editPanel === 'figures' ? (
                <QuestionFigureManager
                  question={question}
                  onFiguresChange={props.onFiguresChanged}
                  onClose={requestClose}
                  surface="glass"
                />
              ) : (
                <QuestionContentEditor
                  entityKey={`teaching-question-${block.id}`}
                  className="h-full min-h-0"
                  surface="glass"
                  title={dialogTitle}
                  description="内容以 Markdown 保存，公式与表格可视化编辑。保存时可选择回填题库或仅保留在本文档。"
                  value={draft}
                  savedValue={initialValue}
                  dirty={dirty}
                  onChange={setDraft}
                  onSave={() => { setConflict(null); setStep('confirm') }}
                  onCancel={requestClose}
                  contentRevision={question.contentRevision}
                  conflict={conflict}
                  saving={saving}
                />
              )}
            </div>
          </div>
        ) : step === 'confirm' ? (
          <div className="question-edit-glass-panel flex flex-1 items-center justify-center p-8">
            <div className="w-full max-w-md space-y-5">
              <div className="flex items-center gap-2">
                <HelpCircle className="size-5 text-zinc-500" />
                <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">选择保存方式</h3>
              </div>
              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                题目内容已修改。回填题库后，所有引用此题的文档同步更新；仅保存在本文档则只影响当前文档。
              </p>
              {writeError ? (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50/40 p-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400">{writeError}</p>
              ) : null}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => { void writeBack() }}
                  className="flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Database className="size-4" />}
                  {saving ? '回填中…' : '回填到题库'}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={keepLocal}
                  className="flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  <FileText className="size-4" />仅保存在本文档
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setStep('edit')}
                  className="h-9 rounded-md px-4 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                >
                  继续编辑
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="question-edit-glass-panel flex flex-1 items-center justify-center p-8">
            <div className="w-full max-w-sm space-y-5 text-center">
              <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">放弃未保存的修改？</h3>
              <p className="text-sm leading-6 text-zinc-500">关闭后，本次对题目内容的修改将不会保留。</p>
              <div className="flex justify-center gap-2">
                <button
                  type="button"
                  onClick={props.onClose}
                  className="h-9 rounded-md border border-red-200 bg-white px-4 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/50 dark:bg-zinc-950 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  放弃修改
                </button>
                <button
                  type="button"
                  onClick={() => setStep('edit')}
                  className="h-9 rounded-md bg-zinc-900 px-4 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  继续编辑
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

import { useState } from 'react'
import { AlertTriangle, ArrowUpFromLine, X } from 'lucide-react'
import { QuestionContentEditor, type QuestionEditorConflict } from './editor'
import { useQuestionEditorDraft } from '@/hooks/useQuestionEditorDraft'
import type { QuestionContentDraft } from '@/types/questionContent'
import type { QuestionItem } from '@/types'

type Props = {
  open: boolean
  draftId: string
  relationId: string
  item: QuestionItem
  originalItem?: QuestionItem
  hasOverride: boolean
  baseContentRevision: number
  onClose: () => void
  onSaveCurrent: (value: QuestionContentDraft) => Promise<void>
  onSyncToBank: (expectedContentRevision: number) => Promise<void>
}

const fields: Array<{ key: keyof QuestionContentDraft; label: string }> = [
  { key: 'stemMarkdown', label: '题干与选项' },
  { key: 'answerText', label: '答案' },
  { key: 'analysisMarkdown', label: '解析' },
]

export function LayoutQuestionContentSheet(props: Props) {
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [confirmingSync, setConfirmingSync] = useState(false)
  const [conflict, setConflict] = useState<QuestionEditorConflict | null>(null)
  const initialValue: QuestionContentDraft = {
    stemMarkdown: props.item.stemMarkdown || '',
    answerText: props.item.answerText || '',
    analysisMarkdown: props.item.analysisMarkdown || '',
  }
  const editor = useQuestionEditorDraft({
    entityType: 'layout-question',
    entityId: `${props.draftId}:${props.relationId}`,
    initialValue,
    contentRevision: props.baseContentRevision,
    enabled: props.open,
  })
  const differences = fields.filter(({ key }) => (props.originalItem?.[key] || '') !== editor.value[key])

  if (!props.open) return null

  async function saveCurrent(value: QuestionContentDraft) {
    setSaving(true)
    setConflict(null)
    try {
      await props.onSaveCurrent(value)
      editor.markSaved(value)
    } catch (error) {
      const payload = error && typeof error === 'object' && 'payload' in error
        ? (error as { payload?: Record<string, unknown> }).payload
        : undefined
      if (payload?.error === 'content_revision_conflict') {
        setConflict({
          message: String(payload.message || '题目内容已在其他页面更新。'),
          actualContentRevision: Number(payload.actualContentRevision) || undefined,
        })
      }
      throw error
    } finally {
      setSaving(false)
    }
  }

  async function syncToBank() {
    setSyncing(true)
    setConflict(null)
    try {
      await props.onSyncToBank(props.baseContentRevision)
      setConfirmingSync(false)
      editor.markSaved(editor.value)
    } catch (error) {
      const payload = error && typeof error === 'object' && 'payload' in error
        ? (error as { payload?: Record<string, unknown> }).payload
        : undefined
      if (payload?.error === 'content_revision_conflict') {
        setConflict({
          message: String(payload.message || '题库原题已被修改，请先处理差异。'),
          actualContentRevision: Number(payload.actualContentRevision) || undefined,
        })
      }
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/40" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !editor.dirty) props.onClose()
    }}>
      <section role="dialog" aria-modal="true" aria-label="编辑当前试卷题目" className="flex h-full w-full max-w-3xl flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">当前试卷内容</p>
            <p className="mt-0.5 text-xs text-zinc-500">默认只修改本排版草稿；PDF 会基于新 revision 重新生成。</p>
          </div>
          <button type="button" aria-label="关闭内容编辑" className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900" onClick={() => {
            if (!editor.dirty || window.confirm('仍有未保存内容，确定关闭吗？')) props.onClose()
          }}><X className="size-4" /></button>
        </div>

        {props.hasOverride ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50/40 px-5 py-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
            <AlertTriangle className="size-4" />
            <span className="min-w-0 flex-1">当前试卷含私有修改，题库原题尚未改变。</span>
            <button type="button" disabled={editor.dirty || saving || syncing} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 font-medium disabled:opacity-40 dark:border-amber-800 dark:bg-zinc-950" onClick={() => setConfirmingSync(true)}>
              <ArrowUpFromLine className="size-3.5" />同步题库原题
            </button>
          </div>
        ) : null}

        <QuestionContentEditor
          entityKey={`layout:${props.draftId}:${props.relationId}`}
          value={editor.value}
          savedValue={initialValue}
          onChange={editor.setValue}
          onSave={saveCurrent}
          onCancel={props.onClose}
          saving={saving}
          contentRevision={props.baseContentRevision}
          conflict={conflict}
          dirty={editor.dirty}
          title="编辑题干、答案与解析"
          description={editor.hasRecoveredDraft ? '已恢复上次未保存的本地内容。' : '支持结构化选项、表格和可视化公式。'}
          className="min-h-0 flex-1 rounded-none border-0 shadow-none"
        />
      </section>

      {confirmingSync ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
          <div role="alertdialog" aria-modal="true" aria-label="确认同步题库原题" className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            <div className="border-b border-zinc-100 p-5 dark:border-zinc-900">
              <h3 className="text-base font-semibold">同步题库原题</h3>
              <p className="mt-1 text-[13px] text-zinc-500">下列字段将写入正式题库。若原题已被其他页面修改，操作会被拒绝。</p>
            </div>
            <div className="space-y-2 p-5">
              {differences.length ? differences.map((field) => (
                <div key={field.key} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{field.label}</p>
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-zinc-500">{editor.value[field.key] || '（空）'}</p>
                </div>
              )) : <p className="text-xs text-zinc-500">当前内容与快照基线一致。</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-900">
              <button type="button" className="h-9 rounded-md border border-zinc-200 px-4 text-sm dark:border-zinc-800" onClick={() => setConfirmingSync(false)}>取消</button>
              <button type="button" disabled={syncing} className="h-9 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900" onClick={() => void syncToBank()}>{syncing ? '同步中…' : '确认同步'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

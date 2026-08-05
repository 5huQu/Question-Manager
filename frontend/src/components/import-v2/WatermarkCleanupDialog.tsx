import type { Dispatch, SetStateAction } from 'react'
import { Modal } from '@/components/dialogs/Modal'
import { Button } from '@/components/ui'

export type WatermarkCleanupDraft = {
  enabled: boolean
  terms: string
}

export function WatermarkCleanupDialog({
  draft,
  setDraft,
  saving,
  canReclean,
  onClose,
  onSave,
}: {
  draft: WatermarkCleanupDraft
  setDraft: Dispatch<SetStateAction<WatermarkCleanupDraft>>
  saving: boolean
  canReclean: boolean
  onClose: () => void
  onSave: () => void
}) {
  return (
    <Modal
      title="设置水印清洗"
      desc={canReclean ? '保存后会同步到本批次资料，并按新的排除词重新生成未入库候选题。' : '保存后会同步到本批次资料；已有入库题目不会被重新处理。'}
      onClose={onClose}
    >
      <div className="space-y-4 py-2">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/20">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700"
              checked={draft.enabled}
              onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
            />
            文档含有去水印背景词
          </label>
          {draft.enabled ? (
            <label className="mt-3 block space-y-1.5">
              <span className="text-[11px] font-medium text-zinc-500">水印排除词典</span>
              <textarea
                className="min-h-24 w-full resize-y rounded-md border border-zinc-200 bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                value={draft.terms}
                onChange={(event) => setDraft((current) => ({ ...current, terms: event.target.value }))}
                placeholder="每行输入一个去水印排除词，例如：鼎尖教育"
              />
              <span className="block text-[11px] leading-4 text-zinc-400">
                仅清除整行由排除词组成的水印文本，或从包含排除词的 OCR 行中移除对应词语。
              </span>
            </label>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-900">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={saving} onClick={onSave}>{saving ? '保存中...' : '保存并清洗'}</Button>
        </div>
      </div>
    </Modal>
  )
}

import type { Dispatch, SetStateAction } from 'react'
import { Modal } from '@/components/dialogs/Modal'
import { Button } from '@/components/ui'
import { ensureStageValue, gradeOptionsForTeachingStages } from '@/utils/stages'
import {
  gaokaoRegionOptions,
  isGaokaoRegion,
  paperKindOptions,
  subjectOptions,
  type PaperKind,
  type SourceMetadataDraft,
} from '@/pages/import-v2/importV2PageModel'

type Props = {
  draft: SourceMetadataDraft
  setDraft: Dispatch<SetStateAction<SourceMetadataDraft>>
  teachingStages?: string[]
  saving: boolean
  onClose: () => void
  onSave: () => void
}

export function ImportMetadataEditorDialog({ draft, setDraft, teachingStages, saving, onClose, onSave }: Props) {
  const configuredStageOptions = gradeOptionsForTeachingStages(teachingStages)
  const stageOptions = draft.stage && !configuredStageOptions.includes(draft.stage)
    ? [draft.stage, ...configuredStageOptions]
    : configuredStageOptions
  const selectedStage = ensureStageValue(draft.stage, stageOptions)
  const selectedSubject = draft.subject || '数学'
  const visibleSubjectOptions = subjectOptions.includes(selectedSubject)
    ? subjectOptions
    : [selectedSubject, ...subjectOptions]

  return (
    <Modal
      title="修改试卷批次属性"
      desc="修改此批次会将属性同步写入底下的所有关联文档以及所有的待确认题目记录中。"
      onClose={onClose}
    >
      <div className="space-y-4 py-2">
        <div className="space-y-4">
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-[13px] font-medium text-zinc-500">试卷名称</span>
              <input
                className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none transition-all focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800"
                value={draft.paperTitle}
                onChange={(event) => setDraft((current) => ({ ...current, paperTitle: event.target.value }))}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[13px] font-medium text-zinc-500">批次名称</span>
              <input
                className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none transition-all focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800"
                value={draft.batchName}
                onChange={(event) => setDraft((current) => ({ ...current, batchName: event.target.value }))}
              />
            </label>
          </div>

          <div className="rounded-xl border border-zinc-150 bg-zinc-50/50 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/20">
            <div className="mb-2.5 text-[11px] font-semibold uppercase text-zinc-400 dark:text-zinc-500">分类与年份信息</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1.5">
                <span className="text-[13px] font-medium text-zinc-500">学段/年级</span>
                <select
                  className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none transition-all focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800"
                  value={selectedStage}
                  onChange={(event) => setDraft((current) => ({ ...current, stage: event.target.value }))}
                >
                  {stageOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-[13px] font-medium text-zinc-500">学科</span>
                <select
                  className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none transition-all focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800"
                  value={selectedSubject}
                  onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))}
                >
                  {visibleSubjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-[13px] font-medium text-zinc-500">资料类型</span>
                <select
                  className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none transition-all focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800"
                  value={draft.paperKind}
                  onChange={(event) => setDraft((current) => {
                    const paperKind = event.target.value as PaperKind
                    return paperKind === 'gaokao_real'
                      ? { ...current, paperKind, province: isGaokaoRegion(current.province) ? current.province : '', city: '', sourceOrg: '' }
                      : { ...current, paperKind }
                  })}
                >
                  {paperKindOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-[13px] font-medium text-zinc-500">年份</span>
                <input
                  type="number"
                  min="0"
                  className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none transition-all focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800"
                  value={draft.examYear}
                  onChange={(event) => setDraft((current) => ({ ...current, examYear: event.target.value }))}
                />
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-150 bg-zinc-50/50 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/20">
            <div className="mb-2.5 text-[11px] font-semibold uppercase text-zinc-400 dark:text-zinc-500">归属与来源机构</div>
            {draft.paperKind === 'gaokao_real' ? (
              <label className="block space-y-1.5">
                <span className="text-[13px] font-medium text-zinc-500">试卷适用地区</span>
                <select
                  className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none transition-all focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800"
                  value={isGaokaoRegion(draft.province) ? draft.province : ''}
                  onChange={(event) => setDraft((current) => ({ ...current, province: event.target.value, city: '', sourceOrg: '' }))}
                >
                  <option value="">请选择全国卷或直辖市</option>
                  {gaokaoRegionOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1.5">
                    <span className="text-[13px] font-medium text-zinc-500">省份</span>
                    <input className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none transition-all focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800" value={draft.province} onChange={(event) => setDraft((current) => ({ ...current, province: event.target.value }))} />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-[13px] font-medium text-zinc-500">城市</span>
                    <input className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none transition-all focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800" value={draft.city} onChange={(event) => setDraft((current) => ({ ...current, city: event.target.value }))} />
                  </label>
                </div>
                <label className="block space-y-1.5">
                  <span className="text-[13px] font-medium text-zinc-500">来源机构</span>
                  <input className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none transition-all focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800" value={draft.sourceOrg} onChange={(event) => setDraft((current) => ({ ...current, sourceOrg: event.target.value }))} />
                </label>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-900">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={saving} onClick={onSave}>{saving ? '保存中...' : '保存修改'}</Button>
        </div>
      </div>
    </Modal>
  )
}

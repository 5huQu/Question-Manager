import { useEffect, useMemo, useState } from 'react'
import type { BoxAppearance, BoxBlock, BoxChildBlock, BoxPadding, TeachingBlock } from '@/types/teachingDocument'
import { BlockInlineEditor } from '@/components/teaching-document/BlockInlineEditor/BlockInlineEditor'
import { BUILTIN_BOX_TEMPLATES, hasProtectedInlineContent, protectedInlineReason } from '@/utils/teachingDocument'
import { CARD_CHILD_TYPES, USER_BLOCK_LABEL } from '../blockLabels'
import { ActionButton, Field, fieldClass, inlineContentOf } from './common'

export function BoxSettings(props: {
  block: BoxBlock
  onUpdate: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
  onInsertChild: (box: BoxBlock, type: BoxChildBlock['type']) => void
  onDeleteBoxChildren: (boxId: string, childIds: string[]) => boolean
  onMergeBoxParagraphs: (boxId: string, childIds: string[]) => boolean
  onSelect: (id: string) => void
}) {
  const [selectedChildIds, setSelectedChildIds] = useState<Set<string>>(() => new Set())
  const [rangeAnchorId, setRangeAnchorId] = useState<string | null>(null)

  useEffect(() => {
    setSelectedChildIds(new Set())
    setRangeAnchorId(null)
  }, [props.block.id])

  const selectedInOrder = useMemo(
    () => props.block.children.filter((child) => selectedChildIds.has(child.id)),
    [props.block.children, selectedChildIds],
  )
  const canMergeParagraphs = selectedInOrder.length >= 2
    && selectedInOrder.every((child) => child.type === 'paragraph')
    && selectedInOrder.every((child) => child.type === 'paragraph' && child.content.every((inline) => inline.type !== 'unknown' && (inline.type !== 'text' || (!inline.font && !inline.color && !inline.unknownMarks?.length))))
    && selectedInOrder.every((child, index) => index === 0 || props.block.children.indexOf(child) === props.block.children.indexOf(selectedInOrder[index - 1]) + 1)

  function toggleChild(childId: string, shiftKey: boolean) {
    const childIndex = props.block.children.findIndex((child) => child.id === childId)
    if (childIndex < 0) return
    setSelectedChildIds((current) => {
      const next = new Set(current)
      const anchorIndex = rangeAnchorId ? props.block.children.findIndex((child) => child.id === rangeAnchorId) : -1
      if (shiftKey && anchorIndex >= 0) {
        const from = Math.min(anchorIndex, childIndex)
        const to = Math.max(anchorIndex, childIndex)
        for (const child of props.block.children.slice(from, to + 1)) next.add(child.id)
      } else if (next.has(childId)) {
        next.delete(childId)
      } else {
        next.add(childId)
      }
      return next
    })
    setRangeAnchorId(childId)
  }

  const clearSelection = () => {
    setSelectedChildIds(new Set())
    setRangeAnchorId(null)
  }

  /**
   * 面板里的“卡片内容”列表：连续段落合并为一项“正文段落”，
   * 让卡片正文在面板里表现为一个连续文本对象（类 Word 段落体验），
   * 而非回车一次就多出一个独立对象；非文本子块仍逐项列出。
   */
  const childEntries = useMemo(() => {
    const entries: Array<{ key: string; label: string; ids: string[] }> = []
    let previousWasParagraph = false
    for (const child of props.block.children) {
      if (child.type === 'paragraph') {
        if (previousWasParagraph && entries.length) {
          const last = entries[entries.length - 1]
          last.ids.push(child.id)
          last.label = `正文段落 ×${last.ids.length}`
        } else {
          entries.push({ key: `paragraphs:${child.id}`, label: '正文段落', ids: [child.id] })
        }
        previousWasParagraph = true
      } else {
        entries.push({ key: child.id, label: USER_BLOCK_LABEL[child.type], ids: [child.id] })
        previousWasParagraph = false
      }
    }
    return entries
  }, [props.block.children])

  function toggleEntry(entry: { ids: string[] }, shiftKey: boolean) {
    if (entry.ids.length === 1) {
      toggleChild(entry.ids[0], shiftKey)
      return
    }
    // 段落组整组切换；组内无对象级差异，不参与 Shift 范围选择。
    setSelectedChildIds((current) => {
      const next = new Set(current)
      const allSelected = entry.ids.every((id) => next.has(id))
      if (allSelected) for (const id of entry.ids) next.delete(id)
      else for (const id of entry.ids) next.add(id)
      return next
    })
    setRangeAnchorId(entry.ids[0])
  }

  return (
    <div className="space-y-3">
      <Field label="卡片模板">
        <select className={fieldClass} value={props.block.templateId} onChange={(event) => props.onUpdate({ templateId: event.target.value })}>
          {BUILTIN_BOX_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
        </select>
      </Field>
      <Field label="卡片标题">
        <input className={fieldClass} value={props.block.title || ''} onChange={(event) => props.onUpdate({ title: event.target.value }, `box-title:${props.block.id}`)} />
      </Field>
      <div className="border-t border-zinc-100 pt-3 dark:border-zinc-900">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-zinc-500">卡片内容</p>
          {props.block.children.length ? (
            <button type="button" onClick={() => selectedChildIds.size === props.block.children.length ? clearSelection() : setSelectedChildIds(new Set(props.block.children.map((child) => child.id)))} className="text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
              {selectedChildIds.size === props.block.children.length ? '取消全选' : '全选'}
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-[11px] leading-4 text-zinc-400">正文在画布中直接编辑，回车续段、Shift+回车换行；勾选内容后可批量删除。</p>
        <div className="mt-2 space-y-1">
          {childEntries.map((entry, entryIndex) => {
            const checked = entry.ids.every((id) => selectedChildIds.has(id))
            return (
              <div key={entry.key} className={`flex items-center gap-1 rounded-md border px-1.5 py-1 transition-colors ${checked ? 'border-sky-300 bg-sky-50/60 dark:border-sky-800 dark:bg-sky-950/20' : 'border-zinc-200 dark:border-zinc-800'}`}>
                <input
                  type="checkbox"
                  aria-label={`选择第 ${entryIndex + 1} 项${entry.label}`}
                  checked={checked}
                  readOnly
                  onClick={(event) => {
                    event.preventDefault()
                    toggleEntry(entry, event.shiftKey)
                  }}
                  className="size-3.5 accent-sky-600"
                />
                <button type="button" onClick={() => props.onSelect(entry.ids[0])} className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100">
                  <span className="text-[10px] tabular-nums text-zinc-400">{entryIndex + 1}</span>
                  <span className="truncate">{entry.label}</span>
                </button>
              </div>
            )
          })}
        </div>
        {selectedChildIds.size ? (
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={() => { if (props.onDeleteBoxChildren(props.block.id, selectedInOrder.map((child) => child.id))) clearSelection() }} className="h-8 rounded-md border border-red-200 px-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/30">
              删除 {selectedChildIds.size} 项
            </button>
            {canMergeParagraphs ? (
              <button type="button" onClick={() => { if (props.onMergeBoxParagraphs(props.block.id, selectedInOrder.map((child) => child.id))) clearSelection() }} className="h-8 rounded-md border border-zinc-200 px-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900">
                合并为混合内容
              </button>
            ) : null}
          </div>
        ) : null}
        <select
          className={`${fieldClass} mt-2`}
          defaultValue=""
          onChange={(event) => { if (event.target.value) props.onInsertChild(props.block, event.target.value as BoxChildBlock['type']); event.target.value = '' }}
        >
          <option value="">添加内容…</option>
          {CARD_CHILD_TYPES.map((type) => <option key={type} value={type}>{USER_BLOCK_LABEL[type]}</option>)}
        </select>
      </div>
    </div>
  )
}

const PADDING_SIDES = [
  ['top', '上'], ['right', '右'], ['bottom', '下'], ['left', '左'],
] as const

/** 只暴露持久化契约允许的卡片外观 token。 */
export function BoxAppearanceSettings(props: {
  block: BoxBlock
  onUpdate: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
}) {
  const [linkedPadding, setLinkedPadding] = useState(true)
  const appearance = props.block.appearance || {}
  const updateAppearance = (patch: Partial<BoxAppearance>) => {
    props.onUpdate({ appearance: { ...appearance, ...patch } }, `box-appearance:${props.block.id}`)
  }
  const updatePadding = (side: typeof PADDING_SIDES[number][0], value: BoxPadding) => {
    const padding = linkedPadding
      ? { top: value, right: value, bottom: value, left: value }
      : { ...appearance.padding, [side]: value }
    updateAppearance({ padding })
  }
  return (
    <div className="space-y-3">
      <Field label="卡片底色">
        <select className={fieldClass} value={appearance.background || 'template'} onChange={(event) => updateAppearance({ background: event.target.value as NonNullable<BoxAppearance['background']> })}>
          <option value="template">跟随模板</option><option value="white">白色</option><option value="blue">浅蓝</option><option value="gray">浅灰</option><option value="amber">浅黄</option><option value="green">浅绿</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="边框">
          <select className={fieldClass} value={appearance.borderWidth ?? 1} onChange={(event) => updateAppearance({ borderWidth: Number(event.target.value) as NonNullable<BoxAppearance['borderWidth']> })}>
            <option value={0}>无边框</option><option value={1}>1 px</option><option value={2}>2 px</option>
          </select>
        </Field>
        <Field label="边框颜色">
          <select className={fieldClass} value={appearance.borderColor || 'template'} onChange={(event) => updateAppearance({ borderColor: event.target.value as NonNullable<BoxAppearance['borderColor']> })}>
            <option value="template">跟随模板</option><option value="zinc">灰色</option><option value="blue">浅蓝</option><option value="amber">浅黄</option><option value="green">浅绿</option>
          </select>
        </Field>
      </div>
      <Field label="圆角">
        <div className="mt-1 grid grid-cols-4 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
          {[0, 4, 8, 12].map((radius) => <button key={radius} type="button" onClick={() => updateAppearance({ cornerRadius: radius as NonNullable<BoxAppearance['cornerRadius']> })} className={`h-8 border-r border-zinc-200 text-[11px] last:border-r-0 dark:border-zinc-800 ${appearance.cornerRadius === radius ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900'}`}>{radius}px</button>)}
        </div>
      </Field>
      <div className="border-t border-zinc-100 pt-3 dark:border-zinc-900">
        <div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-medium text-zinc-500">内距</span><button type="button" aria-pressed={linkedPadding} onClick={() => setLinkedPadding((value) => !value)} className={`rounded px-1.5 py-1 text-[11px] ${linkedPadding ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>联动</button></div>
        <div className="grid grid-cols-2 gap-2">
          {PADDING_SIDES.map(([side, label]) => <label key={side} className="text-[11px] text-zinc-500">{label}<select className={fieldClass} value={appearance.padding?.[side] ?? (side === 'right' || side === 'left' ? 16 : 12)} onChange={(event) => updatePadding(side, Number(event.target.value) as BoxPadding)}>{[8, 12, 16, 20, 24].map((size) => <option key={size} value={size}>{size}px</option>)}</select></label>)}
        </div>
      </div>
    </div>
  )
}

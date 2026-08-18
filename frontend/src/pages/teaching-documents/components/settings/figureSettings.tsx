import { useState } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from 'lucide-react'
import type { TeachingBlock } from '@/types/teachingDocument'
import { InspectorSlider } from '@/components/ui/InspectorSlider'
import { Field, fieldClass } from './common'

export function FigureSettings(props: {
  onUpdate: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
  onUpload: (file: File) => Promise<{ id: string }>
  block: Extract<TeachingBlock, { type: 'figure' }>
}) {
  const { block } = props
  const [uploading, setUploading] = useState(false)
  const groupItems = block.groupItems || []
  const grouped = groupItems.length > 0
  const textWrap = block.textWrap || 'top-bottom'
  const updateGroupItems = (items: typeof groupItems, mergeKey?: string) => props.onUpdate({ groupItems: items }, mergeKey)

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-[13px] font-medium text-zinc-500">{grouped ? '图片组' : '图片'}</p>
        <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-zinc-200 px-3 text-xs text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900">
          <ImagePlus className="size-4" />
          {uploading ? '上传中…' : grouped ? '添加图片' : '替换图片'}
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
            className="hidden"
            disabled={uploading}
            onChange={async (event) => {
              const files = Array.from(event.target.files || [])
              if (!files.length) return
              setUploading(true)
              try {
                const assets = await Promise.all(files.map((file) => props.onUpload(file)))
                if (grouped) {
                  updateGroupItems([
                    ...groupItems,
                    ...assets.map((asset, index) => ({
                      id: `figure-item-${Date.now().toString(36)}-${index}`,
                      asset: { type: 'documentAsset' as const, assetId: asset.id },
                    })),
                  ])
                } else if (assets.length === 1) {
                  props.onUpdate({ asset: { type: 'documentAsset', assetId: assets[0].id } })
                } else {
                  props.onUpdate({
                    asset: { type: 'documentAsset', assetId: assets[0].id },
                    groupItems: assets.map((asset, index) => ({
                      id: `figure-item-${Date.now().toString(36)}-${index}`,
                      asset: { type: 'documentAsset' as const, assetId: asset.id },
                    })),
                    groupColumns: Math.min(3, assets.length) as 2 | 3,
                    groupGapMm: 4,
                    widthMm: Math.max(140, block.widthMm || 80),
                    caption: undefined,
                  })
                }
              } finally {
                setUploading(false)
                event.target.value = ''
              }
            }}
          />
        </label>
        {!grouped ? (
          <button
            type="button"
            onClick={() => props.onUpdate({
              groupItems: [{
                id: `figure-item-${Date.now().toString(36)}`,
                asset: block.asset,
                ...(block.caption ? { caption: block.caption } : {}),
              }],
              groupColumns: 2,
              groupGapMm: 4,
              caption: undefined,
              widthMm: Math.max(120, block.widthMm || 80),
            })}
            className="ml-2 inline-flex h-9 items-center rounded-md border border-zinc-200 px-3 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            组合多图
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              const first = groupItems[0]
              props.onUpdate({
                asset: first?.asset || block.asset,
                caption: first?.caption,
                groupItems: undefined,
                groupColumns: undefined,
                groupGapMm: undefined,
              })
            }}
            className="ml-2 inline-flex h-9 items-center rounded-md border border-zinc-200 px-3 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            转为单图
          </button>
        )}
      </div>
      {grouped ? (
        <>
          <Field label="每行图片">
            <div className="mt-1 grid grid-cols-3 gap-1 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-900">
              {([1, 2, 3] as const).map((columns) => (
                <button key={columns} type="button" onClick={() => props.onUpdate({ groupColumns: columns })} className={`h-8 rounded text-xs ${block.groupColumns === columns ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50' : 'text-zinc-500'}`}>{columns} 列</button>
              ))}
            </div>
          </Field>
          <InspectorSlider
            label="图片间距"
            value={block.groupGapMm ?? 4}
            min={0}
            max={12}
            step={1}
            unit="mm"
            onChange={(val) => props.onUpdate({ groupGapMm: val }, `figure-group-gap:${block.id}`)}
          />
          <div className="space-y-2 pt-1">
            {groupItems.map((item, index) => (
              <div key={item.id} className="space-y-1.5 border-b border-zinc-200/60 pb-3 dark:border-zinc-800/60 last:border-b-0">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-zinc-500">图片 {index + 1}</span>
                  <div className="flex items-center gap-0.5">
                    <button type="button" title="上移" aria-label={`图片 ${index + 1} 上移`} disabled={index === 0} onClick={() => {
                      const next = [...groupItems]
                      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                      updateGroupItems(next)
                    }} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"><ArrowUp className="size-3.5" /></button>
                    <button type="button" title="下移" aria-label={`图片 ${index + 1} 下移`} disabled={index === groupItems.length - 1} onClick={() => {
                      const next = [...groupItems]
                      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
                      updateGroupItems(next)
                    }} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"><ArrowDown className="size-3.5" /></button>
                    <button type="button" title="删除" aria-label={`删除图片 ${index + 1}`} onClick={() => updateGroupItems(groupItems.filter((entry) => entry.id !== item.id))} className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
                <input className={fieldClass} placeholder="图片下方说明" value={item.caption || ''} onChange={(event) => updateGroupItems(groupItems.map((entry) => entry.id === item.id ? { ...entry, caption: event.target.value } : entry), `figure-group-caption:${block.id}:${item.id}`)} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <Field label="图注">
          <input className={fieldClass} value={block.caption || ''} onChange={(event) => props.onUpdate({ caption: event.target.value }, `figure-caption:${block.id}`)} />
        </Field>
      )}
      <Field label="对齐">
        <select className={fieldClass} value={block.alignment} onChange={(event) => {
          // 布局以 layoutPreset 优先；改对齐必须同时清除 preset，否则不生效。
          props.onUpdate({ alignment: event.target.value as 'left' | 'center' | 'right', layoutPreset: undefined })
        }}>
          <option value="left">左对齐</option>
          <option value="center">居中</option>
          <option value="right">右对齐</option>
        </select>
      </Field>
      <Field label="文字环绕">
        <select
          className={fieldClass}
          value={textWrap}
          onChange={(event) => props.onUpdate({
            textWrap: event.target.value as 'top-bottom' | 'square-left' | 'square-right',
            wrapGapMm: event.target.value === 'top-bottom' ? undefined : (block.wrapGapMm ?? 4),
          })}
        >
          <option value="top-bottom">上下型（独占一行）</option>
          <option value="square-left">左侧图片，右侧文字环绕</option>
          <option value="square-right">右侧图片，左侧文字环绕</option>
        </select>
      </Field>
      {textWrap !== 'top-bottom' ? (
        <InspectorSlider
          label="文字间距"
          value={block.wrapGapMm ?? 4}
          min={0}
          max={12}
          step={1}
          unit="mm"
          presets={[0, 2, 4, 6]}
          onChange={(val) => props.onUpdate({ wrapGapMm: val }, `figure-wrap-gap:${block.id}`)}
        />
      ) : null}
      <InspectorSlider
        label="图片宽度"
        value={block.widthMm || 80}
        min={10}
        max={400}
        step={1}
        unit="mm"
        presets={[60, 80, 120, 160]}
        onChange={(val) => props.onUpdate({ widthMm: val, widthRatio: undefined })}
      />
    </div>
  )
}

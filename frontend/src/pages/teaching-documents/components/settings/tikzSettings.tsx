import { useState } from 'react'
import type { TeachingBlock, TikzBlock } from '@/types/teachingDocument'
import { FIGURE_LAYOUT_PRESETS, resolveFigureLayout } from '@/utils/teachingDocument/figureLayoutPresets'
import { TikzEditorDialog } from '../TikzEditorDialog'
import { Field, fieldClass } from './common'

export function TikzSettings({ block, onUpdate, onRender }: { block: TikzBlock; onUpdate: (patch: Partial<TeachingBlock>, mergeKey?: string) => void; onRender: (source: string) => Promise<{ asset: { id: string; url: string }; sourceHash: string; cached: boolean }> }) {
  const [editorOpen, setEditorOpen] = useState(false)
  const stale = !block.svgAssetId || !block.sourceHash
  return <div className="space-y-3">
    <div className={`rounded-md px-2.5 py-2 text-xs ${stale ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'}`}>{stale ? '预览已过期：编辑源码后点击生成预览。' : '当前 SVG 预览与源码一致。'}</div>
    <button type="button" onClick={() => setEditorOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">编辑 TikZ 绘图</button>
    <Field label="排版方式">
      <select className={fieldClass} value={block.layoutPreset || 'block-center'} onChange={(event) => {
        const layoutPreset = event.target.value as TikzBlock['layoutPreset']
        const layout = resolveFigureLayout({ preset: layoutPreset, legacyAlignment: block.alignment, containerWidthMm: 160 })
        onUpdate({ layoutPreset, alignment: layout.alignment, widthMm: layout.widthMm }, `tikz-layout:${block.id}`)
      }}>
        {FIGURE_LAYOUT_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
      </select>
    </Field>
    <Field label="对齐">
      <select className={fieldClass} value={block.alignment} onChange={(event) => {
        // 布局以 layoutPreset 优先；改对齐必须同时清除 preset，否则不生效。
        onUpdate({ alignment: event.target.value as TikzBlock['alignment'], layoutPreset: undefined }, `tikz-alignment:${block.id}`)
      }}>
        <option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option>
      </select>
    </Field>
    <Field label="图注"><input className={fieldClass} value={block.caption || ''} onChange={(event) => onUpdate({ caption: event.target.value }, `tikz-caption:${block.id}`)} /></Field>
    <Field label={`宽度 ${block.widthMm || 80} mm`}><input type="range" min={20} max={240} step={1} className="mt-2 w-full" value={block.widthMm || 80} onChange={(event) => onUpdate({ widthMm: Number(event.target.value) }, `tikz-width:${block.id}`)} /></Field>
    {editorOpen ? <TikzEditorDialog source={block.source} svgAssetId={block.svgAssetId} sourceHash={block.sourceHash} onRender={onRender} onApply={(value) => onUpdate(value, `tikz-edit:${block.id}`)} onClose={() => setEditorOpen(false)} /> : null}
  </div>
}

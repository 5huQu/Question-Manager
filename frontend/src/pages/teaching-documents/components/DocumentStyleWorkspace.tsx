import { useMemo, useState } from 'react'
import { Check, Layers3 } from 'lucide-react'
import type { FigureAssetRef, TeachingBlock, TeachingDocumentV1, TeachingSkinPresetRef } from '@/types/teachingDocument'
import { A4PaginationPreview } from '@/components/teaching-document/A4PaginationPreview'
import { TeachingDocumentRenderer } from '@/components/teaching-document/TeachingDocumentRenderer'
import type { FigureResolution, QuestionResolution } from '@/components/teaching-document/blocks/BlockRenderer'
import {
  resolveBoxSkin,
  resolveHeadingSkin,
  resolveTeachingDocumentSkinPresetContext,
  teachingSkinPresetRegistry,
  teachingSkinRegistry,
} from '@/utils/teachingDocument/skins'

type PreviewMode = 'continuous' | 'a4'

type StyleMapping = {
  skinId: string
  skinLabel: string
  variantId: string
  variantLabel: string
  affectedCount: number
}

type LocalOverride = {
  blockId: string
  blockLabel: string
  skinLabel: string
  variantId: string
  variantLabel?: string
}

function inlineText(block: Extract<TeachingBlock, { type: 'heading' }>) {
  return block.content.map((item) => item.type === 'text' ? item.text : item.type === 'inlineMath' ? item.latex : '').join('').trim()
}

function visitSkinBlocks(blocks: readonly TeachingBlock[], visit: (block: Extract<TeachingBlock, { type: 'heading' | 'box' }>) => void) {
  for (const block of blocks) {
    if (block.type === 'heading' || block.type === 'box') visit(block)
    if (block.type === 'box') visitSkinBlocks(block.children as TeachingBlock[], visit)
  }
}

function countPresetBlocks(document: TeachingDocumentV1, skinId: string): number {
  let count = 0
  visitSkinBlocks(document.content, (block) => {
    if (block.skin?.id !== skinId || block.skin.variant !== undefined) return
    const resolution = block.type === 'heading'
      ? resolveHeadingSkin(block.skin, block.level)
      : resolveBoxSkin(block.skin, block.templateId)
    if (resolution.status === 'resolved') count += 1
  })
  return count
}

export function teachingDocumentStyleMappings(document: TeachingDocumentV1): StyleMapping[] {
  const preset = resolveTeachingDocumentSkinPresetContext(document.design?.preset)
  if (preset.status !== 'resolved') return []
  return Object.entries(preset.bindings).map(([skinId, variantId]) => {
    const skin = teachingSkinRegistry.get(skinId)
    const variant = skin?.design?.variants?.find((item) => item.id === variantId)
    return {
      skinId,
      skinLabel: skin?.label || skinId,
      variantId,
      variantLabel: variant?.label || variantId,
      affectedCount: countPresetBlocks(document, skinId),
    }
  })
}

export function teachingDocumentLocalOverrides(document: TeachingDocumentV1): LocalOverride[] {
  const overrides: LocalOverride[] = []
  visitSkinBlocks(document.content, (block) => {
    const variantId = block.skin?.variant
    if (variantId === undefined || !block.skin) return
    const skin = teachingSkinRegistry.get(block.skin.id)
    overrides.push({
      blockId: block.id,
      blockLabel: block.type === 'heading' ? inlineText(block) || '未命名标题' : block.title || '未命名信息框',
      skinLabel: skin?.label || block.skin.id,
      variantId,
      variantLabel: skin?.design?.variants?.find((item) => item.id === variantId)?.label,
    })
  })
  return overrides
}

/** Persists only the exact Preset ref; clearing removes design entirely instead of writing design: {}. */
export function withTeachingDocumentPreset(document: TeachingDocumentV1, preset?: TeachingSkinPresetRef): TeachingDocumentV1 {
  const { design: _design, ...withoutDesign } = document
  return preset
    ? { ...withoutDesign, design: { preset: { id: preset.id, version: preset.version } } }
    : withoutDesign
}

function PresetCard({
  label,
  description,
  version,
  selected,
  unavailable,
  onClick,
}: {
  label: string
  description: string
  version?: number
  selected: boolean
  unavailable?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 ${selected
        ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900/60'
        : unavailable
          ? 'border-amber-300 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/10'
          : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50'}`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0"><span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">{label}</span><span className="mt-0.5 block text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">{description}</span></span>
        {selected ? <span className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"><Check className="size-3" />当前</span> : null}
      </span>
      {version ? <span className="mt-2 block font-mono text-[10px] text-zinc-400">v{version}</span> : null}
    </button>
  )
}

export function DocumentStyleWorkspace({
  document,
  onDocumentChange,
  resolveQuestion,
  resolveFigure,
}: {
  document: TeachingDocumentV1
  onDocumentChange: (document: TeachingDocumentV1) => void
  resolveQuestion?: (questionId: string) => QuestionResolution
  resolveFigure?: (asset: FigureAssetRef) => FigureResolution
}) {
  const [previewMode, setPreviewMode] = useState<PreviewMode>('continuous')
  const presetContext = useMemo(() => resolveTeachingDocumentSkinPresetContext(document.design?.preset), [document.design?.preset?.id, document.design?.preset?.version])
  const presets = teachingSkinPresetRegistry.list()
  const mappings = useMemo(() => teachingDocumentStyleMappings(document), [document])
  const overrides = useMemo(() => teachingDocumentLocalOverrides(document), [document])
  const currentRef = document.design?.preset
  const presetHasEffect = mappings.some((mapping) => mapping.affectedCount > 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <aside className="w-full shrink-0 overflow-y-auto border-b border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-950 lg:w-[22rem] lg:border-b-0 lg:border-r">
        <section>
          <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">整体样式</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">选择一个已注册的文档样式组合。它只影响已使用对应皮肤的标题和信息框。</p>
          <div className="mt-3 space-y-2">
            {currentRef && presetContext.status === 'unavailable' ? (
              <PresetCard
                label="当前样式不可用"
                description={`${currentRef.id} · v${currentRef.version}。当前环境未提供此样式，文档会使用安全回退；选择其他样式后才会替换此引用。`}
                selected
                unavailable
                onClick={() => undefined}
              />
            ) : null}
            <PresetCard label="默认" description="不使用文档样式组合，按各元素自身的基础样式显示。" selected={!currentRef} onClick={() => { if (currentRef) onDocumentChange(withTeachingDocumentPreset(document)) }} />
            {presets.map((preset) => (
              <PresetCard
                key={`${preset.id}:${preset.version}`}
                label={preset.label}
                description={preset.description || '已注册的标题与信息框样式组合。'}
                version={preset.version}
                selected={currentRef?.id === preset.id && currentRef.version === preset.version}
                onClick={() => { if (currentRef?.id !== preset.id || currentRef.version !== preset.version) onDocumentChange(withTeachingDocumentPreset(document, { id: preset.id, version: preset.version })) }}
              />
            ))}
            {!presets.length ? <p className="rounded-lg border border-dashed border-zinc-200 p-3 text-xs text-zinc-500 dark:border-zinc-800">当前没有可选的文档样式。</p> : null}
          </div>
        </section>

        <section className="mt-5 border-t border-zinc-200 pt-5 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">当前组合</h2>
          {mappings.length ? <div className="mt-3 space-y-2">{mappings.map((mapping) => (
            <div key={mapping.skinId} className="rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-950">
              <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200">{mapping.skinLabel}</p>
              <p className="mt-1 text-xs text-zinc-500">→ {mapping.variantLabel}</p>
              <p className="mt-1 text-[11px] text-zinc-400">当前文档中作用于 {mapping.affectedCount} 个块</p>
            </div>
          ))}</div> : <p className="mt-2 text-xs text-zinc-500">当前使用默认样式，或已保存的样式不可用。</p>}
          {mappings.length && !presetHasEffect ? <p className="mt-3 rounded-md bg-zinc-100 px-2.5 py-2 text-[11px] leading-4 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">当前文档还没有使用此样式组合所覆盖的标题或信息框。</p> : null}
        </section>

        <section className="mt-5 border-t border-zinc-200 pt-5 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">局部覆盖</h2>
          {overrides.length ? <div className="mt-3 space-y-2">{overrides.map((item) => <div key={item.blockId} className="rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-950"><p className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">{item.blockLabel}</p><p className="mt-1 text-[11px] text-zinc-500">{item.skinLabel} → {item.variantLabel || item.variantId}</p><span className="mt-1.5 inline-flex rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">局部覆盖</span></div>)}</div> : <p className="mt-2 text-xs text-zinc-500">暂无局部覆盖。</p>}
        </section>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-zinc-100/60 dark:bg-zinc-900/20">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950">
          <span className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100"><Layers3 className="size-4" />实时预览</span>
          <div role="group" aria-label="预览模式" className="flex items-center rounded-lg border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-800 dark:bg-zinc-900">
            {([['continuous', '连续预览'], ['a4', 'A4 预览']] as const).map(([mode, label]) => <button key={mode} type="button" aria-pressed={previewMode === mode} onClick={() => setPreviewMode(mode)} className={`h-7 rounded-md px-2.5 text-xs font-medium ${previewMode === mode ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'}`}>{label}</button>)}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
          {previewMode === 'continuous' ? <div className="mx-auto max-w-4xl rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"><TeachingDocumentRenderer document={document} resolveQuestion={resolveQuestion} resolveFigure={resolveFigure} /></div> : <A4PaginationPreview document={document} resolveQuestion={resolveQuestion} resolveFigure={resolveFigure} active />}
        </div>
      </section>
    </div>
  )
}

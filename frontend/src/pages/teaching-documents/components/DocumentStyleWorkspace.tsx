import { useMemo, useState, type ReactNode } from 'react'
import { Check, Layers3 } from 'lucide-react'
import type { FigureAssetRef, TeachingBlock, TeachingDocumentV1, TeachingSkinPresetRef } from '@/types/teachingDocument'
import { A4PaginationPreview } from '@/components/teaching-document/A4PaginationPreview'
import { TeachingDocumentRenderer } from '@/components/teaching-document/TeachingDocumentRenderer'
import type { FigureResolution, QuestionResolution } from '@/components/teaching-document/blocks/BlockRenderer'
import { MiniBoxPreview, MiniHeadingPreview, MiniPlainBox, MiniPlainHeading, TeachingGlobalSkinPicker } from './TeachingSkinSelector'
import {
  resolveBoxSkin,
  resolveHeadingSkin,
  resolveTeachingDocumentSkinPresetContext,
  resolveTeachingSkinVariantSelection,
  type TeachingSkinPresetDefinition,
  teachingSkinPresetRegistry,
  teachingSkinRegistry,
} from '@/utils/teachingDocument/skins'

type PreviewMode = 'continuous' | 'a4'
export type DocumentSkinApplyMode = 'preserve' | 'replace'

export type DocumentSkinAssignments = {
  heading?: TeachingSkinPresetRef
  box?: TeachingSkinPresetRef
}

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

type DocumentSkinUsage = {
  skinId: string
  skinVersion?: number
  skinLabel: string
  blockLabel: '标题' | '知识卡片'
  variantId?: string
  variantLabel?: string
  source: 'base' | 'preset' | 'explicit'
  unavailable?: 'missing' | 'incompatible'
  count: number
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

/**
 * Presentation-only summary of Skin identities already attached to document blocks.
 * This intentionally uses the shared resolver so the Style page never recreates
 * Preset/explicit/Base precedence.
 */
export function teachingDocumentSkinUsages(document: TeachingDocumentV1): DocumentSkinUsage[] {
  const preset = resolveTeachingDocumentSkinPresetContext(document.design?.preset)
  const usages = new Map<string, DocumentSkinUsage>()
  visitSkinBlocks(document.content, (block) => {
    if (!block.skin) return
    const resolution = block.type === 'heading'
      ? resolveHeadingSkin(block.skin, block.level)
      : resolveBoxSkin(block.skin, block.templateId)
    const selection = resolveTeachingSkinVariantSelection(block.skin, block.skin.id, undefined, preset.bindings)
    const source = selection.source === 'explicit' || selection.source === 'preset' ? selection.source : 'base'
    const definition = resolution.status === 'resolved' ? resolution.definition : undefined
    const unavailable = resolution.status === 'missing' || resolution.status === 'incompatible' ? resolution.status : undefined
    const variantLabel = selection.requestedVariantId
      ? definition?.design?.variants?.find((variant) => variant.id === selection.requestedVariantId)?.label
      : undefined
    const key = [
      block.type,
      block.skin.id,
      block.skin.version || '',
      selection.requestedVariantId || '',
      source,
      unavailable || '',
    ].join(':')
    const existing = usages.get(key)
    if (existing) {
      existing.count += 1
      return
    }
    usages.set(key, {
      skinId: block.skin.id,
      skinVersion: block.skin.version,
      skinLabel: definition?.label || block.skin.id,
      blockLabel: block.type === 'heading' ? '标题' : '知识卡片',
      variantId: selection.requestedVariantId,
      variantLabel,
      source,
      unavailable,
      count: 1,
    })
  })
  return [...usages.values()]
}

function skinUsageSourceLabel(usage: DocumentSkinUsage, presetLabel?: string) {
  if (usage.source === 'explicit') return '局部覆盖'
  if (usage.source === 'preset') return presetLabel || '当前整体样式'
  return '基础样式'
}

function usageVariantText(usage: DocumentSkinUsage) {
  return usage.variantLabel || (usage.variantId ? `${usage.variantId}（不可用）` : '皮肤基础样式')
}

/** Persists only the exact Preset ref; clearing removes design entirely instead of writing design: {}. */
export function withTeachingDocumentPreset(document: TeachingDocumentV1, preset?: TeachingSkinPresetRef): TeachingDocumentV1 {
  const { design: _design, ...withoutDesign } = document
  return preset
    ? { ...withoutDesign, design: { preset: { id: preset.id, version: preset.version } } }
    : withoutDesign
}

function skinRefForId(skinId: string): TeachingSkinPresetRef | undefined {
  const skin = teachingSkinRegistry.get(skinId)
  return skin ? { id: skin.id, version: skin.version } : undefined
}

/** Each built-in Preset currently declares one Heading and one Box Skin. Extra bindings remain safe: the first target match wins. */
export function teachingDocumentSkinAssignmentsFromPreset(preset: TeachingSkinPresetDefinition): DocumentSkinAssignments {
  const assignments: DocumentSkinAssignments = {}
  for (const skinId of Object.keys(preset.bindings)) {
    const skin = teachingSkinRegistry.get(skinId)
    if (!skin) continue
    if (skin.target === 'heading' && !assignments.heading) assignments.heading = { id: skin.id, version: skin.version }
    if (skin.target === 'box' && !assignments.box) assignments.box = { id: skin.id, version: skin.version }
  }
  return assignments
}

function supportsSkinAssignment(block: Extract<TeachingBlock, { type: 'heading' | 'box' }>, skin: TeachingSkinPresetRef): boolean {
  const definition = teachingSkinRegistry.get(skin.id)
  if (!definition) return false
  if (block.type === 'heading') {
    return definition.target === 'heading'
      && (!definition.supportedLevels || definition.supportedLevels.includes(block.level))
  }
  return definition.target === 'box'
    && (!definition.supportedTemplates || definition.supportedTemplates.includes(block.templateId))
}

/**
 * Materializes a user-authorized global choice into compatible blocks using the
 * existing block Skin reference contract. Preserve mode never changes a block
 * that already has a Skin (including an explicit local Variant).
 */
export function applyTeachingDocumentSkinAssignments(
  document: TeachingDocumentV1,
  assignments: DocumentSkinAssignments,
  mode: DocumentSkinApplyMode,
): TeachingDocumentV1 {
  const updateBlocks = (blocks: readonly TeachingBlock[]): TeachingBlock[] => blocks.map((block) => {
    if (block.type === 'heading') {
      const skin = assignments.heading
      return skin && supportsSkinAssignment(block, skin) && (mode === 'replace' || !block.skin)
        ? { ...block, skin: { id: skin.id, version: skin.version } }
        : block
    }
    if (block.type === 'box') {
      const skin = assignments.box
      const nextSkin = skin && supportsSkinAssignment(block, skin) && (mode === 'replace' || !block.skin)
        ? { id: skin.id, version: skin.version }
        : undefined
      const children = updateBlocks(block.children as TeachingBlock[]) as typeof block.children
      return nextSkin || children !== block.children ? { ...block, ...(nextSkin ? { skin: nextSkin } : {}), children } : block
    }
    return block
  })
  return { ...document, content: updateBlocks(document.content) }
}

/** Applies a pinned Preset plus its source-defined target skins in the explicitly chosen mode. */
export function applyTeachingDocumentPreset(
  document: TeachingDocumentV1,
  preset: TeachingSkinPresetDefinition,
  mode: DocumentSkinApplyMode,
): TeachingDocumentV1 {
  return applyTeachingDocumentSkinAssignments(
    withTeachingDocumentPreset(document, { id: preset.id, version: preset.version }),
    teachingDocumentSkinAssignmentsFromPreset(preset),
    mode,
  )
}

/** Compact Preset tile: the bound Heading and Box Skins are previewed with the same miniature pipeline as the skin pickers. */
function PresetTile({
  preset,
  selected,
  onClick,
}: {
  preset: TeachingSkinPresetDefinition
  selected: boolean
  onClick: () => void
}) {
  const assignments = teachingDocumentSkinAssignmentsFromPreset(preset)
  const headingDef = assignments.heading ? teachingSkinRegistry.get(assignments.heading.id) : undefined
  const boxDef = assignments.box ? teachingSkinRegistry.get(assignments.box.id) : undefined
  const label = `${preset.label} · v${preset.version}`
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      title={`${preset.description || ''}${preset.description ? '\n' : ''}v${preset.version}`}
      onClick={onClick}
      className={`overflow-hidden rounded-md border p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 ${selected
        ? 'border-zinc-900 ring-1 ring-zinc-900 dark:border-zinc-100 dark:ring-zinc-100'
        : 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600'}`}
    >
      <span className="block space-y-1">
        {headingDef ? <MiniHeadingPreview definition={headingDef} level={2} variantId={preset.bindings[headingDef.id]} /> : <MiniPlainHeading />}
        {boxDef ? <MiniBoxPreview definition={boxDef} variantId={preset.bindings[boxDef.id]} /> : <MiniPlainBox />}
      </span>
      <span className="mt-1 flex items-center justify-between gap-1">
        <span className="truncate text-[10px] leading-3 text-zinc-500 dark:text-zinc-400">{preset.label}</span>
        <span className="flex shrink-0 items-center gap-0.5 font-mono text-[9px] leading-3 text-zinc-400">
          {selected ? <Check className="size-2.5" /> : null}v{preset.version}
        </span>
      </span>
    </button>
  )
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-zinc-200 pt-3 first:border-t-0 first:pt-0 dark:border-zinc-800">
      <h2 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      {children}
    </section>
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
  const [applyMode, setApplyMode] = useState<DocumentSkinApplyMode>('preserve')
  const [headingSkinId, setHeadingSkinId] = useState('')
  const [boxSkinId, setBoxSkinId] = useState('')
  const presetContext = useMemo(() => resolveTeachingDocumentSkinPresetContext(document.design?.preset), [document.design?.preset?.id, document.design?.preset?.version])
  const presets = teachingSkinPresetRegistry.list()
  const mappings = useMemo(() => teachingDocumentStyleMappings(document), [document])
  const overrides = useMemo(() => teachingDocumentLocalOverrides(document), [document])
  const skinUsages = useMemo(() => teachingDocumentSkinUsages(document), [document])
  const currentRef = document.design?.preset
  const presetHasEffect = mappings.some((mapping) => mapping.affectedCount > 0)
  const presetLabel = presetContext.status === 'resolved' ? `${presetContext.preset.label} · v${presetContext.preset.version}` : undefined
  const selectedAssignments: DocumentSkinAssignments = {
    ...(skinRefForId(headingSkinId) ? { heading: skinRefForId(headingSkinId) } : {}),
    ...(skinRefForId(boxSkinId) ? { box: skinRefForId(boxSkinId) } : {}),
  }
  const hasSelectedAssignments = Boolean(selectedAssignments.heading || selectedAssignments.box)
  const globalApplyLabel = applyMode === 'preserve' ? '应用且局部替换' : '应用到整篇文档'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <aside className="w-full shrink-0 overflow-y-auto border-b border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-950 lg:w-[22rem] lg:border-b-0 lg:border-r">
        <div className="space-y-4">
          <SidebarSection title="整体样式">
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">应用方式</span>
              <div className="flex items-center rounded-md border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-950" role="radiogroup" aria-label="应用皮肤方式">
                <button type="button" role="radio" aria-checked={applyMode === 'preserve'} title="仅为未设皮肤的对象应用" onClick={() => setApplyMode('preserve')} className={`h-5 rounded px-1.5 text-[10px] font-medium transition-colors ${applyMode === 'preserve' ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}`}>保留局部</button>
                <button type="button" role="radio" aria-checked={applyMode === 'replace'} title="替换同类对象并清除局部配色" onClick={() => setApplyMode('replace')} className={`h-5 rounded px-1.5 text-[10px] font-medium transition-colors ${applyMode === 'replace' ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}`}>统一替换</button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                aria-pressed={!currentRef}
                aria-label="默认"
                title="不使用文档样式组合，按各元素自身的基础样式显示。"
                onClick={() => { if (currentRef) onDocumentChange(withTeachingDocumentPreset(document)) }}
                className={`overflow-hidden rounded-md border border-dashed p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 ${!currentRef ? 'border-zinc-900 ring-1 ring-zinc-900 dark:border-zinc-100 dark:ring-zinc-100' : 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600'}`}
              >
                <span className="block space-y-1"><MiniPlainHeading /><MiniPlainBox /></span>
                <span className="mt-1 flex items-center justify-between">
                  <span className="text-[10px] leading-3 text-zinc-500 dark:text-zinc-400">默认</span>
                  {!currentRef ? <Check className="size-2.5 text-zinc-400" /> : null}
                </span>
              </button>
              {presets.map((preset) => (
                <PresetTile
                  key={`${preset.id}:${preset.version}`}
                  preset={preset}
                  selected={currentRef?.id === preset.id && currentRef.version === preset.version}
                  onClick={() => { if (currentRef?.id !== preset.id || currentRef.version !== preset.version) onDocumentChange(applyTeachingDocumentPreset(document, preset, applyMode)) }}
                />
              ))}
            </div>
            {currentRef && presetContext.status === 'unavailable' ? (
              <p className="mt-2 rounded-md border border-amber-300 bg-amber-50/40 px-2 py-1.5 text-[11px] leading-4 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/10 dark:text-amber-300">当前样式不可用：{currentRef.id} · v{currentRef.version}。文档会使用安全回退；选择其他样式后才会替换此引用。</p>
            ) : null}
            {!presets.length ? <p className="mt-2 rounded-md border border-dashed border-zinc-200 px-2 py-1.5 text-[11px] text-zinc-500 dark:border-zinc-800">当前没有可选的文档样式。</p> : null}
          </SidebarSection>

          <SidebarSection title="全局皮肤">
            <div className="mt-2 space-y-2">
              <TeachingGlobalSkinPicker target="heading" skinId={headingSkinId} presetContext={presetContext} onChange={setHeadingSkinId} />
              <TeachingGlobalSkinPicker target="box" skinId={boxSkinId} presetContext={presetContext} onChange={setBoxSkinId} />
              <button type="button" disabled={!hasSelectedAssignments} onClick={() => onDocumentChange(applyTeachingDocumentSkinAssignments(document, selectedAssignments, applyMode))} className="h-7 w-full rounded-md bg-zinc-900 px-3 text-[11px] font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">{globalApplyLabel}</button>
            </div>
          </SidebarSection>

          <SidebarSection title="已使用的皮肤">
            {skinUsages.length ? (
              <ul className="mt-2 divide-y divide-zinc-200/70 rounded-md border border-zinc-200 bg-white dark:divide-zinc-800/70 dark:border-zinc-800 dark:bg-zinc-950">
                {skinUsages.map((usage) => (
                  <li key={`${usage.blockLabel}:${usage.skinId}:v${usage.skinVersion || ''}:${usage.variantId || ''}:${usage.source}:${usage.unavailable || ''}`} className="px-2 py-1.5">
                    <p className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">{usage.blockLabel} · {usage.skinLabel}</span>
                      <span className="shrink-0 text-[10px] text-zinc-400">{usage.count} 块</span>
                    </p>
                    <p className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                      <span className="truncate">当前：{usageVariantText(usage)}</span>
                      <span className="shrink-0 rounded border border-zinc-200 px-1 py-px text-[9px] dark:border-zinc-800">{skinUsageSourceLabel(usage, presetLabel)}</span>
                    </p>
                    {usage.unavailable ? <p className="mt-1 text-[10px] leading-3 text-amber-700 dark:text-amber-300">{usage.unavailable === 'missing' ? '皮肤不可用' : '皮肤与当前元素不兼容'}，已安全回退。</p> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-[11px] text-zinc-500">当前文档尚未为标题或知识卡片选择皮肤。</p>}

            {presetContext.status === 'resolved' && mappings.length ? (
              <div className="mt-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-950">
                <p className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500">当前组合映射</p>
                <ul className="mt-1 space-y-0.5">
                  {mappings.map((mapping) => (
                    <li key={mapping.skinId} className="flex items-center justify-between gap-2 text-[11px] text-zinc-600 dark:text-zinc-300">
                      <span className="truncate">{mapping.skinLabel} → {mapping.variantLabel}</span>
                      <span className="shrink-0 text-[10px] text-zinc-400">{mapping.affectedCount} 块</span>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={() => onDocumentChange(applyTeachingDocumentPreset(document, presetContext.preset, applyMode))} className="mt-2 h-7 w-full rounded-md border border-zinc-200 bg-white px-2 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900">将当前组合应用到整篇文档</button>
                {!presetHasEffect ? <p className="mt-1.5 text-[10px] leading-4 text-zinc-500 dark:text-zinc-400">当前没有可应用的兼容对象；若文档已有局部皮肤，请选择“统一替换”。</p> : null}
              </div>
            ) : null}

            {overrides.length ? (
              <div className="mt-2">
                <p className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500">局部覆盖</p>
                <ul className="mt-1 space-y-0.5">
                  {overrides.map((item) => (
                    <li key={item.blockId} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate text-zinc-600 dark:text-zinc-300" title={item.blockLabel}>{item.blockLabel}</span>
                      <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">{item.skinLabel} → {item.variantLabel || item.variantId}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </SidebarSection>
        </div>
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

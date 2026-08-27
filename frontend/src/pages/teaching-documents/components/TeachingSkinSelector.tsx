import { useState, type CSSProperties } from 'react'
import { ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { TeachingSkinRef } from '@/types/teachingDocument'
import type { TeachingSkinDefinition, TeachingSkinPresetResolution, TeachingSkinVariantId } from '@/utils/teachingDocument/skins'
import { resolveBoxSkin, resolveHeadingSkin, resolveTeachingSkinDesignRenderState, resolveTeachingSkinVariantSelection, teachingSkinRegistry } from '@/utils/teachingDocument/skins'
import { teachingSkinVariantSwatchColor } from '@/extensions/teaching-document/skins/shared/palette'

export function HeadingSkinSelector({
  skin,
  level,
  presetContext,
  onChange,
}: {
  skin?: TeachingSkinRef
  level: 1 | 2 | 3 | 4
  presetContext?: TeachingSkinPresetResolution
  onChange: (skin: TeachingSkinRef | undefined) => void
}) {
  const resolution = resolveHeadingSkin(skin, level)
  const available = teachingSkinRegistry.list('heading').filter((definition) => !definition.supportedLevels || definition.supportedLevels.includes(level))
  return <SkinSelect skin={skin} definition={resolution.status === 'resolved' ? resolution.definition : undefined} presetContext={presetContext} resolutionLabel={resolution.status === 'resolved' ? undefined : skin ? `当前引用不可用：${resolution.status === 'missing' ? '皮肤缺失' : '不支持该层级'}` : undefined} target="heading" level={level} options={available} onChange={onChange} />
}

export function BoxSkinSelector({
  skin,
  templateId,
  presetContext,
  onChange,
}: {
  skin?: TeachingSkinRef
  templateId: string
  presetContext?: TeachingSkinPresetResolution
  onChange: (skin: TeachingSkinRef | undefined) => void
}) {
  const resolution = resolveBoxSkin(skin, templateId)
  const available = teachingSkinRegistry.list('box').filter((definition) => !definition.supportedTemplates || definition.supportedTemplates.includes(templateId))
  return <SkinSelect skin={skin} definition={resolution.status === 'resolved' ? resolution.definition : undefined} presetContext={presetContext} resolutionLabel={resolution.status === 'resolved' ? undefined : skin ? `当前引用不可用：${resolution.status === 'missing' ? '皮肤缺失' : '不支持该模板'}` : undefined} target="box" options={available} onChange={onChange} />
}

/** Visual document-level picker. It shares the exact miniature production previews used by the block inspector. */
export function TeachingGlobalSkinPicker({
  target,
  skinId,
  presetContext,
  onChange,
}: {
  target: 'heading' | 'box'
  skinId: string
  presetContext?: TeachingSkinPresetResolution
  onChange: (skinId: string) => void
}) {
  const options = teachingSkinRegistry.list(target)
  const label = target === 'heading' ? '全局标题皮肤' : '全局知识卡片皮肤'
  const defaultLabel = target === 'heading' ? '不调整标题' : '不调整知识卡片'
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-zinc-500">{target === 'heading' ? '标题皮肤' : '知识卡片皮肤'}</p>
      <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label={label}>
        <SkinTile label={defaultLabel} active={!skinId} dashed onSelect={() => onChange('')}>
          <span className="flex min-h-4 items-center justify-center text-[10px] leading-3 text-zinc-400 dark:text-zinc-500">不调整</span>
        </SkinTile>
        {options.map((definition) => {
          const variantId = presetContext?.bindings?.[definition.id]
          return (
            <SkinTile key={definition.id} label={definition.label} active={skinId === definition.id} onSelect={() => onChange(definition.id)}>
              {target === 'heading'
                ? <MiniHeadingPreview definition={definition} level={2} variantId={variantId} />
                : <MiniBoxPreview definition={definition} variantId={variantId} />}
            </SkinTile>
          )
        })}
      </div>
    </div>
  )
}

/** Shared inspector control: it consumes the production resolver and persists only a Skin-local Variant ID. */
export function TeachingSkinVariantSelector({
  skin,
  definition,
  presetContext,
  onChange,
}: {
  skin: TeachingSkinRef
  definition: TeachingSkinDefinition
  presetContext?: TeachingSkinPresetResolution
  onChange: (skin: TeachingSkinRef) => void
}) {
  const variants = definition.design?.variants || []
  const selection = resolveTeachingSkinVariantSelection(skin, skin.id, undefined, presetContext?.bindings)
  const activeVariant = selection.requestedVariantId ? variants.find((item) => item.id === selection.requestedVariantId) : undefined
  const presetLabel = presetContext?.status === 'resolved' ? `${presetContext.preset.label} · v${presetContext.preset.version}` : undefined
  const sourceLabel = selection.source === 'explicit'
    ? '此元素覆盖'
    : selection.source === 'preset'
      ? presetLabel || '当前文档样式'
      : '基础样式'
  if (!variants.length && skin.variant === undefined) return null
  const clearVariant = () => {
    const { variant: _variant, ...withoutVariant } = skin
    onChange(withoutVariant)
  }
  return (
    <div className="space-y-1">
      <p className="text-[13px] font-medium text-zinc-500">局部样式</p>
      <div className="rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
        <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200">当前：{activeVariant?.label || (selection.requestedVariantId ? selection.requestedVariantId : '基础样式')}</p>
        <p className="mt-0.5 text-[11px] text-zinc-500">来源：{sourceLabel}</p>
        {selection.source === 'explicit' && !activeVariant ? <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">局部样式不可用：{skin.variant}。当前会安全回退到基础样式。</p> : null}
        {variants.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="局部样式配色">
            <button
              type="button"
              role="radio"
              aria-checked={skin.variant === undefined}
              title="跟随整体（基础样式）"
              onClick={clearVariant}
              className={`flex h-6 items-center rounded-full border px-2 text-[11px] font-medium ${skin.variant === undefined ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100' : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900'}`}
            >跟随整体</button>
            {variants.map((variant) => {
              const swatch = teachingSkinVariantSwatchColor(definition, variant.id)
              const active = skin.variant === variant.id
              return (
                <button
                  key={variant.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={variant.label}
                  aria-label={variant.label}
                  onClick={() => onChange({ ...skin, variant: variant.id })}
                  className={`flex size-6 items-center justify-center rounded-full border ${active ? 'border-zinc-900 ring-1 ring-zinc-900 ring-offset-1 dark:border-zinc-100 dark:ring-zinc-100 dark:ring-offset-zinc-950' : 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600'}`}
                >
                  {swatch ? <span aria-hidden className="size-3.5 rounded-full border border-black/10" style={{ backgroundColor: swatch }} /> : <span aria-hidden className="size-3.5 rounded-full bg-zinc-200 dark:bg-zinc-700" />}
                </button>
              )
            })}
          </div>
        ) : null}
        {variants.length && activeVariant ? <p className="mt-1.5 text-[11px] text-zinc-500">配色：{activeVariant.label}</p> : null}
        {selection.source === 'explicit' && !variants.length ? <button type="button" onClick={clearVariant} className="mt-2 text-[11px] font-medium text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-300">恢复跟随整体</button> : null}
      </div>
    </div>
  )
}

function SkinSelect({
  skin,
  definition,
  presetContext,
  resolutionLabel,
  target,
  level,
  options,
  onChange,
}: {
  skin?: TeachingSkinRef
  definition?: TeachingSkinDefinition
  presetContext?: TeachingSkinPresetResolution
  resolutionLabel?: string
  target: 'heading' | 'box'
  level?: 1 | 2 | 3 | 4
  options: TeachingSkinDefinition[]
  onChange: (skin: TeachingSkinRef | undefined) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const selectedIsAvailable = !skin || options.some((definition) => definition.id === skin.id)
  const previewVariantId = (definition: TeachingSkinDefinition): TeachingSkinVariantId | undefined => {
    if (skin?.id === definition.id) return resolveTeachingSkinVariantSelection(skin, definition.id, undefined, presetContext?.bindings).requestedVariantId
    return presetContext?.bindings?.[definition.id]
  }
  return (
    <div className="rounded-md border border-zinc-200/70 dark:border-zinc-800/70">
      <button
        type="button"
        aria-expanded={expanded}
        className="flex cursor-pointer list-none items-center justify-between px-2.5 py-2 text-[13px] font-medium text-zinc-500 [&::-webkit-details-marker]:hidden"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          setExpanded((current) => !current)
        }}
      >
        皮肤
        <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}><ChevronDown className="size-3.5" /></motion.span>
      </button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="skin-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-zinc-100 px-2.5 py-2.5 dark:border-zinc-900">
              <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="皮肤">
                <SkinTile label="默认" active={skin === undefined} dashed onSelect={() => onChange(undefined)}>
                  {target === 'heading' ? <MiniPlainHeading /> : <MiniPlainBox />}
                </SkinTile>
                {options.map((definition) => (
                  <SkinTile
                    key={definition.id}
                    label={definition.label}
                    active={selectedIsAvailable && skin?.id === definition.id}
                    onSelect={() => onChange({ id: definition.id, version: definition.version })}
                  >
                    {target === 'heading'
                      ? <MiniHeadingPreview definition={definition} level={level || 2} variantId={previewVariantId(definition)} />
                      : <MiniBoxPreview definition={definition} variantId={previewVariantId(definition)} />}
                  </SkinTile>
                ))}
              </div>
              {resolutionLabel ? <p className="text-[11px] text-amber-700 dark:text-amber-300">{resolutionLabel}；会保留原引用并按默认视觉显示。</p> : null}
              {skin && definition ? <TeachingSkinVariantSelector skin={skin} definition={definition} presetContext={presetContext} onChange={onChange} /> : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

/** One skin candidate rendered as a miniature real-preview tile. */
export function SkinTile({ label, active, dashed, onSelect, children }: {
  label: string
  active: boolean
  dashed?: boolean
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={label}
      title={label}
      onClick={onSelect}
      className={`overflow-hidden rounded-md border p-1.5 text-left ${dashed ? 'border-dashed' : ''} ${active ? 'border-zinc-900 ring-1 ring-zinc-900 dark:border-zinc-100 dark:ring-zinc-100' : 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600'}`}
    >
      <span className="block min-h-4">{children}</span>
      <span className="mt-1 block truncate text-[10px] leading-3 text-zinc-500 dark:text-zinc-400">{label}</span>
    </button>
  )
}

export function MiniPlainHeading() {
  return <span className="block truncate text-[12px] font-semibold leading-4 text-zinc-800 dark:text-zinc-200">标题</span>
}

export function MiniPlainBox() {
  return (
    <span className="block overflow-hidden rounded border border-zinc-200 dark:border-zinc-800">
      <span className="block truncate bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium leading-3 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">卡片标题</span>
      <span className="block truncate px-1.5 py-0.5 text-[9px] leading-3 text-zinc-400">正文示意</span>
    </span>
  )
}

/** Renders the production skin class plus resolved design variables, mirroring the document renderer. */
export function MiniHeadingPreview({ definition, level, variantId }: { definition: TeachingSkinDefinition; level: 1 | 2 | 3 | 4; variantId?: TeachingSkinVariantId }) {
  const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4'
  const design = resolveTeachingSkinDesignRenderState(definition, variantId)
  return (
    <Tag
      className={`td-heading truncate text-[12px] font-semibold leading-4 text-zinc-900 dark:text-zinc-50 ${definition.className}`}
      style={{ ...(design.status === 'resolved' ? design.cssVariables : {}) } as CSSProperties}
      data-level={level}
    >标题</Tag>
  )
}

export function MiniBoxPreview({ definition, variantId }: { definition: TeachingSkinDefinition; variantId?: TeachingSkinVariantId }) {
  const design = resolveTeachingSkinDesignRenderState(definition, variantId)
  return (
    <span
      className={`td-box block overflow-hidden border ${definition.className}`}
      style={{ ...(design.status === 'resolved' ? design.cssVariables : {}) } as CSSProperties}
    >
      <span className="td-box-header flex items-center px-1.5 py-0.5">
        <span className="truncate text-[10px] font-medium leading-3 text-zinc-900 dark:text-zinc-100">卡片标题</span>
      </span>
      <span className="td-box-body block truncate px-1.5 py-0.5 text-[9px] leading-3 text-zinc-500 dark:text-zinc-400">正文示意</span>
    </span>
  )
}

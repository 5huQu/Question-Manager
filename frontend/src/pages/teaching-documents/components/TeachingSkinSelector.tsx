import type { TeachingSkinRef } from '@/types/teachingDocument'
import type { TeachingSkinDefinition, TeachingSkinPresetResolution } from '@/utils/teachingDocument/skins'
import { resolveBoxSkin, resolveHeadingSkin, resolveTeachingSkinVariantSelection, teachingSkinRegistry } from '@/utils/teachingDocument/skins'
import { teachingSkinVariantSwatchColor } from '@/extensions/teaching-document/skins/shared/palette'
import { Field, fieldClass } from './settings/common'

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
  return <SkinSelect skin={skin} definition={resolution.status === 'resolved' ? resolution.definition : undefined} presetContext={presetContext} resolutionLabel={resolution.status === 'resolved' ? undefined : skin ? `当前引用不可用：${resolution.status === 'missing' ? '皮肤缺失' : '不支持该层级'}` : undefined} options={available} onChange={onChange} />
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
  return <SkinSelect skin={skin} definition={resolution.status === 'resolved' ? resolution.definition : undefined} presetContext={presetContext} resolutionLabel={resolution.status === 'resolved' ? undefined : skin ? `当前引用不可用：${resolution.status === 'missing' ? '皮肤缺失' : '不支持该模板'}` : undefined} options={available} onChange={onChange} />
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
  options,
  onChange,
}: {
  skin?: TeachingSkinRef
  definition?: TeachingSkinDefinition
  presetContext?: TeachingSkinPresetResolution
  resolutionLabel?: string
  options: Array<{ id: string; label: string; version: number }>
  onChange: (skin: TeachingSkinRef | undefined) => void
}) {
  const selectedIsAvailable = !skin || options.some((definition) => definition.id === skin.id)
  return (
    <>
      <Field label="皮肤">
      <select
        className={fieldClass}
        aria-label="皮肤"
        value={skin?.id || ''}
        onChange={(event) => {
          const definition = options.find((item) => item.id === event.target.value)
          onChange(definition ? { id: definition.id, version: definition.version } : undefined)
        }}
      >
        <option value="">默认 / 跟随默认</option>
        {!selectedIsAvailable && skin ? <option value={skin.id} disabled>{`${skin.id}（${resolutionLabel || '不可用'}）`}</option> : null}
        {options.map((definition) => <option key={definition.id} value={definition.id}>{definition.label}</option>)}
      </select>
        {resolutionLabel ? <p className="mt-1 text-[11px] leading-4 text-amber-700 dark:text-amber-300">{resolutionLabel}；会保留原引用并按默认视觉显示。</p> : null}
      </Field>
      {skin && definition ? <TeachingSkinVariantSelector skin={skin} definition={definition} presetContext={presetContext} onChange={onChange} /> : null}
    </>
  )
}

import type { TeachingSkinRef } from '@/types/teachingDocument'
import { resolveBoxSkin, resolveHeadingSkin, teachingSkinRegistry } from '@/utils/teachingDocument/skins'
import { Field, fieldClass } from './settings/common'

export function HeadingSkinSelector({
  skin,
  level,
  onChange,
}: {
  skin?: TeachingSkinRef
  level: 1 | 2 | 3 | 4
  onChange: (skin: TeachingSkinRef | undefined) => void
}) {
  const resolution = resolveHeadingSkin(skin, level)
  const available = teachingSkinRegistry.list('heading').filter((definition) => !definition.supportedLevels || definition.supportedLevels.includes(level))
  return <SkinSelect skin={skin} resolutionLabel={resolution.status === 'resolved' ? undefined : skin ? `当前引用不可用：${resolution.status === 'missing' ? '皮肤缺失' : '不支持该层级'}` : undefined} options={available} onChange={onChange} />
}

export function BoxSkinSelector({
  skin,
  templateId,
  onChange,
}: {
  skin?: TeachingSkinRef
  templateId: string
  onChange: (skin: TeachingSkinRef | undefined) => void
}) {
  const resolution = resolveBoxSkin(skin, templateId)
  const available = teachingSkinRegistry.list('box').filter((definition) => !definition.supportedTemplates || definition.supportedTemplates.includes(templateId))
  return <SkinSelect skin={skin} resolutionLabel={resolution.status === 'resolved' ? undefined : skin ? `当前引用不可用：${resolution.status === 'missing' ? '皮肤缺失' : '不支持该模板'}` : undefined} options={available} onChange={onChange} />
}

function SkinSelect({
  skin,
  resolutionLabel,
  options,
  onChange,
}: {
  skin?: TeachingSkinRef
  resolutionLabel?: string
  options: Array<{ id: string; label: string; version: number }>
  onChange: (skin: TeachingSkinRef | undefined) => void
}) {
  const selectedIsAvailable = !skin || options.some((definition) => definition.id === skin.id)
  return (
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
  )
}

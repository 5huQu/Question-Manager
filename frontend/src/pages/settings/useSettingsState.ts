import { useEffect, useState } from 'react'
import { settingsApi } from '@/api/settings'
import { importV2Api, type ImportFlowV2ParserConfig, type ImportParserPreset } from '@/api/importV2'
import { useAsync } from '@/hooks/useAsync'
import { useQuery } from '@/lib/queryCache'
import { importV2QueryKeys } from '@/pages/import-v2/importV2Queries'
import type { OcrSettings } from '@/types'
import { type ParserListKey, type ParserTextDraft, type SettingsDraft, parserConfigToTextDraft, parserTextDraftToConfig } from './types'

export function useSettingsState() {
  const { data, error, loading, reload } = useAsync<OcrSettings>(() => settingsApi.getOcrSettings(), [])
  const [draft, setDraft] = useState<SettingsDraft>({})
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [showLibreOfficeAlert, setShowLibreOfficeAlert] = useState(false)

  const parserConfigApi = useQuery<{ config: ImportFlowV2ParserConfig }>({
    key: importV2QueryKeys.parserConfig,
    queryFn: () => importV2Api.getParserConfig(),
  })
  const parserPresetsApi = useQuery<{ items: ImportParserPreset[] }>({
    key: importV2QueryKeys.parserPresets,
    queryFn: () => importV2Api.listParserPresets(),
  })
  const [parserConfig, setParserConfig] = useState<ImportFlowV2ParserConfig | null>(null)
  const [parserTextDraft, setParserTextDraft] = useState<ParserTextDraft | null>(null)
  const [parserPresets, setParserPresets] = useState<ImportParserPreset[]>([])
  const [selectedParserPresetId, setSelectedParserPresetId] = useState('')
  const [isParserSaving, setIsParserSaving] = useState(false)
  const [parserSaveStatus, setParserSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [activeParserRuleKey, setActiveParserRuleKey] = useState<ParserListKey>('sectionHeadings')

  useEffect(() => {
    if (data) {
      setDraft(data)
      if (!data.sofficeAvailable) setShowLibreOfficeAlert(true)
    }
  }, [data])

  useEffect(() => {
    if (parserConfigApi.data?.config) {
      setParserConfig(parserConfigApi.data.config)
      setParserTextDraft(parserConfigToTextDraft(parserConfigApi.data.config))
    }
  }, [parserConfigApi.data])

  useEffect(() => {
    if (parserPresetsApi.data?.items) {
      setParserPresets(parserPresetsApi.data.items)
      if (!selectedParserPresetId && parserPresetsApi.data.items[0]) setSelectedParserPresetId(parserPresetsApi.data.items[0].id)
    }
  }, [parserPresetsApi.data, selectedParserPresetId])

  function updateParserList(key: ParserListKey, value: string) {
    setParserTextDraft((draft) => {
      const base = draft || (parserConfig ? parserConfigToTextDraft(parserConfig) : null)
      return base ? { ...base, [key]: value } : draft
    })
  }

  function parserListValues(key: ParserListKey) {
    const text = parserTextDraft?.[key] ?? parserConfig?.[key].join('\n') ?? ''
    return text ? text.split('\n') : []
  }

  function setParserListValues(key: ParserListKey, values: string[]) {
    updateParserList(key, values.join('\n'))
  }

  function addParserRule(key: ParserListKey) {
    setParserListValues(key, [...parserListValues(key), ''])
  }

  function updateParserRule(key: ParserListKey, index: number, value: string) {
    const values = parserListValues(key)
    values[index] = value
    setParserListValues(key, values)
  }

  function deleteParserRule(key: ParserListKey, index: number) {
    const values = parserListValues(key)
    values.splice(index, 1)
    setParserListValues(key, values)
  }

  async function saveParserConfig() {
    if (!parserConfig || !parserTextDraft) return
    setIsParserSaving(true)
    setParserSaveStatus(null)
    try {
      const saved = await importV2Api.updateParserConfig(parserTextDraftToConfig(parserConfig, parserTextDraft))
      setParserConfig(saved.config)
      setParserTextDraft(parserConfigToTextDraft(saved.config))
      parserConfigApi.setData(saved)
      setParserSaveStatus({ type: 'success', message: '导入识别规则已保存，下一次生成待确认题目时生效。' })
    } catch (err) {
      setParserSaveStatus({ type: 'error', message: err instanceof Error ? err.message : '保存规则失败' })
    } finally {
      setIsParserSaving(false)
    }
  }

  async function resetParserConfig() {
    setIsParserSaving(true)
    setParserSaveStatus(null)
    try {
      const saved = await importV2Api.resetParserConfig()
      setParserConfig(saved.config)
      setParserTextDraft(parserConfigToTextDraft(saved.config))
      parserConfigApi.setData(saved)
      setParserSaveStatus({ type: 'success', message: '已恢复默认导入识别规则。' })
    } catch (err) {
      setParserSaveStatus({ type: 'error', message: err instanceof Error ? err.message : '恢复默认失败' })
    } finally {
      setIsParserSaving(false)
    }
  }

  function applyParserPreset() {
    const preset = parserPresets.find((item) => item.id === selectedParserPresetId)
    if (!preset) return
    setParserConfig(preset.config)
    setParserTextDraft(parserConfigToTextDraft(preset.config))
    setParserSaveStatus({ type: 'success', message: `已载入预设「${preset.name}」，保存规则后生效。` })
  }

  async function saveCurrentParserPreset() {
    if (!parserConfig || !parserTextDraft) return
    const name = window.prompt('预设名称', '深圳调研卷答案格式')
    if (!name?.trim()) return
    setIsParserSaving(true)
    setParserSaveStatus(null)
    try {
      const config = parserTextDraftToConfig(parserConfig, parserTextDraft)
      const saved = await importV2Api.createParserPreset({
        name: name.trim(),
        description: '从设置页保存的导入识别规则预设',
        config,
      })
      setParserPresets(saved.items)
      setSelectedParserPresetId(saved.preset.id)
      parserPresetsApi.setData({ items: saved.items })
      setParserSaveStatus({ type: 'success', message: `已保存预设「${saved.preset.name}」。` })
    } catch (err) {
      setParserSaveStatus({ type: 'error', message: err instanceof Error ? err.message : '保存预设失败' })
    } finally {
      setIsParserSaving(false)
    }
  }

  async function deleteSelectedParserPreset() {
    const preset = parserPresets.find((item) => item.id === selectedParserPresetId)
    if (!preset || preset.builtIn) return
    if (!window.confirm(`确定删除预设「${preset.name}」吗？`)) return
    setIsParserSaving(true)
    setParserSaveStatus(null)
    try {
      const result = await importV2Api.deleteParserPreset(preset.id)
      setParserPresets(result.items)
      setSelectedParserPresetId(result.items[0]?.id || '')
      parserPresetsApi.setData({ items: result.items })
      setParserSaveStatus({ type: 'success', message: '预设已删除。' })
    } catch (err) {
      setParserSaveStatus({ type: 'error', message: err instanceof Error ? err.message : '删除预设失败' })
    } finally {
      setIsParserSaving(false)
    }
  }

  async function save(moduleName = '系统设置') {
    setIsSaving(true)
    setSaveStatus(null)
    try {
      const saved = await settingsApi.updateOcrSettings(draft)
      document.title = saved.siteTitle || 'Question Manager'
      window.dispatchEvent(new CustomEvent('app-settings-updated', { detail: saved }))
      await reload()
      setSaveStatus({ type: 'success', message: `「${moduleName}」配置已成功保存！` })
      setTimeout(() => setSaveStatus(null), 3000)
    } catch (err) {
      setSaveStatus({ type: 'error', message: err instanceof Error ? err.message : '保存设置失败' })
    } finally {
      setIsSaving(false)
    }
  }

  function toggleTeachingStage(stage: string) {
    const current = draft.teachingStages ?? []
    const next = current.includes(stage) ? current.filter((item) => item !== stage) : [...current, stage]
    setDraft({ ...draft, teachingStages: next.length ? next : ['高中'] })
  }

  return {
    data,
    error,
    loading,
    draft,
    setDraft,
    isSaving,
    saveStatus,
    showLibreOfficeAlert,
    setShowLibreOfficeAlert,
    parserConfigApi,
    parserPresetsApi,
    parserConfig,
    setParserConfig,
    parserTextDraft,
    parserPresets,
    selectedParserPresetId,
    setSelectedParserPresetId,
    isParserSaving,
    parserSaveStatus,
    activeParserRuleKey,
    setActiveParserRuleKey,
    parserListValues,
    addParserRule,
    updateParserRule,
    deleteParserRule,
    saveParserConfig,
    resetParserConfig,
    applyParserPreset,
    saveCurrentParserPreset,
    deleteSelectedParserPreset,
    save,
    toggleTeachingStage,
  }
}

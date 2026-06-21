import { useEffect, useState } from 'react'
import { BookOpen, Check, Settings2, Tags, AlertCircle, LoaderCircle, SlidersHorizontal, Wrench, ExternalLink, Scissors, Plus, Trash2, ToggleLeft, ToggleRight, RotateCcw } from 'lucide-react'
import { api, jsonHeaders } from '@/api/client'
import { Button, Empty, PageTitle } from '@/components/ui'
import { Modal } from '@/components/dialogs/Modal'
import { useAsync } from '@/hooks/useAsync'
import type { OcrSettings, SlicerRuleEntry, SlicerRulesData, SlicerRulesResponse } from '@/types'
import { teachingStageOptions } from '@/utils/stages'
import { libreOfficeDownloadUrl } from '@/utils/wordFiles'

export function SettingsPage() {
  const { data, error, loading, reload } = useAsync<OcrSettings>(() => api('/api/tools/pdf-slicer/ocr-settings'), [])
  const [draft, setDraft] = useState<Partial<OcrSettings & { apiKey: string; doc2xApiKey: string; cleanupApiKey: string }>>({})
  const [activeTab, setActiveTab] = useState<'basic' | 'tools' | 'ocr' | 'classification' | 'prompts' | 'rules'>('basic')
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [showLibreOfficeAlert, setShowLibreOfficeAlert] = useState(false)

  // Rules state
  const rulesApi = useAsync<SlicerRulesResponse>(() => api('/api/tools/pdf-slicer/rules'), [])
  const [rulesDraft, setRulesDraft] = useState<SlicerRulesData | null>(null)
  const [rulesBaseVersion, setRulesBaseVersion] = useState<number>(0)
  const [isRulesSaving, setIsRulesSaving] = useState(false)
  const [rulesSaveStatus, setRulesSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    if (rulesApi.data) {
      setRulesDraft(rulesApi.data)
      setRulesBaseVersion(rulesApi.data.baseVersion)
    }
  }, [rulesApi.data])

  // Rules handlers
  function addRule(category: string) {
    if (!rulesDraft) return
    const entries: SlicerRuleEntry[] = [...((rulesDraft as any)[category] || [])]
    const newId = `${category}_${Date.now()}`
    entries.push({ id: newId, term: '', matchMode: 'contains', enabled: true })
    setRulesDraft({ ...rulesDraft, [category]: entries })
  }

  function updateRule(category: string, index: number, updated: SlicerRuleEntry) {
    if (!rulesDraft) return
    const entries: SlicerRuleEntry[] = [...((rulesDraft as any)[category] || [])]
    entries[index] = updated
    setRulesDraft({ ...rulesDraft, [category]: entries })
  }

  function deleteRule(category: string, index: number) {
    if (!rulesDraft) return
    const entries: SlicerRuleEntry[] = [...((rulesDraft as any)[category] || [])]
    entries.splice(index, 1)
    setRulesDraft({ ...rulesDraft, [category]: entries })
  }

  function validateRulesDraft() {
    const draft = rulesDraft
    if (!draft) return
    api<{ valid: boolean; errors: string[] }>('/api/tools/pdf-slicer/rules/validate', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ rules: draft }),
    }).then((result) => {
      if (result.valid) {
        setRulesSaveStatus({ type: 'success', message: '规则校验通过！' })
        setTimeout(() => setRulesSaveStatus(null), 3000)
      } else {
        setRulesSaveStatus({ type: 'error', message: '校验失败：' + result.errors.join('；') })
      }
    }).catch((err: any) => {
      setRulesSaveStatus({ type: 'error', message: '校验请求失败：' + (err?.message || '未知错误') })
    })
  }

  function resetRulesDraft() {
    rulesApi.reload()
  }

  function discardRulesDraft() {
    if (rulesApi.data) {
      setRulesDraft(rulesApi.data)
      setRulesBaseVersion(rulesApi.data.baseVersion)
    }
    setRulesSaveStatus(null)
  }

  async function saveRules() {
    const draft = rulesDraft
    if (!draft) return
    setIsRulesSaving(true)
    setRulesSaveStatus(null)
    try {
      const saved = await api<SlicerRulesResponse>('/api/tools/pdf-slicer/rules', {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ rules: draft, baseVersion: rulesBaseVersion }),
      })
      setRulesBaseVersion(saved.baseVersion)
      setRulesDraft(saved)
      rulesApi.setData(saved)
      setRulesSaveStatus({ type: 'success', message: '规则已保存并生效！下次切题将使用新规则。' })
      setTimeout(() => setRulesSaveStatus(null), 5000)
    } catch (err: any) {
      setRulesSaveStatus({ type: 'error', message: err?.message || '保存失败' })
    } finally {
      setIsRulesSaving(false)
    }
  }

  useEffect(() => {
    if (data) {
      setDraft(data)
      if (!data.sofficeAvailable) setShowLibreOfficeAlert(true)
    }
  }, [data])

  async function save() {
    setIsSaving(true)
    setSaveStatus(null)
    try {
      const saved = await api<OcrSettings>('/api/tools/pdf-slicer/ocr-settings', {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify(draft),
      })
      document.title = saved.siteTitle || 'Question Manager'
      window.dispatchEvent(new CustomEvent('app-settings-updated', { detail: saved }))
      await reload()
      setSaveStatus({ type: 'success', message: '设置已成功保存！' })
      // Auto clear success message after 3 seconds
      setTimeout(() => {
        setSaveStatus(null)
      }, 3000)
    } catch (err: any) {
      setSaveStatus({ type: 'error', message: err?.message || '保存设置失败' })
    } finally {
      setIsSaving(false)
    }
  }

  function toggleTeachingStage(stage: string) {
    const current = draft.teachingStages ?? []
    const next = current.includes(stage)
      ? current.filter((item) => item !== stage)
      : [...current, stage]
    setDraft({ ...draft, teachingStages: next.length ? next : ['高中'] })
  }

  const tabItems = [
    { id: 'basic' as const, label: '基础设置', icon: SlidersHorizontal, desc: '系统名称、网站信息与导出水印' },
    { id: 'tools' as const, label: '外部工具', icon: Wrench, desc: 'LibreOffice 与本地转换工具' },
    { id: 'ocr' as const, label: 'OCR 设置', icon: Settings2, desc: 'API、密钥与并发参数' },
    { id: 'classification' as const, label: '数据分类', icon: Tags, desc: '完成后的知识点与难度标签' },
    { id: 'prompts' as const, label: 'OCR 提示词', icon: BookOpen, desc: '整题与分区的大模型 Prompt' },
    { id: 'rules' as const, label: '切题规则', icon: Scissors, desc: 'PDF 切题引擎的标记词与章节识别规则' },
  ]

  return (
    <section className="space-y-6 max-w-6xl mx-auto">
      <PageTitle
        title="系统设置"
        desc="配置系统名称、网站信息、导出水印以及 OCR runner 参数。密钥留空时保留现有值。"
        path="/settings"
      />

      {loading && !data ? (
        <Empty text="读取设置中..." />
      ) : error ? (
        <Empty text={error} />
      ) : (
        <div className="flex flex-col md:flex-row gap-6 items-start">
          {/* Left Navigation Sidebar */}
          <div className="w-full md:w-64 shrink-0 flex flex-col gap-2 bg-white dark:bg-zinc-900 p-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
            {tabItems.map((tab) => {
              const TabIcon = tab.icon
              const isSelected = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id)
                    setSaveStatus(null)
                  }}
                  className={`w-full flex items-start gap-3 px-3.5 py-3 rounded-xl text-left transition-all cursor-pointer border ${
                    isSelected
                      ? 'bg-zinc-950 border-zinc-950 text-white dark:bg-zinc-100 dark:border-zinc-100 dark:text-zinc-950 font-semibold shadow-sm'
                      : 'bg-transparent border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-850 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                  }`}
                >
                  <TabIcon className="size-4.5 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-sm leading-tight">{tab.label}</span>
                    <span className={`block text-[10px] mt-0.5 truncate ${
                      isSelected ? 'text-zinc-300 dark:text-zinc-500' : 'text-zinc-400 dark:text-zinc-500'
                    }`}>
                      {tab.desc}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Right Main Content Panel */}
          <div className="flex-1 w-full bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden flex flex-col">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between">
              <h3 className="font-semibold text-sm text-zinc-800 dark:text-zinc-200">
                {tabItems.find(t => t.id === activeTab)?.label}
              </h3>
              {saveStatus && saveStatus.type === 'success' && (
                <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-900/30">
                  <Check className="size-3.5" />
                  <span>{saveStatus.message}</span>
                </div>
              )}
            </div>

            <div className="p-6 space-y-6">
              {saveStatus && saveStatus.type === 'error' && (
                <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 p-3 rounded-xl border border-red-200 dark:border-red-900/30">
                  <AlertCircle className="size-4 mt-0.5 shrink-0" />
                  <span>{saveStatus.message}</span>
                </div>
              )}

              {activeTab === 'basic' && (
                <div className="space-y-6">
                  {!data?.sofficeAvailable ? (
                    <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
                      <span>未检测到 LibreOffice。DOC/DOCX 上传前需要先安装它，或在“外部工具”里填写 soffice.exe 路径。</span>
                      <Button size="sm" variant="outline" icon={AlertCircle} onClick={() => setShowLibreOfficeAlert(true)}>查看提醒</Button>
                    </div>
                  ) : null}
                  <div className="bg-zinc-50 dark:bg-zinc-800/20 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800">
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">基础设置</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed font-normal">
                      控制左上角系统名称、网页标题描述，以及几套 TeX 模板导出时使用的水印/品牌文字。
                    </p>
                  </div>
                  <div className="grid gap-4">
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">左上角系统名称</span>
                      <input
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        value={draft.systemName ?? ''}
                        onChange={(e) => setDraft({ ...draft, systemName: e.target.value })}
                        placeholder="Question Manager"
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">系统网站标题</span>
                      <input
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        value={draft.siteTitle ?? ''}
                        onChange={(e) => setDraft({ ...draft, siteTitle: e.target.value })}
                        placeholder="Question Manager"
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">系统网站描述</span>
                      <textarea
                        className="min-h-24 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm leading-6 focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        value={draft.siteDescription ?? ''}
                        onChange={(e) => setDraft({ ...draft, siteDescription: e.target.value })}
                        placeholder="本地优先的 PDF 切分、OCR 识别与数学题库工作台。"
                      />
                    </label>
                  </div>
                  <div className="space-y-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">试卷导出模板</span>
                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
                      {([
                        { value: 'builtin', label: '自带模板' },
                        { value: 'examch', label: 'Examch' },
                      ] as const).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setDraft({ ...draft, examExportTemplate: option.value })}
                          className={`h-9 rounded-lg text-sm font-medium transition-colors ${
                            (draft.examExportTemplate ?? 'builtin') === option.value
                              ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-zinc-100'
                              : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">教学学段</span>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {teachingStageOptions.map((stage) => {
                        const active = (draft.teachingStages ?? ['高中']).includes(stage)
                        return (
                          <button
                            key={stage}
                            type="button"
                            onClick={() => toggleTeachingStage(stage)}
                            className={`flex h-9 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors ${
                              active
                                ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950'
                                : 'border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400'
                            }`}
                          >
                            <span className={`flex size-4 items-center justify-center rounded border ${active ? 'border-white dark:border-zinc-950' : 'border-zinc-300 dark:border-zinc-700'}`}>
                              {active ? <Check className="size-3" /> : null}
                            </span>
                            {stage}
                          </button>
                        )
                      })}
                    </div>
                    <p className="text-[11px] leading-5 text-zinc-400">新增资料和题目时会按这里展开年级：小学为一年级至六年级，勾选其他会额外显示“其他”。</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">练习单模板水印</span>
                      <input
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        value={draft.worksheetWatermark ?? ''}
                        onChange={(e) => setDraft({ ...draft, worksheetWatermark: e.target.value })}
                        placeholder="教师姓名 · 工作室"
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">试卷模板水印</span>
                      <input
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        value={draft.examWatermark ?? ''}
                        onChange={(e) => setDraft({ ...draft, examWatermark: e.target.value })}
                        placeholder="Qrane"
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">讲义模板水印</span>
                      <input
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        value={draft.lectureWatermark ?? ''}
                        onChange={(e) => setDraft({ ...draft, lectureWatermark: e.target.value })}
                        placeholder="教师姓名 · 工作室"
                      />
                    </label>
                  </div>
                </div>
              )}

              {activeTab === 'ocr' && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">默认 OCR 提供方</span>
                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
                      {([
                        { value: 'legacy', label: '现有 OCR' },
                        { value: 'doc2x', label: 'Doc2X' },
                      ] as const).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setDraft({ ...draft, ocrProvider: option.value })}
                          className={`h-9 rounded-lg text-sm font-medium transition-colors ${
                            (draft.ocrProvider ?? 'legacy') === option.value
                              ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-zinc-100'
                              : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] leading-5 text-zinc-400">Doc2X 会整份上传 PDF，并在切题复核后按题号映射识别结果。</p>
                  </div>
                  {(draft.ocrProvider ?? 'legacy') === 'doc2x' ? (
                    <div className="grid gap-4">
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Doc2X API 地址</span>
                        <input className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700" value={draft.doc2xApiBaseUrl ?? ''} onChange={(e) => setDraft({ ...draft, doc2xApiBaseUrl: e.target.value })} placeholder="https://v2.doc2x.noedgeai.com" />
                      </label>
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Doc2X API Key</span>
                        <input className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700" placeholder={data?.doc2xApiKeyConfigured ? '已配置密钥，留空表示不修改' : '未配置密钥'} value={draft.doc2xApiKey ?? ''} onChange={(e) => setDraft({ ...draft, doc2xApiKey: e.target.value })} type="password" />
                      </label>
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Doc2X 模型</span>
                        <select className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700" value={draft.doc2xModel ?? 'v3-2026'} onChange={(e) => setDraft({ ...draft, doc2xModel: e.target.value })}>
                          <option value="v3-2026">v3-2026</option>
                          <option value="v2">v2</option>
                        </select>
                      </label>
                    </div>
                  ) : (
                  <div className="grid gap-4">
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">API 地址</span>
                      <input
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        value={draft.apiBaseUrl ?? ''}
                        onChange={(e) => setDraft({ ...draft, apiBaseUrl: e.target.value })}
                        placeholder="https://api.openai.com/v1"
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">API Key</span>
                      <input
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        placeholder={data?.apiKeyConfigured ? '已配置密钥，留空表示不修改' : '未配置密钥'}
                        value={draft.apiKey ?? ''}
                        onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                        type="password"
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">模型</span>
                      <input
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        value={draft.model ?? ''}
                        onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                        placeholder="gpt-4o"
                      />
                    </label>
                  </div>
                  )}

                  {(draft.ocrProvider ?? 'legacy') === 'legacy' ? <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Dry Run</span>
                      <select
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        value={draft.dryRun ?? 'false'}
                        onChange={(e) => setDraft({ ...draft, dryRun: e.target.value })}
                      >
                        <option value="false">false (正常调用)</option>
                        <option value="true">true (模拟调用)</option>
                      </select>
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">最大题数</span>
                      <input
                        type="number"
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        value={draft.maxItems ?? ''}
                        onChange={(e) => setDraft({ ...draft, maxItems: e.target.value })}
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">OCR 并发（1-20）</span>
                      <input
                        type="number"
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        value={draft.concurrency ?? ''}
                        onChange={(e) => setDraft({ ...draft, concurrency: e.target.value })}
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">最大重试次数</span>
                      <input
                        type="number"
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        value={draft.maxRetries ?? ''}
                        onChange={(e) => setDraft({ ...draft, maxRetries: e.target.value })}
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">重试间隔 (秒)</span>
                      <input
                        type="number"
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        value={draft.retryDelaySeconds ?? ''}
                        onChange={(e) => setDraft({ ...draft, retryDelaySeconds: e.target.value })}
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">图片最大宽度</span>
                      <input
                        type="number"
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        value={draft.imageMaxWidth ?? ''}
                        onChange={(e) => setDraft({ ...draft, imageMaxWidth: e.target.value })}
                      />
                    </label>
                  </div> : null}
                </div>
              )}

              {activeTab === 'tools' && (
                <div className="space-y-6">
                  <div className="bg-zinc-50 dark:bg-zinc-800/20 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">LibreOffice</p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed font-normal">
                          用于 DOC/DOCX 上传后的 Word 转 PDF。应用会自动查找默认安装目录，也可以手动指定 soffice.exe。
                        </p>
                      </div>
                      {data?.sofficeAvailable ? (
                        <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                          <Check className="size-3.5" />
                          已检测到
                        </span>
                      ) : (
                        <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 text-xs font-semibold text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
                          <AlertCircle className="size-3.5" />
                          未检测到
                        </span>
                      )}
                    </div>
                  </div>
                  {!data?.sofficeAvailable ? (
                    <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
                      <span>未安装 LibreOffice 时，DOC/DOCX 文件无法自动转换为 PDF。建议从官方页面下载安装。</span>
                      <a
                        href={libreOfficeDownloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-amber-900 px-2.5 text-xs font-semibold text-white hover:bg-amber-950 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100"
                      >
                        下载 LibreOffice
                        <ExternalLink className="size-3.5" />
                      </a>
                    </div>
                  ) : null}
                  <label className="space-y-1.5 block">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">soffice.exe 路径</span>
                    <input
                      className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                      value={draft.sofficePath ?? ''}
                      onChange={(e) => setDraft({ ...draft, sofficePath: e.target.value })}
                      placeholder="C:\\Program Files\\LibreOffice\\program\\soffice.exe"
                    />
                    <p className="text-[11px] leading-5 text-zinc-400">
                      默认安装通常无需填写。当前检测路径：{data?.sofficeDetectedPath || '未检测到'}
                    </p>
                  </label>
                </div>
              )}

              {activeTab === 'classification' && (
                <div className="space-y-6">
                  <div className="bg-zinc-50 dark:bg-zinc-800/20 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800">
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">题目数据分类</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed font-normal">
                      用于 OCR 完成后补充知识点、解题方法和难度标签。
                    </p>
                  </div>
                  <label className="space-y-1.5 block">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">OCR 完成后自动分类</span>
                    <select
                      className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                      value={draft.classificationEnabled ?? 'true'}
                      onChange={(e) => setDraft({ ...draft, classificationEnabled: e.target.value })}
                    >
                      <option value="true">开启</option>
                      <option value="false">关闭</option>
                    </select>
                  </label>
                  <div className="grid gap-4">
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">分类 API 地址</span>
                      <input
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        value={draft.cleanupApiBaseUrl ?? ''}
                        onChange={(e) => setDraft({ ...draft, cleanupApiBaseUrl: e.target.value })}
                        placeholder={draft.apiBaseUrl || '留空时沿用 OCR API 地址'}
                      />
                      <p className="text-[11px] leading-5 text-zinc-400">用于知识点、解题方法和难度评估；留空时沿用 OCR API 地址。</p>
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">分类 API Key</span>
                      <input
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        placeholder={data?.cleanupApiKeyConfigured ? '已配置密钥，留空表示不修改' : '留空时沿用 OCR API Key'}
                        value={draft.cleanupApiKey ?? ''}
                        onChange={(e) => setDraft({ ...draft, cleanupApiKey: e.target.value })}
                        type="password"
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">分类模型</span>
                      <input
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        value={draft.cleanupModel ?? ''}
                        onChange={(e) => setDraft({ ...draft, cleanupModel: e.target.value })}
                        placeholder={draft.model || '留空时沿用 OCR 模型'}
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">分类并发（1-20）</span>
                      <input
                        type="number"
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                        value={draft.cleanupConcurrency ?? ''}
                        onChange={(e) => setDraft({ ...draft, cleanupConcurrency: e.target.value })}
                      />
                    </label>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-semibold">分类 System Prompt</span>
                      <textarea
                        className="min-h-36 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-xs leading-5 focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700 font-mono"
                        value={draft.classificationSystemPrompt ?? ''}
                        onChange={(e) => setDraft({ ...draft, classificationSystemPrompt: e.target.value })}
                        placeholder="留空使用默认分类提示词"
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-semibold">分类 User Prompt</span>
                      <textarea
                        className="min-h-36 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-xs leading-5 focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700 font-mono"
                        value={draft.classificationUserPrompt ?? ''}
                        onChange={(e) => setDraft({ ...draft, classificationUserPrompt: e.target.value })}
                        placeholder="可使用 {payload} 插入待分类 JSON"
                      />
                    </label>
                  </div>
                </div>
              )}

              {activeTab === 'prompts' && (
                <div className="space-y-6">
                  <div className="bg-zinc-50 dark:bg-zinc-800/20 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800">
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">OCR 提示词</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed font-normal animate-none">
                      默认与原 Code 项目保持一致；填写后会覆盖 runner 实际使用的 prompt。分区 user prompt 可使用 {'{region_label}'}、{'{kind}'}、{'{image_count}'}。
                    </p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-semibold">整题 System Prompt</span>
                      <textarea
                        className="min-h-36 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-xs leading-5 focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700 font-mono"
                        value={draft.wholeSystemPrompt ?? ''}
                        onChange={(e) => setDraft({ ...draft, wholeSystemPrompt: e.target.value })}
                        placeholder="留空使用原 Code 默认提示词"
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-semibold">整题 User Prompt</span>
                      <textarea
                        className="min-h-36 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-xs leading-5 focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700 font-mono"
                        value={draft.wholeUserPrompt ?? ''}
                        onChange={(e) => setDraft({ ...draft, wholeUserPrompt: e.target.value })}
                        placeholder="留空使用原 Code 默认提示词"
                      />
                    </label>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-semibold">分区 System Prompt</span>
                      <textarea
                        className="min-h-36 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-xs leading-5 focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700 font-mono"
                        value={draft.chunkSystemPrompt ?? ''}
                        onChange={(e) => setDraft({ ...draft, chunkSystemPrompt: e.target.value })}
                        placeholder="留空使用原 Code 默认提示词"
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-semibold">分区 User Prompt</span>
                      <textarea
                        className="min-h-36 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-xs leading-5 focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700 font-mono"
                        value={draft.chunkUserPrompt ?? ''}
                        onChange={(e) => setDraft({ ...draft, chunkUserPrompt: e.target.value })}
                        placeholder="留空使用原 Code 默认提示词"
                      />
                    </label>
                  </div>
                </div>
              )}

              {activeTab === 'rules' && (
                <div className="space-y-4">
                  {/* Status header */}
                  <div className="bg-zinc-50 dark:bg-zinc-800/20 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800">
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">PDF 切题规则</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed font-normal">
                      维护 PDF 切题的题型标题、提示词和干扰词；发布后仅影响新的或重新执行的切题任务。
                      {rulesApi.data && (
                        <span className="block mt-1">当前版本：{rulesApi.data.version} {rulesApi.data.hash ? `(${rulesApi.data.hash.slice(0, 8)}...)` : ''}</span>
                      )}
                    </p>
                  </div>

                  {rulesSaveStatus && rulesSaveStatus.type === 'error' && (
                    <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 p-3 rounded-xl border border-red-200 dark:border-red-900/30">
                      <AlertCircle className="size-4 mt-0.5 shrink-0" />
                      <span>{rulesSaveStatus.message}</span>
                    </div>
                  )}

                  {rulesApi.loading ? (
                    <Empty text="加载规则中..." />
                  ) : rulesApi.error ? (
                    <div className="text-xs text-red-500">{rulesApi.error}</div>
                  ) : !rulesDraft ? (
                    <Empty text="暂无规则数据" />
                  ) : (
                    <>
                      {RULES_CATEGORIES.map((cat) => {
                        const entries = (rulesDraft as any)[cat.key] as SlicerRuleEntry[] | undefined
                        return (
                          <div key={cat.key} className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                            <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                              <div>
                                <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{cat.label}</span>
                                <p className="text-[10px] text-zinc-400 mt-0.5">{cat.desc}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => addRule(cat.key)}
                                className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                              >
                                <Plus className="size-3" />
                                添加
                              </button>
                            </div>
                            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                              {!entries || entries.length === 0 ? (
                                <div className="px-4 py-3 text-xs text-zinc-400">暂无规则</div>
                              ) : (
                                entries.map((entry, i) => (
                                  <RuleRow
                                    key={entry.id}
                                    entry={entry}
                                    index={i}
                                    onChange={(updated) => updateRule(cat.key, i, updated)}
                                    onDelete={() => deleteRule(cat.key, i)}
                                  />
                                ))
                              )}
                            </div>
                          </div>
                        )
                      })}

                      {/* Action buttons */}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button
                          variant="outline"
                          onClick={validateRulesDraft}
                          disabled={isRulesSaving}
                        >
                          校验草稿
                        </Button>
                        <Button
                          variant="outline"
                          onClick={resetRulesDraft}
                          disabled={isRulesSaving}
                        >
                          <RotateCcw className="size-3.5" />
                          恢复默认
                        </Button>
                        <Button
                          variant="outline"
                          onClick={discardRulesDraft}
                          disabled={isRulesSaving}
                        >
                          放弃修改
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Panel Footer */}
            <div className="px-6 py-4 bg-zinc-50/50 dark:bg-zinc-900/50 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-3">
              {activeTab === 'rules' ? (
                <>
                  {rulesSaveStatus && rulesSaveStatus.type === 'success' && (
                    <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-900/30">
                      <Check className="size-3.5" />
                      <span>{rulesSaveStatus.message}</span>
                    </div>
                  )}
                  <Button
                    icon={isRulesSaving ? LoaderCircle : Check}
                    onClick={saveRules}
                    disabled={isRulesSaving}
                  >
                    {isRulesSaving ? '保存中...' : '保存并发布'}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDraft(data || {})
                      setSaveStatus(null)
                    }}
                    disabled={isSaving}
                  >
                    重置修改
                  </Button>
                  <Button
                    icon={isSaving ? LoaderCircle : Check}
                    onClick={save}
                    disabled={isSaving}
                  >
                    {isSaving ? '保存中...' : '保存设置'}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {showLibreOfficeAlert && !data?.sofficeAvailable ? (
        <Modal
          title="未检测到 LibreOffice"
          desc="DOC/DOCX 转 PDF 需要本机安装 LibreOffice。"
          onClose={() => setShowLibreOfficeAlert(false)}
        >
          <div className="space-y-4 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
            <p>
              当前没有找到 LibreOffice 的 soffice.exe。PDF 文件仍可上传；DOC/DOCX 文件会被拦截，避免进入无法处理的切题队列。
            </p>
            <p>
              安装 LibreOffice 后重启应用即可自动检测。若安装在非默认目录，请在“系统设置 → 外部工具”中填写 soffice.exe 的完整路径。
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <a
                href={libreOfficeDownloadUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
              >
                下载 LibreOffice
                <ExternalLink className="size-3.5" />
              </a>
              <Button size="sm" variant="outline" onClick={() => { setActiveTab('tools'); setShowLibreOfficeAlert(false) }}>打开外部工具设置</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  )
}

// ── Rule Category Constants ──────────────────────────────────────────────

const RULES_CATEGORIES = [
  { key: 'auxiliaryMarkers', label: '辅助标记', desc: '识别到这些词时标记为辅助页面，跳过题目检测' },
  { key: 'noticeTerms', label: '注意事项', desc: '首页注意事项文字段，避免误判为题号' },
  { key: 'referenceFormulaMarkers', label: '参考公式', desc: '参考公式/数据附近抑制题号识别' },
  { key: 'trainingMarkers', label: '训练标记', desc: '正文训练区标题，重置辅助模式，不作为切片边界' },
  { key: 'nonQuestionRemainders', label: '非题剩余文字', desc: '末尾总结性文字，不当作题号' },
  { key: 'sectionMarkers', label: '章节标记', desc: '识别非标准题型标题，作为切片边界标记' },
] as const

// ── Rule Row Component ──────────────────────────────────────────────────

function RuleRow({ entry, index, onChange, onDelete }: {
  entry: SlicerRuleEntry
  index: number
  onChange: (entry: SlicerRuleEntry) => void
  onDelete: () => void
}) {
  return (
    <div className="px-4 py-2.5 flex items-center gap-3">
      <span className="text-[10px] text-zinc-400 w-6 text-right shrink-0">{index + 1}</span>
      <input
        className="flex-1 min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs"
        value={entry.term}
        onChange={(e) => onChange({ ...entry, term: e.target.value })}
        placeholder="标记词"
      />
      <select
        className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs"
        value={entry.matchMode}
        onChange={(e) => onChange({ ...entry, matchMode: e.target.value as 'contains' | 'exact' })}
      >
        <option value="contains">包含</option>
        <option value="exact">精确</option>
      </select>
      <button
        type="button"
        onClick={() => onChange({ ...entry, enabled: !entry.enabled })}
        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        title={entry.enabled ? '禁用' : '启用'}
      >
        {entry.enabled ? <ToggleRight className="size-4 text-emerald-500" /> : <ToggleLeft className="size-4" />}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="text-zinc-400 hover:text-red-500"
        title="删除"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}

export default SettingsPage

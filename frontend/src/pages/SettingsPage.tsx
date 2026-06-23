import { useEffect, useState } from 'react'
import { Check, Settings2, Tags, AlertCircle, LoaderCircle, SlidersHorizontal, Wrench, ExternalLink, Scissors, Plus, Trash2, ToggleLeft, ToggleRight, RotateCcw } from 'lucide-react'
import { pdfSlicerApi } from '@/api/pdfSlicer'
import { settingsApi } from '@/api/settings'
import { Button, Empty, PageTitle } from '@/components/ui'
import { UpdateCard } from '@/components/UpdateCard'
import { Modal } from '@/components/dialogs/Modal'
import { useAsync } from '@/hooks/useAsync'
import type { OcrSettings, SlicerRuleEntry, SlicerRulesData, SlicerRulesResponse } from '@/types'
import { teachingStageOptions } from '@/utils/stages'
import { libreOfficeDownloadUrl } from '@/utils/wordFiles'

export function SettingsPage() {
  const { data, error, loading, reload } = useAsync<OcrSettings>(() => settingsApi.getOcrSettings(), [])
  const [draft, setDraft] = useState<Partial<OcrSettings & { apiKey: string; doc2xApiKey: string; glmOcrApiKey: string; cleanupApiKey: string }>>({})
  const [activeTab, setActiveTab] = useState<'basic' | 'tools' | 'ocr' | 'classification' | 'prompts' | 'updates' | 'rules'>(() => {
    return new URLSearchParams(window.location.search).get('tab') === 'updates' ? 'updates' : 'basic'
  })
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [showLibreOfficeAlert, setShowLibreOfficeAlert] = useState(false)

  // Rules state
  const rulesApi = useAsync<SlicerRulesResponse>(() => pdfSlicerApi.getRules(), [])
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
    pdfSlicerApi.validateRules(draft).then((result) => {
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
      const saved = await pdfSlicerApi.updateRules(draft, rulesBaseVersion)
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
      const saved = await settingsApi.updateOcrSettings(draft)
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
    { id: 'ocr' as const, label: 'OCR 设置', icon: Settings2, desc: 'Doc2X、GLM-OCR API 与密钥' },
    { id: 'classification' as const, label: '数据分类', icon: Tags, desc: '完成后的知识点与难度标签' },
    { id: 'updates' as const, label: '应用更新', icon: ExternalLink, desc: '检查、下载并覆盖安装新版' },
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
        <div className="flex flex-col md:flex-row gap-6 items-stretch">
          {/* Left Navigation Sidebar */}
          <div className="w-full md:w-64 shrink-0 flex flex-col gap-2 bg-card p-3 rounded-2xl border border-border shadow-sm min-h-[640px]">
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
                      ? 'bg-primary border-primary text-primary-foreground font-semibold shadow-sm'
                      : 'bg-transparent border-transparent hover:bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <TabIcon className="size-4.5 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-sm leading-tight">{tab.label}</span>
                    <span className={`block text-[10px] mt-0.5 truncate ${
                      isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground/70'
                    }`}>
                      {tab.desc}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Right Main Content Panel */}
          <div className="flex-1 w-full bg-card rounded-2xl border border-border shadow-sm overflow-hidden flex flex-col min-h-[640px]">
            <div className="p-6 border-b border-border bg-muted/20 flex items-center justify-between">
              <h3 className="font-semibold text-sm text-foreground">
                {tabItems.find(t => t.id === activeTab)?.label}
              </h3>
              {saveStatus && saveStatus.type === 'success' && (
                <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-900/30">
                  <Check className="size-3.5" />
                  <span>{saveStatus.message}</span>
                </div>
              )}
            </div>

            <div className="p-6 space-y-6 flex-1 overflow-y-auto">
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
                  <div className="bg-muted/30 border border-border rounded-xl p-4">
                    <p className="text-sm font-semibold text-foreground">基础设置</p>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed font-normal">
                      控制左上角系统名称、网页标题描述，以及几套 TeX 模板导出时使用的水印/品牌文字。
                    </p>
                  </div>

                  <div className="border border-border rounded-xl p-5 bg-card shadow-sm space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">网站与系统名称</h4>
                    <div className="grid gap-4">
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-muted-foreground font-medium">左上角系统名称</span>
                        <input
                          className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
                          value={draft.systemName ?? ''}
                          onChange={(e) => setDraft({ ...draft, systemName: e.target.value })}
                          placeholder="Question Manager"
                        />
                      </label>
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-muted-foreground font-medium">系统网站标题</span>
                        <input
                          className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
                          value={draft.siteTitle ?? ''}
                          onChange={(e) => setDraft({ ...draft, siteTitle: e.target.value })}
                          placeholder="Question Manager"
                        />
                      </label>
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-muted-foreground font-medium">系统网站描述</span>
                        <textarea
                          className="min-h-24 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm leading-6 focus:ring-1 focus:ring-ring focus:outline-none"
                          value={draft.siteDescription ?? ''}
                          onChange={(e) => setDraft({ ...draft, siteDescription: e.target.value })}
                          placeholder="本地优先的 PDF 切分、OCR 识别与数学题库工作台。"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="border border-border rounded-xl p-5 bg-card shadow-sm space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">导出选项与教学学段</h4>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <span className="text-xs text-muted-foreground font-medium">试卷导出模板</span>
                        <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
                          {([
                            { value: 'builtin', label: '自带模板' },
                            { value: 'examch', label: 'Examch' },
                          ] as const).map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setDraft({ ...draft, examExportTemplate: option.value })}
                              className={`h-9 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                                (draft.examExportTemplate ?? 'builtin') === option.value
                                  ? 'bg-card text-foreground shadow-sm'
                                  : 'text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <span className="text-xs text-muted-foreground font-medium">教学学段</span>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {teachingStageOptions.map((stage) => {
                            const active = (draft.teachingStages ?? ['高中']).includes(stage)
                            return (
                              <button
                                key={stage}
                                type="button"
                                onClick={() => toggleTeachingStage(stage)}
                                className={`flex h-9 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${
                                  active
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : 'border-border bg-background text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                <span className={`flex size-4 items-center justify-center rounded border ${active ? 'border-primary-foreground' : 'border-border'}`}>
                                  {active ? <Check className="size-3" /> : null}
                                </span>
                                {stage}
                              </button>
                            )
                          })}
                        </div>
                        <p className="text-[11px] leading-5 text-muted-foreground">新增资料和题目时会按这里展开年级：小学为一年级至六年级，勾选其他会额外显示“其他”。</p>
                      </div>
                    </div>
                  </div>

                  <div className="border border-border rounded-xl p-5 bg-card shadow-sm space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">模板水印文字</h4>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-muted-foreground font-medium">练习单模板水印</span>
                        <input
                          className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
                          value={draft.worksheetWatermark ?? ''}
                          onChange={(e) => setDraft({ ...draft, worksheetWatermark: e.target.value })}
                          placeholder="教师姓名 · 工作室"
                        />
                      </label>
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-muted-foreground font-medium">试卷模板水印</span>
                        <input
                          className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
                          value={draft.examWatermark ?? ''}
                          onChange={(e) => setDraft({ ...draft, examWatermark: e.target.value })}
                          placeholder="Qrane"
                        />
                      </label>
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-muted-foreground font-medium">讲义模板水印</span>
                        <input
                          className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
                          value={draft.lectureWatermark ?? ''}
                          onChange={(e) => setDraft({ ...draft, lectureWatermark: e.target.value })}
                          placeholder="教师姓名 · 工作室"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'ocr' && (
                <div className="space-y-6">
                  <div className="bg-muted/30 border border-border rounded-xl p-4">
                    <p className="text-sm font-semibold text-foreground">OCR 接口设置</p>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed font-normal">
                      配置默认的 OCR 解析提供方。支持 Doc2X 批量识别与 GLM-OCR 的版面及段落解析。密钥留空时保留原有值。
                    </p>
                  </div>

                  <div className="border border-border rounded-xl p-5 bg-card shadow-sm space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">服务接口配置</h4>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <span className="text-xs text-muted-foreground font-medium">默认 OCR 提供方</span>
                        <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
                          {([
                            { value: 'doc2x', label: 'Doc2X' },
                            { value: 'glm', label: 'GLM-OCR' },
                          ] as const).map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setDraft({ ...draft, ocrProvider: option.value })}
                              className={`h-9 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                                (draft.ocrProvider === 'doc2x' || draft.ocrProvider === 'glm' ? draft.ocrProvider : 'doc2x') === option.value
                                  ? 'bg-card text-foreground shadow-sm'
                                  : 'text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                        <p className="text-[11px] leading-5 text-muted-foreground">Doc2X 整卷上传后按题号映射；GLM-OCR 会保留页级布局、题号和图像，并支持跨页题重新 OCR。</p>
                      </div>

                      {(draft.ocrProvider === 'doc2x' || (!draft.ocrProvider || draft.ocrProvider === 'legacy')) ? (
                        <div className="grid gap-4">
                          <label className="space-y-1.5 block">
                            <span className="text-xs text-muted-foreground font-medium">Doc2X API 地址</span>
                            <input className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none" value={draft.doc2xApiBaseUrl ?? ''} onChange={(e) => setDraft({ ...draft, doc2xApiBaseUrl: e.target.value })} placeholder="https://v2.doc2x.noedgeai.com" />
                          </label>
                          <label className="space-y-1.5 block">
                            <span className="text-xs text-muted-foreground font-medium">Doc2X API Key</span>
                            <input className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none" placeholder={data?.doc2xApiKeyConfigured ? '已配置密钥，留空表示不修改' : '未配置密钥'} value={draft.doc2xApiKey ?? ''} onChange={(e) => setDraft({ ...draft, doc2xApiKey: e.target.value })} type="password" />
                          </label>
                          <label className="space-y-1.5 block">
                            <span className="text-xs text-muted-foreground font-medium">Doc2X 模型</span>
                            <select className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none" value={draft.doc2xModel ?? 'v3-2026'} onChange={(e) => setDraft({ ...draft, doc2xModel: e.target.value })}>
                              <option value="v3-2026">v3-2026</option>
                              <option value="v2">v2</option>
                            </select>
                          </label>
                        </div>
                      ) : (
                        <div className="grid gap-4">
                          <label className="space-y-1.5 block">
                            <span className="text-xs text-muted-foreground font-medium">GLM-OCR API 地址</span>
                            <input
                              className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
                              value={draft.glmOcrApiBaseUrl ?? ''}
                              onChange={(e) => setDraft({ ...draft, glmOcrApiBaseUrl: e.target.value })}
                              placeholder="https://open.bigmodel.cn/api/paas/v4/layout_parsing"
                            />
                          </label>
                          <label className="space-y-1.5 block">
                            <span className="text-xs text-muted-foreground font-medium">GLM-OCR API Key</span>
                            <input
                              className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
                              placeholder={data?.glmOcrApiKeyConfigured ? '已配置密钥，留空表示不修改' : '未配置密钥'}
                              value={draft.glmOcrApiKey ?? ''}
                              onChange={(e) => setDraft({ ...draft, glmOcrApiKey: e.target.value })}
                              type="password"
                            />
                          </label>
                          <label className="space-y-1.5 block">
                            <span className="text-xs text-muted-foreground font-medium">模型</span>
                            <input
                              className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
                              value={draft.glmOcrModel ?? 'glm-ocr'}
                              onChange={(e) => setDraft({ ...draft, glmOcrModel: e.target.value })}
                              placeholder="glm-ocr"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'tools' && (
                <div className="space-y-6">
                  <div className="bg-muted/30 border border-border rounded-xl p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">外部集成工具</p>
                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed font-normal">
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
                        className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-amber-900 px-2.5 text-xs font-semibold text-white hover:bg-amber-950 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100 cursor-pointer"
                      >
                        下载 LibreOffice
                        <ExternalLink className="size-3.5" />
                      </a>
                    </div>
                  ) : null}

                  <div className="border border-border rounded-xl p-5 bg-card shadow-sm space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">执行路径配置</h4>
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-muted-foreground font-medium">soffice.exe 路径</span>
                      <input
                        className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
                        value={draft.sofficePath ?? ''}
                        onChange={(e) => setDraft({ ...draft, sofficePath: e.target.value })}
                        placeholder="C:\\Program Files\\LibreOffice\\program\\soffice.exe"
                      />
                      <p className="text-[11px] leading-5 text-muted-foreground">
                        默认安装通常无需填写。当前检测路径：{data?.sofficeDetectedPath || '未检测到'}
                      </p>
                    </label>
                  </div>
                </div>
              )}

              {activeTab === 'classification' && (
                <div className="space-y-6">
                  <div className="bg-muted/30 border border-border rounded-xl p-4">
                    <p className="text-sm font-semibold text-foreground">题目属性分类</p>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed font-normal">
                      用于 OCR 完成后自动利用大语言模型评估并分类知识点、解题方法和难度标签。
                    </p>
                  </div>

                  <div className="border border-border rounded-xl p-5 bg-card shadow-sm space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">自动分类任务设置</h4>
                    <div className="grid gap-4">
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-muted-foreground font-medium">OCR 完成后自动分类</span>
                        <select
                          className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
                          value={draft.classificationEnabled ?? 'true'}
                          onChange={(e) => setDraft({ ...draft, classificationEnabled: e.target.value })}
                        >
                          <option value="true">开启</option>
                          <option value="false">关闭</option>
                        </select>
                      </label>
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-muted-foreground font-medium">分类 API 地址</span>
                        <input
                          className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
                          value={draft.cleanupApiBaseUrl ?? ''}
                          onChange={(e) => setDraft({ ...draft, cleanupApiBaseUrl: e.target.value })}
                          placeholder={draft.apiBaseUrl || '留空时沿用 OCR API 地址'}
                        />
                        <p className="text-[11px] leading-5 text-muted-foreground">用于知识点、解题方法和难度评估；留空时沿用 OCR API 地址。</p>
                      </label>
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-muted-foreground font-medium">分类 API Key</span>
                        <input
                          className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
                          placeholder={data?.cleanupApiKeyConfigured ? '已配置密钥，留空表示不修改' : '留空时沿用 OCR API Key'}
                          value={draft.cleanupApiKey ?? ''}
                          onChange={(e) => setDraft({ ...draft, cleanupApiKey: e.target.value })}
                          type="password"
                        />
                      </label>
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-muted-foreground font-medium">分类模型</span>
                        <input
                          className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
                          value={draft.cleanupModel ?? ''}
                          onChange={(e) => setDraft({ ...draft, cleanupModel: e.target.value })}
                          placeholder={draft.model || '留空时沿用 OCR 模型'}
                        />
                      </label>
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-muted-foreground font-medium">分类并发（1-20）</span>
                        <input
                          type="number"
                          className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
                          value={draft.cleanupConcurrency ?? ''}
                          onChange={(e) => setDraft({ ...draft, cleanupConcurrency: e.target.value })}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="border border-border rounded-xl p-5 bg-card shadow-sm space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">分类提示词 (Prompt)</h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-muted-foreground font-semibold">分类 System Prompt</span>
                        <textarea
                          className="min-h-36 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-xs leading-5 focus:ring-1 focus:ring-ring focus:outline-none font-mono"
                          value={draft.classificationSystemPrompt ?? ''}
                          onChange={(e) => setDraft({ ...draft, classificationSystemPrompt: e.target.value })}
                          placeholder="留空使用默认分类提示词"
                        />
                      </label>
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-muted-foreground font-semibold">分类 User Prompt</span>
                        <textarea
                          className="min-h-36 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-xs leading-5 focus:ring-1 focus:ring-ring focus:outline-none font-mono"
                          value={draft.classificationUserPrompt ?? ''}
                          onChange={(e) => setDraft({ ...draft, classificationUserPrompt: e.target.value })}
                          placeholder="可使用 {payload} 插入待分类 JSON"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'prompts' && (
                <div className="space-y-6">
                  <div className="bg-muted/30 border border-border rounded-xl p-4">
                    <p className="text-sm font-semibold text-foreground">OCR 系统提示词</p>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed font-normal">
                      默认与原 Code 项目保持一致；填写后会覆盖 runner 实际使用的 prompt。分区 user prompt 可使用 {'{region_label}'}、{'{kind}'}、{'{image_count}'}。
                    </p>
                  </div>

                  <div className="border border-border rounded-xl p-5 bg-card shadow-sm space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">整题识别提示词 (Whole OCR Prompt)</h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-muted-foreground font-semibold">整题 System Prompt</span>
                        <textarea
                          className="min-h-36 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-xs leading-5 focus:ring-1 focus:ring-ring focus:outline-none font-mono"
                          value={draft.wholeSystemPrompt ?? ''}
                          onChange={(e) => setDraft({ ...draft, wholeSystemPrompt: e.target.value })}
                          placeholder="留空使用原 Code 默认提示词"
                        />
                      </label>
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-muted-foreground font-semibold">整题 User Prompt</span>
                        <textarea
                          className="min-h-36 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-xs leading-5 focus:ring-1 focus:ring-ring focus:outline-none font-mono"
                          value={draft.wholeUserPrompt ?? ''}
                          onChange={(e) => setDraft({ ...draft, wholeUserPrompt: e.target.value })}
                          placeholder="留空使用原 Code 默认提示词"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="border border-border rounded-xl p-5 bg-card shadow-sm space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">分区重跑提示词 (Chunk OCR Prompt)</h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-muted-foreground font-semibold">分区 System Prompt</span>
                        <textarea
                          className="min-h-36 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-xs leading-5 focus:ring-1 focus:ring-ring focus:outline-none font-mono"
                          value={draft.chunkSystemPrompt ?? ''}
                          onChange={(e) => setDraft({ ...draft, chunkSystemPrompt: e.target.value })}
                          placeholder="留空使用原 Code 默认提示词"
                        />
                      </label>
                      <label className="space-y-1.5 block">
                        <span className="text-xs text-muted-foreground font-semibold">分区 User Prompt</span>
                        <textarea
                          className="min-h-36 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-xs leading-5 focus:ring-1 focus:ring-ring focus:outline-none font-mono"
                          value={draft.chunkUserPrompt ?? ''}
                          onChange={(e) => setDraft({ ...draft, chunkUserPrompt: e.target.value })}
                          placeholder="留空使用原 Code 默认提示词"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'updates' && (
                <div className="space-y-6">
                  <UpdateCard autoCheck />
                </div>
              )}

              {activeTab === 'rules' && (
                <div className="space-y-4">
                  {/* Status header */}
                  <div className="bg-muted/30 border border-border rounded-xl p-4">
                    <p className="text-sm font-semibold text-foreground">PDF 切题规则与字典</p>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed font-normal">
                      维护 PDF 自动切题引擎所依赖的章节定位和提示干扰词。发布后仅影响新的或重新执行的切题任务。
                      {rulesApi.data && (
                        <span className="block mt-1 font-mono text-[10px] opacity-80">当前版本：{rulesApi.data.version} {rulesApi.data.hash ? `(${rulesApi.data.hash.slice(0, 8)}...)` : ''}</span>
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
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {RULES_CATEGORIES.map((cat) => {
                          const entries = (rulesDraft as any)[cat.key] as SlicerRuleEntry[] | undefined
                          return (
                            <div key={cat.key} className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden shadow-sm flex flex-col h-full">
                              <div className="px-4 py-3 bg-muted/40 border-b border-border flex items-center justify-between">
                                <div>
                                  <span className="text-sm font-semibold text-foreground">{cat.label}</span>
                                  <p className="text-[10px] text-muted-foreground mt-0.5">{cat.desc}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => addRule(cat.key)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-colors"
                                >
                                  <Plus className="size-3" />
                                  添加
                                </button>
                              </div>
                              <div className="divide-y divide-border flex-1 overflow-y-auto max-h-[300px]">
                                {!entries || entries.length === 0 ? (
                                  <div className="px-4 py-3 text-xs text-muted-foreground">暂无规则</div>
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
                      </div>

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
            <div className="px-6 py-4 bg-muted/20 border-t border-border flex justify-end gap-3 shrink-0">
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
          <div className="space-y-4 text-sm leading-6 text-zinc-600 dark:text-zinc-350">
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
      <span className="text-[10px] text-muted-foreground w-6 text-right shrink-0">{index + 1}</span>
      <input
        className="flex-1 min-w-0 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-ring focus:outline-none"
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

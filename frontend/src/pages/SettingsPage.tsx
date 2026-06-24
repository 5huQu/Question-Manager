import { useEffect, useState } from 'react'
import {
  AlertCircle,
  BookOpen,
  Check,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from 'lucide-react'
import { pdfSlicerApi } from '@/api/pdfSlicer'
import { settingsApi } from '@/api/settings'
import { importV2Api, type ImportFlowV2ParserConfig } from '@/api/importV2'
import { Button } from '@/components/ui'
import { UpdateCard } from '@/components/UpdateCard'
import { Modal } from '@/components/dialogs/Modal'
import { useAsync } from '@/hooks/useAsync'
import type { OcrSettings, SlicerRuleEntry, SlicerRulesData, SlicerRulesResponse } from '@/types'
import { teachingStageOptions } from '@/utils/stages'
import { libreOfficeDownloadUrl } from '@/utils/wordFiles'

type SettingsDraft = Partial<OcrSettings & {
  apiKey: string
  doc2xApiKey: string
  glmOcrApiKey: string
  cleanupApiKey: string
}>

export function SettingsPage() {
  const { data, error, loading, reload } = useAsync<OcrSettings>(() => settingsApi.getOcrSettings(), [])
  const [draft, setDraft] = useState<SettingsDraft>({})
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [showLibreOfficeAlert, setShowLibreOfficeAlert] = useState(false)

  const rulesApi = useAsync<SlicerRulesResponse>(() => pdfSlicerApi.getRules(), [])
  const [rulesDraft, setRulesDraft] = useState<SlicerRulesData | null>(null)
  const [rulesBaseVersion, setRulesBaseVersion] = useState<number>(0)
  const [activeRuleCategory, setActiveRuleCategory] = useState<(typeof RULES_CATEGORIES)[number]['key']>('auxiliaryMarkers')
  const [isRulesSaving, setIsRulesSaving] = useState(false)
  const [rulesSaveStatus, setRulesSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [showSlicerGuide, setShowSlicerGuide] = useState(false)
  const parserConfigApi = useAsync<{ config: ImportFlowV2ParserConfig }>(() => importV2Api.getParserConfig(), [])
  const [parserConfig, setParserConfig] = useState<ImportFlowV2ParserConfig | null>(null)
  const [isParserSaving, setIsParserSaving] = useState(false)
  const [parserSaveStatus, setParserSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    if (data) {
      setDraft(data)
      if (!data.sofficeAvailable) setShowLibreOfficeAlert(true)
    }
  }, [data])

  useEffect(() => {
    if (rulesApi.data) {
      setRulesDraft(rulesApi.data)
      setRulesBaseVersion(rulesApi.data.baseVersion)
    }
  }, [rulesApi.data])

  useEffect(() => {
    if (parserConfigApi.data?.config) setParserConfig(parserConfigApi.data.config)
  }, [parserConfigApi.data])

  function updateParserList(key: keyof Pick<ImportFlowV2ParserConfig, 'sectionHeadings' | 'documentNoteKeywords' | 'solutionSectionKeywords' | 'primaryQuestionPatterns' | 'subQuestionPatterns' | 'figureKeywords'>, value: string) {
    if (!parserConfig) return
    setParserConfig({ ...parserConfig, [key]: value.split('\n').map((item) => item.trim()).filter(Boolean) })
  }

  async function saveParserConfig() {
    if (!parserConfig) return
    setIsParserSaving(true)
    setParserSaveStatus(null)
    try {
      const saved = await importV2Api.updateParserConfig(parserConfig)
      setParserConfig(saved.config)
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
      parserConfigApi.setData(saved)
      setParserSaveStatus({ type: 'success', message: '已恢复默认导入识别规则。' })
    } catch (err) {
      setParserSaveStatus({ type: 'error', message: err instanceof Error ? err.message : '恢复默认失败' })
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

  function addRule(category: string) {
    if (!rulesDraft) return
    const entries: SlicerRuleEntry[] = [...((rulesDraft as any)[category] || [])]
    entries.push({ id: `${category}_${Date.now()}`, term: '', matchMode: 'contains', enabled: true })
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
    if (!rulesDraft) return
    pdfSlicerApi.validateRules(rulesDraft)
      .then((result) => {
        if (result.valid) {
          setRulesSaveStatus({ type: 'success', message: '规则校验通过！' })
          setTimeout(() => setRulesSaveStatus(null), 3000)
        } else {
          setRulesSaveStatus({ type: 'error', message: `校验失败：${result.errors.join('；')}` })
        }
      })
      .catch((err) => setRulesSaveStatus({ type: 'error', message: `校验请求失败：${err?.message || '未知错误'}` }))
  }

  function reloadPublishedRules() {
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
    if (!rulesDraft) return
    setIsRulesSaving(true)
    setRulesSaveStatus(null)
    try {
      const saved = await pdfSlicerApi.updateRules(rulesDraft, rulesBaseVersion)
      setRulesBaseVersion(saved.baseVersion)
      setRulesDraft(saved)
      rulesApi.setData(saved)
      setRulesSaveStatus({ type: 'success', message: '规则已保存并生效！下次切题将使用新规则。' })
      setTimeout(() => setRulesSaveStatus(null), 5000)
    } catch (err) {
      setRulesSaveStatus({ type: 'error', message: err instanceof Error ? err.message : '保存失败' })
    } finally {
      setIsRulesSaving(false)
    }
  }

  if (loading && !data) {
    return <div className="mock-page-root p-6 text-xs text-zinc-400">读取设置中...</div>
  }

  if (error) {
    return <div className="mock-page-root p-6 text-xs text-zinc-400">{error}</div>
  }

  const activeRules = rulesDraft ? ((rulesDraft as any)[activeRuleCategory] as SlicerRuleEntry[] | undefined) ?? [] : []
  const activeRuleMeta = RULES_CATEGORIES.find((item) => item.key === activeRuleCategory) ?? RULES_CATEGORIES[0]

  return (
    <div className="mock-page-root flex min-h-[calc(100vh-6rem)] select-none flex-col gap-6 overflow-y-auto bg-zinc-50/10 p-6 text-zinc-950 dark:bg-zinc-950/20 dark:text-zinc-50">
      <div className="flex flex-col gap-1 border-b border-zinc-200 pb-4 text-left dark:border-zinc-800">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">系统设置</h1>
        <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
          配置系统的基础名称、外部转换工具、OCR 识别引擎密钥、大模型分类参数以及 PDF 切题匹配词字典。
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 text-left lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <SettingsCard
            title="基础设置"
            desc="控制左上角系统名称、网页标题描述，以及几套 TeX 模板导出时使用的水印/品牌文字。"
            footer={<SaveButton label="保存基础设置" loading={isSaving} onClick={() => save('基础设置')} />}
          >
            <SectionTitle>网站与系统名称</SectionTitle>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="左上角系统名称">
                <TextInput value={draft.systemName ?? ''} onChange={(value) => setDraft({ ...draft, systemName: value })} />
              </Field>
              <Field label="系统网站标题">
                <TextInput value={draft.siteTitle ?? ''} onChange={(value) => setDraft({ ...draft, siteTitle: value })} />
              </Field>
            </div>
            <Field label="系统网站描述">
              <TextArea rows={2} value={draft.siteDescription ?? ''} onChange={(value) => setDraft({ ...draft, siteDescription: value })} />
            </Field>

            <SectionTitle className="pt-2">导出选项与教学学段</SectionTitle>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="试卷导出模板">
                <div className="flex max-w-xs gap-2">
                  {[
                    { value: 'builtin', label: '自带模板' },
                    { value: 'examch', label: 'Examch' },
                  ].map((option) => (
                    <SegmentButton
                      key={option.value}
                      active={(draft.examExportTemplate ?? 'builtin') === option.value}
                      onClick={() => setDraft({ ...draft, examExportTemplate: option.value as 'builtin' | 'examch' })}
                    >
                      {option.label}
                    </SegmentButton>
                  ))}
                </div>
              </Field>
              <Field label="教学学段">
                <div className="flex flex-wrap gap-2">
                  {teachingStageOptions.map((stage) => {
                    const active = (draft.teachingStages ?? ['高中']).includes(stage)
                    return (
                      <button
                        key={stage}
                        type="button"
                        onClick={() => toggleTeachingStage(stage)}
                        className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-semibold transition-all ${
                          active
                            ? 'border-zinc-900 bg-zinc-950 text-white shadow-sm dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950'
                            : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900'
                        }`}
                      >
                        <span className={`flex size-3 items-center justify-center rounded-sm border ${active ? 'border-white bg-transparent dark:border-zinc-950' : 'border-zinc-300'}`}>
                          {active ? <span className="size-1 rounded-sm bg-white dark:bg-zinc-950" /> : null}
                        </span>
                        {stage}
                      </button>
                    )
                  })}
                </div>
              </Field>
            </div>
            <p className="text-[11px] leading-normal text-zinc-400 dark:text-zinc-500">
              新增资料和题目时会按这里展开年级：小学为一年级至六年级，勾选其他会额外显示“其他”。
            </p>

            <SectionTitle className="pt-2">模板水印文字</SectionTitle>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="练习单模板水印">
                <TextInput value={draft.worksheetWatermark ?? ''} onChange={(value) => setDraft({ ...draft, worksheetWatermark: value })} />
              </Field>
              <Field label="试卷模板水印">
                <TextInput value={draft.examWatermark ?? ''} onChange={(value) => setDraft({ ...draft, examWatermark: value })} />
              </Field>
              <Field label="讲义模板水印">
                <TextInput value={draft.lectureWatermark ?? ''} onChange={(value) => setDraft({ ...draft, lectureWatermark: value })} />
              </Field>
            </div>
          </SettingsCard>

          <SettingsCard
            title="外部集成工具"
            desc="用于 DOC/DOCX 上传后的 Word 转 PDF。应用会自动查找默认安装目录，也可以手动指定 soffice.exe。"
            footer={<SaveButton label="保存路径设置" loading={isSaving} onClick={() => save('外部集成工具')} />}
          >
            <Field label="soffice.exe 路径">
              <TextInput mono value={draft.sofficePath ?? ''} onChange={(value) => setDraft({ ...draft, sofficePath: value })} />
              <p className="text-[11px] leading-normal text-zinc-400 dark:text-zinc-500">
                默认安装通常无需填写。当前检测路径：{data?.sofficeDetectedPath || '未检测到'}
              </p>
            </Field>
            <div className="flex items-center gap-3 pt-2">
              {data?.sofficeAvailable ? (
                <span className="inline-flex h-8 items-center gap-1.5 rounded border border-zinc-200 bg-zinc-50 px-2.5 text-xs font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                  <Check className="size-3.5" />
                  已检测到 LibreOffice 环境
                </span>
              ) : (
                <Button size="sm" variant="outline" icon={AlertCircle} onClick={() => setShowLibreOfficeAlert(true)}>查看 LibreOffice 提醒</Button>
              )}
            </div>
          </SettingsCard>

          <SettingsCard
            title="OCR 接口设置"
            desc="配置默认的 OCR 解析提供方。支持 Doc2X 批量识别与 GLM-OCR 的版面及段落解析。"
            footer={<SaveButton label="保存 OCR 配置" loading={isSaving} onClick={() => save('OCR 引擎')} />}
          >
            <Field label="默认 OCR 提供方">
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
                <SegmentButton active={(draft.ocrProvider ?? 'doc2x') === 'doc2x'} onClick={() => setDraft({ ...draft, ocrProvider: 'doc2x' })}>Doc2X API</SegmentButton>
                <SegmentButton active={draft.ocrProvider === 'glm'} onClick={() => setDraft({ ...draft, ocrProvider: 'glm' })}>GLM-OCR</SegmentButton>
              </div>
            </Field>

            {(draft.ocrProvider === 'glm') ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="GLM-OCR API 地址" className="md:col-span-2">
                  <TextInput mono value={draft.glmOcrApiBaseUrl ?? ''} onChange={(value) => setDraft({ ...draft, glmOcrApiBaseUrl: value })} />
                </Field>
                <Field label="GLM-OCR API Key">
                  <TextInput mono type="password" value={draft.glmOcrApiKey ?? ''} placeholder={data?.glmOcrApiKeyConfigured ? '已配置密钥，留空表示不修改' : '未配置密钥'} onChange={(value) => setDraft({ ...draft, glmOcrApiKey: value })} />
                </Field>
                <Field label="模型">
                  <TextInput mono value={draft.glmOcrModel ?? 'glm-ocr'} onChange={(value) => setDraft({ ...draft, glmOcrModel: value })} />
                </Field>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Doc2X API 地址" className="md:col-span-2">
                  <TextInput mono value={draft.doc2xApiBaseUrl ?? ''} onChange={(value) => setDraft({ ...draft, doc2xApiBaseUrl: value })} />
                </Field>
                <Field label="Doc2X API Key">
                  <TextInput mono type="password" value={draft.doc2xApiKey ?? ''} placeholder={data?.doc2xApiKeyConfigured ? '已配置密钥，留空表示不修改' : '未配置密钥'} onChange={(value) => setDraft({ ...draft, doc2xApiKey: value })} />
                </Field>
                <Field label="Doc2X 模型">
                  <select
                    value={draft.doc2xModel ?? 'v3-2026'}
                    onChange={(event) => setDraft({ ...draft, doc2xModel: event.target.value })}
                    className="w-full cursor-pointer rounded border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-950 dark:border-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-300"
                  >
                    <option value="v3-2026">v3-2026</option>
                    <option value="v2">v2</option>
                  </select>
                </Field>
              </div>
            )}

            <div className="space-y-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field label="并发数量">
                  <TextInput value={draft.concurrency ?? ''} onChange={(value) => setDraft({ ...draft, concurrency: value })} />
                </Field>
                <Field label="最大重试次数">
                  <TextInput value={draft.maxRetries ?? ''} onChange={(value) => setDraft({ ...draft, maxRetries: value })} />
                </Field>
                <Field label="图像最大宽度">
                  <TextInput value={draft.imageMaxWidth ?? ''} onChange={(value) => setDraft({ ...draft, imageMaxWidth: value })} />
                </Field>
              </div>
            </div>
          </SettingsCard>

          <SettingsCard
            title="导入识别规则"
            desc="用于 GLM-OCR 导入资料时识别题号、卷面栏目和答案解析区。调整后仅影响之后重新生成的待确认题目。"
            footer={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={resetParserConfig} disabled={isParserSaving}>恢复默认</Button><SaveButton label="保存规则" loading={isParserSaving} onClick={saveParserConfig} /></div>}
          >
            {parserConfigApi.loading && !parserConfig ? <p className="text-xs text-zinc-400">读取导入识别规则中...</p> : null}
            {parserConfigApi.error ? <p className="text-xs text-red-500">{parserConfigApi.error}</p> : null}
            {parserConfig ? <>
              {parserSaveStatus ? <StatusBanner status={parserSaveStatus} /> : null}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="大题标题">
                  <TextArea rows={5} value={parserConfig.sectionHeadings.join('\n')} onChange={(value) => updateParserList('sectionHeadings', value)} />
                  <p className="text-[11px] text-zinc-400">用于识别“一、选择题”“二、填空题”等卷面栏目，不会作为题目入库。</p>
                </Field>
                <Field label="说明文字">
                  <TextArea rows={5} value={parserConfig.documentNoteKeywords.join('\n')} onChange={(value) => updateParserList('documentNoteKeywords', value)} />
                  <p className="text-[11px] text-zinc-400">用于识别“注意事项”“参考公式”等非题目内容。</p>
                </Field>
                <Field label="答案解析标记">
                  <TextArea rows={5} value={parserConfig.solutionSectionKeywords.join('\n')} onChange={(value) => updateParserList('solutionSectionKeywords', value)} />
                  <p className="text-[11px] text-zinc-400">用于判断后半部分是否进入答案或解析区。</p>
                </Field>
                <Field label="图形提示词">
                  <TextArea rows={5} value={parserConfig.figureKeywords.join('\n')} onChange={(value) => updateParserList('figureKeywords', value)} />
                  <p className="text-[11px] text-zinc-400">帮助系统在题目附近优先关注可能相关的图形。</p>
                </Field>
                <Field label="一级题号规则">
                  <TextArea mono rows={4} value={parserConfig.primaryQuestionPatterns.join('\n')} onChange={(value) => updateParserList('primaryQuestionPatterns', value)} />
                  <p className="text-[11px] text-zinc-400">每行一条。用于“第 1 题”“1.”、“1、”等题号。</p>
                </Field>
                <Field label="小问编号">
                  <TextArea mono rows={4} value={parserConfig.subQuestionPatterns.join('\n')} onChange={(value) => updateParserList('subQuestionPatterns', value)} />
                  <p className="text-[11px] text-zinc-400">用于避免把“（1）（2）”误识别成新题。</p>
                </Field>
              </div>
              <Field label="括号数字作为一级题号">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300"><input type="checkbox" checked={parserConfig.allowParenthesizedNumberAsPrimary} onChange={(event) => setParserConfig({ ...parserConfig, allowParenthesizedNumberAsPrimary: event.target.checked })} />仅当资料完全没有常规题号时，才把“（1）”当作新题号</label>
              </Field>
            </> : null}
          </SettingsCard>

          <SettingsCard
            title="数据分类与自动标签"
            desc="用于 OCR 完成后自动利用大语言模型评估并分类知识点、解题方法和难度标签。"
            footer={<SaveButton label="保存分类设置" loading={isSaving} onClick={() => save('属性分类')} />}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="OCR 完成后自动分类">
                <select
                  value={draft.classificationEnabled ?? 'true'}
                  onChange={(event) => setDraft({ ...draft, classificationEnabled: event.target.value })}
                  className="w-full cursor-pointer rounded border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-950 dark:border-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-300"
                >
                  <option value="true">开启自动分类评估</option>
                  <option value="false">关闭自动分类</option>
                </select>
              </Field>
              <Field label="分类并发数量限制 (1-20)">
                <TextInput value={draft.cleanupConcurrency ?? ''} onChange={(value) => setDraft({ ...draft, cleanupConcurrency: value })} />
              </Field>
              <Field label="分类 API 服务端点 (留空默认使用 DeepSeek)" className="md:col-span-2">
                <TextInput mono value={draft.cleanupApiBaseUrl ?? ''} placeholder="https://api.deepseek.com" onChange={(value) => setDraft({ ...draft, cleanupApiBaseUrl: value })} />
              </Field>
              <Field label="分类 API 密钥">
                <TextInput mono type="password" value={draft.cleanupApiKey ?? ''} placeholder={data?.cleanupApiKeyConfigured ? '已配置密钥，留空表示不修改' : '请输入 DeepSeek API Key'} onChange={(value) => setDraft({ ...draft, cleanupApiKey: value })} />
              </Field>
              <Field label="分类大模型名称">
                <TextInput mono value={draft.cleanupModel ?? ''} placeholder="deepseek-v4-flash" onChange={(value) => setDraft({ ...draft, cleanupModel: value })} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 border-t border-zinc-100 pt-4 dark:border-zinc-800 md:grid-cols-2">
              <Field label="分类 System Prompt">
                <TextArea mono rows={4} value={draft.classificationSystemPrompt ?? ''} onChange={(value) => setDraft({ ...draft, classificationSystemPrompt: value })} />
              </Field>
              <Field label="分类 User Prompt">
                <TextArea mono rows={4} value={draft.classificationUserPrompt ?? ''} onChange={(value) => setDraft({ ...draft, classificationUserPrompt: value })} />
              </Field>
            </div>
          </SettingsCard>

          <SettingsCard
            title="PDF 切题规则与字典"
            desc="维护自动切题时用来排除目录、说明和栏目编号的词。保存后会用于新上传或重新切题的资料，已切好的历史批次不会自动变化。"
            footer={
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setShowSlicerGuide(true)} disabled={isRulesSaving} className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"><BookOpen className="size-3.5" />查看使用说明</button>
                <button type="button" onClick={validateRulesDraft} disabled={isRulesSaving} className="inline-flex items-center rounded border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">校验草稿</button>
                <button type="button" onClick={reloadPublishedRules} disabled={isRulesSaving} className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"><RotateCcw className="size-3.5" />重新读取已发布规则</button>
                <button type="button" onClick={discardRulesDraft} disabled={isRulesSaving} className="inline-flex items-center rounded border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">放弃修改</button>
                <SaveButton label={isRulesSaving ? '保存中...' : '保存切题字典'} loading={isRulesSaving} onClick={saveRules} />
              </div>
            }
          >
            {rulesApi.loading ? (
              <p className="text-xs text-zinc-400">加载规则中...</p>
            ) : rulesApi.error ? (
              <p className="text-xs text-red-500">{rulesApi.error}</p>
            ) : !rulesDraft ? (
              <p className="text-xs text-zinc-400">暂无规则数据</p>
            ) : (
              <>
                {rulesSaveStatus ? <StatusBanner status={rulesSaveStatus} /> : null}
                <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-200/50 bg-zinc-100 p-0.5 dark:border-zinc-800/50 dark:bg-zinc-900">
                  {RULES_CATEGORIES.map((category) => (
                    <button
                      key={category.key}
                      type="button"
                      onClick={() => setActiveRuleCategory(category.key)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                        activeRuleCategory === category.key
                          ? 'border border-zinc-200/20 bg-white text-zinc-900 shadow-xs dark:bg-zinc-950 dark:text-zinc-50'
                          : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                      }`}
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-900 dark:bg-zinc-900/20">
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{activeRuleMeta.label}</h4>
                    <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">{activeRuleMeta.desc}</p>
                  </div>
                  <button type="button" onClick={() => addRule(activeRuleCategory)} className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
                    <Plus className="size-3.5" />
                    新增字典词
                  </button>
                </div>
                <p className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-[11px] leading-5 text-zinc-500 dark:border-zinc-900 dark:bg-zinc-900/20 dark:text-zinc-400">
                  “包含”表示一行文字里带有该词即可命中；“精确”表示这一行文字必须和词条完全相同。拿不准时，先用“包含”，词太短容易误伤时再用“精确”。
                </p>
                <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <div className="flex border-b border-zinc-200 bg-zinc-50/70 px-4 py-2 text-[12px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40">
                    <span className="w-10 shrink-0 text-center">序号</span>
                    <span className="flex-1 px-3">匹配词条</span>
                    <span className="w-24 px-3 text-center">匹配模式</span>
                    <span className="w-16 text-center">状态</span>
                    <span className="w-10 text-center">删除</span>
                  </div>
                  <div className="max-h-[300px] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-900">
                    {activeRules.length === 0 ? (
                      <div className="p-8 text-center text-xs text-zinc-400 dark:text-zinc-500">该字典分类暂无自定义匹配词，请点击上方“新增字典词”。</div>
                    ) : (
                      activeRules.map((rule, index) => (
                        <RuleRow
                          key={rule.id}
                          entry={rule}
                          index={index}
                          onChange={(updated) => updateRule(activeRuleCategory, index, updated)}
                          onDelete={() => deleteRule(activeRuleCategory, index)}
                        />
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </SettingsCard>
        </div>

        <div className="space-y-6">
          <SettingsCard title="系统运行状态" desc="诊断本地运行环境服务及相关编译器套件路径。">
            <StatusLine label="本地服务端引擎" status="运行中" ready />
            <StatusLine label="KaTeX 数学渲染" status="正常" ready />
            <StatusLine label="Python 脚本切片 service" status="就绪" ready />
            <StatusLine label="XeLaTeX 编译器" status="就绪" ready />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5 text-left">
                <span className="block text-zinc-500 dark:text-zinc-400">LibreOffice 服务</span>
                <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">用于转换上传的 Word 格式文件</span>
              </div>
              <SmallStatus ready={Boolean(data?.sofficeAvailable)}>{data?.sofficeAvailable ? '就绪' : '未检测到'}</SmallStatus>
            </div>
          </SettingsCard>

          <SettingsCard title="应用版本更新" desc="检查最新客户端版本与开源社区发布记录。">
            <UpdateCard autoCheck />
          </SettingsCard>
        </div>
      </div>

      {saveStatus ? <Toast status={saveStatus} /> : null}

      {showSlicerGuide ? (
        <Modal
          title="PDF 自动切题词表使用说明"
          desc="词表只帮助系统判断编号是不是题目；自动切题后仍建议到复核页快速检查。"
          onClose={() => setShowSlicerGuide(false)}
          wide
        >
          <PdfSlicerGuide />
        </Modal>
      ) : null}

      {showLibreOfficeAlert && !data?.sofficeAvailable ? (
        <Modal
          title="未检测到 LibreOffice"
          desc="DOC/DOCX 转 PDF 需要本机安装 LibreOffice。"
          onClose={() => setShowLibreOfficeAlert(false)}
        >
          <div className="space-y-4 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
            <p>当前没有找到 LibreOffice 的 soffice.exe。PDF 文件仍可上传；DOC/DOCX 文件会被拦截，避免进入无法处理的切题队列。</p>
            <p>安装 LibreOffice 后重启应用即可自动检测。若安装在非默认目录，请在“系统设置”中填写 soffice.exe 的完整路径。</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <a href={libreOfficeDownloadUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white">
                下载 LibreOffice
                <ExternalLink className="size-3.5" />
              </a>
              <Button size="sm" variant="outline" onClick={() => setShowLibreOfficeAlert(false)}>知道了</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function SettingsCard({ title, desc, children, footer }: { title: string; desc: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-100 bg-zinc-50/50 p-5 dark:border-zinc-800 dark:bg-zinc-900/10">
        <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h3>
        <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">{desc}</p>
      </div>
      <div className="space-y-5 p-5">{children}</div>
      {footer ? <div className="flex justify-end border-t border-zinc-100 bg-zinc-50/50 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900/10">{footer}</div> : null}
    </div>
  )
}

function SectionTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`block border-b border-zinc-100 pb-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400 dark:border-zinc-900 ${className}`}>{children}</span>
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <span className="block text-[13px] font-medium text-zinc-500">{label}</span>
      {children}
    </label>
  )
}

function TextInput({ value, onChange, placeholder, type = 'text', mono = false }: { value: string; onChange: (value: string) => void; placeholder?: string; type?: string; mono?: boolean }) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-950 dark:border-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-300 ${mono ? 'font-mono' : ''}`}
    />
  )
}

function TextArea({ value, onChange, placeholder, rows = 3, mono = false }: { value: string; onChange: (value: string) => void; placeholder?: string; rows?: number; mono?: boolean }) {
  return (
    <textarea
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`w-full rounded border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-950 dark:border-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-300 ${mono ? 'font-mono' : ''}`}
    />
  )
}

function SegmentButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded border px-3 py-1.5 text-xs font-semibold transition-all ${
        active
          ? 'border-zinc-900 bg-zinc-950 text-white shadow-sm dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950'
          : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900'
      }`}
    >
      {children}
    </button>
  )
}

function SaveButton({ label, loading, onClick }: { label: string; loading: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-zinc-50 transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
    >
      {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
      {label}
    </button>
  )
}

function StatusLine({ label, status, ready }: { label: string; status: string; ready: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-100 pb-2 text-[13px] dark:border-zinc-900">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <SmallStatus ready={ready}>{status}</SmallStatus>
    </div>
  )
}

function SmallStatus({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${ready ? 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300' : 'border-red-250 bg-red-50 text-red-750 dark:border-red-900/50 dark:bg-red-955/20 dark:text-red-400'}`}>
      {children}
    </span>
  )
}

function StatusBanner({ status }: { status: { type: 'success' | 'error'; message: string } }) {
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${status.type === 'success' ? 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300'}`}>
      {status.message}
    </div>
  )
}

function Toast({ status }: { status: { type: 'success' | 'error'; message: string } }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-md border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-zinc-50 shadow-lg animate-fade-in dark:border-zinc-200 dark:bg-zinc-50 dark:text-zinc-950">
      {status.type === 'success' ? <CheckCircle2 className="size-4.5 shrink-0 text-zinc-400" /> : <AlertCircle className="size-4.5 shrink-0 text-red-500" />}
      <div className="space-y-0.5 text-left">
        <span className="block font-bold">{status.type === 'success' ? '配置保存成功' : '配置保存失败'}</span>
        <span className="block text-[10px] text-zinc-400 dark:text-zinc-500">{status.message}</span>
      </div>
    </div>
  )
}

function RuleRow({ entry, index, onChange, onDelete }: {
  entry: SlicerRuleEntry
  index: number
  onChange: (entry: SlicerRuleEntry) => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center px-4 py-2 hover:bg-zinc-50/40 dark:hover:bg-zinc-900/10">
      <span className="w-10 shrink-0 text-center font-mono text-[11px] text-zinc-400">{index + 1}</span>
      <div className="flex-1 px-3">
        <input
          type="text"
          value={entry.term}
          onChange={(event) => onChange({ ...entry, term: event.target.value })}
          placeholder="请输入标记词（例如：注意事项）"
          className="w-full rounded border border-zinc-200 bg-white px-2.5 py-1 text-xs font-normal text-zinc-900 outline-none focus:border-zinc-950 dark:border-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-300"
        />
      </div>
      <div className="flex w-24 shrink-0 justify-center px-3">
        <select
          value={entry.matchMode}
          onChange={(event) => onChange({ ...entry, matchMode: event.target.value as 'contains' | 'exact' })}
          className="cursor-pointer rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs outline-none dark:border-zinc-800"
        >
          <option value="contains">包含</option>
          <option value="exact">精确</option>
        </select>
      </div>
      <div className="flex w-16 shrink-0 justify-center">
        <button type="button" onClick={() => onChange({ ...entry, enabled: !entry.enabled })} className="p-1 text-zinc-400 transition-colors hover:text-zinc-600">
          {entry.enabled ? <ToggleRight className="size-4.5 text-zinc-700 dark:text-zinc-300" /> : <ToggleLeft className="size-4.5 text-zinc-300 dark:text-zinc-700" />}
        </button>
      </div>
      <div className="flex w-10 shrink-0 justify-center">
        <button type="button" onClick={onDelete} className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20">
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

const RULES_CATEGORIES = [
  { key: 'auxiliaryMarkers', label: '辅助区标记', desc: '遇到目录、归纳等非做题区时，暂停识别同页后续题号。' },
  { key: 'noticeTerms', label: '考试说明词', desc: '跳过试卷开头的答题说明，避免说明中的编号被当成题号。' },
  { key: 'referenceFormulaMarkers', label: '参考资料标记', desc: '跳过公式表、关系式表和数据表附近的普通数字编号。' },
  { key: 'trainingMarkers', label: '训练恢复标记', desc: '表示目录或总结结束，之后可以继续识别正式题号。' },
  { key: 'nonQuestionRemainders', label: '编号栏目标题', desc: '跳过“1. 方法总结”这类有编号但不是题的小标题。' },
  { key: 'sectionMarkers', label: '跨页截断标记', desc: '题目跨页时，遇到新栏目标题就在标题前结束上一题的裁图。' },
] as const

function PdfSlicerGuide() {
  const sections = [
    {
      title: '辅助区标记：目录和总结不是题目',
      body: '填写“目录、题型归纳、思维导图、方法技巧”等栏目标题。系统看到它们后，会暂时不把同页后面的编号当作题目；遇到正式题型标题或训练标题后，再恢复识别。适合补充“考点精练、专题突破”等词。',
    },
    {
      title: '考试说明词：跳过开头的答题要求',
      body: '填写“注意事项、答题、作答、考试结束”等词。它们用来防止“1. 请填写姓名”被误切成第 1 题，不会删除 PDF 里的文字。',
    },
    {
      title: '参考资料标记：公式表和数据表不是题目',
      body: '填写“参考公式、参考关系式、参考数据”等词。系统会避开这些标题附近的“1.”、“2.”等数字编号，减少把表格条目当题目的情况。',
    },
    {
      title: '训练恢复标记：从目录回到正式练习',
      body: '填写“【典例训练】、【例题】、一、选择题、二、填空题”等标题。它们本身不会切出题目，只是告诉系统下一行开始可以继续寻找题号。',
    },
    {
      title: '编号栏目标题：有编号也可能不是题',
      body: '填写“方法总结、规律总结、常见类型”等词。它专门处理“1. 方法总结”这样的栏目名；匹配的是题号后面的文字。',
    },
    {
      title: '跨页截断标记：别让上一题吃进下一章',
      body: '填写可能出现在新页顶部的栏目标题，例如“题型归纳、目录、【典例训练】”。它只在题目跨页时起作用：从这个标题前结束上一题，不会单独创建题目。',
    },
  ]

  return (
    <div className="mx-auto max-w-4xl space-y-5 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-blue-950 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-100">
        <p className="font-semibold">这项设置是做什么的？</p>
        <p className="mt-1 text-[13px]">系统先在 PDF 的可复制文字里寻找题号，再按题号位置切图。词表只负责告诉系统：哪些编号属于目录、说明或栏目，不应该当作题目。</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border p-4">
          <h4 className="font-semibold text-zinc-900 dark:text-zinc-50">包含匹配</h4>
          <p className="mt-1 text-[13px]">一行文字中带有这个词就算命中。大多数情况选它即可。</p>
        </div>
        <div className="rounded-xl border p-4">
          <h4 className="font-semibold text-zinc-900 dark:text-zinc-50">精确匹配</h4>
          <p className="mt-1 text-[13px]">一行文字必须和词条完全相同才算命中。短词容易误伤正常题目时，选它更稳妥。</p>
        </div>
      </div>

      <div className="space-y-3">
        {sections.map((section) => (
          <section key={section.title} className="rounded-xl border p-4">
            <h4 className="font-semibold text-zinc-900 dark:text-zinc-50">{section.title}</h4>
            <p className="mt-1 text-[13px]">{section.body}</p>
          </section>
        ))}
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
        <p className="font-semibold">使用小建议</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-[13px]">
          <li>一次只加一两个词，再用一份容易误切的资料重新切题验证。</li>
          <li>词尽量具体，例如用“专题突破”，不要只填“专题”。</li>
          <li>修改后只影响新上传或重新切题的资料；已有切题结果不会自动改动。</li>
          <li>扫描件或整页图片 PDF 没有可用文字层，会转为人工框选，不使用这套词表。</li>
        </ol>
      </div>
    </div>
  )
}

export default SettingsPage

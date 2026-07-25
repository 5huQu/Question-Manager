import {
  AlertCircle,
  Check,
  ExternalLink,
  Plus,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui'
import { UpdateCard } from '@/components/UpdateCard'
import { Modal } from '@/components/dialogs/Modal'
import type { AnswerTablePolicy, MetadataBlockPolicy, SolutionBindingStrategy } from '@/api/importV2'
import { teachingStageOptions } from '@/utils/stages'
import { libreOfficeDownloadUrl } from '@/utils/wordFiles'
import {
  Field,
  ParserRuleRow,
  SaveButton,
  SegmentButton,
  SettingsCard,
  SectionTitle,
  SmallStatus,
  StatusBanner,
  StatusLine,
  TextArea,
  TextInput,
  Toast,
} from './components'
import { PARSER_RULE_CATEGORIES } from './types'
import { useSettingsState } from './useSettingsState'

export function SettingsPage() {
  const {
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
    parserConfig,
    setParserConfig,
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
  } = useSettingsState()

  if (loading && !data) {
    return <div className="mock-page-root p-6 text-xs text-zinc-400">读取设置中...</div>
  }

  if (error) {
    return <div className="mock-page-root p-6 text-xs text-zinc-400">{error}</div>
  }

  const activeParserRuleMeta = PARSER_RULE_CATEGORIES.find((item) => item.key === activeParserRuleKey) ?? PARSER_RULE_CATEGORIES[0]
  const activeParserRules = parserListValues(activeParserRuleKey)

  return (
    <div className="mock-page-root flex min-h-[calc(100vh-6rem)] select-none flex-col gap-6 overflow-y-auto bg-zinc-50/10 p-6 text-zinc-950 dark:bg-zinc-950/20 dark:text-zinc-50">
      <div className="flex flex-col gap-1 border-b border-zinc-200 pb-4 text-left dark:border-zinc-800">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">系统设置</h1>
        <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
          配置系统的基础名称、外部转换工具、OCR 识别引擎密钥、V2 导入识别规则以及 AI 助手模型参数。
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

          </SettingsCard>

          <SettingsCard
            title="导入识别规则"
            desc="用于 GLM-OCR 导入资料时识别题号、卷面栏目和答案解析区。调整后仅影响之后重新生成的待确认题目。"
            footer={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={resetParserConfig} disabled={isParserSaving}>恢复默认</Button><SaveButton label="保存规则" loading={isParserSaving} onClick={saveParserConfig} /></div>}
          >
            {parserConfigApi.status === 'loading' && !parserConfig ? <p className="text-xs text-zinc-400">读取导入识别规则中...</p> : null}
            {parserConfigApi.error ? <p className="text-xs text-red-500">{parserConfigApi.error.message}</p> : null}
            {parserConfig ? <>
              {parserSaveStatus ? <StatusBanner status={parserSaveStatus} /> : null}
              <div className="rounded-xl border border-zinc-200 bg-zinc-50/40 p-3 dark:border-zinc-800 dark:bg-zinc-900/20">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-end">
                  <Field label="规则预设">
                    <select
                      value={selectedParserPresetId}
                      onChange={(event) => setSelectedParserPresetId(event.target.value)}
                      className="w-full cursor-pointer rounded border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                    >
                      {parserPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}{preset.builtIn ? '（内置）' : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Button size="sm" variant="outline" onClick={applyParserPreset} disabled={isParserSaving || !selectedParserPresetId}>应用预设</Button>
                  <Button size="sm" variant="outline" onClick={saveCurrentParserPreset} disabled={isParserSaving}>保存为预设</Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={Trash2}
                    onClick={deleteSelectedParserPreset}
                    disabled={isParserSaving || Boolean(parserPresets.find((item) => item.id === selectedParserPresetId)?.builtIn)}
                  >
                    删除预设
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field label="答案绑定策略">
                  <select
                    value={parserConfig.solutionBindingStrategy}
                    onChange={(event) => setParserConfig({ ...parserConfig, solutionBindingStrategy: event.target.value as SolutionBindingStrategy })}
                    className="w-full cursor-pointer rounded border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                  >
                    <option value="heading_then_question">题号在参考答案后</option>
                    <option value="question_then_heading">题号在参考答案前</option>
                    <option value="auto">自动推荐</option>
                  </select>
                </Field>
                <Field label="说明块策略">
                  <select
                    value={parserConfig.metadataBlockPolicy}
                    onChange={(event) => setParserConfig({ ...parserConfig, metadataBlockPolicy: event.target.value as MetadataBlockPolicy })}
                    className="w-full cursor-pointer rounded border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                  >
                    <option value="ignore">不进入答案/解析</option>
                    <option value="append_to_analysis">追加到解析</option>
                    <option value="store_as_note">存为备注</option>
                  </select>
                </Field>
                <Field label="答案表策略">
                  <select
                    value={parserConfig.answerTablePolicy}
                    onChange={(event) => setParserConfig({ ...parserConfig, answerTablePolicy: event.target.value as AnswerTablePolicy })}
                    className="w-full cursor-pointer rounded border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                  >
                    <option value="disabled">关闭答案表检测</option>
                    <option value="fill_empty_only">只填空缺</option>
                    <option value="override_metadata_like_answer">覆盖说明块答案</option>
                    <option value="prefer_table_for_choice_questions">小题优先答案表</option>
                  </select>
                </Field>
              </div>
              <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-200/50 bg-zinc-100 p-0.5 dark:border-zinc-800/50 dark:bg-zinc-900">
                {PARSER_RULE_CATEGORIES.map((category) => (
                  <button
                    key={category.key}
                    type="button"
                    onClick={() => setActiveParserRuleKey(category.key)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                      activeParserRuleKey === category.key
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
                  <h4 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{activeParserRuleMeta.label}</h4>
                  <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">{activeParserRuleMeta.desc}</p>
                </div>
                <button type="button" onClick={() => addParserRule(activeParserRuleKey)} className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
                  <Plus className="size-3.5" />
                  新增规则
                </button>
              </div>
              <p className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-[11px] leading-5 text-zinc-500 dark:border-zinc-900 dark:bg-zinc-900/20 dark:text-zinc-400">
                普通词条按文本包含关系识别；一级题号规则和小问编号支持正则表达式。保存后只影响之后重新生成的待确认题目。
              </p>
              <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                <div className="flex border-b border-zinc-200 bg-zinc-50/70 px-4 py-2 text-[12px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40">
                  <span className="w-10 shrink-0 text-center">序号</span>
                  <span className="flex-1 px-3">识别规则</span>
                  <span className="w-10 text-center">删除</span>
                </div>
                <div className="max-h-[340px] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-900">
                  {activeParserRules.length === 0 ? (
                    <div className="p-8 text-center text-xs text-zinc-400 dark:text-zinc-500">该分类暂无规则，请点击上方“新增规则”。</div>
                  ) : (
                    activeParserRules.map((value, index) => (
                      <ParserRuleRow
                        key={`${activeParserRuleKey}-${index}`}
                        value={value}
                        index={index}
                        mono={activeParserRuleMeta.mono}
                        placeholder={activeParserRuleMeta.placeholder}
                        onChange={(next) => updateParserRule(activeParserRuleKey, index, next)}
                        onDelete={() => deleteParserRule(activeParserRuleKey, index)}
                      />
                    ))
                  )}
                </div>
              </div>
              <Field label="括号数字作为一级题号">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300"><input type="checkbox" checked={parserConfig.allowParenthesizedNumberAsPrimary} onChange={(event) => setParserConfig({ ...parserConfig, allowParenthesizedNumberAsPrimary: event.target.checked })} />仅当资料完全没有常规题号时，才把“（1）”当作新题号</label>
              </Field>
            </> : null}
          </SettingsCard>

          <SettingsCard
            title="AI 助手与自动标签"
            desc="用于单题 AI 清洗、格式修复、评分拆分，以及题目批次自动标签和难度评估。"
            footer={<SaveButton label="保存 AI 助手设置" loading={isSaving} onClick={() => save('AI 助手')} />}
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
              <Field label="AI 助手并发数量限制 (1-20)">
                <TextInput value={draft.cleanupConcurrency ?? ''} onChange={(value) => setDraft({ ...draft, cleanupConcurrency: value })} />
              </Field>
              <Field label="AI 助手 API 服务端点 (留空默认使用 DeepSeek)" className="md:col-span-2">
                <TextInput mono value={draft.cleanupApiBaseUrl ?? ''} placeholder="https://api.deepseek.com" onChange={(value) => setDraft({ ...draft, cleanupApiBaseUrl: value })} />
              </Field>
              <Field label="AI 助手 API 密钥">
                <TextInput mono type="password" value={draft.cleanupApiKey ?? ''} placeholder={data?.cleanupApiKeyConfigured ? '已配置密钥，留空表示不修改' : '请输入 DeepSeek API Key'} onChange={(value) => setDraft({ ...draft, cleanupApiKey: value })} />
              </Field>
              <Field label="AI 助手模型名称">
                <TextInput mono value={draft.cleanupModel ?? ''} placeholder="deepseek-v4-flash" onChange={(value) => setDraft({ ...draft, cleanupModel: value })} />
              </Field>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[12px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300">
              这组模型配置会被单题 AI 清洗和自动分类共同使用。单题清洗 Prompt 用于“AI 清洗”按钮；分类 Prompt 用于批次自动标签。
            </div>
            <SectionTitle className="pt-2">单题 AI 清洗 Prompt</SectionTitle>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="单题清洗 System Prompt">
                <TextArea
                  mono
                  rows={8}
                  value={draft.assistantCleanSystemPrompt ?? ''}
                  placeholder="定义单题清洗助手的角色、安全边界和输出格式。"
                  onChange={(value) => setDraft({ ...draft, assistantCleanSystemPrompt: value })}
                />
                <p className="text-[11px] text-zinc-400">建议保留“不解题、不补写、不改题意、只输出 JSON”的约束。</p>
              </Field>
              <Field label="单题清洗 User Prompt">
                <TextArea
                  mono
                  rows={8}
                  value={draft.assistantCleanUserPrompt ?? ''}
                  placeholder="必须保留 {payload}，系统会替换为当前题目 JSON。"
                  onChange={(value) => setDraft({ ...draft, assistantCleanUserPrompt: value })}
                />
                <p className="text-[11px] text-zinc-400">可使用 `{'{payload}'}` 插入当前题目、模式和输出 schema；若遗漏，系统会自动追加在末尾。</p>
              </Field>
            </div>
            <SectionTitle className="pt-2">自动分类 Prompt</SectionTitle>
            <div className="grid grid-cols-1 gap-4 border-t border-zinc-100 pt-4 dark:border-zinc-800 md:grid-cols-2">
              <Field label="分类 System Prompt 基础模板">
                <TextArea
                  mono
                  rows={4}
                  value={draft.classificationSystemPrompt ?? ''}
                  placeholder="例如：你是题库分类工具。运行时会自动追加批次上下文和输出要求。"
                  onChange={(value) => setDraft({ ...draft, classificationSystemPrompt: value })}
                />
                <p className="text-[11px] text-zinc-400">这里建议只写角色定位；学段、科目、资料类型、输出字段等由系统自动追加。</p>
              </Field>
              <Field label="分类 User Prompt 基础模板">
                <TextArea
                  mono
                  rows={4}
                  value={draft.classificationUserPrompt ?? ''}
                  placeholder="可使用 {payload} 插入待分类 JSON；payload 内包含 classification_context。"
                  onChange={(value) => setDraft({ ...draft, classificationUserPrompt: value })}
                />
                <p className="text-[11px] text-zinc-400">`classification_context` 会随每道题一起传给模型，用于自动选择分类语境。</p>
              </Field>
            </div>
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

export default SettingsPage

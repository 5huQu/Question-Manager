import { useEffect, useState } from 'react'
import { Check, Settings2, Tags } from 'lucide-react'
import { settingsApi } from '@/api/settings'
import { Modal } from '@/components/dialogs/Modal'
import { Button, Empty, SelectFilter } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { OcrSettings } from '@/types'

export function OcrSettingsDialog({ onClose }: { onClose: () => void }) {
  const { data, error, loading, reload } = useAsync<OcrSettings>(() => settingsApi.getOcrSettings(), [])
  const [draft, setDraft] = useState<Partial<OcrSettings & { apiKey: string; doc2xApiKey: string; glmOcrApiKey: string; cleanupApiKey: string }>>({})
  const [activeTab, setActiveTab] = useState<'ocr' | 'classification' | 'prompts'>('ocr')
  useEffect(() => {
    if (data) setDraft(data)
  }, [data])
  async function save() {
    await settingsApi.updateOcrSettings(draft)
    reload()
  }
  return (
    <Modal title="系统设置" desc="配置 Doc2X、GLM-OCR 与题目数据分类。密钥留空时保留现有值。" onClose={onClose} locked={true}>
      {loading ? <Empty text="读取中..." /> : error ? <Empty text={error} /> : (
        <div className="flex flex-col h-full min-h-0">
          {/* Tab Headers */}
          <div className="flex border-b border-zinc-200 dark:border-zinc-800 mb-4 flex-none">
            <button
              type="button"
              onClick={() => setActiveTab('ocr')}
              className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-sm font-semibold transition-colors focus:outline-none -mb-px cursor-pointer ${
                activeTab === 'ocr'
                  ? 'border-zinc-950 dark:border-zinc-200 text-zinc-950 dark:text-zinc-50'
                  : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <Settings2 className="size-4" />
              <span>OCR 设置</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('classification')}
              className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-sm font-semibold transition-colors focus:outline-none -mb-px cursor-pointer ${
                activeTab === 'classification'
                  ? 'border-zinc-950 dark:border-zinc-200 text-zinc-950 dark:text-zinc-50'
                  : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <Tags className="size-4" />
              <span>数据分类</span>
            </button>
          </div>

          {/* Tab Contents (Scrollable) */}
          <div className="flex-1 overflow-y-auto min-h-0 pr-1 space-y-4 pb-4">
            {activeTab === 'ocr' && (
              <div className="space-y-4">
                <label className="space-y-1 block">
                  <span className="text-xs text-zinc-500 font-medium">默认 OCR 提供方</span>
                  <select className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.ocrProvider === 'glm' ? 'glm' : 'doc2x'} onChange={(e) => setDraft({ ...draft, ocrProvider: e.target.value as 'doc2x' | 'glm' })}>
                    <option value="doc2x">Doc2X</option>
                    <option value="glm">GLM-OCR</option>
                  </select>
                </label>
                {(draft.ocrProvider ?? 'doc2x') === 'doc2x' ? (
                  <div className="grid gap-3">
                    <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">Doc2X API 地址</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.doc2xApiBaseUrl ?? ''} onChange={(e) => setDraft({ ...draft, doc2xApiBaseUrl: e.target.value })} placeholder="https://v2.doc2x.noedgeai.com" /></label>
                    <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">Doc2X API Key</span><input className="w-full rounded-xl border px-3 py-2 text-sm" placeholder={data?.doc2xApiKeyConfigured ? '已配置，留空不修改' : '未配置'} value={draft.doc2xApiKey ?? ''} onChange={(e) => setDraft({ ...draft, doc2xApiKey: e.target.value })} type="password" /></label>
                    <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">Doc2X 模型</span><select className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.doc2xModel ?? 'v3-2026'} onChange={(e) => setDraft({ ...draft, doc2xModel: e.target.value })}><option value="v3-2026">v3-2026</option><option value="v2">v2</option></select></label>
                    <p className="text-xs leading-5 text-zinc-500">Doc2X 首版支持整批识别与完全重跑，暂不支持单题重新 OCR。</p>
                  </div>
                ) : (
                <div className="grid gap-3">
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">GLM-OCR API 地址</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.glmOcrApiBaseUrl ?? ''} onChange={(e) => setDraft({ ...draft, glmOcrApiBaseUrl: e.target.value })} placeholder="https://open.bigmodel.cn/api/paas/v4/layout_parsing" /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">GLM-OCR API Key</span><input className="w-full rounded-xl border px-3 py-2 text-sm" placeholder={data?.glmOcrApiKeyConfigured ? '已配置，留空不修改' : '未配置'} value={draft.glmOcrApiKey ?? ''} onChange={(e) => setDraft({ ...draft, glmOcrApiKey: e.target.value })} type="password" /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">模型</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.glmOcrModel ?? 'glm-ocr'} onChange={(e) => setDraft({ ...draft, glmOcrModel: e.target.value })} /></label>
                </div>
                )}
                {false ? <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">Dry Run</span><select className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.dryRun ?? 'false'} onChange={(e) => setDraft({ ...draft, dryRun: e.target.value })}><option value="false">false</option><option value="true">true</option></select></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">最大题数</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.maxItems ?? ''} onChange={(e) => setDraft({ ...draft, maxItems: e.target.value })} /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">OCR 并发（1-20）</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.concurrency ?? ''} onChange={(e) => setDraft({ ...draft, concurrency: e.target.value })} /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">最大重试</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.maxRetries ?? ''} onChange={(e) => setDraft({ ...draft, maxRetries: e.target.value })} /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">重试间隔秒</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.retryDelaySeconds ?? ''} onChange={(e) => setDraft({ ...draft, retryDelaySeconds: e.target.value })} /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">图片最大宽度</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.imageMaxWidth ?? ''} onChange={(e) => setDraft({ ...draft, imageMaxWidth: e.target.value })} /></label>
                </div> : null}
              </div>
            )}

            {activeTab === 'classification' && (
              <div className="space-y-4">
                <div className="bg-zinc-50 dark:bg-zinc-800/40 rounded-xl p-3 border border-zinc-200 dark:border-zinc-700/20">
                  <p className="text-sm font-semibold">题目数据分类</p>
                  <p className="mt-1 text-xs text-zinc-500 leading-relaxed">用于题目批次分类服务补充知识点、解题方法和难度标签。Prompt 是全局基础模板，运行时会自动追加批次上下文。</p>
                </div>
                <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">OCR 完成后自动分类</span><select className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.classificationEnabled ?? 'true'} onChange={(e) => setDraft({ ...draft, classificationEnabled: e.target.value })}><option value="true">开启</option><option value="false">关闭</option></select></label>
                <div className="grid gap-3">
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">分类 API 地址</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.cleanupApiBaseUrl ?? ''} onChange={(e) => setDraft({ ...draft, cleanupApiBaseUrl: e.target.value })} placeholder="留空时沿用 OCR API 地址" /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">分类 API Key</span><input className="w-full rounded-xl border px-3 py-2 text-sm" placeholder={data?.cleanupApiKeyConfigured ? '已配置，留空不修改' : '留空时沿用 OCR API Key'} value={draft.cleanupApiKey ?? ''} onChange={(e) => setDraft({ ...draft, cleanupApiKey: e.target.value })} type="password" /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">分类模型</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.cleanupModel ?? ''} onChange={(e) => setDraft({ ...draft, cleanupModel: e.target.value })} placeholder="留空时沿用 OCR 模型" /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">分类并发（1-20）</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.cleanupConcurrency ?? ''} onChange={(e) => setDraft({ ...draft, cleanupConcurrency: e.target.value })} type="number" /></label>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-500 dark:border-zinc-700/40 dark:bg-zinc-800/40">
                  自动上下文包含学段、科目、资料类型、年份、地区、来源机构和试卷标题；题目自身元数据会优先覆盖批次默认值。
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">分类 System Prompt 基础模板</span><textarea className="min-h-28 w-full rounded-xl border px-3 py-2 text-xs leading-5" value={draft.classificationSystemPrompt ?? ''} onChange={(e) => setDraft({ ...draft, classificationSystemPrompt: e.target.value })} placeholder="例如：你是题库分类工具。运行时会自动追加批次上下文和输出要求。" /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">分类 User Prompt 基础模板</span><textarea className="min-h-28 w-full rounded-xl border px-3 py-2 text-xs leading-5" value={draft.classificationUserPrompt ?? ''} onChange={(e) => setDraft({ ...draft, classificationUserPrompt: e.target.value })} placeholder="可使用 {payload} 插入待分类 JSON；payload 内包含 classification_context。" /></label>
                </div>
              </div>
            )}

            {activeTab === 'prompts' && (
              <div className="space-y-4">
                <div className="bg-zinc-50 dark:bg-zinc-800/40 rounded-xl p-3 border border-zinc-200 dark:border-zinc-700/20">
                  <p className="text-sm font-semibold">OCR 提示词</p>
                  <p className="mt-1 text-xs text-zinc-500 leading-relaxed">默认与原 Code 项目保持一致；填写后会覆盖 runner 实际使用的 prompt。分区 user prompt 可使用 {'{region_label}'}、{'{kind}'}、{'{image_count}'}。</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">整题 System Prompt</span><textarea className="min-h-32 w-full rounded-xl border px-3 py-2 text-xs leading-5" value={draft.wholeSystemPrompt ?? ''} onChange={(e) => setDraft({ ...draft, wholeSystemPrompt: e.target.value })} placeholder="留空使用原 Code 默认提示词" /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">整题 User Prompt</span><textarea className="min-h-32 w-full rounded-xl border px-3 py-2 text-xs leading-5" value={draft.wholeUserPrompt ?? ''} onChange={(e) => setDraft({ ...draft, wholeUserPrompt: e.target.value })} placeholder="留空使用原 Code 默认提示词" /></label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">分区 System Prompt</span><textarea className="min-h-32 w-full rounded-xl border px-3 py-2 text-xs leading-5" value={draft.chunkSystemPrompt ?? ''} onChange={(e) => setDraft({ ...draft, chunkSystemPrompt: e.target.value })} placeholder="留空使用原 Code 默认提示词" /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">分区 User Prompt</span><textarea className="min-h-32 w-full rounded-xl border px-3 py-2 text-xs leading-5" value={draft.chunkUserPrompt ?? ''} onChange={(e) => setDraft({ ...draft, chunkUserPrompt: e.target.value })} placeholder="留空使用原 Code 默认提示词" /></label>
                </div>
              </div>
            )}
          </div>

          {/* Footer (Fixed) */}
          <div className="flex justify-end gap-2 border-t pt-3 flex-none mt-auto">
            <Button variant="outline" onClick={onClose}>关闭</Button>
            <Button icon={Check} onClick={save}>保存设置</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

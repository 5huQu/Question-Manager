import { useEffect, useState } from 'react'
import { BookOpen, Check, Crop, Settings2 } from 'lucide-react'
import { api, jsonHeaders } from '@/api/client'
import { Modal } from '@/components/dialogs/Modal'
import { Button, Empty, SelectFilter } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { OcrSettings } from '@/types'

export function OcrSettingsDialog({ onClose }: { onClose: () => void }) {
  const { data, error, loading, reload } = useAsync<OcrSettings>(() => api('/api/tools/pdf-slicer/ocr-settings'), [])
  const [draft, setDraft] = useState<Partial<OcrSettings & { apiKey: string; cleanupApiKey: string }>>({})
  const [activeTab, setActiveTab] = useState<'ocr' | 'cleanup' | 'prompts'>('ocr')
  useEffect(() => {
    if (data) setDraft(data)
  }, [data])
  async function save() {
    await api('/api/tools/pdf-slicer/ocr-settings', { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(draft) })
    reload()
  }
  return (
    <Modal title="OCR 管理设置" desc="配置迁入的原项目 OCR runner。密钥留空时保留现有值。" onClose={onClose} locked={true}>
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
              <span>OCR 基础设置</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('cleanup')}
              className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-sm font-semibold transition-colors focus:outline-none -mb-px cursor-pointer ${
                activeTab === 'cleanup'
                  ? 'border-zinc-950 dark:border-zinc-200 text-zinc-950 dark:text-zinc-50'
                  : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <Crop className="size-4" />
              <span>格式清洗与分类</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('prompts')}
              className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-sm font-semibold transition-colors focus:outline-none -mb-px cursor-pointer ${
                activeTab === 'prompts'
                  ? 'border-zinc-950 dark:border-zinc-200 text-zinc-950 dark:text-zinc-50'
                  : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <BookOpen className="size-4" />
              <span>OCR 提示词</span>
            </button>
          </div>

          {/* Tab Contents (Scrollable) */}
          <div className="flex-1 overflow-y-auto min-h-0 pr-1 space-y-4 pb-4">
            {activeTab === 'ocr' && (
              <div className="space-y-4">
                <div className="grid gap-3">
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">API 地址</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.apiBaseUrl ?? ''} onChange={(e) => setDraft({ ...draft, apiBaseUrl: e.target.value })} /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">API Key</span><input className="w-full rounded-xl border px-3 py-2 text-sm" placeholder={data?.apiKeyConfigured ? '已配置，留空不修改' : '未配置'} value={draft.apiKey ?? ''} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} type="password" /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">模型</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.model ?? ''} onChange={(e) => setDraft({ ...draft, model: e.target.value })} /></label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">Dry Run</span><select className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.dryRun ?? 'false'} onChange={(e) => setDraft({ ...draft, dryRun: e.target.value })}><option value="false">false</option><option value="true">true</option></select></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">最大题数</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.maxItems ?? ''} onChange={(e) => setDraft({ ...draft, maxItems: e.target.value })} /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">OCR 并发（1-20）</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.concurrency ?? ''} onChange={(e) => setDraft({ ...draft, concurrency: e.target.value })} /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">最大重试</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.maxRetries ?? ''} onChange={(e) => setDraft({ ...draft, maxRetries: e.target.value })} /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">重试间隔秒</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.retryDelaySeconds ?? ''} onChange={(e) => setDraft({ ...draft, retryDelaySeconds: e.target.value })} /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">图片最大宽度</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.imageMaxWidth ?? ''} onChange={(e) => setDraft({ ...draft, imageMaxWidth: e.target.value })} /></label>
                </div>
              </div>
            )}

            {activeTab === 'cleanup' && (
              <div className="space-y-4">
                <div className="bg-zinc-50 dark:bg-zinc-800/40 rounded-xl p-3 border border-zinc-200 dark:border-zinc-700/20">
                  <p className="text-sm font-semibold">格式清洗与分类模型</p>
                  <p className="mt-1 text-xs text-zinc-500 leading-relaxed">用于脚本无法修复的大段内容、公式定界符异常、答案解析混排等批次级格式清洗。留空时默认沿用 OCR 接口。</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">清洗 API 地址</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.cleanupApiBaseUrl ?? ''} onChange={(e) => setDraft({ ...draft, cleanupApiBaseUrl: e.target.value })} /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">清洗 API Key</span><input className="w-full rounded-xl border px-3 py-2 text-sm" placeholder={data?.cleanupApiKeyConfigured ? '已配置，留空不修改' : '未配置'} value={draft.cleanupApiKey ?? ''} onChange={(e) => setDraft({ ...draft, cleanupApiKey: e.target.value })} type="password" /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">清洗模型</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.cleanupModel ?? ''} onChange={(e) => setDraft({ ...draft, cleanupModel: e.target.value })} /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">清洗并发（1-20）</span><input className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.cleanupConcurrency ?? ''} onChange={(e) => setDraft({ ...draft, cleanupConcurrency: e.target.value })} /></label>
                </div>
                <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">OCR 完成后自动分类</span><select className="w-full rounded-xl border px-3 py-2 text-sm" value={draft.classificationEnabled ?? 'true'} onChange={(e) => setDraft({ ...draft, classificationEnabled: e.target.value })}><option value="true">开启</option><option value="false">关闭</option></select></label>
                <div className="grid gap-3 sm:grid-cols-2 pt-2">
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">清洗 System Prompt</span><textarea className="min-h-28 w-full rounded-xl border px-3 py-2 text-xs leading-5" value={draft.cleanupSystemPrompt ?? ''} onChange={(e) => setDraft({ ...draft, cleanupSystemPrompt: e.target.value })} placeholder="留空使用默认清洗提示词" /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">清洗 User Prompt</span><textarea className="min-h-28 w-full rounded-xl border px-3 py-2 text-xs leading-5" value={draft.cleanupUserPrompt ?? ''} onChange={(e) => setDraft({ ...draft, cleanupUserPrompt: e.target.value })} placeholder="可使用 {payload} 插入待清洗 JSON" /></label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">分类 System Prompt</span><textarea className="min-h-28 w-full rounded-xl border px-3 py-2 text-xs leading-5" value={draft.classificationSystemPrompt ?? ''} onChange={(e) => setDraft({ ...draft, classificationSystemPrompt: e.target.value })} placeholder="留空使用默认分类提示词" /></label>
                  <label className="space-y-1 block"><span className="text-xs text-zinc-500 font-medium">分类 User Prompt</span><textarea className="min-h-28 w-full rounded-xl border px-3 py-2 text-xs leading-5" value={draft.classificationUserPrompt ?? ''} onChange={(e) => setDraft({ ...draft, classificationUserPrompt: e.target.value })} placeholder="可使用 {payload} 插入待分类 JSON" /></label>
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

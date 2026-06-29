import { AlertTriangle, CheckCircle2, Info, ListChecks, LoaderCircle } from 'lucide-react'
import type { CandidateParsePreview, ImportFlowV2ParserConfig, ParserDiagnostic, ParserPreviewResponse } from '@/api/importV2'
import { Badge, Button } from '@/components/ui'
import { parserDiagnosticLabel } from '@/utils/importDiagnostics'
import { ParserStrategyControls } from './ParserStrategyControls'

function diagnosticVariant(severity?: ParserDiagnostic['severity']) {
  if (severity === 'error') return 'danger' as const
  if (severity === 'warning') return 'warning' as const
  return 'outline' as const
}

function diagnosticIcon(severity?: ParserDiagnostic['severity']) {
  if (severity === 'warning' || severity === 'error') return AlertTriangle
  return Info
}

function previewText(value: string) {
  const text = String(value || '').trim()
  return text || '（无）'
}

type ParserDiagnosticsPanelProps = {
  preview: ParserPreviewResponse | null
  config: ImportFlowV2ParserConfig | null
  loading?: boolean
  focusQuestionNo?: string
  onConfigChange: (config: ImportFlowV2ParserConfig) => void
}

export function ParserDiagnosticsPanel({ preview, config, loading, focusQuestionNo, onConfigChange }: ParserDiagnosticsPanelProps) {
  const diagnostics = preview?.diagnostics || []
  const focusedPreview = focusQuestionNo
    ? preview?.candidatePreviews.find((item) => item.questionNo === focusQuestionNo)
    : null
  const visiblePreviews = [
    ...(focusedPreview ? [focusedPreview] : []),
    ...(preview?.candidatePreviews.filter((item) => item.questionNo !== focusedPreview?.questionNo).slice(0, 8) || []),
  ]

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="shrink-0 border-b border-zinc-200 p-3 dark:border-zinc-800">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">结构与诊断</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">试运行不会修改候选题。</p>
          </div>
          {loading ? <LoaderCircle className="size-4 animate-spin text-zinc-400" /> : null}
        </div>
        <ParserStrategyControls config={config} loading={loading} onChange={onConfigChange} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {preview?.strategyRecommendation ? (
          <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <CheckCircle2 className="size-3.5" />
              推荐：{preview.strategyRecommendation.strategy === 'question_then_heading' ? '题号在参考答案前' : '题号在参考答案后'}
            </div>
            <p className="leading-relaxed">{preview.strategyRecommendation.reason}</p>
          </div>
        ) : null}

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">诊断</h4>
            <Badge variant={diagnostics.some((item) => item.severity !== 'info') ? 'warning' : 'outline'}>
              {diagnostics.length} 条
            </Badge>
          </div>
          {diagnostics.length ? (
            <div className="space-y-2">
              {diagnostics.slice(0, 12).map((diagnostic, index) => {
                const Icon = diagnosticIcon(diagnostic.severity)
                return (
                  <div key={`${diagnostic.code}:${index}`} className="rounded-lg border border-zinc-200 p-2.5 text-xs dark:border-zinc-800">
                    <div className="mb-1 flex items-center gap-1.5">
                      <Icon className="size-3.5 text-zinc-500" />
                      <Badge variant={diagnosticVariant(diagnostic.severity)}>{parserDiagnosticLabel(diagnostic.code)}</Badge>
                      {diagnostic.questionNo ? <span className="text-[11px] text-zinc-400">第 {diagnostic.questionNo} 题</span> : null}
                    </div>
                    <p className="leading-relaxed text-zinc-600 dark:text-zinc-300">{diagnostic.message}</p>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-200 p-4 text-center text-xs text-zinc-400 dark:border-zinc-800">
              暂无诊断信息
            </div>
          )}
        </section>

        <section className="mt-4 space-y-2">
          <div className="flex items-center gap-1.5">
            <ListChecks className="size-3.5 text-zinc-400" />
            <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">候选字段摘要</h4>
          </div>
          {visiblePreviews.length ? (
            <div className="space-y-2">
              {visiblePreviews.map((item) => <CandidatePreviewCard key={item.questionNo} item={item} focused={item.questionNo === focusQuestionNo} />)}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-200 p-4 text-center text-xs text-zinc-400 dark:border-zinc-800">
              暂未生成候选摘要
            </div>
          )}
        </section>

        {preview && preview.candidatePreviews.length > visiblePreviews.length ? (
          <div className="mt-3 text-center">
            <Button size="xs" variant="outline" disabled>
              已显示前 {visiblePreviews.length} / {preview.candidatePreviews.length} 题
            </Button>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function CandidatePreviewCard({ item, focused }: { item: CandidateParsePreview; focused?: boolean }) {
  return (
    <div className={`rounded-lg border p-2.5 text-xs ${focused ? 'border-amber-300 bg-amber-50/50 dark:border-amber-800/60 dark:bg-amber-950/20' : 'border-zinc-200 dark:border-zinc-800'}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold text-zinc-900 dark:text-zinc-50">第 {item.questionNo || '？'} 题</span>
        {item.issues.length ? <Badge variant="warning">{item.issues.length} 个问题</Badge> : <Badge variant="outline">预览</Badge>}
      </div>
      <dl className="space-y-1.5 text-[11px] leading-relaxed">
        <div>
          <dt className="font-semibold text-zinc-500">答案</dt>
          <dd className="line-clamp-3 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{previewText(item.answerPreview)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-zinc-500">解析</dt>
          <dd className="line-clamp-5 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{previewText(item.analysisPreview)}</dd>
        </div>
      </dl>
    </div>
  )
}

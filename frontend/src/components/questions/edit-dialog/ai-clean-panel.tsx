import { Check } from 'lucide-react'
import type { AiCleanPreview } from '@/api/questionBank'
import { MarkdownContent } from '@/components/MarkdownContent'
import { Badge, Button } from '@/components/ui'
import type { QuestionItem } from '@/types'
import { FigureGallery, QuestionMarkdownContent } from '@/components/questions/QuestionContent'
import { figuresByUsage } from '@/utils/questionDisplay'
import { draftAnalysisText, draftAnswerText, draftProblemText } from '@/utils/jsonCleanup'

export function AiCleanPreviewPanel({
  current,
  preview,
  status,
  loading,
  onApply,
  onClose,
}: {
  current: Partial<QuestionItem>
  preview: AiCleanPreview | null
  status: string
  loading: boolean
  onApply: () => void
  onClose: () => void
}) {
  const patch = preview?.patch

  // Check if each field has changes to add highlight
  const hasStemChanged = preview ? draftProblemText(current) !== patch?.stemMarkdown : false
  const hasAnswerChanged = preview ? draftAnswerText(current) !== patch?.answerText : false
  const hasAnalysisChanged = preview ? draftAnalysisText(current) !== patch?.analysisMarkdown : false

  const renderContentOrEmpty = (content: string | undefined, type: 'stem' | 'answer' | 'analysis', figures: any[] = []) => {
    if (!content || !content.trim()) {
      return <span className="text-xs text-zinc-400 dark:text-zinc-500 italic">内容为空</span>
    }
    if (type === 'stem') {
      return <QuestionMarkdownContent className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200" content={content} figures={figures} />
    }
    return <MarkdownContent className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200" content={content} />
  }

  if (!preview) return null

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-4 border border-zinc-200 bg-zinc-50/50 p-4 rounded-xl dark:border-zinc-800 dark:bg-zinc-900/10">
      {/* 1. Header Area */}
      <div className="flex flex-none items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <span>AI 清洗预览</span>
            <Badge variant="success">已生成</Badge>
          </h4>
          {status && <p className={`mt-1 text-xs ${status.includes('失败') || status.includes('缺少') || status.includes('风险') ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500 dark:text-zinc-400'}`}>{status}</p>}
        </div>

        {/* Buttons / Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭预览
          </Button>
          <Button size="sm" disabled={loading} icon={Check} onClick={onApply}>
            应用到草稿
          </Button>
        </div>
      </div>

      {/* 2. Top Info Stats Grid */}
      <div className="flex flex-none flex-col gap-3">
        <div className="grid gap-3 grid-cols-2">
          <ScoreSummary label="置信度" value={`${Math.round(preview.confidence * 100)}%`} />
          <ScoreSummary label="渲染风险" value={preview.formatIssues.length ? `${preview.formatIssues.length} 项` : '无'} />
        </div>

        {/* Warnings Banner */}
        {preview.warnings.length ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300 flex items-start gap-2">
            <span className="font-semibold shrink-0">提示:</span>
            <span>{preview.warnings.join('；')}</span>
          </div>
        ) : null}

        {/* Format Issues Details (if any) */}
        {preview.formatIssues.length ? (
          <div className="rounded-lg border border-red-200 bg-red-50/20 px-3 py-2 text-[11px] leading-5 text-red-700 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400 flex flex-col gap-1">
            <span className="font-semibold">发现 {preview.formatIssues.length} 项渲染风险:</span>
            <ul className="list-disc pl-4 space-y-0.5">
              {preview.formatIssues.map((issue, idx) => (
                <li key={idx}>
                  {issue.field ? `[${issue.field}] ` : ''}
                  {issue.message}
                  {issue.snippet && <code className="ml-1.5 bg-red-100 dark:bg-red-950/50 px-1 rounded">{issue.snippet}</code>}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* 3. Main Scrollable Review Area */}
      <div className="flex-1 overflow-y-auto pr-2 space-y-6">

        {/* Fields Comparison */}
        <div className="space-y-6">
          {/* Stem (题干) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h5 className="text-xs font-semibold text-zinc-500 flex items-center gap-1.5">
                <span>题干</span>
                {hasStemChanged && <Badge variant="success" className="text-[10px]">已修改</Badge>}
              </h5>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 shadow-sm">
                <p className="mb-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">当前题干</p>
                <div className="overflow-x-auto">
                  {renderContentOrEmpty(draftProblemText(current), 'stem', current.figures)}
                </div>
              </div>
              <div className={`rounded-xl border p-4 bg-white dark:bg-zinc-950 shadow-sm ${hasStemChanged ? 'border-emerald-500/30 ring-1 ring-emerald-500/10 bg-emerald-50/5 dark:bg-emerald-950/5' : 'border-zinc-200 dark:border-zinc-800'}`}>
                <p className="mb-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">清洗后题干</p>
                <div className="overflow-x-auto">
                  {renderContentOrEmpty(patch?.stemMarkdown, 'stem', current.figures)}
                </div>
              </div>
            </div>
          </div>

          {/* Answer (答案) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h5 className="text-xs font-semibold text-zinc-500 flex items-center gap-1.5">
                <span>答案</span>
                {hasAnswerChanged && <Badge variant="success" className="text-[10px]">已修改</Badge>}
              </h5>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 shadow-sm">
                <p className="mb-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">当前答案</p>
                <div className="overflow-x-auto">
                  {renderContentOrEmpty(draftAnswerText(current), 'answer')}
                </div>
              </div>
              <div className={`rounded-xl border p-4 bg-white dark:bg-zinc-950 shadow-sm ${hasAnswerChanged ? 'border-emerald-500/30 ring-1 ring-emerald-500/10 bg-emerald-50/5 dark:bg-emerald-950/5' : 'border-zinc-200 dark:border-zinc-800'}`}>
                <p className="mb-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">清洗后答案</p>
                <div className="overflow-x-auto">
                  {renderContentOrEmpty(patch?.answerText, 'answer')}
                </div>
              </div>
            </div>
          </div>

          {/* Analysis (解析) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h5 className="text-xs font-semibold text-zinc-500 flex items-center gap-1.5">
                <span>解析</span>
                {hasAnalysisChanged && <Badge variant="success" className="text-[10px]">已修改</Badge>}
              </h5>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 shadow-sm">
                <p className="mb-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">当前解析</p>
                <div className="overflow-x-auto">
                  {renderContentOrEmpty(draftAnalysisText(current), 'analysis')}
                  {current.figures?.length ? <FigureGallery figures={figuresByUsage(current.figures, 'analysis')} className="mt-3" /> : null}
                </div>
              </div>
              <div className={`rounded-xl border p-4 bg-white dark:bg-zinc-950 shadow-sm ${hasAnalysisChanged ? 'border-emerald-500/30 ring-1 ring-emerald-500/10 bg-emerald-50/5 dark:bg-emerald-950/5' : 'border-zinc-200 dark:border-zinc-800'}`}>
                <p className="mb-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">清洗后解析</p>
                <div className="overflow-x-auto">
                  {renderContentOrEmpty(patch?.analysisMarkdown, 'analysis')}
                  {current.figures?.length ? <FigureGallery figures={figuresByUsage(current.figures, 'analysis')} className="mt-3" /> : null}
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

function ScoreSummary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950 shadow-sm">
      <span className="block text-[10px] font-semibold text-zinc-400">{label}</span>
      <span className="mt-0.5 block text-xs font-semibold text-zinc-800 dark:text-zinc-100">{value}</span>
    </div>
  )
}

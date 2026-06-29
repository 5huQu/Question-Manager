import type { AnswerTablePolicy, ImportFlowV2ParserConfig, SolutionBindingStrategy } from '@/api/importV2'

const strategyOptions: Array<{ value: SolutionBindingStrategy; label: string }> = [
  { value: 'heading_then_question', label: '题号在参考答案后' },
  { value: 'question_then_heading', label: '题号在参考答案前' },
  { value: 'auto', label: '自动推荐' },
]

const answerTableOptions: Array<{ value: AnswerTablePolicy; label: string }> = [
  { value: 'fill_empty_only', label: '只填空缺' },
  { value: 'override_metadata_like_answer', label: '覆盖说明块答案' },
  { value: 'prefer_table_for_choice_questions', label: '小题优先答案表' },
]

type ParserStrategyControlsProps = {
  config: ImportFlowV2ParserConfig | null
  loading?: boolean
  onChange: (config: ImportFlowV2ParserConfig) => void
}

export function ParserStrategyControls({ config, loading, onChange }: ParserStrategyControlsProps) {
  if (!config) {
    return (
      <div className="grid gap-2 text-[11px] text-zinc-400">
        <div className="h-8 rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" />
        <div className="h-8 rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" />
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      <label className="space-y-1">
        <span className="text-[10px] font-semibold text-zinc-500">解析策略</span>
        <select
          className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
          disabled={loading}
          value={config.solutionBindingStrategy}
          onChange={(event) => onChange({ ...config, solutionBindingStrategy: event.target.value as SolutionBindingStrategy })}
        >
          {strategyOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <span className="text-[10px] font-semibold text-zinc-500">答案表策略</span>
        <select
          className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
          disabled={loading}
          value={config.answerTablePolicy}
          onChange={(event) => onChange({ ...config, answerTablePolicy: event.target.value as AnswerTablePolicy })}
        >
          {answerTableOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    </div>
  )
}

import type {
  AnswerTablePolicy,
  ImportFlowV2ParserConfig,
  ImportParserPreset,
  SolutionBindingStrategy,
} from '@/api/importV2'

const strategyOptions: Array<{ value: SolutionBindingStrategy; label: string }> = [
  { value: 'auto', label: '自动判断' },
  { value: 'heading_then_question', label: '标题后按题号切分' },
  { value: 'question_then_heading', label: '题号后按标题切分' },
]

const answerTableOptions: Array<{ value: AnswerTablePolicy; label: string }> = [
  { value: 'disabled', label: '关闭答案表检测' },
  { value: 'fill_empty_only', label: '只填空缺' },
  { value: 'override_metadata_like_answer', label: '覆盖说明块答案' },
  { value: 'prefer_table_for_choice_questions', label: '小题优先答案表' },
]

type ParserStrategyControlsProps = {
  config: ImportFlowV2ParserConfig | null
  presets: ImportParserPreset[]
  selectedPresetId: string
  loading?: boolean
  onPresetChange: (presetId: string) => void
  onChange: (config: ImportFlowV2ParserConfig) => void
}

export function ParserStrategyControls({
  config,
  presets,
  selectedPresetId,
  loading,
  onPresetChange,
  onChange,
}: ParserStrategyControlsProps) {
  if (!config) {
    return (
      <div className="grid gap-2 text-[11px] text-zinc-400">
        <div className="h-8 rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" />
        <div className="h-8 rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" />
        <div className="h-8 rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" />
      </div>
    )
  }

  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId)

  return (
    <div className="grid gap-2">
      <label className="space-y-1">
        <span className="text-[10px] font-semibold text-zinc-500">解析预设</span>
        <select
          className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
          disabled={loading || !presets.length}
          value={selectedPresetId}
          onChange={(event) => onPresetChange(event.target.value)}
        >
          {!selectedPresetId ? <option value="">自定义调整</option> : null}
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.name}</option>
          ))}
        </select>
        {selectedPreset?.description ? (
          <span className="block text-[10px] leading-relaxed text-zinc-400">{selectedPreset.description}</span>
        ) : selectedPresetId ? null : (
          <span className="block text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
            已修改预设的高级参数，将按自定义设置重解析。
          </span>
        )}
      </label>
      <div className="my-0.5 border-t border-zinc-100 dark:border-zinc-900" />
      <label className="space-y-1">
        <span className="text-[10px] font-semibold text-zinc-500">高级参数 · 答案/解析绑定</span>
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

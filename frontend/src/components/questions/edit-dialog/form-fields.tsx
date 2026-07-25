import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { QuestionContent } from '@/components/questions/QuestionContent'
import { paragraphBlocksFromText } from '@/utils/jsonCleanup'

export function LabeledInput({ label: labelText, help, value, onChange }: { label: string; help: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="block rounded-xl border bg-white dark:bg-zinc-900 dark:border-zinc-800 p-3">
      <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50 block">{labelText}</span>
      <span className="mt-1 block text-[10px] text-zinc-400 dark:text-zinc-500 leading-normal">{help}</span>
      <input
        className="mt-2 h-9 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 text-xs dark:text-zinc-100 outline-none focus:ring-1 focus:ring-zinc-950 focus:border-zinc-950 dark:focus:ring-zinc-200 dark:focus:border-zinc-200 focus:bg-white dark:focus:bg-zinc-800 transition-all"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

export function LabeledSelect({ label: labelText, help, value, options, placeholder, onChange }: { label: string; help: string; value: string; options: string[]; placeholder: string; onChange: (value: string) => void }) {
  return (
    <label className="block rounded-xl border bg-white dark:bg-zinc-900 dark:border-zinc-800 p-3">
      <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50 block">{labelText}</span>
      <span className="mt-1 block text-[10px] text-zinc-400 dark:text-zinc-500 leading-normal">{help}</span>
      <select
        className="mt-2 h-9 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 text-xs dark:text-zinc-100 outline-none focus:ring-1 focus:ring-zinc-950 focus:border-zinc-950 dark:focus:ring-zinc-200 dark:focus:border-zinc-200 focus:bg-white dark:focus:bg-zinc-800 transition-all cursor-pointer"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

export function MultiTagSelector({ label: labelText, help, options, values, onChange }: { label: string; help: string; options: string[]; values: string[]; onChange: (values: string[]) => void }) {
  const cleanValues = values.map((value) => String(value).trim()).filter(Boolean)
  const mergedOptions = Array.from(new Set([...cleanValues, ...options.map((option) => String(option).trim()).filter(Boolean)]))
  const availableOptions = mergedOptions.filter((option) => !cleanValues.includes(option))
  function addTag(value: string) {
    if (!value || cleanValues.includes(value)) return
    onChange([...cleanValues, value])
  }
  function removeTag(value: string) {
    onChange(cleanValues.filter((item) => item !== value))
  }
  return (
    <div className="rounded-xl border bg-white dark:bg-zinc-900 dark:border-zinc-800 p-3">
      <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-500">{labelText}</p>
      <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500 leading-normal">{help}</p>
      <select
        className="mt-2 h-9 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 text-xs dark:text-zinc-100 outline-none focus:ring-1 focus:ring-zinc-950 focus:border-zinc-950 dark:focus:ring-zinc-200 dark:focus:border-zinc-200 focus:bg-white dark:focus:bg-zinc-800 transition-all cursor-pointer"
        value=""
        onChange={(event) => addTag(event.target.value)}
      >
        <option value="">{availableOptions.length ? `选择${labelText}` : '暂无可选项'}</option>
        {availableOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      {cleanValues.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {cleanValues.map((value) => (
            <button
              key={value}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-0.5 text-left text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:border-red-200 dark:hover:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-600 dark:hover:text-red-300 transition-colors cursor-pointer"
              onClick={() => removeTag(value)}
              type="button"
            >
              <span>{value}</span>
              <X className="size-3" />
            </button>
          ))}
        </div>
      ) : <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500 italic">尚未选择</p>}
    </div>
  )
}

export function LabeledTextarea({
  label: labelText,
  help,
  value,
  onChange,
  minHeight,
  className = '',
  readOnly = false,
  showPreview = false,
  headerAction
}: {
  label: string;
  help: string;
  value: string;
  onChange: (value: string) => void;
  minHeight: string;
  className?: string;
  readOnly?: boolean;
  showPreview?: boolean;
  headerAction?: ReactNode;
}) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  return (
    <div className={`block rounded-xl border bg-white p-3 dark:bg-zinc-900 dark:border-zinc-800 ${className}`}>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <div className="min-w-0 flex-1">
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-500 block">{labelText}</span>
          <span className="mt-0.5 block text-[10px] text-zinc-400 dark:text-zinc-500 leading-normal">{help}</span>
        </div>
        {headerAction && (
          <div className="shrink-0">
            {headerAction}
          </div>
        )}
        {showPreview && !readOnly && (
          <div className="flex gap-0.5 bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-md text-[9px] border border-zinc-200 dark:border-zinc-700 shrink-0 ml-2">
            <button
              type="button"
              onClick={() => setTab('edit')}
              className={`px-1.5 py-0.5 rounded transition-all cursor-pointer font-medium ${tab === 'edit' ? 'bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100 font-bold shadow-sm' : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
            >
              编辑
            </button>
            <button
              type="button"
              onClick={() => setTab('preview')}
              className={`px-1.5 py-0.5 rounded transition-all cursor-pointer font-medium ${tab === 'preview' ? 'bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100 font-bold shadow-sm' : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
            >
              预览
            </button>
          </div>
        )}
      </div>
      {tab === 'edit' ? (
        <textarea
          className={`mt-2 w-full resize-y rounded-lg border bg-zinc-50 dark:bg-zinc-800 px-3 py-2 font-mono text-xs leading-6 outline-none focus:ring-1 focus:ring-zinc-950 focus:border-zinc-950 dark:focus:ring-zinc-200 dark:focus:border-zinc-200 transition-all ${minHeight}`}
          readOnly={readOnly}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <div className={`mt-2 w-full rounded-lg border bg-zinc-50/50 dark:bg-zinc-800/30 px-3.5 py-2.5 text-sm overflow-auto ${minHeight}`}>
          {value.trim() ? (
            <QuestionContent blocks={paragraphBlocksFromText(value)} />
          ) : (
            <span className="text-zinc-400 dark:text-zinc-500 text-xs italic">无内容预览</span>
          )}
        </div>
      )}
    </div>
  )
}

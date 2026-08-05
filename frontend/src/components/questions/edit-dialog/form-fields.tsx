import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
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
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return normalizedQuery
      ? mergedOptions.filter((option) => option.toLocaleLowerCase().includes(normalizedQuery))
      : mergedOptions
  }, [mergedOptions.join('|'), query])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  function toggleTag(value: string) {
    if (cleanValues.includes(value)) onChange(cleanValues.filter((item) => item !== value))
    else onChange([...cleanValues, value])
  }

  function removeTag(value: string) {
    onChange(cleanValues.filter((item) => item !== value))
  }

  return (
    <div ref={rootRef} className="relative rounded-xl border bg-white dark:bg-zinc-900 dark:border-zinc-800 p-3">
      <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-500">{labelText}</p>
      <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500 leading-normal">{help}</p>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        className={`mt-2 flex min-h-9 w-full items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left text-xs outline-none transition-colors ${open ? 'border-zinc-900 bg-white ring-1 ring-zinc-900 dark:border-zinc-100 dark:bg-zinc-900 dark:ring-zinc-100' : 'border-zinc-200 bg-zinc-50 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-500'}`}
      >
        <span className={cleanValues.length ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-500'}>{cleanValues.length ? `已选择 ${cleanValues.length} 项` : `搜索并选择${labelText}`}</span>
        <ChevronDown className={`size-3.5 shrink-0 text-zinc-400 motion-safe:transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="absolute inset-x-3 top-[calc(100%-0.25rem)] z-30 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="border-b border-zinc-100 p-2 dark:border-zinc-800">
            <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 dark:border-zinc-700 dark:bg-zinc-800">
              <Search className="size-3.5 shrink-0 text-zinc-400" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}
                placeholder={`搜索${labelText}`}
                aria-label={`搜索${labelText}`}
                className="h-8 min-w-0 flex-1 bg-transparent text-xs text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              />
              {query ? <button type="button" className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700" onClick={() => setQuery('')} aria-label="清除搜索"><X className="size-3" /></button> : null}
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto p-1" role="listbox" aria-multiselectable="true" aria-label={labelText}>
            {filteredOptions.length ? filteredOptions.map((option) => {
              const checked = cleanValues.includes(option)
              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggleTag(option)}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs motion-safe:transition-colors ${checked ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50' : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/70'}`}
                >
                  <span className={`flex size-4 items-center justify-center rounded border ${checked ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900'}`}>{checked ? <Check className="size-3" /> : null}</span>
                  <span className="min-w-0 flex-1 truncate">{option}</span>
                </button>
              )
            }) : <p className="px-2.5 py-5 text-center text-xs text-zinc-400">没有匹配项</p>}
          </div>
        </div>
      ) : null}
      {cleanValues.length ? (
        <div className="mt-2 flex max-h-16 flex-wrap gap-1.5 overflow-y-auto">
          {cleanValues.map((value) => (
            <button
              key={value}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-left text-xs font-medium text-zinc-700 hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-700"
              onClick={() => removeTag(value)}
              type="button"
              aria-label={`移除${value}`}
            >
              <span className="max-w-44 truncate">{value}</span>
              <X className="size-3 text-zinc-400" />
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

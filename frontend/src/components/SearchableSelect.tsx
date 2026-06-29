import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'

type SearchableSelectProps = {
  value: string
  options: string[]
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  allowClear?: boolean
  className?: string
  emptyText?: string
}

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = '请选择',
  searchPlaceholder = '搜索选项',
  disabled = false,
  allowClear = false,
  className = '',
  emptyText = '没有匹配选项',
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const uniqueOptions = useMemo(() => Array.from(new Set(options.filter(Boolean))), [options])
  const filteredOptions = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return uniqueOptions
    return uniqueOptions.filter((option) => option.toLowerCase().includes(keyword))
  }, [query, uniqueOptions])

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  function selectOption(option: string) {
    onChange(option)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-zinc-200 bg-background px-3 text-left text-sm shadow-sm outline-none transition-colors hover:bg-zinc-50 focus:ring-1 focus:ring-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
      >
        <span className={value ? 'truncate text-zinc-950 dark:text-zinc-50' : 'truncate text-zinc-400'}>{value || placeholder}</span>
        <span className="flex shrink-0 items-center gap-1">
          {allowClear && value ? (
            <span
              role="button"
              tabIndex={0}
              title="清除"
              onClick={(event) => {
                event.stopPropagation()
                onChange('')
                setQuery('')
              }}
              className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <X className="size-3.5" />
            </span>
          ) : null}
          <ChevronDown className={`size-4 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center gap-2 border-b border-zinc-100 px-2.5 py-2 dark:border-zinc-900">
            <Search className="size-3.5 text-zinc-400" />
            <input
              autoFocus
              className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filteredOptions.length ? filteredOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => selectOption(option)}
                className="flex w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                <span className="truncate">{option}</span>
                {option === value ? <Check className="size-3.5 shrink-0 text-zinc-950 dark:text-zinc-50" /> : null}
              </button>
            )) : (
              <div className="px-2.5 py-6 text-center text-xs text-zinc-400">{emptyText}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

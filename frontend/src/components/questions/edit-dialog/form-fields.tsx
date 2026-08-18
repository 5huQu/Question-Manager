import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { QuestionContent } from '@/components/questions/QuestionContent'
import { useFloatingMenuPosition } from '@/hooks/useFloatingMenuPosition'
import { useAutoFocusOnOpen } from '@/hooks/useAutoFocusOnOpen'
import { paragraphBlocksFromText } from '@/utils/jsonCleanup'

export function LabeledInput({
  label: labelText,
  help,
  value,
  onChange,
}: {
  label: string
  help: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{labelText}</span>
        {help ? <span className="text-[10px] leading-normal text-zinc-400 dark:text-zinc-500">{help}</span> : null}
      </div>
      <input
        className="h-9 w-full rounded-xl border border-black/8 bg-white/80 px-3 text-xs text-zinc-900 shadow-2xs outline-none transition-all focus:border-zinc-900 focus:bg-white focus:ring-1 focus:ring-zinc-900 dark:border-white/10 dark:bg-zinc-900/80 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:bg-zinc-900 dark:focus:ring-zinc-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

export function LabeledSelect({
  label: labelText,
  help,
  value,
  options,
  placeholder,
  onChange,
}: {
  label: string
  help: string
  value: string
  options: string[]
  placeholder: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block space-y-1.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{labelText}</span>
        {help ? <span className="text-[10px] leading-normal text-zinc-400 dark:text-zinc-500">{help}</span> : null}
      </div>
      <select
        className="h-9 w-full cursor-pointer rounded-xl border border-black/8 bg-white/80 px-3 text-xs text-zinc-900 shadow-2xs outline-none transition-all focus:border-zinc-900 focus:bg-white focus:ring-1 focus:ring-zinc-900 dark:border-white/10 dark:bg-zinc-900/80 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:bg-zinc-900 dark:focus:ring-zinc-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

export function MultiTagSelector({
  label: labelText,
  help,
  options,
  values,
  onChange,
  groups,
  filterOption,
}: {
  label: string
  help: string
  options: string[]
  values: string[]
  onChange: (values: string[]) => void
  groups?: MultiTagGroup[]
  filterOption?: (option: MultiTagOption) => boolean
}) {
  const cleanValues = values.map((value) => String(value).trim()).filter(Boolean)
  // Keep the source order stable when a value is checked. Prepending selected
  // values makes a long open list jump back to the top after every click.
  const normalizedOptions = options.map((option) => String(option).trim()).filter(Boolean)
  const mergedOptions = Array.from(new Set([...normalizedOptions, ...cleanValues]))
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return normalizedQuery
      ? mergedOptions.filter((option) => option.toLocaleLowerCase().includes(normalizedQuery))
      : mergedOptions
  }, [mergedOptions.join('|'), query])
  const visibleGroups = useMemo(() => {
    if (!groups?.length) return []
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return groups.map((group) => {
      const availableOptions = group.options.filter((option) => filterOption?.(option) ?? true)
      const groupMatches = group.name.toLocaleLowerCase().includes(normalizedQuery)
      const optionsInSearch = normalizedQuery && !groupMatches
        ? availableOptions.filter((option) => option.name.toLocaleLowerCase().includes(normalizedQuery))
        : availableOptions
      return { ...group, options: optionsInSearch, groupMatches }
    }).filter((group) => !normalizedQuery || group.groupMatches || group.options.length > 0)
  }, [groups, query, filterOption])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const menuPosition = useFloatingMenuPosition(open, triggerRef, menuRef, { contentKey: filteredOptions.length })

  useAutoFocusOnOpen(open, searchInputRef)

  function toggleTag(value: string) {
    if (cleanValues.includes(value)) onChange(cleanValues.filter((item) => item !== value))
    else onChange([...cleanValues, value])
  }

  function removeTag(value: string) {
    onChange(cleanValues.filter((item) => item !== value))
  }

  function toggleGroup(group: MultiTagGroup) {
    const names = group.options.map((option) => option.name)
    const allSelected = names.length > 0 && names.every((name) => cleanValues.includes(name))
    if (allSelected) onChange(cleanValues.filter((value) => !names.includes(value)))
    else onChange([...cleanValues, ...names.filter((name) => !cleanValues.includes(name))])
  }

  return (
    <div ref={rootRef} className="relative space-y-1.5">
      <div className="flex flex-col gap-0.5">
        <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{labelText}</p>
        {help ? <p className="text-[10px] leading-normal text-zinc-400 dark:text-zinc-500">{help}</p> : null}
      </div>
      <button
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-left text-xs outline-none shadow-2xs transition-all ${
          open
            ? 'border-zinc-900 bg-white ring-1 ring-zinc-900 dark:border-zinc-100 dark:bg-zinc-900 dark:ring-zinc-100'
            : 'border-black/8 bg-white/80 hover:border-black/16 dark:border-white/10 dark:bg-zinc-900/80 dark:hover:border-white/20'
        }`}
      >
        <span className={cleanValues.length ? 'font-medium text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-500'}>
          {cleanValues.length ? `已选择 ${cleanValues.length} 项` : `搜索并选择${labelText}`}
        </span>
        <ChevronDown className={`size-3.5 shrink-0 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? createPortal(
        <div
          ref={menuRef}
          className="fixed z-[110] max-h-[calc(100vh-1rem)] overflow-hidden rounded-xl border border-black/10 bg-white shadow-xl backdrop-blur-xl dark:border-white/12 dark:bg-zinc-900"
          style={{
            top: menuPosition?.top ?? 0,
            left: menuPosition?.left ?? 0,
            width: menuPosition?.width ?? 0,
            visibility: menuPosition ? 'visible' : 'hidden',
          }}
        >
          <div className="border-b border-black/6 p-2 dark:border-white/8">
            <div className="flex items-center gap-2 rounded-lg border border-black/8 bg-zinc-50 px-2 dark:border-white/10 dark:bg-zinc-800">
              <Search className="size-3.5 shrink-0 text-zinc-400" />
              <input
                ref={searchInputRef}
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setOpen(false)
                }}
                placeholder={`搜索${labelText}`}
                aria-label={`搜索${labelText}`}
                className="h-8 min-w-0 flex-1 bg-transparent text-xs text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              />
              {query ? (
                <button
                  type="button"
                  className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  onClick={() => setQuery('')}
                  aria-label="清除搜索"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1" role="listbox" aria-multiselectable="true" aria-label={labelText}>
            {groups?.length ? (
              visibleGroups.length ? visibleGroups.map((group) => {
                const expanded = expandedGroups[group.id] ?? Boolean(query.trim())
                const selectedCount = group.options.filter((option) => cleanValues.includes(option.name)).length
                const allSelected = group.options.length > 0 && selectedCount === group.options.length
                const indeterminate = selectedCount > 0 && !allSelected
                return (
                  <div key={group.id} className="mb-1 last:mb-0">
                    <div className="flex items-center gap-1 rounded-lg px-1 py-1 hover:bg-black/3 dark:hover:bg-white/5">
                      <button
                        type="button"
                        aria-label={`${expanded ? '收起' : '展开'}${group.name}`}
                        onClick={() => setExpandedGroups((current) => ({ ...current, [group.id]: !expanded }))}
                        className="flex size-5 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <ChevronDown className={`size-3 transition-transform ${expanded ? '' : '-rotate-90'}`} />
                      </button>
                      <button
                        type="button"
                        role="option"
                        aria-selected={allSelected}
                        onClick={() => toggleGroup(group)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span className={`flex size-4 shrink-0 items-center justify-center rounded border ${allSelected || indeterminate ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900'}`}>
                          {allSelected ? <Check className="size-3" /> : indeterminate ? <span className="h-px w-2 bg-current" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-700 dark:text-zinc-200">{group.name}</span>
                        {selectedCount > 0 ? <span className="text-[10px] tabular-nums text-zinc-400">{selectedCount}/{group.options.length}</span> : null}
                      </button>
                    </div>
                    {expanded && group.options.length ? (
                      <div className="ml-6 space-y-0.5 border-l border-zinc-200 pl-2 dark:border-zinc-700">
                        {group.options.map((option) => {
                          const checked = cleanValues.includes(option.name)
                          return (
                            <button
                              key={option.name}
                              type="button"
                              role="option"
                              aria-selected={checked}
                              onClick={() => toggleTag(option.name)}
                              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${checked ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50' : 'text-zinc-600 hover:bg-black/3 dark:text-zinc-300 dark:hover:bg-white/5'}`}
                            >
                              <span className={`flex size-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900'}`}>
                                {checked ? <Check className="size-3" /> : null}
                              </span>
                              <span className="min-w-0 flex-1 truncate">{option.name}</span>
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )
              }) : <p className="px-2.5 py-5 text-center text-xs text-zinc-400">没有匹配项</p>
            ) : filteredOptions.length ? (
              filteredOptions.map((option) => {
                const checked = cleanValues.includes(option)
                return (
                  <button
                    key={option}
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggleTag(option)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                      checked
                        ? 'bg-zinc-100 text-zinc-900 font-medium dark:bg-zinc-800 dark:text-zinc-50'
                        : 'text-zinc-600 hover:bg-black/3 dark:text-zinc-300 dark:hover:bg-white/5'
                    }`}
                  >
                    <span
                      className={`flex size-4 items-center justify-center rounded border ${
                        checked
                          ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                          : 'border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900'
                      }`}
                    >
                      {checked ? <Check className="size-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option}</span>
                  </button>
                )
              })
            ) : (
              <p className="px-2.5 py-5 text-center text-xs text-zinc-400">没有匹配项</p>
            )}
          </div>
        </div>,
        document.body,
      ) : null}
      {cleanValues.length ? (
        <div className="mt-2 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto pt-1">
          {cleanValues.map((value) => (
            <button
              key={value}
              className="inline-flex items-center gap-1 rounded-lg border border-black/8 bg-white/90 px-2 py-0.5 text-left text-xs font-medium text-zinc-700 shadow-2xs transition-all hover:border-black/16 hover:bg-white dark:border-white/10 dark:bg-zinc-800/90 dark:text-zinc-300 dark:hover:border-white/20 dark:hover:bg-zinc-800"
              onClick={() => removeTag(value)}
              type="button"
              aria-label={`移除${value}`}
            >
              <span className="max-w-44 truncate">{value}</span>
              <X className="size-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export type MultiTagOption = {
  name: string
  appliesTo?: string[]
}

export type MultiTagGroup = {
  id: string
  name: string
  options: MultiTagOption[]
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
  headerAction,
}: {
  label: string
  help: string
  value: string
  onChange: (value: string) => void
  minHeight: string
  className?: string
  readOnly?: boolean
  showPreview?: boolean
  headerAction?: ReactNode
}) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  return (
    <div className={`block space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{labelText}</span>
          {help ? <span className="text-[10px] leading-normal text-zinc-400 dark:text-zinc-500">{help}</span> : null}
        </div>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
        {showPreview && !readOnly ? (
          <div className="ml-2 flex shrink-0 rounded-lg border border-black/6 bg-black/4 p-0.5 text-[10px] dark:border-white/8 dark:bg-white/6">
            <button
              type="button"
              onClick={() => setTab('edit')}
              className={`cursor-pointer rounded-md px-2 py-0.5 font-medium transition-all ${
                tab === 'edit'
                  ? 'bg-white font-semibold text-zinc-900 shadow-2xs dark:bg-zinc-800 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              编辑
            </button>
            <button
              type="button"
              onClick={() => setTab('preview')}
              className={`cursor-pointer rounded-md px-2 py-0.5 font-medium transition-all ${
                tab === 'preview'
                  ? 'bg-white font-semibold text-zinc-900 shadow-2xs dark:bg-zinc-800 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              预览
            </button>
          </div>
        ) : null}
      </div>
      {tab === 'edit' ? (
        <textarea
          className={`w-full resize-y rounded-xl border border-black/8 bg-white/80 px-3 py-2 font-mono text-xs leading-6 text-zinc-900 shadow-2xs outline-none transition-all focus:border-zinc-900 focus:bg-white focus:ring-1 focus:ring-zinc-900 dark:border-white/10 dark:bg-zinc-900/80 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:bg-zinc-900 dark:focus:ring-zinc-100 ${minHeight}`}
          readOnly={readOnly}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <div className={`w-full overflow-auto rounded-xl border border-black/8 bg-white/50 px-3.5 py-2.5 text-xs text-zinc-900 dark:border-white/10 dark:bg-zinc-900/50 dark:text-zinc-100 ${minHeight}`}>
          {value.trim() ? (
            <QuestionContent blocks={paragraphBlocksFromText(value)} />
          ) : (
            <span className="text-xs italic text-zinc-400 dark:text-zinc-500">无内容预览</span>
          )}
        </div>
      )}
    </div>
  )
}

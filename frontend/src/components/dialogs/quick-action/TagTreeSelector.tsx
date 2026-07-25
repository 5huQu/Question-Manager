import { X, ChevronRight, Search } from 'lucide-react'
import { CustomCheckbox } from './CustomCheckbox'
import type { QuickActionMode } from './constants'

interface TagTreeSelectorProps {
  title: string
  items: any[]
  searchValue: string
  onSearchChange: (value: string) => void
  searchPlaceholder: string
  mode: QuickActionMode
  // Single-select values (daily mode)
  selectedSingle: string
  onSelectSingle: (updater: (prev: string) => string) => void
  // Multi-select values (random mode)
  selectedMulti: string[]
  onSelectMulti: (updater: (prev: string[]) => string[]) => void
  // Expanded chapters state
  expandedChapters: Record<string, boolean>
  onExpandedChaptersChange: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void
  emptyText: string
}

export function TagTreeSelector({
  title,
  items,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  mode,
  selectedSingle,
  onSelectSingle,
  selectedMulti,
  onSelectMulti,
  expandedChapters,
  onExpandedChaptersChange,
  emptyText,
}: TagTreeSelectorProps) {
  return (
    <div className="flex flex-col space-y-2">
      <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
        {title} {mode === 'random' && '(可多选)'}
      </label>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 size-3.5 text-zinc-400 dark:text-zinc-500" />
        <input
          type="text"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={e => onSearchChange(e.target.value)}
          className="w-full rounded-lg border border-zinc-200 bg-transparent pl-8 pr-8 py-2 text-xs outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"
        />
        {searchValue && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-600"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* FIXED HEIGHT: h-80 */}
      <div className="h-80 overflow-y-auto p-3 rounded-lg border border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/20 space-y-2 select-none">
        {items.map((chapter: any) => {
          const filteredItems = chapter.knowledgePoints.filter((item: any) =>
            item.name.toLowerCase().includes(searchValue.toLowerCase())
          )
          const chapterMatches = chapter.name.toLowerCase().includes(searchValue.toLowerCase())
          const displayItems = chapterMatches ? chapter.knowledgePoints : filteredItems

          if (searchValue && displayItems.length === 0 && !chapterMatches) {
            return null
          }

          const isExpanded = expandedChapters[chapter.code] ?? (searchValue ? true : false)
          const itemNames = chapter.knowledgePoints.map((item: any) => item.name)
          const selectedChildren = chapter.knowledgePoints.filter((item: any) =>
            mode === 'daily' ? selectedSingle === item.name : selectedMulti.includes(item.name)
          )
          
          const isAllSelected = selectedChildren.length === chapter.knowledgePoints.length && chapter.knowledgePoints.length > 0
          const isIndeterminate = selectedChildren.length > 0 && selectedChildren.length < chapter.knowledgePoints.length

          const handleChapterToggle = () => {
            if (mode === 'daily') return
            if (isAllSelected) {
              onSelectMulti(curr => curr.filter(name => !itemNames.includes(name)))
            } else {
              onSelectMulti(curr => {
                const next = [...curr]
                itemNames.forEach((name: string) => {
                  if (!next.includes(name)) next.push(name)
                })
                return next
              })
            }
          }

          return (
            <div key={chapter.code} className="space-y-1">
              <div className="flex items-center gap-2 py-0.5">
                <button
                  type="button"
                  onClick={() =>
                    onExpandedChaptersChange(prev => ({
                      ...prev,
                      [chapter.code]: !(prev[chapter.code] ?? (searchValue ? true : false))
                    }))
                  }
                  className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <ChevronRight className={`size-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </button>
                {mode === 'random' && (
                  <CustomCheckbox
                    checked={isAllSelected}
                    indeterminate={isIndeterminate}
                    onChange={handleChapterToggle}
                  />
                )}
                <span
                  className="text-xs font-semibold text-zinc-800 dark:text-zinc-300 truncate cursor-pointer hover:text-zinc-950 dark:hover:text-zinc-100"
                  onClick={() =>
                    onExpandedChaptersChange(prev => ({
                      ...prev,
                      [chapter.code]: !(prev[chapter.code] ?? (searchValue ? true : false))
                    }))
                  }
                  title={chapter.name}
                >
                  {chapter.name}
                </span>
              </div>

              {isExpanded && displayItems.length > 0 && (
                <div className="pl-6 space-y-1 border-l border-zinc-200 dark:border-zinc-800 ml-2">
                  {displayItems.map((item: any) => {
                    const isSelected = mode === 'daily' ? selectedSingle === item.name : selectedMulti.includes(item.name)
                    const handleItemToggle = () => {
                      if (mode === 'daily') {
                        onSelectSingle(prev => prev === item.name ? '' : item.name)
                      } else {
                        onSelectMulti(curr =>
                          curr.includes(item.name) ? curr.filter(n => n !== item.name) : [...curr, item.name]
                        )
                      }
                    }

                    return (
                      <div key={item.code} className="flex items-center gap-2 py-0.5">
                        {mode === 'random' ? (
                          <CustomCheckbox checked={isSelected} onChange={handleItemToggle} />
                        ) : (
                          <button
                            type="button"
                            onClick={handleItemToggle}
                            className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border transition-all duration-150 cursor-pointer ${
                              isSelected
                                ? 'bg-zinc-900 border-zinc-900 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-900 shadow-sm'
                                : 'border-zinc-300 hover:border-zinc-400 bg-white dark:border-zinc-700 dark:bg-zinc-900'
                            }`}
                          >
                            {isSelected && <div className="size-1.5 rounded-full bg-white dark:bg-zinc-905" />}
                          </button>
                        )}
                        <span
                          className={`text-xs leading-snug cursor-pointer ${
                            isSelected
                              ? 'font-bold text-zinc-950 dark:text-zinc-50'
                              : 'text-zinc-650 dark:text-zinc-450 hover:text-zinc-900'
                          }`}
                          onClick={handleItemToggle}
                        >
                          {item.name}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {items.length === 0 && (
          <div className="text-xs text-zinc-400 text-center py-4">{emptyText}</div>
        )}
      </div>
    </div>
  )
}

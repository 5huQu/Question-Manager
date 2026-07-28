import { useMemo } from 'react'
import katex from 'katex'
import { Sigma } from 'lucide-react'

export interface FormulaLiveInputProps {
  value: string
  onChange: (latex: string) => void
  onOpenKeyboard?: () => void
  displayMode?: boolean
  label?: string
  placeholder?: string
  rows?: number
  className?: string
}

/**
 * FormulaLiveInput — 复用型即时渲染公式输入框
 *
 * 集成：
 * 1. LaTeX 源码编辑框（实时受控）
 * 2. 即时 KaTeX 预览卡片（打字即渲染）
 * 3. 公式键盘触发快捷入口（配合 FormulaEditorDialog）
 */
export function FormulaLiveInput({
  value,
  onChange,
  onOpenKeyboard,
  displayMode = true,
  label = '公式代码',
  placeholder = '输入 LaTeX 代码，如 f\'(x)=2x-2a',
  rows = 3,
  className = '',
}: FormulaLiveInputProps) {
  // 即时渲染 KaTeX HTML
  const { renderedHtml, renderError } = useMemo(() => {
    const trimmed = value.trim()
    if (!trimmed) return { renderedHtml: '', renderError: false }
    try {
      const html = katex.renderToString(trimmed, {
        displayMode,
        throwOnError: true,
        strict: false,
      })
      return { renderedHtml: html, renderError: false }
    } catch {
      try {
        const fallbackHtml = katex.renderToString(trimmed, {
          displayMode,
          throwOnError: false,
          strict: false,
        })
        return { renderedHtml: fallbackHtml, renderError: true }
      } catch {
        return { renderedHtml: '', renderError: true }
      }
    }
  }, [value, displayMode])

  return (
    <div className={`space-y-2.5 ${className}`}>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          {label}
        </label>
        {onOpenKeyboard ? (
          <button
            type="button"
            onClick={onOpenKeyboard}
            className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-indigo-600 transition-colors hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
            title="打开可视化公式键盘"
          >
            <Sigma className="size-3.5" />
            <span>公式键盘</span>
          </button>
        ) : null}
      </div>

      {/* 即时渲染预览卡片 */}
      <div className="rounded-lg border border-zinc-200/80 bg-zinc-50/70 p-3 transition-colors dark:border-zinc-800/80 dark:bg-zinc-900/40">
        <div className="mb-1 flex items-center justify-between text-[10px] font-medium tracking-wider text-zinc-400 uppercase dark:text-zinc-500">
          <span>即时渲染预览</span>
          {renderError ? (
            <span className="text-amber-600 dark:text-amber-400">语法警告</span>
          ) : null}
        </div>
        <div className="flex min-h-[40px] items-center justify-center overflow-x-auto text-center">
          {renderedHtml ? (
            <div
              className="td-block-math py-1"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          ) : value.trim() ? (
            <div className="text-xs text-amber-600 dark:text-amber-400">
              <code>{value}</code>
              <span className="ml-2 text-[11px] opacity-75">公式渲染失败</span>
            </div>
          ) : (
            <span className="text-xs italic text-zinc-400 dark:text-zinc-600">
              （暂无公式内容，请在下方或公式键盘中输入）
            </span>
          )}
        </div>
      </div>

      {/* LaTeX 源码输入框 */}
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full resize-y rounded-lg border border-zinc-200 bg-white p-2.5 font-mono text-xs text-zinc-900 outline-none transition-colors focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600 dark:focus:ring-zinc-800"
      />
    </div>
  )
}

/**
 * 属性面板共享控件与工具（按类型拆分的 settings/ 各文件共用）
 */
import type { TeachingBlock, TeachingInline } from '@/types/teachingDocument'

export const fieldClass = 'mt-1 h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100'

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
      {label}
      {children}
    </label>
  )
}

export function ActionButton({ children, label, danger, onClick }: {
  children: React.ReactNode
  label: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={`rounded-md p-1.5 transition-colors ${
        danger
          ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30'
          : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
      }`}
    >
      {children}
    </button>
  )
}

export function inlineContentOf(block: TeachingBlock): TeachingInline[] {
  if (block.type !== 'heading' && block.type !== 'paragraph') return []
  return block.content
}

import type { LucideIcon } from 'lucide-react'

export function UploadModeButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors ${
        active
          ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950'
          : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 hover:text-zinc-950 dark:border-zinc-700 dark:bg-zinc-850 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-white'
      }`}
    >
      <Icon className="size-3.5" />
      <span className="truncate">{label}</span>
    </button>
  )
}

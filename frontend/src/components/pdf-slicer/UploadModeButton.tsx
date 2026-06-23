import type { LucideIcon } from 'lucide-react'

export function UploadModeButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-all cursor-pointer ${
        active
          ? 'bg-white text-zinc-900 shadow-sm border border-zinc-200/20 dark:bg-zinc-950 dark:text-zinc-50'
          : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 border-transparent bg-transparent'
      }`}
    >
      <Icon className="size-3.5" />
      <span className="truncate">{label}</span>
    </button>
  )
}

import type { LucideIcon } from 'lucide-react'

export function UploadModeButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors ${
        active
          ? 'border-primary bg-accent text-foreground'
          : 'border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      }`}
    >
      <Icon className="size-3.5" />
      <span className="truncate">{label}</span>
    </button>
  )
}

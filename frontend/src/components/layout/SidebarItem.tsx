import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'

export function SidebarItem({ active, icon: Icon, label, to, collapsed = false, onClick }: { active: boolean; icon: LucideIcon; label: string; to?: string; collapsed?: boolean; onClick?: () => void }) {
  const content = (
    <>
      <div className={`active-icon-box flex size-6 items-center justify-center rounded-md transition-colors shrink-0 ${
        active
          ? 'bg-zinc-200 dark:bg-zinc-900 border border-zinc-300/60 dark:border-zinc-800 text-zinc-900 dark:text-white'
          : 'text-zinc-500 dark:text-zinc-400'
      }`}>
        <Icon className="size-3.5" />
      </div>
      {!collapsed && <span className="truncate">{label}</span>}
      {active && (
        <span className="active-indicator-pill absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4.5 rounded-r bg-zinc-950 dark:bg-white" />
      )}
    </>
  )
  const className = `relative w-full flex items-center ${collapsed ? 'justify-center py-2 px-0' : 'gap-3 px-3 py-2'} rounded-xl text-left text-[13px] font-medium transition-all ${
    active
      ? 'bg-zinc-100 dark:bg-zinc-900/60 text-zinc-900 dark:text-white font-semibold'
      : 'text-zinc-500 hover:bg-zinc-100/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/40 dark:hover:text-zinc-100'
  }`
  if (to) {
    return <Link className={className} to={to} title={collapsed ? label : undefined}>{content}</Link>
  }
  return <button className={className} onClick={onClick} type="button" title={collapsed ? label : undefined}>{content}</button>
}

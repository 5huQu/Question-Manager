import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'

export function SidebarItem({ active, icon: Icon, label, to, collapsed = false, onClick }: { active: boolean; icon: LucideIcon; label: string; to?: string; collapsed?: boolean; onClick?: () => void }) {
  const content = (
    <>
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </>
  )
  const className = `relative w-full flex items-center ${collapsed ? 'justify-center px-0 py-2' : 'gap-3 px-3 py-2'} rounded-md text-left text-sm font-medium transition-colors ${
    active
      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
  }`
  if (to) {
    return <Link className={className} to={to} title={collapsed ? label : undefined}>{content}</Link>
  }
  return <button className={className} onClick={onClick} type="button" title={collapsed ? label : undefined}>{content}</button>
}

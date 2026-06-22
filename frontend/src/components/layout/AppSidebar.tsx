import { useLocation } from 'react-router-dom'
import { BookOpen, BookOpenCheck, Database, DownloadCloud, GraduationCap, LayoutDashboard, Moon, PanelLeftClose, PanelLeftOpen, ScanSearch, Scissors, Settings2, Sun, ShoppingBag } from 'lucide-react'
import { SidebarItem } from './SidebarItem'

type AppSidebarProps = {
  collapsed: boolean
  darkMode: boolean
  systemName?: string
  onThemeToggle: () => void
  onToggleCollapsed: () => void
}

export function AppSidebar({
  collapsed,
  darkMode,
  systemName = 'Question Manager',
  onThemeToggle,
  onToggleCollapsed,
}: AppSidebarProps) {
  const location = useLocation()
  const collapsedClass = collapsed ? 'w-14' : 'w-56'

  return (
    <aside className={`${collapsedClass} flex h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200`}>
      <div className={`flex h-14 items-center gap-2 border-b border-sidebar-border transition-all duration-200 ${collapsed ? 'justify-center px-2' : 'px-4'}`}>
        {!collapsed && (
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <GraduationCap className="size-4" />
          </div>
        )}
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-none">{systemName}</p>
            <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">v2.0.0</p>
          </div>
        )}
        <button
          onClick={onToggleCollapsed}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          type="button"
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-auto p-3">
        {!collapsed && <NavSection label="平台" />}
        <SidebarItem active={location.pathname === '/' || location.pathname === '/workbench'} icon={LayoutDashboard} label="工作台概览" to="/workbench" collapsed={collapsed} />

        {!collapsed && <NavSection label="工具" className="mt-4" />}
        <SidebarItem active={location.pathname.startsWith('/tools/pdf-slicer') && !location.pathname.endsWith('ocr-jobs') && !location.pathname.includes('pending-bank')} icon={Scissors} label="PDF 切分中心" to="/tools/pdf-slicer" collapsed={collapsed} />
        <SidebarItem active={location.pathname.endsWith('ocr-jobs')} icon={ScanSearch} label="OCR 识别队列" to="/tools/pdf-slicer/ocr-jobs" collapsed={collapsed} />

        {!collapsed && <NavSection label="题库" className="mt-4" />}
        <SidebarItem active={location.pathname.startsWith('/questions') && location.pathname !== '/questions/new' && location.pathname !== '/questions/basket'} icon={Database} label="题库主库" to="/questions" collapsed={collapsed} />
        <SidebarItem active={location.pathname === '/questions/new'} icon={BookOpen} label="新建题目" to="/questions/new" collapsed={collapsed} />
        <SidebarItem active={location.pathname === '/questions/basket'} icon={ShoppingBag} label="组卷工作台" to="/questions/basket" collapsed={collapsed} />
        <SidebarItem active={location.pathname.startsWith('/learning-tags')} icon={BookOpenCheck} label="学习标签库" to="/learning-tags" collapsed={collapsed} />
        <SidebarItem active={location.pathname === '/exports'} icon={DownloadCloud} label="导出记录" to="/exports" collapsed={collapsed} />
        <SidebarItem active={location.pathname === '/settings'} icon={Settings2} label="系统设置" to="/settings" collapsed={collapsed} />
      </nav>

      <div className="border-t border-sidebar-border p-3">
        {!collapsed && (
          <div className="space-y-1 rounded-lg bg-sidebar-accent/50 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-[10px] font-semibold text-muted-foreground">系统运行中</span>
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">引擎正常 · SQLite 正常</p>
          </div>
        )}
        <div className={`mt-2 flex items-center ${collapsed ? 'justify-center' : 'justify-between'} px-1`}>
          {!collapsed && <span className="text-[10px] text-muted-foreground">© 2026</span>}
          <button
            onClick={onThemeToggle}
            className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            title={darkMode ? '切换到浅色模式' : '切换到深色模式'}
            type="button"
          >
            {darkMode ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </button>
        </div>
      </div>
    </aside>
  )
}

function NavSection({ label, className = '' }: { label: string; className?: string }) {
  return (
    <p className={`mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground ${className}`}>
      {label}
    </p>
  )
}

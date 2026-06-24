import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  BookOpen,
  BookOpenCheck,
  Database,
  DownloadCloud,
  GraduationCap,
  LayoutDashboard,
  Moon,
  PanelLeft,
  ScanSearch,
  Scissors,
  Settings2,
  ShoppingBag,
  Sun,
  type LucideIcon,
} from 'lucide-react'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'

type AppSidebarProps = {
  darkMode: boolean
  systemName?: string
  onThemeToggle: () => void
}

type NavItem = {
  label: string
  to: string
  icon: LucideIcon
  active: (pathname: string) => boolean
}

export function AppSidebar({
  darkMode,
  systemName = 'Question Manager',
  onThemeToggle,
}: AppSidebarProps) {
  const location = useLocation()
  const { state, toggleSidebar } = useSidebar()
  const collapsed = state === 'collapsed'
  const platformItems: NavItem[] = [
    { active: (pathname) => pathname === '/' || pathname === '/workbench', icon: LayoutDashboard, label: '工作台概览', to: '/workbench' },
  ]
  const toolItems: NavItem[] = [
    {
      active: (pathname) => pathname.startsWith('/tools/pdf-slicer') && !pathname.endsWith('ocr-jobs') && !pathname.includes('pending-bank'),
      icon: Scissors,
      label: 'PDF 切分中心',
      to: '/tools/pdf-slicer',
    },
    { active: (pathname) => pathname.endsWith('ocr-jobs'), icon: ScanSearch, label: 'OCR 识别队列', to: '/tools/pdf-slicer/ocr-jobs' },
  ]
  const questionItems: NavItem[] = [
    { active: (pathname) => pathname.startsWith('/questions') && pathname !== '/questions/new' && pathname !== '/questions/basket', icon: Database, label: '题库主库', to: '/questions' },
    { active: (pathname) => pathname === '/questions/new', icon: BookOpen, label: '新建题目', to: '/questions/new' },
    { active: (pathname) => pathname === '/questions/basket', icon: ShoppingBag, label: '组卷工作台', to: '/questions/basket' },
    { active: (pathname) => pathname.startsWith('/learning-tags'), icon: BookOpenCheck, label: '学习标签库', to: '/learning-tags' },
    { active: (pathname) => pathname === '/exports', icon: DownloadCloud, label: '导出记录', to: '/exports' },
    { active: (pathname) => pathname === '/settings', icon: Settings2, label: '系统设置', to: '/settings' },
  ]

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border p-3 relative">
        <div className="flex h-8 items-center justify-between gap-2 relative w-full">
          <div
            onClick={!collapsed ? toggleSidebar : undefined}
            className={cn(
              "flex items-center gap-2 min-w-0 flex-1 transition-all duration-300 ease-in-out origin-left cursor-pointer",
              collapsed ? "w-0 opacity-0 pointer-events-none -translate-x-2" : "w-auto opacity-100 translate-x-0"
            )}
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 transition-colors">
              <GraduationCap className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-none">{systemName}</p>
              <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">v2.0.0</p>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleSidebar}
            className={cn(
              "flex items-center justify-center rounded-md text-sidebar-foreground/60 transition-all duration-300 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer shrink-0",
              collapsed
                ? "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 size-8 rounded-lg shadow-sm"
                : "size-7"
            )}
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {collapsed ? (
              <GraduationCap className="size-4.5" />
            ) : (
              <PanelLeft className="size-4" />
            )}
          </button>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <NavGroup label="平台" items={platformItems} pathname={location.pathname} />
        <NavGroup label="工具" items={toolItems} pathname={location.pathname} />
        <NavGroup label="题库" items={questionItems} pathname={location.pathname} />
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3 overflow-hidden">
        <div className={cn(
          "space-y-1 rounded-lg bg-sidebar-accent/50 transition-all duration-300 ease-in-out origin-top overflow-hidden",
          collapsed ? "max-h-0 opacity-0 py-0 px-0 pointer-events-none mb-0" : "max-h-16 opacity-100 px-3 py-2.5 mb-2"
        )}>
          <div className="flex items-center gap-2">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[10px] font-semibold text-muted-foreground">系统运行中</span>
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground whitespace-nowrap">引擎正常 · SQLite 正常</p>
        </div>
        <div className={cn(
          "flex items-center px-1 transition-all duration-300 ease-in-out",
          collapsed ? "justify-center" : "justify-between"
        )}>
          <span className={cn(
            "text-[10px] text-muted-foreground transition-all duration-300 ease-in-out origin-left",
            collapsed ? "w-0 opacity-0 pointer-events-none" : "w-auto opacity-100"
          )}>
            © 2026
          </span>
          <button
            onClick={onThemeToggle}
            className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground shrink-0"
            title={darkMode ? '切换到浅色模式' : '切换到深色模式'}
            type="button"
          >
            {darkMode ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </button>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function NavGroup({
  label,
  items,
  pathname,
  labelClassName,
}: {
  label: string
  items: NavItem[]
  pathname: string
  labelClassName?: string
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel className={labelClassName}>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton asChild isActive={item.active(pathname)} tooltip={item.label}>
                <Link to={item.to}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
      <SidebarSeparator className="mt-2 last:hidden" />
    </SidebarGroup>
  )
}

import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  BookOpen,
  BookOpenCheck,
  Bot,
  ChevronRight,
  Database,
  FileCode,
  FileJson,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Moon,
  NotebookPen,
  PanelLeft,
  ScanText,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Sliders,
  Sun,
  User,
  type LucideIcon,
} from 'lucide-react'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { teachingDocumentsApi, type TeachingDocumentSummary } from '@/api/teachingDocuments'
import { useAuth } from '@/auth/AuthProvider'

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

function useSafeAuth() {
  try {
    return useAuth()
  } catch {
    return {
      admin: { username: 'ADMIN' },
      accountManagementAvailable: true,
      logout: async () => {},
    }
  }
}

export function AppSidebar({
  darkMode,
  systemName = 'Question Manager',
  onThemeToggle,
}: AppSidebarProps) {
  const location = useLocation()
  const { state, toggleSidebar } = useSidebar()
  const collapsed = state === 'collapsed'
  const { admin, accountManagementAvailable, logout } = useSafeAuth()

  const [recentDocs, setRecentDocs] = useState<TeachingDocumentSummary[]>([])
  // "文档" is default expanded and stays expanded
  const [docsOpen, setDocsOpen] = useState(true)
  // Accordion rule applies ONLY to "系统设置"
  const [settingsOpen, setSettingsOpen] = useState(() => location.pathname.startsWith('/settings'))

  // Accordion logic for System Settings:
  // Auto-expand on /settings, auto-collapse when leaving /settings.
  // Manual toggle preserved transiently until next route change.
  useEffect(() => {
    const isSettingsRoute = location.pathname.startsWith('/settings')
    setSettingsOpen(isSettingsRoute)
  }, [location.pathname, location.search])

  useEffect(() => {
    let active = true
    teachingDocumentsApi
      .listDocuments()
      .then((res) => {
        if (!active) return
        const sorted = [...(res.items || [])].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
        setRecentDocs(sorted.slice(0, 4))
      })
      .catch(() => {
        if (active) setRecentDocs([])
      })
    return () => {
      active = false
    }
  }, [location.pathname])

  const mainMenuItems: NavItem[] = [
    {
      active: (pathname) => pathname === '/' || pathname === '/workbench',
      icon: LayoutDashboard,
      label: '工作台概览',
      to: '/workbench',
    },
    {
      active: (pathname) => pathname.startsWith('/tools/import'),
      icon: FileJson,
      label: '资料导入',
      to: '/tools/import',
    },
    {
      active: (pathname) =>
        pathname.startsWith('/questions') &&
        pathname !== '/questions/new' &&
        pathname !== '/questions/basket' &&
        pathname !== '/questions/papers' &&
        !pathname.includes('/layout-drafts'),
      icon: Database,
      label: '题库',
      to: '/questions',
    },
    {
      active: (pathname) => pathname === '/questions/new',
      icon: BookOpen,
      label: '新建题目',
      to: '/questions/new',
    },
    {
      active: (pathname) => pathname === '/questions/basket',
      icon: ShoppingBag,
      label: '组卷工作台',
      to: '/questions/basket',
    },
  ]

  const settingsSubItems = [
    { desc: '偏好、字段与学科参数', icon: Sliders, label: '基础设置', tab: 'general' },
    { desc: 'Doc2X / GLM 服务配置', icon: ScanText, label: 'OCR 引擎', tab: 'ocr' },
    { desc: '题号识别与解析预设', icon: FileCode, label: '导入识别规则', tab: 'parser' },
    { desc: '智能标注与模型配置', icon: Bot, label: 'AI 助手与分类', tab: 'ai' },
    { desc: '管理员与登录设备', icon: ShieldCheck, label: '系统与账号', tab: 'system' },
  ]

  const isSettingsTabActive = (tabKey: string) => {
    if (!location.pathname.startsWith('/settings')) return false
    const params = new URLSearchParams(location.search)
    const currentTab = params.get('tab') || 'general'
    return currentTab === tabKey
  }

  return (
    <Sidebar collapsible="icon">
      {/* Header */}
      <SidebarHeader className="border-b border-sidebar-border p-3 relative">
        <div className="flex h-8 items-center justify-between gap-2 relative w-full">
          <div
            onClick={!collapsed ? toggleSidebar : undefined}
            className={cn(
              'flex items-center gap-2 min-w-0 flex-1 transition-all duration-300 ease-in-out origin-left cursor-pointer',
              collapsed ? 'w-0 opacity-0 pointer-events-none -translate-x-2' : 'w-auto opacity-100 translate-x-0'
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
              'flex items-center justify-center rounded-md text-sidebar-foreground/60 transition-all duration-300 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer shrink-0',
              collapsed
                ? 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 size-8 rounded-lg shadow-sm'
                : 'size-7'
            )}
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {collapsed ? <GraduationCap className="size-4.5" /> : <PanelLeft className="size-4" />}
          </button>
        </div>
      </SidebarHeader>

      {/* Main Content (Scrollable & Smooth Downward Expansion) */}
      <SidebarContent className="flex flex-col flex-1 overflow-y-auto">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Primary Nav Items */}
              {mainMenuItems.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton asChild isActive={item.active(location.pathname)} tooltip={item.label}>
                    <Link to={item.to}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              {/* 文档 Collapsible Section (Default Expanded) */}
              <SidebarMenuItem>
                {collapsed ? (
                  <SidebarMenuButton asChild isActive={location.pathname.startsWith('/teaching-documents')} tooltip="文档">
                    <Link to="/teaching-documents">
                      <NotebookPen />
                      <span>文档</span>
                    </Link>
                  </SidebarMenuButton>
                ) : (
                  <div>
                    <button
                      type="button"
                      onClick={() => setDocsOpen(!docsOpen)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer',
                        location.pathname.startsWith('/teaching-documents') ? 'text-sidebar-foreground font-semibold' : 'text-sidebar-foreground/80'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <NotebookPen className="size-4 shrink-0" />
                        <span>文档</span>
                      </div>
                      <ChevronRight
                        className={cn(
                          'size-3.5 shrink-0 opacity-60 transition-transform duration-200 ease-in-out',
                          docsOpen && 'rotate-90'
                        )}
                      />
                    </button>

                    <div
                      className={cn(
                        'grid transition-all duration-200 ease-in-out',
                        docsOpen ? 'grid-rows-[1fr] opacity-100 mt-1' : 'grid-rows-[0fr] opacity-0'
                      )}
                    >
                      <div className="overflow-hidden space-y-0.5 border-l border-sidebar-border/60 ml-4 pl-2">
                        {recentDocs.length > 0 ? (
                          recentDocs.map((doc) => {
                            const isDocActive = location.pathname === `/teaching-documents/${doc.id}`
                            return (
                              <Link
                                key={doc.id}
                                to={`/teaching-documents/${doc.id}`}
                                className={cn(
                                  'flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                                  isDocActive ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-sidebar-foreground/70'
                                )}
                                title={doc.title}
                              >
                                <FileText className="size-3 shrink-0 text-sidebar-foreground/50" />
                                <span className="truncate">{doc.title || '未命名文档'}</span>
                              </Link>
                            )
                          })
                        ) : (
                          <span className="block px-2 py-1 text-[11px] text-sidebar-foreground/40 italic">暂无最近文档</span>
                        )}

                        <Link
                          to="/teaching-documents"
                          className={cn(
                            'flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                            location.pathname === '/teaching-documents' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/60'
                          )}
                        >
                          <span>查看全部</span>
                        </Link>
                      </div>
                    </div>
                  </div>
                )}
              </SidebarMenuItem>

              {/* 学习标签库 */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname.startsWith('/learning-tags')} tooltip="学习标签库">
                  <Link to="/learning-tags">
                    <BookOpenCheck />
                    <span>学习标签库</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* 系统设置 Collapsible Section (Accordion applied only to this) */}
              <SidebarMenuItem>
                {collapsed ? (
                  <SidebarMenuButton asChild isActive={location.pathname.startsWith('/settings')} tooltip="系统设置">
                    <Link to="/settings">
                      <Settings2 />
                      <span>系统设置</span>
                    </Link>
                  </SidebarMenuButton>
                ) : (
                  <div>
                    <button
                      type="button"
                      onClick={() => setSettingsOpen(!settingsOpen)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer',
                        location.pathname.startsWith('/settings') ? 'text-sidebar-foreground font-semibold' : 'text-sidebar-foreground/80'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Settings2 className="size-4 shrink-0" />
                        <span>系统设置</span>
                      </div>
                      <ChevronRight
                        className={cn(
                          'size-3.5 shrink-0 opacity-60 transition-transform duration-200 ease-in-out',
                          settingsOpen && 'rotate-90'
                        )}
                      />
                    </button>

                    <div
                      className={cn(
                        'grid transition-all duration-200 ease-in-out',
                        settingsOpen ? 'grid-rows-[1fr] opacity-100 mt-1' : 'grid-rows-[0fr] opacity-0'
                      )}
                    >
                      <div className="overflow-hidden space-y-1 border-l border-sidebar-border/60 ml-4 pl-2">
                        {settingsSubItems.map((sub) => {
                          const active = isSettingsTabActive(sub.tab)
                          return (
                            <Link
                              key={sub.tab}
                              to={`/settings?tab=${sub.tab}`}
                              className={cn(
                                'group flex items-center justify-between rounded-md px-2 py-1.5 text-xs transition-all duration-150',
                                active
                                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium border-l-2 border-primary -ml-[9px] pl-[7px] shadow-2xs'
                                  : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                              )}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <sub.icon className={cn('size-3.5 shrink-0 transition-colors', active ? 'text-primary' : 'text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80')} />
                                <span className="truncate">{sub.label}</span>
                              </div>
                            </Link>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Merged Fixed Bottom Footer: User Status Card & App Theme Switch */}
      <SidebarFooter className="border-t border-sidebar-border p-3 flex flex-col gap-2 bg-sidebar shrink-0">
        {/* Rectangular User Status Card */}
        {collapsed ? (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => {
                if (accountManagementAvailable) {
                  void logout().finally(() => {
                    window.location.assign('/login')
                  })
                }
              }}
              className="flex size-8 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-accent/50 text-sidebar-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors cursor-pointer"
              title={`${admin?.username || 'ADMIN'} (点击退出登录)`}
            >
              <User className="size-4" />
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-2 text-xs text-sidebar-foreground">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex size-6 shrink-0 items-center justify-center rounded bg-sidebar-primary/10 text-sidebar-primary dark:bg-sidebar-primary/20">
                  <User className="size-3.5" />
                </div>
                <span className="truncate font-semibold text-xs text-sidebar-foreground">
                  {admin?.username || 'ADMIN'}
                </span>
              </div>
              {accountManagementAvailable && (
                <button
                  type="button"
                  onClick={() => {
                    void logout().finally(() => {
                      window.location.assign('/login')
                    })
                  }}
                  className="flex items-center gap-1 shrink-0 rounded px-1.5 py-1 text-[11px] font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-red-500 cursor-pointer"
                  title="退出登录"
                >
                  <LogOut className="size-3" />
                  <span>退出</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Footer Bottom Bar: Brand & Theme Toggle */}
        <div className={cn(
          'flex items-center px-1 transition-all duration-300 ease-in-out',
          collapsed ? 'justify-center' : 'justify-between'
        )}>
          <span className={cn(
            'text-xs font-semibold tracking-tight text-sidebar-foreground/80 transition-all duration-300 ease-in-out origin-left',
            collapsed ? 'w-0 opacity-0 pointer-events-none' : 'w-auto opacity-100'
          )}>
            QuestionManager
          </span>
          <button
            onClick={onThemeToggle}
            className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground shrink-0 cursor-pointer"
            title={darkMode ? '切换到浅色模式' : '切换到深色模式'}
            type="button"
          >
            {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

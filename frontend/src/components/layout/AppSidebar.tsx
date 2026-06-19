import { useLocation } from 'react-router-dom'
import { BookOpen, BookOpenCheck, Database, FileStack, LayoutDashboard, Moon, ScanSearch, Scissors, Settings2, Sun, ShoppingBag, DownloadCloud } from 'lucide-react'
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

  return (
    <aside className={`${
      collapsed ? 'w-14 px-2 py-4' : 'w-56 p-4'
    } h-screen sticky top-0 bg-white dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 flex flex-col justify-between shadow-sm border-r border-zinc-200 dark:border-zinc-800 shrink-0 transition-all duration-200`}>
      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-4">
          <button
            onClick={onToggleCollapsed}
            className="flex items-center gap-2.5 px-1.5 py-1 text-left hover:opacity-80 transition-opacity cursor-pointer focus:outline-none min-w-0 flex-1"
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
            type="button"
          >
            <div className="flex size-7 items-center justify-center rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 shrink-0 mx-auto sm:mx-0">
              <FileStack className="size-4" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="font-semibold text-xs leading-none text-zinc-900 dark:text-white truncate">{systemName}</p>
                <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-medium mt-1 block">版本 v1.2.0</span>
              </div>
            )}
          </button>
          {!collapsed && (
            <button
              onClick={onThemeToggle}
              className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors cursor-pointer mr-1 focus:outline-none shrink-0"
              title={darkMode ? '切换到浅色模式' : '切换到深色模式'}
              type="button"
            >
              {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          )}
        </div>

        <nav className="space-y-1">
          <SidebarItem active={location.pathname === '/' || location.pathname === '/workbench'} icon={LayoutDashboard} label="工作台概览" to="/workbench" collapsed={collapsed} />
          <SidebarItem active={location.pathname.startsWith('/tools/pdf-slicer') && !location.pathname.endsWith('ocr-jobs') && !location.pathname.includes('pending-bank')} icon={Scissors} label="PDF 切分中心" to="/tools/pdf-slicer" collapsed={collapsed} />
          <SidebarItem active={location.pathname.endsWith('ocr-jobs')} icon={ScanSearch} label="OCR 识别队列" to="/tools/pdf-slicer/ocr-jobs" collapsed={collapsed} />
          <SidebarItem active={location.pathname.startsWith('/questions') && location.pathname !== '/questions/new' && location.pathname !== '/questions/basket'} icon={Database} label="题库核心主库" to="/questions" collapsed={collapsed} />
          <SidebarItem active={location.pathname === '/questions/new'} icon={BookOpen} label="新建题目/试卷" to="/questions/new" collapsed={collapsed} />
          <SidebarItem active={location.pathname === '/questions/basket'} icon={ShoppingBag} label="组卷工作台" to="/questions/basket" collapsed={collapsed} />
          <SidebarItem active={location.pathname === '/exports'} icon={DownloadCloud} label="导出记录" to="/exports" collapsed={collapsed} />
          <SidebarItem active={location.pathname.startsWith('/learning-tags')} icon={BookOpenCheck} label="学习标签库" to="/learning-tags" collapsed={collapsed} />
          <SidebarItem active={location.pathname === '/settings'} icon={Settings2} label="系统设置" to="/settings" collapsed={collapsed} />
        </nav>
      </div>

      <div className="space-y-3 pt-4 border-t border-zinc-200 dark:border-zinc-800">
        {collapsed && (
          <div className="flex flex-col gap-2.5 items-center px-1.5">
            <button
              onClick={onThemeToggle}
              className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors cursor-pointer focus:outline-none"
              title={darkMode ? '切换到浅色模式' : '切换到深色模式'}
              type="button"
            >
              {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>
        )}
        {!collapsed && (
          <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/40 p-3 border border-zinc-200 dark:border-zinc-700/20 space-y-1">
            <div className="flex items-center gap-2">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              <span className="text-[9px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase">运行中</span>
            </div>
            <p className="text-[9px] text-zinc-400 dark:text-zinc-500 leading-normal">双端连接 · SQLite 正常</p>
          </div>
        )}
      </div>
    </aside>
  )
}

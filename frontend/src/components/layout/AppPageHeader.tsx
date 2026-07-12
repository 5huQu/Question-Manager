import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

type RouteMeta = {
  section: string
  title: string
}

function routeMeta(pathname: string): RouteMeta {
  if (pathname === '/' || pathname === '/workbench') return { section: '工作空间', title: '概览' }
  if (pathname === '/tools/import') return { section: '工具', title: '资料导入' }
  if (pathname.startsWith('/tools/import/') && pathname.includes('/manual-fix')) return { section: '资料导入', title: '手动修正' }
  if (pathname.startsWith('/tools/import/jobs/') && pathname.endsWith('/questions')) return { section: '资料导入', title: '批次题目' }
  if (pathname.startsWith('/tools/import/jobs/') && pathname.endsWith('/exports')) return { section: '资料导入', title: '批次导出' }
  if (pathname.startsWith('/tools/import/') && pathname.includes('/candidates')) return { section: '资料导入', title: '题目核对' }
  if (pathname.startsWith('/tools/import/jobs/') || pathname.startsWith('/tools/import/documents/')) return { section: '资料导入', title: '批次工作流' }
  if (pathname === '/tools/pdf-slicer') return { section: '工具', title: 'PDF 切分中心' }
  if (pathname.endsWith('/ocr-jobs')) return { section: '工具', title: 'OCR 识别队列' }
  if (pathname.includes('/pending-bank')) return { section: 'PDF 切分', title: '入库确认' }
  if (pathname.includes('/runs/') && pathname.endsWith('/questions')) return { section: 'PDF 切分', title: '识别结果' }
  if (pathname === '/questions/new') return { section: '题库', title: '新建题目' }
  if (pathname === '/questions/basket') return { section: '题库', title: '组卷工作台' }
  if (pathname === '/questions/layout-drafts') return { section: '题库', title: '排版草稿' }
  if (pathname.includes('/markdown-preview')) return { section: '题库', title: 'Markdown 预览' }
  if (pathname.includes('/layout-drafts/')) return { section: '题库', title: '试卷排版' }
  if (pathname.startsWith('/questions/') && pathname !== '/questions') return { section: '题库', title: '题目详情' }
  if (pathname === '/questions') return { section: '题库', title: '主库' }
  if (pathname === '/learning-tags') return { section: '题库', title: '学习标签库' }
  if (pathname === '/exports') return { section: '题库', title: '导出记录' }
  if (pathname === '/settings') return { section: '系统', title: '设置' }
  return { section: '工作空间', title: '当前页面' }
}

export function AppPageHeader({ actions }: { actions?: ReactNode }) {
  const location = useLocation()
  const meta = routeMeta(location.pathname)

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-6">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span className="text-xs font-medium">{meta.section}</span>
        <ChevronRight className="size-3" />
        <span className="text-xs font-medium text-foreground">{meta.title}</span>
      </nav>
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </header>
  )
}

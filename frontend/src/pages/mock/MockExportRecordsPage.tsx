import { useState, useEffect } from 'react'
import {
  Search,
  FileText,
  FileSpreadsheet,
  FileCode2,
  Trash2,
  Download,
  Info,
  Calendar,
  CheckCircle2,
  X,
  FileDown
} from 'lucide-react'
import { getMockExports, deleteMockExport, MockExport } from './mockData'
import { MarkdownContent } from '@/components/MarkdownContent'

export default function MockExportRecordsPage() {
  const [records, setRecords] = useState<MockExport[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [formatFilter, setFormatFilter] = useState<'All' | 'Markdown' | 'PDF' | 'LaTeX'>('All')
  
  // Selected record for details preview dialog
  const [activeRecord, setActiveRecord] = useState<MockExport | null>(null)

  useEffect(() => {
    setRecords(getMockExports())

    const handleExportsChange = (event: Event) => {
      const list = (event as CustomEvent<MockExport[]>).detail
      setRecords(list)
    }
    window.addEventListener('mock-exports-changed', handleExportsChange)
    return () => window.removeEventListener('mock-exports-changed', handleExportsChange)
  }, [])

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent opening detail dialog
    if (confirm('确定要删除这条导出记录吗？此操作不会影响已下载的本地文件。')) {
      deleteMockExport(id)
      if (activeRecord?.id === id) {
        setActiveRecord(null)
      }
    }
  }

  const filteredRecords = records.filter(r => {
    if (searchQuery && !r.title.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false
    }
    if (formatFilter !== 'All' && r.format !== formatFilter) {
      return false
    }
    return true
  })

  return (
    <div className="mock-page-root flex flex-col gap-6 p-6 select-none bg-zinc-50/20 dark:bg-zinc-950 min-h-[calc(100vh-6rem)]">
      
      {/* Top filter bar */}
      <div className="border border-zinc-200 bg-white rounded-lg p-3 dark:border-zinc-800 dark:bg-zinc-900/40 flex flex-col sm:flex-row items-center gap-3 justify-between">
        
        {/* Search */}
        <div className="flex items-center gap-2 border border-zinc-200 dark:border-zinc-800 rounded bg-zinc-50/50 dark:bg-zinc-900 px-2.5 py-1.5 w-full sm:w-80">
          <Search className="size-3.5 text-zinc-400 shrink-0" />
          <input
            type="text"
            placeholder="搜索试卷文档名称..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="border-none bg-transparent outline-none text-xs text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 w-full focus:ring-0 p-0"
          />
        </div>

        {/* Format Selectors */}
        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
          <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-650 uppercase tracking-wider whitespace-nowrap mr-1.5">
            按格式筛选:
          </span>
          {(['All', 'Markdown', 'PDF', 'LaTeX'] as const).map(fmt => (
            <button
              key={fmt}
              onClick={() => setFormatFilter(fmt)}
              className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                formatFilter === fmt
                  ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-950'
                  : 'bg-zinc-100 text-zinc-650 hover:bg-zinc-200 dark:bg-zinc-800/80 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              {fmt === 'All' ? '全部' : fmt}
            </button>
          ))}
        </div>
      </div>

      {/* Main Table view */}
      <div className="border border-zinc-200 rounded-lg bg-white overflow-hidden dark:border-zinc-800 dark:bg-zinc-900/10">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-zinc-50 text-zinc-500 font-medium border-b border-zinc-200 dark:bg-zinc-900/60 dark:border-zinc-800">
              <th className="p-3 w-24 font-mono text-[10px] text-zinc-400">导出编码</th>
              <th className="p-3">试卷文档名称</th>
              <th className="p-3 w-24 text-center">输出格式</th>
              <th className="p-3 w-20 text-center">包含题数</th>
              <th className="p-3 w-32">导出时间</th>
              <th className="p-3 w-24 text-center">状态</th>
              <th className="p-3 w-32 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-zinc-400 text-xs">
                  暂无匹配的试卷导出记录
                </td>
              </tr>
            ) : (
              filteredRecords.map(r => (
                <tr
                  key={r.id}
                  onClick={() => setActiveRecord(r)}
                  className="border-b border-zinc-100 hover:bg-zinc-50/50 cursor-pointer transition-colors dark:border-zinc-850 dark:hover:bg-zinc-850/30"
                >
                  <td className="p-3 font-mono text-[10px] text-zinc-400">#{r.id}</td>
                  <td className="p-3 text-left font-bold text-zinc-850 dark:text-zinc-200">
                    {r.title}
                  </td>
                  <td className="p-3 text-center">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-zinc-200 bg-zinc-50 font-medium dark:border-zinc-800 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400">
                      {r.format === 'Markdown' && <FileCode2 className="size-3 text-zinc-500" />}
                      {r.format === 'PDF' && <FileText className="size-3 text-red-500" />}
                      {r.format === 'LaTeX' && <FileCode2 className="size-3 text-emerald-500" />}
                      {r.format}
                    </span>
                  </td>
                  <td className="p-3 text-center font-mono text-zinc-800 dark:text-zinc-300 font-semibold">
                    {r.questionCount} 题
                  </td>
                  <td className="p-3 text-zinc-500 dark:text-zinc-400">
                    <span className="flex items-center gap-1 text-[11px]">
                      <Calendar className="size-3 text-zinc-400" />
                      {r.date}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30">
                      <CheckCircle2 className="size-3" />
                      生成成功
                    </span>
                  </td>
                  <td className="p-3 text-center" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => alert(`正在调取本地磁盘缓存：\n文件 ${r.title}.${r.format === 'Markdown' ? 'md' : r.format === 'LaTeX' ? 'tex' : 'pdf'} 开始下载。`)}
                        className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                        title="下载此文件"
                      >
                        <Download className="size-3.5" />
                      </button>
                      <button
                        onClick={() => setActiveRecord(r)}
                        className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-650 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                        title="详情预览"
                      >
                        <Info className="size-3.5" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(r.id, e)}
                        className="p-1 rounded hover:bg-red-50 text-zinc-450 hover:text-red-500 dark:hover:bg-red-950/20 dark:hover:text-red-400"
                        title="删除记录"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* DETAILED SHEET PREVIEW DIALOG (Absolute cover layout) */}
      {activeRecord && (
        <div className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm z-50 flex justify-end">
          <div className="bg-white border-l border-zinc-200 dark:border-zinc-800 dark:bg-zinc-900 w-full max-w-xl h-full flex flex-col justify-between shadow-2xl p-6 text-left">
            
            {/* Header */}
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-zinc-800">
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <FileDown className="size-4 text-zinc-400" />
                    试卷大纲结构预览
                  </h3>
                  <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-550">
                    档案编码：#{activeRecord.id}
                  </p>
                </div>
                <button
                  onClick={() => setActiveRecord(null)}
                  className="p-1.5 rounded-md hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Document Specs */}
              <div className="grid grid-cols-3 gap-3 text-xs bg-zinc-50/50 p-3 rounded-lg border border-zinc-100 dark:bg-zinc-950/20 dark:border-zinc-850">
                <div>
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">文档名称</span>
                  <span className="font-bold text-zinc-850 dark:text-zinc-200 block truncate mt-0.5">{activeRecord.title}</span>
                </div>
                <div>
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">输出类型</span>
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200 block mt-0.5">{activeRecord.format}</span>
                </div>
                <div>
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">出卷日期</span>
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200 block mt-0.5">{activeRecord.date}</span>
                </div>
              </div>
            </div>

            {/* Questions list container */}
            <div className="flex-1 overflow-y-auto my-4 pr-1 space-y-3">
              <h4 className="text-[10.5px] font-bold text-zinc-400 dark:text-zinc-650 uppercase tracking-wider mb-2">
                收录的试题大纲 ({activeRecord.questionCount} 道题)
              </h4>

              {activeRecord.questions && activeRecord.questions.length > 0 ? (
                activeRecord.questions.map((q, idx) => (
                  <div
                    key={q.id}
                    className="border border-zinc-100 bg-white rounded-lg p-3.5 dark:border-zinc-850 dark:bg-zinc-900/60 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-[9px] text-zinc-400 dark:text-zinc-500 font-mono">
                      <span className="font-bold text-zinc-800 dark:text-zinc-300">
                        第 {idx + 1} 题 ({q.questionType})
                      </span>
                      <span>ID: #{q.id} · 章节: {q.chapter}</span>
                    </div>
                    <div className="text-zinc-800 dark:text-zinc-200 leading-relaxed truncate font-sans">
                      <MarkdownContent content={q.stemMarkdown.replace(/\$\$?([\s\S]*?)\$\$?/g, ' $1 ').replace(/[\n\r]+/g, ' ')} />
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-zinc-400 text-xs py-8 border border-dashed border-zinc-200 dark:border-zinc-800 rounded">
                  此历史记录包含的题目内容已在本地缓存中清空，可重新导出生成。
                </div>
              )}
            </div>

            {/* Footer buttons */}
            <div className="border-t border-zinc-100 pt-4 flex gap-3 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  alert('试卷下载成功！已保存至系统的默认 Downloads 目录。')
                  setActiveRecord(null)
                }}
                className="flex-1 inline-flex justify-center items-center gap-1 rounded bg-zinc-900 text-zinc-50 hover:bg-zinc-800 text-xs font-semibold py-2 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                <Download className="size-3.5 mr-1" />
                重新下载文件
              </button>
              <button
                type="button"
                onClick={() => setActiveRecord(null)}
                className="inline-flex justify-center items-center gap-1 rounded border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 text-xs font-semibold px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
              >
                关闭预览
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

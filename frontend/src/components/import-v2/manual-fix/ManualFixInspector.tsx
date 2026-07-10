import { AlertTriangle, FileText, Image, Layers, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui'
import { assetUrl } from '@/utils/questionDisplay'
import type { ManualFixRegion, ManualFixTab } from './types'

interface Props {
  activeTab: ManualFixTab
  onTabChange: (tab: ManualFixTab) => void
  candidate: any
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  figures: any[]
  regions: ManualFixRegion[]
  selectedRegionId: string | null
  onStemChange: (value: string) => void
  onAnswerChange: (value: string) => void
  onAnalysisChange: (value: string) => void
  onAddRegion: (kind: ManualFixRegion['kind']) => void
  onDeleteSelected: () => void
  onRegionNoteChange: (value: string) => void
  onCleanHeaderFooter: () => void
  onLocateFigure: (figure: any) => void
  onDeleteFigure: (figure: any) => void
}

const tabs: Array<{ value: ManualFixTab; label: string; icon: typeof FileText }> = [
  { value: 'content', label: '内容', icon: FileText },
  { value: 'regions', label: '选区', icon: Layers },
  { value: 'figures', label: '题图', icon: Image },
]

function problemSummary(candidate: any) {
  const issue = Array.isArray(candidate?.issues) ? candidate.issues[0] : candidate?.issues
  const diagnostic = Array.isArray(candidate?.parseDiagnostics) ? candidate.parseDiagnostics[0] : candidate?.parseDiagnostics
  const reasons = [issue?.message, typeof issue === 'string' ? issue : null, diagnostic?.message, typeof diagnostic === 'string' ? diagnostic : null, candidate?.reviewReason, candidate?.issueSummary, candidate?.errorMessage]
    .filter(Boolean)
    .map(String)
  return reasons[0] || '请对照原始文档，核对题目内容、选区范围和题图归属。'
}

export function ManualFixInspector(props: Props) {
  const selectedRegion = props.regions.find((region) => region.id === props.selectedRegionId)
  return (
    <aside className="xl:col-span-5 flex min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-100 bg-zinc-50/50 p-4 dark:border-zinc-900 dark:bg-zinc-900/10">
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-[13px] font-medium">当前修正任务</p>
            <p className="mt-1 text-xs leading-5">{problemSummary(props.candidate)}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 rounded-lg border border-zinc-200/50 bg-zinc-100/80 p-0.5 dark:border-zinc-800/50 dark:bg-zinc-900/80">
          {tabs.map(({ value, label, icon: Icon }) => (
            <button key={value} type="button" onClick={() => props.onTabChange(value)} className={`flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors ${props.activeTab === value ? 'border border-zinc-200/20 bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`}>
              <Icon className="size-3.5" />{label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {props.activeTab === 'content' && (
          <div className="space-y-4">
            <Editor label="题干内容" value={props.stemMarkdown} onChange={props.onStemChange} rows={9} placeholder="录入或修改识别出的题干内容…" />
            <Editor label="答案" value={props.answerText} onChange={props.onAnswerChange} rows={4} placeholder="录入或修改答案…" />
            <Editor label="解析" value={props.analysisMarkdown} onChange={props.onAnalysisChange} rows={8} placeholder="录入或修改解析过程…" />
            <p className="text-xs leading-5 text-zinc-500">内容使用 Markdown 格式。文本修改将在点击“保存草稿”或“完成修正”时写入。</p>
          </div>
        )}

        {props.activeTab === 'regions' && (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <p className="text-[13px] font-medium text-zinc-500">新增选区</p>
              <p className="text-xs leading-5 text-zinc-500">先在左侧拖出范围，再选择其类型；创建后可拖动边缘继续调整。</p>
              <div className="grid grid-cols-3 gap-2 pt-2">
                <Button size="xs" variant="outline" icon={Plus} onClick={() => props.onAddRegion('question')}>题干</Button>
                <Button size="xs" variant="outline" icon={Plus} onClick={() => props.onAddRegion('solution')}>解析</Button>
                <Button size="xs" variant="outline" icon={Plus} onClick={() => props.onAddRegion('shared_answer_key')}>题图</Button>
              </div>
            </div>
            <div className="border-t border-zinc-100 pt-4 dark:border-zinc-900">
              {selectedRegion ? (
                <div className="space-y-3 rounded-xl border border-zinc-900 bg-zinc-50/40 p-4 dark:border-zinc-100 dark:bg-zinc-900/40">
                  <div className="flex items-center justify-between gap-3">
                    <div><p className="text-sm font-medium">{selectedRegion.questionLabel || '选区'}</p><p className="mt-0.5 text-xs text-zinc-500">第 {selectedRegion.segments[0]?.page || '—'} 页</p></div>
                    <Button size="xs" variant="outline" icon={Trash2} onClick={props.onDeleteSelected}>删除</Button>
                  </div>
                  {selectedRegion.kind === 'shared_answer_key' && <label className="block space-y-1.5"><span className="text-[13px] font-medium text-zinc-500">题图位置</span><select value={selectedRegion.note || 'stem'} onChange={(event) => props.onRegionNoteChange(event.target.value)} className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-950"><option value="stem">题干</option><option value="analysis">解析</option></select></label>}
                </div>
              ) : <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center text-xs text-zinc-400 dark:border-zinc-800">在左侧选择一个图框以查看和调整属性</div>}
            </div>
            <Button variant="outline" size="sm" icon={Trash2} onClick={props.onCleanHeaderFooter}>清理页眉页脚窄条</Button>
          </div>
        )}

        {props.activeTab === 'figures' && (props.figures.length ? <div className="space-y-3">{props.figures.map((figure, index) => { const path = String(figure.path || ''); const renderable = path && !path.trim().startsWith('<'); return <div key={figure.id || `${path}-${index}`} className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3 hover:bg-zinc-50/50 dark:border-zinc-800 dark:hover:bg-zinc-900/30"><button type="button" onClick={() => props.onLocateFigure(figure)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><span className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-white text-[10px] text-zinc-400 dark:border-zinc-800">{renderable ? <img src={assetUrl(path)} alt={`题图 ${index + 1}`} className="h-full w-full object-contain" /> : '内联资源'}</span><span className="min-w-0"><span className="block text-sm font-medium">题图 {index + 1}</span><span className="mt-1 block text-xs text-zinc-500">{figure.usage === 'analysis' ? '解析' : '题干'}{figure.pageNo ? ` · 第 ${figure.pageNo} 页` : ''}</span></span></button><Button size="xs" variant="outline" icon={Trash2} onClick={() => props.onDeleteFigure(figure)}>删除</Button></div>})}</div> : <div className="rounded-xl border border-dashed border-zinc-200 p-12 text-center dark:border-zinc-800"><Image className="mx-auto mb-3 size-8 text-zinc-300 dark:text-zinc-700"/><p className="text-xs text-zinc-400">当前题目暂无题图</p></div>)}
      </div>
    </aside>
  )
}

function Editor({ label, value, onChange, rows, placeholder }: { label: string; value: string; onChange: (value: string) => void; rows: number; placeholder: string }) {
  return <label className="block space-y-1.5"><span className="text-[13px] font-medium text-zinc-500">{label}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} className="w-full resize-y rounded-lg border border-zinc-200 bg-white p-3 font-mono text-sm leading-6 outline-none transition-colors focus:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-100" placeholder={placeholder} /></label>
}

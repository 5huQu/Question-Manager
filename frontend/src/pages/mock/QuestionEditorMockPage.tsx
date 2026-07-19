import { useState } from 'react'
import { AlertTriangle, Columns3, Maximize2, PanelRight, RotateCcw } from 'lucide-react'
import { QuestionContentEditor, type QuestionEditorVariant } from '@/components/questions/editor'
import { useQuestionEditorDraft } from '@/hooks/useQuestionEditorDraft'

const INITIAL_VALUE = {
  stemMarkdown: '已知函数 $f(x)=x^2-2ax+1$，若函数在区间 $[1,3]$ 上单调递增，则实数 $a$ 的取值范围是（　）\n\nA. $a\\leq 1$\nB. $a<1$\nC. $a\\geq 3$\nD. $a>3$',
  answerText: 'A',
  analysisMarkdown: '由二次函数对称轴为 $x=a$，要使 $f(x)$ 在 $[1,3]$ 上单调递增，需满足：\n\n$$\na\\leq 1\n$$\n\n因此选择 A。',
}

const modes: Array<{ value: QuestionEditorVariant; label: string; icon: typeof Maximize2; description: string }> = [
  { value: 'full', label: '完整弹窗', icon: Maximize2, description: '详情与新建页面' },
  { value: 'compact', label: '紧凑侧栏', icon: PanelRight, description: '候选题修正' },
  { value: 'workbench', label: '工作台 Sheet', icon: Columns3, description: '排版局部编辑' },
]

export default function QuestionEditorMockPage() {
  const [variant, setVariant] = useState<QuestionEditorVariant>('full')
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const draft = useQuestionEditorDraft({ entityType: 'mock-question', entityId: variant, initialValue: INITIAL_VALUE, contentRevision: 7 })

  async function save() {
    setSaving(true)
    await new Promise((resolve) => window.setTimeout(resolve, 450))
    setSaving(false)
    if (conflict) throw new Error('服务器内容已更新，请对照最新版本后重试。')
    draft.markSaved()
    setSavedAt(new Date())
  }

  function injectRawMarkdown() {
    draft.updateField('analysisMarkdown', `${draft.value.analysisMarkdown}\n\n> 保留的引用块\n\n<div data-source="legacy">旧版解析标记</div>`)
  }

  const frameClass = variant === 'full'
    ? 'mx-auto h-[min(760px,calc(100vh-14rem))] w-full max-w-5xl'
    : variant === 'compact'
      ? 'ml-auto h-[min(760px,calc(100vh-14rem))] w-full max-w-xl'
      : 'ml-auto h-[min(760px,calc(100vh-14rem))] w-full max-w-2xl'

  return (
    <main className="space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-[13px] font-medium text-zinc-500">开发预览</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">统一题目文本编辑器</h1>
          <p className="mt-1 text-[13px] text-zinc-500">验证三种容器密度、转换提示、冲突状态及深浅色表现。本页不调用 API。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900" onClick={injectRawMarkdown}><AlertTriangle className="size-3.5" />注入转换提示</button>
          <button type="button" aria-pressed={conflict} className={`flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-medium ${conflict ? 'border-red-200 bg-red-50/30 text-red-700 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400' : 'border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300'}`} onClick={() => setConflict((current) => !current)}><RotateCcw className="size-3.5" />模拟版本冲突</button>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="编辑器容器样式">
        {modes.map((mode) => {
          const Icon = mode.icon
          const selected = variant === mode.value
          return (
            <button key={mode.value} type="button" aria-pressed={selected} className={`rounded-xl border p-4 text-left transition-colors ${selected ? 'border-zinc-900 bg-zinc-50/40 dark:border-zinc-100 dark:bg-zinc-900/40' : 'border-zinc-200 bg-white hover:bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/30'}`} onClick={() => setVariant(mode.value)}>
              <div className="flex items-center gap-2"><Icon className="size-4 text-zinc-500" /><span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{mode.label}</span></div>
              <p className="mt-1 text-xs text-zinc-500">{mode.description}</p>
            </button>
          )
        })}
      </section>

      {draft.hasRecoveredDraft ? (
        <div role="status" className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/30 p-3 text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /><p className="text-xs">已恢复本机未保存草稿{draft.recoveredAt ? `（${draft.recoveredAt.toLocaleTimeString()}）` : ''}。保存或重置后将清除恢复记录。</p>
        </div>
      ) : null}
      {savedAt ? <p role="status" className="text-right text-xs text-emerald-700 dark:text-emerald-400">最近保存：{savedAt.toLocaleTimeString()}</p> : null}

      <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/20 p-3 dark:border-zinc-800 dark:bg-zinc-900/10">
        <div className={frameClass}>
          <QuestionContentEditor
            entityKey={`mock:${variant}`}
            value={draft.value}
            savedValue={INITIAL_VALUE}
            onChange={draft.setValue}
            onSave={save}
            variant={variant}
            saving={saving}
            dirty={draft.dirty}
            contentRevision={7}
            conflict={conflict ? { message: '另一处编辑已保存该题目。当前草稿仍保留。', actualContentRevision: 8 } : null}
            title={variant === 'workbench' ? '编辑当前试卷内容' : variant === 'compact' ? '修正候选题内容' : '编辑题目内容'}
            description={variant === 'workbench' ? '默认仅作用于当前试卷；同步题库由业务层显式处理。' : undefined}
          />
        </div>
      </div>
    </main>
  )
}

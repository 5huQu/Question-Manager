import { useMemo, useState, type ComponentType, type SVGProps } from 'react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileText,
  Grid2X2,
  Image,
  IndentDecrease,
  Italic,
  Link2,
  List,
  ListOrdered,
  Menu,
  Minus,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Redo2,
  Search,
  Sigma,
  SlidersHorizontal,
  Strikethrough,
  Underline,
  Undo2,
  X,
} from 'lucide-react'

type Icon = ComponentType<SVGProps<SVGSVGElement>>
type InspectorTab = 'content' | 'style' | 'layout'
type OutlineNode = {
  id: string
  label: string
  detail?: string
  depth: number
  kind: 'heading' | 'card' | 'paragraph'
  expandable?: boolean
}

const OUTLINE_NODES: OutlineNode[] = [
  { id: 'chapter-one', label: 'I. 统一预备知识', depth: 0, kind: 'heading', expandable: true },
  { id: 'orbit', label: 'A. 轨迹方程', depth: 1, kind: 'heading', expandable: true },
  { id: 'concept-card', label: '知识卡片', depth: 2, kind: 'card' },
  { id: 'definition', label: '平面内满足某个几何条件的点...', depth: 3, kind: 'paragraph' },
  { id: 'necessary', label: '必要性：轨迹上的点一定满足...', depth: 3, kind: 'paragraph' },
  { id: 'sufficient', label: '充分性：满足方程的点确实满足...', depth: 3, kind: 'paragraph' },
  { id: 'conic', label: 'B. 三类圆锥曲线的定义', depth: 1, kind: 'heading', expandable: true },
  { id: 'definition-card', label: '核心定义', depth: 2, kind: 'card' },
  { id: 'ellipse', label: '1 椭圆', depth: 3, kind: 'paragraph' },
  { id: 'hyperbola', label: '2 双曲线', depth: 3, kind: 'paragraph' },
  { id: 'unified', label: 'C. 用离心率统一理解三类曲线', depth: 1, kind: 'heading', expandable: true },
  { id: 'ellipse-chapter', label: 'II. 椭圆', depth: 0, kind: 'heading', expandable: true },
]

const INSPECTOR_TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: 'content', label: '内容' },
  { id: 'style', label: '样式' },
  { id: 'layout', label: '布局' },
]

const TOOL_BUTTONS: Array<{ id: string; label: string; Icon: Icon }> = [
  { id: 'bold', label: '加粗', Icon: Bold },
  { id: 'italic', label: '斜体', Icon: Italic },
  { id: 'underline', label: '下划线', Icon: Underline },
  { id: 'strike', label: '删除线', Icon: Strikethrough },
]

function EditorIconButton({
  label,
  Icon,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string
  Icon: Icon
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-8 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-100 dark:bg-blue-950/30 dark:text-blue-300 dark:ring-blue-900'
          : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
      }`}
    >
      <Icon className="size-4" strokeWidth={active ? 2.25 : 1.9} />
    </button>
  )
}

function ToolbarDivider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-zinc-200 dark:bg-zinc-800" />
}

function OutlineGlyph({ kind }: { kind: OutlineNode['kind'] }) {
  if (kind === 'card') return <BookOpen className="size-3.5" />
  if (kind === 'heading') return <ChevronDown className="size-3.5" />
  return <FileText className="size-3.5" />
}

export default function ReferenceDocumentEditorDemoPage() {
  const [title, setTitle] = useState('高三一轮复习：圆锥曲线基本知识与常见结论')
  const [selectedId, setSelectedId] = useState('concept-card')
  const [activeTab, setActiveTab] = useState<InspectorTab>('content')
  const [zoom, setZoom] = useState(100)
  const [toolState, setToolState] = useState<Record<string, boolean>>({ bold: true })
  const [cardTitle, setCardTitle] = useState('知识卡片')
  const [borderEnabled, setBorderEnabled] = useState(true)
  const [cornerRadius, setCornerRadius] = useState(8)
  const [padding, setPadding] = useState(16)
  const [headingLevel, setHeadingLevel] = useState('H4')
  const [insertOpen, setInsertOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [status, setStatus] = useState<'saved' | 'edited'>('saved')

  const selectedLabel = useMemo(
    () => OUTLINE_NODES.find((node) => node.id === selectedId)?.label || '知识卡片',
    [selectedId],
  )

  function markEdited() {
    setStatus('edited')
    window.setTimeout(() => setStatus('saved'), 750)
  }

  function changeTitle(value: string) {
    setTitle(value)
    markEdited()
  }

  function toggleTool(id: string) {
    setToolState((current) => ({ ...current, [id]: !current[id] }))
    markEdited()
  }

  function chooseOutline(node: OutlineNode) {
    setSelectedId(node.id)
    if (node.kind === 'card') setActiveTab('content')
  }

  return (
    <main className="-m-4 flex h-screen min-h-0 flex-col overflow-hidden border-t border-zinc-200 bg-white md:-m-6 dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex h-12 shrink-0 items-center border-b border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-950">
        <button type="button" title="返回文档列表" aria-label="返回文档列表" className="mr-2 flex size-8 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
          <ArrowLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <input
            aria-label="文档标题"
            value={title}
            onChange={(event) => changeTitle(event.target.value)}
            className="block h-6 w-full truncate border-0 bg-transparent px-0 text-sm font-semibold text-zinc-900 outline-none dark:text-zinc-100"
          />
          <span className={`inline-flex items-center gap-1 text-[11px] ${status === 'saved' ? 'text-zinc-400' : 'text-amber-600 dark:text-amber-400'}`}>
            <span className={`size-1.5 rounded-full ${status === 'saved' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {status === 'saved' ? '已保存 · 本地' : '正在保存…'}
          </span>
        </div>
        <div className="hidden items-center gap-1 sm:flex">
          <EditorIconButton label="撤销" Icon={Undo2} disabled />
          <EditorIconButton label="重做" Icon={Redo2} disabled />
          <ToolbarDivider />
          <div className="flex h-8 items-center rounded-md border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-950">
            <EditorIconButton label="缩小" Icon={Minus} onClick={() => setZoom((value) => Math.max(70, value - 10))} />
            <button type="button" onClick={() => setZoom(100)} className="min-w-12 px-1 text-center text-xs font-medium tabular-nums text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-100">{zoom}%</button>
            <EditorIconButton label="放大" Icon={Plus} onClick={() => setZoom((value) => Math.min(140, value + 10))} />
          </div>
          <button type="button" className="ml-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900">
            <Grid2X2 className="size-3.5" />页面视图<ChevronDown className="size-3" />
          </button>
        </div>
        <div className="relative ml-3">
          <button type="button" onClick={() => setInsertOpen((value) => !value)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
            <Plus className="size-3.5" />插入<ChevronDown className="size-3" />
          </button>
          {insertOpen ? (
            <div className="absolute right-0 top-10 z-30 w-44 rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {['文字段落', '知识卡片', '公式', '题目引用', '图片'].map((item) => (
                <button key={item} type="button" onClick={() => { setInsertOpen(false); markEdited() }} className="flex w-full items-center rounded px-2.5 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">{item}</button>
              ))}
            </div>
          ) : null}
        </div>
        <EditorIconButton label="更多操作" Icon={MoreHorizontal} />
      </header>

      <section className="flex h-12 shrink-0 items-center overflow-x-auto border-b border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-950">
        <select aria-label="段落样式" className="h-8 w-28 shrink-0 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
          <option>正文</option><option>标题 1</option><option>标题 2</option>
        </select>
        <select aria-label="字体" className="ml-2 h-8 w-32 shrink-0 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
          <option>思源黑体</option><option>楷体</option><option>宋体</option>
        </select>
        <select aria-label="字号" className="ml-2 h-8 w-20 shrink-0 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"><option>14</option><option>16</option><option>18</option></select>
        <ToolbarDivider />
        {TOOL_BUTTONS.map(({ id, label, Icon }) => <EditorIconButton key={id} label={label} Icon={Icon} active={Boolean(toolState[id])} onClick={() => toggleTool(id)} />)}
        <button type="button" title="文字颜色" aria-label="文字颜色" className="mx-0.5 flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"><span className="border-b-2 border-red-400 px-0.5 text-sm font-semibold">A</span></button>
        <EditorIconButton label="高亮" Icon={SlidersHorizontal} />
        <ToolbarDivider />
        <EditorIconButton label="左对齐" Icon={AlignLeft} active />
        <EditorIconButton label="居中对齐" Icon={AlignCenter} />
        <EditorIconButton label="右对齐" Icon={AlignRight} />
        <EditorIconButton label="两端对齐" Icon={AlignJustify} />
        <ToolbarDivider />
        <EditorIconButton label="项目符号" Icon={List} />
        <EditorIconButton label="编号列表" Icon={ListOrdered} />
        <EditorIconButton label="减少缩进" Icon={IndentDecrease} />
        <ToolbarDivider />
        <button type="button" className="ml-1 inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-zinc-200 px-2.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"><Sigma className="size-3.5" />公式</button>
      </section>

      <div className="min-h-0 flex flex-1 overflow-hidden bg-zinc-50/80 dark:bg-zinc-950">
        <aside className={`${outlineOpen ? 'w-64' : 'w-11'} hidden shrink-0 flex-col border-r border-zinc-200 bg-white transition-[width] duration-150 lg:flex dark:border-zinc-800 dark:bg-zinc-950`}>
          <div className="flex h-14 items-center border-b border-zinc-200 px-3 dark:border-zinc-800">
            {outlineOpen ? <><span className="flex-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">文档大纲</span><button type="button" title="新建章节" aria-label="新建章节" onClick={markEdited} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Plus className="size-4" /></button><button type="button" title="搜索大纲" aria-label="搜索大纲" className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Search className="size-4" /></button></> : <button type="button" title="展开大纲" aria-label="展开大纲" onClick={() => setOutlineOpen(true)} className="mx-auto rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><PanelLeft className="size-4" /></button>}
          </div>
          {outlineOpen ? <>
            <label className="flex h-11 items-center justify-between border-b border-zinc-200 px-4 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">自动章节编号<input type="checkbox" defaultChecked className="size-4 accent-blue-600" /></label>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {OUTLINE_NODES.map((node) => {
                const active = selectedId === node.id
                return <button key={node.id} type="button" onClick={() => chooseOutline(node)} className={`group flex w-full items-center gap-1.5 rounded-md py-1.5 pr-1 text-left text-xs transition-colors ${active ? 'bg-blue-50 text-blue-900 dark:bg-blue-950/30 dark:text-blue-200' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900'}`} style={{ paddingLeft: `${10 + node.depth * 14}px` }}>
                  <span className={`shrink-0 ${active ? 'text-blue-600 dark:text-blue-300' : 'text-zinc-400'}`}><OutlineGlyph kind={node.kind} /></span>
                  <span className="min-w-0 flex-1 truncate">{node.label}</span>
                  {active ? <MoreHorizontal className="size-3.5 shrink-0 text-zinc-400" /> : null}
                </button>
              })}
            </div>
            <div className="border-t border-zinc-200 p-3 dark:border-zinc-800"><button type="button" onClick={markEdited} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-zinc-200 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"><Plus className="size-3.5" />新建章节</button></div>
          </> : null}
          {outlineOpen ? <button type="button" title="收起大纲" aria-label="收起大纲" onClick={() => setOutlineOpen(false)} className="absolute left-[13.5rem] top-[8.2rem] z-20 hidden size-6 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-400 shadow-sm hover:bg-zinc-50 xl:flex dark:border-zinc-700 dark:bg-zinc-900"><ChevronRight className="size-3.5" /></button> : null}
        </aside>

        <section className="min-w-0 flex-1 overflow-auto px-3 py-4 sm:px-5 sm:py-7 md:px-9">
          <div className="mx-auto min-h-[790px] w-[min(100%,760px)] bg-white px-5 py-6 shadow-[0_0_0_1px_rgba(24,24,27,0.08),0_12px_28px_rgba(24,24,27,0.05)] transition-transform sm:px-10 sm:py-9 dark:bg-zinc-900" style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center', marginBottom: `${(zoom - 100) * 6}px` }}>
            <div className="mb-7 flex items-center gap-2 border-b border-zinc-100 pb-5 text-xs text-zinc-400 dark:border-zinc-800"><FileText className="size-3.5" />高三数学 · 圆锥曲线</div>
            <article className={`group relative overflow-hidden border bg-white transition-shadow dark:bg-zinc-950 ${borderEnabled ? 'border-blue-300 shadow-[0_0_0_1px_rgba(59,130,246,0.1)]' : 'border-transparent'} ${cornerRadius === 0 ? 'rounded-none' : 'rounded-lg'}`}>
              <button type="button" title="拖动排序" aria-label="拖动排序" className="absolute -left-7 top-1/2 hidden -translate-y-1/2 rounded p-1 text-zinc-400 hover:bg-zinc-100 group-hover:flex dark:hover:bg-zinc-800"><Menu className="size-4" /></button>
              <div className="flex items-center justify-between border-b border-zinc-100 bg-blue-50/70 px-4 py-2.5 dark:border-zinc-800 dark:bg-blue-950/20">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100"><BookOpen className="size-4 text-blue-700 dark:text-blue-300" /><input aria-label="卡片标题" value={cardTitle} onChange={(event) => { setCardTitle(event.target.value); markEdited() }} className="w-32 bg-transparent outline-none" /></div>
                <button type="button" title="卡片更多操作" aria-label="卡片更多操作" className="rounded p-1 text-zinc-500 hover:bg-blue-100 dark:hover:bg-blue-950"><MoreHorizontal className="size-4" /></button>
              </div>
              <div className="space-y-3 text-[15px] leading-8 text-zinc-700 dark:text-zinc-200" style={{ padding: `${padding}px` }}>
                <p contentEditable suppressContentEditableWarning onInput={markEdited} className="outline-none">平面内满足某个几何条件的点 <em>P</em> 的集合称为轨迹。把点写成 <em>P(x, y)</em>，把几何条件转化为关于 <em>x, y</em> 的代数关系，就可以得到轨迹方程。</p>
                <p contentEditable suppressContentEditableWarning onInput={markEdited} className="outline-none">完整的轨迹推导通常包含两个方向：</p>
                <ul className="space-y-1 pl-5">
                  <li><strong>必要性：</strong>轨迹上的点一定满足所得方程；</li>
                  <li><strong>充分性：</strong>满足方程的点确实满足原几何条件。</li>
                </ul>
                <p contentEditable suppressContentEditableWarning onInput={markEdited} className="outline-none">常见的轨迹方程题型解法：</p>
                <ol className="list-decimal space-y-1 pl-5"><li>求动点，就设该点的坐标为 <em>(x, y)</em>；</li><li>结合题目所给条件进行翻译，并转换成含 <em>(x, y)</em> 的方程，化简即可。</li></ol>
              </div>
            </article>

            <h2 className="mt-7 text-lg font-semibold text-zinc-900 dark:text-zinc-100">B. 三类圆锥曲线的定义</h2>
            <article className="mt-4 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700"><div className="flex items-center gap-2 bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-100"><BookOpen className="size-4" />核心定义</div><div className="space-y-4 px-5 py-4 text-[15px] leading-8 text-zinc-700 dark:text-zinc-200"><section><h3 className="font-semibold">1 椭圆</h3><p className="mt-1">平面内到两个定点 <em>F₁, F₂</em> 的距离之和等于常数 <em>2a</em> 的点的轨迹叫作椭圆。</p></section><section><h3 className="font-semibold">2 双曲线</h3><p className="mt-1">平面内到两个定点 <em>F₁, F₂</em> 的距离的差的绝对值等于常数 <em>2a</em> 的点的轨迹叫作双曲线。</p></section></div></article>
          </div>
        </section>

        <aside className="hidden w-[300px] shrink-0 flex-col border-l border-zinc-200 bg-white xl:flex dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex h-14 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800"><div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100"><BookOpen className="size-4" />{selectedLabel}</div><button type="button" title="关闭属性面板" aria-label="关闭属性面板" className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="size-4" /></button></div>
          <div className="flex border-b border-zinc-200 px-3 dark:border-zinc-800">{INSPECTOR_TABS.map((tab) => <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`flex-1 border-b-2 px-2 py-3 text-xs font-medium transition-colors ${activeTab === tab.id ? 'border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300' : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}>{tab.label}</button>)}</div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {activeTab === 'content' ? <div className="space-y-5"><Field label="模板"><Select value="定义 / 知识点" options={['定义 / 知识点', '方法 / 技巧', '例题', '易错提醒']} onChange={markEdited} /></Field><Field label="标题"><input value={cardTitle} onChange={(event) => { setCardTitle(event.target.value); markEdited() }} className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900" /></Field><Field label="标题级别"><div className="grid grid-cols-4 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700">{['H1', 'H2', 'H3', 'H4'].map((level) => <button key={level} type="button" onClick={() => { setHeadingLevel(level); markEdited() }} className={`h-8 border-r border-zinc-200 text-xs last:border-r-0 dark:border-zinc-700 ${headingLevel === level ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/30 dark:text-blue-300' : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}>{level}</button>)}</div></Field></div> : null}
            {activeTab === 'style' ? <div className="space-y-5"><Field label="背景"><Select value="浅蓝色  #EEF4FF" options={['浅蓝色  #EEF4FF', '白色  #FFFFFF', '浅灰色  #F4F4F5']} onChange={markEdited} /></Field><Field label="边框"><div className="flex items-center justify-between"><span className="text-xs text-zinc-500">显示卡片边框</span><Toggle checked={borderEnabled} onChange={() => { setBorderEnabled((value) => !value); markEdited() }} /></div></Field><Field label="圆角"><div className="flex items-center gap-3"><input aria-label="圆角" type="range" min="0" max="16" step="2" value={cornerRadius} onChange={(event) => { setCornerRadius(Number(event.target.value)); markEdited() }} className="flex-1 accent-zinc-900 dark:accent-zinc-100" /><span className="w-10 text-right text-xs text-zinc-500">{cornerRadius}px</span></div></Field></div> : null}
            {activeTab === 'layout' ? <div className="space-y-5"><Field label="内边距"><div className="grid grid-cols-4 gap-2">{['上', '右', '下', '左'].map((side) => <label key={side} className="text-center text-[10px] text-zinc-400"><input aria-label={`${side}内边距`} type="number" value={padding} onChange={(event) => { setPadding(Number(event.target.value) || 0); markEdited() }} className="mb-1 h-8 w-full rounded-md border border-zinc-200 bg-white px-1 text-center text-xs outline-none dark:border-zinc-700 dark:bg-zinc-900" />{side}</label>)}</div><button type="button" title="联动四边内边距" aria-label="联动四边内边距" className="mt-2 ml-auto flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"><Link2 className="size-3.5" />已联动</button></Field><Field label="分页行为"><Select value="避免分页（尽量保持在同一页）" options={['避免分页（尽量保持在同一页）', '允许跨页', '从新页开始']} onChange={markEdited} /></Field></div> : null}
          </div>
          <div className="border-t border-zinc-200 p-4 text-[11px] text-zinc-400 dark:border-zinc-800">当前为参考图 demo，修改只保存在本页状态。</div>
        </aside>
      </div>

      <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-zinc-200 bg-white px-4 text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950"><span>第 1 页</span><span className="h-3 w-px bg-zinc-200 dark:bg-zinc-800" /><span>A4</span><span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><Check className="size-3" />已保存</span><span className="hidden sm:inline">无溢出</span><span className="ml-auto inline-flex items-center gap-1"><CircleHelp className="size-3" />参考图 demo</span></footer>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300"><span className="mb-2 block">{label}</span>{children}</label>
}

function Select({ value, options, onChange }: { value: string; options: string[]; onChange: () => void }) {
  return <select value={value} onChange={onChange} className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2.5 text-sm font-normal text-zinc-700 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">{options.map((option) => <option key={option}>{option}</option>)}</select>
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return <button type="button" role="switch" aria-checked={checked} onClick={onChange} className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-700'}`}><span className={`absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} /></button>
}

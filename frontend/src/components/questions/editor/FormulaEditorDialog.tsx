import { createElement, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import katex from 'katex'
import { Braces, Code2, FileText, ImagePlus, Sparkles, X } from 'lucide-react'
import { MarkdownContent } from '../../MarkdownContent'

type MathFieldElement = HTMLElement & { value: string; focus(): void }
type MathliveStatus = 'loading' | 'ready' | 'error'

let mathliveSetupPromise: Promise<void> | null = null

function setupMathlive() {
  if (mathliveSetupPromise) return mathliveSetupPromise
  mathliveSetupPromise = import('mathlive').then(({ MathfieldElement }) => {
    MathfieldElement.strings = {
      'zh-CN': {
        'keyboard.tooltip.symbols': '符号',
        'keyboard.tooltip.greek': '希腊字母',
        'keyboard.tooltip.numeric': '数字',
        'keyboard.tooltip.alphabetic': '拉丁字母',
        'tooltip.copy to clipboard': '复制到剪贴板',
        'tooltip.cut to clipboard': '剪切到剪贴板',
        'tooltip.paste from clipboard': '从剪贴板粘贴',
        'tooltip.redo': '重做',
        'tooltip.toggle virtual keyboard': '切换虚拟键盘',
        'tooltip.menu': '菜单',
        'tooltip.undo': '撤销',
        'menu.borders': '矩阵边框',
        'menu.insert matrix': '插入矩阵',
        'menu.array.add row above': '在上方添加行',
        'menu.array.add row below': '在下方添加行',
        'menu.array.add column after': '在右侧添加列',
        'menu.array.add column before': '在左侧添加列',
        'menu.array.delete row': '删除行',
        'menu.array.delete rows': '删除选中行',
        'menu.array.delete column': '删除列',
        'menu.array.delete columns': '删除选中列',
        'menu.mode': '模式',
        'menu.mode-math': '数学',
        'menu.mode-text': '文本',
        'menu.mode-latex': 'LaTeX',
        'menu.insert': '插入',
        'menu.insert.abs': '绝对值',
        'menu.insert.nth-root': 'n 次方根',
        'menu.insert.log-base': '以 a 为底的对数',
        'menu.insert.heading-calculus': '微积分',
        'menu.insert.derivative': '导数',
        'menu.insert.nth-derivative': 'n 阶导数',
        'menu.insert.integral': '积分',
        'menu.insert.sum': '求和',
        'menu.insert.product': '乘积',
        'menu.insert.heading-complex-numbers': '复数',
        'menu.insert.modulus': '模',
        'menu.insert.argument': '幅角',
        'menu.insert.real-part': '实部',
        'menu.insert.imaginary-part': '虚部',
        'menu.insert.conjugate': '共轭',
        'tooltip.blackboard': '黑板粗体',
        'tooltip.bold': '粗体',
        'tooltip.italic': '斜体',
        'tooltip.fraktur': '哥特体',
        'tooltip.script': '手写体',
        'tooltip.caligraphic': '书法体',
        'tooltip.typewriter': '等宽字体',
        'tooltip.roman-upright': '正体',
        'menu.font-style': '字体样式',
        'menu.accent': '重音符号',
        'menu.decoration': '装饰',
        'menu.color': '颜色',
        'menu.background-color': '背景色',
        'menu.evaluate': '计算',
        'menu.simplify': '化简',
        'menu.solve': '求解',
        'menu.solve-for': '求解 %@',
        'menu.cut': '剪切',
        'menu.copy': '复制',
        'menu.copy-as-latex': '复制为 LaTeX',
        'menu.copy-as-typst': '复制为 Typst',
        'menu.copy-as-ascii-math': '复制为 ASCII Math',
        'menu.copy-as-mathml': '复制为 MathML',
        'menu.paste': '粘贴',
        'menu.select-all': '全选',
        'color.red': '红色',
        'color.orange': '橙色',
        'color.yellow': '黄色',
        'color.lime': '黄绿色',
        'color.green': '绿色',
        'color.teal': '青绿色',
        'color.cyan': '青色',
        'color.blue': '蓝色',
        'color.indigo': '靛蓝色',
        'color.purple': '紫色',
        'color.magenta': '洋红色',
        'color.black': '黑色',
        'color.dark-grey': '深灰色',
        'color.grey': '灰色',
        'color.light-grey': '浅灰色',
        'color.white': '白色',
      },
    }
    MathfieldElement.locale = 'zh-CN'
  }).catch((error) => {
    mathliveSetupPromise = null
    throw error
  })
  return mathliveSetupPromise
}

export interface FormulaEditorDialogProps {
  initialLatex?: string
  displayMode?: boolean
  title?: string
  /** 富文本入口需要始终以 Markdown + LaTeX 源码页签开始，而不仅在已检测到公式时。 */
  initialMixedMarkdown?: boolean
  onApply: (latex: string) => void
  /**
   * 提供后显示“混合源码”页签。该页签接收 OCR 常用的 Markdown + LaTeX 源码，
   * 调用方负责将其转换、插入为对应的结构化内容块。
   */
  onApplyMixedMarkdown?: (markdown: string) => void
  /** 混合内容专用：按源码编辑区当前光标拆块并插入独立图片。 */
  onInsertImageAtCursor?: (markdown: string, cursor: number, file: File) => Promise<void>
  onClose: () => void
}

const MIXED_MARKDOWN_MODEL_REQUIREMENTS = String.raw`请输出 Markdown 与 LaTeX 混合源码：

- 普通文字直接使用 Markdown。
- 行内公式使用 $...$。
- 独立公式使用 $$...$$，并在公式前后换行。
- 不要输出完整 LaTeX 文档外壳，如 \documentclass、\begin{document}。
- 保证公式分隔符和花括号成对闭合。
- 不要把普通文字全部放入 \text{...}。
- 输出一段完整源码即可，不需要手动拆分成系统内容块；系统会自动转换。`

const FORMULA_MODEL_REQUIREMENTS = String.raw`请输出可直接渲染的 LaTeX 公式：

- 只输出公式本身，不要使用 $...$、$$...$$ 包裹。
- 不要输出 Markdown 文字、解释、代码围栏或完整 LaTeX 文档外壳。
- 保证公式分隔符、花括号、括号成对闭合。
- 需要在公式中写文字时使用 \text{...}。`

function looksLikeMixedMarkdown(value: string) {
  const source = String(value || '')
  return /(^|[^\\])\${1,2}|\*\*|__|~~|`/.test(source)
}

export function FormulaEditorDialog({
  initialLatex = '',
  displayMode = false,
  title = '编辑公式',
  onApply,
  onApplyMixedMarkdown,
  onInsertImageAtCursor,
  initialMixedMarkdown = false,
  onClose,
}: FormulaEditorDialogProps) {
  const startsInMixedMarkdown = Boolean(onApplyMixedMarkdown && (initialMixedMarkdown || looksLikeMixedMarkdown(initialLatex)))
  const [advanced, setAdvanced] = useState(startsInMixedMarkdown)
  const [mixedMarkdownMode, setMixedMarkdownMode] = useState(startsInMixedMarkdown)
  const [showModelRequirements, setShowModelRequirements] = useState(false)
  const [draft, setDraft] = useState(initialLatex)
  const [mathliveStatus, setMathliveStatus] = useState<MathliveStatus>('loading')
  const mathFieldRef = useRef<MathFieldElement | null>(null)
  const sourceTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [insertingImage, setInsertingImage] = useState(false)
  const [insertImageError, setInsertImageError] = useState('')
  const draftRef = useRef(draft)
  draftRef.current = draft
  const mixedMarkdownDetected = Boolean(onApplyMixedMarkdown && looksLikeMixedMarkdown(draft))
  const visualMixedPreview = !advanced && mixedMarkdownDetected
  const modelRequirements = onApplyMixedMarkdown ? MIXED_MARKDOWN_MODEL_REQUIREMENTS : FORMULA_MODEL_REQUIREMENTS

  useEffect(() => {
    let active = true
    void setupMathlive().then(() => {
      if (active) setMathliveStatus('ready')
    }).catch(() => {
      if (!active) return
      setMathliveStatus('error')
      setAdvanced(true)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (advanced || mixedMarkdownMode || mathliveStatus !== 'ready') return
    const field = mathFieldRef.current
    if (!field) return
    const handleInput = () => setDraft(field.value)
    field.value = draftRef.current
    field.addEventListener('input', handleInput)
    field.focus()
    return () => field.removeEventListener('input', handleInput)
  }, [advanced, mathliveStatus, mixedMarkdownMode])

  function commit() {
    if ((mixedMarkdownMode || visualMixedPreview) && onApplyMixedMarkdown) {
      if (draft.trim()) onApplyMixedMarkdown(draft)
      return
    }
    const latestDraft = !advanced && mathliveStatus === 'ready'
      ? mathFieldRef.current?.value ?? draft
      : draft
    if (!latestDraft.trim()) return
    onApply(latestDraft)
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      commit()
    }
  }

  // Portal 到 body：父级若为带 transform 的 motion 容器（如属性面板），
  // 会俘获 fixed 定位导致弹窗被挤压在局部区域内。
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onKeyDown={handleDialogKeyDown}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-900">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h3>
            <p className="mt-0.5 text-xs text-zinc-500">{onApplyMixedMarkdown ? '支持纯公式与 Markdown + LaTeX 混合源码。' : '支持可视化公式输入与 LaTeX 源码。'}⌘/Ctrl + Enter 应用。</p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" title="查看给模型的项目渲染要求" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50" onClick={() => setShowModelRequirements((current) => !current)}>
              <Sparkles className="size-3.5" />项目渲染要求
            </button>
            <button type="button" aria-label="关闭公式编辑器" className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900" onClick={onClose}><X className="size-4" /></button>
          </div>
        </div>
        <div className="min-h-0 space-y-3 overflow-y-auto p-5">
          <div className="flex rounded-lg border border-zinc-200 bg-zinc-100/80 p-0.5 dark:border-zinc-800 dark:bg-zinc-900/80">
            <button type="button" disabled={mathliveStatus === 'error'} title={mathliveStatus === 'error' ? '可视化公式键盘加载失败，请使用 LaTeX 源码输入' : undefined} className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${!advanced && !mixedMarkdownMode ? 'border border-zinc-200/50 bg-white text-zinc-900 shadow-xs dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500'}`} onClick={() => { setAdvanced(false); setMixedMarkdownMode(false) }}><Braces className="size-3.5" />可视化</button>
            <button type="button" className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium ${advanced && !mixedMarkdownMode ? 'border border-zinc-200/50 bg-white text-zinc-900 shadow-xs dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500'}`} onClick={() => { setAdvanced(true); setMixedMarkdownMode(false) }}><Code2 className="size-3.5" />LaTeX 源码</button>
            {onApplyMixedMarkdown ? (
              <button type="button" className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium ${mixedMarkdownMode ? 'border border-zinc-200/50 bg-white text-zinc-900 shadow-xs dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500'}`} onClick={() => { setAdvanced(true); setMixedMarkdownMode(true) }}><FileText className="size-3.5" />混合源码</button>
            ) : null}
          </div>
          {showModelRequirements ? (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/30">
              <p className="mb-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">给模型的输出要求</p>
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-5 text-zinc-600 dark:text-zinc-400">{modelRequirements}</pre>
            </div>
          ) : null}
          {mathliveStatus === 'error' ? (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
              可视化公式键盘加载失败，已切换到 LaTeX 源码输入。
            </p>
          ) : null}
          {insertImageError ? (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50/40 px-3 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">{insertImageError}</p>
          ) : null}
          {advanced ? (
            <div className="grid min-h-[22rem] grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="flex min-h-0 flex-col rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <div className="border-b border-zinc-100 px-3 py-2 text-[11px] font-medium text-zinc-500 dark:border-zinc-900">{mixedMarkdownMode ? 'Markdown + LaTeX 源码' : 'LaTeX 源码'}</div>
                <textarea ref={sourceTextareaRef} autoFocus aria-label={mixedMarkdownMode ? 'Markdown + LaTeX 源码' : 'LaTeX 源码'} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={mixedMarkdownMode ? '输入 Markdown 文字，并用 $...$ 或 $$...$$ 标记公式' : undefined} className="min-h-[18rem] flex-1 resize-y bg-transparent p-3 font-mono text-sm leading-6 text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50" />
              </div>
              <div className="min-h-0 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/20">
                <div className="mb-2 text-[11px] font-medium text-zinc-500">实时预览</div>
                {mixedMarkdownMode ? (
                  draft.trim() ? <MarkdownContent content={draft} /> : <p className="text-xs italic text-zinc-400">输入混合源码后在此预览。</p>
                ) : (
                  <div className="flex min-h-[16rem] items-center justify-center overflow-x-auto text-center" dangerouslySetInnerHTML={{ __html: katex.renderToString(draft, { displayMode, throwOnError: false, strict: false }) }} />
                )}
              </div>
            </div>
          ) : (
            visualMixedPreview ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 text-left dark:border-zinc-800 dark:bg-zinc-900/20">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-[11px] font-medium text-zinc-500">文档预览</span>
                  <button type="button" className="text-[11px] font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100" onClick={() => { setAdvanced(true); setMixedMarkdownMode(true) }}>编辑混合源码</button>
                </div>
                <MarkdownContent content={draft} />
              </div>
            ) : (
              <div className="grid min-h-[22rem] grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="flex min-h-0 flex-col rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                  <div className="border-b border-zinc-100 px-3 py-2 text-[11px] font-medium text-zinc-500 dark:border-zinc-900">公式键盘</div>
                  {mathliveStatus === 'loading' ? (
                    <div role="status" className="flex min-h-[18rem] flex-1 items-center justify-center text-xs text-zinc-500">正在加载公式键盘…</div>
                  ) : (
                    (() => {
                      const element = createElement('math-field', { 'aria-label': '公式可视化输入' })
                      return <div ref={(host) => {
                        const field = host?.firstElementChild as MathFieldElement | null
                        mathFieldRef.current = field
                      }} className="min-h-[18rem] flex-1 p-3 text-lg">{element}</div>
                    })()
                  )}
                </div>
                <div className="min-h-0 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/20">
                  <div className="mb-2 text-[11px] font-medium text-zinc-500">实时渲染预览</div>
                  <div className="flex min-h-[16rem] items-center justify-center overflow-x-auto text-center" dangerouslySetInnerHTML={{ __html: katex.renderToString(draft, { displayMode, throwOnError: false, strict: false }) }} />
                </div>
              </div>
            )
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-900">
          <div>
            {mixedMarkdownMode && onInsertImageAtCursor ? (
              <label className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 ${insertingImage ? 'pointer-events-none opacity-50' : ''}`}>
                <ImagePlus className="size-4" />
                {insertingImage ? '正在插入…' : '在光标处插图'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
                  className="hidden"
                  disabled={insertingImage}
                  onChange={async (event) => {
                    const file = event.target.files?.[0]
                    if (!file) return
                    const cursor = sourceTextareaRef.current?.selectionStart ?? draft.length
                    setInsertingImage(true)
                    setInsertImageError('')
                    try {
                      await onInsertImageAtCursor(draft, cursor, file)
                      onClose()
                    } catch (error) {
                      setInsertImageError(error instanceof Error ? error.message : '图片插入失败。')
                    } finally {
                      setInsertingImage(false)
                      event.target.value = ''
                    }
                  }}
                />
              </label>
            ) : null}
          </div>
          <div className="flex gap-2">
          <button type="button" className="h-9 rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900" onClick={onClose}>取消</button>
          <button type="button" disabled={!draft.trim()} className="h-9 rounded-md bg-zinc-900 px-4 text-sm font-medium text-zinc-50 hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200" onClick={commit}>{mixedMarkdownMode || visualMixedPreview ? '应用内容' : '应用公式'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

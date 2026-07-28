import { createElement, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import katex from 'katex'
import { Braces, Code2, X } from 'lucide-react'

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
  onApply: (latex: string) => void
  onClose: () => void
}

export function FormulaEditorDialog({
  initialLatex = '',
  displayMode = false,
  title = '编辑公式',
  onApply,
  onClose,
}: FormulaEditorDialogProps) {
  const [advanced, setAdvanced] = useState(false)
  const [draft, setDraft] = useState(initialLatex)
  const [mathliveStatus, setMathliveStatus] = useState<MathliveStatus>('loading')
  const mathFieldRef = useRef<MathFieldElement | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft

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
    if (advanced || mathliveStatus !== 'ready') return
    const field = mathFieldRef.current
    if (!field) return
    const handleInput = () => setDraft(field.value)
    field.value = draftRef.current
    field.addEventListener('input', handleInput)
    field.focus()
    return () => field.removeEventListener('input', handleInput)
  }, [advanced, mathliveStatus])

  function commit() {
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
      <div className="w-full max-w-xl rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-900">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h3>
            <p className="mt-0.5 text-xs text-zinc-500">支持矩阵、分段函数与 LaTeX 源码，⌘/Ctrl + Enter 应用。</p>
          </div>
          <button type="button" aria-label="关闭公式编辑器" className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900" onClick={onClose}><X className="size-4" /></button>
        </div>
        <div className="space-y-3 p-5">
          <div className="flex rounded-lg border border-zinc-200 bg-zinc-100/80 p-0.5 dark:border-zinc-800 dark:bg-zinc-900/80">
            <button type="button" disabled={mathliveStatus === 'error'} title={mathliveStatus === 'error' ? '可视化公式键盘加载失败，请使用 LaTeX 源码输入' : undefined} className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${!advanced ? 'border border-zinc-200/50 bg-white text-zinc-900 shadow-xs dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500'}`} onClick={() => setAdvanced(false)}><Braces className="size-3.5" />可视化</button>
            <button type="button" className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium ${advanced ? 'border border-zinc-200/50 bg-white text-zinc-900 shadow-xs dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500'}`} onClick={() => setAdvanced(true)}><Code2 className="size-3.5" />LaTeX 源码</button>
          </div>
          {mathliveStatus === 'error' ? (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
              可视化公式键盘加载失败，已切换到 LaTeX 源码输入。
            </p>
          ) : null}
          {advanced ? (
            <textarea autoFocus aria-label="LaTeX 源码" value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-32 w-full resize-y rounded-lg border border-zinc-200 bg-white p-3 font-mono text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50" />
          ) : mathliveStatus === 'loading' ? (
            <div role="status" className="flex min-h-20 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50/40 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/20">
              正在加载公式键盘…
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
              {(() => {
                const element = createElement('math-field', { 'aria-label': '公式可视化输入' })
                return <div ref={(host) => {
                  const field = host?.firstElementChild as MathFieldElement | null
                  mathFieldRef.current = field
                }} className="min-h-12 text-lg">{element}</div>
              })()}
            </div>
          )}
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 text-center dark:border-zinc-800 dark:bg-zinc-900/20" dangerouslySetInnerHTML={{ __html: katex.renderToString(draft, { displayMode, throwOnError: false, strict: false }) }} />
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-900">
          <button type="button" className="h-9 rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900" onClick={onClose}>取消</button>
          <button type="button" disabled={!draft.trim()} className="h-9 rounded-md bg-zinc-900 px-4 text-sm font-medium text-zinc-50 hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200" onClick={commit}>应用公式</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

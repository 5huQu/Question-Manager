import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, ExternalLink, Sparkles, X } from 'lucide-react'
import type { AiAssistantQuestionContent } from '@/api/aiAssistant'

export interface AiPromptHelperDialogProps {
  open: boolean
  onClose: () => void
  content?: AiAssistantQuestionContent
  /** Starts the three-field optimization in the parent editor and closes this helper immediately. */
  onOptimizeWithAi?: (content: AiAssistantQuestionContent) => void | Promise<void>
  onCopyStemPdfScreenshot?: () => Promise<void>
  onCopyAnalysisPdfScreenshot?: () => Promise<void>
}

const AI_PLATFORMS = [
  { name: 'Gemini', url: 'https://gemini.google.com', badge: 'Google', color: 'hover:border-blue-300 dark:hover:border-blue-700' },
  { name: 'ChatGPT', url: 'https://chatgpt.com', badge: 'OpenAI', color: 'hover:border-emerald-300 dark:hover:border-emerald-700' },
  { name: '豆包', url: 'https://www.doubao.com', badge: 'ByteDance', color: 'hover:border-sky-300 dark:hover:border-sky-700' },
  { name: 'QwenStudio', url: 'https://bailian.console.aliyun.com', badge: 'Aliyun', color: 'hover:border-slate-400 dark:hover:border-slate-600' },
]

const PROMPT_1_TEXT = `你是 Question Manager 数学题库的 OCR 与排版助手。请将输入的题目截图直接识别并生成可入库的最终 Markdown 正文。

只输出最终 Markdown 正文；不要解释、不要 JSON、不要说明识别过程。最终内容必须用一个 \`\`\`markdown\` 代码块包裹，代码块外不要输出任何文字。

【内容保真】
- 逐字保留题号、小问、条件、选项、分值、单位、标点、推导过程和原有阅读顺序。
- 不解题，不补写缺失条件，不改写题意，不凭数学常识修正无法确认的字符。
- 对无法确认的字符保留为 \`〔待人工确认：原图字符〕\`，不要猜测。
- 保留逻辑连接词和推导层次，例如“设”“由题意可知”“所以”“因此”“故”“证明”。
- 若 field 是题干、答案或解析中的一个字段，去掉该字段最外层重复的“题干：”“答案：”“解析：”标题；但保留“（1）解：”“（2）证明：”等小问结构。

【Markdown 结构】
- 普通段落按原意分段；不同推导阶段之间空一行。
- 在不改变原有内容的前提下，适当进行换行和段落排版，使阅读层次清晰。
- 小问写为“（1）”“（2）”等；选项写为独立行的 \`A. ...\`、\`B. ...\`、\`C. ...\`、\`D. ...\`。
- 普通表格转换为 GFM Markdown 表格；合并单元格无法可靠转换时保留其文字结构并标记 \`〔表格待人工确认〕\`。
- 删除页码、水印、页眉页脚、下载来源、重复标题及 OCR 版面噪声。
- 删除 \`%leaf%\`、\`<!-- Media -->\`、\`<!-- figureText:... -->\`、\`<!-- DOC2X_PAGE:... -->\` 等内部噪声。

【公式：必须遵守】
- 行内公式统一使用 \`$...$\`，一对 \`$\` 只包住一个公式，且不能跨行。
  示例：所以 $p_{2m}=\\frac{1}{2}$。
- 原图中独立成行、居中、较长或多行的公式，使用块级公式；\`$$\` 必须各自独占一行，前后空一行：
  $$
  p_{2(m+1)}=p_2\\times p_{2m}+q_2\\times(1-p_{2m})
  $$
- 绝不能输出 \`$...$$...\`、\`$$...\`、\`$ $...$ $\` 或多个公式共用一对 \`$\`。
- 中文说明必须在公式外。例如：
  所以 $p_{2(m+1)}=...$。

  设 $p_{2(m+1)}+\\lambda=...$，所以 \\lambda=-\\frac{1}{2}。
- 正确使用 LaTeX：\`\\frac{}{}\`、\`\\sqrt{}\`、\`\\times\`、\`\\cdot\`、\`\\lambda\`、\`\\leq\`、\`\\geq\`、\`\\neq\`、上下标和花括号。
- 所有花括号、圆括号、方括号及公式分隔符必须配平。
- 不要把“所以”“设”“其中”“当”等中文文字误放进公式中。

【图片与图形】
- 如果输入已提供 \`<!-- DOC2X_FIGURE:asset_id -->\`，必须逐字原样保留，不能删除、复制、改名或新造。
- 图片标识符必须独立成行，不能放入 \`$...$\` 内。
- 截图中有图形但未提供对应 asset_id 时，保留 \`〔图形待绑定：见原图〕\`，不要编造图片地址或 DOC2X_FIGURE 标识。

【输出前自检】
- 每个 \`$...$\` 都闭合且不跨行。
- 每个块级 \`$$\` 都独占一行。
- 不存在相邻、嵌套或交叠的数学分隔符。
- 不存在 \`%leaf%\` 等内部标记泄漏。
- 中文推导文字没有被吞进公式。
- 已提供的 DOC2X_FIGURE 标识数量和内容完全不变。

输入字段：{{field，例如 analysisMarkdown}}
可用图片标识符（按截图顺序；没有则为空）：{{figure_markers}}
截图：{{image}}`

const PROMPT_2_TEXT = `你是 Question Manager 手动修正界面的 Markdown 格式修复助手。

下面的内容是已 OCR 的单个字段，字段可能为“题干”“答案”或“解析”。只修复当前粘贴字段；不得将题干、答案、解析混合，不得补写其他字段。请在不改变题意、数学含义、推导步骤、题号、小问、选项、分值和图片标识符的前提下，对其进行最小必要修正，使它能在 Markdown + KaTeX 中稳定渲染。

只输出修正后的 Markdown 正文；不要解释、不要 JSON、不要列出修改说明。最终内容必须用一个 \`\`\`markdown\` 代码块包裹，代码块外不要输出任何文字。

【修复范围】
- 只修复 OCR 引入的格式、换行、公式分隔符、明显 LaTeX 排版、版面噪声和可明确判断的字符错误。
- 不解题，不补公式，不简化或改写推导，不根据上下文猜测不清楚的字或符号。
- 无法确认时保留原内容，并写成 \`〔待人工确认：原内容〕\`。
- 当前字段为“题干”时，保留题目条件、小问、选项和作答要求；当前字段为“答案”时，只保留最终答案；当前字段为“解析”时，保留解题步骤和证明过程。
- 输出时不要保留输入开头的“题干：”“答案：”或“解析：”字段标签；只输出该字段的修正后内容。

【公式分隔符修复规则】
1. 行内公式统一为 \`$...$\`，每对 \`$\` 仅包裹一条行内公式，且不能跨行。
2. 块级公式统一为：
   $$
   公式内容
   $$
   其中开始和结束的 \`$$\` 必须各自独占一行。
3. 将 \`\\(...\\)\` 规范为 \`$...$\`；将 \`\\[...\\]\` 规范为独占行的 \`$$...$$\`。
4. 必须拆开交叠或粘连的分隔符，尤其是：
   - \`$...$$...\`
   - \`$$...\`
   - \`$ $...$ $\`
   - 因缺少 \`$\` 而把“所以”“设”“因此”等中文吞入公式的情况。
5. “所以”“设”“由题意可知”“因此”“故”等文字必须放在公式外。
6. 不要为了补齐某个 \`$\` 而让公式跨越另一条公式、段落或中文句子。

【LaTeX 修复规则】
- 修复可明确判断的分式、上下标、括号和希腊字母格式，例如：
  - \`p_2m\` → \`p_{2m}\`（仅在上下标边界明确时）
  - \`\\frac13\` → \`\\frac{1}{3}\`（仅在原图或语法明确时）
  - \`\\lambda\`、\`\\times\`、\`\\cdot\`、\`\\sqrt{}\` 等正确保留。
- 检查花括号、圆括号、方括号是否配平。
- 不使用自定义宏、Word 域代码或 OCR 控制符。
- 删除 \`%leaf%\`、\`<!-- Media -->\`、\`<!-- figureText:... -->\`、\`<!-- DOC2X_PAGE:... -->\` 等内部噪声。

【结构与图片】
- 保留小问、选项、分值和原段落；在不同推导阶段之间补适当空行。
- 在不改变原有内容的前提下，适当进行换行和段落排版，使阅读层次清晰。
- 已有 \`<!-- DOC2X_FIGURE:asset_id -->\` 必须逐字原样保留，位置不随意变动，不能放进公式。
- 不新造图片标识符、题号、答案、条件或图形描述。

【最后检查】
- 所有 \`$...$\` 已闭合且不跨行。
- 所有 \`$$\` 独占行。
- 没有 \`$...$$...\` 等交叠公式。
- “所以”“设”等中文不在数学定界符内。
- 内容可直接粘贴进手动修正编辑器的 Markdown 源码模式。

当前字段：{{field，例如 题干 / 答案 / 解析}}
原截图（如有，用于核对）：{{image}}
待修正 OCR 稿：
{{ocr_markdown}}`

const PROMPT_TEMPLATES = [
  {
    id: 'direct_import',
    title: '1. 截图直接生成可入库稿',
    shortTitle: '截图生成可入库稿',
    content: PROMPT_1_TEXT,
  },
  {
    id: 'ocr_fix',
    title: '2. 已 OCR 稿的格式修正',
    shortTitle: '已 OCR 稿格式修正',
    content: PROMPT_2_TEXT,
  },
]

const OCR_FIELDS = [
  { key: 'stemMarkdown', label: '题干' },
  { key: 'answerText', label: '答案' },
  { key: 'analysisMarkdown', label: '解析' },
] as const

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

export function AiPromptHelperDialog({
  open,
  onClose,
  content = { stemMarkdown: '', answerText: '', analysisMarkdown: '' },
  onOptimizeWithAi,
  onCopyStemPdfScreenshot,
  onCopyAnalysisPdfScreenshot,
}: AiPromptHelperDialogProps) {
  const [activeTab, setActiveTab] = useState<string>('direct_import')
  const [copied, setCopied] = useState<'prompt' | 'stem-screenshot' | 'analysis-screenshot' | 'ocr-stemMarkdown' | 'ocr-answerText' | 'ocr-analysisMarkdown' | null>(null)
  const [copyError, setCopyError] = useState('')

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const selectedTemplate = PROMPT_TEMPLATES.find((t) => t.id === activeTab) || PROMPT_TEMPLATES[0]

  const handleCopy = async () => {
    try {
      await copyText(selectedTemplate.content)
      setCopyError('')
      setCopied('prompt')
      setTimeout(() => setCopied(null), 2000)
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : '复制提示词失败。')
    }
  }

  async function copyPdfScreenshot(kind: 'stem' | 'analysis') {
    const action = kind === 'stem' ? onCopyStemPdfScreenshot : onCopyAnalysisPdfScreenshot
    if (!action) return
    try {
      await action()
      setCopyError('')
      setCopied(kind === 'stem' ? 'stem-screenshot' : 'analysis-screenshot')
      setTimeout(() => setCopied(null), 2600)
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : `复制${kind === 'stem' ? '题干' : '解析'}截图失败。`)
    }
  }

  async function copyOcrField(field: typeof OCR_FIELDS[number]) {
    try {
      await copyText(`${field.label}：\n${content[field.key].trim()}`)
      setCopyError('')
      setCopied(`ocr-${field.key}`)
      setTimeout(() => setCopied(null), 2000)
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : `复制${field.label}识别稿失败。`)
    }
  }

  function startAiOptimization() {
    onClose()
    void onOptimizeWithAi?.(content)
  }

  return createPortal(
    <div
      className="question-edit-glass-backdrop fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="question-edit-glass-dialog flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-black/10 bg-white/85 shadow-2xl backdrop-blur-2xl backdrop-saturate-150 dark:border-white/12 dark:bg-zinc-950/85"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <header className="question-edit-glass-inner-header flex flex-none items-center justify-between border-b border-black/6 px-5 py-4 dark:border-white/8">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-xl bg-zinc-900/10 text-zinc-900 dark:bg-zinc-100/15 dark:text-zinc-100">
              <Sparkles className="size-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">AI 提示词辅助</h2>
              <p className="text-xs text-zinc-500">包含可入库稿与格式修正两套 Prompt 模板，并提供常用 AI 工具入口</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-zinc-50 transition-colors"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* AI Platforms Links */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-zinc-500">常用 AI 平台快捷入口</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {AI_PLATFORMS.map((platform) => (
                <a
                  key={platform.name}
                  href={platform.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`group flex items-center justify-between rounded-xl border border-black/6 bg-white/70 px-3 py-2 text-xs font-medium text-zinc-800 transition-all hover:bg-white hover:shadow-xs dark:border-white/8 dark:bg-zinc-900/70 dark:text-zinc-200 dark:hover:bg-zinc-900 ${platform.color}`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{platform.name}</span>
                    <span className="rounded bg-zinc-100 px-1 py-0.2 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{platform.badge}</span>
                  </div>
                  <ExternalLink className="size-3 text-zinc-400 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 shrink-0 ml-1" />
                </a>
              ))}
            </div>
          </div>

          {/* Prompt Selector Tabs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">选择提示词模板</span>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white shadow-xs transition-all hover:bg-zinc-800 active:scale-95 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {copied === 'prompt' ? <Check className="size-3.5 text-emerald-400 dark:text-emerald-600" /> : <Copy className="size-3.5" />}
                <span>{copied === 'prompt' ? '已复制到剪贴板' : '一键复制当前提示词'}</span>
              </button>
            </div>
            <div className="grid grid-cols-2 rounded-xl border border-black/6 bg-zinc-100/70 p-1 dark:border-white/8 dark:bg-zinc-900/70">
              {PROMPT_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tpl.id)
                    setCopied(null)
                    setCopyError('')
                  }}
                  className={`flex h-8.5 items-center justify-center rounded-lg text-xs font-medium transition-all ${
                    activeTab === tpl.id
                      ? 'border border-black/6 bg-white text-zinc-900 shadow-xs dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-50 font-semibold'
                      : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  {tpl.shortTitle}
                </button>
              ))}
            </div>
            {activeTab === 'direct_import' ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200/80 bg-sky-50/55 px-3 py-2.5 text-xs dark:border-sky-900/50 dark:bg-sky-950/20">
                <span className="text-sky-900 dark:text-sky-200">按已保存的 PDF 选区复制原图，可直接粘贴到 AI。</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!onCopyStemPdfScreenshot}
                    onClick={() => { void copyPdfScreenshot('stem') }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-sky-200 bg-white px-3 font-medium text-sky-800 transition-colors hover:bg-sky-100 disabled:pointer-events-none disabled:opacity-45 dark:border-sky-800 dark:bg-zinc-950 dark:text-sky-200 dark:hover:bg-sky-950/70"
                  >
                    {copied === 'stem-screenshot' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied === 'stem-screenshot' ? '题干截图已复制' : '复制题干截图'}
                  </button>
                  <button
                    type="button"
                    disabled={!onCopyAnalysisPdfScreenshot}
                    onClick={() => { void copyPdfScreenshot('analysis') }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-sky-200 bg-white px-3 font-medium text-sky-800 transition-colors hover:bg-sky-100 disabled:pointer-events-none disabled:opacity-45 dark:border-sky-800 dark:bg-zinc-950 dark:text-sky-200 dark:hover:bg-sky-950/70"
                  >
                    {copied === 'analysis-screenshot' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied === 'analysis-screenshot' ? '解析截图已复制' : '复制解析截图'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-200/80 bg-violet-50/55 px-3 py-2.5 text-xs dark:border-violet-900/50 dark:bg-violet-950/20">
                <span className="text-violet-900 dark:text-violet-200">按字段复制当前识别稿，分别交给格式修正提示词处理。</span>
                <div className="flex flex-wrap gap-2">
                  {OCR_FIELDS.map((field) => {
                    const copiedField = copied === `ocr-${field.key}`
                    return (
                      <button
                        key={field.key}
                        type="button"
                        onClick={() => { void copyOcrField(field) }}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 font-medium text-violet-800 transition-colors hover:bg-violet-100 dark:border-violet-800 dark:bg-zinc-950 dark:text-violet-200 dark:hover:bg-violet-950/70"
                      >
                        {copiedField ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copiedField ? `${field.label}已复制` : `复制${field.label}`}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            {copyError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">{copyError}</p> : null}
          </div>

          {/* Selected Prompt Text Box */}
          <div className="relative overflow-hidden rounded-xl border border-black/6 bg-zinc-900 text-zinc-100 dark:border-white/10 dark:bg-zinc-950 shadow-inner">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5 bg-zinc-950/60 text-xs text-zinc-400">
              <span className="font-mono text-[11px] text-slate-300 dark:text-slate-400">{selectedTemplate.title}</span>
              <span>Markdown 格式</span>
            </div>
            <pre className="max-h-[380px] overflow-y-auto p-4 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words text-zinc-200 selection:bg-slate-700/50">
              {selectedTemplate.content}
            </pre>
          </div>
        </div>

        {/* Modal Footer */}
        <footer className="question-edit-glass-footer flex items-center justify-end gap-2 border-t border-black/6 px-5 py-3 dark:border-white/8">
          <button
            type="button"
            onClick={startAiOptimization}
            disabled={!onOptimizeWithAi}
            className="inline-flex h-8.5 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-4 text-xs font-medium text-violet-800 shadow-xs transition-all hover:bg-violet-100 active:scale-95 disabled:pointer-events-none disabled:opacity-55 dark:border-violet-800 dark:bg-violet-950/35 dark:text-violet-200 dark:hover:bg-violet-950/60"
          >
            <Sparkles className="size-3.5" />
            <span>AI助手</span>
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex h-8.5 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-xs font-medium text-white shadow-xs transition-all hover:bg-zinc-800 active:scale-95 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {copied === 'prompt' ? <Check className="size-3.5 text-emerald-400 dark:text-emerald-600" /> : <Copy className="size-3.5" />}
            <span>{copied === 'prompt' ? '已复制到剪贴板' : '一键复制提示词'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-8.5 rounded-lg border border-black/10 px-4 text-xs font-medium text-zinc-700 hover:bg-black/5 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/10"
          >
            关闭
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}

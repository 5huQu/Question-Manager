import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { QuestionItem } from '@/types'
import type { QuestionBlock } from '@/types/teachingDocument'
import { MarkdownContent } from '@/components/MarkdownContent'
import { FormulaBlock, FormulaInline } from '@/components/questions/editor/FormulaNode'
import { editorJsonToMarkdown, markdownToEditorHtml } from '@/components/questions/editor/markdownAdapter'
import { InlineContent } from '@/components/teaching-document/blocks/InlineContent'
import { renderTeachingDocumentKatex } from '@/utils/teachingDocument/katexCache'
import { createQuestionRuntimeModel } from '@/utils/teachingDocument/layout/questionRegions'
import { normalizeLatexMathDelimiters } from '@/utils/mathMarkdown'
import { scanMathDelimiters } from '@/utils/mathDelimiterScanner'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import katex from 'katex'

type MathSemanticToken = {
  latex: string
  displayMode: boolean
}

function question(stemMarkdown: string): QuestionItem {
  return {
    id: 'math-conformance-question',
    serialNo: null,
    questionNo: '',
    stage: '高中',
    questionType: '解答题',
    difficultyScore: 3,
    difficultyScore10: 6,
    difficultyLabel: '中等',
    chapter: '',
    knowledgePoints: [],
    solutionMethods: [],
    sourceTitle: '',
    bankStatus: 'ready',
    stemMarkdown,
    answerText: '',
    analysisMarkdown: '',
    totalScore: 0,
    scoringRubric: [],
    sliceImagePath: '',
    figures: [],
    sourceRunId: '',
    updatedAt: '',
    hasFigures: false,
  }
}

function extractEditorTokens(markdown: string): MathSemanticToken[] {
  // RichMarkdownEditor deliberately stays in source mode for fenced code and
  // other raw structures, so its visual formula adapter is not entered.
  if (/```|<\/?[a-z][^>]*>|<!--\s*DOC2X_FIGURE:[^>\s]+\s*-->/i.test(markdown)) return []
  const editor = new Editor({
    extensions: [StarterKit.configure({ codeBlock: false }), FormulaInline, FormulaBlock],
    content: markdownToEditorHtml(markdown),
  })
  try {
    const tokens: MathSemanticToken[] = []
    const visit = (node: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
      if (node.type === 'formulaInline' || node.type === 'formulaBlock') {
        tokens.push({ latex: String(node.attrs?.latex || ''), displayMode: node.type === 'formulaBlock' })
      }
      for (const child of node.content || []) visit(child as typeof node)
    }
    visit(editor.getJSON())
    return tokens
  } finally {
    editor.destroy()
  }
}

function extractQuestionBankTokens(markdown: string): MathSemanticToken[] {
  const container = renderQuestionBank(markdown)
  return Array.from(container.querySelectorAll('annotation[encoding="application/x-tex"]')).map((annotation) => ({
    latex: annotation.textContent || '',
    displayMode: Boolean(annotation.closest('.katex-display')),
  }))
}

function renderQuestionBank(markdown: string) {
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(<MarkdownContent content={markdown} />)
  return container
}

function extractTeachingDocumentTokens(markdown: string): MathSemanticToken[] {
  const block: QuestionBlock = { type: 'question', id: 'math-conformance-block', questionId: 'math-conformance-question' }
  const model = createQuestionRuntimeModel(block, question(markdown))
  return model.regions.flatMap((region) => {
    if (region.kind === 'math') return [{ latex: region.latex, displayMode: true }]
    if (region.kind === 'markdown') return extractQuestionBankTokens(region.markdown)
    if (region.kind !== 'paragraph') return []
    return region.paragraph.content.flatMap((inline) => inline.type === 'inlineMath'
      ? [{ latex: inline.latex, displayMode: false }]
      : [])
  })
}

function extractSharedScannerTokens(markdown: string): MathSemanticToken[] {
  return scanMathDelimiters(normalizeLatexMathDelimiters(markdown)).flatMap((segment) => segment.type === 'math'
    ? [{ latex: segment.latex, displayMode: segment.displayMode }]
    : [])
}

function editorRoundTrip(markdown: string) {
  const editor = new Editor({
    extensions: [StarterKit.configure({ codeBlock: false }), FormulaInline, FormulaBlock],
    content: markdownToEditorHtml(markdown),
  })
  try {
    return editorJsonToMarkdown(editor.getJSON())
  } finally {
    editor.destroy()
  }
}

function editorKatexOutcome(latex: string, displayMode: boolean) {
  try {
    katex.renderToString(latex, { displayMode, throwOnError: true, strict: false })
    return { rendered: true, errorFallback: false }
  } catch {
    const fallback = katex.renderToString(latex, { displayMode, throwOnError: false, strict: false })
    return { rendered: false, errorFallback: fallback.includes('katex-error') }
  }
}

function questionBankKatexOutcome(latex: string, displayMode = false) {
  const markdown = displayMode ? `$$\n${latex}\n$$` : `$${latex}$`
  const container = renderQuestionBank(markdown)
  const invalid = Boolean(container.querySelector('[aria-invalid="true"], .katex-error'))
  return {
    rendered: !invalid,
    visibleError: container.textContent?.includes('公式格式有误') || false,
  }
}

function teachingKatexOutcome(latex: string) {
  const directHtml = renderTeachingDocumentKatex(latex, false)
  const rendered = renderToStaticMarkup(<InlineContent inlines={[{ type: 'inlineMath', latex }]} />)
  return {
    rendered: Boolean(directHtml),
    visibleSourceFallback: rendered.includes('公式格式有误') && rendered.includes(latex),
  }
}

const conformingFixtures = [
  ['basic inline', '$x+1$'],
  ['multiple inline', '由 $a=1$ 得 $b=2$'],
  ['adjacent inline', '$a=1$，$b=2$，所以 $a+b=3$'],
  ['multiline block', '$$\nx+1\n$$'],
  ['multiline block followed by inline', '$$\nx=1\n$$\n\n所以 $y=2$。'],
  ['cases', '$$\n\\begin{cases}\nx=1\\\\\ny=2\n\\end{cases}\n$$'],
  ['aligned', '$$\n\\begin{aligned}\na&=1\\\\\nb&=2\n\\end{aligned}\n$$'],
  ['fraction', '$\\frac{1}{2}$'],
  ['root', '$\\sqrt{x}$'],
  ['sum', '$\\sum_{i=1}^{n} i$'],
  ['inline delimiter alias', '\\(x+1\\)'],
  ['block delimiter alias', '\\[\nx+1\n\\]'],
  ['escaped dollar', '价格为 \\$100'],
  ['inline code', '示例 `$x+1$`'],
  ['inline code only', '`$x$`'],
  ['inline code with a block delimiter', '`$$x$$`'],
  ['ordinary text plus inline code with a block delimiter', '示例 `$$x+1$$`'],
  ['inline code with a real formula', '示例 `$x$`，实际公式为 $y$。'],
  ['multiple inline code spans with a real formula', '`$a$` + `$$b$$` + $c$'],
  ['multiple-backtick inline code', '`` `$x$` ``'],
  ['multiple-backtick inline code with a block delimiter', '`` `$$x$$` ``'],
  ['fenced code', '```tex\n$x+1$\n```'],
  ['fenced code with display delimiters', '```md\n$$\nx\n$$\n```'],
  ['fenced JavaScript code with inline delimiters', '```js\nconst formula = "$x$";\n```'],
  ['inline code plus a real block formula', '示例 `$$x$$`\n\n$$\ny=2\n$$'],
  ['single-line display math', '$$x+1$$'],
  ['single-line display math followed by inline math', '$$x$$ 后接 $y$'],
] as const

const parserDifferenceFixtures = [
] as const

const canonicalDelimiterFixtures = [
  {
    name: 'single-line display math',
    markdown: '$$x+1$$',
    expected: [{ latex: 'x+1', displayMode: true }],
  },
  {
    name: 'single-line display math followed by inline math',
    markdown: '$$x$$ 后接 $y$',
    expected: [{ latex: 'x', displayMode: true }, { latex: 'y', displayMode: false }],
  },
  {
    name: 'malformed double-dollar delimiter remains text',
    markdown: '$$x$',
    expected: [],
  },
  {
    name: 'malformed inline delimiter remains text',
    markdown: '$x',
    expected: [],
  },
  {
    name: 'isolated dollar remains text',
    markdown: '$',
    expected: [],
  },
  {
    name: 'isolated double dollar remains text',
    markdown: '$$',
    expected: [],
  },
] as const

const codeProtectionFixtures = [
  {
    name: 'inline code containing inline delimiters',
    markdown: '`$x$`',
    expected: [],
  },
  {
    name: 'inline code containing block delimiters',
    markdown: '`$$x$$`',
    expected: [],
  },
  {
    name: 'ordinary text plus inline code containing block delimiters',
    markdown: '示例 `$$x+1$$`',
    expected: [],
  },
  {
    name: 'inline code and a real block formula',
    markdown: '示例 `$$x$$`\n\n$$\ny=2\n$$',
    expected: [{ latex: 'y=2', displayMode: true }],
  },
  {
    name: 'inline code and a real inline formula',
    markdown: '示例 `$x$`，真正公式是 $y$。',
    expected: [{ latex: 'y', displayMode: false }],
  },
  {
    name: 'multiple code spans and a real inline formula',
    markdown: '`$a$` + `$$b$$` + $c$',
    expected: [{ latex: 'c', displayMode: false }],
  },
  {
    name: 'a multi-backtick code span containing backticks and block delimiters',
    markdown: '`` `$$x$$` ``',
    expected: [],
  },
  {
    name: 'a fenced block containing display delimiters',
    markdown: '```md\n$$\nx\n$$\n```',
    expected: [],
  },
  {
    name: 'a fenced JavaScript block containing inline delimiters',
    markdown: '```js\nconst formula = "$x$";\n```',
    expected: [],
  },
] as const

const katexCapabilityFixtures = [
  ['fraction', '\\frac{1}{2}', false],
  ['root', '\\sqrt{x}', false],
  ['sum', '\\sum_{i=1}^{n} i', false],
  ['cases', '\\begin{cases}x=1\\\\y=2\\end{cases}', true],
  ['aligned', '\\begin{aligned}a&=1\\\\b&=2\\end{aligned}', true],
] as const

const invalidLatexFixtures = [
  {
    name: 'missing brace',
    latex: '\\frac{1',
    editor: { rendered: false, errorFallback: true },
    questionBank: { rendered: false, visibleError: true },
    teachingDocument: { rendered: false, visibleSourceFallback: true },
  },
  {
    name: 'unsupported command',
    latex: '\\notARealCommand',
    // KaTeX 0.17 represents an unknown control sequence with colored fallback
    // text rather than the katex-error class, even though FormulaNode catches it.
    editor: { rendered: false, errorFallback: false },
    questionBank: { rendered: false, visibleError: true },
    teachingDocument: { rendered: false, visibleSourceFallback: true },
  },
  {
    name: 'missing environment closure',
    latex: '\\begin{cases}x=1',
    editor: { rendered: false, errorFallback: true },
    questionBank: { rendered: false, visibleError: true },
    teachingDocument: { rendered: false, visibleSourceFallback: true },
  },
] as const

describe('math pipeline conformance', () => {
  it.each(conformingFixtures)('extracts equivalent math semantics for %s', (_name, markdown) => {
    const shared = extractSharedScannerTokens(markdown)
    const editor = extractEditorTokens(markdown)
    const questionBank = extractQuestionBankTokens(markdown)
    const teachingDocument = extractTeachingDocumentTokens(markdown)

    expect(editor).toEqual(shared)
    expect(questionBank).toEqual(shared)
    expect(teachingDocument).toEqual(shared)
  })

  it.each(parserDifferenceFixtures)('records current parser behavior for $name', ({ markdown, editor, questionBank, teachingDocument }) => {
    expect(extractEditorTokens(markdown)).toEqual(editor)
    expect(extractQuestionBankTokens(markdown)).toEqual(questionBank)
    expect(extractTeachingDocumentTokens(markdown)).toEqual(teachingDocument)
  })

  it.each(canonicalDelimiterFixtures)('enforces the canonical delimiter contract for $name', ({ markdown, expected }) => {
    expect(extractSharedScannerTokens(markdown)).toEqual(expected)
    expect(extractEditorTokens(markdown)).toEqual(expected)
    expect(extractQuestionBankTokens(markdown)).toEqual(expected)
    expect(extractTeachingDocumentTokens(markdown)).toEqual(expected)
  })

  it.each(codeProtectionFixtures)('keeps code delimiters out of every math pipeline for $name', ({ markdown, expected }) => {
    expect(extractSharedScannerTokens(markdown)).toEqual(expected)
    expect(extractEditorTokens(markdown)).toEqual(expected)
    expect(extractQuestionBankTokens(markdown)).toEqual(expected)
    expect(extractTeachingDocumentTokens(markdown)).toEqual(expected)
  })

  it.each([...conformingFixtures, ...parserDifferenceFixtures.map(({ name, markdown }) => [name, markdown] as const)])('preserves editor token semantics through the round-trip for %s', (_name, markdown) => {
    expect(extractEditorTokens(editorRoundTrip(markdown))).toEqual(extractEditorTokens(markdown))
  })

  it.each(katexCapabilityFixtures)('renders the shared KaTeX capability fixture %s in all three entry points', (_name, latex, displayMode) => {
    expect(editorKatexOutcome(latex, displayMode)).toEqual({ rendered: true, errorFallback: false })
    expect(questionBankKatexOutcome(latex, displayMode)).toEqual({ rendered: true, visibleError: false })
    expect(renderTeachingDocumentKatex(latex, displayMode)).not.toBe('')
  })

  it.each(invalidLatexFixtures)('records the current invalid-LaTeX error policy for $name', ({ latex, editor, questionBank, teachingDocument }) => {
    expect(editorKatexOutcome(latex, false)).toEqual(editor)
    expect(questionBankKatexOutcome(latex)).toEqual(questionBank)
    expect(teachingKatexOutcome(latex)).toEqual(teachingDocument)
  })
})

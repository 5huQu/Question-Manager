import katex from 'katex'
import { KATEX_STRICT } from './katexPolicy'

export type MathRenderValidation =
  | { valid: true }
  | { valid: false; reason: 'latex'; message?: string }

export type MathRenderResult = {
  html: string
  validation: MathRenderValidation
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** Validate and render with the same KaTeX acceptance policy used by direct renderers. */
export function renderKatexWithStatus(latex: string, displayMode: boolean): MathRenderResult {
  try {
    return {
      html: katex.renderToString(latex, { displayMode, throwOnError: true, strict: KATEX_STRICT }),
      validation: { valid: true },
    }
  } catch (error) {
    let html = ''
    try {
      html = katex.renderToString(latex, { displayMode, throwOnError: false, strict: KATEX_STRICT })
    } catch {
      // Keep the source-only fallback when KaTeX cannot produce fallback HTML.
    }
    return {
      html,
      validation: { valid: false, reason: 'latex', message: errorMessage(error) },
    }
  }
}

export function validateKatex(latex: string, displayMode: boolean): MathRenderValidation {
  return renderKatexWithStatus(latex, displayMode).validation
}

type HastNode = {
  type?: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

type HastFile = { data?: Record<string, unknown> }

const VALIDATION_DATA_KEY = 'questionManagerMathValidation'

function classNames(node: HastNode) {
  const value = node.properties?.className
  return Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(/\s+/) : []
}

function textContent(node: HastNode): string {
  if (node.type === 'text') return node.value || ''
  return (node.children || []).map(textContent).join('')
}

function walk(node: HastNode, callback: (node: HastNode, ancestors: HastNode[]) => void, ancestors: HastNode[] = []) {
  callback(node, ancestors)
  for (const child of node.children || []) walk(child, callback, [...ancestors, node])
}

function mathElement(node: HastNode) {
  if (node.type !== 'element') return null
  const classes = classNames(node)
  if (!classes.includes('math-inline') && !classes.includes('math-display') && !classes.includes('language-math')) return null
  return {
    latex: textContent(node),
    displayMode: classes.includes('math-display') || (classes.includes('language-math') && !classes.includes('math-inline')),
  }
}

function validationKey(latex: string, displayMode: boolean) {
  return `${displayMode ? 'display' : 'inline'}\u0000${latex}`
}

/** Collect math validation before rehype-katex replaces source nodes. */
export function rehypeCollectMathValidation() {
  return (tree: HastNode, file: HastFile) => {
    const statuses = new Map<string, MathRenderValidation>()
    walk(tree, (node) => {
      const math = mathElement(node)
      if (!math) return
      statuses.set(validationKey(math.latex, math.displayMode), validateKatex(math.latex, math.displayMode))
    })
    file.data ||= {}
    file.data[VALIDATION_DATA_KEY] = statuses
  }
}

/** Apply collected status to the generated KaTeX wrapper using HAST metadata. */
export function rehypeApplyMathValidation() {
  return (tree: HastNode, file: HastFile) => {
    const statuses = file.data?.[VALIDATION_DATA_KEY]
    if (!(statuses instanceof Map)) return
    walk(tree, (node, ancestors) => {
      if (node.type !== 'element' || node.tagName !== 'annotation') return
      const properties = node.properties || {}
      if (String(properties.encoding || '') !== 'application/x-tex') return
      const latex = textContent(node)
      const displayMode = ancestors.some((ancestor) => classNames(ancestor).includes('katex-display'))
      const validation = statuses.get(validationKey(latex, displayMode)) as MathRenderValidation | undefined
      if (!validation || validation.valid) return
      const target = [...ancestors].reverse().find((ancestor) => {
        const classes = classNames(ancestor)
        return classes.includes('katex') || classes.includes('katex-error') || classes.includes('katex-display')
      })
      if (!target) return
      target.properties ||= {}
      target.properties['data-math-invalid'] = 'true'
      target.properties['data-math-source'] = latex
    })
  }
}

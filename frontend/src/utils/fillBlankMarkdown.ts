import type { Element, Text as HastText } from 'hast'
import type { Nodes, Parent, Root as MdastRoot, Text } from 'mdast'
import type { Plugin } from 'unified'

/**
 * Fill-in-the-blank markers are stored in stem markdown as runs of three or
 * more underscores (`___`). CommonMark treats a pair of `___` as a bold-italic
 * emphasis delimiter, so react-markdown would silently consume the underscores
 * (and any text between two blanks). These helpers claim such underscore runs
 * as literal "blank" nodes and render them as visible underline blanks, keeping
 * the preview consistent with the TipTap editor (which shows them as text).
 */

const MIN_BLANK_RUN = 3
const UNDERSCORE = 95 // `_`

interface TokenizeContext {
  sliceSerialize(token: { start: unknown; end: unknown }): string
}

const blankUnderscoreSyntax = {
  text: {
    [UNDERSCORE]: {
      add: 'before' as const,
      tokenize(this: TokenizeContext, effects: any, ok: any, nok: any) {
        let size = 0
        return start
        function start(code: number) {
          if (code !== UNDERSCORE) return nok(code)
          effects.enter('blankUnderscore')
          return inside(code)
        }
        function inside(code: number) {
          if (code === UNDERSCORE) {
            size += 1
            effects.consume(code)
            return inside
          }
          if (size >= MIN_BLANK_RUN) {
            effects.exit('blankUnderscore')
            return ok(code)
          }
          return nok(code)
        }
      },
    },
  },
}

const blankUnderscoreFromMarkdown = {
  enter: {
    blankUnderscore(this: any, token: any) {
      this.enter({ type: 'text', value: this.sliceSerialize(token) }, token)
    },
  },
  exit: {
    blankUnderscore(this: any, token: any) {
      this.exit(token)
    },
  },
}

/** Remark plugin: parse runs of 3+ underscores into `blank` mdast nodes. */
export const remarkFillBlank: Plugin<[], MdastRoot> = function remarkFillBlank() {
  const data = this.data() as Record<string, unknown>
  const micromarkExtensions = (data.micromarkExtensions as unknown[]) || (data.micromarkExtensions = [])
  const fromMarkdownExtensions = (data.fromMarkdownExtensions as unknown[]) || (data.fromMarkdownExtensions = [])
  micromarkExtensions.push(blankUnderscoreSyntax)
  fromMarkdownExtensions.push(blankUnderscoreFromMarkdown)

  return (tree: MdastRoot) => {
    visitTextNodes(tree)
  }
}

function visitTextNodes(node: Nodes) {
  if (!('children' in node)) return
  const parent = node as Parent
  const next: any[] = []
  for (const child of parent.children) {
    if (child.type === 'text') {
      next.push(...splitBlanks(child as Text))
    } else {
      visitTextNodes(child)
      next.push(child)
    }
  }
  parent.children = next
}

function splitBlanks(node: Text): any[] {
  const value = node.value || ''
  if (!value.includes('_'.repeat(MIN_BLANK_RUN))) return [node]
  const parts = value.split(/(_{3,})/)
  const result: any[] = []
  for (const part of parts) {
    if (!part) continue
    if (/^_{3,}$/.test(part)) {
      result.push({ type: 'blank', data: { count: part.length } })
    } else {
      result.push({ type: 'text', value: part } as Text)
    }
  }
  return result
}

/**
 * remark-rehype handler mapping a `blank` mdast node to a `<span data-blank>`
 * element. Pass via `remarkRehypeOptions.handlers.blank`. The underscore text is
 * kept as a no-JS / copy fallback; the React component styles it as a blank.
 */
export function blankNodeToHast(node: any): Element {
  const count = Number(node?.data?.count) || MIN_BLANK_RUN
  return {
    type: 'element',
    tagName: 'blank',
    properties: { dataBlank: String(count) },
    children: [{ type: 'text', value: '_'.repeat(count) } as HastText],
  }
}

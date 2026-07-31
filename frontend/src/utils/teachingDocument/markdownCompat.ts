/**
 * Markdown → TeachingBlock[] 兼容适配
 *
 * 设计原则：
 * - 不修改现有 stemMarkdown / answerText / analysisMarkdown 的事实来源地位
 * - 转换失败或遇到不支持结构时保留原文为 rawMarkdown 块
 * - 明确标注：paragraph / blockMath 转换是无损的；复杂结构降级为 rawMarkdown
 * - 不让 Markdown → JSON → Markdown 往返破坏旧内容
 */

import type {
  ParagraphBlock,
  BlockMathBlock,
  RawMarkdownBlock,
  TeachingBlock,
  TeachingInline,
} from '@/types/teachingDocument'
import { generateBlockId } from './validate'
import { normalizeLatexMathDelimiters } from '@/utils/mathMarkdown'

// ─── 行内解析 ────────────────────────────────────────────────────────────────

/** 将包含 $...$ 的文本解析为 TeachingInline[] */
export function parseInlineMarkdown(text: string): TeachingInline[] {
  const nodes: TeachingInline[] = []
  let cursor = 0

  while (cursor < text.length) {
    // 换行
    if (text[cursor] === '\n') {
      nodes.push({ type: 'hardBreak' })
      cursor += 1
      continue
    }
    // 行内公式 $...$（非 $$）
    if (text[cursor] === '$' && text[cursor + 1] !== '$' && (cursor === 0 || text[cursor - 1] !== '\\')) {
      let end = cursor + 1
      while (end < text.length) {
        if (text[end] === '$' && text[end - 1] !== '\\') break
        end += 1
      }
      if (end < text.length && end > cursor + 1) {
        nodes.push({ type: 'inlineMath', latex: text.slice(cursor + 1, end) })
        cursor = end + 1
        continue
      }
    }
    // 普通文本：累积到下一个特殊字符
    let next = cursor + 1
    while (next < text.length && text[next] !== '$' && text[next] !== '\n') {
      next += 1
    }
    nodes.push({ type: 'text', text: text.slice(cursor, next) })
    cursor = next
  }

  return nodes
}

// ─── 块级解析 ────────────────────────────────────────────────────────────────

/**
 * 判断一行是否为"简单段落"（不含标题、列表、引用、代码围栏、HTML 等复杂结构）。
 * 简单段落可以无损转为 ParagraphBlock。
 */
function isSimpleParagraphLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  // 标题
  if (/^#{1,6}\s/.test(trimmed)) return false
  // 列表
  if (/^[-+*]\s/.test(trimmed)) return false
  if (/^\d+[.)]\s/.test(trimmed)) return false
  // 引用
  if (/^>/.test(trimmed)) return false
  // 代码围栏
  if (/^```|^~~~/.test(trimmed)) return false
  // HTML 标签
  if (/^<\/?[A-Za-z]/.test(trimmed)) return false
  // HTML 注释
  if (/^<!--/.test(trimmed)) return false
  // 图片语法（独立行）
  if (/^!\[[^\]]*\]\(/.test(trimmed)) return false
  // 水平线
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return false
  return true
}

/**
 * 判断文本是否包含 Markdown 格式标记（粗体、斜体、删除线、行内代码）。
 * 含这些标记的文本当前降级为 rawMarkdown（第一阶段不解析 marks）。
 */
function hasInlineFormatting(text: string): boolean {
  return /(?:\*\*|__|~~|`)[^\n]+(?:\*\*|__|~~|`)/.test(text)
}

function isBlockMathDelimiter(line: string) {
  return line.trim() === '$$'
}

function findBlockMathClosingDelimiter(lines: string[], start: number) {
  for (let index = start + 1; index < lines.length; index += 1) {
    if (isBlockMathDelimiter(lines[index])) return index
  }
  return -1
}

export interface MarkdownConversionResult {
  blocks: TeachingBlock[]
  /** 是否完全无损转换 */
  lossless: boolean
  /** 降级说明 */
  warnings: string[]
}

/**
 * 将普通 Markdown 内容转换为 TeachingBlock[]。
 *
 * 无损转换：纯文本段落、行内公式、块级公式。
 * 降级展示：含格式标记、列表、表格、标题、HTML 等复杂结构保留为 rawMarkdown。
 *
 * 此函数不会抛出异常；任何解析失败都会降级为 rawMarkdown。
 */
export function markdownToTeachingBlocks(source: string): MarkdownConversionResult {
  const warnings: string[] = []
  let lossless = true

  try {
    const normalized = normalizeLatexMathDelimiters(String(source ?? '').replace(/\r\n?/g, '\n'))
    const lines = normalized.split('\n')
    const blocks: TeachingBlock[] = []
    let cursor = 0

    while (cursor < lines.length) {
      // 跳过空行
      if (!lines[cursor].trim()) {
        cursor += 1
        continue
      }

      // 块级公式 $$...$$（多行）
      if (isBlockMathDelimiter(lines[cursor])) {
        const end = findBlockMathClosingDelimiter(lines, cursor)
        if (end >= 0) {
          const latex = lines.slice(cursor + 1, end).join('\n')
          blocks.push({
            type: 'blockMath',
            id: generateBlockId('math'),
            latex,
          } satisfies BlockMathBlock)
          cursor = end + 1
          continue
        }
        lossless = false
        const rawText = lines.slice(cursor).join('\n')
        warnings.push('块级公式缺少结束分隔符，已保留剩余原文。')
        blocks.push({
          type: 'rawMarkdown',
          id: generateBlockId('md'),
          markdown: rawText,
          reason: 'fallback',
        } satisfies RawMarkdownBlock)
        break
      }

      // 块级公式 $$...$$（单行）
      const singleLineMath = lines[cursor].match(/^\s*\$\$(.+)\$\$\s*$/)
      if (singleLineMath) {
        blocks.push({
          type: 'blockMath',
          id: generateBlockId('math'),
          latex: singleLineMath[1].trim(),
        } satisfies BlockMathBlock)
        cursor += 1
        continue
      }

      // 尝试收集连续简单段落行
      if (isSimpleParagraphLine(lines[cursor])) {
        const paragraphLines: string[] = [lines[cursor]]
        cursor += 1
        while (cursor < lines.length && lines[cursor].trim() && isSimpleParagraphLine(lines[cursor])) {
          // 如果下一行是 $$ 开头则停止
          if (isBlockMathDelimiter(lines[cursor]) || /^\s*\$\$.+\$\$\s*$/.test(lines[cursor])) break
          paragraphLines.push(lines[cursor])
          cursor += 1
        }
        const text = paragraphLines.join('\n')

        // 含格式标记则降级
        if (hasInlineFormatting(text)) {
          lossless = false
          warnings.push('含 Markdown 格式标记（粗体/斜体等），已降级为原文展示。')
          blocks.push({
            type: 'rawMarkdown',
            id: generateBlockId('md'),
            markdown: text,
            reason: 'unsupported-structure',
          } satisfies RawMarkdownBlock)
        } else {
          blocks.push({
            type: 'paragraph',
            id: generateBlockId('p'),
            content: parseInlineMarkdown(text),
          } satisfies ParagraphBlock)
        }
        continue
      }

      // 其他复杂结构：收集到下一个空行，整体降级为 rawMarkdown
      const complexLines: string[] = [lines[cursor]]
      cursor += 1
      while (cursor < lines.length && lines[cursor].trim()) {
        // 遇到 $$ 或简单段落则停止
        if (isBlockMathDelimiter(lines[cursor]) || /^\s*\$\$.+\$\$\s*$/.test(lines[cursor])) break
        if (isSimpleParagraphLine(lines[cursor]) && !hasInlineFormatting(lines[cursor])) break
        complexLines.push(lines[cursor])
        cursor += 1
      }
      lossless = false
      const rawText = complexLines.join('\n')
      warnings.push(`复杂 Markdown 结构（标题/列表/表格/HTML 等）已保留为原文: "${rawText.slice(0, 40)}..."`)
      blocks.push({
        type: 'rawMarkdown',
        id: generateBlockId('md'),
        markdown: rawText,
        reason: 'unsupported-structure',
      } satisfies RawMarkdownBlock)
    }

    // 如果完全没有产出，保留整体原文
    if (!blocks.length && normalized.trim()) {
      lossless = false
      blocks.push({
        type: 'rawMarkdown',
        id: generateBlockId('md'),
        markdown: normalized,
        reason: 'fallback',
      })
    }

    return { blocks, lossless, warnings }
  } catch (error) {
    // 任何异常：完整保留原文
    return {
      blocks: [{
        type: 'rawMarkdown',
        id: generateBlockId('md'),
        markdown: String(source ?? ''),
        reason: 'fallback',
      }],
      lossless: false,
      warnings: [`转换异常，已保留原文: ${error instanceof Error ? error.message : String(error)}`],
    }
  }
}

/**
 * 将 TeachingBlock[] 中可逆的块转回 Markdown。
 * 仅处理 paragraph / blockMath / rawMarkdown；其他块返回空字符串。
 * 用于验证往返安全性。
 */
export function teachingBlocksToMarkdown(blocks: TeachingBlock[]): string {
  return blocks.map((block) => {
    switch (block.type) {
      case 'paragraph':
        return block.content.map((inline) => {
          if (inline.type === 'text') return inline.text
          if (inline.type === 'inlineMath') return `$${inline.latex}$`
          return '\n'
        }).join('')
      case 'blockMath':
        return `$$\n${block.latex}\n$$`
      case 'rawMarkdown':
        return block.markdown
      default:
        return ''
    }
  }).filter(Boolean).join('\n\n')
}

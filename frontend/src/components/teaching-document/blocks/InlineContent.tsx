/**
 * 行内内容渲染器：文本、行内公式、换行
 * 复用项目现有 KaTeX 渲染能力
 *
 * marks 渲染使用纯 React 元素组合，不使用 dangerouslySetInnerHTML。
 * 文本始终作为 React 文本节点输出，不允许 mark 注入标签或事件属性。
 */

import { useMemo, type ReactNode } from 'react'
import type { TeachingInline, InlineMark } from '@/types/teachingDocument'
import { fontStackById } from '@/utils/teachingDocument/lectureFonts'
import { renderTeachingDocumentKatex } from '@/utils/teachingDocument/katexCache'
import {
  sliceTeachingInlines,
  TEACHING_DOM,
  type InlineRange,
  type SlicedTeachingInline,
} from '@/utils/teachingDocument/layout'

// ─── 行内公式 ────────────────────────────────────────────────────────────────

function InlineMathSpan({ latex }: { latex: string }) {
  const html = useMemo(() => {
    return renderTeachingDocumentKatex(latex, false)
  }, [latex])

  if (!html) {
    return (
      <span className="td-inline-math-error" title="公式格式有误">
        <code className="rounded bg-amber-50 px-1 text-amber-900 dark:bg-amber-950/30 dark:text-amber-400">{latex || '∅'}</code>
        <span className="text-[10px] text-amber-700">公式格式有误</span>
      </span>
    )
  }
  // KaTeX renderToString 输出是受控的 HTML（非用户输入），此处使用 dangerouslySetInnerHTML 是安全的
  return <span className="td-inline-math" dangerouslySetInnerHTML={{ __html: html }} />
}

// ─── Marks 渲染（纯 React 元素） ─────────────────────────────────────────────

const VALID_MARKS: ReadonlySet<string> = new Set(['bold', 'italic', 'underline', 'strikethrough', 'code'])

/**
 * 将文本按 marks 枚举用确定的 React 标签包裹。
 * 文本始终作为 React 文本节点，不拼接 HTML 字符串。
 * 未知 mark 的原值由解析层保留，并在此显示确定的降级提示。
 */
function wrapWithMarks(text: string, marks?: InlineMark[]): ReactNode {
  if (!marks?.length) return text

  let result: ReactNode = text
  // 按从内到外的顺序包裹
  for (const mark of marks) {
    if (!VALID_MARKS.has(mark)) continue
    switch (mark) {
      case 'code':
        result = <code className="rounded bg-zinc-100 px-1 py-0.5 text-[0.9em] dark:bg-zinc-800">{result}</code>
        break
      case 'bold':
        result = <strong>{result}</strong>
        break
      case 'italic':
        result = <em>{result}</em>
        break
      case 'underline':
        result = <u>{result}</u>
        break
      case 'strikethrough':
        result = <s>{result}</s>
        break
    }
  }
  return result
}

function TextSpan({ text, marks, font, fontSize, unknownMarks }: { text: string; marks?: InlineMark[]; font?: string; fontSize?: Extract<TeachingInline, { type: 'text' }>['fontSize']; unknownMarks?: unknown[] }) {
  const content = wrapWithMarks(text, marks)
  // 行内字体覆盖：fontStackById 对未知 id 返回 undefined → 不加样式、继承默认字体
  const stack = fontStackById(font)
  const fontStyle = (stack || fontSize) ? { ...(stack ? { fontFamily: stack } : {}), ...(fontSize ? { fontSize: `${fontSize}px` } : {}) } : undefined
  if (!unknownMarks?.length) return <span style={fontStyle} {...{ [TEACHING_DOM.inlineContent]: '' }}>{content}</span>
  return (
    <span
      className="td-inline-degraded rounded-sm border-b border-dotted border-amber-500"
      data-unknown-mark-count={unknownMarks.length}
      style={fontStyle}
      title={`${unknownMarks.length} 个文本格式暂不支持，原始 mark 已保留`}
    >
      <span {...{ [TEACHING_DOM.inlineContent]: '' }}>{content}</span>
      <span className="sr-only">（存在暂不支持的文本格式）</span>
    </span>
  )
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

export function InlineContent({ inlines, range }: { inlines: TeachingInline[]; range?: InlineRange }) {
  const rendered: SlicedTeachingInline[] = range
    ? sliceTeachingInlines(inlines, range)
    : inlines.map((inline, sourceInlineIndex) => ({ inline, sourceInlineIndex }))
  return (
    <>
      {rendered.map(({ inline, sourceInlineIndex, textStartOffset }) => {
        const contract = {
          [TEACHING_DOM.inline]: '',
          [TEACHING_DOM.inlineIndex]: sourceInlineIndex,
          [TEACHING_DOM.inlineType]: inline.type,
          [TEACHING_DOM.inlineAtomic]: inline.type === 'text' ? undefined : 'true',
          [TEACHING_DOM.inlineTextStart]: inline.type === 'text' ? textStartOffset || 0 : undefined,
        }
        const key = `${sourceInlineIndex}:${textStartOffset || 0}`
        switch (inline.type) {
          case 'text':
            return (
              <span key={key} {...contract}>
                <TextSpan text={inline.text} marks={inline.marks} font={inline.font} fontSize={inline.fontSize} unknownMarks={inline.unknownMarks} />
              </span>
            )
          case 'inlineMath':
            return <span key={key} {...contract}><InlineMathSpan latex={inline.latex} /></span>
          case 'hardBreak':
            return <span key={key} {...contract}><br /></span>
          case 'unknown':
            return (
              <span
                key={key}
                className="td-inline-unknown mx-0.5 rounded border border-dashed border-amber-300 bg-amber-50 px-1 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                data-original-type={inline.originalType}
                title="原始行内数据已保留"
                {...contract}
              >
                未支持的行内内容：{inline.originalType}
              </span>
            )
          default:
            return null
        }
      })}
    </>
  )
}

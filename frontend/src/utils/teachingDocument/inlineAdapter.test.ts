import { describe, expect, it } from 'vitest'
import type { TeachingInline } from '@/types/teachingDocument'
import {
  hasProtectedInlineContent,
  pastedHtmlToSafeInlines,
  protectedInlineReason,
  teachingInlinesToTiptapDoc,
  tiptapDocToTeachingInlines,
} from './inlineAdapter'

/** 往返断言：inlines → tiptap → inlines 无损且确定 */
function expectRoundTrip(inlines: TeachingInline[]): TeachingInline[] {
  const doc = teachingInlinesToTiptapDoc(inlines)
  const result = tiptapDocToTeachingInlines(doc)
  expect(result).toEqual(inlines)
  // 确定性：多次序列化结果一致
  const doc2 = teachingInlinesToTiptapDoc(result)
  expect(JSON.stringify(doc2)).toBe(JSON.stringify(doc))
  const result2 = tiptapDocToTeachingInlines(doc2)
  expect(JSON.stringify(result2)).toBe(JSON.stringify(result))
  return result
}

describe('inlineAdapter: TeachingInline[] ↔ Tiptap 序列化', () => {
  it('纯文本往返', () => {
    expectRoundTrip([{ type: 'text', text: '已知函数 f(x) 的定义域为全体实数。' }])
  })

  it('空内容往返保持合法', () => {
    const doc = teachingInlinesToTiptapDoc([])
    expect(doc).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: undefined }] })
    expect(tiptapDocToTeachingInlines(doc)).toEqual([])
  })

  it('五种 marks 分别往返', () => {
    for (const mark of ['bold', 'italic', 'underline', 'strikethrough', 'code'] as const) {
      expectRoundTrip([{ type: 'text', text: '标记文本', marks: [mark] }])
    }
  })

  it('混合 marks 往返且顺序确定', () => {
    const inlines: TeachingInline[] = [
      { type: 'text', text: '普通' },
      { type: 'text', text: '粗斜体', marks: ['bold', 'italic'] },
      { type: 'text', text: '删除线代码', marks: ['strikethrough', 'code'] },
      { type: 'text', text: '全部', marks: ['bold', 'italic', 'underline', 'strikethrough', 'code'] },
    ]
    expectRoundTrip(inlines)
    // 即使命中顺序不同，输出 marks 按规范顺序排列
    const shuffled: TeachingInline[] = [
      { type: 'text', text: '全部', marks: ['code', 'underline', 'bold', 'strikethrough', 'italic'] },
    ]
    const result = tiptapDocToTeachingInlines(teachingInlinesToTiptapDoc(shuffled))
    expect(result).toEqual([
      { type: 'text', text: '全部', marks: ['bold', 'italic', 'underline', 'strikethrough', 'code'] },
    ])
  })

  it('inlineMath 前后文本往返', () => {
    expectRoundTrip([
      { type: 'text', text: '设 ' },
      { type: 'inlineMath', latex: 'f(x) = x^2 + 1' },
      { type: 'text', text: '，求导得 ' },
      { type: 'inlineMath', latex: "f'(x) = 2x" },
      { type: 'text', text: '。' },
    ])
  })

  it('inlineMath 空 latex 往返', () => {
    expectRoundTrip([{ type: 'inlineMath', latex: '' }])
  })

  it('hardBreak 往返', () => {
    expectRoundTrip([
      { type: 'text', text: '第一行' },
      { type: 'hardBreak' },
      { type: 'text', text: '第二行' },
      { type: 'hardBreak' },
      { type: 'text', text: '第三行' },
    ])
  })

  it('marks + inlineMath + hardBreak 混合往返', () => {
    expectRoundTrip([
      { type: 'text', text: '重点', marks: ['bold'] },
      { type: 'text', text: '：' },
      { type: 'inlineMath', latex: '\\frac{a}{b}' },
      { type: 'hardBreak' },
      { type: 'text', text: '斜体注释', marks: ['italic'] },
    ])
  })

  it('同一输入序列化确定（重复 5 次一致）', () => {
    const inlines: TeachingInline[] = [
      { type: 'text', text: '确定', marks: ['bold', 'italic'] },
      { type: 'inlineMath', latex: 'e^{i\\pi}+1=0' },
      { type: 'hardBreak' },
      { type: 'text', text: '尾部' },
    ]
    const baseline = JSON.stringify(teachingInlinesToTiptapDoc(inlines))
    for (let i = 0; i < 5; i++) {
      expect(JSON.stringify(teachingInlinesToTiptapDoc(inlines))).toBe(baseline)
    }
  })
})

describe('inlineAdapter: unknown 保护模式', () => {
  it('UnknownInline 完整保留 originalType 与 rawData', () => {
    const rawData = { custom: 'widget', nested: { values: [1, 2, 3] }, flag: null }
    const inlines: TeachingInline[] = [
      { type: 'text', text: '前面' },
      { type: 'unknown', originalType: 'customWidget', rawData },
      { type: 'text', text: '后面' },
    ]
    const result = expectRoundTrip(inlines)
    expect(result[1]).toEqual({ type: 'unknown', originalType: 'customWidget', rawData })
  })

  it('UnknownInline rawData 为 null 时保留', () => {
    const inlines: TeachingInline[] = [
      { type: 'unknown', originalType: 'brokenNode', rawData: null },
    ]
    expectRoundTrip(inlines)
  })

  it('unknownMarks 完整保留且不丢失已知 marks', () => {
    const unknownMark = { type: 'highlight', attrs: { color: 'yellow' } }
    const inlines: TeachingInline[] = [
      { type: 'text', text: '带未知标记', marks: ['bold'], unknownMarks: [unknownMark] },
    ]
    const result = expectRoundTrip(inlines)
    expect(result[0]).toEqual({ type: 'text', text: '带未知标记', marks: ['bold'], unknownMarks: [unknownMark] })
  })

  it('多个 unknownMarks 保持顺序', () => {
    const markA = { type: 'markA', attrs: {} }
    const markB = { type: 'markB', attrs: { deep: [true] } }
    const inlines: TeachingInline[] = [
      { type: 'text', text: '双未知', unknownMarks: [markA, markB] },
    ]
    const result = expectRoundTrip(inlines)
    expect(result[0]).toEqual({ type: 'text', text: '双未知', unknownMarks: [markA, markB] })
  })

  it('hasProtectedInlineContent 检测 unknown inline 与 unknownMarks', () => {
    expect(hasProtectedInlineContent([{ type: 'text', text: '安全' }])).toBe(false)
    expect(hasProtectedInlineContent([{ type: 'inlineMath', latex: 'x' }])).toBe(false)
    expect(hasProtectedInlineContent([{ type: 'unknown', originalType: 'x', rawData: null }])).toBe(true)
    expect(hasProtectedInlineContent([{ type: 'text', text: 'x', unknownMarks: [{ type: 'y' }] }])).toBe(true)
    expect(hasProtectedInlineContent([])).toBe(false)
  })

  it('protectedInlineReason 给出可读原因', () => {
    expect(protectedInlineReason([{ type: 'text', text: '安全' }])).toBe('')
    const unknownReason = protectedInlineReason([{ type: 'unknown', originalType: 'customWidget', rawData: {} }])
    expect(unknownReason).toContain('customWidget')
    expect(unknownReason).toContain('只读保护')
    const marksReason = protectedInlineReason([{ type: 'text', text: 'x', unknownMarks: [{}] }])
    expect(marksReason).toContain('unknownMarks')
  })
})

describe('inlineAdapter: 粘贴 HTML 安全降级', () => {
  it('允许 marks 映射为安全 inlines', () => {
    const result = pastedHtmlToSafeInlines('<p><b>粗体</b><i>斜体</i><u>下划线</u><s>删除线</s><code>代码</code></p>')
    expect(result).toEqual([
      { type: 'text', text: '粗体', marks: ['bold'] },
      { type: 'text', text: '斜体', marks: ['italic'] },
      { type: 'text', text: '下划线', marks: ['underline'] },
      { type: 'text', text: '删除线', marks: ['strikethrough'] },
      { type: 'text', text: '代码', marks: ['code'] },
    ])
  })

  it('嵌套 marks 合并', () => {
    const result = pastedHtmlToSafeInlines('<strong><em>粗斜</em></strong>')
    expect(result).toEqual([{ type: 'text', text: '粗斜', marks: ['bold', 'italic'] }])
  })

  it('br 映射为 hardBreak', () => {
    const result = pastedHtmlToSafeInlines('第一行<br>第二行')
    expect(result).toEqual([
      { type: 'text', text: '第一行' },
      { type: 'text', text: '第二行' },
    ].flatMap((item, index) => index === 0 ? [item, { type: 'hardBreak' as const }] : [item]))
  })

  it('script 标签连同内容整体丢弃', () => {
    const result = pastedHtmlToSafeInlines('<p>正常</p><script>alert("xss")</script><p>文本</p>')
    const text = result.filter((inline) => inline.type === 'text').map((inline) => (inline as { text: string }).text).join('')
    expect(text).not.toContain('alert')
    expect(text).toContain('正常')
    expect(text).toContain('文本')
  })

  it('事件属性被拒绝', () => {
    const result = pastedHtmlToSafeInlines('<b onclick="alert(1)" onmouseover="hack()">文本</b>')
    expect(result).toEqual([{ type: 'text', text: '文本', marks: ['bold'] }])
  })

  it('javascript: URL 标签降级为纯文本', () => {
    const result = pastedHtmlToSafeInlines('<a href="javascript:alert(1)">链接文字</a>')
    expect(result).toEqual([{ type: 'text', text: '链接文字' }])
  })

  it('style 属性与任意标签不产生 marks', () => {
    const result = pastedHtmlToSafeInlines('<span style="font-weight:bold;color:red">样式文本</span><font>旧标签</font>')
    expect(result).toEqual([
      { type: 'text', text: '样式文本' },
      { type: 'text', text: '旧标签' },
    ])
  })

  it('文本中的 <script> 字面量保持普通文本', () => {
    const result = pastedHtmlToSafeInlines('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(result).toEqual([{ type: 'text', text: '<script>alert(1)</script>' }])
  })

  it('iframe/object/embed/form 整体丢弃', () => {
    const result = pastedHtmlToSafeInlines('<iframe src="x"></iframe><object>obj</object><embed><form><input value="v"></form>保留')
    const text = result.filter((inline) => inline.type === 'text').map((inline) => (inline as { text: string }).text).join('')
    expect(text).toBe('保留')
  })

  it('块级标签边界插入换行且保留文本', () => {
    const result = pastedHtmlToSafeInlines('<h1>标题</h1><p>段落一</p><div>段落二</div>')
    const types = result.map((inline) => inline.type)
    expect(types.filter((type) => type === 'hardBreak').length).toBeGreaterThanOrEqual(2)
    const text = result.filter((inline) => inline.type === 'text').map((inline) => (inline as { text: string }).text).join('')
    expect(text).toContain('标题')
    expect(text).toContain('段落一')
    expect(text).toContain('段落二')
  })

  it('粘贴结果可无损进入文档模型（往返不丢失）', () => {
    const pasted = pastedHtmlToSafeInlines('<p><b>粗体</b>与<i>斜体</i><br><code>代码</code></p>')
    expectRoundTrip(pasted)
  })
})

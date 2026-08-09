import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ParagraphBlock, TeachingDocumentV1, TeachingInline } from '@/types/teachingDocument'
import type { QuestionItem } from '@/types'
import type { ParagraphFragmentPaginationItem } from '@/utils/teachingDocument'
import { InlineContent } from './blocks/InlineContent'
import { ParagraphFragmentRenderer } from './blocks/BlockRenderer'
import { TeachingDocumentRenderer } from './TeachingDocumentRenderer'

function documentWith(content: TeachingDocumentV1['content']): TeachingDocumentV1 {
  return {
    version: 1,
    documentType: 'lecture',
    title: '',
    metadata: {},
    content,
  }
}

describe('InlineContent security and degradation', () => {
  it('renders hostile text as escaped text without executable attributes', () => {
    const inlines: TeachingInline[] = [{
      type: 'text',
      text: '<script>alert(1)</script><img src=x onerror=alert(1)> javascript:alert(1)',
      marks: ['bold'],
      unknownMarks: ['event:onerror', { style: 'background:url(javascript:alert(1))' }],
    }]
    const html = renderToStaticMarkup(<InlineContent inlines={inlines} />)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script')
    expect(html).not.toMatch(/<[^>]+\sonerror=/i)
    expect(html).not.toMatch(/(?:href|src)="javascript:/i)
    expect(html).toContain('data-unknown-mark-count="2"')
    expect(html).toContain('<strong>')
  })

  it('shows a recognizable fallback for unknown inline nodes', () => {
    const html = renderToStaticMarkup(
      <InlineContent inlines={[{
        type: 'unknown',
        originalType: 'futureInline',
        rawData: { html: '<svg onload=alert(1)>' },
      }]} />,
    )
    expect(html).toContain('未支持的行内内容：futureInline')
    expect(html).not.toContain('<svg')
    expect(html).toContain('data-original-type="futureInline"')
  })

  it('renders inline font override as font-family and falls back for unknown id', () => {
    const html = renderToStaticMarkup(
      <InlineContent inlines={[
        { type: 'text', text: '楷体文字', font: 'kaiti' },
        { type: 'text', text: '未知字体', font: 'not-a-real-font' },
        { type: 'text', text: '默认字体' },
      ]} />,
    )
    // 已知字体 id → 生成 font-family 内联样式
    expect(html).toContain('font-family:')
    expect(html).toContain('Kaiti SC')
    // 仅已知字体产生一条 font-family 声明；未知 id 与缺省均回退（不加样式）
    expect(html.match(/font-family:/g) || []).toHaveLength(1)
  })
})

describe('ParagraphFragmentRenderer', () => {
  it('reuses inline rendering while preserving marks, math, unknown data and XSS escaping', () => {
    const block: ParagraphBlock = {
      type: 'paragraph',
      id: 'source-paragraph',
      content: [
        {
          type: 'text',
          text: '前<script>alert(1)</script>',
          marks: ['bold', 'italic', 'underline'],
          unknownMarks: [{ future: true }],
        },
        { type: 'inlineMath', latex: 'x^2' },
        { type: 'unknown', originalType: 'futureInline', rawData: { keep: true } },
        { type: 'text', text: '后' },
      ],
    }
    const item: ParagraphFragmentPaginationItem = {
      kind: 'fragment',
      fragmentType: 'paragraph',
      blockId: block.id,
      sourceIndex: 0,
      fragmentIndex: 1,
      range: { start: { inlineIndex: 0, textOffset: 1 }, end: { inlineIndex: 4 } },
      continuation: 'end',
      lineStart: 2,
      lineEnd: 4,
      height: 50,
    }
    const html = renderToStaticMarkup(<ParagraphFragmentRenderer block={block} item={item} />)
    expect(html).toContain('data-teaching-source-block-id="source-paragraph"')
    expect(html).toContain('data-teaching-fragment-continuation="end"')
    expect(html).not.toContain('data-teaching-block-id="source-paragraph"')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('<strong>')
    expect(html).toContain('<em>')
    expect(html).toContain('<u>')
    expect(html).toContain('data-unknown-mark-count="1"')
    expect(html).toContain('data-teaching-inline-type="inlineMath"')
    expect(html).toContain('未支持的行内内容：futureInline')
    expect(html).not.toContain('<script')
  })
})

describe('TeachingDocumentRenderer fallbacks', () => {
  it('marks continuous and paper surfaces explicitly for stable layout scoping', () => {
    const continuous = renderToStaticMarkup(
      <TeachingDocumentRenderer document={documentWith([])} />,
    )
    const paper = renderToStaticMarkup(
      <TeachingDocumentRenderer document={documentWith([])} surface="paper" />,
    )
    expect(continuous).toContain('data-teaching-document-surface="continuous"')
    expect(paper).toContain('data-teaching-document-surface="paper"')
  })

  it('never renders the internal document type as a visible marker', () => {
    const html = renderToStaticMarkup(
      <TeachingDocumentRenderer
        document={{
          ...documentWith([]),
          documentType: 'exam',
          title: '期中测试',
          style: { print: { showDocumentType: true } },
        }}
      />,
    )
    expect(html).not.toContain('试卷')
  })

  it('renders a loading image with an intrinsic-size-safe height cap', () => {
    const html = renderToStaticMarkup(
      <TeachingDocumentRenderer
        document={documentWith([{
          type: 'figure',
          id: 'figure-loading',
          asset: { type: 'documentAsset', assetId: 'fixture' },
          alignment: 'center',
        }])}
        resolveFigure={() => '/fixture.png'}
      />,
    )
    expect(html).toContain('data-image-state="loading"')
    expect(html).toContain('图片加载中')
    expect(html).toContain('max-h-[70vh]')
    expect(html).toContain('loading="lazy"')
  })

  it('renders a multi-image block as a controlled grid with per-image captions', () => {
    const html = renderToStaticMarkup(
      <TeachingDocumentRenderer
        document={documentWith([{
          type: 'figure',
          id: 'figure-group',
          asset: { type: 'documentAsset', assetId: 'asset-1' },
          alignment: 'center',
          widthMm: 140,
          groupColumns: 2,
          groupGapMm: 4,
          groupItems: [
            { id: 'left', asset: { type: 'documentAsset', assetId: 'asset-1' }, caption: '左图' },
            { id: 'right', asset: { type: 'documentAsset', assetId: 'asset-2' }, caption: '右图' },
          ],
        }])}
        resolveFigure={(asset) => asset.type === 'documentAsset' ? `/${asset.assetId}.png` : ''}
      />,
    )
    expect(html).toContain('data-figure-columns="2"')
    expect(html).toContain('grid-template-columns:repeat(2, minmax(0, 1fr))')
    expect(html).toContain('左图')
    expect(html).toContain('右图')
  })

  it('renders missing figure and question states clearly', () => {
    const html = renderToStaticMarkup(
      <TeachingDocumentRenderer
        document={documentWith([
          {
            type: 'figure',
            id: 'figure-missing',
            asset: { type: 'documentAsset', assetId: 'missing' },
            alignment: 'center',
          },
          {
            type: 'question',
            id: 'question-missing',
            questionId: 'missing-question',
          },
        ])}
        resolveFigure={() => ''}
        resolveQuestion={() => ({ status: 'missing', message: '题目不存在' })}
      />,
    )
    expect(html).toContain('图片资源缺失')
    expect(html).toContain('题目不存在')
  })

  it('switches to the missing-resource fallback after an image load error', () => {
    const container = window.document.createElement('div')
    const root = createRoot(container)
    act(() => {
      root.render(
        <TeachingDocumentRenderer
          document={documentWith([{
            type: 'figure',
            id: 'figure-error',
            asset: { type: 'documentAsset', assetId: 'broken' },
            alignment: 'center',
          }])}
          resolveFigure={() => '/intentionally-missing.png'}
        />,
      )
    })
    const image = container.querySelector('img')
    expect(image).not.toBeNull()
    act(() => {
      image!.dispatchEvent(new Event('error', { bubbles: true }))
    })
    expect(container.textContent).toContain('图片资源缺失')
    act(() => root.unmount())
  })

  it('distinguishes question loading and request failure', () => {
    const loading = renderToStaticMarkup(
      <TeachingDocumentRenderer
        document={documentWith([{ type: 'question', id: 'loading', questionId: 'q1' }])}
        resolveQuestion={() => ({ status: 'loading' })}
      />,
    )
    const failed = renderToStaticMarkup(
      <TeachingDocumentRenderer
        document={documentWith([{ type: 'question', id: 'failed', questionId: 'q1' }])}
        resolveQuestion={() => ({ status: 'error', message: 'HTTP 500' })}
      />,
    )
    expect(loading).toContain('题目加载中')
    expect(failed).toContain('题目加载失败：HTTP 500')
  })

  it('renders every block even when invalid input contains duplicate IDs', () => {
    const html = renderToStaticMarkup(
      <TeachingDocumentRenderer
        document={documentWith([
          { type: 'divider', id: 'duplicate' },
          { type: 'spacer', id: 'duplicate', heightEm: 1 },
        ])}
      />,
    )
    expect(html.match(/data-block-id="duplicate"/g)).toHaveLength(2)
  })

  it('renders the imported Winter Olympics question table with merged cells in document flow', () => {
    const question: QuestionItem = {
      id: 'winter-olympics-table',
      serialNo: null,
      questionNo: '15',
      stage: '高中',
      questionType: '解答题',
      difficultyScore: 3,
      difficultyScore10: 6,
      difficultyLabel: '中等',
      chapter: '',
      knowledgePoints: [],
      solutionMethods: [],
      sourceTitle: '昆明市第一中学 2026 届高三数学第六次月考试题',
      bankStatus: 'ready',
      stemMarkdown: '北京冬奥会的成功举办，促进了全民群众参与冰雪运动。统计结果如下：\n\n<table border="1"><tr><td rowspan="2">性别</td><td colspan="2">冰雪运动</td><td rowspan="2">合计</td></tr><tr><td>了解</td><td>不了解</td></tr><tr><td>男</td><td>$m$</td><td>$n$</td><td>60</td></tr><tr><td>女</td><td>$p$</td><td>$q$</td><td>60</td></tr><tr><td>合计</td><td>80</td><td>40</td><td>120</td></tr></table>',
      answerText: '',
      analysisMarkdown: '',
      totalScore: 13,
      scoringRubric: [],
      sliceImagePath: '',
      figures: [],
      sourceRunId: '',
      updatedAt: '',
      hasFigures: false,
    }
    const html = renderToStaticMarkup(
      <TeachingDocumentRenderer
        document={documentWith([{ type: 'question', id: 'winter-olympics-question', questionId: question.id }])}
        resolveQuestion={() => question}
      />,
    )

    expect(html).toContain('rowSpan="2"')
    expect(html).toContain('colSpan="2"')
    expect(html).toContain('冰雪运动')
    expect(html).toContain('katex')
    expect(html).not.toContain('&lt;table')
  })
})

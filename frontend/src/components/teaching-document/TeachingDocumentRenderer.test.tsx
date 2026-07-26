import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ParagraphBlock, TeachingDocumentV1, TeachingInline } from '@/types/teachingDocument'
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
})

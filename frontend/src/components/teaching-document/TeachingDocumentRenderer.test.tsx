import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ParagraphBlock, TeachingDocumentV1, TeachingInline } from '@/types/teachingDocument'
import type { QuestionItem } from '@/types'
import type { ParagraphFragmentPaginationItem } from '@/utils/teachingDocument'
import { resolveTeachingSkinDesignRenderState, teachingSkinPresetRegistry, teachingSkinRegistry } from '@/utils/teachingDocument/skins'
import { applyTeachingDocumentRecommendedSkins, planTeachingDocumentPresetRecommendedSkins } from '@/utils/teachingDocument/skins/recommendedSkins'
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
  it('keeps legacy and no-design Skin roots free of design custom properties', () => {
    const html = renderToStaticMarkup(
      <TeachingDocumentRenderer document={documentWith([
        { type: 'heading', id: 'legacy-heading', level: 2, content: [{ type: 'text', text: '旧标题' }] },
        { type: 'heading', id: 'plain-skin-heading', level: 2, content: [{ type: 'text', text: '普通 Skin' }], skin: { id: 'builtin.heading.pill', version: 1 } },
      ])} />,
    )
    expect(html).not.toContain('--td-skin-')
  })

  it('attaches resolved design variables only to each matching Skin root', () => {
    const html = renderToStaticMarkup(
      <TeachingDocumentRenderer document={documentWith([
        { type: 'heading', id: 'design-heading', level: 2, content: [{ type: 'text', text: '标题' }], skin: { id: 'builtin.heading.left-accent', version: 1 } },
        { type: 'box', id: 'design-box', templateId: 'concept', breakBehavior: 'auto', children: [], skin: { id: 'builtin.box.left-accent', version: 1 } },
      ])} />,
    )
    expect(html).toContain('--td-skin-builtin--heading--left-accent-accent-border:4px solid #2563EB')
    expect(html).toContain('--td-skin-builtin--box--left-accent-frame-border:1px solid #BFDBFE')
    expect(html).toContain('--td-skin-builtin--box--left-accent-header-fill:#EFF6FF')
    expect(html).not.toMatch(/td-document[^>]+--td-skin-/)
  })

  it('uses persisted Heading and Box Variants in the production renderer while leaving absent Variants at Base', () => {
    const html = renderToStaticMarkup(
      <TeachingDocumentRenderer document={documentWith([
        { type: 'heading', id: 'heading-amber', level: 2, content: [{ type: 'text', text: '琥珀标题' }], skin: { id: 'builtin.heading.left-accent', version: 1, variant: 'amber' } },
        { type: 'heading', id: 'heading-base', level: 2, content: [{ type: 'text', text: '基础标题' }], skin: { id: 'builtin.heading.left-accent', version: 1 } },
        { type: 'box', id: 'box-green', templateId: 'concept', breakBehavior: 'auto', children: [], skin: { id: 'builtin.box.left-accent', version: 1, variant: 'green' } },
      ])} />,
    )
    expect(html).toContain('--td-skin-builtin--heading--left-accent-accent-border:4px solid #B45309')
    expect(html).toContain('--td-skin-builtin--heading--left-accent-accent-border:4px solid #2563EB')
    expect(html).toContain('--td-skin-builtin--box--left-accent-frame-border:1px solid #A7F3D0')
    expect(html).toContain('--td-skin-builtin--box--left-accent-header-fill:#ECFDF5')
  })

  it('uses a pinned Preset without materializing Variants, while explicit and missing Variants still win', () => {
    const document: TeachingDocumentV1 = {
      ...documentWith([
        { type: 'heading', id: 'preset-heading', level: 2, content: [{ type: 'text', text: 'Preset 标题' }], skin: { id: 'builtin.heading.left-accent', version: 1 } },
        { type: 'heading', id: 'explicit-heading', level: 2, content: [{ type: 'text', text: '显式标题' }], skin: { id: 'builtin.heading.left-accent', version: 1, variant: 'futureVariant' } },
        { type: 'box', id: 'preset-box', templateId: 'concept', breakBehavior: 'auto', children: [], skin: { id: 'builtin.box.left-accent', version: 1 } },
        { type: 'heading', id: 'unskinned', level: 2, content: [{ type: 'text', text: '普通标题' }] },
      ]),
      design: { preset: { id: 'builtin.preset.warm', version: 1 } },
    }
    const html = renderToStaticMarkup(<TeachingDocumentRenderer document={document} />)
    expect(html).toContain('--td-skin-builtin--heading--left-accent-accent-border:4px solid #B45309')
    expect(html).toContain('--td-skin-builtin--box--left-accent-frame-border:1px solid #A7F3D0')
    expect(html).toContain('--td-skin-builtin--heading--left-accent-accent-border:4px solid #2563EB')
    expect(html).not.toMatch(/data-block-id="unskinned"[^>]+data-skin-id/)
    expect(document.content[0]).toMatchObject({ skin: { id: 'builtin.heading.left-accent' } })
    expect((document.content[0] as { skin: { variant?: string } }).skin.variant).toBeUndefined()
  })

  it('renders Warm amber and green after explicitly applying its recommended Skins', () => {
    const document: TeachingDocumentV1 = {
      ...documentWith([
        { type: 'heading', id: 'recommended-heading', level: 2, content: [{ type: 'text', text: '待应用标题' }] },
        { type: 'box', id: 'recommended-box', templateId: 'concept', breakBehavior: 'auto', children: [] },
      ]),
      design: { preset: { id: 'builtin.preset.warm', version: 1 } },
    }
    const warm = teachingSkinPresetRegistry.get('builtin.preset.warm', 1)!
    const before = renderToStaticMarkup(<TeachingDocumentRenderer document={document} />)
    expect(before).not.toContain('data-skin-id="builtin.heading.left-accent"')
    expect(before).not.toContain('data-skin-id="builtin.box.left-accent"')

    const applied = applyTeachingDocumentRecommendedSkins(document, planTeachingDocumentPresetRecommendedSkins(document, warm), { heading: true, box: true })
    const html = renderToStaticMarkup(<TeachingDocumentRenderer document={applied} />)
    expect(html).toContain('--td-skin-builtin--heading--left-accent-accent-border:4px solid #B45309')
    expect(html).toContain('--td-skin-builtin--box--left-accent-frame-border:1px solid #A7F3D0')
    expect(html).toContain('--td-skin-builtin--box--left-accent-header-fill:#ECFDF5')
    expect((applied.content[0] as { skin?: { variant?: string } }).skin?.variant).toBeUndefined()
    expect((applied.content[1] as { skin?: { variant?: string } }).skin?.variant).toBeUndefined()
  })

  it('falls back to Base for a missing persisted Variant without changing the stored ref', () => {
    const document = documentWith([
      { type: 'heading', id: 'heading-future', level: 2, content: [{ type: 'text', text: '未来标题' }], skin: { id: 'builtin.heading.left-accent', version: 1, variant: 'futureVariant' } },
    ])
    const html = renderToStaticMarkup(<TeachingDocumentRenderer document={document} />)
    expect(html).toContain('--td-skin-builtin--heading--left-accent-accent-border:4px solid #2563EB')
    expect(document.content[0]).toMatchObject({ skin: { variant: 'futureVariant' } })
    expect(resolveTeachingSkinDesignRenderState(teachingSkinRegistry.get('builtin.heading.left-accent')!, 'futureVariant')).toMatchObject({
      status: 'resolved',
      issues: [{ code: 'variant-missing', variantId: 'futureVariant' }],
    })
  })

  it('fails closed to the Phase 1 class when trusted design metadata becomes unavailable', () => {
    const definition = teachingSkinRegistry.get('builtin.heading.left-accent')!
    const originalDesign = definition.design
    try {
      ;(definition as unknown as { design: unknown }).design = { slots: null }
      const html = renderToStaticMarkup(
        <TeachingDocumentRenderer document={documentWith([
          { type: 'heading', id: 'unavailable-design', level: 2, content: [{ type: 'text', text: '标题' }], skin: { id: definition.id, version: 1 } },
        ])} />,
      )
      expect(html).toContain('td-skin-heading-left-accent')
      expect(html).not.toContain('--td-skin-builtin--heading--left-accent-')
    } finally {
      ;(definition as unknown as { design: unknown }).design = originalDesign
    }
  })

  it('uses an ephemeral Skin Lab variant without leaking its map across roots', () => {
    const html = renderToStaticMarkup(
      <TeachingDocumentRenderer
        document={documentWith([
          { type: 'heading', id: 'heading-one', level: 2, content: [{ type: 'text', text: '标题一' }], skin: { id: 'builtin.heading.left-accent', version: 1 } },
          { type: 'heading', id: 'heading-two', level: 2, content: [{ type: 'text', text: '标题二' }], skin: { id: 'builtin.heading.left-accent', version: 1 } },
          { type: 'box', id: 'box-one', templateId: 'concept', breakBehavior: 'auto', children: [], skin: { id: 'builtin.box.left-accent', version: 1 } },
        ])}
        skinDesignVariantIds={{ 'builtin.heading.left-accent': 'amber' }}
      />,
    )
    expect(html.match(/--td-skin-builtin--heading--left-accent-accent-border:4px solid #B45309/g)).toHaveLength(2)
    expect(html).toContain('--td-skin-builtin--box--left-accent-accent-border:4px solid #2563EB')
    expect(html).not.toContain('--td-skin-builtin--box--left-accent-accent-border:4px solid #B45309')
  })

  it('gives a Skin Lab override precedence over a persisted Variant, including an explicit Base preview', () => {
    const document = documentWith([
      { type: 'heading', id: 'heading-persisted', level: 2, content: [{ type: 'text', text: '标题' }], skin: { id: 'builtin.heading.left-accent', version: 1, variant: 'amber' } },
    ])
    const persisted = renderToStaticMarkup(<TeachingDocumentRenderer document={document} />)
    const forcedBase = renderToStaticMarkup(<TeachingDocumentRenderer document={document} skinDesignVariantIds={{ 'builtin.heading.left-accent': null }} />)

    expect(persisted).toContain('--td-skin-builtin--heading--left-accent-accent-border:4px solid #B45309')
    expect(forcedBase).toContain('--td-skin-builtin--heading--left-accent-accent-border:4px solid #2563EB')
  })

  it('adds stable skin DOM hooks for resolved skins and falls back for missing refs', () => {
    const resolved = renderToStaticMarkup(
      <TeachingDocumentRenderer document={documentWith([
        { type: 'heading', id: 'skin-heading', level: 2, content: [{ type: 'text', text: '标题' }], skin: { id: 'builtin.heading.pill', version: 1 } },
        { type: 'box', id: 'skin-box', templateId: 'concept', breakBehavior: 'auto', children: [], skin: { id: 'builtin.box.left-accent', version: 1 } },
      ])} />,
    )
    expect(resolved).toContain('data-skin-id="builtin.heading.pill"')
    expect(resolved).toContain('td-skin-heading-pill')
    expect(resolved).toContain('data-skin-id="builtin.box.left-accent"')
    expect(resolved).toContain('td-skin-box-left-accent')

    const fallback = renderToStaticMarkup(
      <TeachingDocumentRenderer document={documentWith([
        { type: 'heading', id: 'missing-heading', level: 2, content: [{ type: 'text', text: '标题' }], skin: { id: 'custom.heading.missing', version: 1 } },
      ])} />,
    )
    expect(fallback).toContain('data-skin-state="missing"')
    expect(fallback).not.toContain('data-skin-id="custom.heading.missing"')
  })

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

  it('hides the document title for wrong-question-collection documents', () => {
    const html = renderToStaticMarkup(
      <TeachingDocumentRenderer
        document={{
          ...documentWith([]),
          documentType: 'wrong-question-collection',
          title: '期中错题集',
        }}
      />,
    )
    expect(html).not.toContain('期中错题集')
    expect(html).not.toContain('td-document-header')
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

  it('renders side-wrapped figures as flow anchors and lets following text wrap', () => {
    const html = renderToStaticMarkup(
      <TeachingDocumentRenderer
        document={documentWith([
          {
            type: 'figure',
            id: 'figure-wrap',
            asset: { type: 'documentAsset', assetId: 'asset-1' },
            alignment: 'left',
            widthMm: 70,
            textWrap: 'square-left',
            wrapGapMm: 4,
          },
          {
            type: 'paragraph',
            id: 'paragraph-wrap',
            content: [{ type: 'text', text: '这段文字会在图片右侧环绕。' }],
          },
          {
            type: 'blockMath',
            id: 'math-after-wrap',
            latex: 'x^2',
          },
        ])}
        resolveFigure={() => '/asset-1.png'}
      />,
    )

    expect(html).toContain('data-text-wrap="square-left"')
    expect(html).toContain('float:left')
    expect(html).toContain('clear:both')
    expect(html).toContain('td-block-shell-flow-text')
  })

  it('renders a side-wrapped question figure and keeps following stem text in flow', () => {
    const question: QuestionItem = {
      id: 'question-figure-wrap', serialNo: null, questionNo: '10', stage: '高中', questionType: '解答题',
      difficultyScore: 3, difficultyScore10: 6, difficultyLabel: '中等', chapter: '', knowledgePoints: [], solutionMethods: [], sourceTitle: '', bankStatus: 'ready',
      stemMarkdown: '观察下图。\n\n<!-- DOC2X_FIGURE:fig-wrap -->\n\n由图可知，继续计算即可。',
      answerText: '', analysisMarkdown: '', totalScore: 12, scoringRubric: [], sliceImagePath: '',
      figures: [{ id: 'fig-wrap', path: '/fig-wrap.png', usage: 'stem' }], sourceRunId: '', updatedAt: '', hasFigures: true,
    }
    const html = renderToStaticMarkup(
      <TeachingDocumentRenderer
        document={documentWith([{
          type: 'question',
          id: 'question-figure-wrap-block',
          questionId: question.id,
          display: { figureOverrides: { 'fig-wrap': { widthMm: 70, textWrap: 'square-left', wrapGapMm: 4 } } },
        }])}
        resolveQuestion={() => question}
      />,
    )

    expect(html).toContain('data-text-wrap="square-left"')
    expect(html).toContain('float:left')
    expect(html).toContain('td-question-region-flow-text')
    expect(html).toContain('td-question flow-root')
    expect(html).toContain('继续计算即可')
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

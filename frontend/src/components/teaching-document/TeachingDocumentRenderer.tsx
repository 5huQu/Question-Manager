/**
 * TeachingDocumentRenderer — 纯展示渲染器
 *
 * 设计原则：
 * - 不依赖编辑器状态
 * - 不直接发起 API 请求
 * - 题目与图片通过 resolver 传入
 * - 同一渲染器可复用于编辑预览和打印路由
 * - HTML 结构语义清晰
 * - 添加 data-block-id / data-block-type / break 属性供分页引擎识别
 */

import type { TeachingDocument, FigureAssetRef } from '@/types/teachingDocument'
import type { ReactNode } from 'react'
import type { CSSProperties } from 'react'
import type { ChoiceLayoutOverrides } from '@/utils/choiceLayout'
import { TEACHING_DOM } from '@/utils/teachingDocument'
import { headingLabelByBlockId } from '@/utils/teachingDocument'
import { BlockRenderer, type FigureResolution, type QuestionResolution, type TeachingDocumentResolvers } from './blocks/BlockRenderer'
import { QUESTION_MATH_LATIN_FONT_FACE_CSS, teachingDocumentLayoutCssVars } from '@/utils/teachingDocument/lectureFonts'
import { showsDocumentTitle } from '@/utils/teachingDocument/wrongQuestionCollection'
import { resolveTeachingDocumentSkinDesignContext, type TeachingSkinDesignVariantIds } from '@/utils/teachingDocument/skins'
import 'katex/dist/katex.min.css'
import './teaching-document.css'

export interface TeachingDocumentRendererProps {
  document: TeachingDocument
  /** 根据 questionId 获取题目数据 */
  resolveQuestion?: (questionId: string) => QuestionResolution
  /** 根据资源引用解析为可显示 URL（默认使用 assetUrl 处理 legacyPath） */
  resolveFigure?: (asset: FigureAssetRef) => FigureResolution
  /** 额外 CSS 类名 */
  className?: string
  /** 是否显示文档标题 */
  showTitle?: boolean
  /** 外层表面不同，但块内容和排版规则保持一致。 */
  surface?: 'continuous' | 'paper'
  /** 隐藏测量树必须主动加载图片，避免 lazy 图片永远不进入视口。 */
  eagerImages?: boolean
  choiceLayoutOverrides?: ChoiceLayoutOverrides
  probeChoiceLayouts?: boolean
  selectedBlockId?: string
  /** Runtime-only preview choice. Production callers leave this undefined (Base). */
  skinDesignVariantIds?: TeachingSkinDesignVariantIds
}

export interface TeachingDocumentFrameProps {
  document: TeachingDocument
  className?: string
  showTitle?: boolean
  surface?: 'continuous' | 'paper'
  children: ReactNode
}

export function TeachingDocumentFrame({
  document,
  className = '',
  showTitle = true,
  surface = 'continuous',
  children,
}: TeachingDocumentFrameProps) {
  const surfaceClass = surface === 'continuous' ? 'mx-auto max-w-3xl px-6 py-8' : 'w-full'
  return (
    <article
      className={`td-document ${surfaceClass} text-zinc-900 dark:text-zinc-100 ${className}`}
      style={teachingDocumentLayoutCssVars(document.style) as CSSProperties}
      data-document-version={document.version}
      data-document-type={document.documentType}
      {...{
        [TEACHING_DOM.document]: '',
        [TEACHING_DOM.documentSurface]: surface,
      }}
    >
      {showTitle && showsDocumentTitle(document) ? (
        <header className="td-document-header mb-8 text-center" {...{ [TEACHING_DOM.documentHeader]: '' }}>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {document.title}
          </h1>
        </header>
      ) : null}
      <div className="td-document-content">{children}</div>
    </article>
  )
}

export function TeachingDocumentRenderer({
  document,
  resolveQuestion,
  resolveFigure,
  className = '',
  showTitle = true,
  surface = 'continuous',
  eagerImages = false,
  choiceLayoutOverrides,
  probeChoiceLayouts = false,
  selectedBlockId,
  skinDesignVariantIds,
}: TeachingDocumentRendererProps) {
  const skinDesignContext = resolveTeachingDocumentSkinDesignContext(document)
  const resolvers: TeachingDocumentResolvers = {
    resolveQuestion,
    resolveFigure,
    eagerImages,
    choiceLayoutOverrides,
    probeChoiceLayouts,
    skinDesignVariantIds,
    skinPresetBindings: skinDesignContext.preset.bindings,
  }
  const headingLabels = headingLabelByBlockId(document)
  let flowWrapActive = false
  return (
    <>
      <style>{QUESTION_MATH_LATIN_FONT_FACE_CSS}</style>
      <TeachingDocumentFrame
        document={document}
        className={className}
        showTitle={showTitle}
        surface={surface}
      >
        {document.content.map((block, index) => {
          const isTextBlock = block.type === 'heading' || block.type === 'paragraph'
          const isSideWrappedFigure = block.type === 'figure'
            && (block.textWrap === 'square-left' || block.textWrap === 'square-right')
          const flowWrappedText = flowWrapActive && isTextBlock
          // 一个新的图片锚点或任意独立块都结束前一个图片的文字环绕范围。
          flowWrapActive = isSideWrappedFigure
            ? true
            : isTextBlock && flowWrapActive
              ? true
              : false
          return (
            <BlockRenderer
              key={`${block.id}:${index}`}
              block={block}
              resolvers={resolvers}
              sourceIndex={index}
              selectedBlockId={selectedBlockId}
              headingLabel={headingLabels.get(block.id)}
              flowWrappedText={flowWrappedText}
            />
          )
        })}
        {!document.content.length ? (
          <p className="py-12 text-center text-sm text-zinc-400">文档内容为空</p>
        ) : null}
      </TeachingDocumentFrame>
    </>
  )
}

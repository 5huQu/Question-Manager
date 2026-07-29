/**
 * 共享纸张页面视图
 * 纸张预览与打印页复用同一个页面 DOM 和 item renderer，
 * 保证预览与导出排版一致（含页眉页脚 chrome 与有效高度语义）。
 *
 * 首页语义：showOnFirstPage=false 时首页不渲染页眉内容，但分页按
 * 「保守统一扣除」假定每页都扣除页眉高度；此时渲染空占位元素，
 * 使 DOM 布局与分页计算完全一致（风险：首页页眉区域留白）。
 */
import type { CSSProperties } from 'react'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import {
  TEACHING_DOM,
  pageHeaderSlots,
  pageFooterSlots,
  type PaginatedPage,
  type PaperSpec,
  type PrintLayoutSpec,
} from '@/utils/teachingDocument'
import type { PrintChromeSlotPosition } from '@/types/teachingDocument'
import { PrintChrome, type PrintChromeSection } from './PrintChrome'
import { TeachingDocumentFrame } from './TeachingDocumentRenderer'
import {
  BlockRenderer,
  BoxFragmentRenderer,
  ParagraphFragmentRenderer,
  QuestionFragmentRenderer,
  QuestionPlaceholder,
  type TeachingDocumentResolvers,
} from './blocks/BlockRenderer'

export interface PaperPageViewProps {
  page: PaginatedPage
  document: TeachingDocumentV1
  paper: PaperSpec
  printLayout: PrintLayoutSpec
  totalPages: number
  resolvers: TeachingDocumentResolvers
  selectedBlockId?: string
  /** 本页存在超页诊断的块 ID（由 pagination diagnostics 计算），用于渲染可识别占位警告。 */
  overflowBlockIds?: ReadonlySet<string>
  /** 附加到 section 的类名（预览用于边框阴影定位等屏幕装饰） */
  className?: string
  /** 附加到 section 的样式（预览缩放、CSS 变量等） */
  style?: CSSProperties
  onBlockSelect?: (blockId: string, pageIndex: number) => void
  /** 预览中编辑的是同一份文档级配置，绝不按页持久化。 */
  editingChromeSlot?: { section: PrintChromeSection; slot: PrintChromeSlotPosition } | null
  onChromeSlotEdit?: (section: PrintChromeSection, slot: PrintChromeSlotPosition) => void
  /** 双栏纸面内部只保留页眉页脚高度，实际 chrome 由纸面外层统一渲染。 */
  reserveChrome?: boolean
  /** 保留文档标题的布局高度但隐藏内容，供跨双栏标题统一覆盖。 */
  reserveDocumentHeader?: boolean
}

export function PaperPageView({
  page,
  document,
  paper,
  printLayout,
  totalPages,
  resolvers,
  selectedBlockId,
  overflowBlockIds,
  className,
  style,
  onBlockSelect,
  editingChromeSlot,
  onChromeSlotEdit,
  reserveChrome = false,
  reserveDocumentHeader = false,
}: PaperPageViewProps) {
  const title = document.title || '文档'
  const headerSlots = pageHeaderSlots(printLayout, page.index)
  const footerSlots = pageFooterSlots(printLayout)
  const headerReserved = printLayout.header.enabled
  const footerReserved = printLayout.footer.enabled
  // 页眉页脚仍占用原有的稳定分页高度；仅向纸张边缘移动到更自然的印刷位置。
  // 至少保留 8mm 物理留白，避免不同打印机的不可打印区裁切内容。
  const headerVisualOffsetMm = -Math.min(7, Math.max(0, paper.marginTopMm - 8))
  const footerVisualOffsetMm = Math.min(7, Math.max(0, paper.marginBottomMm - 8))

  return (
    <section
      className={`td-paper-page ${className || ''}`.trim()}
      data-page-overflow={page.overflow ? 'true' : 'false'}
      {...{
        [TEACHING_DOM.paperPage]: '',
        [TEACHING_DOM.pageIndex]: page.index,
      }}
      style={{
        width: `${paper.widthMm}mm`,
        height: `${paper.heightMm}mm`,
        padding: `${paper.marginTopMm}mm ${paper.marginRightMm}mm ${paper.marginBottomMm}mm ${paper.marginLeftMm}mm`,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
      onClick={onBlockSelect ? (event) => {
        const target = event.target
        if (!(target instanceof Element)) return
        const block = target.closest<HTMLElement>(`[${TEACHING_DOM.blockId}], [${TEACHING_DOM.sourceBlockId}]`)
        const blockId = block?.getAttribute(TEACHING_DOM.blockId)
          || block?.getAttribute(TEACHING_DOM.sourceBlockId)
        if (blockId) onBlockSelect(blockId, page.index)
      } : undefined}
    >
      {reserveChrome && headerReserved ? (
        <PrintChrome
          section="header"
          slots={printLayout.header.slots}
          documentTitle={title}
          documentType={document.documentType}
          pageNumber={page.index + 1}
          totalPages={totalPages}
          printLayout={printLayout}
          spacer
        />
      ) : headerSlots ? (
        <PrintChrome
          section="header"
          slots={headerSlots}
          documentTitle={title}
          documentType={document.documentType}
          pageNumber={page.index + 1}
          totalPages={totalPages}
          printLayout={printLayout}
          activeSlot={editingChromeSlot?.section === 'header' ? editingChromeSlot.slot : undefined}
          onSlotEdit={onChromeSlotEdit}
          visualOffsetMm={headerVisualOffsetMm}
        />
      ) : headerReserved ? (
        <PrintChrome
          section="header"
          slots={printLayout.header.slots}
          documentTitle={title}
          documentType={document.documentType}
          pageNumber={page.index + 1}
          totalPages={totalPages}
          printLayout={printLayout}
          spacer
          visualOffsetMm={headerVisualOffsetMm}
        />
      ) : null}

      <main
        {...{ [TEACHING_DOM.pageContent]: '' }}
        style={{ flex: '1 1 0px', minHeight: 0, overflow: 'visible' }}
      >
        <TeachingDocumentFrame
          document={document}
          showTitle={page.showDocumentHeader || reserveDocumentHeader}
          className={reserveDocumentHeader ? 'td-document-reserve-header' : ''}
          surface="paper"
        >
          {page.items.map((item) => {
            const block = document.content[item.sourceIndex]
            if (!block || block.id !== item.blockId) return null
            if (item.kind === 'fragment'
              && item.fragmentType === 'paragraph'
              && block.type === 'paragraph') {
              return (
                <ParagraphFragmentRenderer
                  key={`fragment:${item.sourceIndex}:${item.fragmentIndex}`}
                  block={block}
                  item={item}
                  selected={selectedBlockId === block.id}
                />
              )
            }
            if (item.kind === 'fragment'
              && item.fragmentType === 'box'
              && block.type === 'box') {
              return (
                <BoxFragmentRenderer
                  key={`box-fragment:${item.sourceIndex}:${item.fragmentIndex}`}
                  block={block}
                  item={item}
                  resolvers={resolvers}
                  selectedBlockId={selectedBlockId}
                />
              )
            }
            if (item.kind === 'fragment'
              && item.fragmentType === 'question'
              && block.type === 'question') {
              const resolution = resolvers.resolveQuestion?.(block.questionId)
              if (!resolution || 'status' in resolution) {
                // resolver 失效：渲染稳定占位，不回退 BlockRenderer 整题，
                // 避免多 fragment 场景下同一题在每页重复整题。
                if (item.fragmentIndex > 0) return null
                const status = resolution && 'status' in resolution ? resolution.status : 'missing'
                return (
                  <QuestionPlaceholder
                    key={`question-fallback:${item.sourceIndex}`}
                    block={block}
                    message={status === 'loading'
                      ? '题目加载中…'
                      : status === 'error'
                        ? `题目加载失败：${resolution && 'message' in resolution ? resolution.message : '未知错误'}`
                        : `题目不可用（ID: ${block.questionId || '未设置'}）`}
                    status={status === 'loading' ? 'loading' : status === 'error' ? 'error' : 'missing'}
                    tone={status === 'error' ? 'error' : 'neutral'}
                  />
                )
              }
              return (
                <QuestionFragmentRenderer
                  key={`question-fragment:${item.sourceIndex}:${item.fragmentIndex}`}
                  block={block}
                  question={resolution}
                  item={item}
                  selected={selectedBlockId === block.id}
                  resolveFigure={resolvers.resolveFigure}
                />
              )
            }
            return (
              <BlockRenderer
                key={`whole:${item.sourceIndex}`}
                block={block}
                resolvers={resolvers}
                sourceIndex={item.sourceIndex}
                selectedBlockId={selectedBlockId}
                rawMarkdownOverflowWarning={block.type === 'rawMarkdown' && overflowBlockIds?.has(block.id)
                  ? '内容超过单页内容区高度，无法安全分页，导出已阻止。'
                  : undefined}
              />
            )
          })}
          {!page.items.length && !page.showDocumentHeader ? (
            <span className="sr-only">空白页</span>
          ) : null}
        </TeachingDocumentFrame>
      </main>

      {reserveChrome && footerReserved ? (
        <PrintChrome
          section="footer"
          slots={printLayout.footer.slots}
          documentTitle={title}
          documentType={document.documentType}
          pageNumber={page.index + 1}
          totalPages={totalPages}
          printLayout={printLayout}
          spacer
        />
      ) : footerSlots ? (
        <PrintChrome
          section="footer"
          slots={footerSlots}
          documentTitle={title}
          documentType={document.documentType}
          pageNumber={page.index + 1}
          totalPages={totalPages}
          printLayout={printLayout}
          activeSlot={editingChromeSlot?.section === 'footer' ? editingChromeSlot.slot : undefined}
          onSlotEdit={onChromeSlotEdit}
          visualOffsetMm={footerVisualOffsetMm}
        />
      ) : footerReserved ? (
        <PrintChrome
          section="footer"
          slots={printLayout.footer.slots}
          documentTitle={title}
          documentType={document.documentType}
          pageNumber={page.index + 1}
          totalPages={totalPages}
          printLayout={printLayout}
          spacer
          visualOffsetMm={footerVisualOffsetMm}
        />
      ) : null}
    </section>
  )
}

import type { CSSProperties } from 'react'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import {
  pageFooterSlots,
  pageHeaderSlots,
  type PaginatedPage,
  type PaperSpec,
  type PrintLayoutSpec,
} from '@/utils/teachingDocument'
import { PrintChrome } from './PrintChrome'
import { PaperPageView, type PaperPageViewProps } from './PaperPageView'
import { showsDocumentTitle } from '@/utils/teachingDocument/wrongQuestionCollection'

export interface A3TwoColumnSheetViewProps {
  pages: [PaginatedPage, PaginatedPage?]
  sheetIndex: number
  sheetCount: number
  logicalPageCount: number
  document: TeachingDocumentV1
  sheetPaper: PaperSpec
  columnPaper: PaperSpec
  printLayout: PrintLayoutSpec
  pageProps: Omit<
    PaperPageViewProps,
    'page' | 'document' | 'paper' | 'printLayout' | 'totalPages' | 'className' | 'style'
  >
  className?: string
  style?: CSSProperties
}

/**
 * A3 横向双栏纸面：一套页眉、标题和页脚覆盖整张物理纸，
 * 正文按左栏 → 右栏连续流动。内部逻辑页只负责栏内内容与分页测量。
 */
export function A3TwoColumnSheetView({
  pages,
  sheetIndex,
  sheetCount,
  logicalPageCount,
  document,
  sheetPaper,
  columnPaper,
  printLayout,
  pageProps,
  className = '',
  style,
}: A3TwoColumnSheetViewProps) {
  const [leftPage, rightPage] = pages
  const reserveDocumentHeader = sheetIndex === 0 && showsDocumentTitle(document)
  const headerSlots = pageHeaderSlots(printLayout, sheetIndex)
  const footerSlots = pageFooterSlots(printLayout)
  const overlayHorizontalStyle = {
    left: `${sheetPaper.marginLeftMm}mm`,
    right: `${sheetPaper.marginRightMm}mm`,
  }

  return (
    <section
      data-teaching-paper-spread=""
      data-teaching-sheet-index={sheetIndex}
      className={`relative flex overflow-hidden bg-white ${className}`.trim()}
      style={{
        width: `${sheetPaper.widthMm}mm`,
        height: `${sheetPaper.heightMm}mm`,
        ...style,
      }}
    >
      <PaperPageView
        {...pageProps}
        page={leftPage}
        document={document}
        paper={columnPaper}
        printLayout={printLayout}
        totalPages={logicalPageCount}
        reserveChrome
        reserveDocumentHeader={reserveDocumentHeader}
        className="shrink-0 overflow-hidden bg-white"
      />
      {rightPage ? (
        <PaperPageView
          {...pageProps}
          page={rightPage}
          document={document}
          paper={columnPaper}
          printLayout={printLayout}
          totalPages={logicalPageCount}
          reserveChrome
          reserveDocumentHeader={reserveDocumentHeader}
          className="shrink-0 overflow-hidden border-l border-zinc-300 bg-white"
        />
      ) : (
        <div className="shrink-0 bg-white" style={{ width: `${columnPaper.widthMm}mm`, height: `${columnPaper.heightMm}mm` }} />
      )}

      {headerSlots ? (
        <div className="pointer-events-none absolute z-10" style={{ ...overlayHorizontalStyle, top: `${sheetPaper.marginTopMm}mm` }}>
          <PrintChrome
            section="header"
            slots={headerSlots}
            documentTitle={document.title || '文档'}
            documentType={document.documentType}
            pageNumber={sheetIndex + 1}
            totalPages={sheetCount}
            printLayout={printLayout}
          />
        </div>
      ) : null}

      {reserveDocumentHeader ? (
        <header
          className="pointer-events-none absolute z-10 text-center"
          style={{
            ...overlayHorizontalStyle,
            top: `${sheetPaper.marginTopMm + (printLayout.header.enabled ? printLayout.header.heightMm : 0)}mm`,
          }}
        >
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{document.title}</h1>
        </header>
      ) : null}

      {footerSlots ? (
        <div className="pointer-events-none absolute z-10" style={{ ...overlayHorizontalStyle, bottom: `${sheetPaper.marginBottomMm}mm` }}>
          <PrintChrome
            section="footer"
            slots={footerSlots}
            documentTitle={document.title || '文档'}
            documentType={document.documentType}
            pageNumber={sheetIndex + 1}
            totalPages={sheetCount}
            printLayout={printLayout}
          />
        </div>
      ) : null}
    </section>
  )
}

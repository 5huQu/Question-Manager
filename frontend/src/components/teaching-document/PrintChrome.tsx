import type { CSSProperties, ReactNode } from 'react'
import type {
  PrintChromeSlotPosition,
  PrintChromeSlots,
  TeachingDocumentType,
} from '@/types/teachingDocument'
import { formatPageNumber, printDateLabel, type PrintLayoutSpec } from '@/utils/teachingDocument'
import { fontStackById } from '@/utils/teachingDocument/lectureFonts'

export type PrintChromeSection = 'header' | 'footer'

export function PrintChrome({
  section,
  slots,
  documentTitle,
  documentType,
  pageNumber,
  totalPages,
  printLayout,
  activeSlot,
  onSlotEdit,
  spacer = false,
  visualOffsetMm = 0,
}: {
  section: PrintChromeSection
  slots: PrintChromeSlots
  documentTitle: string
  documentType: TeachingDocumentType
  pageNumber: number
  totalPages: number
  printLayout: PrintLayoutSpec
  activeSlot?: PrintChromeSlotPosition
  onSlotEdit?: (section: PrintChromeSection, slot: PrintChromeSlotPosition) => void
  spacer?: boolean
  /** 只改变视觉位置，保留分页时使用的稳定占位高度。 */
  visualOffsetMm?: number
}) {
  const dataAttribute = section === 'header' ? 'data-teaching-page-header' : 'data-teaching-page-footer'
  const spacerAttribute = section === 'header' ? 'data-header-spacer' : 'data-footer-spacer'
  return (
    <div
      {...{ [dataAttribute]: '' }}
      {...(spacer ? { [spacerAttribute]: 'true' } : {})}
      style={{
        height: `${section === 'header' ? printLayout.header.heightMm : printLayout.footer.heightMm}mm`,
        transform: !spacer && visualOffsetMm ? `translateY(${visualOffsetMm}mm)` : undefined,
      }}
    >
      {!spacer ? (
        <div className="td-print-chrome-grid">
          {(['left', 'center', 'right'] as PrintChromeSlotPosition[]).map((position) => {
            const slot = slots[position]
            const content = chromeSlotContent(slot, documentTitle, documentType, pageNumber, totalPages, printLayout)
            const align = slot.align ?? position
            const className = `td-print-chrome-slot td-print-chrome-align-${align}${activeSlot === position ? ' is-editing' : ''}`
            const chromeStyle: CSSProperties = {
              fontFamily: fontStackById(slot.font),
              fontSize: slot.fontSize ? `${slot.fontSize}px` : undefined,
              fontWeight: slot.bold ? 700 : undefined,
              fontStyle: slot.italic ? 'italic' : undefined,
            }
            return onSlotEdit ? (
              <button key={position} type="button" className={className} style={chromeStyle} data-chrome-slot={position} onClick={() => onSlotEdit(section, position)}>
                {content || <span className="td-print-chrome-empty">点击设置</span>}
              </button>
            ) : <span key={position} className={className} style={chromeStyle} data-chrome-slot={position}>{content}</span>
          })}
        </div>
      ) : null}
    </div>
  )
}

function chromeSlotContent(
  slot: PrintChromeSlots[PrintChromeSlotPosition],
  documentTitle: string,
  documentType: TeachingDocumentType,
  pageNumber: number,
  totalPages: number,
  printLayout: PrintLayoutSpec,
): ReactNode {
  if (slot.type === 'customText') return slot.text || ''
  if (slot.type === 'documentTitle') return documentTitle
  // 文档类型保留为旧数据兼容值，但不再作为用户可见输出。
  if (slot.type === 'documentType') return ''
  if (slot.type === 'pageNumber') return formatPageNumber(pageNumber, totalPages, printLayout.pageNumber)
  if (slot.type === 'totalPages') return String(totalPages)
  if (slot.type === 'date') return printDateLabel()
  return ''
}

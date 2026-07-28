import { describe, expect, it } from 'vitest'
import {
  createDefaultPrintLayout,
  createDocumentPrintLayout,
  printLayoutMetrics,
  effectivePaperMetrics,
  pageHeaderSlots,
  pageFooterSlots,
  formatPageNumber,
  totalPagesPlaceholder,
  DEFAULT_A4_PAPER,
} from '@/utils/teachingDocument'

describe('printLayout', () => {
  const paper = DEFAULT_A4_PAPER
  const spec = createDefaultPrintLayout(paper)

  describe('createDefaultPrintLayout', () => {
    it('creates a spec with header and footer enabled', () => {
      expect(spec.header.enabled).toBe(true)
      expect(spec.footer.enabled).toBe(true)
      expect(spec.paper).toBe(paper)
    })

    it('uses 10mm header/footer height by default', () => {
      expect(spec.header.heightMm).toBe(10)
      expect(spec.footer.heightMm).toBe(10)
    })

    it('does not show header on first page by default', () => {
      expect(spec.header.showOnFirstPage).toBe(false)
    })
  })

  describe('createDocumentPrintLayout', () => {
    it('applies persisted header and footer preferences over defaults', () => {
      const configured = createDocumentPrintLayout(paper, {
        headerEnabled: false,
        headerSubtitle: '高三数学',
        footerShowTotalPages: false,
        footerCustomText: '内部资料',
      })
      expect(configured.header.enabled).toBe(false)
      expect(configured.header.slots.center).toMatchObject({ type: 'customText', text: '高三数学' })
      expect(configured.footer.slots.left).toMatchObject({ type: 'customText', text: '内部资料' })
      expect(configured.pageNumber.showTotalPages).toBe(false)
      expect(configured.footer.slots.center.type).toBe('pageNumber')
    })
  })

  describe('printLayoutMetrics', () => {
    it('computes page dimensions in px from mm', () => {
      const metrics = printLayoutMetrics(spec)
      // A4: 210mm × 297mm, 1mm = 96/25.4 px ≈ 3.7795px
      expect(metrics.pageWidthPx).toBeCloseTo(210 * (96 / 25.4), 0)
      expect(metrics.pageHeightPx).toBeCloseTo(297 * (96 / 25.4), 0)
    })

    it('subtracts header and footer from content height', () => {
      const metrics = printLayoutMetrics(spec)
      const headerPx = spec.header.heightMm * (96 / 25.4)
      const footerPx = spec.footer.heightMm * (96 / 25.4)
      expect(metrics.contentHeightPx).toBeCloseTo(metrics.rawContentHeightPx - headerPx - footerPx, 5)
    })

    it('returns full content height when header/footer disabled', () => {
      const noHeaderFooter = createDefaultPrintLayout(paper)
      noHeaderFooter.header.enabled = false
      noHeaderFooter.footer.enabled = false
      const metrics = printLayoutMetrics(noHeaderFooter)
      expect(metrics.contentHeightPx).toBe(metrics.rawContentHeightPx)
      expect(metrics.headerHeightPx).toBe(0)
      expect(metrics.footerHeightPx).toBe(0)
    })
  })

  describe('effectivePaperMetrics', () => {
    it('returns PaperMetrics with reduced content height', () => {
      const effective = effectivePaperMetrics(spec)
      const full = printLayoutMetrics(spec)
      expect(effective.contentHeightPx).toBe(full.contentHeightPx)
      expect(effective.contentWidthPx).toBe(full.contentWidthPx)
      expect(effective.pageWidthPx).toBe(full.pageWidthPx)
      expect(effective.pageHeightPx).toBe(full.pageHeightPx)
    })
  })

  describe('page chrome slots', () => {
    it('returns null when header disabled', () => {
      const disabled = createDefaultPrintLayout(paper)
      disabled.header.enabled = false
      expect(pageHeaderSlots(disabled, 1)).toBeNull()
    })

    it('returns null on first page when showOnFirstPage is false', () => {
      expect(pageHeaderSlots(spec, 0)).toBeNull()
    })

    it('provides all three header columns on subsequent pages', () => {
      const slots = pageHeaderSlots(spec, 1)
      expect(slots).not.toBeNull()
      expect(slots!.center.type).toBe('documentTitle')
      expect(slots!.left.type).toBe('none')
      expect(slots!.right.type).toBe('none')
    })

    it('shows header on first page when configured', () => {
      const withFirst = createDefaultPrintLayout(paper)
      withFirst.header.showOnFirstPage = true
      expect(pageHeaderSlots(withFirst, 0)).not.toBeNull()
    })

    it('returns null when footer disabled', () => {
      const disabled = createDefaultPrintLayout(paper)
      disabled.footer.enabled = false
      expect(pageFooterSlots(disabled)).toBeNull()
    })

    it('keeps independent footer columns', () => {
      const withText = createDefaultPrintLayout(paper)
      withText.footer.slots.left = { type: 'customText', text: '内部资料', align: 'left' }
      withText.footer.slots.right = { type: 'totalPages', align: 'right' }
      expect(pageFooterSlots(withText)).toMatchObject({
        left: { type: 'customText', text: '内部资料' },
        center: { type: 'pageNumber' },
        right: { type: 'totalPages' },
      })
    })
  })

  describe('formatPageNumber', () => {
    it('formats as "current / total"', () => {
      expect(formatPageNumber(3, 10)).toBe('3 / 10')
    })

    it('can hide total pages while keeping the current page number', () => {
      expect(formatPageNumber(3, 10, { showTotalPages: false })).toBe('3')
    })

    it('supports all controlled templates with prefix and suffix', () => {
      expect(formatPageNumber(3, 4, { format: 'number' })).toBe('3')
      expect(formatPageNumber(3, 4, { format: 'page' })).toBe('第 3 页')
      expect(formatPageNumber(3, 4, { format: 'fraction' })).toBe('3 / 4')
      expect(formatPageNumber(3, 4, { format: 'page-total' })).toBe('第 3 页，共 4 页')
      expect(formatPageNumber(3, 4, { format: 'dash', prefix: 'P', suffix: '!' })).toBe('P- 3 -!')
      expect(formatPageNumber(3, 4, { format: 'page-total', showTotalPages: false })).toBe('第 3 页')
    })
  })

  describe('totalPagesPlaceholder', () => {
    it('returns at least 2 digits', () => {
      expect(totalPagesPlaceholder(1)).toBe('99')
      expect(totalPagesPlaceholder(5)).toBe('99')
    })

    it('matches digit count of total pages', () => {
      expect(totalPagesPlaceholder(100)).toBe('999')
      expect(totalPagesPlaceholder(999)).toBe('999')
    })
  })
})

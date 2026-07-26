import { describe, expect, it } from 'vitest'
import {
  createDefaultPrintLayout,
  printLayoutMetrics,
  effectivePaperMetrics,
  pageHeaderContent,
  pageFooterContent,
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

  describe('pageHeaderContent', () => {
    it('returns null when header disabled', () => {
      const disabled = createDefaultPrintLayout(paper)
      disabled.header.enabled = false
      expect(pageHeaderContent(disabled, '标题', 1)).toBeNull()
    })

    it('returns null on first page when showOnFirstPage is false', () => {
      expect(pageHeaderContent(spec, '标题', 0)).toBeNull()
    })

    it('returns title on subsequent pages', () => {
      const content = pageHeaderContent(spec, '讲义标题', 1)
      expect(content).not.toBeNull()
      expect(content!.title).toBe('讲义标题')
    })

    it('shows header on first page when configured', () => {
      const withFirst = createDefaultPrintLayout(paper)
      withFirst.header.showOnFirstPage = true
      const content = pageHeaderContent(withFirst, '标题', 0)
      expect(content).not.toBeNull()
    })
  })

  describe('pageFooterContent', () => {
    it('returns null when footer disabled', () => {
      const disabled = createDefaultPrintLayout(paper)
      disabled.footer.enabled = false
      expect(pageFooterContent(disabled, 0, 5)).toBeNull()
    })

    it('returns 1-based page number', () => {
      const content = pageFooterContent(spec, 0, 5)
      expect(content!.pageNumber).toBe(1)
      expect(content!.totalPages).toBe(5)
    })

    it('includes custom text when set', () => {
      const withText = createDefaultPrintLayout(paper)
      withText.footer.customText = '内部资料'
      const content = pageFooterContent(withText, 2, 10)
      expect(content!.customText).toBe('内部资料')
      expect(content!.pageNumber).toBe(3)
    })
  })

  describe('formatPageNumber', () => {
    it('formats as "current / total"', () => {
      expect(formatPageNumber(3, 10)).toBe('3 / 10')
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

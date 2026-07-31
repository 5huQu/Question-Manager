/**
 * rawMarkdown 与基础表格安全分页降级专项测试
 *
 * 覆盖验收场景：
 * - 短 rawMarkdown / 长 rawMarkdown / 普通表格 / 超高单表格
 * - pageBreak 前后 / box 内 rawMarkdown 降级为 unknown 子节点
 * - 相同输入结果确定 / 无内容重复遗漏
 * - 阻塞诊断阻止 export readiness / 正常文档无新增阻塞诊断
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RawMarkdownBlock, TeachingBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import { TeachingDocumentRenderer } from '@/components/teaching-document/TeachingDocumentRenderer'
import { rawMarkdownContainsTable } from '@/components/teaching-document/blocks/BlockRenderer'
import {
  DEFAULT_A4_PAPER,
  evaluateExportReadiness,
  measureTeachingDocument,
  paginateTeachingDocument,
  paperMetrics,
  rawMarkdownSegments,
  splitPolicyForBlock,
  TEACHING_DOM,
  TEACHING_DOM_SELECTORS,
  type BlockMeasurement,
  type GeometryAdapter,
  type PaginationResult,
  type RenderDiagnostic,
  type RenderReadinessResult,
  type TeachingDocumentMeasurement,
} from '.'

// ─── 工具 ────────────────────────────────────────────────────────────────────

function documentWith(content: TeachingBlock[]): TeachingDocumentV1 {
  return { version: 1, documentType: 'lecture', title: '', metadata: {}, content }
}

function rawMd(id: string, markdown: string): RawMarkdownBlock {
  return { type: 'rawMarkdown', id, markdown, reason: 'user-inserted' }
}

function measurement(blockId: string, height: number, patch: Partial<BlockMeasurement> = {}): BlockMeasurement {
  return {
    blockId,
    blockType: 'rawMarkdown',
    width: 600,
    height,
    top: 0,
    bottom: height,
    splitPolicy: 'never',
    depth: 0,
    childMeasurements: [],
    ...patch,
  }
}

function measurements(blocks: BlockMeasurement[], headerHeight = 0): TeachingDocumentMeasurement {
  return { blocks, headerHeight, diagnostics: [], measurementVersion: 'fixture-v1' }
}

const PAGE_HEIGHT = paperMetrics(DEFAULT_A4_PAPER).contentHeightPx

const TABLE_MD = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |'
const LONG_MD = Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 段内容。`).join('\n\n')

describe('rawMarkdownSegments 有序列表编号', () => {
  it('keeps list numbering continuous when blank lines split repeated 1. markers', () => {
    expect(rawMarkdownSegments('1. 第一项\n\n1. 第二项\n\n1. 第三项')).toEqual([
      '1. 第一项',
      '2. 第二项',
      '3. 第三项',
    ])
  })

  it('does not rewrite an explicit list number or continue through plain text', () => {
    expect(rawMarkdownSegments('1. 第一项\n\n2. 第二项\n\n说明文字\n\n1. 新列表')).toEqual([
      '1. 第一项',
      '2. 第二项',
      '说明文字',
      '1. 新列表',
    ])
  })
})

// ─── rawMarkdownContainsTable 静态检测 ───────────────────────────────────────

describe('rawMarkdownContainsTable', () => {
  it('detects GFM tables', () => {
    expect(rawMarkdownContainsTable(TABLE_MD)).toBe(true)
    expect(rawMarkdownContainsTable('前导文本\n\n| 甲 | 乙 |\n| :--- | ---: |\n| 1 | 2 |')).toBe(true)
  })

  it('rejects non-table pipe usage and plain text', () => {
    expect(rawMarkdownContainsTable('短内容，无表格。')).toBe(false)
    expect(rawMarkdownContainsTable('a || b 是逻辑或')).toBe(false)
    expect(rawMarkdownContainsTable('| 只有一行没有分隔行 |')).toBe(false)
    expect(rawMarkdownContainsTable('')).toBe(false)
  })
})

// ─── splitPolicy 与 DOM 属性 ─────────────────────────────────────────────────

describe('rawMarkdown DOM 契约', () => {
  it('assigns never split policy to rawMarkdown blocks', () => {
    expect(splitPolicyForBlock(rawMd('x', '内容'))).toBe('never')
  })

  it('annotates table-containing rawMarkdown in rendered DOM', () => {
    const document = documentWith([rawMd('with-table', TABLE_MD), rawMd('no-table', '纯文本')])
    const root = window.document.createElement('div')
    root.innerHTML = renderToStaticMarkup(<TeachingDocumentRenderer document={document} />)
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(TEACHING_DOM_SELECTORS.block))
    const withTable = blocks.find((el) => el.getAttribute(TEACHING_DOM.blockId) === 'with-table')
    const noTable = blocks.find((el) => el.getAttribute(TEACHING_DOM.blockId) === 'no-table')
    expect(withTable?.getAttribute(TEACHING_DOM.rawMarkdownTable)).toBe('true')
    expect(withTable?.getAttribute(TEACHING_DOM.splitPolicy)).toBe('never')
    expect(noTable?.getAttribute(TEACHING_DOM.rawMarkdownTable)).toBeNull()
  })

  it('renders markdown tables as real table elements', () => {
    const document = documentWith([rawMd('table-block', TABLE_MD)])
    const root = window.document.createElement('div')
    root.innerHTML = renderToStaticMarkup(<TeachingDocumentRenderer document={document} />)
    expect(root.querySelector('table.question-table')).not.toBeNull()
    expect(root.querySelectorAll('tbody tr')).toHaveLength(2)
  })
})

// ─── measureTeachingDocument 表格高度采集 ────────────────────────────────────

describe('measureTeachingDocument rawMarkdown 表格测量', () => {
  const geometry: GeometryAdapter = {
    measure(element) {
      if (element.tagName === 'TABLE') return { width: 600, height: 320, top: 10, bottom: 330 }
      const height = Number(element.dataset.testHeight || 40)
      return { width: 640, height, top: 0, bottom: height }
    },
  }

  it('captures maxTableHeight for rawMarkdown blocks containing tables', () => {
    const document = documentWith([rawMd('tbl', TABLE_MD), rawMd('plain', '纯文本')])
    const root = window.document.createElement('div')
    root.innerHTML = renderToStaticMarkup(<TeachingDocumentRenderer document={document} />)
    root.querySelectorAll<HTMLElement>(TEACHING_DOM_SELECTORS.block).forEach((el) => {
      el.dataset.testHeight = '350'
    })
    const result = measureTeachingDocument(root, document, geometry)
    const tbl = result.blocks.find((b) => b.blockId === 'tbl')
    const plain = result.blocks.find((b) => b.blockId === 'plain')
    expect(tbl?.maxTableHeight).toBe(320)
    expect(plain?.maxTableHeight).toBeUndefined()
  })
})

// ─── paginateTeachingDocument 分页与诊断 ─────────────────────────────────────

describe('paginateTeachingDocument rawMarkdown/表格分页', () => {
  it('places a short rawMarkdown whole without diagnostics', () => {
    const result = paginateTeachingDocument({
      document: documentWith([rawMd('short', '短内容')]),
      measurements: measurements([measurement('short', 60)]),
      paper: DEFAULT_A4_PAPER,
    })
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0].items[0]).toMatchObject({ kind: 'whole', blockId: 'short' })
    expect(result.diagnostics).toHaveLength(0)
  })

  it('moves a page-fitting rawMarkdown to the next page as a whole', () => {
    const result = paginateTeachingDocument({
      document: documentWith([rawMd('filler', 'x'), rawMd('table', TABLE_MD)]),
      measurements: measurements([
        measurement('filler', PAGE_HEIGHT - 100, { blockType: 'paragraph', splitPolicy: 'paragraph' }),
        measurement('table', 400, { maxTableHeight: 380 }),
      ]),
      paper: DEFAULT_A4_PAPER,
    })
    expect(result.pages).toHaveLength(2)
    expect(result.pages[1].items[0]).toMatchObject({ kind: 'whole', blockId: 'table' })
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
  })

  it('emits rawmarkdown-overflow for oversized rawMarkdown without unsupported-split', () => {
    const result = paginateTeachingDocument({
      document: documentWith([rawMd('huge', LONG_MD)]),
      measurements: measurements([measurement('huge', PAGE_HEIGHT + 200)]),
      paper: DEFAULT_A4_PAPER,
    })
    const codes = result.diagnostics.map((d) => d.code)
    expect(codes).toContain('rawmarkdown-overflow')
    expect(codes).toContain('page-overflow')
    expect(codes).not.toContain('unsupported-split')
    expect(codes).not.toContain('block-overflow')
    expect(result.pages[0].overflow).toBe(true)
  })

  it('emits table-overflow when the inner table alone exceeds page height', () => {
    const result = paginateTeachingDocument({
      document: documentWith([rawMd('tall-table', TABLE_MD)]),
      measurements: measurements([measurement('tall-table', PAGE_HEIGHT + 500, { maxTableHeight: PAGE_HEIGHT + 400 })]),
      paper: DEFAULT_A4_PAPER,
    })
    const tableDiag = result.diagnostics.find((d) => d.code === 'table-overflow')
    expect(tableDiag).toBeDefined()
    expect(tableDiag?.blockId).toBe('tall-table')
    expect(tableDiag?.severity).toBe('error')
    expect(result.diagnostics.some((d) => d.code === 'rawmarkdown-overflow')).toBe(false)
  })

  it('emits rawmarkdown-overflow when block overflows but inner table fits', () => {
    const result = paginateTeachingDocument({
      document: documentWith([rawMd('mixed', LONG_MD)]),
      measurements: measurements([measurement('mixed', PAGE_HEIGHT + 100, { maxTableHeight: 200 })]),
      paper: DEFAULT_A4_PAPER,
    })
    expect(result.diagnostics.some((d) => d.code === 'rawmarkdown-overflow')).toBe(true)
    expect(result.diagnostics.some((d) => d.code === 'table-overflow')).toBe(false)
  })

  it('handles pageBreak before and after rawMarkdown deterministically', () => {
    const content: TeachingBlock[] = [
      rawMd('before-break', '分页符前'),
      { type: 'pageBreak', id: 'break' },
      rawMd('after-break', '分页符后'),
    ]
    const input = {
      document: documentWith(content),
      measurements: measurements([measurement('before-break', 50), measurement('after-break', 50)]),
      paper: DEFAULT_A4_PAPER,
    }
    const result = paginateTeachingDocument(input)
    expect(result.pages.map((p) => p.items.map((i) => i.blockId))).toEqual([
      ['before-break'],
      ['after-break'],
    ])
    expect(result.diagnostics).toHaveLength(0)
    expect(paginateTeachingDocument(input)).toEqual(result)
  })

  it('produces deterministic results for identical input', () => {
    const content: TeachingBlock[] = [
      rawMd('a', TABLE_MD),
      rawMd('b', LONG_MD),
      { type: 'pageBreak', id: 'pb' },
      rawMd('c', '尾部'),
    ]
    const input = {
      document: documentWith(content),
      measurements: measurements([
        measurement('a', 300, { maxTableHeight: 280 }),
        measurement('b', PAGE_HEIGHT + 50),
        measurement('c', 40),
      ]),
      paper: DEFAULT_A4_PAPER,
    }
    const first = paginateTeachingDocument(input)
    const second = paginateTeachingDocument(input)
    expect(second).toEqual(first)
  })

  it('does not duplicate or lose blocks across pages', () => {
    const content: TeachingBlock[] = [
      rawMd('one', '内容一'),
      rawMd('two', TABLE_MD),
      { type: 'pageBreak', id: 'pb' },
      rawMd('three', LONG_MD),
    ]
    const result = paginateTeachingDocument({
      document: documentWith(content),
      measurements: measurements([
        measurement('one', 100),
        measurement('two', 300, { maxTableHeight: 280 }),
        measurement('three', PAGE_HEIGHT + 10),
      ]),
      paper: DEFAULT_A4_PAPER,
    })
    const placed = result.pages.flatMap((p) => p.items.map((i) => i.blockId))
    expect(placed.sort()).toEqual(['one', 'three', 'two'])
  })

  it('keeps normal documents free of new blocking diagnostics', () => {
    const result = paginateTeachingDocument({
      document: documentWith([
        rawMd('short', '正常短内容'),
        rawMd('table', TABLE_MD),
      ]),
      measurements: measurements([
        measurement('short', 50),
        measurement('table', 200, { maxTableHeight: 180 }),
      ]),
      paper: DEFAULT_A4_PAPER,
    })
    expect(result.diagnostics).toHaveLength(0)
  })
})

// ─── export readiness 阻塞 ───────────────────────────────────────────────────

describe('export readiness rawMarkdown 阻塞', () => {
  const stableReadiness: RenderReadinessResult = {
    ready: true,
    timedOut: false,
    pendingFonts: false,
    pendingImages: [],
    pendingQuestions: [],
    pendingFigures: [],
    failedImages: [],
    diagnostics: [],
  }

  function readinessFor(diagnostics: RenderDiagnostic[]) {
    const pagination: PaginationResult = {
      pages: [{ index: 0, items: [], usedHeight: 100, overflow: false, showDocumentHeader: true }],
      diagnostics,
      measurementVersion: 'v1',
      paragraphMeasurementVersion: 'v1',
      boxMeasurementVersion: 'v1',
      questionMeasurementVersion: 'v1',
    }
    return evaluateExportReadiness({
      documentRevision: 1,
      paginationGeneration: 1,
      pagination,
      renderReadiness: stableReadiness,
      hasUnsavedChanges: false,
      hasRevisionConflict: false,
      autosaveFailed: false,
      measurementGenerationCurrent: true,
    })
  }

  it('blocks export on rawmarkdown-overflow', () => {
    const result = readinessFor([{
      code: 'rawmarkdown-overflow',
      severity: 'error',
      blockId: 'huge',
      pageIndex: 0,
      message: '超长',
    }])
    expect(result.ready).toBe(false)
    expect(result.blockingDiagnostics.some((d) => d.code === 'rawmarkdown-overflow')).toBe(true)
  })

  it('blocks export on table-overflow', () => {
    const result = readinessFor([{
      code: 'table-overflow',
      severity: 'error',
      blockId: 'tall-table',
      pageIndex: 0,
      message: '超高表格',
    }])
    expect(result.ready).toBe(false)
    expect(result.blockingDiagnostics.some((d) => d.code === 'table-overflow')).toBe(true)
  })

  it('allows export when rawMarkdown diagnostics are absent', () => {
    const result = readinessFor([])
    expect(result.ready).toBe(true)
    expect(result.blockingDiagnostics).toHaveLength(0)
  })
})

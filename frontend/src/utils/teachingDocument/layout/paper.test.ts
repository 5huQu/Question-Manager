import { describe, expect, it } from 'vitest'
import type { TeachingDocumentStyle } from '@/types/teachingDocument'
import {
  A4_MARGIN_PRESETS,
  CSS_PIXELS_PER_MM,
  DEFAULT_A4_PAPER,
  MARGIN_PRESETS,
  STANDARD_PAPER_SIZES,
  createPaperSpec,
  isA3LandscapeSpread,
  logicalPagePaper,
  paperMetrics,
  paperSpecsEqual,
  parsePaperSpec,
  resolveDocumentPaper,
  validatePaperSpec,
  type PaperSpec,
} from '.'

// ─── STANDARD_PAPER_SIZES ─────────────────────────────────────────────────────

describe('STANDARD_PAPER_SIZES', () => {
  it('A4 portrait 基准尺寸为 210×297', () => {
    expect(STANDARD_PAPER_SIZES.A4).toEqual({ widthMm: 210, heightMm: 297 })
  })

  it('A3 portrait 基准尺寸为 297×420', () => {
    expect(STANDARD_PAPER_SIZES.A3).toEqual({ widthMm: 297, heightMm: 420 })
  })
})

// ─── createPaperSpec ──────────────────────────────────────────────────────────

describe('createPaperSpec', () => {
  it('A4 portrait 使用标准宽高', () => {
    const paper = createPaperSpec('A4', 'portrait')
    expect(paper.size).toBe('A4')
    expect(paper.orientation).toBe('portrait')
    expect(paper.widthMm).toBe(210)
    expect(paper.heightMm).toBe(297)
  })

  it('A4 landscape 交换宽高', () => {
    const paper = createPaperSpec('A4', 'landscape')
    expect(paper.widthMm).toBe(297)
    expect(paper.heightMm).toBe(210)
  })

  it('A3 portrait 使用标准宽高', () => {
    const paper = createPaperSpec('A3', 'portrait')
    expect(paper.widthMm).toBe(297)
    expect(paper.heightMm).toBe(420)
  })

  it('A3 landscape 交换宽高', () => {
    const paper = createPaperSpec('A3', 'landscape')
    expect(paper.widthMm).toBe(420)
    expect(paper.heightMm).toBe(297)
  })

  it('缺省 orientation 为 portrait', () => {
    const paper = createPaperSpec('A4')
    expect(paper.orientation).toBe('portrait')
    expect(paper.widthMm).toBe(210)
    expect(paper.heightMm).toBe(297)
  })

  it('缺省边距使用 normal preset', () => {
    const paper = createPaperSpec('A4', 'portrait')
    expect(paper.marginTopMm).toBe(MARGIN_PRESETS.A4.normal.topMm)
    expect(paper.marginRightMm).toBe(MARGIN_PRESETS.A4.normal.rightMm)
    expect(paper.marginBottomMm).toBe(MARGIN_PRESETS.A4.normal.bottomMm)
    expect(paper.marginLeftMm).toBe(MARGIN_PRESETS.A4.normal.leftMm)
  })

  it('自定义边距覆盖 preset', () => {
    const margins = { topMm: 10, rightMm: 11, bottomMm: 12, leftMm: 13 }
    const paper = createPaperSpec('A3', 'landscape', margins)
    expect(paper.marginTopMm).toBe(10)
    expect(paper.marginRightMm).toBe(11)
    expect(paper.marginBottomMm).toBe(12)
    expect(paper.marginLeftMm).toBe(13)
  })

  it('marginPreset 参数选择对应预设边距', () => {
    const compact = createPaperSpec('A4', 'portrait', undefined, 'compact')
    expect(compact.marginTopMm).toBe(MARGIN_PRESETS.A4.compact.topMm)
    const relaxed = createPaperSpec('A4', 'portrait', undefined, 'relaxed')
    expect(relaxed.marginTopMm).toBe(MARGIN_PRESETS.A4.relaxed.topMm)
  })
})

describe('A3 landscape spread', () => {
  it('uses two A4 portrait logical pages on one A3 landscape sheet', () => {
    const sheet = createPaperSpec('A3', 'landscape')
    expect(isA3LandscapeSpread(sheet)).toBe(true)
    expect(logicalPagePaper(sheet)).toMatchObject({
      size: 'A4',
      orientation: 'portrait',
      widthMm: 210,
      heightMm: 297,
      marginTopMm: sheet.marginTopMm,
      marginRightMm: sheet.marginRightMm,
      marginBottomMm: sheet.marginBottomMm,
      marginLeftMm: sheet.marginLeftMm,
    })
  })

  it('keeps non-spread paper unchanged', () => {
    const paper = createPaperSpec('A4', 'landscape')
    expect(isA3LandscapeSpread(paper)).toBe(false)
    expect(logicalPagePaper(paper)).toBe(paper)
  })
})

// ─── MARGIN_PRESETS ───────────────────────────────────────────────────────────

describe('MARGIN_PRESETS', () => {
  it('A4 和 A3 均提供 compact/normal/relaxed', () => {
    for (const size of ['A4', 'A3'] as const) {
      expect(Object.keys(MARGIN_PRESETS[size]).sort()).toEqual(['compact', 'normal', 'relaxed'])
    }
  })

  it('A4 normal 与旧 DEFAULT_A4_PAPER 边距一致', () => {
    expect(MARGIN_PRESETS.A4.normal).toEqual({ topMm: 18, rightMm: 16, bottomMm: 18, leftMm: 16 })
  })
})

// ─── 兼容导出 ─────────────────────────────────────────────────────────────────

describe('兼容导出', () => {
  it('DEFAULT_A4_PAPER 等价于 createPaperSpec(A4, portrait)', () => {
    expect(DEFAULT_A4_PAPER).toEqual(createPaperSpec('A4', 'portrait'))
    expect(DEFAULT_A4_PAPER.size).toBe('A4')
    expect(DEFAULT_A4_PAPER.orientation).toBe('portrait')
    expect(DEFAULT_A4_PAPER.widthMm).toBe(210)
    expect(DEFAULT_A4_PAPER.heightMm).toBe(297)
  })

  it('A4_MARGIN_PRESETS 与 MARGIN_PRESETS.A4 边距一致', () => {
    for (const preset of ['compact', 'normal', 'relaxed'] as const) {
      expect(A4_MARGIN_PRESETS[preset].marginTopMm).toBe(MARGIN_PRESETS.A4[preset].topMm)
      expect(A4_MARGIN_PRESETS[preset].marginRightMm).toBe(MARGIN_PRESETS.A4[preset].rightMm)
      expect(A4_MARGIN_PRESETS[preset].marginBottomMm).toBe(MARGIN_PRESETS.A4[preset].bottomMm)
      expect(A4_MARGIN_PRESETS[preset].marginLeftMm).toBe(MARGIN_PRESETS.A4[preset].leftMm)
    }
  })
})

// ─── resolveDocumentPaper ─────────────────────────────────────────────────────

describe('resolveDocumentPaper', () => {
  it('无 style 时回退为 A4 portrait normal', () => {
    const paper = resolveDocumentPaper(undefined)
    expect(paper).toEqual(DEFAULT_A4_PAPER)
  })

  it('旧文档（无 style.paper）回退为 A4 portrait + marginPreset 映射', () => {
    const style: TeachingDocumentStyle = { marginPreset: 'compact' }
    const paper = resolveDocumentPaper(style)
    expect(paper.size).toBe('A4')
    expect(paper.orientation).toBe('portrait')
    expect(paper.widthMm).toBe(210)
    expect(paper.heightMm).toBe(297)
    expect(paper.marginTopMm).toBe(MARGIN_PRESETS.A4.compact.topMm)
  })

  it('旧文档默认 marginPreset 为 normal，渲染结果与改动前一致', () => {
    const paper = resolveDocumentPaper({})
    expect(paper).toEqual(A4_MARGIN_PRESETS.normal)
  })

  it('style.paper.size = A3 时使用 A3 尺寸', () => {
    const style: TeachingDocumentStyle = { paper: { size: 'A3' } }
    const paper = resolveDocumentPaper(style)
    expect(paper.size).toBe('A3')
    expect(paper.widthMm).toBe(297)
    expect(paper.heightMm).toBe(420)
    expect(paper.marginTopMm).toBe(MARGIN_PRESETS.A3.normal.topMm)
  })

  it('style.paper.orientation = landscape 交换宽高', () => {
    const style: TeachingDocumentStyle = { paper: { size: 'A4', orientation: 'landscape' } }
    const paper = resolveDocumentPaper(style)
    expect(paper.widthMm).toBe(297)
    expect(paper.heightMm).toBe(210)
  })

  it('A3 landscape 组合', () => {
    const style: TeachingDocumentStyle = { paper: { size: 'A3', orientation: 'landscape' } }
    const paper = resolveDocumentPaper(style)
    expect(paper.widthMm).toBe(420)
    expect(paper.heightMm).toBe(297)
  })

  it('style.paper.margins 优先于 marginPreset', () => {
    const style: TeachingDocumentStyle = {
      marginPreset: 'relaxed',
      paper: { size: 'A4', margins: { topMm: 5, rightMm: 6, bottomMm: 7, leftMm: 8 } },
    }
    const paper = resolveDocumentPaper(style)
    expect(paper.marginTopMm).toBe(5)
    expect(paper.marginRightMm).toBe(6)
    expect(paper.marginBottomMm).toBe(7)
    expect(paper.marginLeftMm).toBe(8)
  })

  it('size = custom 时回退为 A4 尺寸但保留自定义边距', () => {
    const style: TeachingDocumentStyle = {
      paper: { size: 'custom', margins: { topMm: 9, rightMm: 9, bottomMm: 9, leftMm: 9 } },
    }
    const paper = resolveDocumentPaper(style)
    expect(paper.widthMm).toBe(210)
    expect(paper.heightMm).toBe(297)
    expect(paper.marginTopMm).toBe(9)
  })

  it('marginPreset 与 paper.size 组合使用对应尺寸的预设', () => {
    const style: TeachingDocumentStyle = { marginPreset: 'compact', paper: { size: 'A3' } }
    const paper = resolveDocumentPaper(style)
    expect(paper.marginTopMm).toBe(MARGIN_PRESETS.A3.compact.topMm)
  })
})

// ─── validatePaperSpec ────────────────────────────────────────────────────────

describe('validatePaperSpec', () => {
  it('合法 A4 portrait 无诊断', () => {
    expect(validatePaperSpec(createPaperSpec('A4', 'portrait'))).toEqual([])
  })

  it('合法 A3 landscape 无诊断', () => {
    expect(validatePaperSpec(createPaperSpec('A3', 'landscape'))).toEqual([])
  })

  it('合法 custom 尺寸无标准校验', () => {
    const custom: PaperSpec = {
      size: 'custom',
      orientation: 'portrait',
      widthMm: 100,
      heightMm: 200,
      marginTopMm: 10,
      marginRightMm: 10,
      marginBottomMm: 10,
      marginLeftMm: 10,
    }
    expect(validatePaperSpec(custom)).toEqual([])
  })

  it('负数边距报错', () => {
    const paper: PaperSpec = { ...createPaperSpec('A4', 'portrait'), marginTopMm: -1 }
    const diagnostics = validatePaperSpec(paper)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].code).toBe('invalid-paper-spec')
  })

  it('非有限数值报错', () => {
    const paper: PaperSpec = { ...createPaperSpec('A4', 'portrait'), widthMm: Number.NaN }
    expect(validatePaperSpec(paper)[0].code).toBe('invalid-paper-spec')
  })

  it('边距之和超过纸张宽度报错', () => {
    const paper: PaperSpec = {
      ...createPaperSpec('A4', 'portrait'),
      marginLeftMm: 110,
      marginRightMm: 110,
    }
    expect(validatePaperSpec(paper)[0].code).toBe('invalid-paper-spec')
  })

  it('边距之和超过纸张高度报错', () => {
    const paper: PaperSpec = {
      ...createPaperSpec('A4', 'portrait'),
      marginTopMm: 150,
      marginBottomMm: 150,
    }
    expect(validatePaperSpec(paper)[0].code).toBe('invalid-paper-spec')
  })

  it('A4 尺寸与标准不符报错', () => {
    const paper: PaperSpec = { ...createPaperSpec('A4', 'portrait'), widthMm: 200 }
    const diagnostics = validatePaperSpec(paper)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].code).toBe('invalid-paper-spec')
    expect(diagnostics[0].message).toContain('A4')
  })

  it('A3 landscape 尺寸与标准不符报错', () => {
    const paper: PaperSpec = { ...createPaperSpec('A3', 'landscape'), heightMm: 300 }
    const diagnostics = validatePaperSpec(paper)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].code).toBe('invalid-paper-spec')
  })

  it('非法 orientation 报错', () => {
    const paper = { ...createPaperSpec('A4', 'portrait'), orientation: 'diagonal' } as unknown as PaperSpec
    const diagnostics = validatePaperSpec(paper)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].code).toBe('invalid-paper-spec')
  })
})

// ─── paperMetrics ─────────────────────────────────────────────────────────────

describe('paperMetrics', () => {
  it('A4 portrait 度量正确', () => {
    const metrics = paperMetrics(createPaperSpec('A4', 'portrait'))
    expect(metrics.pageWidthPx).toBeCloseTo(210 * CSS_PIXELS_PER_MM)
    expect(metrics.pageHeightPx).toBeCloseTo(297 * CSS_PIXELS_PER_MM)
    expect(metrics.contentWidthPx).toBeCloseTo((210 - 16 - 16) * CSS_PIXELS_PER_MM)
    expect(metrics.contentHeightPx).toBeCloseTo((297 - 18 - 18) * CSS_PIXELS_PER_MM)
  })

  it('A3 landscape 度量正确', () => {
    const paper = createPaperSpec('A3', 'landscape')
    const metrics = paperMetrics(paper)
    expect(metrics.pageWidthPx).toBeCloseTo(420 * CSS_PIXELS_PER_MM)
    expect(metrics.pageHeightPx).toBeCloseTo(297 * CSS_PIXELS_PER_MM)
    expect(metrics.contentWidthPx).toBeCloseTo((420 - paper.marginLeftMm - paper.marginRightMm) * CSS_PIXELS_PER_MM)
    expect(metrics.contentHeightPx).toBeCloseTo((297 - paper.marginTopMm - paper.marginBottomMm) * CSS_PIXELS_PER_MM)
  })

  it('自定义边距影响内容区', () => {
    const paper = createPaperSpec('A4', 'portrait', { topMm: 10, rightMm: 10, bottomMm: 10, leftMm: 10 })
    const metrics = paperMetrics(paper)
    expect(metrics.contentWidthPx).toBeCloseTo(190 * CSS_PIXELS_PER_MM)
    expect(metrics.contentHeightPx).toBeCloseTo(277 * CSS_PIXELS_PER_MM)
  })
})

// ─── paperSpecsEqual ────────────────────────────────────────────────────────────

describe('paperSpecsEqual', () => {
  it('相同纸张相等', () => {
    expect(paperSpecsEqual(createPaperSpec('A4', 'portrait'), createPaperSpec('A4', 'portrait'))).toBe(true)
  })

  it('尺寸不同不相等', () => {
    expect(paperSpecsEqual(createPaperSpec('A4', 'portrait'), createPaperSpec('A3', 'portrait'))).toBe(false)
  })

  it('方向不同不相等', () => {
    expect(paperSpecsEqual(createPaperSpec('A4', 'portrait'), createPaperSpec('A4', 'landscape'))).toBe(false)
  })

  it('边距不同不相等', () => {
    const a = createPaperSpec('A4', 'portrait')
    const b = { ...a, marginTopMm: a.marginTopMm + 1 }
    expect(paperSpecsEqual(a, b)).toBe(false)
  })
})

// ─── parsePaperSpec ─────────────────────────────────────────────────────────────

describe('parsePaperSpec', () => {
  it('解析合法纸张对象', () => {
    const raw = { size: 'A3', orientation: 'landscape', widthMm: 420, heightMm: 297, marginTopMm: 22, marginRightMm: 20, marginBottomMm: 22, marginLeftMm: 20 }
    expect(parsePaperSpec(raw)).toEqual(raw)
  })

  it('解析 JSON 字符串对应的对象', () => {
    const raw = { size: 'A4', orientation: 'portrait', widthMm: 210, heightMm: 297, marginTopMm: 18, marginRightMm: 16, marginBottomMm: 18, marginLeftMm: 16 }
    expect(parsePaperSpec(JSON.parse(JSON.stringify(raw)))).toEqual(raw)
  })

  it('非法枚举返回 null', () => {
    expect(parsePaperSpec({ size: 'B5', orientation: 'portrait', widthMm: 210, heightMm: 297, marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0 })).toBeNull()
    expect(parsePaperSpec({ size: 'A4', orientation: 'diagonal', widthMm: 210, heightMm: 297, marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0 })).toBeNull()
  })

  it('数值非法返回 null', () => {
    expect(parsePaperSpec({ size: 'A4', orientation: 'portrait', widthMm: -1, heightMm: 297, marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0 })).toBeNull()
    expect(parsePaperSpec({ size: 'A4', orientation: 'portrait', widthMm: 'x', heightMm: 297, marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0 })).toBeNull()
  })

  it('非对象输入返回 null', () => {
    expect(parsePaperSpec(null)).toBeNull()
    expect(parsePaperSpec(undefined)).toBeNull()
    expect(parsePaperSpec('A4')).toBeNull()
    expect(parsePaperSpec([])).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import type { FigureBlock, SpacerBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import { effectiveFigureWidthMm, effectiveSpacerHeightMm, EM_TO_MM } from './layoutCompat'
import { parseTeachingDocument, validateTeachingDocument } from './validate'
import { newTeachingBlock } from './editorState'

// A4 默认内容区宽度 = 210 - 16 - 16 = 178mm
const CONTENT_WIDTH_MM = 178

describe('layoutCompat', () => {
  describe('effectiveFigureWidthMm', () => {
    it('旧数据 round-trip：只有 widthRatio 的 FigureBlock 读取为正确 mm', () => {
      const block: FigureBlock = {
        type: 'figure',
        id: 'fig1',
        asset: { type: 'documentAsset', assetId: 'a1' },
        alignment: 'center',
        widthRatio: 0.5,
      }
      expect(effectiveFigureWidthMm(block, CONTENT_WIDTH_MM)).toBeCloseTo(89, 1)
    })

    it('新字段优先：同时有 widthRatio 和 widthMm 时使用 widthMm', () => {
      const block: FigureBlock = {
        type: 'figure',
        id: 'fig2',
        asset: { type: 'documentAsset', assetId: 'a2' },
        alignment: 'center',
        widthRatio: 0.5,
        widthMm: 120,
      }
      expect(effectiveFigureWidthMm(block, CONTENT_WIDTH_MM)).toBe(120)
    })

    it('两者都无时回退到 80% 内容宽度', () => {
      const block: FigureBlock = {
        type: 'figure',
        id: 'fig3',
        asset: { type: 'documentAsset', assetId: 'a3' },
        alignment: 'center',
      }
      expect(effectiveFigureWidthMm(block, CONTENT_WIDTH_MM)).toBeCloseTo(142.4, 1)
    })

    it('widthMm 为 NaN 时回退到 widthRatio', () => {
      const block: FigureBlock = {
        type: 'figure',
        id: 'fig4',
        asset: { type: 'documentAsset', assetId: 'a4' },
        alignment: 'center',
        widthRatio: 0.6,
        widthMm: NaN,
      }
      expect(effectiveFigureWidthMm(block, CONTENT_WIDTH_MM)).toBeCloseTo(106.8, 1)
    })

    it('widthMm 为负值时回退到 widthRatio', () => {
      const block: FigureBlock = {
        type: 'figure',
        id: 'fig5',
        asset: { type: 'documentAsset', assetId: 'a5' },
        alignment: 'center',
        widthRatio: 0.7,
        widthMm: -10,
      }
      expect(effectiveFigureWidthMm(block, CONTENT_WIDTH_MM)).toBeCloseTo(124.6, 1)
    })

    it('widthMm 为 Infinity 时回退', () => {
      const block: FigureBlock = {
        type: 'figure',
        id: 'fig6',
        asset: { type: 'documentAsset', assetId: 'a6' },
        alignment: 'center',
        widthMm: Infinity,
      }
      expect(effectiveFigureWidthMm(block, CONTENT_WIDTH_MM)).toBeCloseTo(142.4, 1)
    })
  })

  describe('effectiveSpacerHeightMm', () => {
    it('旧数据 round-trip：只有 heightEm 的 SpacerBlock 读取为正确 mm', () => {
      const block: SpacerBlock = {
        type: 'spacer',
        id: 'sp1',
        heightEm: 2,
      }
      expect(effectiveSpacerHeightMm(block)).toBeCloseTo(2 * EM_TO_MM, 2)
    })

    it('新字段优先：同时有 heightEm 和 heightMm 时使用 heightMm', () => {
      const block: SpacerBlock = {
        type: 'spacer',
        id: 'sp2',
        heightEm: 2,
        heightMm: 20,
      }
      expect(effectiveSpacerHeightMm(block)).toBe(20)
    })

    it('heightMm 为 NaN 时回退到 heightEm', () => {
      const block: SpacerBlock = {
        type: 'spacer',
        id: 'sp3',
        heightEm: 4,
        heightMm: NaN,
      }
      expect(effectiveSpacerHeightMm(block)).toBeCloseTo(4 * EM_TO_MM, 2)
    })

    it('heightMm 为负值时回退到 heightEm', () => {
      const block: SpacerBlock = {
        type: 'spacer',
        id: 'sp4',
        heightEm: 3,
        heightMm: -5,
      }
      expect(effectiveSpacerHeightMm(block)).toBeCloseTo(3 * EM_TO_MM, 2)
    })

    it('heightEm 也无效时使用默认 2em', () => {
      const block = {
        type: 'spacer',
        id: 'sp5',
        heightEm: NaN,
        heightMm: -1,
      } as SpacerBlock
      expect(effectiveSpacerHeightMm(block)).toBeCloseTo(2 * EM_TO_MM, 2)
    })
  })
})

describe('validate - 新字段校验', () => {
  it('非法 widthMm 产生 warning 不阻塞', () => {
    const doc: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '测试',
      metadata: {},
      content: [
        {
          type: 'figure',
          id: 'fig1',
          asset: { type: 'documentAsset', assetId: 'a1' },
          alignment: 'center',
          widthMm: -10,
        },
      ],
    }
    const result = validateTeachingDocument(doc)
    expect(result.valid).toBe(true) // warning 不影响 valid
    expect(result.issues.some((i) => i.code === 'invalid-figure-width')).toBe(true)
  })

  it('超出上限的 widthMm 产生 warning', () => {
    const doc: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '测试',
      metadata: {},
      content: [
        {
          type: 'figure',
          id: 'fig1',
          asset: { type: 'documentAsset', assetId: 'a1' },
          alignment: 'center',
          widthMm: 600,
        },
      ],
    }
    const result = validateTeachingDocument(doc)
    expect(result.valid).toBe(true)
    expect(result.issues.some((i) => i.code === 'invalid-figure-width' && i.message.includes('500mm'))).toBe(true)
  })

  it('非法 heightMm 产生 warning 不阻塞', () => {
    const doc: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '测试',
      metadata: {},
      content: [
        { type: 'spacer', id: 'sp1', heightEm: 2, heightMm: -5 },
      ],
    }
    const result = validateTeachingDocument(doc)
    expect(result.valid).toBe(true)
    expect(result.issues.some((i) => i.code === 'invalid-spacer-height')).toBe(true)
  })

  it('answerSpace 非法值产生 warning', () => {
    const doc: TeachingDocumentV1 = {
      version: 1,
      documentType: 'worksheet',
      title: '测试',
      metadata: {},
      content: [
        {
          type: 'question',
          id: 'q1',
          questionId: 'qbank_1',
          display: { answerSpace: { heightMm: -1, style: 'blank' } },
        },
      ],
    }
    const result = validateTeachingDocument(doc)
    expect(result.valid).toBe(true)
    expect(result.issues.some((i) => i.code === 'invalid-answer-space')).toBe(true)
  })

  it('figureOverrides 非法 widthMm 产生 warning', () => {
    const doc: TeachingDocumentV1 = {
      version: 1,
      documentType: 'worksheet',
      title: '测试',
      metadata: {},
      content: [
        {
          type: 'question',
          id: 'q1',
          questionId: 'qbank_1',
          display: { figureOverrides: { fig1: { widthMm: -10 } } },
        },
      ],
    }
    const result = validateTeachingDocument(doc)
    expect(result.valid).toBe(true)
    expect(result.issues.some((i) => i.code === 'invalid-figure-override')).toBe(true)
  })

  it('空文档不报错', () => {
    const doc: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '空',
      metadata: {},
      content: [],
    }
    const result = validateTeachingDocument(doc)
    expect(result.valid).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('无图片文档不报错', () => {
    const doc: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '纯文本',
      metadata: {},
      content: [
        { type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '你好' }] },
      ],
    }
    const result = validateTeachingDocument(doc)
    expect(result.valid).toBe(true)
    expect(result.issues).toHaveLength(0)
  })
})

describe('parse - 新字段解析', () => {
  it('解析含 widthMm 和 lockAspectRatio 的 figure', () => {
    const json = {
      version: 1,
      documentType: 'lecture',
      title: '测试',
      metadata: {},
      content: [
        {
          type: 'figure',
          id: 'fig1',
          asset: { type: 'documentAsset', assetId: 'a1' },
          alignment: 'center',
          widthMm: 100,
          lockAspectRatio: false,
        },
      ],
    }
    const { document } = parseTeachingDocument(json)
    expect(document).not.toBeNull()
    const fig = document!.content[0] as FigureBlock
    expect(fig.widthMm).toBe(100)
    expect(fig.lockAspectRatio).toBe(false)
  })

  it('解析含 heightMm 的 spacer', () => {
    const json = {
      version: 1,
      documentType: 'lecture',
      title: '测试',
      metadata: {},
      content: [
        { type: 'spacer', id: 'sp1', heightEm: 2, heightMm: 15 },
      ],
    }
    const { document } = parseTeachingDocument(json)
    const spacer = document!.content[0] as SpacerBlock
    expect(spacer.heightMm).toBe(15)
    expect(spacer.heightEm).toBe(2)
  })

  it('解析含 answerSpace 和 figureOverrides 的 question', () => {
    const json = {
      version: 1,
      documentType: 'worksheet',
      title: '测试',
      metadata: {},
      content: [
        {
          type: 'question',
          id: 'q1',
          questionId: 'qbank_1',
          display: {
            showAnswer: true,
            answerSpace: { heightMm: 30, style: 'lines' },
            figureOverrides: { fig1: { widthMm: 60, alignment: 'left', groupWithNext: true, groupColumns: 3 } },
          },
        },
      ],
    }
    const { document } = parseTeachingDocument(json)
    const q = document!.content[0] as { display?: Record<string, unknown> }
    expect(q.display?.answerSpace).toEqual({ heightMm: 30, style: 'lines' })
    expect(q.display?.figureOverrides).toEqual({ fig1: { widthMm: 60, alignment: 'left', groupWithNext: true, groupColumns: 3 } })
  })

  it('非法 answerSpace 解析为 undefined', () => {
    const json = {
      version: 1,
      documentType: 'worksheet',
      title: '测试',
      metadata: {},
      content: [
        {
          type: 'question',
          id: 'q1',
          questionId: 'qbank_1',
          display: { answerSpace: { heightMm: -1, style: 'invalid' } },
        },
      ],
    }
    const { document } = parseTeachingDocument(json)
    const q = document!.content[0] as { display?: Record<string, unknown> }
    expect(q.display?.answerSpace).toBeUndefined()
  })
})

describe('editorState - 新默认值', () => {
  it('newTeachingBlock("figure") 包含 widthMm 和 lockAspectRatio', () => {
    const block = newTeachingBlock('figure') as FigureBlock
    expect(block.widthMm).toBe(80)
    expect(block.lockAspectRatio).toBe(true)
    expect(block.widthRatio).toBe(0.8) // 保留旧默认
  })

  it('newTeachingBlock("spacer") 包含 heightMm', () => {
    const block = newTeachingBlock('spacer') as SpacerBlock
    expect(block.heightMm).toBe(10)
    expect(block.heightEm).toBe(2) // 保留旧默认
  })
})

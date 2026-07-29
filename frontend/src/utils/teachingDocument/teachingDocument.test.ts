import { describe, expect, it, beforeEach } from 'vitest'
import {
  parseTeachingDocument,
  validateTeachingDocument,
  serializeTeachingDocument,
  generateBlockId,
  hasFatalTeachingDocumentIssues,
  migrateDocumentIds,
} from './validate'
import {
  getBoxTemplate,
  getBoxTemplateOrFallback,
  getAllBoxTemplates,
  registerBoxTemplate,
  resetBoxTemplateRegistry,
  BUILTIN_BOX_TEMPLATES,
} from './boxTemplates'
import {
  markdownToTeachingBlocks,
  teachingBlocksToMarkdown,
  parseInlineMarkdown,
} from './markdownCompat'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import {
  TEACHING_DOCUMENT_ABNORMAL_INPUT,
  TEACHING_DOCUMENT_NORMAL_FIXTURE,
} from '@/fixtures/teachingDocumentFixtures'

// ─── 文档解析与验证 ──────────────────────────────────────────────────────────

describe('parseTeachingDocument', () => {
  it('keeps only controlled question-spacing preferences', () => {
    const base = {
      version: 1,
      documentType: 'lecture',
      title: '间距测试',
      metadata: {},
      content: [],
    }
    expect(parseTeachingDocument({
      ...base,
      style: { questionSpacing: 'relaxed' },
    }).document?.style?.questionSpacing).toBe('relaxed')
    expect(parseTeachingDocument({
      ...base,
      style: { questionSpacing: '99px' },
    }).document?.style?.questionSpacing).toBeUndefined()
  })

  it('keeps supported persisted print preferences', () => {
    const { document } = parseTeachingDocument({
      version: 1,
      documentType: 'exam',
      title: '期中测试',
      metadata: {},
      content: [],
      style: {
        print: {
          headerSubtitle: '高三数学',
          footerCustomText: '内部资料',
          footerShowTotalPages: false,
          showDocumentType: false,
          header: {
            left: { type: 'documentTitle', align: 'left' },
            center: { type: 'customText', text: '高三数学', align: 'center' },
            right: { type: 'date', font: 'kaiti', fontSize: 12, bold: true, italic: true },
          },
          ignored: 'value',
        },
      },
    })
    expect(document?.style?.print).toMatchObject({
      header: {
        left: { type: 'documentTitle' },
        center: { type: 'customText', text: '高三数学' },
      },
      footer: {
        left: { type: 'customText', text: '内部资料' },
        center: { type: 'pageNumber' },
      },
      pageNumber: { showTotalPages: false },
      showDocumentType: false,
    })
    expect(document?.style?.print?.header?.right).toMatchObject({
      type: 'date', font: 'kaiti', fontSize: 12, bold: true, italic: true,
    })
  })

  it('only keeps controlled page chrome typography options', () => {
    const { document } = parseTeachingDocument({
      version: 1,
      documentType: 'lecture',
      title: '测试讲义',
      metadata: {},
      content: [],
      style: {
        print: {
          footer: {
            center: {
              type: 'pageNumber',
              font: 'not-a-font',
              fontSize: 99,
              bold: 'yes',
              italic: true,
            },
          },
        },
      },
    })
    expect(document?.style?.print?.footer?.center).toEqual({
      type: 'pageNumber',
      text: undefined,
      align: undefined,
      font: undefined,
      fontSize: undefined,
      bold: undefined,
      italic: true,
    })
  })
  it('parses a valid document', () => {
    const json = {
      version: 1,
      documentType: 'lecture',
      title: '测试讲义',
      metadata: { subject: '数学' },
      content: [
        { type: 'heading', id: 'h1', level: 2, content: [{ type: 'text', text: '标题' }] },
        { type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '段落' }] },
      ],
    }
    const { document, issues } = parseTeachingDocument(json)
    expect(document).not.toBeNull()
    expect(document!.version).toBe(1)
    expect(document!.documentType).toBe('lecture')
    expect(document!.title).toBe('测试讲义')
    expect(document!.content).toHaveLength(2)
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(0)
  })

  it('rejects unsupported version', () => {
    const { document, issues } = parseTeachingDocument({ version: 2, content: [] })
    expect(document).toBeNull()
    expect(issues.some((i) => i.code === 'unsupported-version')).toBe(true)
  })

  it('rejects non-object root', () => {
    const { document, issues } = parseTeachingDocument('not an object')
    expect(document).toBeNull()
    expect(issues.some((i) => i.code === 'invalid-root')).toBe(true)
  })

  it('preserves unknown block types as UnknownBlock', () => {
    const json = {
      version: 1,
      documentType: 'exam',
      title: 'Test',
      metadata: {},
      content: [
        { type: 'futureWidget', id: 'w1', config: { mode: 'graph' } },
        { type: 'paragraph', id: 'p1', content: [{ type: 'text', text: 'ok' }] },
      ],
    }
    const { document, issues } = parseTeachingDocument(json)
    expect(document).not.toBeNull()
    expect(document!.content).toHaveLength(2)
    expect(document!.content[0].type).toBe('unknown')
    if (document!.content[0].type === 'unknown') {
      expect(document!.content[0].originalType).toBe('futureWidget')
      expect(document!.content[0].rawData).toHaveProperty('config')
    }
    expect(issues.some((i) => i.code === 'unknown-block-type')).toBe(true)
  })

  it('generates IDs for blocks without them', () => {
    const json = {
      version: 1,
      documentType: 'worksheet',
      title: '',
      metadata: {},
      content: [{ type: 'divider' }],
    }
    const { document } = parseTeachingDocument(json)
    expect(document!.content[0].id).toBeTruthy()
  })

  it('falls back unknown documentType to worksheet with warning', () => {
    const json = { version: 1, documentType: 'poster', title: 'T', metadata: {}, content: [] }
    const { document, issues } = parseTeachingDocument(json)
    expect(document!.documentType).toBe('worksheet')
    expect(issues.some((i) => i.code === 'unknown-document-type')).toBe(true)
  })

  it('preserves illegal nested box children as unknown blocks', () => {
    const json = {
      version: 1,
      documentType: 'lecture',
      title: '',
      metadata: {},
      content: [{
        type: 'box',
        id: 'box1',
        templateId: 'concept',
        breakBehavior: 'auto',
        children: [
          { type: 'paragraph', id: 'cp1', content: [{ type: 'text', text: 'valid' }] },
          { type: 'box', id: 'nested', templateId: 'warning', breakBehavior: 'auto', children: [] },
        ],
      }],
    }
    const { document, issues } = parseTeachingDocument(json)
    const box = document!.content[0]
    if (box.type === 'box') {
      expect(box.children).toHaveLength(2)
      expect(box.children[0].type).toBe('paragraph')
      expect(box.children[1].type).toBe('unknown')
      if (box.children[1].type === 'unknown') {
        expect(box.children[1].originalType).toBe('box')
        expect(box.children[1].rawData).toEqual(json.content[0].children[1])
      }
    }
    expect(issues.some((i) => i.code === 'illegal-box-child')).toBe(true)
  })

  it('preserves primitive top-level and box child values', () => {
    const raw = {
      version: 1,
      documentType: 'lecture',
      title: '',
      metadata: {},
      content: [
        'top-level primitive',
        {
          type: 'box',
          id: 'box-primitives',
          templateId: 'concept',
          breakBehavior: 'auto',
          children: [42, null],
        },
      ],
    }
    const { document, issues } = parseTeachingDocument(raw)
    expect(document!.content[0]).toMatchObject({
      type: 'unknown',
      rawData: 'top-level primitive',
    })
    const box = document!.content[1]
    expect(box.type).toBe('box')
    if (box.type === 'box') {
      expect(box.children.map((child) => child.type)).toEqual(['unknown', 'unknown'])
      expect(box.children[0]).toMatchObject({ rawData: 42 })
      expect(box.children[1]).toMatchObject({ rawData: null })
    }
    expect(issues.filter((issue) => issue.code === 'illegal-box-child')).toHaveLength(2)
  })

  it('preserves unknown inline nodes and marks with diagnostics', () => {
    const rawMark = { style: 'background:url(javascript:alert(1))' }
    const rawInline = { type: 'futureInline', payload: { html: '<svg onload=alert(1)>' } }
    const { document, issues } = parseTeachingDocument({
      version: 1,
      documentType: 'lecture',
      title: '',
      metadata: {},
      content: [{
        type: 'paragraph',
        id: 'unsafe-inline',
        content: [
          { type: 'text', text: '<script>alert(1)</script>', marks: ['bold', 'event:onerror', rawMark] },
          rawInline,
        ],
      }],
    })
    const paragraph = document!.content[0]
    expect(paragraph.type).toBe('paragraph')
    if (paragraph.type === 'paragraph') {
      expect(paragraph.content[0]).toMatchObject({
        type: 'text',
        text: '<script>alert(1)</script>',
        marks: ['bold'],
        unknownMarks: ['event:onerror', rawMark],
      })
      expect(paragraph.content[1]).toEqual({
        type: 'unknown',
        originalType: 'futureInline',
        rawData: rawInline,
      })
    }
    expect(issues.some((issue) => issue.code === 'unknown-inline-mark')).toBe(true)
    expect(issues.some((issue) => issue.code === 'unknown-inline-node')).toBe(true)
  })

  it('uses deterministic placeholder IDs across ordinary parses', () => {
    const raw = {
      version: 1,
      documentType: 'worksheet',
      title: '',
      metadata: {},
      content: [{ type: 'paragraph', content: [] }, { type: 'divider' }],
    }
    const first = parseTeachingDocument(raw).document
    const second = parseTeachingDocument(raw).document
    expect(first!.content.map((block) => block.id)).toEqual(second!.content.map((block) => block.id))
    expect(first!.content.map((block) => block.id)).toEqual(['p_auto_0', 'hr_auto_1'])
  })

  it('converts legacy src into a legacyPath asset reference', () => {
    const { document } = parseTeachingDocument({
      version: 1,
      documentType: 'lecture',
      title: '',
      metadata: {},
      content: [{ type: 'figure', id: 'legacy', src: 'question_figures/legacy.png', alignment: 'left' }],
    })
    expect(document!.content[0]).toMatchObject({
      type: 'figure',
      asset: { type: 'legacyPath', path: 'question_figures/legacy.png' },
    })
  })
})

describe('validateTeachingDocument', () => {
  it('passes a valid document', () => {
    const doc: TeachingDocumentV1 = {
      version: 1,
      documentType: 'exam',
      title: '试卷',
      metadata: {},
      content: [
        { type: 'question', id: 'q1', questionId: 'item-123' },
        { type: 'divider', id: 'd1' },
      ],
    }
    const result = validateTeachingDocument(doc)
    expect(result.valid).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('reports empty questionId as error', () => {
    const doc: TeachingDocumentV1 = {
      version: 1,
      documentType: 'exam',
      title: '',
      metadata: {},
      content: [{ type: 'question', id: 'q1', questionId: '' }],
    }
    const result = validateTeachingDocument(doc)
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.code === 'empty-question-ref')).toBe(true)
    expect(hasFatalTeachingDocumentIssues(result.issues)).toBe(false)
  })

  it('reports duplicate IDs as warning', () => {
    const doc: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '',
      metadata: {},
      content: [
        { type: 'divider', id: 'dup' },
        { type: 'divider', id: 'dup' },
      ],
    }
    const result = validateTeachingDocument(doc)
    expect(result.issues.some((i) => i.code === 'duplicate-id')).toBe(true)
  })

  it('warns on empty figure reference', () => {
    const doc: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '',
      metadata: {},
      content: [{ type: 'figure', id: 'f1', asset: { type: 'legacyPath', path: '' }, alignment: 'center' }],
    }
    const result = validateTeachingDocument(doc)
    expect(result.issues.some((i) => i.code === 'empty-figure-ref')).toBe(true)
  })

  it('reports empty IDs, invalid document assets, absolute paths, and unknown templates', () => {
    const doc: TeachingDocumentV1 = {
      version: 1,
      documentType: 'lecture',
      title: '',
      metadata: {},
      content: [
        { type: 'divider', id: '' },
        { type: 'figure', id: 'empty-doc-asset', asset: { type: 'documentAsset', assetId: '' }, alignment: 'center' },
        { type: 'figure', id: 'absolute-path', asset: { type: 'legacyPath', path: '/Users/example/private.png' }, alignment: 'center' },
        { type: 'box', id: 'unknown-template', templateId: 'not-registered', breakBehavior: 'auto', children: [] },
      ],
    }
    const before = structuredClone(doc)
    const result = validateTeachingDocument(doc)
    expect(result.issues.some((issue) => issue.code === 'empty-id')).toBe(true)
    expect(result.issues.some((issue) => issue.code === 'invalid-figure-ref')).toBe(true)
    expect(result.issues.some((issue) => issue.code === 'absolute-legacy-path')).toBe(true)
    expect(result.issues.some((issue) => issue.code === 'unknown-template-id')).toBe(true)
    expect(doc).toEqual(before)
  })

  it('validates the normal fixture and diagnoses the abnormal fixture', () => {
    expect(validateTeachingDocument(TEACHING_DOCUMENT_NORMAL_FIXTURE)).toEqual({ valid: true, issues: [] })
    const parsed = parseTeachingDocument(TEACHING_DOCUMENT_ABNORMAL_INPUT)
    expect(parsed.document).not.toBeNull()
    const result = validateTeachingDocument(parsed.document!)
    expect(result.valid).toBe(false)
    expect(result.issues.some((issue) => issue.code === 'duplicate-id')).toBe(true)
    expect(result.issues.some((issue) => issue.code === 'unknown-template-id')).toBe(true)
    expect(result.issues.some((issue) => issue.code === 'invalid-figure-ref')).toBe(true)
    expect(parsed.issues.some((issue) => issue.code === 'illegal-box-child')).toBe(true)
  })
})

describe('serializeTeachingDocument', () => {
  it('round-trips through JSON', () => {
    const doc: TeachingDocumentV1 = {
      version: 1,
      documentType: 'worksheet',
      title: '练习',
      metadata: { grade: '高一' },
      content: [
        { type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '题目' }, { type: 'inlineMath', latex: 'x^2' }] },
        { type: 'blockMath', id: 'm1', latex: 'E=mc^2' },
      ],
    }
    const json = serializeTeachingDocument(doc)
    const { document } = parseTeachingDocument(JSON.parse(json))
    expect(document).toEqual(doc)
  })
})

describe('generateBlockId', () => {
  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateBlockId()))
    expect(ids.size).toBe(100)
  })
})

describe('migrateDocumentIds', () => {
  it('returns a new document with stable saveable IDs without mutating the source', () => {
    const parsed = parseTeachingDocument({
      version: 1,
      documentType: 'lecture',
      title: '',
      metadata: {},
      content: [{
        type: 'box',
        templateId: 'concept',
        breakBehavior: 'auto',
        children: [{ type: 'paragraph', content: [{ type: 'text', text: '保留' }] }],
      }],
    }).document!
    const before = structuredClone(parsed)
    const migrated = migrateDocumentIds(parsed)
    expect(migrated).not.toBe(parsed)
    expect(parsed).toEqual(before)
    expect(migrated.content[0].id).not.toMatch(/_auto_\d+$/)
    if (migrated.content[0].type === 'box') {
      expect(migrated.content[0].children[0].id).not.toMatch(/_auto_\d+$/)
    }
    const reparsed = parseTeachingDocument(JSON.parse(serializeTeachingDocument(migrated))).document
    expect(reparsed).toEqual(migrated)
  })
})

// ─── 盒子模板注册表 ──────────────────────────────────────────────────────────

describe('boxTemplates', () => {
  beforeEach(() => {
    resetBoxTemplateRegistry()
  })

  it('has 7 builtin templates including the plain text box', () => {
    expect(BUILTIN_BOX_TEMPLATES).toHaveLength(7)
    expect(getAllBoxTemplates()).toHaveLength(7)
  })

  it('retrieves builtin template by id', () => {
    const concept = getBoxTemplate('concept')
    expect(concept).toBeDefined()
    expect(concept!.label).toBe('定义 / 知识点')
    expect(concept!.tone).toBe('blue')
    expect(concept!.version).toBe(1)
  })

  it('returns undefined for unregistered template', () => {
    expect(getBoxTemplate('nonexistent')).toBeUndefined()
  })

  it('returns fallback for unregistered template', () => {
    const fallback = getBoxTemplateOrFallback('nonexistent')
    expect(fallback.id).toBe('__fallback__')
    expect(fallback.tone).toBe('neutral')
  })

  it('registers custom template', () => {
    const custom = { id: 'theorem', version: 1, label: '定理', description: '', defaultIcon: 'Box' as const, tone: 'red' as const, showHeader: true }
    expect(registerBoxTemplate(custom)).toBe(true)
    expect(getBoxTemplate('theorem')).toEqual(custom)
    expect(getAllBoxTemplates()).toHaveLength(8)
  })

  it('does not downgrade existing template version', () => {
    const v2 = { id: 'concept', version: 2, label: '概念v2', description: '', defaultIcon: 'Box' as const, tone: 'blue' as const, showHeader: true }
    expect(registerBoxTemplate(v2)).toBe(true)
    const v1 = { id: 'concept', version: 1, label: '概念v1', description: '', defaultIcon: 'Box' as const, tone: 'blue' as const, showHeader: true }
    expect(registerBoxTemplate(v1)).toBe(false)
    expect(getBoxTemplate('concept')!.label).toBe('概念v2')
  })

  it('rejects same-version duplicate registration deterministically', () => {
    const duplicate = { id: 'concept', version: 1, label: '重复概念', description: '', defaultIcon: 'Box' as const, tone: 'neutral' as const, showHeader: true }
    expect(registerBoxTemplate(duplicate)).toBe(false)
    expect(registerBoxTemplate(duplicate)).toBe(false)
    expect(getBoxTemplate('concept')!.label).toBe('定义 / 知识点')
  })

  it('allows an explicit higher-version replacement and resets predictably', () => {
    const replacement = { id: 'concept', version: 2, label: '概念 v2', description: '', defaultIcon: 'Box' as const, tone: 'neutral' as const, showHeader: true }
    expect(registerBoxTemplate(replacement)).toBe(true)
    expect(getBoxTemplate('concept')!.version).toBe(2)
    resetBoxTemplateRegistry()
    expect(getBoxTemplate('concept')!.version).toBe(1)
    expect(getAllBoxTemplates()).toHaveLength(7)
  })

  it('rejects invalid icon names even when runtime data bypasses TypeScript', () => {
    const invalid = {
      id: 'unsafe-icon',
      version: 1,
      label: '不安全图标',
      description: '',
      defaultIcon: '../../arbitrary-module',
      tone: 'neutral',
      showHeader: true,
    }
    expect(registerBoxTemplate(invalid as never)).toBe(false)
    expect(getBoxTemplate('unsafe-icon')).toBeUndefined()
  })
})

// ─── Markdown 兼容 ───────────────────────────────────────────────────────────

describe('parseInlineMarkdown', () => {
  it('parses text with inline math', () => {
    const result = parseInlineMarkdown('设 $x>0$ 且 $y<1$')
    expect(result).toHaveLength(4)
    expect(result[0]).toEqual({ type: 'text', text: '设 ' })
    expect(result[1]).toEqual({ type: 'inlineMath', latex: 'x>0' })
    expect(result[2]).toEqual({ type: 'text', text: ' 且 ' })
    expect(result[3]).toEqual({ type: 'inlineMath', latex: 'y<1' })
  })

  it('handles hard breaks', () => {
    const result = parseInlineMarkdown('第一行\n第二行')
    expect(result).toHaveLength(3)
    expect(result[1]).toEqual({ type: 'hardBreak' })
  })

  it('handles empty string', () => {
    expect(parseInlineMarkdown('')).toHaveLength(0)
  })
})

describe('markdownToTeachingBlocks', () => {
  it('converts simple paragraph losslessly', () => {
    const { blocks, lossless } = markdownToTeachingBlocks('这是一段普通文本，含 $x^2$ 公式。')
    expect(lossless).toBe(true)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('paragraph')
  })

  it('converts block math losslessly', () => {
    const { blocks, lossless } = markdownToTeachingBlocks('$$\nE=mc^2\n$$')
    expect(lossless).toBe(true)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('blockMath')
    if (blocks[0].type === 'blockMath') {
      expect(blocks[0].latex).toBe('E=mc^2')
    }
  })

  it('converts single-line block math', () => {
    const { blocks } = markdownToTeachingBlocks('$$x+y=z$$')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('blockMath')
  })

  it('degrades headings to rawMarkdown', () => {
    const { blocks, lossless } = markdownToTeachingBlocks('## 标题')
    expect(lossless).toBe(false)
    expect(blocks[0].type).toBe('rawMarkdown')
  })

  it('degrades lists to rawMarkdown', () => {
    const { blocks, lossless } = markdownToTeachingBlocks('- 项目一\n- 项目二')
    expect(lossless).toBe(false)
    expect(blocks[0].type).toBe('rawMarkdown')
  })

  it('degrades bold/italic formatting to rawMarkdown', () => {
    const { blocks, lossless } = markdownToTeachingBlocks('这是 **粗体** 文本')
    expect(lossless).toBe(false)
    expect(blocks[0].type).toBe('rawMarkdown')
  })

  it('preserves original text on conversion failure', () => {
    const input = '> 引用\n\n- 列表'
    const { blocks } = markdownToTeachingBlocks(input)
    // All content should be preserved in rawMarkdown blocks
    const allMarkdown = blocks.filter((b) => b.type === 'rawMarkdown').map((b) => (b as { markdown: string }).markdown).join('\n')
    expect(allMarkdown).toContain('引用')
    expect(allMarkdown).toContain('列表')
  })

  it('handles empty input', () => {
    const { blocks } = markdownToTeachingBlocks('')
    expect(blocks).toHaveLength(0)
  })
})

describe('teachingBlocksToMarkdown (round-trip)', () => {
  it('round-trips paragraph with inline math', () => {
    const input = '设 $x>0$ 成立'
    const { blocks, lossless } = markdownToTeachingBlocks(input)
    expect(lossless).toBe(true)
    const output = teachingBlocksToMarkdown(blocks)
    expect(output).toBe(input)
  })

  it('round-trips block math', () => {
    const input = '$$\na+b=c\n$$'
    const { blocks } = markdownToTeachingBlocks(input)
    const output = teachingBlocksToMarkdown(blocks)
    expect(output).toBe(input)
  })

  it('preserves rawMarkdown content exactly', () => {
    const input = '## 标题\n\n- 列表项'
    const { blocks } = markdownToTeachingBlocks(input)
    const output = teachingBlocksToMarkdown(blocks)
    expect(output).toBe(input)
  })
})

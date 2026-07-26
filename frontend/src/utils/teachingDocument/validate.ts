/**
 * TeachingDocument 解析、规范化与验证
 *
 * 职责分离：
 * - parseTeachingDocument: 安全反序列化 + 规范化（允许修复数据，但保留所有原始内容）
 * - validateTeachingDocument: 只读检查，不修改数据
 * - migrateDocumentIds: 明确的 ID 迁移，返回新文档
 *
 * 核心原则：
 * - 未知 version 不静默丢弃
 * - 未知 block type 保留为 UnknownBlock（含完整 rawData）
 * - 非法盒子子节点保留为 UnknownBlock + 产生 issue，不静默删除
 * - 解析时不生成随机 ID；缺失 ID 使用确定性占位符
 */

import type {
  BoxBlock,
  BoxChildBlock,
  DocumentValidationIssue,
  DocumentValidationResult,
  FigureAssetRef,
  FigureBlock,
  QuestionBlock,
  SpacerBlock,
  TeachingBlock,
  TeachingDocument,
  TeachingDocumentV1,
  TeachingInline,
  InlineMark,
} from '@/types/teachingDocument'
import { getBoxTemplate } from './boxTemplates'

// ─── 常量 ────────────────────────────────────────────────────────────────────

const KNOWN_BLOCK_TYPES = new Set([
  'heading', 'paragraph', 'blockMath', 'figure', 'question',
  'box', 'divider', 'spacer', 'pageBreak', 'rawMarkdown',
])

const BOX_CHILD_TYPES = new Set([
  'paragraph', 'blockMath', 'figure', 'question', 'divider', 'spacer',
])

const VALID_MARKS = new Set<string>(['bold', 'italic', 'underline', 'strikethrough', 'code'])

// ─── 确定性 ID ───────────────────────────────────────────────────────────────

/**
 * 生成确定性占位 ID（基于索引），用于解析时缺失 ID 的块。
 * 这些 ID 在文档保存前应通过 migrateDocumentIds 替换为稳定 ID。
 */
function deterministicId(prefix: string, index: number): string {
  return `${prefix}_auto_${index}`
}

function extractId(raw: Record<string, unknown>, prefix: string, index: number): string {
  const existing = raw.id
  if (typeof existing === 'string' && existing.trim()) return existing
  return deterministicId(prefix, index)
}

/**
 * 生成稳定的块 ID（用于编辑器创建新块或迁移）。
 * 基于时间戳 + 计数器，保证唯一性。
 */
let idCounter = 0
export function generateBlockId(prefix = 'blk'): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`
}

// ─── 行内解析 ────────────────────────────────────────────────────────────────

function unknownType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') {
    const type = (value as Record<string, unknown>).type
    return typeof type === 'string' && type ? type : 'object'
  }
  return typeof value
}

function parseInlineArray(
  value: unknown,
  issues: DocumentValidationIssue[],
  blockId: string,
): TeachingInline[] {
  if (!Array.isArray(value)) return []
  return value.map((item): TeachingInline => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push({
        level: 'warning',
        blockId,
        code: 'unknown-inline-node',
        message: `行内节点类型 "${unknownType(item)}" 暂不支持，已保留原始数据。`,
      })
      return { type: 'unknown', originalType: unknownType(item), rawData: item }
    }
    const node = item as Record<string, unknown>
    if (node.type === 'text' && typeof node.text === 'string') {
      const rawMarks = Array.isArray(node.marks) ? node.marks : undefined
      const marks = rawMarks?.filter((mark): mark is InlineMark => typeof mark === 'string' && VALID_MARKS.has(mark))
      const unknownMarks = rawMarks?.filter((mark) => typeof mark !== 'string' || !VALID_MARKS.has(mark))
      if (unknownMarks?.length) {
        issues.push({
          level: 'warning',
          blockId,
          code: 'unknown-inline-mark',
          message: `文本包含 ${unknownMarks.length} 个暂不支持的 mark，原值已保留。`,
        })
      }
      return {
        type: 'text',
        text: node.text,
        marks: marks?.length ? marks : undefined,
        unknownMarks: unknownMarks?.length ? unknownMarks : undefined,
      }
    }
    if (node.type === 'inlineMath' && typeof node.latex === 'string') {
      return { type: 'inlineMath', latex: node.latex }
    }
    if (node.type === 'hardBreak') {
      return { type: 'hardBreak' }
    }
    const originalType = unknownType(node)
    issues.push({
      level: 'warning',
      blockId,
      code: 'unknown-inline-node',
      message: `行内节点类型 "${originalType}" 暂不支持，已保留原始数据。`,
    })
    return { type: 'unknown', originalType, rawData: node }
  })
}

// ─── 图片引用解析 ────────────────────────────────────────────────────────────

function parseFigureAssetRef(node: Record<string, unknown>): FigureAssetRef {
  // 新格式：asset 字段
  const asset = node.asset
  if (asset && typeof asset === 'object') {
    const ref = asset as Record<string, unknown>
    if (ref.type === 'questionFigure' && typeof ref.questionId === 'string' && typeof ref.figureId === 'string') {
      return { type: 'questionFigure', questionId: ref.questionId, figureId: ref.figureId }
    }
    if (ref.type === 'documentAsset' && typeof ref.assetId === 'string') {
      return { type: 'documentAsset', assetId: ref.assetId }
    }
    if (ref.type === 'legacyPath' && typeof ref.path === 'string') {
      return { type: 'legacyPath', path: ref.path }
    }
  }
  // 兼容旧格式：src 字段 → legacyPath
  if (typeof node.src === 'string') {
    return { type: 'legacyPath', path: node.src }
  }
  return { type: 'legacyPath', path: '' }
}

// ─── 块解析 ──────────────────────────────────────────────────────────────────

function parseBlock(raw: unknown, index: number, issues: DocumentValidationIssue[]): TeachingBlock | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const id = deterministicId('unk', index)
    issues.push({
      level: 'warning',
      blockId: id,
      code: 'invalid-block',
      message: `索引 ${index} 处的块不是有效对象，已作为未知块保留。`,
    })
    return {
      type: 'unknown',
      id,
      originalType: unknownType(raw),
      rawData: raw,
    }
  }
  const node = raw as Record<string, unknown>
  const type = String(node.type || '')

  if (!KNOWN_BLOCK_TYPES.has(type)) {
    const id = extractId(node, 'unk', index)
    return {
      type: 'unknown',
      id,
      originalType: type || '(empty)',
      rawData: node,
    }
  }

  switch (type) {
    case 'heading': {
      const id = extractId(node, 'h', index)
      const level = Number(node.level)
      return {
        type: 'heading',
        id,
        level: ([1, 2, 3, 4].includes(level) ? level : 2) as 1 | 2 | 3 | 4,
        content: parseInlineArray(node.content, issues, id),
      }
    }
    case 'paragraph': {
      const id = extractId(node, 'p', index)
      return {
        type: 'paragraph',
        id,
        content: parseInlineArray(node.content, issues, id),
      }
    }
    case 'blockMath':
      return {
        type: 'blockMath',
        id: extractId(node, 'math', index),
        latex: typeof node.latex === 'string' ? node.latex : '',
        label: typeof node.label === 'string' ? node.label : undefined,
      }
    case 'figure': {
      const alignment = String(node.alignment || 'center')
      const widthRatio = Number(node.widthRatio)
      return {
        type: 'figure',
        id: extractId(node, 'fig', index),
        asset: parseFigureAssetRef(node),
        alt: typeof node.alt === 'string' ? node.alt : undefined,
        alignment: (['left', 'center', 'right'].includes(alignment) ? alignment : 'center') as FigureBlock['alignment'],
        widthRatio: Number.isFinite(widthRatio) && widthRatio >= 0.1 && widthRatio <= 1 ? widthRatio : undefined,
        caption: typeof node.caption === 'string' ? node.caption : undefined,
      }
    }
    case 'question': {
      const display = node.display && typeof node.display === 'object' ? node.display as Record<string, unknown> : undefined
      return {
        type: 'question',
        id: extractId(node, 'q', index),
        questionId: typeof node.questionId === 'string' ? node.questionId : '',
        display: display ? {
          showAnswer: typeof display.showAnswer === 'boolean' ? display.showAnswer : undefined,
          showAnalysis: typeof display.showAnalysis === 'boolean' ? display.showAnalysis : undefined,
          scoreOverride: typeof display.scoreOverride === 'number' ? display.scoreOverride : undefined,
          displayNumber: typeof display.displayNumber === 'string' ? display.displayNumber : undefined,
        } : undefined,
      } satisfies QuestionBlock
    }
    case 'box': {
      const breakBehavior = String(node.breakBehavior || 'auto')
      const rawChildren = Array.isArray(node.children) ? node.children : []
      const children: BoxChildBlock[] = []
      for (let ci = 0; ci < rawChildren.length; ci++) {
        const childRaw = rawChildren[ci]
        const childNode = childRaw && typeof childRaw === 'object' && !Array.isArray(childRaw)
          ? childRaw as Record<string, unknown>
          : null
        const childType = childNode ? String(childNode.type || '') : unknownType(childRaw)
        if (BOX_CHILD_TYPES.has(childType)) {
          const parsed = parseBlock(childRaw, ci, issues)
          if (parsed) children.push(parsed as BoxChildBlock)
        } else {
          // 非法子节点：保留为 UnknownBlock 并产生 issue，不静默丢弃
          const childId = childNode ? extractId(childNode, 'unk', ci) : deterministicId('unk', ci)
          children.push({
            type: 'unknown',
            id: childId,
            originalType: childType || '(empty)',
            rawData: childRaw,
          })
          issues.push({
            level: 'warning',
            blockId: extractId(node, 'box', index),
            code: 'illegal-box-child',
            message: `盒子索引 ${index} 的子节点 ${ci} 类型 "${childType}" 不允许出现在盒子内，已保留为未知块。`,
          })
        }
      }
      return {
        type: 'box',
        id: extractId(node, 'box', index),
        templateId: typeof node.templateId === 'string' ? node.templateId : 'concept',
        title: typeof node.title === 'string' ? node.title : undefined,
        icon: typeof node.icon === 'string' ? node.icon : undefined,
        breakBehavior: (['auto', 'avoid', 'allow', 'force-before'].includes(breakBehavior) ? breakBehavior : 'auto') as BoxBlock['breakBehavior'],
        children,
      }
    }
    case 'divider':
      return { type: 'divider', id: extractId(node, 'hr', index) }
    case 'spacer': {
      const heightEm = Number(node.heightEm)
      return {
        type: 'spacer',
        id: extractId(node, 'sp', index),
        heightEm: Number.isFinite(heightEm) ? Math.min(8, Math.max(0.5, heightEm)) : 2,
      } satisfies SpacerBlock
    }
    case 'pageBreak':
      return { type: 'pageBreak', id: extractId(node, 'pb', index) }
    case 'rawMarkdown':
      return {
        type: 'rawMarkdown',
        id: extractId(node, 'md', index),
        markdown: typeof node.markdown === 'string' ? node.markdown : '',
        reason: (['fallback', 'user-inserted', 'unsupported-structure'].includes(String(node.reason)) ? node.reason : undefined) as 'fallback' | 'user-inserted' | 'unsupported-structure' | undefined,
      }
    default:
      return null
  }
}

// ─── 解析（规范化） ──────────────────────────────────────────────────────────

/**
 * 安全解析 JSON 为 TeachingDocument。
 * 这是规范化过程：允许修复数据格式，但保留所有原始内容。
 * 未知块保留为 UnknownBlock；非法盒子子节点保留为 UnknownBlock + issue。
 */
export function parseTeachingDocument(json: unknown): { document: TeachingDocument | null; issues: DocumentValidationIssue[] } {
  const issues: DocumentValidationIssue[] = []

  if (!json || typeof json !== 'object') {
    issues.push({ level: 'error', code: 'invalid-root', message: '文档根节点不是有效对象。' })
    return { document: null, issues }
  }

  const root = json as Record<string, unknown>
  const version = root.version

  if (version !== 1) {
    issues.push({
      level: 'error',
      code: 'unsupported-version',
      message: `不支持的文档版本: ${JSON.stringify(version)}。当前仅支持 version: 1。`,
    })
    return { document: null, issues }
  }

  const documentType = String(root.documentType || '')
  if (!['worksheet', 'exam', 'lecture'].includes(documentType)) {
    issues.push({
      level: 'warning',
      code: 'unknown-document-type',
      message: `未知文档类型 "${documentType}"，已降级为 worksheet。`,
    })
  }

  const content = Array.isArray(root.content) ? root.content : []
  const blocks: TeachingBlock[] = []
  for (let i = 0; i < content.length; i++) {
    const block = parseBlock(content[i], i, issues)
    if (block) {
      blocks.push(block)
      if (block.type === 'unknown') {
        issues.push({
          level: 'warning',
          blockId: block.id,
          code: 'unknown-block-type',
          message: `未识别的块类型 "${block.originalType}" 已保留为未知块。`,
        })
      }
    }
  }

  const document: TeachingDocumentV1 = {
    version: 1,
    documentType: (['worksheet', 'exam', 'lecture'].includes(documentType) ? documentType : 'worksheet') as TeachingDocumentV1['documentType'],
    title: typeof root.title === 'string' ? root.title : '未命名文档',
    metadata: root.metadata && typeof root.metadata === 'object' && !Array.isArray(root.metadata) ? root.metadata as Record<string, unknown> : {},
    content: blocks,
  }

  return { document, issues }
}

// ─── 验证（只读检查） ────────────────────────────────────────────────────────

/**
 * 验证已解析文档的结构完整性。只检查，不修改。
 * 检查：空 ID、重复 ID、空题目引用、无效模板、非法盒子子节点等。
 */
export function validateTeachingDocument(document: TeachingDocument): DocumentValidationResult {
  const issues: DocumentValidationIssue[] = []
  const seenIds = new Set<string>()

  function checkBlock(block: TeachingBlock, depth: number) {
    // 空 ID
    if (!block.id || !block.id.trim()) {
      issues.push({ level: 'error', blockId: block.id, code: 'empty-id', message: '块 ID 为空。' })
    }

    // ID 唯一性
    if (seenIds.has(block.id)) {
      issues.push({ level: 'error', blockId: block.id, code: 'duplicate-id', message: `块 ID "${block.id}" 重复。` })
    }
    seenIds.add(block.id)

    // 递归深度保护
    if (depth > 3) {
      issues.push({ level: 'error', blockId: block.id, code: 'max-depth', message: '块嵌套深度超过限制。' })
      return
    }

    // 自动占位 ID 警告
    if (/_auto_\d+$/.test(block.id)) {
      issues.push({ level: 'warning', blockId: block.id, code: 'auto-id', message: `块 "${block.id}" 使用自动占位 ID，保存前应迁移为稳定 ID。` })
    }

    switch (block.type) {
      case 'question':
        if (!block.questionId.trim()) {
          issues.push({ level: 'error', blockId: block.id, code: 'empty-question-ref', message: '题目块缺少有效的 questionId 引用。' })
        }
        break
      case 'figure': {
        const asset = block.asset
        if (asset.type === 'legacyPath' && !asset.path.trim()) {
          issues.push({ level: 'warning', blockId: block.id, code: 'empty-figure-ref', message: '图片块缺少有效资源引用。' })
        }
        if (asset.type === 'legacyPath' && /^(?:[a-zA-Z]:[\\/]|\/|file:\/\/)/.test(asset.path.trim())) {
          issues.push({ level: 'error', blockId: block.id, code: 'absolute-legacy-path', message: '图片 legacyPath 不得保存本地绝对路径。' })
        }
        if (asset.type === 'questionFigure' && (!asset.questionId.trim() || !asset.figureId.trim())) {
          issues.push({ level: 'error', blockId: block.id, code: 'invalid-figure-ref', message: '图片引用 questionFigure 缺少 questionId 或 figureId。' })
        }
        if (asset.type === 'documentAsset' && !asset.assetId.trim()) {
          issues.push({ level: 'error', blockId: block.id, code: 'invalid-figure-ref', message: '图片引用 documentAsset 缺少 assetId。' })
        }
        break
      }
      case 'box':
        if (!block.templateId.trim()) {
          issues.push({ level: 'warning', blockId: block.id, code: 'empty-template-id', message: '盒子块缺少 templateId。' })
        } else if (!getBoxTemplate(block.templateId)) {
          issues.push({ level: 'warning', blockId: block.id, code: 'unknown-template-id', message: `盒子模板 "${block.templateId}" 未注册，将使用稳定降级模板。` })
        }
        for (const child of block.children) {
          // 运行时检查非法子节点（类型系统外的异常数据）
          const childRecord = child as unknown as Record<string, unknown>
          if (childRecord.type === 'box' || childRecord.type === 'heading' || childRecord.type === 'pageBreak' || childRecord.type === 'rawMarkdown') {
            issues.push({ level: 'error', blockId: block.id, code: 'illegal-box-child', message: `盒子包含不允许的子节点类型 "${String(childRecord.type)}"。` })
          }
          if (childRecord.type === 'unknown') {
            issues.push({ level: 'warning', blockId: block.id, code: 'unknown-box-child', message: `盒子包含未识别的子节点（已保留原始数据）。` })
          }
          checkBlock(child as TeachingBlock, depth + 1)
        }
        break
      case 'spacer':
        if (block.heightEm < 0.5 || block.heightEm > 8) {
          issues.push({ level: 'warning', blockId: block.id, code: 'spacer-range', message: `留白高度 ${block.heightEm}em 超出建议范围 0.5~8em。` })
        }
        break
      case 'heading':
        if (!block.content.length) {
          issues.push({ level: 'warning', blockId: block.id, code: 'empty-heading', message: '标题块内容为空。' })
        }
        checkInlines(block.content, block.id)
        break
      case 'paragraph':
        checkInlines(block.content, block.id)
        break
      case 'unknown':
        issues.push({ level: 'warning', blockId: block.id, code: 'unknown-block-type', message: `未识别的块类型 "${block.originalType}" 已保留原始数据。` })
        break
      default:
        break
    }
  }

  function checkInlines(inlines: TeachingInline[], blockId: string) {
    for (const inline of inlines) {
      if (inline.type === 'unknown') {
        issues.push({ level: 'warning', blockId, code: 'unknown-inline-node', message: `包含暂不支持的行内节点 "${inline.originalType}"，原始数据已保留。` })
      }
      if (inline.type === 'text' && inline.unknownMarks?.length) {
        issues.push({ level: 'warning', blockId, code: 'unknown-inline-mark', message: `文本包含 ${inline.unknownMarks.length} 个暂不支持的 mark，原值已保留。` })
      }
    }
  }

  for (const block of document.content) {
    checkBlock(block, 0)
  }

  return {
    valid: !issues.some((issue) => issue.level === 'error'),
    issues,
  }
}

const FATAL_TEACHING_DOCUMENT_CODES = new Set([
  'invalid-root',
  'unsupported-version',
  'invalid-document-type',
  'invalid-title',
  'invalid-metadata',
  'invalid-content',
  'empty-id',
  'duplicate-id',
  'absolute-legacy-path',
  'max-depth',
])

/**
 * 保存边界：结构损坏、身份冲突和本地绝对路径属于致命错误。
 * 空题目/图片引用等语义问题仍作为 validation error 展示，但允许原样保存。
 */
export function hasFatalTeachingDocumentIssues(issues: DocumentValidationIssue[]) {
  return issues.some((issue) => issue.level === 'error' && FATAL_TEACHING_DOCUMENT_CODES.has(issue.code))
}

// ─── ID 迁移 ─────────────────────────────────────────────────────────────────

/**
 * 明确的 ID 迁移：为所有使用自动占位 ID 的块生成稳定 ID。
 * 返回新文档（不修改原文档）。保存后 ID 不再变化。
 */
export function migrateDocumentIds(document: TeachingDocument): TeachingDocument {
  function migrateBlock(block: TeachingBlock): TeachingBlock {
    const needsMigration = /_auto_\d+$/.test(block.id)
    const id = needsMigration ? generateBlockId(block.type.slice(0, 3)) : block.id

    if (block.type === 'box') {
      return { ...block, id, children: block.children.map((c) => migrateBlock(c as TeachingBlock)) as BoxChildBlock[] }
    }
    return { ...block, id } as TeachingBlock
  }

  return {
    ...document,
    content: document.content.map(migrateBlock),
  }
}

// ─── 序列化 ──────────────────────────────────────────────────────────────────

/** 序列化文档为 JSON 字符串（安全、确定性） */
export function serializeTeachingDocument(document: TeachingDocument): string {
  return JSON.stringify(document, null, 2)
}

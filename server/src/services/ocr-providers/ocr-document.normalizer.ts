import { createHash } from 'node:crypto'
import type {
  OCRAsset,
  OCRAssetType,
  OCRBBox,
  OCRBlock,
  OCRBlockType,
  OCRDocument,
  OCRDocumentProvider,
  OCRPage,
} from '../../types/ocr-document.js'
import { createId, nowIso } from '../../utils/ids.js'

export type OCRDocumentNormalizerOptions = {
  id?: string
  sourceDocumentId: string
  rawResultPath: string
  createdAt?: string
  metadata?: Record<string, unknown>
}

export type NormalizedBlockDraft = {
  id?: string
  type?: OCRBlockType
  content?: string
  bbox?: OCRBBox
  markdown?: string
  assetId?: string
  assetPath?: string
  assetType?: OCRAssetType
  confidence?: number
}

export type NormalizedPageDraft = {
  pageNo: number
  width?: number
  height?: number
  markdown?: string
  blocks: NormalizedBlockDraft[]
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function stringFrom(value: unknown, fallback = '') {
  return value === undefined || value === null ? fallback : String(value)
}

export function numberFrom(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

export function stripDoc2xMediaComments(value: string) {
  return String(value || '').replace(/<!--\s*Media\s*-->/gi, '')
}

function isEscaped(value: string, index: number) {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) slashCount += 1
  return slashCount % 2 === 1
}

/**
 * Heuristic repair for delimiter patterns occasionally produced by OCR, such
 * as `$设 $$ p_n = 1 $ $`. This deliberately guesses at ambiguous dollar-sign
 * sequences, so callers must use it only at an explicit OCR-input boundary.
 * It is intentionally not part of any rendering or general Markdown-save path.
 */
function repairOcrInlineMathDelimitersInText(value: string) {
  const inline = (latex: string) => `$${latex.trim()}$`
  return value
    // `$说明 $$ 公式 $ $` → `说明 $公式$`
    .replace(/(?<!\\)\$([^$\n]*?\S[^$\n]*?)(?<!\\)\$\$\s*([^$\n]+?)\s*(?<!\\)\$\s+(?<!\\)\$/g, (_match, prefix: string, latex: string) => `${prefix.trimEnd()} ${inline(latex)}`)
    // `$$ 公式 $ $` → `$公式$`
    .replace(/(?<!\\)\$\$\s*([^$\n]+?)\s*(?<!\\)\$\s+(?<!\\)\$/g, (_match, latex: string) => inline(latex))
    // `$$ 公式 $` → `$公式$`, but retain valid `$$公式$$` display math.
    .replace(/(?<!\\)\$\$\s*([^$\n]+?)\s*(?<!\\)\$(?!\$)/g, (_match, latex: string) => inline(latex))
}

function repairOcrInlineMathDelimiters(value: string) {
  let output = ''
  let cursor = 0
  let codeTicks = 0
  for (let index = 0; index < value.length;) {
    if (value[index] !== '`') {
      index += 1
      continue
    }
    let end = index + 1
    while (value[end] === '`') end += 1
    const count = end - index
    if (!codeTicks) {
      output += repairOcrInlineMathDelimitersInText(value.slice(cursor, index))
      output += value.slice(index, end)
      cursor = end
      codeTicks = count
    } else if (codeTicks === count) {
      output += value.slice(cursor, end)
      cursor = end
      codeTicks = 0
    }
    index = end
  }
  return output + (codeTicks ? value.slice(cursor) : repairOcrInlineMathDelimitersInText(value.slice(cursor)))
}

function inlineCodeEnd(value: string, index: number) {
  let delimiterEnd = index + 1
  while (value[delimiterEnd] === '`') delimiterEnd += 1
  const delimiter = value.slice(index, delimiterEnd)
  const closing = value.indexOf(delimiter, delimiterEnd)
  return closing < 0 ? value.length : closing + delimiter.length
}

type CodeFence = {
  marker: string
  length: number
  lineEnd: number
}

function codeFenceAt(value: string, index: number): CodeFence | null {
  if (index > 0 && value[index - 1] !== '\n') return null
  const lineEnd = value.indexOf('\n', index)
  const end = lineEnd < 0 ? value.length : lineEnd
  const match = value.slice(index, end).match(/^\s{0,3}(`{3,}|~{3,})/)
  if (!match) return null
  return { marker: match[1][0], length: match[1].length, lineEnd: end }
}

function codeFenceEnd(value: string, opening: CodeFence) {
  let index = opening.lineEnd < value.length ? opening.lineEnd + 1 : value.length
  while (index < value.length) {
    const fence = codeFenceAt(value, index)
    if (fence && fence.marker === opening.marker && fence.length >= opening.length) {
      return fence.lineEnd < value.length ? fence.lineEnd + 1 : fence.lineEnd
    }
    const lineEnd = value.indexOf('\n', index)
    index = lineEnd < 0 ? value.length : lineEnd + 1
  }
  return value.length
}

function completeDisplayMathEnd(value: string, index: number) {
  const openingLineEnd = value.indexOf('\n', index)
  const sameLineEnd = openingLineEnd < 0 ? value.length : openingLineEnd
  for (let cursor = index + 2; cursor < sameLineEnd - 1; cursor += 1) {
    if (value[cursor] === '`') {
      cursor = inlineCodeEnd(value, cursor) - 1
      continue
    }
    if (value[cursor] === '$' && value[cursor + 1] === '$' && !isEscaped(value, cursor)) {
      return cursor + 2
    }
  }

  // A display block may span lines only when its opening delimiter is alone on
  // the line. Otherwise an incomplete OCR `$$...$` must not consume a later,
  // unrelated display block as its closing delimiter.
  if (value.slice(index + 2, sameLineEnd).trim()) return -1
  for (let lineStart = openingLineEnd < 0 ? value.length : openingLineEnd + 1; lineStart < value.length;) {
    const fence = codeFenceAt(value, lineStart)
    if (fence) return -1
    const lineEnd = value.indexOf('\n', lineStart)
    const end = lineEnd < 0 ? value.length : lineEnd
    const closing = /^\s*(\$\$)\s*$/.exec(value.slice(lineStart, end))
    if (closing && !isEscaped(value, lineStart + closing[0].indexOf('$$'))) {
      return lineStart + closing[0].indexOf('$$') + 2
    }
    lineStart = lineEnd < 0 ? value.length : lineEnd + 1
  }
  return -1
}

/**
 * Preserve fully closed display math before applying the legacy OCR regexes.
 * The regexes deliberately repair incomplete `$$...$` patterns, but must not
 * restart from the second dollar of a valid closing `$$` delimiter.
 */
function repairOcrMathOutsideCompleteDisplayMath(value: string) {
  let output = ''
  let segmentStart = 0
  for (let index = 0; index < value.length;) {
    const fence = codeFenceAt(value, index)
    if (fence) {
      output += repairOcrInlineMathDelimiters(value.slice(segmentStart, index))
      const end = codeFenceEnd(value, fence)
      output += value.slice(index, end)
      segmentStart = end
      index = end
      continue
    }
    if (value[index] === '`') {
      index = inlineCodeEnd(value, index)
      continue
    }
    if (value[index] === '$' && value[index + 1] === '$' && !isEscaped(value, index)) {
      const end = completeDisplayMathEnd(value, index)
      if (end >= 0) {
        output += repairOcrInlineMathDelimiters(value.slice(segmentStart, index))
        output += value.slice(index, end)
        segmentStart = end
        index = end
        continue
      }
    }
    index += 1
  }
  return output + repairOcrInlineMathDelimiters(value.slice(segmentStart))
}

function mapOutsideFencedCode(value: string, transformLine: (line: string) => string) {
  const lines = String(value || '').split('\n')
  let fence: { marker: string; length: number } | null = null
  return lines.map((line) => {
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (match) {
      const marker = match[1][0]
      const length = match[1].length
      if (!fence) fence = { marker, length }
      else if (fence.marker === marker && length >= fence.length) fence = null
      return line
    }
    return fence ? line : transformLine(line)
  }).join('\n')
}

/**
 * Repairs ambiguous OCR math delimiters while preserving fenced and inline
 * code. This is an OCR-only helper; do not call it for canonical Markdown.
 */
export function repairOcrMathMarkdown(value: string) {
  return repairOcrMathOutsideCompleteDisplayMath(String(value || ''))
}

export function normalizeBBox(value: unknown): OCRBBox | undefined {
  if (Array.isArray(value) && value.length >= 4) {
    const values = value.slice(0, 4).map((item) => Number(item))
    if (values.every(Number.isFinite)) return values as OCRBBox
  }

  const record = asRecord(value)
  const x = Number(record.x)
  const y = Number(record.y)
  const width = Number(record.width)
  const height = Number(record.height)
  if ([x, y, width, height].every(Number.isFinite)) {
    return [x, y, x + width, y + height]
  }

  const left = Number(record.left ?? record.x0)
  const top = Number(record.top ?? record.y0)
  const right = Number(record.right ?? record.x1)
  const bottom = Number(record.bottom ?? record.y1)
  if ([left, top, right, bottom].every(Number.isFinite)) {
    return [left, top, right, bottom]
  }

  return undefined
}

export function stableNormalizerId(prefix: string, parts: unknown[]) {
  const digest = createHash('sha1')
    .update(parts.map((part) => stringFrom(part)).join('|'))
    .digest('hex')
    .slice(0, 12)
  return prefix + '_' + digest
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function markdownImage(url: string) {
  const source = decodeHtmlAttribute(String(url || '').trim())
  if (!source) return ''
  // Keep the common URL form readable. Parentheses are escaped only when needed
  // so query parameters such as ?, &, $, and = remain unchanged.
  return `![题图](${source.replace(/\\/g, '\\\\').replace(/\)/g, '\\)')})`
}

const DOC2X_IMAGE_HOSTS = new Set([
  'cdn.noedgeai.com',
  'img.doc2x.noedgeai.com',
])

/**
 * Doc2X exposes the same crop through both its structured-layout CDN and the
 * page-markdown image host. Treat those host aliases as one remote resource,
 * while keeping the full crop query in the identity so nearby figures on the
 * same source page are never merged.
 */
export function doc2xImageResourceKey(value: string) {
  try {
    const url = new URL(decodeHtmlAttribute(String(value || '').trim()))
    if (!DOC2X_IMAGE_HOSTS.has(url.hostname.toLowerCase())) return ''
    const query = Array.from(url.searchParams.entries())
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&')
    return `${url.pathname}${query ? `?${query}` : ''}`
  } catch {
    return ''
  }
}

/** Convert provider HTML image tags without enabling arbitrary HTML rendering. */
export function normalizeHtmlImageTags(value: string) {
  const withoutMediaComments = stripDoc2xMediaComments(value)
  // Pass 1: Unwrap <div> that only contains an <img> tag
  const withoutImageOnlyDivs = withoutMediaComments.replace(/<div\b[^>]*>\s*(<img\b[\s\S]*?>)\s*<\/div>/gi, '$1')
  // Pass 2: Unwrap <div align="center"> around any content (text captions, titles, etc.)
  const withoutAlignCenterDivs = withoutImageOnlyDivs.replace(
    /<div\s+align\s*=\s*["']?center["']?\s*>\s*([\s\S]*?)\s*<\/div>/gi,
    '$1',
  )
  // Pass 3: Convert <img> tags to markdown image syntax
  return withoutAlignCenterDivs.replace(/<img\b[\s\S]*?>/gi, (tag) => {
    const quoted = /\bsrc\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag)
    const unquoted = /\bsrc\s*=\s*([^\s>]+)/i.exec(tag)
    const src = quoted?.[2] || unquoted?.[1] || ''
    return src ? markdownImage(src) : tag
  })
}

function imageMarkdownForSource(value: string) {
  const normalized = normalizeHtmlImageTags(value)
  if (/^!\[[^\]]*]\([\s\S]*\)$/.test(normalized.trim())) return normalized.trim()
  return markdownImage(value)
}

function markdownForBlock(block: NormalizedBlockDraft) {
  if (block.markdown !== undefined) return normalizeHtmlImageTags(block.markdown)
  const content = stringFrom(block.content).trim()
  if (!content) return ''
  if (block.type === 'image') return imageMarkdownForSource(content)
  return normalizeHtmlImageTags(content)
}

function markdownNeedleForStoredBlock(block: OCRBlock) {
  if (block.assetId) return `<!-- DOC2X_FIGURE:${block.assetId} -->`
  return markdownForBlock({
    type: block.type,
    content: block.content,
  })
}

export function realignOcrDocumentBlockMarkdownOffsets(doc: OCRDocument) {
  let cursor = 0
  doc.pages = doc.pages.map((page) => ({
    ...page,
    blocks: page.blocks.map((block) => {
      const needle = markdownNeedleForStoredBlock(block)
      if (!needle) {
        const { markdownStart, markdownEnd, ...rest } = block
        return rest
      }
      const start = doc.markdown.indexOf(needle, cursor)
      if (start < 0) {
        if (!block.assetId) return block
        const { markdownStart, markdownEnd, ...rest } = block
        return rest
      }
      cursor = start + needle.length
      return {
        ...block,
        markdownStart: start,
        markdownEnd: cursor,
      }
    }),
  }))
}

/**
 * The one OCR-only preparation step immediately before canonical Markdown is
 * persisted. OCR-specific cleanup must already have completed, because it may
 * remove or reorder dollar signs. Re-align block offsets after the repair so
 * later candidate parsing sees positions in the stored Markdown.
 */
export function prepareOcrDocumentMarkdownForStorage(doc: OCRDocument) {
  const prepared = {
    ...doc,
    markdown: repairOcrMathMarkdown(doc.markdown),
  }
  realignOcrDocumentBlockMarkdownOffsets(prepared)
  return prepared
}

function normalizePageNo(value: number, fallback: number) {
  const pageNo = Math.floor(Number(value))
  return Number.isFinite(pageNo) && pageNo > 0 ? pageNo : fallback
}

export function ensureOcrDocumentFiguresAndPlaceholders(doc: {
  markdown: string
  assets: OCRAsset[]
  sourceDocumentId: string
  provider: string
}) {
  const markdown = doc.markdown || ''
  const assets = doc.assets || []
  
  // Match markdown images and HTML <img> tags
  const mdPattern = /!\[[^\]]*\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))\s*\)/gi
  const htmlPattern = /<img\b[^>]*?\bsrc\s*=\s*(?:(["'])([\s\S]*?)\1|([^\s>]+))[^>]*?>/gi
  
  const foundUrls: { matchedText: string; url: string }[] = []
  
  for (const match of markdown.matchAll(mdPattern)) {
    const url = (match[1] || match[2] || '').replace(/\\\)/g, ')').trim()
    if (url) {
      foundUrls.push({ matchedText: match[0], url })
    }
  }
  
  for (const match of markdown.matchAll(htmlPattern)) {
    const url = (match[2] || match[3] || '').trim()
    if (url) {
      foundUrls.push({ matchedText: match[0], url })
    }
  }
  
  let newMarkdown = markdown
  for (const item of foundUrls) {
    const resourceKey = doc.provider === 'doc2x' ? doc2xImageResourceKey(item.url) : ''
    let asset = assets.find((candidate) => candidate.path === item.url
      || Boolean(resourceKey && doc2xImageResourceKey(candidate.path) === resourceKey))
    if (!asset) {
      const hash = createHash('sha256').update(item.url).digest('hex').slice(0, 16)
      const assetId = stableNormalizerId(doc.provider + '_inline_asset', [doc.sourceDocumentId, hash])
      asset = {
        id: assetId,
        type: 'image',
        path: item.url,
        pageNo: 1,
      }
      assets.push(asset)
    }
    
    newMarkdown = newMarkdown.split(item.matchedText).join(`<!-- DOC2X_FIGURE:${asset.id} -->`)
  }
  
  doc.markdown = stripDoc2xMediaComments(newMarkdown)
  doc.assets = assets
}

export function createNormalizedOCRDocument(
  provider: OCRDocumentProvider,
  options: OCRDocumentNormalizerOptions,
  pageDrafts: NormalizedPageDraft[],
  providerMetadata: Record<string, unknown> = {},
): OCRDocument {
  const pages: OCRPage[] = []
  const assets: OCRAsset[] = []
  let markdown = ''

  for (let pageIndex = 0; pageIndex < pageDrafts.length; pageIndex += 1) {
    const draft = pageDrafts[pageIndex]
    const pageNo = normalizePageNo(draft.pageNo, pageIndex + 1)
    if (markdown) markdown += '\n\n'
    markdown += '<!-- ' + provider.toUpperCase() + '_PAGE:' + pageNo + ' -->\n'

    const pageMarkdown = normalizeHtmlImageTags(draft.markdown !== undefined
      ? stringFrom(draft.markdown).trim()
      : draft.blocks.map(markdownForBlock).filter(Boolean).join('\n\n'))
    const pageContentStart = markdown.length
    markdown += pageMarkdown

    const blocks: OCRBlock[] = []
    let searchCursor = 0
    for (let blockIndex = 0; blockIndex < draft.blocks.length; blockIndex += 1) {
      const blockDraft = draft.blocks[blockIndex]
      const type = blockDraft.type || 'unknown'
      const content = stringFrom(blockDraft.content)
      const blockMarkdown = markdownForBlock(blockDraft)
      let markdownStart: number | undefined
      let markdownEnd: number | undefined
      if (blockMarkdown) {
        const localStart = pageMarkdown.indexOf(blockMarkdown, searchCursor)
        if (localStart >= 0) {
          markdownStart = pageContentStart + localStart
          markdownEnd = markdownStart + blockMarkdown.length
          searchCursor = localStart + blockMarkdown.length
        }
      }

      const blockId = blockDraft.id || stableNormalizerId(provider + '_block', [
        options.sourceDocumentId,
        pageNo,
        blockIndex,
        type,
        content,
      ])
      const block: OCRBlock = {
        id: blockId,
        pageNo,
        type,
        content,
      }
      if (blockDraft.bbox) block.bbox = blockDraft.bbox
      if (markdownStart !== undefined) block.markdownStart = markdownStart
      if (markdownEnd !== undefined) block.markdownEnd = markdownEnd
      if (blockDraft.confidence !== undefined) block.confidence = blockDraft.confidence

      const assetPath = stringFrom(blockDraft.assetPath)
      if (assetPath) {
        const assetId = blockDraft.assetId || stableNormalizerId(provider + '_asset', [
          options.sourceDocumentId,
          pageNo,
          blockId,
          assetPath,
        ])
        block.assetId = assetId
        assets.push({
          id: assetId,
          type: blockDraft.assetType || (type === 'table' ? 'table_image' : 'image'),
          path: assetPath,
          pageNo,
          bbox: blockDraft.bbox,
          sourceBlockId: blockId,
        })
      }

      blocks.push(block)
    }

    pages.push({
      pageNo,
      width: Math.max(0, numberFrom(draft.width)),
      height: Math.max(0, numberFrom(draft.height)),
      blocks,
    })
  }

  const doc = {
    id: options.id || createId('ocrdoc'),
    sourceDocumentId: options.sourceDocumentId,
    provider,
    rawResultPath: options.rawResultPath,
    markdown,
    pages,
    assets,
    metadata: {
      ...(options.metadata || {}),
      ...providerMetadata,
      provider,
      pageCount: pages.length,
    },
    createdAt: options.createdAt || nowIso(),
  }

  ensureOcrDocumentFiguresAndPlaceholders(doc)
  realignOcrDocumentBlockMarkdownOffsets(doc)

  return doc
}

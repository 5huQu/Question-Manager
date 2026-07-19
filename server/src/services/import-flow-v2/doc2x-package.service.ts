import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import * as unzipper from 'unzipper'
import * as sourceRepo from '../../repositories/source-documents.repo.js'
import * as ocrRepo from '../../repositories/ocr-documents.repo.js'
import type { OCRAsset, OCRBlock, OCRDocument, OCRPage } from '../../types/ocr-document.js'
import { RouteError } from '../../utils/http-error.js'
import { createId, nowIso } from '../../utils/ids.js'
import { assetPathFor } from '../../utils/paths.js'
import {
  normalizeHtmlImageTags,
  stableNormalizerId,
} from '../ocr-providers/ocr-document.normalizer.js'
import {
  ensureDir,
  sourceDocumentDir,
  storedOcrDocumentDir,
  writeJson,
  writeText,
} from './import-flow-v2.paths.js'

type UploadedDoc2xPackage = {
  originalname: string
  mimetype: string
  buffer: Buffer
  size: number
}

type ArchiveEntry = unzipper.File

type ArchiveImage = {
  archivePath: string
  entry: ArchiveEntry
  buffer: Buffer
}

export type InspectedDoc2xPackage = {
  archiveName: string
  markdownArchivePath: string
  markdownFileName: string
  markdown: string
  images: ArchiveImage[]
  referencedImagePaths: string[]
  unreferencedImageCount: number
  meanlessCommentCount: number
  entryCount: number
  uncompressedBytes: number
}

const MAX_ZIP_BYTES = 200 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 600 * 1024 * 1024
const MAX_MARKDOWN_BYTES = 30 * 1024 * 1024
const MAX_ENTRIES = 3000
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const DOC2X_MEANLESS_COMMENT_RE = /<!--\s*Meanless\s*:[\s\S]*?-->/gi

function parseMetadataBody(body: Record<string, unknown>) {
  if (typeof body.metadata === 'string') {
    try {
      const value = JSON.parse(body.metadata)
      return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
    } catch {
      throw new RouteError(400, '导入元数据不是有效的 JSON。')
    }
  }
  return body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
    ? body.metadata as Record<string, unknown>
    : body
}

function normalizeArchivePath(value: string) {
  const source = String(value || '').replace(/\\/g, '/').normalize('NFC')
  if (!source || source.includes('\0') || source.startsWith('/') || /^[a-z]:\//i.test(source)) {
    throw new RouteError(400, 'Doc2X 导出包包含不安全的文件路径。')
  }
  const parts = source.split('/').filter((item) => item && item !== '.')
  if (!parts.length || parts.some((item) => item === '..')) {
    throw new RouteError(400, 'Doc2X 导出包包含不安全的文件路径。')
  }
  return parts.join('/')
}

function decodeUtf8(buffer: Buffer, label: string) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new RouteError(400, `${label} 不是有效的 UTF-8 文本。`)
  }
}

function decodeMarkdownTarget(value: string) {
  const clean = String(value || '').replace(/\\\)/g, ')').trim()
  try {
    return decodeURIComponent(clean)
  } catch {
    return clean
  }
}

function resolveMarkdownImagePath(markdownArchivePath: string, rawTarget: string) {
  const decoded = decodeMarkdownTarget(rawTarget).split(/[?#]/, 1)[0]
  if (!decoded || /^(?:https?:|data:|file:)/i.test(decoded)) return ''
  const baseDir = path.posix.dirname(markdownArchivePath)
  return normalizeArchivePath(path.posix.normalize(path.posix.join(baseDir, decoded)))
}

function replaceLocalImagesWithMarkers(
  markdown: string,
  markdownArchivePath: string,
  assetsByArchivePath: Map<string, OCRAsset>,
) {
  const normalized = normalizeHtmlImageTags(markdown)
  const pattern = /!\[[^\]]*]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))(?:\s+["'][^)]*["'])?\s*\)/gi
  return normalized.replace(pattern, (matched, angleTarget: string | undefined, plainTarget: string | undefined) => {
    const target = angleTarget || plainTarget || ''
    const archivePath = resolveMarkdownImagePath(markdownArchivePath, target)
    if (!archivePath) return matched
    const asset = assetsByArchivePath.get(archivePath)
    if (!asset) throw new RouteError(400, `Markdown 引用的本地图片不存在：${target}`)
    return `<!-- DOC2X_FIGURE:${asset.id} -->`
  })
}

function inferredPageNo(archivePath: string) {
  const fileName = path.posix.basename(archivePath)
  const matched = /^(\d+)_/.exec(fileName)
  const value = Number(matched?.[1] || 1)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1
}

function buildPages(markdown: string, assets: OCRAsset[]) {
  const pageMap = new Map<number, OCRBlock[]>()
  for (const asset of assets) {
    const marker = `<!-- DOC2X_FIGURE:${asset.id} -->`
    const markdownStart = markdown.indexOf(marker)
    const blockId = stableNormalizerId('doc2x_manual_block', [asset.id, markdownStart])
    const block: OCRBlock = {
      id: blockId,
      pageNo: asset.pageNo || 1,
      type: 'image',
      content: asset.path,
      assetId: asset.id,
    }
    if (markdownStart >= 0) {
      block.markdownStart = markdownStart
      block.markdownEnd = markdownStart + marker.length
    }
    asset.sourceBlockId = blockId
    pageMap.set(block.pageNo, [...(pageMap.get(block.pageNo) || []), block])
  }
  if (!pageMap.size) pageMap.set(1, [])
  return Array.from(pageMap.entries())
    .sort(([left], [right]) => left - right)
    .map(([pageNo, blocks]) => ({ pageNo, width: 0, height: 0, blocks })) satisfies OCRPage[]
}

export async function inspectDoc2xMarkdownPackage(file: UploadedDoc2xPackage | undefined): Promise<InspectedDoc2xPackage> {
  if (!file?.buffer?.length) throw new RouteError(400, '请选择 Doc2X 导出的 ZIP 文件。')
  const archiveName = path.basename(String(file.originalname || 'doc2x-export.zip'))
  if (path.extname(archiveName).toLowerCase() !== '.zip') {
    throw new RouteError(400, '请上传 Doc2X 导出的 ZIP 文件。')
  }
  if (file.buffer.length > MAX_ZIP_BYTES) throw new RouteError(413, 'Doc2X 导出包超过 200 MB。')

  let directory: unzipper.CentralDirectory
  try {
    directory = await unzipper.Open.buffer(file.buffer)
  } catch {
    throw new RouteError(400, 'ZIP 文件损坏或无法读取。')
  }

  const entries = directory.files.filter((entry) => entry.type === 'File')
  if (!entries.length || entries.length > MAX_ENTRIES) {
    throw new RouteError(400, `Doc2X 导出包文件数量应在 1-${MAX_ENTRIES} 之间。`)
  }
  const entriesByPath = new Map<string, ArchiveEntry>()
  let uncompressedBytes = 0
  for (const entry of entries) {
    const archivePath = normalizeArchivePath(entry.path)
    if (entriesByPath.has(archivePath)) throw new RouteError(400, `ZIP 内存在重复文件：${archivePath}`)
    entriesByPath.set(archivePath, entry)
    uncompressedBytes += Number(entry.uncompressedSize || 0)
  }
  if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
    throw new RouteError(413, 'Doc2X 导出包解压后超过 600 MB。')
  }

  const markdownEntries = Array.from(entriesByPath.entries())
    .filter(([archivePath]) => path.posix.extname(archivePath).toLowerCase() === '.md')
  if (markdownEntries.length !== 1) {
    throw new RouteError(400, `Doc2X 导出包必须且只能包含 1 个 Markdown 文件，当前检测到 ${markdownEntries.length} 个。`)
  }
  const [markdownArchivePath, markdownEntry] = markdownEntries[0]
  if (markdownEntry.uncompressedSize > MAX_MARKDOWN_BYTES) throw new RouteError(413, 'Markdown 文件超过 30 MB。')
  const rawMarkdown = decodeUtf8(await markdownEntry.buffer(), 'Markdown 文件')
  let meanlessCommentCount = 0
  const markdown = rawMarkdown.replace(DOC2X_MEANLESS_COMMENT_RE, () => {
    meanlessCommentCount += 1
    return ''
  })

  const normalizedMarkdown = normalizeHtmlImageTags(markdown)
  const imagePattern = /!\[[^\]]*]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))(?:\s+["'][^)]*["'])?\s*\)/gi
  const referencedImagePaths = Array.from(normalizedMarkdown.matchAll(imagePattern))
    .map((match) => resolveMarkdownImagePath(markdownArchivePath, match[1] || match[2] || ''))
    .filter(Boolean)
  const uniqueReferencedPaths = Array.from(new Set(referencedImagePaths))
  const images: ArchiveImage[] = []
  for (const archivePath of uniqueReferencedPaths) {
    const entry = entriesByPath.get(archivePath)
    if (!entry) throw new RouteError(400, `Markdown 引用的本地图片不存在：${archivePath}`)
    const extension = path.posix.extname(archivePath).toLowerCase()
    if (!IMAGE_EXTENSIONS.has(extension)) {
      throw new RouteError(400, `Markdown 引用了不支持的图片格式：${archivePath}`)
    }
    images.push({ archivePath, entry, buffer: await entry.buffer() })
  }

  const archiveImageCount = Array.from(entriesByPath.keys())
    .filter((archivePath) => IMAGE_EXTENSIONS.has(path.posix.extname(archivePath).toLowerCase())).length
  return {
    archiveName,
    markdownArchivePath,
    markdownFileName: path.posix.basename(markdownArchivePath),
    markdown,
    images,
    referencedImagePaths: uniqueReferencedPaths,
    unreferencedImageCount: Math.max(0, archiveImageCount - images.length),
    meanlessCommentCount,
    entryCount: entries.length,
    uncompressedBytes,
  }
}

export async function importDoc2xMarkdownPackage(
  file: UploadedDoc2xPackage | undefined,
  body: Record<string, unknown> = {},
) {
  const inspected = await inspectDoc2xMarkdownPackage(file)
  const metadataBody = parseMetadataBody(body)
  const headingTitle = /^#\s+(.+)$/m.exec(inspected.markdown)?.[1]?.trim() || ''
  const markdownBaseName = path.posix.basename(inspected.markdownFileName, '.md')
  const title = String(metadataBody.paperTitle || metadataBody.title || headingTitle || markdownBaseName || 'Doc2X 导入资料')
  const sourceId = createId('docimport', title)
  const sourceDir = sourceDocumentDir(sourceId)
  const originalZipPath = path.join(sourceDir, 'doc2x-export.zip')
  const originalMarkdownPath = path.join(sourceDir, 'doc2x-original.md')
  const assetDir = path.join(sourceDir, 'assets')
  ensureDir(assetDir)
  fs.writeFileSync(originalZipPath, file!.buffer)
  writeText(originalMarkdownPath, inspected.markdown)

  const assets: OCRAsset[] = []
  const assetsByArchivePath = new Map<string, OCRAsset>()
  for (const image of inspected.images) {
    const extension = path.posix.extname(image.archivePath).toLowerCase()
    const contentHash = createHash('sha256').update(image.buffer).digest('hex')
    const fileName = `${contentHash.slice(0, 20)}${extension}`
    const targetPath = path.join(assetDir, fileName)
    if (!fs.existsSync(targetPath)) fs.writeFileSync(targetPath, image.buffer)
    const asset: OCRAsset = {
      id: stableNormalizerId('doc2x_manual_asset', [sourceId, image.archivePath, contentHash]),
      type: 'image',
      path: assetPathFor(targetPath),
      pageNo: inferredPageNo(image.archivePath),
    }
    assets.push(asset)
    assetsByArchivePath.set(image.archivePath, asset)
  }

  const normalizedMarkdown = replaceLocalImagesWithMarkers(
    inspected.markdown,
    inspected.markdownArchivePath,
    assetsByArchivePath,
  )
  const pages = buildPages(normalizedMarkdown, assets)
  const createdAt = nowIso()
  const ocrDocumentId = createId('ocrdoc', title)
  const ocrDir = storedOcrDocumentDir(ocrDocumentId)
  const rawPath = path.join(ocrDir, 'manual-package.json')
  const markdownPath = path.join(ocrDir, 'markdown.md')
  const pagesPath = path.join(ocrDir, 'pages.json')
  const assetsPath = path.join(ocrDir, 'assets.json')
  const packageMetadata = {
    source: 'doc2x_manual_markdown_zip',
    manualImport: true,
    archiveName: inspected.archiveName,
    markdownArchivePath: inspected.markdownArchivePath,
    entryCount: inspected.entryCount,
    uncompressedBytes: inspected.uncompressedBytes,
    referencedImageCount: assets.length,
    unreferencedImageCount: inspected.unreferencedImageCount,
    boilerplateCleanup: { meanlessCommentCount: inspected.meanlessCommentCount },
    layoutAvailable: false,
    recommendedExportSettings: {
      format: 'markdown',
      formulaMode: 'normal',
      formulaLevel: 'normal',
      imageHosting: 'local',
    },
  }
  const document: OCRDocument = {
    id: ocrDocumentId,
    sourceDocumentId: sourceId,
    provider: 'doc2x',
    rawResultPath: assetPathFor(rawPath),
    markdown: normalizedMarkdown,
    pages,
    assets,
    metadata: packageMetadata,
    createdAt,
  }
  writeJson(rawPath, {
    ...packageMetadata,
    archivePath: assetPathFor(originalZipPath),
    originalMarkdownPath: assetPathFor(originalMarkdownPath),
  })
  writeText(markdownPath, normalizedMarkdown)
  writeJson(pagesPath, pages)
  writeJson(assetsPath, assets)

  const sourceMetadata = {
    ...(metadataBody.metadata && typeof metadataBody.metadata === 'object' && !Array.isArray(metadataBody.metadata)
      ? metadataBody.metadata as Record<string, unknown>
      : {}),
    doc2xManualPackage: packageMetadata,
  }
  const source = sourceRepo.createSourceDocument({
    id: sourceId,
    title,
    originalFileName: inspected.archiveName,
    filePath: assetPathFor(originalMarkdownPath),
    fileType: 'markdown',
    pageCount: Math.max(1, ...pages.map((page) => page.pageNo)),
    provider: 'doc2x',
    status: 'ocr_succeeded',
    metadata: sourceMetadata,
    province: String(metadataBody.province || ''),
    city: String(metadataBody.city || ''),
    paperTitle: String(metadataBody.paperTitle || title),
    batchName: String(metadataBody.batchName || metadataBody.paperTitle || title),
    stage: String(metadataBody.stage || '高三'),
    subject: String(metadataBody.subject || '数学'),
    paperKind: String(metadataBody.paperKind || 'unknown') as any,
    examYear: Number(metadataBody.examYear || 0),
    sourceOrg: String(metadataBody.sourceOrg || ''),
  })
  if (!source) throw new RouteError(500, 'Doc2X 导出包资料创建失败。')
  const ocrDocument = ocrRepo.createOcrDocument({
    id: ocrDocumentId,
    sourceDocumentId: sourceId,
    provider: 'doc2x',
    rawResultPath: assetPathFor(rawPath),
    markdownPath: assetPathFor(markdownPath),
    blocksJsonPath: assetPathFor(pagesPath),
    assetsJsonPath: assetPathFor(assetsPath),
    metadata: packageMetadata,
    createdAt,
  })
  if (!ocrDocument) throw new RouteError(500, 'Doc2X 导出包 OCRDocument 创建失败。')
  return {
    sourceDocument: sourceRepo.getSourceDocument(sourceId),
    ocrDocument,
    package: {
      markdownFileName: inspected.markdownFileName,
      imageCount: assets.length,
      meanlessCommentCount: inspected.meanlessCommentCount,
      unreferencedImageCount: inspected.unreferencedImageCount,
    },
  }
}

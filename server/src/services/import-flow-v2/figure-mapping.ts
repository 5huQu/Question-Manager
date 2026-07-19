import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import * as ocrRepo from '../../repositories/ocr-documents.repo.js'
import type { OCRAsset, OCRDocument } from '../../types/ocr-document.js'
import type { CandidateFigure, QuestionCandidate } from '../../types/question-candidate.js'
import { assetPathFor, resolveStoragePath } from '../../utils/paths.js'
import { realignOcrDocumentBlockMarkdownOffsets } from '../ocr-providers/ocr-document.normalizer.js'
import { ensureDir, importDataDir, readJsonFile, readText } from './import-flow-v2.paths.js'

export function bboxRecord(bbox: CandidateFigure['bbox']) {
  if (!bbox) return undefined
  return { x: bbox[0], y: bbox[1], width: bbox[2] - bbox[0], height: bbox[3] - bbox[1] }
}

export function figuresForQuestionBank(figures: CandidateFigure[]) {
  return figures.map((figure) => {
    let usage = (figure.usage as any) || 'stem'
    if (usage === 'question') {
      usage = 'stem'
    }
    if (usage === 'option') {
      usage = 'options'
    }
    return {
      id: figure.id,
      blockId: figure.blockId || figure.sourceBlockId,
      origin: 'import_flow_v2',
      usage,
      category: usage === 'analysis' ? 'analysis' : usage === 'options' ? 'options' : 'question',
      optionLabel: usage === 'options' ? String(figure.optionLabel || '').toUpperCase() : '',
      pageNumber: figure.pageNo,
      bbox: bboxRecord(figure.bbox),
      sourcePath: figure.path,
      path: figure.path,
    }
  })
}

export type OcrFigureDiagnostics = {
  placeholderCount: number
  assetsCount: number
  unmatchedPlaceholderCount: number
  unusedAssetsCount: number
  failedDownloadCount: number
}

export function getOcrFigureDiagnostics(ocrDocId: string, candidates: QuestionCandidate[]): OcrFigureDiagnostics | undefined {
  const record = ocrRepo.getOcrDocument(ocrDocId)
  if (!record) return undefined
  
  const markdown = readText(record.markdownPath)
  const assets = readJsonFile<OCRAsset[]>(record.assetsJsonPath, [])
  
  // 1. markdown 中 DOC2X_FIGURE 占位符数量
  const placeholderMatches = Array.from(markdown.matchAll(/<!--\s*DOC2X_FIGURE:([^\s>]+)\s*-->/g))
  const placeholderCount = placeholderMatches.length
  const placeholderIds = new Set(placeholderMatches.map((m) => m[1]))
  
  // 2. assets 数量
  const assetsCount = assets.length
  
  // 3. 占位符未匹配 asset 的数量
  const unmatchedPlaceholderCount = Array.from(placeholderIds)
    .filter((id) => !assets.some((a) => a.id === id))
    .length
    
  // 4. asset 未被 candidate 使用的数量
  const usedAssetIds = new Set(candidates.flatMap((c) => c.figures.map((f) => f.id || f.blockId)))
  const unusedAssetsCount = assets.filter((a) => !usedAssetIds.has(a.id)).length
  
  // 5. 远程图片下载失败数量
  const failedDownloadCount = assets.filter((a) => a.path && /^https?:\/\//i.test(a.path)).length
  
  return {
    placeholderCount,
    assetsCount,
    unmatchedPlaceholderCount,
    unusedAssetsCount,
    failedDownloadCount,
  }
}

function replaceFigureAssetIds(doc: OCRDocument, replacements: Map<string, string>) {
  if (!replacements.size) return
  doc.markdown = String(doc.markdown || '').replace(
    /<!--\s*DOC2X_FIGURE:([^\s>]+)\s*-->/g,
    (marker, id: string) => replacements.has(id) ? `<!-- DOC2X_FIGURE:${replacements.get(id)} -->` : marker,
  )
  for (const block of doc.pages.flatMap((page) => page.blocks)) {
    if (block.assetId && replacements.has(block.assetId)) block.assetId = replacements.get(block.assetId)
  }
  doc.assets = doc.assets.filter((asset) => !replacements.has(asset.id))
  realignOcrDocumentBlockMarkdownOffsets(doc)
}

/**
 * Content hashing is only a fallback for provider URLs that could not be
 * matched before download. A marker-only asset is merged only when its bytes
 * identify exactly one positioned Figure asset; this avoids collapsing two
 * intentional occurrences of the same illustration on different pages.
 */
export function dedupeDoc2xAssetsByContent(doc: OCRDocument) {
  if (doc.provider !== 'doc2x') return
  const byDigest = new Map<string, OCRAsset[]>()
  for (const asset of doc.assets) {
    if (!asset.path || /^https?:\/\//i.test(asset.path)) continue
    try {
      const bytes = fs.readFileSync(resolveStoragePath(asset.path))
      if (!bytes.length) continue
      const digest = createHash('sha256').update(bytes).digest('hex')
      const group = byDigest.get(digest) || []
      group.push(asset)
      byDigest.set(digest, group)
    } catch {
      // A missing local file is already reported by the download diagnostics.
    }
  }

  const replacements = new Map<string, string>()
  for (const group of byDigest.values()) {
    if (group.length < 2) continue
    const positioned = group.filter((asset) => Boolean(asset.sourceBlockId || asset.bbox))
    if (positioned.length !== 1) continue
    const preferred = positioned[0]
    for (const asset of group) {
      if (asset === preferred || asset.sourceBlockId || asset.bbox) continue
      replacements.set(asset.id, preferred.id)
    }
  }
  replaceFigureAssetIds(doc, replacements)
}

export async function localizeRemoteImages(doc: OCRDocument) {
  const sourceDocumentId = doc.sourceDocumentId
  const assets = doc.assets || []
  
  const localAssetsDir = path.join(importDataDir(), 'source-documents', sourceDocumentId, 'assets')
  ensureDir(localAssetsDir)
  
  const failedUrls: string[] = []
  
  for (const asset of assets) {
    if (asset.path && (/^https?:\/\//i.test(asset.path))) {
      const url = asset.path
      const hash = createHash('sha256').update(url).digest('hex').slice(0, 16)
      
      let ext = '.png'
      try {
        const parsedUrl = new URL(url)
        const pathnameExt = path.extname(parsedUrl.pathname).toLowerCase()
        if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(pathnameExt)) {
          ext = pathnameExt
        }
      } catch (e) {
        // ignore
      }
      
      const filename = `img_${hash}${ext}`
      const localFilePath = path.join(localAssetsDir, filename)
      const portablePath = assetPathFor(localFilePath)
      
      if (fs.existsSync(localFilePath)) {
        asset.path = portablePath
        continue
      }
      
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s timeout
        const res = await fetch(url, { signal: controller.signal })
        clearTimeout(timeoutId)
        if (!res.ok) {
          throw new Error(`HTTP status ${res.status}`)
        }
        const buffer = Buffer.from(await res.arrayBuffer())
        fs.writeFileSync(localFilePath, buffer)
        asset.path = portablePath
      } catch (err) {
        console.error(`Failed to download remote asset ${url}:`, err)
        failedUrls.push(url)
      }
    }
  }
  
  if (failedUrls.length > 0) {
    if (!doc.metadata) doc.metadata = {}
    doc.metadata.image_download_failed_urls = Array.from(new Set([
      ...(doc.metadata.image_download_failed_urls as string[] || []),
      ...failedUrls
    ]))
  }

  dedupeDoc2xAssetsByContent(doc)
}

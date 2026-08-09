import { importV2Api } from '@/api/importV2'
import type { ManualFixRegion, ManualFixSegment } from '@/components/import-v2/manual-fix/types'

type CopyableRegionKind = 'question' | 'solution'

interface OrderedSegment {
  sourceDocumentId: string
  segment: ManualFixSegment
}

interface LoadedPageImage {
  image: HTMLImageElement
  release: () => void
}

const IMAGE_GAP = 24
const MAX_OUTPUT_HEIGHT = 16_000
const MAX_OUTPUT_PIXELS = 24_000_000

export function orderedManualFixSegments(
  regions: ManualFixRegion[],
  kind: CopyableRegionKind,
  fallbackSourceDocumentId: string,
): OrderedSegment[] {
  return regions
    .filter((region) => region.kind === kind)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .flatMap((region) => [...region.segments]
      .sort((left, right) => left.page - right.page || left.y - right.y || left.x - right.x)
      .map((segment) => ({
        sourceDocumentId: String(region.sourceRunId || fallbackSourceDocumentId),
        segment,
      })))
    .filter(({ sourceDocumentId, segment }) => Boolean(sourceDocumentId)
      && Number.isInteger(segment.page)
      && segment.page > 0
      && segment.width > 0
      && segment.height > 0)
}

function clippedCrop(segment: ManualFixSegment, image: HTMLImageElement) {
  const imageWidth = image.naturalWidth
  const imageHeight = image.naturalHeight
  const left = Math.max(0, Math.min(imageWidth, Math.floor(segment.x * imageWidth)))
  const top = Math.max(0, Math.min(imageHeight, Math.floor(segment.y * imageHeight)))
  const right = Math.max(left, Math.min(imageWidth, Math.ceil((segment.x + segment.width) * imageWidth)))
  const bottom = Math.max(top, Math.min(imageHeight, Math.ceil((segment.y + segment.height) * imageHeight)))
  const width = right - left
  const height = bottom - top
  return width > 0 && height > 0 ? { left, top, width, height } : null
}

async function loadPageImage(sourceDocumentId: string, pageNo: number): Promise<LoadedPageImage> {
  const blob = await importV2Api.getSourceDocumentPageImage(sourceDocumentId, pageNo)
  const objectUrl = URL.createObjectURL(blob)
  const image = new Image()
  image.decoding = 'async'
  image.src = objectUrl
  try {
    if (typeof image.decode === 'function') await image.decode()
    else {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('PDF 页面图片加载失败。'))
      })
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw new Error(`PDF 页面图片加载失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    URL.revokeObjectURL(objectUrl)
    throw new Error('PDF 页面图片尺寸无效。')
  }
  return { image, release: () => URL.revokeObjectURL(objectUrl) }
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('生成 PDF 选区图片失败。')), 'image/png')
  })
}

/**
 * Reads the same rendered PDF pages used by the manual-fix canvas, crops the
 * saved normalized regions, and puts one vertically stitched image on the
 * system clipboard. Region source IDs make question/solution documents work
 * independently in separated-document imports.
 */
export async function copyManualFixRegionScreenshot(options: {
  regions: ManualFixRegion[]
  kind: CopyableRegionKind
  fallbackSourceDocumentId: string
}) {
  const segments = orderedManualFixSegments(options.regions, options.kind, options.fallbackSourceDocumentId)
  const label = options.kind === 'question' ? '题干' : '解析'
  if (!segments.length) throw new Error(`当前候选题没有可复制的${label} PDF 选区，请先在左侧框选并保存该选区。`)
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('当前环境不支持复制图片到剪贴板，请在桌面版或 Chrome 中重试。')
  }

  const pages = new Map<string, LoadedPageImage>()
  try {
    const crops: Array<{ image: HTMLImageElement; left: number; top: number; width: number; height: number }> = []
    for (const item of segments) {
      const key = `${item.sourceDocumentId}:${item.segment.page}`
      let page = pages.get(key)
      if (!page) {
        page = await loadPageImage(item.sourceDocumentId, item.segment.page)
        pages.set(key, page)
      }
      const crop = clippedCrop(item.segment, page.image)
      if (crop) crops.push({ image: page.image, ...crop })
    }
    if (!crops.length) throw new Error(`当前${label}选区不在已渲染 PDF 页面范围内，请调整选区后重试。`)

    const originalWidth = Math.max(...crops.map((crop) => crop.width))
    const originalHeight = crops.reduce((total, crop) => total + crop.height, IMAGE_GAP * (crops.length - 1))
    const scale = Math.min(1, MAX_OUTPUT_HEIGHT / originalHeight, Math.sqrt(MAX_OUTPUT_PIXELS / (originalWidth * originalHeight)))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(originalWidth * scale))
    canvas.height = Math.max(1, Math.round(originalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建 PDF 选区图片。')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)

    let y = 0
    for (const crop of crops) {
      const width = Math.max(1, Math.round(crop.width * scale))
      const height = Math.max(1, Math.round(crop.height * scale))
      context.drawImage(crop.image, crop.left, crop.top, crop.width, crop.height, 0, y, width, height)
      y += height + Math.round(IMAGE_GAP * scale)
    }

    const blob = await canvasBlob(canvas)
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  } finally {
    pages.forEach(({ release }) => release())
  }
}

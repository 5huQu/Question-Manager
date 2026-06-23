import path from 'node:path'
import { createExportRecord, mapExportRecord, exportRecordFileSize } from '../../db/export-records.js'
import { safeName } from '../../utils/ids.js'
import { assetPathFor } from '../../utils/paths.js'
import { normalizeExportFormat, collectionExportItems } from './collections.js'
import { normalizeExportVariant } from './export-records.js'
import { buildCollectionMarkdown, buildCollectionLatex, exportCollectionWorksheetPdf } from './export.js'
import { RouteError } from '../../utils/http-error.js'

export function exportCollection(collection: NonNullable<ReturnType<typeof import('../../db/collections.js').getCollection>>, body: Record<string, any>) {
  const variant = normalizeExportVariant(body?.variant)
  if (body?.format === 'pdf') {
    try {
      const template = body?.template === 'exam' ? 'exam' : 'worksheet'
      const pdfPath = exportCollectionWorksheetPdf(collection, variant, template === 'exam' ? 'qbank-exam' : 'qbank-worksheet')
      const relativePath = assetPathFor(pdfPath)
      const record = createExportRecord({
        sourceType: 'collection',
        collectionId: collection.id,
        title: collection.title,
        format: 'pdf',
        variant: `${template}-${variant}`,
        filename: path.basename(pdfPath),
        path: relativePath,
        url: `/assets/${relativePath}`,
        items: collectionExportItems(collection),
        contentLength: exportRecordFileSize(relativePath),
        questionCount: collection.questionCount,
      })
      return { filename: path.basename(pdfPath), format: 'pdf', url: `/assets/${relativePath}`, path: relativePath, exportRecord: mapExportRecord(record) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new RouteError(500, `练习单 PDF 导出失败：${message}`)
    }
  }
  const format = normalizeExportFormat(body?.format || collection.exportFormat)
  const content = format === 'latex' ? buildCollectionLatex(collection, variant) : buildCollectionMarkdown(collection, variant)
  const extension = format === 'latex' ? 'tex' : 'md'
  const filename = `${safeName(collection.title || '试题篮')}-${variant}.${extension}`
  const record = createExportRecord({
    sourceType: 'collection',
    collectionId: collection.id,
    title: collection.title,
    format,
    variant,
    filename,
    items: collectionExportItems(collection),
    contentLength: Buffer.byteLength(content, 'utf8'),
    questionCount: collection.questionCount,
  })
  return { filename, format, content, exportRecord: mapExportRecord(record) }
}

import fs from 'node:fs'
import path from 'node:path'
import { db } from '../../db/connection.js'
import * as sourceRepo from '../../repositories/source-documents.repo.js'
import * as ocrRepo from '../../repositories/ocr-documents.repo.js'
import { RouteError } from '../../utils/http-error.js'
import { assetPathFor } from '../../utils/paths.js'
import { normalizeUploadName } from '../../utils/ocr-helpers.js'
import { activeSourceDocumentOcrTasks } from './ocr-task.service.js'
import { ensureDir, importDataDir, sourceDocumentDir, storedOcrDocumentDir } from './import-flow-v2.paths.js'

type UploadedSourceDocumentFile = {
  originalname: string
  mimetype: string
  buffer: Buffer
  size: number
}

function uploadedSourceDocumentDetails(file: UploadedSourceDocumentFile) {
  const originalFileName = normalizeUploadName(path.basename(String(file.originalname || '')))
  const extension = path.extname(originalFileName).toLowerCase()
  const mimeType = String(file.mimetype || '').toLowerCase()
  const supported = {
    '.pdf': { fileType: 'pdf' as const, mimeTypes: ['application/pdf'] },
    '.jpg': { fileType: 'image' as const, mimeTypes: ['image/jpeg', 'image/jpg'] },
    '.jpeg': { fileType: 'image' as const, mimeTypes: ['image/jpeg', 'image/jpg'] },
    '.png': { fileType: 'image' as const, mimeTypes: ['image/png'] },
  }[extension]

  if (!originalFileName || !supported || !file.buffer?.length) {
    throw new RouteError(400, '请选择 PDF、JPG 或 PNG 文件。')
  }
  if (mimeType && mimeType !== 'application/octet-stream' && !supported.mimeTypes.includes(mimeType)) {
    throw new RouteError(400, '文件类型与扩展名不匹配，请上传 PDF、JPG 或 PNG 文件。')
  }

  return { originalFileName, extension, fileType: supported.fileType }
}

export function uploadSourceDocument(file: UploadedSourceDocumentFile | undefined, body: Record<string, unknown> = {}) {
  if (!file) throw new RouteError(400, '请选择要上传的文件。')
  const { originalFileName, extension, fileType } = uploadedSourceDocumentDetails(file)
  const title = path.basename(originalFileName, extension) || originalFileName
  const sourceDocument = sourceRepo.createSourceDocument({
    title,
    originalFileName,
    fileType,
    status: 'uploaded',
    ...(body.metadata && typeof body.metadata === 'string' ? { metadata: JSON.parse(body.metadata) } : body),
  })
  if (!sourceDocument) throw new RouteError(500, '资料创建失败。')

  const targetPath = path.join(importDataDir(), 'source-documents', sourceDocument.id, `original${extension}`)
  try {
    ensureDir(path.dirname(targetPath))
    fs.writeFileSync(targetPath, file.buffer)
    const saved = sourceRepo.updateSourceDocument(sourceDocument.id, { filePath: assetPathFor(targetPath) })
    if (!saved) throw new Error('资料文件保存后未能读取记录。')
    return { sourceDocument: saved }
  } catch (error) {
    throw new RouteError(500, `资料文件保存失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

export function createSourceDocument(body: Record<string, unknown>) {
  const item = sourceRepo.createSourceDocument({
    id: body.id ? String(body.id) : undefined,
    title: String(body.title || body.originalFileName || '未命名资料'),
    originalFileName: String(body.originalFileName || ''),
    filePath: String(body.filePath || ''),
    fileType: ['pdf', 'image', 'markdown', 'json'].includes(String(body.fileType)) ? body.fileType as any : 'json',
    pageCount: Number(body.pageCount || 0),
    provider: ['doc2x', 'glm', 'manual', 'json'].includes(String(body.provider)) ? body.provider as any : undefined,
    status: 'uploaded',
    metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata as Record<string, unknown> : undefined,
    province: body.province ? String(body.province) : undefined,
    city: body.city ? String(body.city) : undefined,
    paperTitle: body.paperTitle || body.paper_title ? String(body.paperTitle || body.paper_title) : undefined,
    batchName: body.batchName || body.batch_name ? String(body.batchName || body.batch_name) : undefined,
    stage: body.stage ? String(body.stage) : undefined,
    subject: body.subject ? String(body.subject) : undefined,
    paperKind: body.paperKind || body.paper_kind ? String(body.paperKind || body.paper_kind) as any : undefined,
    examYear: body.examYear || body.exam_year ? Number(body.examYear || body.exam_year) : undefined,
    sourceOrg: body.sourceOrg || body.source_org ? String(body.sourceOrg || body.source_org) : undefined,
  })
  if (!item) throw new RouteError(500, '资料创建失败。')
  return { sourceDocument: item }
}

export function updateSourceDocument(id: string, body: Record<string, unknown>) {
  const patch = (body.sourceDocument || body.metadata || body) as Record<string, unknown>
  const updated = sourceRepo.updateSourceDocument(id, {
    title: patch.title === undefined ? undefined : String(patch.title),
    originalFileName: patch.originalFileName === undefined ? undefined : String(patch.originalFileName),
    filePath: patch.filePath === undefined ? undefined : String(patch.filePath),
    fileType: patch.fileType === undefined ? undefined : patch.fileType as any,
    pageCount: patch.pageCount === undefined ? undefined : Number(patch.pageCount),
    provider: patch.provider === undefined ? undefined : patch.provider as any,
    status: patch.status === undefined ? undefined : patch.status as any,
    metadata: patch.metadata && typeof patch.metadata === 'object' && !Array.isArray(patch.metadata) ? patch.metadata as Record<string, unknown> : undefined,
    province: patch.province === undefined ? undefined : String(patch.province),
    city: patch.city === undefined ? undefined : String(patch.city),
    paperTitle: patch.paperTitle === undefined && patch.paper_title === undefined ? undefined : String(patch.paperTitle ?? patch.paper_title ?? ''),
    batchName: patch.batchName === undefined && patch.batch_name === undefined ? undefined : String(patch.batchName ?? patch.batch_name ?? ''),
    stage: patch.stage === undefined ? undefined : String(patch.stage),
    subject: patch.subject === undefined ? undefined : String(patch.subject),
    paperKind: patch.paperKind === undefined && patch.paper_kind === undefined ? undefined : String(patch.paperKind ?? patch.paper_kind) as any,
    examYear: patch.examYear === undefined && patch.exam_year === undefined ? undefined : Number(patch.examYear ?? patch.exam_year),
    sourceOrg: patch.sourceOrg === undefined && patch.source_org === undefined ? undefined : String(patch.sourceOrg ?? patch.source_org ?? ''),
  })
  if (!updated) throw new RouteError(404, '资料不存在。')
  return { sourceDocument: updated }
}

export function listSourceDocuments(query: Record<string, unknown>) {
  return {
    items: sourceRepo.listSourceDocuments({
      status: query.status ? String(query.status) as any : undefined,
      provider: query.provider ? String(query.provider) as any : undefined,
      fileType: query.fileType ? String(query.fileType) as any : undefined,
      limit: Number(query.limit || 100),
      offset: Number(query.offset || 0),
    }),
  }
}

export function getSourceDocument(id: string) {
  const sourceDocument = sourceRepo.getSourceDocument(id)
  if (!sourceDocument) throw new RouteError(404, '资料不存在。')
  return { sourceDocument }
}

export function deleteSourceDocument(id: string) {
  const sourceDocument = sourceRepo.getSourceDocument(id)
  if (!sourceDocument) {
    throw new RouteError(404, '资料不存在。')
  }

  if (activeSourceDocumentOcrTasks.has(id)) {
    throw new RouteError(409, '该资料的 OCR 任务正在运行，无法删除。')
  }

  // 1. 获取关联的 OCR 文件列表
  const ocrDocs = ocrRepo.listOcrDocuments({ sourceDocumentId: id })

  // 2. 清理磁盘文件
  try {
    // 删除 OCR 文件目录
    for (const ocrDoc of ocrDocs) {
      const ocrDir = storedOcrDocumentDir(ocrDoc.id)
      if (fs.existsSync(ocrDir)) {
        fs.rmSync(ocrDir, { recursive: true, force: true })
      }
    }

    // 删除源资料目录
    const srcDir = sourceDocumentDir(id)
    if (fs.existsSync(srcDir)) {
      fs.rmSync(srcDir, { recursive: true, force: true })
    }
  } catch (err) {
    console.error('Failed to delete source document directories from disk:', err)
  }

  // 3. 删除数据库记录
  db.exec('BEGIN IMMEDIATE')
  try {
    // 删除相关标注区域
    db.prepare('DELETE FROM pdf_slicer_annotation_regions WHERE source_run_id = ?').run(id)
    // 删除相关标注会话
    db.prepare('DELETE FROM pdf_slicer_annotation_sessions WHERE batch_id IN (SELECT id FROM question_candidates WHERE source_document_id = ?)').run(id)
    // 删除源资料（通过级联删除级联删除 ocr_documents 和 question_candidates）
    db.prepare('DELETE FROM source_documents WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // ignore
    }
    throw error
  }

  return { success: true }
}

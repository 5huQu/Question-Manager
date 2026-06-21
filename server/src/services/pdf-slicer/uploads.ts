import fs from 'node:fs'
import path from 'node:path'
import { db } from '../../db/connection.js'
import { runsRoot } from '../../config.js'
import { createId, nowIso, isWordUploadKind } from '../../utils/ids.js'
import { parseJson } from '../../utils/json.js'
import { assetPathFor } from '../../utils/paths.js'
import {
  normalizeUploadName,
  normalizeMaterialType,
  normalizeFileRole,
  cleanSourceTitle,
  materialTypeLabelForReason,
  fileRoleLabelForReason,
} from '../../utils/ocr-helpers.js'
import { configuredGradeStages } from '../settings/app-settings.js'
import { convertDocxToPdf, analyzeDocxFormulaTypes } from '../../utils/document-conversion.js'
import { findReusableSeparatedExamBatch, batchRuns, getRun, mapBatch } from '../../db/runs.js'
import { sofficePath } from '../settings/tools.js'
import { startSlicingRunInBackground } from './slicing.js'
import type { FileRole, MaterialType, BatchRow } from '../../types/index.js'

export function handlePdfSlicerUploads(
  files: Express.Multer.File[],
  body: Record<string, any>,
  options: {
    isWordUploadKind: (kind: string) => boolean
    classifyUploadedDocument: (input: { fileName: string; textSample?: string }) => { materialType: string; fileRole: string; confidence: number; reasons: string[] }
    extractPdfTextSample: (pdfPath: string) => string
    updateBatchWorkflow: (batchId: string) => void
  },
) {
  if (!files?.length) {
    throw new Error('请至少上传一个 PDF、DOC 或 DOCX 文件。')
  }
  const containsWordFile = files.some((file) => options.isWordUploadKind(path.extname(normalizeUploadName(file.originalname)).slice(1).toLowerCase()))
  if (containsWordFile && !sofficePath()) {
    throw new Error('未检测到 LibreOffice，无法上传 DOC/DOCX 文件。请先安装 LibreOffice，或在系统设置的外部工具中填写 soffice.exe 路径。')
  }
  const now = nowIso()
  const requestedMaterialType = normalizeMaterialType(body?.materialType ?? body?.material_type ?? 'unknown')
  const requestedFileRole = normalizeFileRole(body?.fileRole ?? body?.file_role ?? 'unknown')
  const requestedStage = String(body?.stage || configuredGradeStages()[0] || '高三').trim() || '高三'
  const requestedFileRoles = parseJson<FileRole[]>(String(body?.fileRolesJson || body?.file_roles_json || '[]'), [])
    .map((role) => normalizeFileRole(role))
  const runIds: string[] = []
  const requestedPaperTitle = cleanSourceTitle(String(body?.paperTitle || ''), '')
  const groupingFileRole = requestedFileRole !== 'unknown'
    ? requestedFileRole
    : requestedFileRoles.find((role) => role === 'questions' || role === 'solutions') ?? 'unknown'
  let batchId = findReusableSeparatedExamBatch(requestedPaperTitle, requestedMaterialType, groupingFileRole)
  if (batchId) {
    db.prepare('UPDATE pdf_slicer_batches SET uploaded_count = uploaded_count + ? WHERE id = ?').run(files.length, batchId)
  } else {
    batchId = createId('batch')
    db.prepare('INSERT INTO pdf_slicer_batches (id, title, material_type, workflow_mode, workflow_status, created_at, uploaded_count) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(batchId, requestedPaperTitle || batchId, requestedMaterialType, 'single', 'ready', now, files.length)
  }
  const insertRun = db.prepare(`
    INSERT INTO pdf_slicer_runs (
      run_id, batch_id, upload_mode, paper_title, pdf_name, pdf_path, source_file_name, source_file_kind, run_dir, document_diagnostics_json,
      material_type, file_role, stage, classification_confidence, classification_reasons_json,
      created_at, updated_at, slice_status, quick_review_status, total_questions, approved_questions, unreviewed_questions, ocr_status,
      rules_version, rules_hash, rules_fallback_used, rules_warnings_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'pending', 0, 0, 0, 'idle', 0, '', 0, '[]')
  `)
  for (const [fileIndex, file] of files.entries()) {
    const originalName = normalizeUploadName(file.originalname)
    const runId = createId('run', originalName)
    const runDir = path.join(runsRoot, runId)
    fs.mkdirSync(runDir, { recursive: true })
    const target = path.join(runDir, originalName)
    fs.writeFileSync(target, file.buffer)
    const sourceKind = path.extname(originalName).slice(1).toLowerCase() || 'pdf'
    let pdfPath = target
    let pdfName = originalName
    let uploadMode = 'single_pdf'
    let diagnostics: Record<string, unknown> = {}
    if (isWordUploadKind(sourceKind)) {
      diagnostics = sourceKind === 'docx' ? { docxFormulaAnalysis: analyzeDocxFormulaTypes(target) } : {}
      pdfPath = convertDocxToPdf(target, runDir)
      pdfName = path.basename(pdfPath)
      uploadMode = 'docx_to_pdf'
    } else if (sourceKind !== 'pdf') {
      throw new Error(`暂不支持的文件类型：.${sourceKind}`)
    }
    const paperTitle = requestedPaperTitle || cleanSourceTitle(originalName)
    const detectedClassification = options.classifyUploadedDocument({ fileName: originalName, textSample: options.extractPdfTextSample(pdfPath) })
    const fileRoleOverride = requestedFileRoles[fileIndex] ?? requestedFileRole
    const hasManualClassification = requestedMaterialType !== 'unknown' || fileRoleOverride !== 'unknown'
    const mt: MaterialType = requestedMaterialType !== 'unknown' ? requestedMaterialType : (detectedClassification.materialType as MaterialType)
    const fr: FileRole = fileRoleOverride !== 'unknown' ? fileRoleOverride : (detectedClassification.fileRole as FileRole)
    const classification = hasManualClassification ? {
      materialType: mt,
      fileRole: fr,
      confidence: 1,
      reasons: [`上传时手动指定为 ${materialTypeLabelForReason(mt)}/${fileRoleLabelForReason(fr)}`],
    } : detectedClassification
    insertRun.run(
      runId,
      batchId,
      uploadMode,
      paperTitle,
      pdfName,
      assetPathFor(pdfPath),
      originalName,
      sourceKind,
      assetPathFor(runDir),
      JSON.stringify(diagnostics),
      classification.materialType,
      classification.fileRole,
      requestedStage,
      classification.confidence,
      JSON.stringify(classification.reasons),
      now,
      now
    )
    runIds.push(runId)
    startSlicingRunInBackground(runId)
  }
  options.updateBatchWorkflow(batchId)
  const batch = db.prepare('SELECT * FROM pdf_slicer_batches WHERE id = ?').get(batchId) as BatchRow
  return { batchId, uploadedCount: files.length, runIds, batch: mapBatch(batch), runs: batchRuns(batchId) }
}

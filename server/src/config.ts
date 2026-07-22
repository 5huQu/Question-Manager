import { createRequire } from 'node:module'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const sourceRoot = path.resolve(__dirname, '../..')
export const storageRoot = path.resolve(process.env.QUESTION_DATA_DIR || sourceRoot)
export const dataDir = path.join(storageRoot, 'data')
export const runsRoot = path.join(storageRoot, 'experiments', 'pdf_slicer', 'runs')
export const sqlitePath = path.join(dataDir, 'question.sqlite')
export const tagLibrariesDir = path.join(sourceRoot, 'server', 'tag_libraries')
export const pythonRoot = path.join(sourceRoot, 'server', 'python')
export const pythonDataRoot = path.join(storageRoot, 'python')
export const frontendDist = path.join(sourceRoot, 'frontend', 'dist')
export const uploadLimits = {
  sourceDocumentBytes: boundedInteger(process.env.SOURCE_DOCUMENT_UPLOAD_MAX_BYTES, 100 * 1024 * 1024, 1 * 1024 * 1024, 500 * 1024 * 1024),
  candidateFigureBytes: boundedInteger(process.env.CANDIDATE_FIGURE_UPLOAD_MAX_BYTES, 20 * 1024 * 1024, 1 * 1024 * 1024, 100 * 1024 * 1024),
  doc2xPackageBytes: boundedInteger(process.env.DOC2X_PACKAGE_UPLOAD_MAX_BYTES, 200 * 1024 * 1024, 1 * 1024 * 1024, 500 * 1024 * 1024),
  maxFields: boundedInteger(process.env.UPLOAD_MAX_FIELDS, 32, 1, 100),
} as const

function memoryUpload(fileSize: number, files = 1) {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize,
      files,
      fields: uploadLimits.maxFields,
      parts: files + uploadLimits.maxFields,
    },
  })
}

export const sourceDocumentUpload = memoryUpload(uploadLimits.sourceDocumentBytes)
export const candidateFigureUpload = memoryUpload(uploadLimits.candidateFigureBytes)
export const doc2xPackageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: uploadLimits.doc2xPackageBytes,
    fields: uploadLimits.maxFields,
    parts: uploadLimits.maxFields + 1,
  },
})
function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}
export const layoutPreviewConcurrency = boundedInteger(process.env.LAYOUT_PREVIEW_CONCURRENCY, 1, 1, Math.max(1, os.availableParallelism()))
export const layoutPreviewPollMs = boundedInteger(process.env.LAYOUT_PREVIEW_POLL_MS, 750, 100, 10_000)
export const layoutPreviewLeaseMs = boundedInteger(process.env.LAYOUT_PREVIEW_LEASE_MS, 10 * 60_000, 60_000, 60 * 60_000)
export const layoutPreviewCacheMaxEntries = boundedInteger(process.env.LAYOUT_PREVIEW_CACHE_MAX_ENTRIES, 50, 1, 500)
const require = createRequire(import.meta.url)
export const katex = require('katex') as { renderToString: (tex: string, options?: Record<string, unknown>) => string }

fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(runsRoot, { recursive: true })
fs.mkdirSync(pythonDataRoot, { recursive: true })
fs.mkdirSync(tagLibrariesDir, { recursive: true })

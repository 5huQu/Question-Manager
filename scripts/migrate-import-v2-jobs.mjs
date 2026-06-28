import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const dataDir = path.join(root, 'data')
const sqlitePath = path.join(dataDir, 'question.sqlite')

function nowIso() {
  return new Date().toISOString()
}

function stampFrom(value, fallbackDate = new Date()) {
  const fromId = String(value || '').match(/_(\d{14})_/)
  if (fromId) return fromId[1]
  const date = fallbackDate instanceof Date && Number.isFinite(fallbackDate.getTime()) ? fallbackDate : new Date()
  return date.toISOString().replace(/\D/g, '').slice(0, 14)
}

function hash(value, length = 6) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length)
}

function uniqueId(base, used) {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base}_${String(index).padStart(2, '0')}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
  throw new Error(`Could not allocate unique id for ${base}`)
}

function jobTitle(source) {
  return source.paper_title || source.title || source.original_file_name || '资料导入'
}

function jobStatus(source) {
  return source.status === 'parsed' || source.status === 'partially_parsed' ? source.status : 'draft'
}

if (!fs.existsSync(sqlitePath)) {
  throw new Error(`SQLite database not found: ${sqlitePath}`)
}

const backupPath = `${sqlitePath}.bak-import-v2-job-migration-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`
fs.copyFileSync(sqlitePath, backupPath)

const db = new DatabaseSync(sqlitePath)
const existingJobIds = new Set(db.prepare('SELECT id FROM import_jobs').all().map((row) => row.id))
const existingJobDocIds = new Set(db.prepare('SELECT id FROM import_job_documents').all().map((row) => row.id))
const sources = db.prepare('SELECT * FROM source_documents ORDER BY created_at ASC').all()
const createdJobs = []
let updatedQuestionRows = 0

try {
  db.exec('BEGIN')
  const insertJob = db.prepare(`
    INSERT INTO import_jobs (
      id, title, mode, status, province, city, paper_title, batch_name, stage, subject, paper_kind, exam_year, source_org, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertJobDocument = db.prepare(`
    INSERT INTO import_job_documents (
      id, job_id, source_document_id, role, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const updateQuestions = db.prepare(`
    UPDATE question_bank_items
    SET import_source_id = ?, source_run_id = ?, updated_at = ?
    WHERE source_run_id = ?
       OR import_source_id IN (?, ?)
  `)

  for (const source of sources) {
    const existing = db.prepare(`
      SELECT j.id
      FROM import_jobs j
      JOIN import_job_documents d ON d.job_id = j.id
      WHERE d.source_document_id = ?
      ORDER BY j.updated_at DESC, j.created_at DESC
      LIMIT 1
    `).get(source.id)

    let jobId = existing?.id
    if (!jobId) {
      const createdAt = source.created_at || nowIso()
      jobId = uniqueId(`ifv2job_${stampFrom(source.id, new Date(createdAt))}_${hash(source.id)}`, existingJobIds)
      const jobDocumentId = uniqueId(`ifv2jobdoc_${stampFrom(source.id, new Date(createdAt))}_${hash(`${jobId}:${source.id}`)}`, existingJobDocIds)
      insertJob.run(
        jobId,
        jobTitle(source),
        'single_document',
        jobStatus(source),
        source.province || '',
        source.city || '',
        source.paper_title || jobTitle(source),
        source.batch_name || jobTitle(source),
        source.stage || '高三',
        source.subject || '数学',
        source.paper_kind || 'unknown',
        Number(source.exam_year || 0),
        source.source_org || '',
        createdAt,
        nowIso(),
      )
      insertJobDocument.run(jobDocumentId, jobId, source.id, 'full', 0, createdAt, nowIso())
      createdJobs.push({ jobId, sourceDocumentId: source.id })
    }

    const result = updateQuestions.run(jobId, '', nowIso(), `ifv2:${source.id}`, source.id, `ifv2-job:${jobId}`)
    updatedQuestionRows += Number(result.changes || 0)
  }

  db.exec('COMMIT')
} catch (error) {
  try {
    db.exec('ROLLBACK')
  } catch {}
  db.close()
  throw error
}

db.close()

console.log(JSON.stringify({
  backupPath,
  createdJobs,
  updatedQuestionRows,
}, null, 2))

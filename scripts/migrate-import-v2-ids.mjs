import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const dataDir = path.join(root, 'data')
const sqlitePath = path.join(dataDir, 'question.sqlite')
const sourceDocumentsRoot = path.join(dataDir, 'import-flow-v2', 'source-documents')
const idPattern = /^docimport_\d{14}_[0-9a-f]{6}$/

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

function replaceAll(value, replacements) {
  if (typeof value !== 'string' || !value) return value
  let next = value
  for (const [from, to] of replacements) {
    if (!from || from === to) continue
    next = next.split(from).join(to)
  }
  return next
}

function updateTextColumns(db, table, columns, replacements) {
  for (const column of columns) {
    const rows = db.prepare(`SELECT rowid, ${column} AS value FROM ${table} WHERE ${column} != ''`).all()
    const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`)
    for (const row of rows) {
      const next = replaceAll(row.value, replacements)
      if (next !== row.value) update.run(next, row.rowid)
    }
  }
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(fullPath))
    else if (entry.isFile()) files.push(fullPath)
  }
  return files
}

function replaceInTextFiles(dir, replacements) {
  const textExts = new Set(['.json', '.md', '.txt'])
  for (const file of walkFiles(dir)) {
    if (!textExts.has(path.extname(file))) continue
    const before = fs.readFileSync(file, 'utf8')
    const after = replaceAll(before, replacements)
    if (after !== before) fs.writeFileSync(file, after, 'utf8')
  }
}

if (!fs.existsSync(sqlitePath)) {
  throw new Error(`SQLite database not found: ${sqlitePath}`)
}

const backupPath = `${sqlitePath}.bak-import-v2-id-migration-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`
fs.copyFileSync(sqlitePath, backupPath)

const db = new DatabaseSync(sqlitePath)
const sourceRows = db.prepare('SELECT id, created_at FROM source_documents ORDER BY created_at ASC').all()
const existingSourceIds = new Set(sourceRows.map((row) => row.id).filter((id) => idPattern.test(id)))
const sourceMappings = []

for (const row of sourceRows) {
  if (idPattern.test(row.id)) continue
  const createdAt = new Date(row.created_at || '')
  const base = `docimport_${stampFrom(row.id, createdAt)}_${hash(row.id)}`
  sourceMappings.push({ oldId: row.id, newId: uniqueId(base, existingSourceIds) })
}

const ocrRows = db.prepare('SELECT id, created_at FROM ocr_documents ORDER BY created_at ASC').all()
const usedOcrIds = new Set(ocrRows.map((row) => row.id).filter((id) => /^ocrdoc_\d{14}_[0-9a-f]{6}$/.test(id)))
const ocrMappings = ocrRows
  .filter((row) => !/^ocrdoc_\d{14}_[0-9a-f]{6}$/.test(row.id))
  .map((row) => ({
    oldId: row.id,
    newId: uniqueId(`ocrdoc_${stampFrom(row.id, new Date(row.created_at || ''))}_${hash(row.id)}`, usedOcrIds),
  }))

const candidateRows = db.prepare('SELECT id, created_at FROM question_candidates ORDER BY created_at ASC').all()
const usedCandidateIds = new Set(candidateRows.map((row) => row.id).filter((id) => /^candidate_\d{14}_[0-9a-f]{6}$/.test(id)))
const candidateSourceRows = candidateRows.map((row) => ({ id: row.id, created_at: row.created_at }))
const sessionCandidateRows = db.prepare(`
  SELECT id, batch_id, created_at
  FROM pdf_slicer_annotation_sessions
  WHERE id LIKE 'sess_candidate_candidate_%' OR batch_id LIKE 'candidate_%'
`).all()
for (const row of sessionCandidateRows) {
  const ids = [
    String(row.batch_id || ''),
    String(row.id || '').startsWith('sess_candidate_') ? String(row.id).slice('sess_candidate_'.length) : '',
  ].filter(Boolean)
  for (const id of ids) {
    if (/^candidate_\d{14}_[0-9a-f]{6}$/.test(id)) continue
    if (!id.startsWith('candidate_')) continue
    if (candidateSourceRows.some((item) => item.id === id)) continue
    candidateSourceRows.push({ id, created_at: row.created_at })
  }
}
const candidateMappings = candidateSourceRows
  .filter((row) => !/^candidate_\d{14}_[0-9a-f]{6}$/.test(row.id))
  .map((row) => ({
    oldId: row.id,
    newId: uniqueId(`candidate_${stampFrom(row.id, new Date(row.created_at || ''))}_${hash(row.id)}`, usedCandidateIds),
  }))

const replacements = [
  ...sourceMappings.flatMap(({ oldId, newId }) => [
    [`ifv2:${oldId}`, `ifv2:${newId}`],
    [oldId, newId],
  ]),
  ...ocrMappings.map(({ oldId, newId }) => [oldId, newId]),
  ...candidateMappings.flatMap(({ oldId, newId }) => [
    [`sess_candidate_${oldId}`, `sess_candidate_${newId}`],
    [oldId, newId],
  ]),
]

try {
  db.exec('PRAGMA foreign_keys = OFF')
  db.exec('BEGIN')

  for (const { oldId, newId } of sourceMappings) {
    db.prepare('UPDATE source_documents SET id = ? WHERE id = ?').run(newId, oldId)
    db.prepare('UPDATE ocr_documents SET source_document_id = ? WHERE source_document_id = ?').run(newId, oldId)
    db.prepare('UPDATE question_candidates SET source_document_id = ? WHERE source_document_id = ?').run(newId, oldId)
    db.prepare('UPDATE question_bank_items SET source_run_id = ? WHERE source_run_id = ?').run(`ifv2:${newId}`, `ifv2:${oldId}`)
    db.prepare('UPDATE pdf_slicer_annotation_regions SET source_run_id = ? WHERE source_run_id = ?').run(newId, oldId)
  }

  for (const { oldId, newId } of ocrMappings) {
    db.prepare('UPDATE ocr_documents SET id = ? WHERE id = ?').run(newId, oldId)
    db.prepare('UPDATE question_candidates SET ocr_document_id = ? WHERE ocr_document_id = ?').run(newId, oldId)
  }

  for (const { oldId, newId } of candidateMappings) {
    db.prepare('UPDATE question_candidates SET id = ? WHERE id = ?').run(newId, oldId)
    db.prepare('UPDATE pdf_slicer_annotation_sessions SET batch_id = ? WHERE batch_id = ?').run(newId, oldId)
    db.prepare('UPDATE pdf_slicer_annotation_sessions SET id = ? WHERE id = ?').run(`sess_candidate_${newId}`, `sess_candidate_${oldId}`)
    db.prepare('UPDATE pdf_slicer_annotation_regions SET session_id = ? WHERE session_id = ?').run(`sess_candidate_${newId}`, `sess_candidate_${oldId}`)
  }

  updateTextColumns(db, 'source_documents', ['file_path'], replacements)
  updateTextColumns(db, 'ocr_documents', ['raw_result_path', 'markdown_path', 'blocks_json_path', 'assets_json_path', 'metadata_json'], replacements)
  updateTextColumns(db, 'question_candidates', ['figures_json', 'source_refs_json', 'issues_json'], replacements)
  updateTextColumns(db, 'question_bank_items', ['slice_image_path', 'figures_json'], replacements)
  updateTextColumns(db, 'pdf_slicer_annotation_sessions', ['source_profile_json'], replacements)

  db.exec('COMMIT')
  db.exec('PRAGMA foreign_keys = ON')
  const fkIssues = db.prepare('PRAGMA foreign_key_check').all()
  if (fkIssues.length) {
    throw new Error(`Foreign key check failed: ${JSON.stringify(fkIssues)}`)
  }
} catch (error) {
  try {
    db.exec('ROLLBACK')
  } catch {}
  db.close()
  throw error
}

db.close()

for (const { oldId, newId } of sourceMappings) {
  const oldDir = path.join(sourceDocumentsRoot, oldId)
  const newDir = path.join(sourceDocumentsRoot, newId)
  if (fs.existsSync(oldDir)) {
    if (fs.existsSync(newDir)) {
      throw new Error(`Target directory already exists: ${newDir}`)
    }
    fs.renameSync(oldDir, newDir)
    replaceInTextFiles(newDir, replacements)
  }
}

console.log(JSON.stringify({
  backupPath,
  sourceDocuments: sourceMappings,
  ocrDocuments: ocrMappings.length,
  candidates: candidateMappings.length,
}, null, 2))

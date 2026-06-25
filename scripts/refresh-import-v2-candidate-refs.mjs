import fs from 'node:fs'
import path from 'node:path'
import { db, closeDatabase } from '../server/dist/db/connection.js'
import { listOcrDocuments } from '../server/dist/repositories/ocr-documents.repo.js'
import {
  listQuestionCandidates,
  updateQuestionCandidate,
} from '../server/dist/repositories/question-candidates.repo.js'
import { parseQuestionCandidates } from '../server/dist/services/question-parser/question-candidate.parser.js'
import {
  loadOcrDocument,
} from '../server/dist/services/import-flow-v2/import-flow-v2.service.js'

const sqlitePath = path.resolve('data/question.sqlite')
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
const backupPath = `${sqlitePath}.bak-refresh-import-v2-refs-${stamp}`

function keyForCandidate(candidate, index) {
  return `${String(candidate.questionNo || '').trim()}#${index}`
}

function groupByQuestionNo(candidates) {
  const counts = new Map()
  const result = new Map()
  for (const candidate of candidates) {
    const questionNo = String(candidate.questionNo || '').trim()
    const nextIndex = counts.get(questionNo) || 0
    counts.set(questionNo, nextIndex + 1)
    result.set(keyForCandidate(candidate, nextIndex), candidate)
  }
  return result
}

function deleteDraftManualFixSession(candidateId) {
  const sessions = db.prepare(`
    SELECT id FROM pdf_slicer_annotation_sessions
    WHERE batch_id = ? AND status = 'draft'
  `).all(candidateId)
  for (const session of sessions) {
    db.prepare('DELETE FROM pdf_slicer_annotation_regions WHERE session_id = ?').run(session.id)
    db.prepare('DELETE FROM pdf_slicer_annotation_sessions WHERE id = ?').run(session.id)
  }
  return sessions.length
}

try {
  if (fs.existsSync(sqlitePath)) {
    fs.copyFileSync(sqlitePath, backupPath)
    console.log(`Backup created: ${backupPath}`)
  }

  const sourceRows = db.prepare(`
    SELECT id FROM source_documents
    WHERE id LIKE 'docimport_%'
    ORDER BY created_at ASC
  `).all()

  let updated = 0
  let skipped = 0
  let deletedDraftSessions = 0

  for (const source of sourceRows) {
    const [ocrDocument] = listOcrDocuments({ sourceDocumentId: source.id, limit: 1 })
    if (!ocrDocument) {
      skipped += 1
      console.warn(`Skip ${source.id}: no OCR document`)
      continue
    }

    const document = loadOcrDocument(ocrDocument.id)
    const parsedCandidates = parseQuestionCandidates(document)
    const existingCandidates = listQuestionCandidates({ sourceDocumentId: source.id, limit: 1000 })
    const existingByNo = groupByQuestionNo(existingCandidates)

    const parsedCounts = new Map()
    for (const parsed of parsedCandidates) {
      const questionNo = String(parsed.questionNo || '').trim()
      const index = parsedCounts.get(questionNo) || 0
      parsedCounts.set(questionNo, index + 1)

      const existing = existingByNo.get(keyForCandidate(parsed, index))
      if (!existing) {
        skipped += 1
        console.warn(`Skip ${source.id} question ${questionNo || '(empty)'}: existing candidate not found`)
        continue
      }

      const keepCommitted = existing.status === 'committed' || Boolean(existing.committedQuestionId)
      updateQuestionCandidate(existing.id, {
        ocrDocumentId: parsed.ocrDocumentId,
        questionNo: parsed.questionNo,
        stemMarkdown: parsed.stemMarkdown,
        answerText: parsed.answerText,
        analysisMarkdown: parsed.analysisMarkdown,
        questionType: parsed.questionType,
        figures: parsed.figures,
        sourceRefs: parsed.sourceRefs,
        status: keepCommitted ? existing.status : parsed.status,
        issues: keepCommitted ? existing.issues : parsed.issues,
      })
      deletedDraftSessions += deleteDraftManualFixSession(existing.id)
      updated += 1
    }

    console.log(`Refreshed ${source.id}: ${parsedCandidates.length} parsed, ${existingCandidates.length} existing`)
  }

  const invalidRefs = db.prepare(`
    SELECT COUNT(*) AS count
    FROM question_candidates
    WHERE source_document_id LIKE 'docimport_%'
      AND source_refs_json LIKE '%注意事项%'
  `).get()
  console.log(`Updated candidates: ${updated}`)
  console.log(`Skipped candidates/docs: ${skipped}`)
  console.log(`Deleted draft manual-fix sessions: ${deletedDraftSessions}`)
  console.log(`Source refs containing 注意事项 text: ${invalidRefs?.count || 0}`)
} finally {
  closeDatabase()
}

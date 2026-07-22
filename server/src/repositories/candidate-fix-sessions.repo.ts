import { db } from '../db/connection.js'
import type { CandidateFixRegion, CandidateFixRegionInput, CandidateFixSession, CandidateFixSessionStatus } from '../types/candidate-fix.js'
import { parseJson } from '../utils/json.js'
import { createId, nowIso } from '../utils/ids.js'

type SessionRow = {
  id: string; candidate_id: string; revision: number; status: CandidateFixSessionStatus
  source_profiles_json: string; base_content_revision: number; created_at: string; updated_at: string; finalized_at: string
}

type RegionRow = {
  id: string; session_id: string; source_document_id: string; kind: CandidateFixRegion['kind']
  question_key: string; question_label: string; question_keys_json: string; segments_json: string
  sort_order: number; note: string; created_at: string; updated_at: string
}

function mapRegion(row: RegionRow): CandidateFixRegion {
  return {
    id: row.id, sessionId: row.session_id, sourceDocumentId: row.source_document_id, kind: row.kind,
    questionKey: row.question_key, questionLabel: row.question_label,
    questionKeys: parseJson(row.question_keys_json, []), segments: parseJson(row.segments_json, []),
    sortOrder: row.sort_order, note: row.note, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export function listRegions(sessionId: string) {
  return (db.prepare(`SELECT * FROM candidate_fix_regions WHERE session_id = ? ORDER BY sort_order, created_at`).all(sessionId) as RegionRow[]).map(mapRegion)
}

function mapSession(row: SessionRow): CandidateFixSession {
  return {
    id: row.id, candidateId: row.candidate_id, revision: row.revision, status: row.status,
    sourceProfiles: parseJson(row.source_profiles_json, {}), baseContentRevision: row.base_content_revision,
    createdAt: row.created_at, updatedAt: row.updated_at, finalizedAt: row.finalized_at,
    regions: listRegions(row.id),
  }
}

export function getSession(id: string) {
  const row = db.prepare('SELECT * FROM candidate_fix_sessions WHERE id = ?').get(id) as SessionRow | undefined
  return row ? mapSession(row) : null
}

export function getDraftForCandidate(candidateId: string) {
  const row = db.prepare(`SELECT * FROM candidate_fix_sessions WHERE candidate_id = ? AND status = 'draft' ORDER BY updated_at DESC LIMIT 1`).get(candidateId) as SessionRow | undefined
  return row ? mapSession(row) : null
}

export function getLatestForCandidate(candidateId: string) {
  const row = db.prepare('SELECT * FROM candidate_fix_sessions WHERE candidate_id = ? ORDER BY updated_at DESC LIMIT 1').get(candidateId) as SessionRow | undefined
  return row ? mapSession(row) : null
}

export function createSession(input: { id?: string; candidateId: string; sourceProfiles: CandidateFixSession['sourceProfiles']; baseContentRevision: number }) {
  const now = nowIso()
  const id = input.id || createId('fixsess')
  db.prepare(`INSERT INTO candidate_fix_sessions
    (id, candidate_id, revision, status, source_profiles_json, base_content_revision, created_at, updated_at, finalized_at)
    VALUES (?, ?, 1, 'draft', ?, ?, ?, ?, '')`)
    .run(id, input.candidateId, JSON.stringify(input.sourceProfiles), input.baseContentRevision, now, now)
  return getSession(id)!
}

export function updateProfiles(id: string, sourceProfiles: CandidateFixSession['sourceProfiles']) {
  db.prepare('UPDATE candidate_fix_sessions SET source_profiles_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(sourceProfiles), nowIso(), id)
  return getSession(id)
}

export function reopenSession(id: string, baseContentRevision: number) {
  const now = nowIso()
  db.prepare(`UPDATE candidate_fix_sessions SET status = 'draft', revision = revision + 1,
    base_content_revision = ?, finalized_at = '', updated_at = ? WHERE id = ? AND status = 'finalized'`)
    .run(baseContentRevision, now, id)
  return getSession(id)
}

export function replaceRegions(id: string, regions: CandidateFixRegionInput[], expectedRevision: number) {
  const now = nowIso()
  const result = db.prepare(`UPDATE candidate_fix_sessions SET revision = revision + 1, updated_at = ?
    WHERE id = ? AND status = 'draft' AND revision = ?`).run(now, id, expectedRevision)
  if (!result.changes) return null
  db.prepare('DELETE FROM candidate_fix_regions WHERE session_id = ?').run(id)
  const insert = db.prepare(`INSERT INTO candidate_fix_regions
    (id, session_id, source_document_id, kind, question_key, question_label, question_keys_json, segments_json, sort_order, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  regions.forEach((region, index) => insert.run(
    region.id || createId('reg'), id, region.sourceDocumentId, region.kind,
    region.kind === 'shared_answer_key' ? '' : region.questionLabel.trim(), region.questionLabel,
    JSON.stringify(region.questionKeys || []), JSON.stringify(region.segments || []), region.sortOrder ?? index,
    region.note || '', now, now,
  ))
  return getSession(id)
}

export function finalizeSession(id: string, regionFigureIds: Map<string, string>) {
  const now = nowIso()
  const updateRegion = db.prepare('UPDATE candidate_fix_regions SET question_keys_json = ?, updated_at = ? WHERE id = ? AND session_id = ?')
  for (const [regionId, figureId] of regionFigureIds) updateRegion.run(JSON.stringify([figureId]), now, regionId, id)
  db.prepare(`UPDATE candidate_fix_sessions SET status = 'finalized', finalized_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'`).run(now, now, id)
  return getSession(id)
}

export function deleteForCandidate(candidateId: string) {
  db.prepare('DELETE FROM candidate_fix_sessions WHERE candidate_id = ?').run(candidateId)
}

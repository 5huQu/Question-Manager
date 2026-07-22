import fs from 'node:fs'
import path from 'node:path'
import { db } from '../../db/connection.js'
import { isInside } from '../../utils/paths.js'
import { importDataDir } from './import-flow-v2.paths.js'

export function cleanupImportJobTrash(options: { retentionDays?: number; now?: Date; limit?: number } = {}) {
  const retentionDays = Math.max(1, Math.floor(Number(options.retentionDays || 30)))
  const limit = Math.max(1, Math.min(500, Math.floor(Number(options.limit || 100))))
  const cutoff = new Date((options.now || new Date()).getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
  const trashRoot = path.join(importDataDir(), 'trash', 'import-jobs')
  const rows = db.prepare(`
    SELECT job_id FROM import_job_deletion_manifests
    WHERE status = 'trashed' AND updated_at <= ?
    ORDER BY updated_at ASC
    LIMIT ?
  `).all(cutoff, limit) as Array<{ job_id: string }>
  const removed: string[] = []
  const failed: Array<{ jobId: string; error: string }> = []
  for (const row of rows) {
    const target = path.join(trashRoot, row.job_id)
    if (!isInside(trashRoot, target) || target === trashRoot) {
      failed.push({ jobId: row.job_id, error: 'Resolved trash path is outside the import-job trash root' })
      continue
    }
    try {
      fs.rmSync(target, { recursive: true, force: true })
      db.prepare('DELETE FROM import_job_deletion_manifests WHERE job_id = ? AND status = ?').run(row.job_id, 'trashed')
      removed.push(row.job_id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      db.prepare(`UPDATE import_job_deletion_manifests SET error = ?, updated_at = ? WHERE job_id = ?`)
        .run(`trash cleanup failed: ${message}`, new Date().toISOString(), row.job_id)
      failed.push({ jobId: row.job_id, error: message })
    }
  }
  return { retentionDays, cutoff, removed, failed }
}

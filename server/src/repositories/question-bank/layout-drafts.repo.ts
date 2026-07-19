import { db } from '../../db/connection.js'

export type LayoutDraftRow = Record<string, any>
export type LayoutPreviewJobRow = Record<string, any>
export type LayoutPreviewCacheRow = Record<string, any>
export function insertLayoutDraft(values: any[]) { db.prepare(`INSERT INTO question_bank_layout_drafts (id,collection_id,name,template_id,template_version,variant,content_snapshot_json,layout_json,layout_version,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(...values) }
export function getLayoutDraft(id: string) { return db.prepare('SELECT * FROM question_bank_layout_drafts WHERE id = ?').get(id) as LayoutDraftRow | undefined }
export function listLayoutDrafts(collectionId: string) { return db.prepare('SELECT * FROM question_bank_layout_drafts WHERE collection_id=? ORDER BY updated_at DESC').all(collectionId) as LayoutDraftRow[] }
export function searchLayoutDrafts(options:{query:string;collectionId:string;status:string;limit:number;offset:number}) {
  const where:string[]=[]; const values:any[]=[]
  if(options.query){where.push('(d.name LIKE ? OR c.title LIKE ?)');values.push(`%${options.query}%`,`%${options.query}%`)}
  if(options.collectionId){where.push('d.collection_id=?');values.push(options.collectionId)}
  if(options.status){where.push('d.preview_status=?');values.push(options.status)}
  const clause=where.length?`WHERE ${where.join(' AND ')}`:''
  const total=Number((db.prepare(`SELECT COUNT(*) count FROM question_bank_layout_drafts d JOIN question_bank_collections c ON c.id=d.collection_id ${clause}`).get(...values) as any).count||0)
  const items=db.prepare(`SELECT d.*,c.title collection_title FROM question_bank_layout_drafts d JOIN question_bank_collections c ON c.id=d.collection_id ${clause} ORDER BY d.updated_at DESC LIMIT ? OFFSET ?`).all(...values,options.limit,options.offset) as LayoutDraftRow[]
  return {items,total}
}
export function updateLayoutDraft(id: string, revision: number, values: any[]) { return db.prepare(`UPDATE question_bank_layout_drafts SET name=?, template_id=?, variant=?, layout_json=?, layout_version=?, content_overrides_json=?, revision=revision+1, preview_status='idle', preview_error='', updated_at=? WHERE id=? AND revision=?`).run(...values, id, revision) }
export function refreshLayoutDraftContentSnapshot(id: string, revision: number, snapshot: string, overrides: string, updatedAt: string) {
  return db.prepare(`UPDATE question_bank_layout_drafts SET content_snapshot_json=?, content_overrides_json=?, revision=revision+1, preview_status='idle', preview_error='', updated_at=? WHERE id=? AND revision=?`).run(snapshot, overrides, updatedAt, id, revision)
}
export function getQuestionBankItemRow(id:string){return db.prepare('SELECT * FROM question_bank_items WHERE id=?').get(id) as Record<string,any>|undefined}
export function syncContentOverrideToBank(input:{draftId:string;revision:number;questionId:string;expectedContentRevision:number;stemMarkdown:string;answerText:string;analysisMarkdown:string;searchText:string;formatReviewRequired:number;formatReviewJson:string;bankStatus:string;contentSnapshotJson:string;contentOverridesJson:string;updatedAt:string}){
  try{
    db.exec('BEGIN IMMEDIATE')
    const question=db.prepare(`UPDATE question_bank_items SET stem_markdown=?,answer_text=?,analysis_markdown=?,search_text=?,format_review_required=?,format_review_reasons_json=?,bank_status=?,content_revision=content_revision+1,updated_at=? WHERE id=? AND content_revision=?`).run(input.stemMarkdown,input.answerText,input.analysisMarkdown,input.searchText,input.formatReviewRequired,input.formatReviewJson,input.bankStatus,input.updatedAt,input.questionId,input.expectedContentRevision)
    if(!question.changes){db.exec('ROLLBACK');return {questionChanges:0,draftChanges:0}}
    const draft=db.prepare(`UPDATE question_bank_layout_drafts SET content_snapshot_json=?,content_overrides_json=?,revision=revision+1,preview_status='idle',preview_error='',updated_at=? WHERE id=? AND revision=?`).run(input.contentSnapshotJson,input.contentOverridesJson,input.updatedAt,input.draftId,input.revision)
    if(!draft.changes)throw new Error('layout_revision_conflict')
    db.exec('COMMIT')
    return {questionChanges:question.changes,draftChanges:draft.changes}
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error}
}
export function deleteLayoutDraft(id: string) { return db.prepare('DELETE FROM question_bank_layout_drafts WHERE id=?').run(id) }
export function setPreviewState(id: string, revision: number, status: string, path: string, pages: string[], warnings: unknown[], error: string, questionPages: unknown = {}) { return db.prepare('UPDATE question_bank_layout_drafts SET preview_revision=?,preview_status=?,preview_path=?,preview_pages_json=?,preview_question_pages_json=?,preview_warnings_json=?,preview_error=?,updated_at=? WHERE id=? AND revision=?').run(revision,status,path,JSON.stringify(pages),JSON.stringify(questionPages),JSON.stringify(warnings),error,new Date().toISOString(),id,revision) }
export function setPreviewProgress(id: string, revision: number, status: 'queued'|'rendering'|'failed', error = '') { return db.prepare('UPDATE question_bank_layout_drafts SET preview_revision=?,preview_status=?,preview_error=?,updated_at=? WHERE id=? AND revision=?').run(revision,status,error,new Date().toISOString(),id,revision) }
export function setPreviewFailure(id:string,revision:number,error:string,warnings:unknown[]=[]){
  if(warnings.length)return db.prepare("UPDATE question_bank_layout_drafts SET preview_revision=?,preview_status='failed',preview_warnings_json=?,preview_error=?,updated_at=? WHERE id=? AND revision=?").run(revision,JSON.stringify(warnings),error,new Date().toISOString(),id,revision)
  return setPreviewProgress(id,revision,'failed',error)
}
export function markInterruptedPreviewsFailed() { return db.prepare("UPDATE question_bank_layout_drafts SET preview_status='failed', preview_error='应用上次退出时预览仍在编译，请重新生成。', updated_at=? WHERE preview_status IN ('queued','rendering')").run(new Date().toISOString()) }

export function enqueuePreviewJob(input:{id:string;draftId:string;revision:number;inputHash:string;now:string}) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare("UPDATE layout_preview_jobs SET status='cancelled', lease_owner='', lease_expires_at='', completed_at=?, updated_at=? WHERE draft_id=? AND revision<>? AND status IN ('queued','rendering')").run(input.now,input.now,input.draftId,input.revision)
    db.prepare(`INSERT INTO layout_preview_jobs (id,draft_id,revision,input_hash,status,created_at,updated_at)
      VALUES (?,?,?,?,'queued',?,?)
      ON CONFLICT(draft_id,revision) DO UPDATE SET input_hash=excluded.input_hash,status='queued',lease_owner='',lease_expires_at='',error='',completed_at='',updated_at=excluded.updated_at`).run(input.id,input.draftId,input.revision,input.inputHash,input.now,input.now)
    db.exec('COMMIT')
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  }
}

export function cancelPreviewJobsForDraft(draftId:string, keepRevision?:number) {
  const now=new Date().toISOString()
  const clause=keepRevision===undefined?'':` AND revision<>?`
  const values=keepRevision===undefined?[now,now,draftId]:[now,now,draftId,keepRevision]
  return db.prepare(`UPDATE layout_preview_jobs SET status='cancelled',lease_owner='',lease_expires_at='',completed_at=?,updated_at=? WHERE draft_id=? AND status IN ('queued','rendering')${clause}`).run(...values)
}

export function claimNextPreviewJob(owner:string,leaseExpiresAt:string,globalConcurrency:number) {
  const now=new Date().toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare("UPDATE layout_preview_jobs SET status='queued',lease_owner='',lease_expires_at='',updated_at=? WHERE status='rendering' AND lease_expires_at<>'' AND lease_expires_at<?").run(now,now)
    db.prepare("UPDATE layout_preview_jobs SET status='cancelled',lease_owner='',lease_expires_at='',completed_at=?,updated_at=? WHERE status IN ('queued','rendering') AND NOT EXISTS (SELECT 1 FROM question_bank_layout_drafts d WHERE d.id=layout_preview_jobs.draft_id AND d.revision=layout_preview_jobs.revision)").run(now,now)
    const running=Number((db.prepare("SELECT COUNT(*) count FROM layout_preview_jobs WHERE status='rendering' AND lease_expires_at>=?").get(now) as any)?.count||0)
    if(running>=globalConcurrency){db.exec('COMMIT');return undefined}
    const row=db.prepare("SELECT * FROM layout_preview_jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1").get() as LayoutPreviewJobRow|undefined
    if(!row){db.exec('COMMIT');return undefined}
    const result=db.prepare("UPDATE layout_preview_jobs SET status='rendering',attempts=attempts+1,lease_owner=?,lease_expires_at=?,started_at=CASE WHEN started_at='' THEN ? ELSE started_at END,updated_at=? WHERE id=? AND status='queued'").run(owner,leaseExpiresAt,now,now,row.id)
    db.exec('COMMIT')
    return result.changes?getPreviewJob(String(row.id)):undefined
  } catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error}
}

export function getPreviewJob(id:string){return db.prepare('SELECT * FROM layout_preview_jobs WHERE id=?').get(id) as LayoutPreviewJobRow|undefined}
export function listActivePreviewJobs(){return db.prepare("SELECT * FROM layout_preview_jobs WHERE status IN ('queued','rendering') ORDER BY created_at").all() as LayoutPreviewJobRow[]}
export function renewPreviewJobLease(id:string,owner:string,leaseExpiresAt:string){return db.prepare("UPDATE layout_preview_jobs SET lease_expires_at=?,updated_at=? WHERE id=? AND status='rendering' AND lease_owner=?").run(leaseExpiresAt,new Date().toISOString(),id,owner)}
export function finishPreviewJob(id:string,owner:string,status:'completed'|'failed'|'cancelled',error=''){
  const now=new Date().toISOString()
  return db.prepare("UPDATE layout_preview_jobs SET status=?,error=?,lease_owner='',lease_expires_at='',completed_at=?,updated_at=? WHERE id=? AND lease_owner=? AND status='rendering'").run(status,error,now,now,id,owner)
}
export function previewJobIsCurrent(id:string,owner:string){return Boolean(db.prepare("SELECT 1 ok FROM layout_preview_jobs j JOIN question_bank_layout_drafts d ON d.id=j.draft_id AND d.revision=j.revision WHERE j.id=? AND j.status='rendering' AND j.lease_owner=?").get(id,owner))}

export function getPreviewCache(inputHash:string){return db.prepare('SELECT * FROM layout_preview_cache WHERE input_hash=?').get(inputHash) as LayoutPreviewCacheRow|undefined}
export function touchPreviewCache(inputHash:string){return db.prepare('UPDATE layout_preview_cache SET last_used_at=? WHERE input_hash=?').run(new Date().toISOString(),inputHash)}
export function upsertPreviewCache(input:{inputHash:string;rendererVersion:string;artifactPath:string;metadataJson:string}){
  const now=new Date().toISOString()
  return db.prepare(`INSERT INTO layout_preview_cache (input_hash,renderer_version,artifact_path,metadata_json,created_at,last_used_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(input_hash) DO UPDATE SET renderer_version=excluded.renderer_version,artifact_path=excluded.artifact_path,metadata_json=excluded.metadata_json,last_used_at=excluded.last_used_at`).run(input.inputHash,input.rendererVersion,input.artifactPath,input.metadataJson,now,now)
}
export function prunePreviewCache(keep:number){return db.prepare('SELECT * FROM layout_preview_cache ORDER BY last_used_at DESC LIMIT -1 OFFSET ?').all(keep) as LayoutPreviewCacheRow[]}
export function deletePreviewCache(inputHash:string){return db.prepare('DELETE FROM layout_preview_cache WHERE input_hash=?').run(inputHash)}
export function failOrphanedPreviewStates(){
  const now=new Date().toISOString()
  return db.prepare("UPDATE question_bank_layout_drafts SET preview_status='failed',preview_error='预览任务不存在或已中断，请重新生成。',updated_at=? WHERE preview_status IN ('queued','rendering') AND NOT EXISTS (SELECT 1 FROM layout_preview_jobs j WHERE j.draft_id=question_bank_layout_drafts.id AND j.revision=question_bank_layout_drafts.preview_revision AND j.status IN ('queued','rendering'))").run(now)
}

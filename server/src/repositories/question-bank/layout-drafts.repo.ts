import { db } from '../../db/connection.js'

export type LayoutDraftRow = Record<string, any>
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
export function updateLayoutDraft(id: string, revision: number, values: any[]) { return db.prepare(`UPDATE question_bank_layout_drafts SET name=?, template_id=?, variant=?, layout_json=?, layout_version=?, revision=revision+1, preview_status='idle', preview_path='', preview_pages_json='[]', preview_warnings_json='[]', preview_error='', updated_at=? WHERE id=? AND revision=?`).run(...values, id, revision) }
export function refreshLayoutDraftContentSnapshot(id: string, revision: number, snapshot: string, updatedAt: string) {
  return db.prepare(`UPDATE question_bank_layout_drafts SET content_snapshot_json=?, revision=revision+1, preview_status='idle', preview_path='', preview_pages_json='[]', preview_warnings_json='[]', preview_error='', updated_at=? WHERE id=? AND revision=?`).run(snapshot, updatedAt, id, revision)
}
export function deleteLayoutDraft(id: string) { return db.prepare('DELETE FROM question_bank_layout_drafts WHERE id=?').run(id) }
export function setPreviewState(id: string, revision: number, status: string, path: string, pages: string[], warnings: unknown[], error: string, questionPages: unknown = {}) { return db.prepare('UPDATE question_bank_layout_drafts SET preview_revision=?,preview_status=?,preview_path=?,preview_pages_json=?,preview_question_pages_json=?,preview_warnings_json=?,preview_error=?,updated_at=? WHERE id=? AND revision=?').run(revision,status,path,JSON.stringify(pages),JSON.stringify(questionPages),JSON.stringify(warnings),error,new Date().toISOString(),id,revision) }
export function markInterruptedPreviewsFailed() { return db.prepare("UPDATE question_bank_layout_drafts SET preview_status='failed', preview_error='应用上次退出时预览仍在编译，请重新生成。', updated_at=? WHERE preview_status IN ('queued','rendering')").run(new Date().toISOString()) }

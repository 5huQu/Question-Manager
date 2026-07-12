import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dataDir } from '../../config.js'
import { createId, nowIso, safeName } from '../../utils/ids.js'
import { assetPathFor } from '../../utils/paths.js'
import { resolveStoragePath } from '../../utils/paths.js'
import { RouteError } from '../../utils/http-error.js'
import * as repo from '../../repositories/question-bank/layout-drafts.repo.js'
import { getCollection } from './collections.service.js'
import { normalizePaperLayoutDraft, paperLayoutDraftVersion } from './paper-layout.js'
import { exportCollectionWorksheetPdfWithDiagnostics } from './export.js'
import { exportCollection } from './export.service.js'
import { templateRenderSpec, templateRenderSpecVersion } from './template-render-spec.js'
import { pythonCommand, pythonEnv } from '../settings/python.js'

function parseJson(value: unknown, fallback: any) { try { return JSON.parse(String(value || '')) } catch { return fallback } }
const contentSnapshotVersion = 1
const previewQueue: Array<{ id: string; revision: number }> = []
let previewWorkerRunning = false

function snapshotAssets(collection: any, draftId: string) {
  const snapshot = JSON.parse(JSON.stringify(collection))
  snapshot.snapshotVersion = contentSnapshotVersion
  snapshot.questions?.forEach((entry: any) => entry.item?.figures?.forEach((figure: any, index: number) => {
    const source = resolveStoragePath(String(figure.path || figure.sourcePath || ''))
    if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile()) return
    const extension = path.extname(source).toLowerCase() || '.png'
    const target = path.join(dataDir, 'layout-drafts', safeName(draftId), 'assets', `${safeName(String(figure.id || figure.blockId || `figure-${index + 1}`))}${extension}`)
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target)
    figure.path = assetPathFor(target); if (figure.sourcePath) figure.sourcePath = figure.path
  }))
  return snapshot
}

/** Compare content while ignoring private copies of otherwise identical image files. */
function contentFingerprint(value: any): string {
  if (Array.isArray(value)) return `[${value.map(contentFingerprint).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.keys(value).sort().filter((key) => !['snapshotVersion', 'path', 'sourcePath'].includes(key)).map((key) => `${JSON.stringify(key)}:${contentFingerprint(value[key])}`).join(',')}}`
}

function assertSnapshotSupported(snapshot: any) {
  const version = Number(snapshot?.snapshotVersion || 1)
  if (version !== contentSnapshotVersion) throw new RouteError(409, `草稿内容快照版本 ${version} 暂不支持，请使用兼容版本升级后重试。`)
}
function publicDraft(row: repo.LayoutDraftRow) {
  const pages=parseJson(row.preview_pages_json, []).map((p: string) => `/assets/${p}`)
  const previewDir=path.join(dataDir,'layout-previews',safeName(row.id),`r${row.preview_revision}`)
  const variantPreview=(variant:'student'|'teacher')=>{const pdf=path.join(previewDir,`${variant}.pdf`);const variantPages=fs.existsSync(previewDir)?fs.readdirSync(previewDir).filter((name)=>new RegExp(`^${variant}-page-\\d+\\.png$`).test(name)).sort((a,b)=>Number(a.match(/\d+/)?.[0]||0)-Number(b.match(/\d+/)?.[0]||0)).map((name)=>`/assets/${assetPathFor(path.join(previewDir,name))}`):[];return {pdfUrl:fs.existsSync(pdf)?`/assets/${assetPathFor(pdf)}`:'',pages:variantPages,pageImages:variantPages,pageCount:variantPages.length}}
  return { id: row.id, collectionId: row.collection_id, name: row.name, template: row.template_id, templateId: row.template_id, templateVersion: row.template_version, templateSpec:templateRenderSpec(row.template_id), templateSpecVersion:templateRenderSpecVersion, variant: row.variant, contentSnapshot: parseJson(row.content_snapshot_json, {}), layout: normalizePaperLayoutDraft(parseJson(row.layout_json, {})), layoutVersion: row.layout_version, revision: row.revision, preview: { revision: row.preview_revision, status: row.preview_status, pdfUrl: row.preview_path ? `/assets/${row.preview_path}` : '', pages, pageImages:pages, pageCount:pages.length, variants:{student:variantPreview('student'),teacher:variantPreview('teacher')}, questionPages:parseJson(row.preview_question_pages_json, {}), warnings:parseJson(row.preview_warnings_json, []), error: row.preview_error }, createdAt: row.created_at, updatedAt: row.updated_at }
}
export function createLayoutDraft(collectionId: string, body: Record<string, any>) {
  const collection = getCollection(collectionId); const now = nowIso(); const id = createId('layout')
  const layout = normalizePaperLayoutDraft(body.layout)
  const snapshot = snapshotAssets(collection, id)
  repo.insertLayoutDraft([id, collectionId, String(body.name || `${collection.title} 排版草稿`).trim(), body.templateId === 'exam' ? 'exam' : 'worksheet', '1', body.variant === 'teacher' ? 'teacher' : 'student', JSON.stringify(snapshot), JSON.stringify(layout), paperLayoutDraftVersion, 1, now, now])
  return publicDraft(repo.getLayoutDraft(id)!)
}
export function getLayoutDraft(id: string) { const row=repo.getLayoutDraft(id); if(!row) throw new RouteError(404,'排版草稿不存在。'); return publicDraft(row) }
export function listLayoutDrafts(collectionId:string){ getCollection(collectionId); return {items:repo.listLayoutDrafts(collectionId).map(publicDraft)} }
export function searchLayoutDrafts(query:Record<string,unknown>){const page=Math.max(1,Number(query.page)||1),pageSize=Math.min(100,Math.max(1,Number(query.pageSize)||20));const result=repo.searchLayoutDrafts({query:String(query.q||'').trim(),collectionId:String(query.collectionId||''),status:String(query.status||''),limit:pageSize,offset:(page-1)*pageSize});return {items:result.items.map((row)=>({...publicDraft(row),collectionTitle:row.collection_title})),total:result.total,page,pageSize}}
export function updateLayoutDraft(id: string, body: Record<string, any>) {
  const row=repo.getLayoutDraft(id); if(!row) throw new RouteError(404,'排版草稿不存在。')
  const revision=Number(body.revision); if(revision!==row.revision) throw new RouteError(409,'草稿已在其他页面更新，请刷新后重试。')
  const layout=body.layout===undefined ? parseJson(row.layout_json,{}) : normalizePaperLayoutDraft(body.layout)
  const result=repo.updateLayoutDraft(id,revision,[body.name==null?row.name:String(body.name).trim(),body.templateId==='exam'?'exam':row.template_id,body.variant==='teacher'?'teacher':body.variant==='student'?'student':row.variant,JSON.stringify(layout),paperLayoutDraftVersion,nowIso()])
  if(!result.changes) throw new RouteError(409,'草稿版本冲突，请刷新后重试。')
  fs.rmSync(path.join(dataDir,'layout-previews',safeName(id)),{recursive:true,force:true})
  return getLayoutDraft(id)
}
/**
 * Refresh the frozen content explicitly before a new precision preview. Layout
 * choices remain intact, but question text, figures, and copied assets are
 * brought in from the current collection as a new revision.
 */
export function refreshLayoutDraftContent(id: string, requestedRevision?: unknown) {
  const row = repo.getLayoutDraft(id); if (!row) throw new RouteError(404, '排版草稿不存在。')
  const revision = Number(requestedRevision ?? row.revision)
  if (revision !== row.revision) throw new RouteError(409, '草稿已在其他页面更新，请刷新后重试。')
  const previous = parseJson(row.content_snapshot_json, {})
  const collection = getCollection(row.collection_id)
  if (contentFingerprint(previous) === contentFingerprint(collection)) return { draft: getLayoutDraft(id), changed: false }

  const assetsDir = path.join(dataDir, 'layout-drafts', safeName(id), 'assets')
  fs.rmSync(assetsDir, { recursive: true, force: true })
  const snapshot = snapshotAssets(collection, id)
  const result = repo.refreshLayoutDraftContentSnapshot(id, revision, JSON.stringify(snapshot), nowIso())
  if (!result.changes) throw new RouteError(409, '草稿已在其他页面更新，请刷新后重试。')
  fs.rmSync(path.join(dataDir, 'layout-previews', safeName(id)), { recursive: true, force: true })
  return { draft: getLayoutDraft(id), changed: true }
}
export function deleteLayoutDraft(id:string){ if(!repo.getLayoutDraft(id)) throw new RouteError(404,'排版草稿不存在。'); repo.deleteLayoutDraft(id); fs.rmSync(path.join(dataDir,'layout-previews',safeName(id)),{recursive:true,force:true}); fs.rmSync(path.join(dataDir,'layout-drafts',safeName(id)),{recursive:true,force:true}); return {deleted:true} }
function cleanError(error: unknown){ return (error instanceof Error?error.message:String(error)).replace(/(?:[A-Za-z]:)?[\\/][^\s:]+/g,'[文件]').slice(0,500) }
function renderPdfPages(pdfPath:string,prefix:string){
  const poppler=spawnSync('pdftoppm',['-png','-r','120',pdfPath,prefix],{encoding:'utf8'})
  if(poppler.status===0)return true
  const code='import fitz,sys;doc=fitz.open(sys.argv[1]);prefix=sys.argv[2];matrix=fitz.Matrix(120/72,120/72);[(page.get_pixmap(matrix=matrix,alpha=False).save(f"{prefix}-{index+1}.png")) for index,page in enumerate(doc)]'
  const fallback=spawnSync(pythonCommand(),['-c',code,pdfPath,prefix],{encoding:'utf8',env:pythonEnv()})
  return fallback.status===0
}
export function generateLayoutPreview(id:string, requestedRevision?:unknown){
  const row=repo.getLayoutDraft(id); if(!row) throw new RouteError(404,'排版草稿不存在。'); const revision=Number(requestedRevision??row.revision)
  if(revision!==row.revision) throw new RouteError(409,'只能预览当前草稿版本。')
  if(row.preview_status==='queued'||row.preview_status==='rendering') return getLayoutDraft(id).preview
  repo.setPreviewState(id,revision,'queued','',[],[],'')
  previewQueue.push({id,revision}); void runPreviewQueue()
  return getLayoutDraft(id).preview
}
async function runPreviewQueue(){
  if(previewWorkerRunning)return; previewWorkerRunning=true
  try { while(previewQueue.length){ const task=previewQueue.shift()!; await Promise.resolve(); renderLayoutPreview(task.id,task.revision) } }
  finally { previewWorkerRunning=false }
}
function renderLayoutPreview(id:string, revision:number){
  const row=repo.getLayoutDraft(id); if(!row||row.revision!==revision)return
  repo.setPreviewState(id,revision,'rendering','',[],[],'')
  try {
    const snapshot=parseJson(row.content_snapshot_json,null); if(!snapshot) throw new Error('内容快照无效'); assertSnapshotSupported(snapshot)
    const layout=normalizePaperLayoutDraft(parseJson(row.layout_json,{})); const template=row.template_id==='exam'?'qbank-exam':'qbank-worksheet'
    const dir=path.join(dataDir,'layout-previews',safeName(id),`r${revision}`); fs.mkdirSync(dir,{recursive:true})
    const questionNos=new Map<string,string>();(snapshot.questions||[]).forEach((entry:any,index:number)=>{const no=String(entry.item?.questionNo||index+1);questionNos.set(String(entry.item?.id||''),no);questionNos.set(String(entry.relationId||entry.id||''),no)})
    const warnings:any[]=[];const questionPages:Record<string,Record<string,{startPage:number;endPage:number}>>={student:{},teacher:{}};let primaryTarget='';let primaryPages:string[]=[]
    for(const variant of ['student','teacher'] as const){
      const result=exportCollectionWorksheetPdfWithDiagnostics(snapshot,variant,template,layout)
      const target=path.join(dir,`${variant}.pdf`);fs.copyFileSync(result.pdfPath,target);fs.copyFileSync(result.texPath,path.join(dir,`${variant}.tex`));if(fs.existsSync(result.logPath))fs.copyFileSync(result.logPath,path.join(dir,`${variant}.log`))
      const prefix=path.join(dir,`${variant}-page`);const rendered=renderPdfPages(target,prefix)
      const pages=rendered?fs.readdirSync(dir).filter(n=>new RegExp(`^${variant}-page-\\d+\\.png$`).test(n)).sort((a,b)=>Number(a.match(/\d+/)?.[0]||0)-Number(b.match(/\d+/)?.[0]||0)).map(n=>assetPathFor(path.join(dir,n))):[]
      questionPages[variant]=Object.fromEntries(result.questionTelemetry.map((record:any)=>[String(record.id),{startPage:Number(record.startPage)||1,endPage:Number(record.endPage)||Number(record.startPage)||1}]))
      warnings.push(...result.warnings.map((warning:any)=>({...warning,questionNo:questionNos.get(String(warning.questionId||''))||'',variant,source:'pdf'})))
      if(variant===row.variant){primaryTarget=target;primaryPages=pages}
    }
    repo.setPreviewState(id,revision,'ready',assetPathFor(primaryTarget),primaryPages,warnings,'',questionPages)
  } catch(error){ const message=cleanError(error); const warnings=error&&typeof error==='object'&&Array.isArray((error as any).layoutWarnings)?(error as any).layoutWarnings:[]; repo.setPreviewState(id,revision,'failed','',[],warnings,message) }
}
export function recoverInterruptedLayoutPreviews(){ repo.markInterruptedPreviewsFailed() }
export function getPreviewStatus(id:string){ return getLayoutDraft(id).preview }
export function getPreviewPages(id:string){ const draft=getLayoutDraft(id); return {revision:draft.preview.revision,status:draft.preview.status,pages:draft.preview.pages,pdfUrl:draft.preview.pdfUrl} }
export function exportLayoutDraft(id:string,body:Record<string,any>){ const row=repo.getLayoutDraft(id); if(!row) throw new RouteError(404,'排版草稿不存在。'); if(Number(body.revision)!==row.revision) throw new RouteError(409,'只能导出当前草稿版本。'); const snapshot=parseJson(row.content_snapshot_json,{}); const layout=parseJson(row.layout_json,{}); assertSnapshotSupported(snapshot); return exportCollection(snapshot,{...body,variant:row.variant,template:row.template_id,layoutDraft:layout,reproducibleSnapshot:{draftId:id,revision:row.revision,templateId:row.template_id,templateVersion:row.template_version,layoutVersion:row.layout_version,contentSnapshot:snapshot,layout}}) }

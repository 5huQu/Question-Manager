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
import { mapQuestion } from '../../db/questions.js'
import { buildSearchText } from '../../utils/search.js'
import { formatReviewPayload, validateQuestionMarkdown } from '../../utils/validation.js'
import { stripDoc2xNoiseComments } from '../../utils/rich-content.js'
import { syncQuestionBankItemToOcrDraft } from '../../utils/ocr-helpers.js'

function parseJson(value: unknown, fallback: any) { try { return JSON.parse(String(value || '')) } catch { return fallback } }
const contentSnapshotVersion = 1
const previewQueue: Array<{ id: string; revision: number }> = []
let previewWorkerRunning = false
type ContentOverride = { questionId: string; baseContentRevision: number; stemMarkdown: string; answerText: string; analysisMarkdown: string }
type ContentOverrides = Record<string, ContentOverride>

function effectiveSnapshot(snapshot: any, overrides: ContentOverrides) {
  const effective = JSON.parse(JSON.stringify(snapshot || {}))
  for (const entry of effective.questions || []) {
    const override = overrides[String(entry.relationId || '')]
    if (!override || !entry.item) continue
    entry.item.stemMarkdown = override.stemMarkdown
    entry.item.answerText = override.answerText
    entry.item.analysisMarkdown = override.analysisMarkdown
  }
  return effective
}

function mergeContentEdits(snapshot: any, current: ContentOverrides, rawEdits: unknown): ContentOverrides {
  if (rawEdits === undefined) return current
  const edits = Array.isArray(rawEdits)
    ? rawEdits
    : rawEdits && typeof rawEdits === 'object'
      ? Object.entries(rawEdits as Record<string, unknown>).map(([relationId, value]) => ({ relationId, ...(value as object) }))
      : []
  const next = { ...current }
  for (const raw of edits as Array<Record<string, any>>) {
    const relationId = String(raw.relationId || raw.id || '')
    const content = raw.content && typeof raw.content === 'object' ? raw.content as Record<string, any> : raw
    const entry = (snapshot.questions || []).find((question: any) => String(question.relationId || '') === relationId)
    if (!entry?.item) throw new RouteError(404, `排版草稿中不存在题目 ${relationId}。`)
    const previous = next[relationId]
    const candidate: ContentOverride = {
      questionId: String(entry.item.id || previous?.questionId || ''),
      baseContentRevision: Number(previous?.baseContentRevision || entry.item.contentRevision || 1),
      stemMarkdown: stripDoc2xNoiseComments(String(content.stemMarkdown ?? previous?.stemMarkdown ?? entry.item.stemMarkdown ?? '')),
      answerText: stripDoc2xNoiseComments(String(content.answerText ?? previous?.answerText ?? entry.item.answerText ?? '')),
      analysisMarkdown: stripDoc2xNoiseComments(String(content.analysisMarkdown ?? previous?.analysisMarkdown ?? entry.item.analysisMarkdown ?? '')),
    }
    const unchanged = candidate.stemMarkdown === String(entry.item.stemMarkdown || '') && candidate.answerText === String(entry.item.answerText || '') && candidate.analysisMarkdown === String(entry.item.analysisMarkdown || '')
    if (unchanged || raw.reset === true) delete next[relationId]
    else next[relationId] = candidate
  }
  return next
}

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
function previewRevisionDirs(id:string){
  const root=path.join(dataDir,'layout-previews',safeName(id))
  if(!fs.existsSync(root))return [] as Array<{revision:number;dir:string}>
  return fs.readdirSync(root,{withFileTypes:true}).flatMap((entry)=>{const match=entry.isDirectory()?entry.name.match(/^r(\d+)$/):null;return match?[{revision:Number(match[1]),dir:path.join(root,entry.name)}]:[]}).sort((a,b)=>b.revision-a.revision)
}
function previewVariantAt(dir:string,variant:'student'|'teacher'){
  const pdf=path.join(dir,`${variant}.pdf`)
  const pages=fs.existsSync(dir)?fs.readdirSync(dir).filter((name)=>new RegExp(`^${variant}-page-\\d+\\.png$`).test(name)).sort((a,b)=>Number(a.match(/\d+/)?.[0]||0)-Number(b.match(/\d+/)?.[0]||0)).map((name)=>`/assets/${assetPathFor(path.join(dir,name))}`):[]
  return {pdfUrl:fs.existsSync(pdf)?`/assets/${assetPathFor(pdf)}`:'',pages,pageImages:pages,pageCount:pages.length}
}
function cleanupPreviewRevisions(id:string,keepRevision:number){
  previewRevisionDirs(id).filter((entry)=>entry.revision!==keepRevision).forEach((entry)=>fs.rmSync(entry.dir,{recursive:true,force:true}))
}
function publicDraft(row: repo.LayoutDraftRow) {
  const pages=parseJson(row.preview_pages_json, []).map((p: string) => `/assets/${p}`)
  const revisions=previewRevisionDirs(row.id)
  const requested=revisions.find((entry)=>entry.revision===Number(row.preview_revision))
  const requestedVariants=requested?{student:previewVariantAt(requested.dir,'student'),teacher:previewVariantAt(requested.dir,'teacher')}:undefined
  const requestedReady=row.preview_status==='ready'&&Boolean(requestedVariants&&(requestedVariants.student.pageCount||requestedVariants.teacher.pageCount))
  const fallbackCeiling=row.preview_status==='idle'?Number(row.preview_revision):Number(row.preview_revision)-1
  const displayed=requestedReady?requested:revisions.find((entry)=>entry.revision<=fallbackCeiling&&Boolean(previewVariantAt(entry.dir,'student').pageCount||previewVariantAt(entry.dir,'teacher').pageCount))
  const variants=displayed?{student:previewVariantAt(displayed.dir,'student'),teacher:previewVariantAt(displayed.dir,'teacher')}:{student:{pdfUrl:'',pages:[],pageImages:[],pageCount:0},teacher:{pdfUrl:'',pages:[],pageImages:[],pageCount:0}}
  const contentSnapshot=parseJson(row.content_snapshot_json,{})
  const contentOverrides=parseJson(row.content_overrides_json,{}) as ContentOverrides
  return { id: row.id, collectionId: row.collection_id, name: row.name, template: row.template_id, templateId: row.template_id, templateVersion: row.template_version, templateSpec:templateRenderSpec(row.template_id), templateSpecVersion:templateRenderSpecVersion, variant: row.variant, contentSnapshot, contentOverrides, effectiveContentSnapshot:effectiveSnapshot(contentSnapshot,contentOverrides), layout: normalizePaperLayoutDraft(parseJson(row.layout_json, {})), layoutVersion: row.layout_version, revision: row.revision, preview: { revision: row.preview_revision, displayRevision:displayed?.revision||0, status: row.preview_status, pdfUrl: row.preview_path ? `/assets/${row.preview_path}` : '', pages, pageImages:pages, pageCount:pages.length, variants, questionPages:parseJson(row.preview_question_pages_json, {}), warnings:parseJson(row.preview_warnings_json, []), error: row.preview_error }, createdAt: row.created_at, updatedAt: row.updated_at }
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
  const snapshot=parseJson(row.content_snapshot_json,{})
  const overrides=mergeContentEdits(snapshot,parseJson(row.content_overrides_json,{}),body.contentEdits)
  const result=repo.updateLayoutDraft(id,revision,[body.name==null?row.name:String(body.name).trim(),body.templateId==='exam'?'exam':row.template_id,body.variant==='teacher'?'teacher':body.variant==='student'?'student':row.variant,JSON.stringify(layout),paperLayoutDraftVersion,JSON.stringify(overrides),nowIso()])
  if(!result.changes) throw new RouteError(409,'草稿版本冲突，请刷新后重试。')
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
  const overrides = parseJson(row.content_overrides_json, {}) as ContentOverrides
  const collection = getCollection(row.collection_id)
  const conflicts = Object.entries(overrides).flatMap(([relationId, override]) => {
    const live = collection.questions.find((entry:any) => String(entry.relationId) === relationId)?.item
    return !live || Number(live.contentRevision || 1) !== Number(override.baseContentRevision) ? [{ relationId, questionId: override.questionId, expectedContentRevision: override.baseContentRevision, actualContentRevision: Number(live?.contentRevision || 0) }] : []
  })
  if (contentFingerprint(previous) === contentFingerprint(collection)) return { draft: getLayoutDraft(id), changed: false, preservedOverrides: Object.keys(overrides).length, conflicts }

  const assetsDir = path.join(dataDir, 'layout-drafts', safeName(id), 'assets')
  fs.rmSync(assetsDir, { recursive: true, force: true })
  const snapshot = snapshotAssets(collection, id)
  const result = repo.refreshLayoutDraftContentSnapshot(id, revision, JSON.stringify(snapshot), JSON.stringify(overrides), nowIso())
  if (!result.changes) throw new RouteError(409, '草稿已在其他页面更新，请刷新后重试。')
  return { draft: getLayoutDraft(id), changed: true, preservedOverrides: Object.keys(overrides).length, conflicts }
}

export function syncLayoutContentToBank(id:string,relationId:string,body:Record<string,any>){
  const row=repo.getLayoutDraft(id);if(!row)throw new RouteError(404,'排版草稿不存在。')
  const revision=Number(body.revision);if(revision!==row.revision)throw new RouteError(409,'草稿已在其他页面更新，请刷新后重试。')
  const snapshot=parseJson(row.content_snapshot_json,{})
  const overrides=parseJson(row.content_overrides_json,{}) as ContentOverrides
  const override=overrides[relationId];if(!override)throw new RouteError(404,'当前题目没有待同步的试卷内修改。')
  const expected=Number(body.expectedContentRevision??override.baseContentRevision)
  const liveRow=repo.getQuestionBankItemRow(override.questionId)
  if(!liveRow)throw new RouteError(404,'题库原题不存在。')
  const current=mapQuestion(liveRow as any)
  if(Number(current.contentRevision)!==expected)throwContentConflict(expected,current)
  const issues=validateQuestionMarkdown({problem_text:override.stemMarkdown,answer:override.answerText,analysis:override.analysisMarkdown})
  const review=issues.length?JSON.stringify(formatReviewPayload(issues,nowIso())):'{}'
  const updatedItem={...current,stemMarkdown:override.stemMarkdown,answerText:override.answerText,analysisMarkdown:override.analysisMarkdown,contentRevision:expected+1,needsFormatReview:Boolean(issues.length),bankStatus:issues.length&&current.bankStatus==='ready'?'blocked':current.bankStatus,updatedAt:nowIso()}
  const nextSnapshot=JSON.parse(JSON.stringify(snapshot));const entry=(nextSnapshot.questions||[]).find((question:any)=>String(question.relationId||'')===relationId);if(!entry?.item)throw new RouteError(404,'排版草稿题目快照不存在。');entry.item={...entry.item,stemMarkdown:updatedItem.stemMarkdown,answerText:updatedItem.answerText,analysisMarkdown:updatedItem.analysisMarkdown,contentRevision:updatedItem.contentRevision,needsFormatReview:updatedItem.needsFormatReview,bankStatus:updatedItem.bankStatus,updatedAt:updatedItem.updatedAt}
  const nextOverrides={...overrides};delete nextOverrides[relationId]
  try{const result=repo.syncContentOverrideToBank({draftId:id,revision,questionId:override.questionId,expectedContentRevision:expected,stemMarkdown:override.stemMarkdown,answerText:override.answerText,analysisMarkdown:override.analysisMarkdown,searchText:buildSearchText(override.stemMarkdown,override.answerText,override.analysisMarkdown,[String(current.sourceTitle||''),String(current.chapter||''),(current.knowledgePoints||[]).join(' '),(current.solutionMethods||[]).join(' ')]),formatReviewRequired:issues.length?1:0,formatReviewJson:review,bankStatus:String(updatedItem.bankStatus),contentSnapshotJson:JSON.stringify(nextSnapshot),contentOverridesJson:JSON.stringify(nextOverrides),updatedAt:String(updatedItem.updatedAt)});if(!result.questionChanges){const concurrent=repo.getQuestionBankItemRow(override.questionId);throwContentConflict(expected,concurrent?mapQuestion(concurrent as any):current)}}catch(error){if(error instanceof Error&&error.message==='layout_revision_conflict')throw new RouteError(409,'草稿已在其他页面更新，请刷新后重试。');throw error}
  const finalRow=repo.getQuestionBankItemRow(override.questionId);if(!finalRow)throw new RouteError(404,'题库原题不存在。');const item=mapQuestion(finalRow as any)
  const warnings:Array<{code:string;message:string}>=[];try{syncQuestionBankItemToOcrDraft(item)}catch(error){warnings.push({code:'ocr_draft_sync_failed',message:error instanceof Error?error.message:String(error)})}
  return {draft:getLayoutDraft(id),item,warnings}
}
function throwContentConflict(expected:number,current:any):never{throw new RouteError(409,'内容已在其他页面更新，请刷新后重试。',undefined,{error:'content_revision_conflict',message:'内容已在其他页面更新，请刷新后重试。',expectedContentRevision:expected,actualContentRevision:Number(current.contentRevision||1),current})}
export function deleteLayoutDraft(id:string){ if(!repo.getLayoutDraft(id)) throw new RouteError(404,'排版草稿不存在。'); repo.deleteLayoutDraft(id); fs.rmSync(path.join(dataDir,'layout-previews',safeName(id)),{recursive:true,force:true}); fs.rmSync(path.join(dataDir,'layout-drafts',safeName(id)),{recursive:true,force:true}); return {deleted:true} }
function cleanError(error: unknown){ return (error instanceof Error?error.message:String(error)).replace(/(?:[A-Za-z]:)?[\\/][^\s:]+/g,'[文件]').slice(0,500) }
function renderPdfPages(pdfPath:string,prefix:string){
  const directory=path.dirname(prefix);const basename=path.basename(prefix)
  if(fs.existsSync(directory)){
    for(const name of fs.readdirSync(directory)){
      if(new RegExp(`^${basename}-\\d+\\.png$`).test(name))fs.unlinkSync(path.join(directory,name))
    }
  }
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
  repo.setPreviewProgress(id,revision,'queued')
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
  repo.setPreviewProgress(id,revision,'rendering')
  try {
    const frozen=parseJson(row.content_snapshot_json,null); if(!frozen) throw new Error('内容快照无效'); assertSnapshotSupported(frozen)
    const snapshot=effectiveSnapshot(frozen,parseJson(row.content_overrides_json,{}))
    const layout=normalizePaperLayoutDraft(parseJson(row.layout_json,{})); const template=row.template_id==='exam'?'qbank-exam':'qbank-worksheet'
    const dir=path.join(dataDir,'layout-previews',safeName(id),`r${revision}`); fs.mkdirSync(dir,{recursive:true})
    const order=new Map(layout.questions.map((item:any,index:number)=>[String(item.relationId),Number(item.order??index)]));const orderedQuestions=[...(snapshot.questions||[])].map((entry:any,index:number)=>({entry,index})).sort((left:any,right:any)=>(order.get(String(left.entry.relationId||left.entry.item?.id))??left.index)-(order.get(String(right.entry.relationId||right.entry.item?.id))??right.index)).map((item:any)=>item.entry)
    const questionNos=new Map<string,string>();orderedQuestions.forEach((entry:any,index:number)=>{const no=String(index+1);questionNos.set(String(entry.item?.id||''),no);questionNos.set(String(entry.relationId||entry.id||''),no);questionNos.set(safeName(String(entry.relationId||entry.item?.id||index+1)),no)})
    const warnings:any[]=[];const questionPages:Record<string,Record<string,{startPage:number;endPage:number}>>={student:{},teacher:{}};let primaryTarget='';let primaryPages:string[]=[]
    for(const variant of ['student','teacher'] as const){
      let result: ReturnType<typeof exportCollectionWorksheetPdfWithDiagnostics>
      try {
        result=exportCollectionWorksheetPdfWithDiagnostics(snapshot,variant,template,layout)
      } catch (error) {
        const message=error instanceof Error?error.message:String(error)
        const wrapped=new Error(`${variant==='student'?'学生版':'教师版'} PDF 生成失败：${message}`,{cause:error})
        if(error&&typeof error==='object'&&Array.isArray((error as any).layoutWarnings))(wrapped as any).layoutWarnings=(error as any).layoutWarnings
        throw wrapped
      }
      const target=path.join(dir,`${variant}.pdf`);fs.copyFileSync(result.pdfPath,target);fs.copyFileSync(result.texPath,path.join(dir,`${variant}.tex`));if(fs.existsSync(result.logPath))fs.copyFileSync(result.logPath,path.join(dir,`${variant}.log`))
      const prefix=path.join(dir,`${variant}-page`);const rendered=renderPdfPages(target,prefix)
      const pages=rendered?fs.readdirSync(dir).filter(n=>new RegExp(`^${variant}-page-\\d+\\.png$`).test(n)).sort((a,b)=>Number(a.match(/\d+/)?.[0]||0)-Number(b.match(/\d+/)?.[0]||0)).map(n=>assetPathFor(path.join(dir,n))):[]
      questionPages[variant]=Object.fromEntries(result.questionTelemetry.map((record:any)=>[String(record.id),{startPage:Number(record.startPage)||1,startPageTotal:Number(record.startPageTotal)||0,endPage:Number(record.endPage)||Number(record.startPage)||1,endPageTotal:Number(record.endPageTotal)||0,pageGoal:Number(record.pageGoal)||0}]))
      warnings.push(...result.warnings.map((warning:any)=>({...warning,questionNo:questionNos.get(String(warning.questionId||''))||'',variant,source:'pdf'})))
      if(variant===row.variant){primaryTarget=target;primaryPages=pages}
    }
    repo.setPreviewState(id,revision,'ready',assetPathFor(primaryTarget),primaryPages,warnings,'',questionPages)
    cleanupPreviewRevisions(id,revision)
  } catch(error){ const message=cleanError(error); const warnings=error&&typeof error==='object'&&Array.isArray((error as any).layoutWarnings)?(error as any).layoutWarnings:[]; repo.setPreviewFailure(id,revision,message,warnings) }
}
export function recoverInterruptedLayoutPreviews(){ repo.markInterruptedPreviewsFailed() }
export function getPreviewStatus(id:string){ return getLayoutDraft(id).preview }
export function getPreviewPages(id:string){ const draft=getLayoutDraft(id); return {revision:draft.preview.revision,displayRevision:draft.preview.displayRevision,status:draft.preview.status,pages:draft.preview.pages,pdfUrl:draft.preview.pdfUrl} }
export function exportLayoutDraft(id:string,body:Record<string,any>){ const row=repo.getLayoutDraft(id); if(!row) throw new RouteError(404,'排版草稿不存在。'); if(Number(body.revision)!==row.revision) throw new RouteError(409,'只能导出当前草稿版本。'); const frozen=parseJson(row.content_snapshot_json,{}); const overrides=parseJson(row.content_overrides_json,{});const snapshot=effectiveSnapshot(frozen,overrides); const layout=parseJson(row.layout_json,{}); assertSnapshotSupported(snapshot); return exportCollection(snapshot,{...body,variant:row.variant,template:row.template_id,layoutDraft:layout,reproducibleSnapshot:{draftId:id,revision:row.revision,templateId:row.template_id,templateVersion:row.template_version,layoutVersion:row.layout_version,contentSnapshot:frozen,contentOverrides:overrides,effectiveContentSnapshot:snapshot,layout}}) }

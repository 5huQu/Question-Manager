import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, GripVertical, Image as ImageIcon, LoaderCircle } from 'lucide-react'
import { ChoiceOptions, MarkdownWithInlineFigures } from '@/components/questions/QuestionContent'
import type { BasketQuestion, QuestionFigure } from '@/types'
import type { FigurePlacement, QuestionLayout, TemplateRenderSpec } from '@/api/layoutDrafts'
import { figuresByUsage, isChoiceQuestionType, parseChoiceQuestion } from '@/utils/questionDisplay'
import { assetUrl } from '@/utils/figures'
import { choiceSuggestion, defaultSolutionAnswerAreaHeightCm, figureIdOf, isSolutionQuestion } from './layoutWorkbenchModel'

const DOC2X_FIGURE_MARKER = /<!--\s*DOC2X_FIGURE:([^>\s]+)\s*-->/g

function inlineFigureIds(content: string) {
  DOC2X_FIGURE_MARKER.lastIndex = 0
  return new Set(Array.from(String(content || '').matchAll(DOC2X_FIGURE_MARKER), (match) => match[1]))
}

/**
 * The workbench is intentionally a quick layout preview, but its question body
 * must use the same Markdown, KaTeX and Doc2X figure rendering as the rest of
 * the question bank.  In particular, never manufacture choices for a question
 * just because a layout draft has a choice-layout field.
 */
export type RealtimeLayoutDiagnostic = { questionId:string;questionNo:string;page:number;code:'question-split'|'page-overflow'|'choice-overflow';message:string;suggestion:string;source:'realtime' }
export type QuestionMeasurement = { questionId:string;questionNo:string;startPage:number;endPage:number;heightPx:number;contentHeightPx:number;split:boolean;choiceColumns:1|2|4 }
export type RealtimeLayoutResult = { pages:number;questionMeasurements:QuestionMeasurement[];diagnostics:RealtimeLayoutDiagnostic[] }
type PageFragment={index:number;offset:number;height:number}

const fallbackSpec:TemplateRenderSpec={version:1,templateId:'exam',page:{widthMm:210,heightMm:297,marginTopMm:20,marginRightMm:20,marginBottomMm:20,marginLeftMm:20},typography:{bodyFont:'Songti SC, SimSun, serif',headingFont:'PingFang SC, sans-serif',bodySizePt:11,lineHeight:1.16,questionGapMm:2.6},header:{heightMm:10,label:'试卷',subject:'高中数学'},footer:{heightMm:8},title:{sizePt:18,gapAfterMm:4},section:{sizePt:14,gapBeforeMm:4,gapAfterMm:3},choices:{columnGapMm:4,rowGapMm:1.5},figures:{maxHeightMm:42,defaultWidthRatio:.45,sideWidthRatio:.4},colors:{ink:'#1B3A5B',tint:'#EEF3F8',line:'#C9D3DC',warm:'#A8762B',alert:'#A23B2D'}}
const mmToPx=(mm:number)=>mm*96/25.4

export function LayoutQuickPreview({ entries, selectedId, zoom, onSelect, onMove, title='试卷', templateSpec=fallbackSpec, variant='student', onLayout, onEqualizePage }: { entries: Array<{ question: BasketQuestion; layout: QuestionLayout }>; selectedId: string; zoom: number; onSelect: (id: string) => void; onMove?: (sourceId: string, targetId: string) => void; title?:string;templateSpec?:TemplateRenderSpec;variant?:'student'|'teacher';onLayout?:(result:RealtimeLayoutResult)=>void;onEqualizePage?:(startRelationId:string,count:2|3|null)=>void }) {
  const [heights,setHeights]=useState<Record<string,number>>({});const [settled,setSettled]=useState(false);const observer=useRef<ResizeObserver|null>(null)
  const contentWidth=mmToPx(templateSpec.page.widthMm-templateSpec.page.marginLeftMm-templateSpec.page.marginRightMm)
  const contentHeight=mmToPx(templateSpec.page.heightMm-templateSpec.page.marginTopMm-templateSpec.page.marginBottomMm-templateSpec.header.heightMm)
  useLayoutEffect(()=>{const next:Record<string,number>={};const nodes=Array.from(document.querySelectorAll<HTMLElement>('[data-layout-measure="true"]'));observer.current?.disconnect();if(typeof ResizeObserver==='undefined'){nodes.forEach(node=>{const id=node.dataset.measureId||'';if(id)next[id]=Math.ceil(node.getBoundingClientRect().height)||120});setHeights(next);setSettled(true);return}observer.current=new ResizeObserver(records=>{let changed=false;for(const record of records){const id=(record.target as HTMLElement).dataset.measureId||'';const height=Math.ceil(record.contentRect.height);if(id&&next[id]!==height){next[id]=height;changed=true}}if(changed){setSettled(false);setHeights({...next});requestAnimationFrame(()=>setSettled(true))}});nodes.forEach(node=>observer.current?.observe(node));return()=>observer.current?.disconnect()},[entries,templateSpec,variant])
  useEffect(()=>{const images=Array.from(document.querySelectorAll<HTMLImageElement>('[data-layout-measure="true"] img'));Promise.all(images.filter(image=>!image.complete).map(image=>new Promise<void>(resolve=>{image.addEventListener('load',()=>resolve(),{once:true});image.addEventListener('error',()=>resolve(),{once:true})}))).then(()=>requestAnimationFrame(()=>setSettled(true)))},[entries,variant])
  const pagination=useMemo(()=>paginate(entries,heights,contentHeight,templateSpec,title,variant),[entries,heights,contentHeight,templateSpec,title,variant])
  useEffect(()=>{if(settled)onLayout?.(pagination.result)},[settled,pagination.result,onLayout])
  let draggedId=''
  const variables={fontFamily:templateSpec.typography.bodyFont,fontSize:`${templateSpec.typography.bodySizePt}pt`,lineHeight:templateSpec.typography.lineHeight,'--template-ink':templateSpec.colors.ink,'--template-line':templateSpec.colors.line,'--template-tint':templateSpec.colors.tint,'--template-warm':templateSpec.colors.warm,'--template-figure-max-height':`${mmToPx(templateSpec.figures.maxHeightMm)}px`} as CSSProperties
  return <div className="template-preview-root relative py-5" style={{...variables,zoom}}>
    {!settled?<div className="sticky top-3 z-30 mx-auto mb-3 flex w-fit items-center gap-2 rounded-md border bg-white/95 px-3 py-1.5 text-[11px] text-zinc-500 shadow-sm"><LoaderCircle className="size-3.5 animate-spin"/>正在按模板分页</div>:null}
    {createPortal(<div aria-hidden className="template-preview-root pointer-events-none fixed left-[-10000px] top-0 opacity-0" style={{...variables,width:contentWidth}}>{entries.map((entry,index)=><div key={entry.layout.relationId} data-layout-measure="true" data-measure-id={entry.layout.relationId}><QuestionBlock entry={entry} index={index} entries={entries} selectedId="" title={title} variant={variant} templateSpec={templateSpec} measure /></div>)}</div>,document.body)}
    <div className="space-y-5">{pagination.pages.map((page,pageIndex)=><section key={pageIndex} data-preview-page={pageIndex+1} className="relative mx-auto overflow-hidden bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200" style={{width:mmToPx(templateSpec.page.widthMm),height:mmToPx(templateSpec.page.heightMm)}}>
      <PageEqualizeControl page={page} entries={entries} onChange={onEqualizePage}/>
      <TemplateHeader spec={templateSpec}/><main style={{position:'absolute',left:mmToPx(templateSpec.page.marginLeftMm),right:mmToPx(templateSpec.page.marginRightMm),top:mmToPx(templateSpec.page.marginTopMm+templateSpec.header.heightMm),bottom:mmToPx(templateSpec.page.marginBottomMm+templateSpec.footer.heightMm)}}>{pageIndex===0?<TemplateTitle title={title} spec={templateSpec}/>:null}{page.map((fragment,fragmentIndex)=><div key={`${entries[fragment.index].layout.relationId}:${fragment.offset}`} className="relative overflow-hidden" style={{height:fragment.height}}><div style={{transform:`translateY(-${fragment.offset}px)`}}><QuestionBlock entry={entries[fragment.index]} index={fragment.index} entries={entries} selectedId={selectedId} title={title} variant={variant} templateSpec={templateSpec} onSelect={fragment.offset===0?onSelect:undefined} onMove={fragment.offset===0?onMove:undefined} draggedIdRef={{get:()=>draggedId,set:(id:string)=>{draggedId=id}}}/></div>{fragment.offset>0&&fragmentIndex===0?<span className="absolute right-0 top-0 bg-white pl-2 text-[9px] text-zinc-400">第 {fragment.index+1} 题续</span>:null}</div>)}</main><TemplateFooter spec={templateSpec} page={pageIndex+1} total={pagination.pages.length}/>
    </section>)}</div>
  </div>
}

function paginate(entries:Parameters<typeof LayoutQuickPreview>[0]['entries'],heights:Record<string,number>,capacity:number,spec:TemplateRenderSpec,title:string,variant:'student'|'teacher'){
  const titleHeight=mmToPx(18+spec.title.gapAfterMm);const pages:PageFragment[][]=[[]];let used=titleHeight;const measurements:QuestionMeasurement[]=[];const diagnostics:RealtimeLayoutDiagnostic[]=[]
  entries.forEach((entry,index)=>{const id=entry.layout.relationId;const contentHeight=heights[id]||120;const height=contentHeight+(isSolutionQuestion(entry.question)?mmToPx(effectiveAnswerAreaHeight(entry.layout)*10)+18:0);const columns=choiceColumns(entry);if((entry.layout.pageBreakBefore||entry.layout.equalizedPageBreakBefore)&&pages[pages.length-1].length){pages.push([]);used=0}const maySplit=isSolutionQuestion(entry.question);if(!maySplit&&entry.layout.keepTogether!==false&&used+height>capacity&&pages[pages.length-1].length){pages.push([]);used=0}const startPage=pages.length;let remaining=height;let offset=0;while(remaining>0){let available=capacity-used;if(available<1){pages.push([]);used=0;available=capacity}const slice=Math.min(remaining,available);pages[pages.length-1].push({index,offset,height:slice});remaining-=slice;offset+=slice;used+=slice;if(remaining>0){pages.push([]);used=0}}const endPage=pages.length;const split=endPage>startPage;if(split)diagnostics.push({questionId:id,questionNo:String(index+1),page:startPage,code:'question-split',message:'题目内容跨页显示。',suggestion:'缩短答题区，或在本题前强制分页。',source:'realtime'});if(height>capacity)diagnostics.push({questionId:id,questionNo:String(index+1),page:startPage,code:'page-overflow',message:'题目高度超过单页正文区域。',suggestion:'缩小题图或答题区。',source:'realtime'});if(entry.layout.choiceLayout==='four'&&choiceSuggestion(entry.question.item.stemMarkdown).layout!=='four')diagnostics.push({questionId:id,questionNo:String(index+1),page:startPage,code:'choice-overflow',message:'选项内容不适合强制四栏。',suggestion:'改为自动、两栏或单栏。',source:'realtime'});measurements.push({questionId:id,questionNo:String(index+1),startPage,endPage,heightPx:height,contentHeightPx:contentHeight,split,choiceColumns:columns})})
  return {pages,result:{pages:pages.length,questionMeasurements:measurements,diagnostics}}
}

function choiceColumns(entry:Parameters<typeof LayoutQuickPreview>[0]['entries'][number]):1|2|4{const value=entry.layout.choiceLayout==='auto'?choiceSuggestion(entry.question.item.stemMarkdown).layout:entry.layout.choiceLayout;return value==='four'?4:value==='two'?2:1}
function effectiveAnswerAreaHeight(layout:QuestionLayout){return layout.answerAreaHeight??layout.equalizedAnswerAreaHeight??defaultSolutionAnswerAreaHeightCm}
function TemplateHeader({spec}:{spec:TemplateRenderSpec}){return <header className="absolute flex items-end justify-between border-b pb-1 text-[10px] font-semibold" style={{fontFamily:spec.typography.headingFont,color:spec.colors.ink,borderColor:spec.colors.line,left:mmToPx(spec.page.marginLeftMm),right:mmToPx(spec.page.marginRightMm),top:mmToPx(spec.page.marginTopMm-7),height:mmToPx(spec.header.heightMm)}}><span>Q&nbsp;&nbsp;Question Manager</span><span>{spec.header.label} | {spec.header.subject}</span></header>}
function TemplateFooter({spec,page,total}:{spec:TemplateRenderSpec;page:number;total:number}){return <footer className="absolute flex items-start justify-between border-t pt-1 text-[9px]" style={{color:spec.colors.ink,borderColor:spec.colors.line,left:mmToPx(spec.page.marginLeftMm),right:mmToPx(spec.page.marginRightMm),bottom:mmToPx(spec.page.marginBottomMm-6),height:mmToPx(spec.footer.heightMm)}}><span>Question Manager · 高中数学</span><span>第 {page} 页 / 共 {total} 页</span></footer>}
function TemplateTitle({title,spec}:{title:string;spec:TemplateRenderSpec}){return <header className="mb-4 border-y py-3 text-center" style={{borderColor:spec.colors.line,color:spec.colors.ink,fontFamily:spec.typography.headingFont}}><h2 style={{fontSize:`${spec.title.sizePt}pt`}} className="font-semibold">{title}</h2></header>}
function PageEqualizeControl({page,entries,onChange}:{page:PageFragment[];entries:Parameters<typeof LayoutQuickPreview>[0]['entries'];onChange?:((startRelationId:string,count:2|3|null)=>void)}){if(!onChange)return null;const fragment=page.find(item=>isSolutionQuestion(entries[item.index].question));if(!fragment)return null;const layout=entries[fragment.index].layout;const groupId=layout.equalizedGroupId;const active=groupId===layout.relationId?layout.equalizedGroupSize:undefined;return <div className="absolute right-3 top-2 z-20 flex items-center gap-1 rounded-md border border-zinc-200 bg-white/95 p-0.5 text-[9px] shadow-sm"><span className="px-1 text-zinc-400">本页</span>{([['auto','自动'],[2,'2题'],[3,'3题']] as const).map(([value,label])=><button key={value} type="button" className={`h-5 rounded px-1.5 ${active===value||value==='auto'&&!active?'bg-zinc-900 text-white':'hover:bg-zinc-100'}`} onClick={event=>{event.stopPropagation();onChange(layout.relationId,value==='auto'?null:value)}}>{label}</button>)}</div>}

function QuestionBlock({entry,index,entries,selectedId,variant,templateSpec,onSelect,onMove,draggedIdRef,measure=false,continuation=false}:{entry:{question:BasketQuestion;layout:QuestionLayout};index:number;entries:Array<{question:BasketQuestion;layout:QuestionLayout}>;selectedId:string;title:string;variant:'student'|'teacher';templateSpec:TemplateRenderSpec;onSelect?:(id:string)=>void;onMove?:(a:string,b:string)=>void;draggedIdRef?:{get:()=>string;set:(id:string)=>void};measure?:boolean;continuation?:boolean}){
  const {question,layout}=entry
  {
      const item = question.item
      const parsedChoice = isChoiceQuestionType(item.questionType) ? parseChoiceQuestion(item.stemMarkdown) : null
      const suggestion = parsedChoice ? choiceSuggestion(item.stemMarkdown) : { layout: 'one' as const }
      const columns = layout.choiceLayout === 'auto' ? suggestion.layout : layout.choiceLayout
      const approximateOverflow = Boolean(parsedChoice && layout.choiceLayout === 'four' && suggestion.layout !== 'four')
      const stemContent = parsedChoice?.stem || item.stemMarkdown
      const stemFigures = figuresByUsage(item.figures, 'stem').filter((figure) => Boolean(figure.path) && !String(figure.path).trim().startsWith('<'))
      const anchoredFigureIds = inlineFigureIds(stemContent)
      const unanchoredFigures = stemFigures.filter((figure) => !anchoredFigureIds.has(String(figure.blockId || figure.id)))
      const sectionChanged=Boolean(question.sectionName&&question.sectionName!==entries[index-1]?.question.sectionName)
      return <div style={{paddingBottom:mmToPx(templateSpec.typography.questionGapMm)}}>
        {sectionChanged?<h3 className="mb-3 mt-2 border-b pb-2 font-semibold" style={{fontFamily:templateSpec.typography.headingFont,fontSize:`${templateSpec.section.sizePt}pt`,color:templateSpec.colors.ink,borderColor:templateSpec.colors.line}}><span className="mr-2 inline-block h-[.9em] w-[.45em]" style={{background:templateSpec.colors.ink}}/>{question.sectionName}</h3>:null}
        <article id={measure||continuation?undefined:`layout-question-${layout.relationId}`} draggable={Boolean(onMove&&!measure&&!continuation)} onDragStart={event => { draggedIdRef?.set(layout.relationId); event.dataTransfer.setData('text/plain', layout.relationId); event.dataTransfer.effectAllowed = 'move'; event.currentTarget.classList.add('opacity-50') }} onDragEnd={event => event.currentTarget.classList.remove('opacity-50')} onDragOver={event => { if (onMove) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }} onDrop={event => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain') || draggedIdRef?.get(); if (onMove && sourceId && sourceId !== layout.relationId) onMove(sourceId, layout.relationId) }} onClick={() => onSelect?.(layout.relationId)} className={`group relative scroll-mt-6 rounded-sm transition-[background-color,box-shadow,opacity] ${measure||continuation?'':`cursor-pointer ${selectedId === layout.relationId ? 'bg-zinc-100 ring-1 ring-zinc-300' : 'hover:bg-zinc-50'}`}`}>
          {onMove ? <div title="拖拽调整题目顺序" className="absolute -left-6 top-3 flex size-5 cursor-grab items-center justify-center rounded text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-zinc-100 hover:text-zinc-600 active:cursor-grabbing"><GripVertical className="size-4"/></div> : null}
          <div className="template-question-line flex items-start gap-2">
            <strong>{index + 1}.</strong>
            <div className="min-w-0 flex-1">
              <LayoutQuestionBody
                choiceLayout={columns}
                figures={unanchoredFigures}
                item={item}
                layout={layout}
                parsedChoice={parsedChoice}
                stemContent={stemContent}
                stemFigures={stemFigures}
              />
            </div>
          </div>
          {isSolutionQuestion(question)&&!measure ? <div className="mt-4 border-b border-dashed border-zinc-300" style={{ height: `${effectiveAnswerAreaHeight(layout)}cm` }}><span className="text-[10px] text-zinc-400">答题区 {effectiveAnswerAreaHeight(layout).toFixed(1)}cm{layout.answerAreaManual?' · 手动':' · 自动分配'}</span></div> : null}
          {variant==='teacher'?<div className="mt-3 border-l-2 px-3 py-2 text-[12px]" style={{borderColor:templateSpec.colors.ink,background:templateSpec.colors.tint}}><p><b style={{color:templateSpec.colors.ink}}>答案：</b></p><MarkdownWithInlineFigures content={item.answerText||'暂无'} figures={figuresByUsage(item.figures,'analysis')}/><p className="mt-1"><b style={{color:templateSpec.colors.warm}}>解析：</b></p><MarkdownWithInlineFigures content={item.analysisMarkdown||'暂无'} figures={figuresByUsage(item.figures,'analysis')}/></div>:null}
          {approximateOverflow ? <div className="mt-3 flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle className="size-3" />强制四栏可能溢出</div> : null}
          {!layout.keepTogether ? <div className="mt-2 text-[10px] text-zinc-400">允许跨页拆分</div> : null}
        </article>
      </div>
  }
}

function LayoutQuestionBody({ item, layout, stemContent, stemFigures, figures, parsedChoice, choiceLayout }: {
  item: BasketQuestion['item']
  layout: QuestionLayout
  stemContent: string
  stemFigures: QuestionFigure[]
  figures: QuestionFigure[]
  parsedChoice: ReturnType<typeof parseChoiceQuestion>
  choiceLayout: 'four' | 'two' | 'one'
}) {
  const left = figuresForPlacement(figures, layout, 'side-left')
  const right = figuresForPlacement(figures, layout, 'side-right')
  return <div className="flex items-start gap-4">
    {left.length ? <FigureStrip figures={left} layout={layout} side /> : null}
    <div className="min-w-0 flex-1">
      <MarkdownWithInlineFigures content={stemContent || '（题干为空）'} figures={stemFigures} />
      <FigureStrip figures={figuresForPlacement(figures, layout, 'before-choices')} layout={layout} />
      {parsedChoice ? <ChoiceOptions figures={figuresByUsage(item.figures, 'options')} layout={choiceLayout} options={parsedChoice.options} /> : null}
      {parsedChoice?.remainder ? <MarkdownWithInlineFigures className="mt-3 text-[14px] leading-7" content={parsedChoice.remainder} figures={stemFigures} /> : null}
      <FigureStrip figures={figuresForPlacement(figures, layout, 'after-choices')} layout={layout} />
    </div>
    {right.length ? <FigureStrip figures={right} layout={layout} side /> : null}
  </div>
}

function resolvedPlacement(figure: QuestionFigure, index: number, layout: QuestionLayout): FigurePlacement {
  const configured = layout.figures.find((entry) => entry.figureId === figureIdOf(figure, index))?.placement || 'auto'
  return configured === 'auto' ? 'before-choices' : configured
}

function figuresForPlacement(figures: QuestionFigure[], layout: QuestionLayout, placement: FigurePlacement) {
  return figures.filter((figure) => resolvedPlacement(figure, figureIndex(figure, figures), layout) === placement)
}

// figureIdOf needs the original index when a figure has no persistent id. The
// list above is already stem-only, so locate by identity instead of using the
// filtered display order in a second, inconsistent way.
function figureIndex(figure: QuestionFigure, figures: QuestionFigure[]) {
  return Math.max(figures.indexOf(figure), 0)
}

function FigureStrip({ figures, layout, side = false }: { figures: QuestionFigure[]; layout: QuestionLayout; side?: boolean }) {
  if (!figures.length) return null
  return <div className={`${side ? 'w-[42%] shrink-0' : 'my-3 flex flex-wrap gap-3'}`}>{figures.map((figure, index) => {
    const config = layout.figures.find((entry) => entry.figureId === figureIdOf(figure, figureIndex(figure, figures)))
    const alignment = config?.alignment || 'center'
    const width = side ? '100%' : `${Math.round((config?.widthRatio || .45) * 100)}%`
    return <div key={figureIdOf(figure, index)} className={`flex ${!side && alignment === 'right' ? 'ml-auto' : !side && alignment === 'center' ? 'mx-auto' : ''}`} style={{ width }}>
      {figure.path ? <img alt="题图" src={assetUrl(figure.path)} className="h-auto max-w-full object-contain" style={{maxHeight:'var(--template-figure-max-height)'}} /> : <div className="flex h-20 w-full items-center justify-center border border-dashed"><ImageIcon className="size-5 text-zinc-300" /></div>}
    </div>
  })}</div>
}

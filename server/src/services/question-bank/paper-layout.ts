export const paperLayoutDraftVersion = 1 as const
export type ChoiceLayoutOverride = 'auto' | 'four' | 'two' | 'one'
export type FigurePlacement = 'auto' | 'before-choices' | 'after-choices' | 'side-left' | 'side-right' | 'block'
export type ResolvedFigurePlacement = Exclude<FigurePlacement, 'auto'>
export type FigureAlignment = 'left' | 'center' | 'right'
export type MultiFigureLayout = 'auto' | 'row' | 'column'
export type FigureLayout = {
  figureId: string
  placement: FigurePlacement
  widthRatio?: number
  alignment?: FigureAlignment
  keepWithChoices?: boolean
}
export type ResolvedFigureLayout = {
  auto: ResolvedFigurePlacement
  override?: ResolvedFigurePlacement
  resolved: ResolvedFigurePlacement
}
export type LayoutWarningCode = 'choice-overflow' | 'figure-too-small' | 'question-split' | 'page-overflow' | 'missing-figure' | 'layout-fallback'
export type LayoutWarning = {
  code: LayoutWarningCode
  questionId: string
  figureId?: string
  page?: number
  message: string
  suggestion?: string
}
export type QuestionLayout = { relationId: string; order?: number; choiceLayout: ChoiceLayoutOverride; multiFigureLayout?: MultiFigureLayout; figures: FigureLayout[]; keepTogether?: boolean; pageBreakBefore?: boolean; answerAreaHeight?: number; answerAreaManual?: boolean; equalizedAnswerAreaHeight?: number; equalizedPageBreakBefore?: boolean; equalizedGroupId?: string; equalizedGroupSize?: 2|3; equalizedPreviousAnswerAreaHeight?: number; equalizedPreviousAnswerAreaManual?: boolean }
export type PaperLayoutDraft = { version: typeof paperLayoutDraftVersion; solutionPageStrategy?: 'auto'|'two'|'three'; questions: QuestionLayout[] }
const choices = new Set<ChoiceLayoutOverride>(['auto', 'four', 'two', 'one'])
const multiFigureLayouts = new Set<MultiFigureLayout>(['auto', 'row', 'column'])
const placements = new Set<FigurePlacement>(['auto', 'before-choices', 'after-choices', 'side-left', 'side-right', 'block'])
function finiteNumber(value: unknown, min: number, max: number) { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined }
export function normalizePaperLayoutDraft(value: unknown): PaperLayoutDraft {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const questions = (Array.isArray(raw.questions) ? raw.questions : []).flatMap((candidate): QuestionLayout[] => {
    if (!candidate || typeof candidate !== 'object') return []
    const item = candidate as Record<string, unknown>; const relationId = String(item.relationId || '').trim(); if (!relationId) return []
    const figures = (Array.isArray(item.figures) ? item.figures : []).flatMap((candidateFigure): FigureLayout[] => {
      if (!candidateFigure || typeof candidateFigure !== 'object') return []
      const figure = candidateFigure as Record<string, unknown>; const figureId = String(figure.figureId || '').trim(); if (!figureId) return []
      return [{ figureId, placement: placements.has(figure.placement as FigurePlacement) ? figure.placement as FigurePlacement : 'auto', widthRatio: finiteNumber(figure.widthRatio, .15, 1), alignment: ['left', 'center', 'right'].includes(String(figure.alignment)) ? figure.alignment as FigureLayout['alignment'] : undefined, keepWithChoices: typeof figure.keepWithChoices === 'boolean' ? figure.keepWithChoices : undefined }]
    })
    const groupSize=Number(item.equalizedGroupSize)
    const order=Number(item.order)
    return [{ relationId, order:Number.isSafeInteger(order)&&order>=0?order:undefined, choiceLayout: choices.has(item.choiceLayout as ChoiceLayoutOverride) ? item.choiceLayout as ChoiceLayoutOverride : 'auto', multiFigureLayout: multiFigureLayouts.has(item.multiFigureLayout as MultiFigureLayout) ? item.multiFigureLayout as MultiFigureLayout : 'auto', figures, keepTogether: typeof item.keepTogether === 'boolean' ? item.keepTogether : undefined, pageBreakBefore: typeof item.pageBreakBefore === 'boolean' ? item.pageBreakBefore : undefined, answerAreaHeight: finiteNumber(item.answerAreaHeight, 0, 30), answerAreaManual: item.answerAreaManual === true, equalizedAnswerAreaHeight: finiteNumber(item.equalizedAnswerAreaHeight, 0, 30), equalizedPageBreakBefore: item.equalizedPageBreakBefore === true, equalizedGroupId:String(item.equalizedGroupId||'')||undefined,equalizedGroupSize:groupSize===2||groupSize===3?groupSize:undefined,equalizedPreviousAnswerAreaHeight:finiteNumber(item.equalizedPreviousAnswerAreaHeight,0,30),equalizedPreviousAnswerAreaManual:item.equalizedPreviousAnswerAreaManual===true }]
  })
  const strategy=['two','three'].includes(String(raw.solutionPageStrategy))?raw.solutionPageStrategy as 'two'|'three':'auto'
  return { version: paperLayoutDraftVersion, solutionPageStrategy:strategy, questions }
}
export function questionLayoutFor(draft: PaperLayoutDraft | undefined, relationId: unknown) { return draft?.questions.find((question) => question.relationId === String(relationId || '')) }
export function figureLayoutFor(layout: QuestionLayout | undefined, figure: Record<string, any>) { const ids = [figure.id, figure.blockId].map((v) => String(v || '')).filter(Boolean); return layout?.figures.find((candidate) => ids.includes(candidate.figureId)) }

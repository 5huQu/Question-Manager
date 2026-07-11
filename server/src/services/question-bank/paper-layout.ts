export const paperLayoutDraftVersion = 1 as const
export type ChoiceLayoutOverride = 'auto' | 'four' | 'two' | 'one'
export type FigurePlacement = 'auto' | 'before-choices' | 'after-choices' | 'side-left' | 'side-right'
export type FigureLayout = { figureId: string; placement: FigurePlacement; widthRatio?: number; alignment?: 'left' | 'center' | 'right' }
export type QuestionLayout = { relationId: string; choiceLayout: ChoiceLayoutOverride; figures: FigureLayout[]; keepTogether?: boolean; pageBreakBefore?: boolean; answerAreaHeight?: number }
export type PaperLayoutDraft = { version: typeof paperLayoutDraftVersion; questions: QuestionLayout[] }
const choices = new Set<ChoiceLayoutOverride>(['auto', 'four', 'two', 'one'])
const placements = new Set<FigurePlacement>(['auto', 'before-choices', 'after-choices', 'side-left', 'side-right'])
function finiteNumber(value: unknown, min: number, max: number) { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined }
export function normalizePaperLayoutDraft(value: unknown): PaperLayoutDraft {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const questions = (Array.isArray(raw.questions) ? raw.questions : []).flatMap((candidate): QuestionLayout[] => {
    if (!candidate || typeof candidate !== 'object') return []
    const item = candidate as Record<string, unknown>; const relationId = String(item.relationId || '').trim(); if (!relationId) return []
    const figures = (Array.isArray(item.figures) ? item.figures : []).flatMap((candidateFigure): FigureLayout[] => {
      if (!candidateFigure || typeof candidateFigure !== 'object') return []
      const figure = candidateFigure as Record<string, unknown>; const figureId = String(figure.figureId || '').trim(); if (!figureId) return []
      return [{ figureId, placement: placements.has(figure.placement as FigurePlacement) ? figure.placement as FigurePlacement : 'auto', widthRatio: finiteNumber(figure.widthRatio, .1, 1), alignment: ['left', 'center', 'right'].includes(String(figure.alignment)) ? figure.alignment as FigureLayout['alignment'] : undefined }]
    })
    return [{ relationId, choiceLayout: choices.has(item.choiceLayout as ChoiceLayoutOverride) ? item.choiceLayout as ChoiceLayoutOverride : 'auto', figures, keepTogether: typeof item.keepTogether === 'boolean' ? item.keepTogether : undefined, pageBreakBefore: typeof item.pageBreakBefore === 'boolean' ? item.pageBreakBefore : undefined, answerAreaHeight: finiteNumber(item.answerAreaHeight, 0, 30) }]
  })
  return { version: paperLayoutDraftVersion, questions }
}
export function questionLayoutFor(draft: PaperLayoutDraft | undefined, relationId: unknown) { return draft?.questions.find((question) => question.relationId === String(relationId || '')) }
export function figureLayoutFor(layout: QuestionLayout | undefined, figure: Record<string, any>) { const ids = [figure.id, figure.blockId].map((v) => String(v || '')).filter(Boolean); return layout?.figures.find((candidate) => ids.includes(candidate.figureId)) }

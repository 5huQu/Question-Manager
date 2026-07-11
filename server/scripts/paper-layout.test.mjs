import assert from 'node:assert/strict'
import { normalizePaperLayoutDraft, questionLayoutFor, figureLayoutFor } from '../dist/services/question-bank/paper-layout.js'
assert.deepEqual(normalizePaperLayoutDraft(undefined), { version: 1, questions: [] })
const draft = normalizePaperLayoutDraft({ version: 999, questions: [{ relationId: 'rel-1', choiceLayout: 'four', figures: [{ figureId: 'fig-1', placement: 'before-choices', widthRatio: 5 }] }, { relationId: '' }] })
assert.equal(draft.version, 1); assert.equal(draft.questions.length, 1); assert.equal(draft.questions[0].figures[0].widthRatio, 1)
assert.equal(questionLayoutFor(draft, 'rel-1')?.choiceLayout, 'four'); assert.equal(figureLayoutFor(draft.questions[0], { id: 'fig-1' })?.placement, 'before-choices')
const fallback = normalizePaperLayoutDraft({ questions: [{ relationId: 'q', choiceLayout: 'bad', figures: [{ figureId: 'f', placement: 'bad' }] }] })
assert.equal(fallback.questions[0].choiceLayout, 'auto'); assert.equal(fallback.questions[0].figures[0].placement, 'auto')
console.log('paper layout tests passed')

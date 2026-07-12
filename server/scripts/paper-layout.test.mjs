import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizePaperLayoutDraft, questionLayoutFor, figureLayoutFor } from '../dist/services/question-bank/paper-layout.js'
import { parseWorksheetQuestionTelemetry, worksheetTelemetryWarnings } from '../dist/utils/worksheet-figures.js'
assert.deepEqual(normalizePaperLayoutDraft(undefined), { version: 1, questions: [] })
const draft = normalizePaperLayoutDraft({ version: 999, questions: [{ relationId: 'rel-1', choiceLayout: 'four', figures: [{ figureId: 'fig-1', placement: 'block', widthRatio: 5, alignment: 'center', keepWithChoices: true }] }, { relationId: '' }] })
assert.equal(draft.version, 1); assert.equal(draft.questions.length, 1); assert.equal(draft.questions[0].figures[0].widthRatio, 1)
assert.equal(questionLayoutFor(draft, 'rel-1')?.choiceLayout, 'four'); assert.equal(figureLayoutFor(draft.questions[0], { id: 'fig-1' })?.placement, 'block')
assert.equal(draft.questions[0].figures[0].keepWithChoices, true)
const narrow = normalizePaperLayoutDraft({ questions: [{ relationId: 'q2', choiceLayout: 'auto', figures: [{ figureId: 'f2', widthRatio: 0.01 }] }] })
assert.equal(narrow.questions[0].figures[0].widthRatio, 0.15)
const fallback = normalizePaperLayoutDraft({ questions: [{ relationId: 'q', choiceLayout: 'bad', figures: [{ figureId: 'f', placement: 'bad' }] }] })
assert.equal(fallback.questions[0].choiceLayout, 'auto'); assert.equal(fallback.questions[0].figures[0].placement, 'auto')

const telemetryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qbank-layout-telemetry-'))
const logPath = path.join(telemetryDir, 'sample.log')
fs.writeFileSync(logPath, [
  'QBANKQUESTION phase=start id=rel-1 page=1 pagetotal=100.0pt pagegoal=700.0pt',
  'QBANKQUESTION phase=end id=rel-1 page=2 pagetotal=710.5pt pagegoal=700.0pt',
].join('\n'))
const questionTelemetry = parseWorksheetQuestionTelemetry(logPath)
assert.deepEqual(questionTelemetry, [{ id: 'rel-1', startPage: 1, endPage: 2, endPageTotal: 710.5, pageGoal: 700 }])
const warnings = worksheetTelemetryWarnings(questionTelemetry, [{ id: 'paper-qrel-1-fig-stem', pageTotal: 650, pageGoal: 700, height: 80, depth: 0, width: .24 }], new Map([['paper-qrel-1-fig-stem', { id: 'paper-qrel-1-fig-stem', sourcePath: '', outputName: '', defaultWidth: .3, minWidth: .24 }]]))
assert.deepEqual(new Set(warnings.map((warning) => warning.code)), new Set(['question-split', 'page-overflow', 'figure-too-small']))
assert.equal(warnings.every((warning) => warning.questionId && warning.message && warning.suggestion), true)
fs.rmSync(telemetryDir, { recursive: true, force: true })
console.log('paper layout tests passed')

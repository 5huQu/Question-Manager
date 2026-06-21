import { parseJson } from './json.js'
import { nowIso } from './ids.js'
import { db } from '../db/connection.js'
import type { QuestionRow, RichBlock, RichInline } from '../types/index.js'

// ---------------------------------------------------------------------------
// Choice marker normalization & detection
// ---------------------------------------------------------------------------

export function normalizeChoiceMarkers(value: string) {
  const source = String(value || '')
  const lineMatches = Array.from(source.matchAll(/(?:^|\n)[ \t]*([A-D])\s*[.．、:：]\s*/g))
  if (lineMatches.length >= 4) return source
  let markerCount = 0
  const marked = source.replace(/(?<![A-Za-z0-9])([A-D])\s*[.．、:：]\s*/g, (match, label: string, offset: number) => {
    markerCount += 1
    return `${offset === 0 ? '' : '\n'}${label}. `
  })
  return markerCount >= 4 ? marked : source
}

export function hasFourChoiceOptions(value: string) {
  const normalized = normalizeChoiceMarkers(value)
  const matches = Array.from(normalized.matchAll(/(?:^|\n)[ \t]*([A-D])\s*[.．、:：]\s*/g))
  if (matches.length < 4) return false
  return matches.slice(0, 4).map((match) => match[1]).join('') === 'ABCD'
}

export function selectedChoiceLetters(answer: string) {
  const cleaned = String(answer || '')
    .replace(/【?答案】?/g, '')
    .replace(/正确选项|选项|故选|答案为/g, '')
    .toUpperCase()
  const letters = new Set<string>()
  for (const match of cleaned.matchAll(/[A-D]+/g)) {
    for (const letter of match[0]) letters.add(letter)
  }
  return letters
}

export function hasChoiceAnswerCue(stem: string, answer: string) {
  return selectedChoiceLetters(answer).size > 0 && /[（(]\s*(?:　|\s|\\quad)*[）)]|选择|下列|则/.test(stem)
}

export function hasOpenEndedCue(stem: string, answer: string) {
  return /(?:^|[^\d])[(（]\s*[1-9]\s*[)）]/.test(stem)
    || /(?:^|[^\d])[(（]\s*[1-9]\s*[)）]/.test(answer)
    || /证明见解析|答案见解析|过程见解析|证明[:：]|求证|求面|求.*方程/.test(`${stem}\n${answer}`)
}

export function hasBlankCue(stem: string) {
  return /_{2,}|____|填空|=\s*$/.test(stem)
}

// ---------------------------------------------------------------------------
// Type inference & normalization
// ---------------------------------------------------------------------------

export function inferQuestionType(stem: string, answer: string, fallback = '解答题') {
  if (hasFourChoiceOptions(stem)) {
    const selected = selectedChoiceLetters(answer)
    if (!selected.size) return '单选题'
    return selected.size > 1 ? '多选题' : '单选题'
  }
  if (hasOpenEndedCue(stem, answer)) return '解答题'
  if (hasBlankCue(stem)) return '填空题'
  if (hasChoiceAnswerCue(stem, answer)) {
    const selected = selectedChoiceLetters(answer)
    if (!selected.size) return '单选题'
    return selected.size > 1 ? '多选题' : '单选题'
  }
  const selected = selectedChoiceLetters(answer)
  if (selected.size > 0 && selected.size <= 4) return selected.size > 1 ? '多选题' : '单选题'
  return fallback
}

function normalizeQuestionType(value: string, stem = '', answer = '') {
  const raw = String(value || '').trim()
  if ((/单选|单项选择|多选|多项选择|选择/.test(raw)) && !hasFourChoiceOptions(stem) && hasOpenEndedCue(stem, answer)) return '解答题'
  if (/多选|多项选择/.test(raw)) return '多选题'
  if (/单选|单项选择/.test(raw)) return '单选题'
  if (/填空/.test(raw)) return '填空题'
  if (/解答|计算|证明|应用/.test(raw)) return '解答题'
  if (!raw || raw === 'OCR题' || raw === '未设题型') return inferQuestionType(stem, answer)
  if (/选择/.test(raw)) return inferQuestionType(stem, answer, '单选题')
  return raw
}

// ---------------------------------------------------------------------------
// Sorting & display helpers
// ---------------------------------------------------------------------------

function questionTypeOrder(value: string) {
  const type = normalizeQuestionType(value)
  if (type === '单选题') return 1
  if (type === '多选题') return 2
  if (type === '填空题') return 3
  if (type === '解答题') return 4
  return 9
}

function questionTypeLabel(value: string) {
  const type = normalizeQuestionType(value)
  if (type === '单选题') return '单选题'
  if (type === '多选题') return '多选题'
  if (type === '填空题') return '填空题'
  if (type === '解答题') return '解答题'
  return type ? '其他题型' : ''
}

// ---------------------------------------------------------------------------
// Text cleaning helpers
// ---------------------------------------------------------------------------

const semanticExerciseLabelPattern = /^\s*(?:[【［\[]\s*)?(?:第\s*)?(?:典例|例题|变式|即学即练|即学即练习|课堂练习|限时训练|课后训练|巩固训练|能力提升)\s*(?:\d+|[一二三四五六七八九十]+)?(?:\s*[-—–_·：:、.．]\s*(?:\d+|[一二三四五六七八九十]+))?\s*(?:题)?\s*(?:[】］\]]\s*)?/u
const semanticQuestionNoPattern = /^\s*(?:第\s*)?(?:典例|例题|变式|即学即练|即学即练习|课堂练习|限时训练|课后训练|巩固训练|能力提升)\s*((?:\d+|[一二三四五六七八九十]+)(?:\s*[-—–_]\s*(?:\d+|[一二三四五六七八九十]+))?)\s*(?:题)?\s*$/u

function stripSemanticExerciseLabel(value: string) {
  return String(value || '').replace(semanticExerciseLabelPattern, '').trimStart()
}

function cleanQuestionNoLabel(value: string) {
  const raw = String(value || '').trim()
  const semanticMatch = raw.match(semanticQuestionNoPattern)
  if (semanticMatch?.[1]) return semanticMatch[1].replace(/\s+/g, '')
  const cleaned = stripSemanticExerciseLabel(raw).replace(/^\s*第\s*/, '').replace(/\s*题\s*$/u, '').trim()
  return cleaned || raw
}

export function stripLeadingQuestionNo(value: string, questionNo = '') {
  const text = String(value || '').trimStart()
  const escaped = String(questionNo || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (escaped) {
    const exactPattern = new RegExp(`^(?:第\\s*)?${escaped}\\s*(?:题)?\\s*[.．、:：）)]\\s*`)
    const exactCleaned = text.replace(exactPattern, '')
    if (exactCleaned !== text) return exactCleaned.trimStart()
  }
  return text
    .replace(/^第\s*\d{1,3}\s*题\s*/, '')
    .replace(/^\d{1,3}\s*(?:题)?\s*[.．、:：）)]\s*/, '')
    .trimStart()
}

// ---------------------------------------------------------------------------
// Section / collection helpers
// ---------------------------------------------------------------------------

function sectionOrdinal(index: number) {
  const numerals = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  return numerals[index] || String(index)
}

function collectionSectionNames(rows: Array<Pick<QuestionRow, 'question_type' | 'stem_markdown' | 'answer_text'>>) {
  const names = new Map<string, string>()
  for (const row of rows) {
    const type = normalizeQuestionType(
      row.question_type,
      row.stem_markdown,
      row.answer_text,
    )
    if (!type || names.has(type)) continue
    const label = questionTypeLabel(type)
    if (!label) continue
    names.set(type, `${sectionOrdinal(names.size + 1)}、${label}`)
  }
  return names
}

// ---------------------------------------------------------------------------
// Legacy repair
// ---------------------------------------------------------------------------

function repairLegacyQuestionTypes() {
  const rows = db.prepare(`
    SELECT id, question_type, stem_markdown, answer_text
    FROM question_bank_items
  `).all() as Array<Pick<QuestionRow, 'id' | 'question_type' | 'stem_markdown' | 'answer_text'>>
  const update = db.prepare('UPDATE question_bank_items SET question_type = ?, updated_at = ? WHERE id = ?')
  const now = nowIso()
  for (const row of rows) {
    const nextType = normalizeQuestionType(
      row.question_type,
      row.stem_markdown,
      row.answer_text,
    )
    if (!nextType || nextType === row.question_type) continue
    update.run(nextType, now, row.id)
  }
}

// ---------------------------------------------------------------------------
// Paper export helpers
// ---------------------------------------------------------------------------

interface MappedQuestion {
  questionNo?: string
  questionType: string
  stemMarkdown: string
  answerText: string
}

function paperQuestionNo(item: MappedQuestion, index: number): number {
  const parsed = Number.parseInt(cleanQuestionNoLabel(item.questionNo || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : index + 1
}

function exportQuestionType(item: MappedQuestion, _paperNo: number): string {
  return normalizeQuestionType(item.questionType, item.stemMarkdown, item.answerText)
}

export {
  normalizeQuestionType,
  questionTypeOrder,
  questionTypeLabel,
  sectionOrdinal,
  collectionSectionNames,
  paperQuestionNo,
  exportQuestionType,
  repairLegacyQuestionTypes,
}

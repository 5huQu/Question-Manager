export type QuestionNumberMatch = {
  questionNo: string
  raw: string
  start: number
  contentStart: number
  lineStart: number
}

function normalizeDigits(value: string) {
  return value.replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - '０'.charCodeAt(0)))
}

export function normalizeDetectedQuestionNo(value: unknown) {
  const normalized = normalizeDigits(String(value || ''))
    .replace(/^\s*第\s*/, '')
    .replace(/\s*题\s*$/, '')
    .replace(/[（()）.．、:：\s]/g, '')
  const parsed = Number.parseInt(normalized, 10)
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : normalized
}

import { getParserConfig } from './parser-config.js'
import type { ImportFlowV2ParserConfig } from './default-parser-config.js'

function matchLine(line: string, patterns: string[]) {
  for (const pattern of patterns) {
    const match = new RegExp(pattern, 'i').exec(line)
    if (match && /^[ \t#]*$/.test(line.slice(0, match.index))) return { raw: match[0], questionNo: match[1] || '' }
  }
  return null
}

export function detectQuestionNumbers(markdown: string, config: ImportFlowV2ParserConfig = getParserConfig()): QuestionNumberMatch[] {
  const matches: QuestionNumberMatch[] = []
  const source = String(markdown || '')
  const lines = source.split(/(?<=\n)/)
  let offset = 0
  let regularCount = 0
  for (const line of lines) {
    const found = matchLine(line, config.primaryQuestionPatterns)
    if (!found) { offset += line.length; continue }
    const markerIndex = line.indexOf(found.raw)
    const lineStart = offset + Math.max(0, markerIndex)
    const questionNo = normalizeDetectedQuestionNo(found.questionNo)
    matches.push({
      questionNo,
      raw: found.raw.trim(),
      start: lineStart,
      contentStart: lineStart + found.raw.length,
      lineStart,
    })
    regularCount += 1
    offset += line.length
  }
  if (regularCount || !config.allowParenthesizedNumberAsPrimary) return matches
  offset = 0
  for (const line of lines) {
    const found = matchLine(line, config.subQuestionPatterns)
    const parenNo = found?.questionNo || /[（(]\s*([0-9０-９]{1,3})\s*[)）]/.exec(found?.raw || '')?.[1]
    if (!found || !parenNo || !/^[\s#]*[（(]/.test(line)) { offset += line.length; continue }
    const markerIndex = line.indexOf(found.raw)
    const lineStart = offset + Math.max(0, markerIndex)
    matches.push({ questionNo: normalizeDetectedQuestionNo(parenNo), raw: found.raw.trim(), start: lineStart, contentStart: lineStart + found.raw.length, lineStart })
    offset += line.length
  }
  return matches
}

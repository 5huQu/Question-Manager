import type { RichInline, RichBlock } from '../types/index.js'

export function buildSearchText(stemMarkdown: string, answerText: string, analysisMarkdown: string, extra: string[] = []) {
  return [stemMarkdown, answerText, analysisMarkdown, ...extra]
    .filter(Boolean)
    .join('\n')
}

export function parseTimestampMs(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw) return 0
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function questionPlainText(value: string) {
  return String(value || '').replace(/\r\n?/g, '\n').trim()
}

export function normalizeSimilarityText(value: string) {
  return questionPlainText(value)
    .replace(/\$\$[\s\S]*?\$\$/g, '公式')
    .replace(/\$[\s\S]*?\$/g, '公式')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/[`*_~>#|\[\](){}，。！？；：、,.!?;:\s]+/g, '')
    .replace(/[A-D][.．、]/g, '')
    .toLowerCase()
}

export function textBigrams(value: string) {
  const text = normalizeSimilarityText(value)
  if (text.length < 2) return new Set(text ? [text] : [])
  const grams = new Set<string>()
  for (let index = 0; index < text.length - 1; index += 1) {
    grams.add(text.slice(index, index + 2))
  }
  return grams
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0
  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection += 1
  }
  return intersection / (a.size + b.size - intersection)
}

export function stemPreview(value: string) {
  return questionPlainText(value)
    .replace(/\$\$?[^$]+\$\$?/g, '[公式]')
    .replace(/[#*_~`>|\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96)
}

export function difficultyLabel10(score: number) {
  if (!score) return ''
  if (score <= 3) return '基础'
  if (score <= 6) return '中等'
  if (score <= 8) return '较难'
  return '压轴'
}

export function normalizeDifficultyScore10(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(parsed, 10))
}

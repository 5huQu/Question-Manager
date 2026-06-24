import { normalizeRichBlocks } from '@/components/RichContent'
import type { ParsedChoiceQuestion, QuestionFigure, QuestionItem } from '@/types'
import { clamp01, normalizeDisplayRect, parseBBox } from './crop'

export function parseChoiceQuestion(value: string): ParsedChoiceQuestion | null {
  const normalized = normalizeChoiceMarkers(value)
  const matches = Array.from(normalized.matchAll(/(?:^|\n)[ \t]*([A-D])\s*[.．、:：]\s*/g))
  if (matches.length < 4) return null
  const firstFour = matches.slice(0, 4)
  if (firstFour.map((match) => match[1]).join('') !== 'ABCD') return null
  let remainder = ''
  const options = firstFour.map((match, index) => {
    const next = firstFour[index + 1]
    const start = Number(match.index) + match[0].length
    let end = next?.index ?? normalized.length
    if (!next) {
      const tail = normalized.slice(start)
      const boundary = tail.search(/\n{2,}(?=(?:参考答案|解析)[:：]|!\[[^\]]*\]\(|##\s|\*\*\d+\.\*\*)/)
      if (boundary >= 0) {
        end = start + boundary
        remainder = normalized.slice(end).trim()
      }
    }
    return {
      label: match[1],
      content: normalized.slice(start, end).trim(),
    }
  })
  if (options.some((option) => !option.content)) return null
  return {
    stem: normalized.slice(0, Number(firstFour[0].index)).trimEnd(),
    options,
    remainder,
  }
}

export function stripLeadingQuestionNo(value: string) {
  return String(value || '')
    .trimStart()
    .replace(/^第\s*\d{1,3}\s*题\s*/, '')
    .replace(/^\d{1,3}\s*(?:题)?\s*[.．、:：）)]\s*/, '')
    .trimStart()
}

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

export function label(status: string) {
  const labels: Record<string, string> = { idle: '未加入OCR', queued: '排队中', running: '运行中', succeeded: '已完成', failed: '失败', pending: '待复核', submitted: '已提交', pending_review: '待复核', ready_for_ocr: '通过', awaiting_manual_annotation: '等待标注' }
  return labels[status] || status
}

export function materialTypeLabel(value = 'unknown') {
  return { exam: '试卷', lecture: '讲义', unknown: '未确认' }[value] || value
}

export function fileRoleLabel(value = 'unknown') {
  return { full: '解析版一体', questions: '原卷', solutions: '解析文件', unknown: '未确认' }[value] || value
}

export function workflowModeLabel(value = 'single') {
  return { single: '单文件链路', separated_exam: '原卷+解析分离' }[value] || value
}

export function workflowStatusLabel(value = 'ready') {
  return {
    ready: '可处理',
    needs_classification: '需确认分类',
    processing: '处理中',
    ready_for_bank: '可待入库',
    needs_review: '需处理',
  }[value] || value
}

export function bankLabel(status: string) {
  return { blocked: '未入库', ready: '可入库', banked: '已入库' }[status] || status
}

export function difficultyLabel(score: number) {
  return { 1: '基础', 2: '较易', 3: '中等', 4: '较难', 5: '很难' }[score] || '未评级'
}

export function difficultyLabelFromScore10(score: number) {
  if (!score) return ''
  if (score <= 3) return '基础'
  if (score <= 6) return '中等'
  if (score <= 8) return '较难'
  return '压轴'
}

export function difficultyLabel10(item: Pick<QuestionItem, 'difficultyScore' | 'difficultyScore10' | 'difficultyLabel'>) {
  if (item.difficultyScore10) return `${item.difficultyLabel || difficultyLabelFromScore10(item.difficultyScore10)} ${item.difficultyScore10}/10`
  return difficultyLabel(item.difficultyScore)
}

export function difficultyBadgeVariant(item: Pick<QuestionItem, 'difficultyScore' | 'difficultyScore10'>): 'default' | 'success' | 'warning' | 'danger' {
  const legacyScore: string = typeof item.difficultyScore === 'string' ? item.difficultyScore : ''
  if ((item.difficultyScore10 ?? 0) >= 8 || legacyScore === 'hard' || legacyScore === 'expert') return 'danger'
  if ((item.difficultyScore10 ?? 0) >= 5 || legacyScore === 'medium') return 'warning'
  return (item.difficultyScore10 ?? 0) >= 3 ? 'default' : 'success'
}

export function displaySource(value: string) {
  const clean = value.replace(/^question_assets\//, '').split('/').pop()?.replace(/\.[^.]+$/, '')
  return clean || value || '来源待补充'
}

export function statusVariant(status: string): 'default' | 'success' | 'warning' | 'danger' {
  if (['succeeded', 'ready_for_ocr'].includes(status)) return 'success'
  if (['running', 'queued', 'processing', 'awaiting_manual_annotation'].includes(status)) return 'warning'
  if (status === 'failed') return 'danger'
  return 'default'
}

export function workflowStatusVariant(status: string): 'default' | 'success' | 'warning' | 'danger' {
  if (['ready', 'ready_for_bank'].includes(status)) return 'success'
  if (['needs_review', 'needs_classification'].includes(status)) return 'warning'
  if (status === 'processing') return 'warning'
  return 'default'
}

export function splitTags(value: string) {
  return value.split(/[,，、;/；\n]+/).map((item) => item.trim()).filter(Boolean)
}

export function assetUrl(value: string) {
  return `/assets/${value.replace(/^question_assets\//, '').replace(/^\/+/, '')}`
}

export function figuresByUsage(figures: QuestionFigure[], usage: string) {
  return figures.filter((figure) => String(figure.usage || 'stem') === usage)
}

export function figureUsageLabel(usage: string) {
  return { stem: '题干图', analysis: '解析图', options: '选项图' }[usage] || usage || '题图'
}

export function reviewFigureUsage(figure: Record<string, unknown> | undefined) {
  const usage = String(figure?.usage || figure?.category || 'stem')
  return ['stem', 'analysis', 'options'].includes(usage) ? usage : 'stem'
}

export function isFormulaSuspectFigure(figure: Record<string, unknown> | undefined) {
  return Boolean(figure?.formula_suspect ?? figure?.formulaSuspect)
}

export function formulaSuspectTitle(figure: Record<string, unknown> | undefined) {
  const reason = String(figure?.formula_suspect_reason ?? figure?.formulaSuspectReason ?? '')
  return reason ? `疑似公式图：${reason}` : '疑似公式图'
}

export function reviewFigureUsageInfo(figure: Record<string, unknown> | undefined) {
  const usage = reviewFigureUsage(figure)
  if (usage === 'analysis') {
    return { label: '解析图', labelClass: 'bg-sky-600', boxClass: 'border-sky-500 bg-sky-100/20' }
  }
  if (usage === 'options') {
    const option = String(figure?.optionLabel || '').toUpperCase()
    return { label: option ? `选项图${option}` : '选项图', labelClass: 'bg-violet-600', boxClass: 'border-violet-500 bg-violet-100/20' }
  }
  return { label: '题干图', labelClass: 'bg-red-500', boxClass: 'border-red-500 bg-rose-50/20' }
}

export function figureCaption(figure: QuestionFigure, index: number) {
  const usage = String(figure.usage || 'stem')
  const option = usage === 'options' && figure.optionLabel ? ` ${String(figure.optionLabel).toUpperCase()}` : ''
  return `${figureUsageLabel(usage)}${option} #${index + 1}`
}

export function figureAlt(figure: QuestionFigure, index: number) {
  return figureCaption(figure, index)
}

export function figureOverlayStyle(figure: QuestionFigure, naturalSize: { width: number; height: number }) {
  const bbox = parseBBox(figure.bbox)
  if (!bbox || naturalSize.width <= 0 || naturalSize.height <= 0) return null
  return {
    left: `${clamp01(bbox.x / naturalSize.width) * 100}%`,
    top: `${clamp01(bbox.y / naturalSize.height) * 100}%`,
    width: `${clamp01(bbox.width / naturalSize.width) * 100}%`,
    height: `${clamp01(bbox.height / naturalSize.height) * 100}%`,
  }
}

export function displayRectFromFigure(figure: QuestionFigure, naturalSize: { width: number; height: number }, displaySize: { width: number; height: number }) {
  const bbox = parseBBox(figure.bbox)
  if (!bbox || naturalSize.width <= 0 || naturalSize.height <= 0 || displaySize.width <= 0 || displaySize.height <= 0) return null
  return normalizeDisplayRect({
    x: (bbox.x / naturalSize.width) * displaySize.width,
    y: (bbox.y / naturalSize.height) * displaySize.height,
    width: (bbox.width / naturalSize.width) * displaySize.width,
    height: (bbox.height / naturalSize.height) * displaySize.height,
  }, displaySize)
}

export function choiceLabelsForQuestion(question: QuestionItem) {
  if (!isChoiceQuestionType(question.questionType)) return []
  const choiceBlock = normalizeRichBlocks(question.problemBlocks).find((block) => block.type === 'choices')
  return choiceBlock?.type === 'choices' ? choiceBlock.options.map((option) => option.label) : ['A', 'B', 'C', 'D']
}

export function isChoiceQuestionType(value: string) {
  return /选择|单选|多选/.test(String(value || ''))
}

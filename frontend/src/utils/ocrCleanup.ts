import type { OcrProgress } from '@/types'

type CleanupRecord = NonNullable<NonNullable<OcrProgress['formatCleanup']>['records']>[number]

export function cleanupQuestionLabel(record: CleanupRecord) {
  const key = record.draft || record.id || ''
  const match = key.match(/CUT_(\d+)/)
  if (!match) return '未知题目'
  return `第 ${Number(match[1])} 题`
}

export function cleanupFieldLabel(value = '') {
  if (value === 'problem_text') return '题干'
  if (value === 'analysis') return '解析'
  if (value === 'answer') return '答案'
  return value || '内容'
}

export function cleanupCodeLabel(value = '') {
  if (value === 'frontend_katex_error') return '公式渲染失败'
  if (value === 'katex_parse_error') return '公式语法错误'
  if (value === 'math_delimiter_unclosed') return '数学定界符未闭合'
  if (value === 'raw_latex_outside_math') return '公式没有包在数学定界符里'
  if (value === 'format_cleanup_worker_failed') return '清洗任务异常'
  return value || '格式异常'
}

export function cleanupReasonLabel(value = '') {
  const [field, code] = value.split(':')
  if (code) return `${cleanupFieldLabel(field)}：${cleanupCodeLabel(code)}`
  return cleanupCodeLabel(field)
}

export function cleanupSnippet(value = '') {
  const text = String(value || '')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= 520) return text
  return truncateSnippetOutsideMath(text, 520)
}

export function truncateSnippetOutsideMath(value: string, maxLength: number) {
  let inInlineMath = false
  let inDisplayMath = false
  let mathStart = -1
  let lastSoftBreak = -1
  for (let index = 0; index < Math.min(value.length, maxLength); index += 1) {
    const char = value[index]
    if ((char === ' ' || /[，。；：,.!?]/.test(char)) && !inInlineMath && !inDisplayMath) {
      lastSoftBreak = index
    }
    if (char !== '$' || (index > 0 && value[index - 1] === '\\')) continue
    if (value[index + 1] === '$') {
      if (!inInlineMath) {
        inDisplayMath = !inDisplayMath
        mathStart = inDisplayMath ? index : -1
      }
      index += 1
      continue
    }
    if (!inDisplayMath) {
      inInlineMath = !inInlineMath
      mathStart = inInlineMath ? index : -1
    }
  }
  let cut = maxLength
  if ((inInlineMath || inDisplayMath) && mathStart > 0) {
    cut = mathStart
  } else if (lastSoftBreak > maxLength * 0.75) {
    cut = lastSoftBreak
  }
  return `${value.slice(0, Math.max(1, cut)).trim()}…`
}

export function cleanupIssueRecords(report: OcrProgress['formatCleanup']) {
  return (report?.records ?? []).filter((record) => {
    return Boolean(record.needsModelCleanup || record.modelError || record.classificationError || record.renderErrors?.length)
  })
}

export function isFormatReviewStatusMessage(value = '') {
  const message = String(value || '')
  if (!message) return false
  const isFormatReview = message.includes('格式清洗') || message.includes('模型清洗') || message.includes('格式问题')
  const isStatusSummary = message.includes('仍有') || message.includes('需要检查') || message.includes('人工修正')
  return isFormatReview && isStatusSummary
}

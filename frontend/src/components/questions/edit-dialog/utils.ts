import { normalizeRichBlocks, richBlocksPlainText } from '@/components/RichContent'
import type { QuestionItem } from '@/types'
import { assetUrl, difficultyLabelFromScore10, splitTags } from '@/utils/questionDisplay'
import { draftAnalysisText, draftAnswerText, draftProblemText, paragraphBlocksFromText } from '@/utils/jsonCleanup'

export function analysisCopyGroupCount(count: number) {
  if (count <= 0) return 0
  if (count <= 4) return count
  if (count <= 6) return 3
  return 4
}

export function splitIntoBalancedGroups<T>(items: T[], groupCount: number) {
  if (!items.length || groupCount <= 0) return []
  const safeGroupCount = Math.min(items.length, groupCount)
  return Array.from({ length: safeGroupCount }, (_, index) => {
    const start = Math.floor((index * items.length) / safeGroupCount)
    const end = Math.floor(((index + 1) * items.length) / safeGroupCount)
    return items.slice(start, end)
  }).filter((group) => group.length)
}

export function editableJsonFromDraft(source: Partial<QuestionItem>) {
  return JSON.stringify({
    problem_text: draftProblemText(source),
    answer: draftAnswerText(source),
    analysis: draftAnalysisText(source),
    stage: source.stage || '',
    question_type: source.questionType || '',
    knowledge_points: source.knowledgePoints || [],
    solution_methods: source.solutionMethods || [],
    difficulty_score_10: source.difficultyScore10 || '',
    difficulty_label: source.difficultyLabel || '',
  }, null, 2)
}

export function normalizedJsonText(value: string) {
  const stripped = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const firstObject = stripped.indexOf('{')
  const firstArray = stripped.indexOf('[')
  const startCandidates = [firstObject, firstArray].filter((index) => index >= 0)
  const start = startCandidates.length ? Math.min(...startCandidates) : -1
  if (start < 0) return stripped
  const end = Math.max(stripped.lastIndexOf('}'), stripped.lastIndexOf(']'))
  return end > start ? stripped.slice(start, end + 1) : stripped
}

export function normalizeJsonSyntaxQuotes(value: string) {
  let result = ''
  let inString = false
  let escaped = false
  let quoteKind: 'ascii' | 'curly' = 'ascii'
  for (const char of value) {
    if (!inString) {
      if (char === '"') {
        inString = true
        quoteKind = 'ascii'
        result += char
        continue
      }
      if (char === '“') {
        inString = true
        quoteKind = 'curly'
        result += '"'
        continue
      }
      result += char === '”' ? '"' : char
      continue
    }
    if (escaped) {
      result += char
      escaped = false
      continue
    }
    if (char === '\\') {
      result += char
      escaped = true
      continue
    }
    if (quoteKind === 'ascii' && char === '"') {
      inString = false
      result += char
      continue
    }
    if (quoteKind === 'curly' && char === '”') {
      inString = false
      result += '"'
      continue
    }
    result += char
  }
  return result
}

export function normalizeAiJsonText(value: string) {
  return normalizeJsonSyntaxQuotes(normalizedJsonText(value))
    .replace(/[‘’]/g, "'")
    .replace(/，(?=\s*["}\]])/g, ',')
    .replace(/：(?=\s*["{\[])/g, ':')
    .replace(/,\s*([}\]])/g, '$1')
}

export function escapeJsonStringControlChars(value: string) {
  let result = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    const next = value[index + 1]
    if (!inString) {
      result += char
      if (char === '"') inString = true
      continue
    }
    if (escaped) {
      result += char
      escaped = false
      continue
    }
    if (char === '\\') {
      if (next && !'"\\/bfnrtu'.includes(next)) {
        result += '\\\\'
      } else {
        result += char
        escaped = true
      }
      continue
    }
    if (char === '"') {
      inString = false
      result += char
      continue
    }
    if (char === '\n') {
      result += '\\n'
      continue
    }
    if (char === '\r') {
      result += '\\r'
      continue
    }
    if (char === '\t') {
      result += '\\t'
      continue
    }
    result += char
  }
  return result
}

export function parseAiJsonText(value: string) {
  const normalized = normalizeAiJsonText(value)
  try {
    return JSON.parse(normalized)
  } catch {
    return JSON.parse(escapeJsonStringControlChars(normalized))
  }
}

export function textArray(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') return splitTags(value)
  return undefined
}

export function draftPatchFromJsonText(value: string, options: { clean?: boolean } = {}) {
  const parsed = parseAiJsonText(value)
  const source = Array.isArray(parsed?.questions) ? parsed.questions[0] : parsed
  if (!source || typeof source !== 'object') throw new Error('JSON 不是对象')
  const next: Partial<QuestionItem> = {}
  const stem = source.problem_blocks ?? source.problemBlocks ?? source.problem_text
  const answer = source.answer_blocks ?? source.answerBlocks ?? source.answer
  const analysis = source.analysis_blocks ?? source.analysisBlocks ?? source.analysis
  const knowledgePoints = textArray(source.knowledge_points ?? source.knowledgePoints)
  const solutionMethods = textArray(source.solution_methods ?? source.solutionMethods)
  const stage = source.stage
  const questionType = source.question_type ?? source.questionType
  const score = source.difficulty_score_10 ?? source.difficultyScore10
  if (Array.isArray(stem)) {
    next.problemBlocks = normalizeRichBlocks(stem)
    next.stemMarkdown = richBlocksPlainText(next.problemBlocks)
  } else if (typeof stem === 'string') {
    next.stemMarkdown = stem
    next.problemBlocks = paragraphBlocksFromText(stem)
  }
  if (Array.isArray(answer)) {
    next.answerBlocks = normalizeRichBlocks(answer)
    next.answerText = richBlocksPlainText(next.answerBlocks)
  } else if (typeof answer === 'string') {
    next.answerText = answer
    next.answerBlocks = paragraphBlocksFromText(answer)
  }
  if (Array.isArray(analysis)) {
    next.analysisBlocks = normalizeRichBlocks(analysis)
    next.analysisMarkdown = richBlocksPlainText(next.analysisBlocks)
  } else if (typeof analysis === 'string') {
    next.analysisMarkdown = analysis
    next.analysisBlocks = paragraphBlocksFromText(analysis)
  }
  if (knowledgePoints) next.knowledgePoints = knowledgePoints
  if (solutionMethods) next.solutionMethods = solutionMethods
  if (typeof stage === 'string') next.stage = stage
  if (typeof questionType === 'string') next.questionType = questionType
  if (score !== undefined && score !== null && String(score).trim()) {
    next.difficultyScore10 = Number(score)
    next.difficultyLabel = String(source.difficulty_label ?? source.difficultyLabel ?? difficultyLabelFromScore10(Number(score)))
  } else if (typeof (source.difficulty_label ?? source.difficultyLabel) === 'string') {
    next.difficultyLabel = String(source.difficulty_label ?? source.difficultyLabel)
  }
  if (typeof (source.source_title ?? source.sourceTitle) === 'string') next.sourceTitle = String(source.source_title ?? source.sourceTitle)
  if (typeof (source.chapter) === 'string') next.chapter = String(source.chapter)
  if (!Object.keys(next).length) {
    return { next, status: 'JSON 有效，但没有识别到可替换字段。' }
  }
  return { next, status: `${options.clean ? '已合并并替换' : '已识别并替换'} ${Object.keys(next).length} 个字段。` }
}

export async function fetchImageAsPngBlob(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`图片读取失败：HTTP ${response.status}`)
  const blob = await response.blob()
  if (blob.type === 'image/png') return blob
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建图片画布。')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((pngBlob) => pngBlob ? resolve(pngBlob) : reject(new Error('图片转 PNG 失败。')), 'image/png')
  })
}

export async function composeSegmentImagesAsPngBlob(urls: string[]) {
  if (!urls.length) throw new Error('没有可复制的分块图。')
  if (urls.length === 1) return fetchImageAsPngBlob(urls[0])
  const bitmaps = await Promise.all(urls.map(async (url) => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`图片读取失败：HTTP ${response.status}`)
    return createImageBitmap(await response.blob())
  }))
  const gap = 16
  const padding = 12
  const width = Math.max(...bitmaps.map((bitmap) => bitmap.width))
  const height = bitmaps.reduce((sum, bitmap) => sum + bitmap.height, 0) + gap * (bitmaps.length - 1) + padding * 2
  const canvas = document.createElement('canvas')
  canvas.width = width + padding * 2
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建合成画布。')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  let y = padding
  bitmaps.forEach((bitmap) => {
    context.drawImage(bitmap, padding, y)
    y += bitmap.height + gap
    bitmap.close()
  })
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((pngBlob) => pngBlob ? resolve(pngBlob) : reject(new Error('分块图合成失败。')), 'image/png')
  })
}

export async function copyImageToClipboard(url: string, setStatus: (status: string) => void, labelText = '题图') {
  setStatus(`正在复制${labelText}...`)
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      throw new Error('当前浏览器不支持直接复制图片。')
    }
    const pngBlob = fetchImageAsPngBlob(url)
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
    setStatus(`已复制${labelText}到剪贴板。`)
  } catch (error) {
    const absoluteUrl = new URL(url, window.location.origin).href
    try {
      await navigator.clipboard.writeText(absoluteUrl)
      window.open(url, '_blank')
      setStatus(`当前浏览器不允许直接复制图片，已打开${labelText}并复制图片链接。`)
    } catch {
      window.open(url, '_blank')
      setStatus(error instanceof Error ? `${error.message} 已打开${labelText}，请在新窗口中复制。` : `无法直接复制图片，已打开${labelText}。`)
    }
  }
}

export async function copySegmentGroupToClipboard(
  group: { label: string; segments: Array<{ path: string }> },
  setStatus: (status: string) => void,
) {
  setStatus(`正在合成并复制${group.label}...`)
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      throw new Error('当前浏览器不支持直接复制图片。')
    }
    const pngBlob = composeSegmentImagesAsPngBlob(group.segments.map((segment) => assetUrl(segment.path)))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
    setStatus(`已复制${group.label}到剪贴板。`)
  } catch (error) {
    try {
      const blob = await composeSegmentImagesAsPngBlob(group.segments.map((segment) => assetUrl(segment.path)))
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setStatus(error instanceof Error ? `${error.message} 已打开合成后的${group.label}。` : `无法直接复制图片，已打开合成后的${group.label}。`)
      window.setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (fallbackError) {
      setStatus(fallbackError instanceof Error ? fallbackError.message : String(fallbackError))
    }
  }
}

export const aiPrompt = String.raw`请把图片中的一道数学题忠实转写成轻量 Markdown JSON。只输出一个 json 代码块，代码块内部必须是合法 JSON。

你的任务：
只保留图片里真实出现的题干、答案、解析，不要解题，不要补写，不要改写题意。
如果一次收到多张分块图片，它们属于同一道题，请按用户发送顺序合并识别，不要当成多道题。

JSON 格式如下：
{
  "problem_text": "",
  "answer": "",
  "analysis": ""
}

字段要求：
- problem_text：只放题目正文，包括题干、条件、问题、选项。若是选择题，把 A、B、C、D 等全部选项按原顺序写在题干中；不要放答案或解析。
- answer：只放图片中明确出现的答案。没有答案时填空字符串。
- analysis：只放图片中明确出现的解析、详解或解题过程。没有解析时填空字符串。

Markdown/LaTeX 要求：
1. 不要求强制修正 LaTeX 格式；请尽量保留模型原生可读的 Markdown/LaTeX 表达。
2. 清晰可见的公式可以用 $...$、$$...$$、\(...\)、\[...\] 或模型自然输出的 LaTeX 写法。
3. 表格可以用 Markdown 表格；如果表格结构不清，用可读纯文本尽量保留。
4. 如果某个公式无法确认，尽力转录可见部分，不要强行猜测。
5. JSON 字符串中的换行请使用 \n；LaTeX 反斜杠按合法 JSON 字符串方式转义。
6. 请进行适当排版，必要时换行或分段展示公式，不要把多个公式杂糅在同一行或同一段里。

排版要求：
1. 尽量保持原文顺序和段落结构。
2. 题干、答案、解析之间要严格分字段，不要把【答案】、【解析】混在 problem_text 中。
3. 选择题选项写入 problem_text。
4. 小问如（1）（2）按原顺序保留，建议分段换行。
5. 页眉、页脚、页码、水印、版权信息、广告、下一题内容不要放入本题字段。
6. 不要把“典例”“例题”“变式”“即学即练”“限时训练”“课后训练”等讲义分组标签放入 problem_text；如果开头是“【典例1】”“变式 2”“即学即练3”，请删除该标签，只保留后面的真实题干正文。

只输出一个 json 代码块，代码块内部是合法 JSON，不要解释。`

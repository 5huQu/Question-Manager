import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { BookOpen, Check, Copy, Crop, FileText, Info as InfoIcon, LoaderCircle, RefreshCcw, X } from 'lucide-react'
import { learningTagsApi } from '@/api/learningTags'
import { settingsApi } from '@/api/settings'
import { MarkdownContent } from '@/components/MarkdownContent'
import { normalizeRichBlocks, richBlocksPlainText } from '@/components/RichContent'
import { Modal } from '@/components/dialogs/Modal'
import { Badge, Button } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { OcrSettings, QuestionItem, TagLibraries } from '@/types'
import { FigureGallery, QuestionContent, QuestionMarkdownContent } from '@/components/questions/QuestionContent'
import { assetUrl, difficultyBadgeVariant, difficultyLabel10, difficultyLabelFromScore10, figuresByUsage, splitTags } from '@/utils/questionDisplay'
import { draftAnalysisText, draftAnswerText, draftProblemText, paragraphBlocksFromText } from '@/utils/jsonCleanup'
import { gradeOptionsForTeachingStages } from '@/utils/stages'

export function analysisCopyGroupCount(count: number) {
  if (count <= 0) return 0
  if (count <= 4) return count
  if (count <= 6) return 3
  return 4
}

function splitIntoBalancedGroups<T>(items: T[], groupCount: number) {
  if (!items.length || groupCount <= 0) return []
  const safeGroupCount = Math.min(items.length, groupCount)
  return Array.from({ length: safeGroupCount }, (_, index) => {
    const start = Math.floor((index * items.length) / safeGroupCount)
    const end = Math.floor(((index + 1) * items.length) / safeGroupCount)
    return items.slice(start, end)
  }).filter((group) => group.length)
}

export function EditDialog({ draft, setDraft, onClose, onSave }: { draft: Partial<QuestionItem>; setDraft: Dispatch<SetStateAction<Partial<QuestionItem>>>; onClose: () => void; onSave: (nextDraft?: Partial<QuestionItem>) => Promise<void> }) {
  const [mode, setMode] = useState<'form' | 'metadata' | 'json'>('form')
  const [aiOpen, setAiOpen] = useState(false)
	  const [jsonInput, setJsonInput] = useState(() => {
	    return JSON.stringify({
	      problem_text: draftProblemText(draft),
	      answer: draftAnswerText(draft),
	      analysis: draftAnalysisText(draft),
	      stage: draft.stage || '',
	      question_type: draft.questionType || '',
	      knowledge_points: draft.knowledgePoints || [],
	      solution_methods: draft.solutionMethods || [],
	      difficulty_score_10: draft.difficultyScore10 || '',
      difficulty_label: draft.difficultyLabel || '',
    }, null, 2)
  })
  const [jsonStatus, setJsonStatus] = useState('')
  const [jsonSaveReady, setJsonSaveReady] = useState(false)
  const jsonSaveReadyRef = useRef(false)
  const cleanedJsonDraftRef = useRef<Partial<QuestionItem> | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')

	  useEffect(() => {
	    if (mode === 'form' || mode === 'metadata') {
	      setJsonInput(JSON.stringify({
	        problem_text: draftProblemText(draft),
	        answer: draftAnswerText(draft),
	        analysis: draftAnalysisText(draft),
	        stage: draft.stage || '',
	        question_type: draft.questionType || '',
	        knowledge_points: draft.knowledgePoints || [],
	        solution_methods: draft.solutionMethods || [],
	        difficulty_score_10: draft.difficultyScore10 || '',
        difficulty_label: draft.difficultyLabel || '',
      }, null, 2))
    }
  }, [draft, mode])

  const tagLibraries = useAsync<TagLibraries>(() => learningTagsApi.getQuestionBankTagLibraries(), [])
  const ocrSettings = useAsync<OcrSettings>(() => settingsApi.getOcrSettings(), [])
  const configuredStageOptions = gradeOptionsForTeachingStages(ocrSettings.data?.teachingStages)
  const metadataStageOptions = draft.stage && !configuredStageOptions.includes(draft.stage)
    ? [...configuredStageOptions, draft.stage]
    : configuredStageOptions
  const imageUrl = draft.sliceImagePath ? assetUrl(String(draft.sliceImagePath)) : ''
  const segmentImages = draft.ocrSegmentImages ?? []
  const groupedSegmentImages = useMemo(() => {
    const byKind = {
      problem: segmentImages.filter((segment) => segment.kind === 'problem'),
      answer: segmentImages.filter((segment) => segment.kind === 'answer'),
      analysis: segmentImages.filter((segment) => segment.kind === 'analysis'),
    }
    const groups: Array<{ label: string; segments: typeof segmentImages }> = []
    if (byKind.problem.length) groups.push({ label: '题干图', segments: byKind.problem })
    if (byKind.answer.length) groups.push({ label: '答案图', segments: byKind.answer })
    const analysisGroups = splitIntoBalancedGroups(byKind.analysis, analysisCopyGroupCount(byKind.analysis.length))
    analysisGroups.forEach((segments, index) => {
      groups.push({ label: analysisGroups.length > 1 ? `解析图 ${index + 1}` : '解析图', segments })
    })
    return groups
  }, [segmentImages])

  function updateDraft(patch: Partial<QuestionItem>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  function setJsonCleanState(ready: boolean, nextDraft: Partial<QuestionItem> | null = null) {
    jsonSaveReadyRef.current = ready
    cleanedJsonDraftRef.current = nextDraft
    setJsonSaveReady(ready)
  }

	  function editableJsonFromDraft(source: Partial<QuestionItem>) {
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

  function normalizedJsonText(value: string) {
    const stripped = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const firstObject = stripped.indexOf('{')
    const firstArray = stripped.indexOf('[')
    const startCandidates = [firstObject, firstArray].filter((index) => index >= 0)
    const start = startCandidates.length ? Math.min(...startCandidates) : -1
    if (start < 0) return stripped
    const end = Math.max(stripped.lastIndexOf('}'), stripped.lastIndexOf(']'))
    return end > start ? stripped.slice(start, end + 1) : stripped
  }

  function normalizeJsonSyntaxQuotes(value: string) {
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

  function normalizeAiJsonText(value: string) {
    return normalizeJsonSyntaxQuotes(normalizedJsonText(value))
      .replace(/[‘’]/g, "'")
      .replace(/，(?=\s*["}\]])/g, ',')
      .replace(/：(?=\s*["{\[])/g, ':')
      .replace(/,\s*([}\]])/g, '$1')
  }

  function escapeJsonStringControlChars(value: string) {
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

  function parseAiJsonText(value: string) {
    const normalized = normalizeAiJsonText(value)
    try {
      return JSON.parse(normalized)
    } catch {
      return JSON.parse(escapeJsonStringControlChars(normalized))
    }
  }

  function textArray(value: unknown) {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
    if (typeof value === 'string') return splitTags(value)
    return undefined
  }

  function draftPatchFromJsonText(value: string, options: { clean?: boolean } = {}) {
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

  function applyJsonText(value: string) {
    setJsonInput(value)
    setSaveStatus('')
    setJsonCleanState(false)
    if (!value.trim()) {
      setJsonStatus('')
      return
    }
    try {
      const { next, status } = draftPatchFromJsonText(value)
      if (!Object.keys(next).length) {
        setJsonStatus(status)
        return
      }
      updateDraft(next)
      setJsonStatus(status)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setJsonStatus(`JSON 仍需修正：${message}`)
    }
  }

  function handleParseAndSyncJson() {
    if (!jsonInput.trim()) return
    try {
      const { next, status } = draftPatchFromJsonText(jsonInput, { clean: true })
      if (!Object.keys(next).length) {
        setJsonStatus('JSON 有效，但没有识别到可替换字段。')
        return
      }
      const updated = { ...draft, ...next }
      setDraft(updated)
      setJsonCleanState(true, updated)
      setJsonStatus(`JSON 清洗完成：${status.replace(/[。.]$/, '')}。已自动合并字段，并同步右侧预览。`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setJsonStatus(`解析失败，请检查 JSON 格式：${message}`)
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveStatus('')
    try {
      let nextDraft = draft
      if (mode === 'json' && jsonInput.trim()) {
        if ((jsonSaveReadyRef.current || jsonSaveReady) && cleanedJsonDraftRef.current) {
          nextDraft = cleanedJsonDraftRef.current
        } else {
          const { next, status } = draftPatchFromJsonText(jsonInput)
          if (!Object.keys(next).length) {
            setJsonStatus(status)
            setSaveStatus('没有识别到可保存字段，请检查 JSON 字段名。')
            return
          }
          nextDraft = { ...draft, ...next }
          setDraft(nextDraft)
          setJsonCleanState(false)
          setJsonStatus(status)
        }
      }
      await onSave(nextDraft)
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function copyText(value: string, doneText: string) {
    await navigator.clipboard.writeText(value)
    setJsonStatus(doneText)
  }

  async function fetchImageAsPngBlob(url: string) {
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

  async function composeSegmentImagesAsPngBlob(urls: string[]) {
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

  async function copyImageToClipboard(url: string, labelText = '题图') {
    setJsonStatus(`正在复制${labelText}...`)
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('当前浏览器不支持直接复制图片。')
      }
      const pngBlob = fetchImageAsPngBlob(url)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
      setJsonStatus(`已复制${labelText}到剪贴板。`)
    } catch (error) {
      const absoluteUrl = new URL(url, window.location.origin).href
      try {
        await navigator.clipboard.writeText(absoluteUrl)
        window.open(url, '_blank')
        setJsonStatus(`当前浏览器不允许直接复制图片，已打开${labelText}并复制图片链接。`)
      } catch {
        window.open(url, '_blank')
        setJsonStatus(error instanceof Error ? `${error.message} 已打开${labelText}，请在新窗口中复制。` : `无法直接复制图片，已打开${labelText}。`)
      }
    }
  }

  async function copySegmentGroupToClipboard(group: { label: string; segments: typeof segmentImages }) {
    setJsonStatus(`正在合成并复制${group.label}...`)
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('当前浏览器不支持直接复制图片。')
      }
      const pngBlob = composeSegmentImagesAsPngBlob(group.segments.map((segment) => assetUrl(segment.path)))
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
      setJsonStatus(`已复制${group.label}到剪贴板。`)
    } catch (error) {
      try {
        const blob = await composeSegmentImagesAsPngBlob(group.segments.map((segment) => assetUrl(segment.path)))
        const url = URL.createObjectURL(blob)
        window.open(url, '_blank')
        setJsonStatus(error instanceof Error ? `${error.message} 已打开合成后的${group.label}。` : `无法直接复制图片，已打开合成后的${group.label}。`)
        window.setTimeout(() => URL.revokeObjectURL(url), 30000)
      } catch (fallbackError) {
        setJsonStatus(fallbackError instanceof Error ? fallbackError.message : String(fallbackError))
      }
    }
  }

	  const currentJson = JSON.stringify({
	    problem_text: draftProblemText(draft),
	    answer: draftAnswerText(draft),
	    analysis: draftAnalysisText(draft),
	    stage: draft.stage || '',
	    knowledge_points: draft.knowledgePoints || [],
	    solution_methods: draft.solutionMethods || [],
	    difficulty_score_10: draft.difficultyScore10 || '',
    difficulty_label: draft.difficultyLabel || '',
  }, null, 2)

	  const aiPrompt = String.raw`请把图片中的一道数学题忠实转写成轻量 Markdown JSON。只输出一个 json 代码块，代码块内部必须是合法 JSON。

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

  return (
    <Modal
      title="编辑题目"
      desc="修改题干、答案、解析和元数据。支持左右分栏实时预览，保存前不会写入数据库。"
      onClose={onClose}
      wide
      locked
      actions={<Button size="sm" variant="outline" icon={BookOpen} onClick={() => { setMode('json'); setAiOpen(true) }}>AI 辅助</Button>}
    >
      <div className="flex h-full min-h-0 flex-col">
        {/* Toggle Mode Bar */}
        <div className="flex flex-none items-center justify-between gap-3 border-b pb-3 border-zinc-200 dark:border-zinc-800">
          <div className="inline-flex rounded-lg border bg-zinc-50 dark:bg-zinc-800/40 p-1 border-zinc-200 dark:border-zinc-700/30">
            <button
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                mode === 'form'
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-850 dark:hover:text-zinc-200'
              }`}
              onClick={() => setMode('form')}
              type="button"
            >
              直观修改
            </button>
            <button
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                mode === 'metadata'
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-850 dark:hover:text-zinc-200'
              }`}
              onClick={() => setMode('metadata')}
              type="button"
            >
              题目元数据
            </button>
            <button
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                mode === 'json'
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-850 dark:hover:text-zinc-200'
              }`}
              onClick={() => setMode('json')}
              type="button"
            >
              JSON 修改
            </button>
          </div>
        </div>

        {/* Main Split-Pane Body */}
        <div className="min-h-0 flex-1 py-4">
          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6 h-full min-h-0 overflow-hidden">

            {/* Left Column: Editors */}
            <div className="h-full overflow-y-auto pr-2 space-y-4">
              {mode === 'form' ? (
                <div className="space-y-4">
                  {/* Markdown Editors */}
                  <div className="space-y-4">
		                    <LabeledTextarea label="题干文本" help="保存为 Markdown 文本；公式可保留模型原生 LaTeX 写法。" minHeight="min-h-48" value={draftProblemText(draft)} onChange={(value) => updateDraft({ stemMarkdown: value, problemBlocks: paragraphBlocksFromText(value) })} />
		                    <LabeledTextarea label="答案文本" help="保存为答案 Markdown。" minHeight="min-h-24" value={draftAnswerText(draft)} onChange={(value) => updateDraft({ answerText: value, answerBlocks: paragraphBlocksFromText(value) })} />
		                    <LabeledTextarea label="解析文本" help="保存为解析 Markdown。" minHeight="min-h-48" value={draftAnalysisText(draft)} onChange={(value) => updateDraft({ analysisMarkdown: value, analysisBlocks: paragraphBlocksFromText(value) })} />
                  </div>
                </div>
              ) : mode === 'metadata' ? (
                <div className="space-y-4">
                  {/* Metadata fields */}
                  <div className="rounded-xl border bg-zinc-50/50 dark:bg-zinc-900/50 p-4 border-zinc-200 dark:border-zinc-800/80 space-y-3">
                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-200 block border-b pb-1.5 border-zinc-200 dark:border-zinc-800">题目元数据</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <LabeledInput label="来源" help="用于题目来源展示和筛选。" value={draft.sourceTitle ?? ''} onChange={(value) => updateDraft({ sourceTitle: value })} />
                      <LabeledInput label="章节/知识点概览" help="旧字段；可作为主知识点简写。" value={draft.chapter ?? ''} onChange={(value) => updateDraft({ chapter: value })} />
                    </div>
                    <LabeledSelect
                      label="学段"
                      help="用于题目展示、筛选和后续导入记录。"
                      value={draft.stage ?? ''}
                      options={metadataStageOptions}
                      placeholder="未设学段"
                      onChange={(value) => updateDraft({ stage: value })}
                    />
                    <LabeledSelect
                      label="题型"
                      help="影响题目展示、筛选和试卷导出时的版式判断。"
                      value={draft.questionType ?? ''}
                      options={['单选题', '多选题', '填空题', '解答题']}
                      placeholder="未设题型"
                      onChange={(value) => updateDraft({ questionType: value })}
                    />
                    <LabeledInput label="难度分 1-10" help="保存时同步显示难度标签。" value={String(draft.difficultyScore10 ?? '')} onChange={(value) => updateDraft({ difficultyScore10: Number(value), difficultyLabel: difficultyLabelFromScore10(Number(value)) })} />
                    <MultiTagSelector label="知识点" help="从知识点库中选择；可添加多个，点标签右侧可移除。" options={tagLibraries.data?.knowledgePoints ?? []} values={draft.knowledgePoints ?? []} onChange={(values) => updateDraft({ knowledgePoints: values })} />
                    <MultiTagSelector label="解题方法" help="从解题方法库中选择；可添加多个，点标签右侧可移除。" options={tagLibraries.data?.solutionMethods ?? []} values={draft.solutionMethods ?? []} onChange={(values) => updateDraft({ solutionMethods: values })} />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2.5">
	                    <LabeledTextarea
	                      label="粘贴整题 JSON"
	                      help="支持只粘贴部分字段。点击右侧“JSON 清洗”可合并字段，并同步右侧预览。"
	                      minHeight="min-h-[480px]"
	                      value={jsonInput}
	                      onChange={applyJsonText}
                      headerAction={
                        <Button
                          size="sm"
                          variant="outline"
	                          icon={RefreshCcw}
	                          onClick={handleParseAndSyncJson}
	                          disabled={!jsonInput.trim()}
	                          title="清洗输入框中的 JSON 字段并同步到当前草稿"
	                        >
	                          JSON 清洗
	                        </Button>
                      }
                    />
                    {jsonStatus && (
                      <div className={`flex items-start gap-2 text-xs px-3 py-2 rounded-lg border ${
                        jsonStatus.includes('仍需修正')
                          ? 'text-red-700 dark:text-red-400 bg-red-50/50 dark:bg-red-950/20 border-red-200/20'
                          : jsonStatus.includes('有效')
                            ? 'text-amber-600 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/20'
                            : 'text-emerald-600 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/20'
                      }`}>
                        {jsonStatus.includes('仍需修正') ? <X className="size-3.5 shrink-0 mt-0.5" /> : jsonStatus.includes('有效') ? <InfoIcon className="size-3.5 shrink-0 mt-0.5" /> : <Check className="size-3.5 shrink-0 mt-0.5" />}
                        <span className="leading-relaxed">{jsonStatus}</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 rounded-xl border bg-zinc-50 dark:bg-zinc-900/40 p-4 text-xs leading-5 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800">
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">可识别字段</p>
	                    <p>problem_text / stemMarkdown</p>
	                    <p>answer / answerText</p>
                    <p>analysis / analysisMarkdown</p>
                    <p>stage</p>
                    <p>knowledge_points / knowledgePoints</p>
                    <p>solution_methods / solutionMethods</p>
                    <p>difficulty_score_10 / difficultyScore10</p>
                    <Button className="mt-2 w-full justify-start" size="sm" variant="outline" icon={Copy} onClick={() => copyText(currentJson, '已复制当前题目 JSON。')}>复制当前 JSON</Button>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Live Preview */}
            <div className="h-full overflow-y-auto pl-2 border-t pt-4 lg:border-t-0 lg:pt-0 lg:border-l border-zinc-200 dark:border-zinc-800 space-y-4 lg:pl-6">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-350">实时预览效果</span>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </div>

              {/* Mock Question Preview Card */}
              <div className="rounded-2xl border bg-white dark:bg-zinc-900 p-5 space-y-4 shadow-sm border-zinc-200 dark:border-zinc-800">
                {/* Badges / Header */}
                <div className="flex flex-wrap gap-1.5 items-center">
                  {draft.stage && draft.stage !== 'OCRT' && (
                    <Badge variant="default">{draft.stage}</Badge>
                  )}
                  {draft.questionType && (
                    <Badge variant="default">{draft.questionType}</Badge>
                  )}
                  <Badge variant={difficultyBadgeVariant(draft as QuestionItem)}>
                    {difficultyLabel10(draft as QuestionItem)}
                  </Badge>
                  {draft.sourceTitle && (
                    <Badge variant="outline" className="max-w-xs truncate" title={draft.sourceTitle}>
                      {draft.sourceTitle}
                    </Badge>
                  )}
                </div>

                {/* Question Stem Content */}
                <div className="space-y-3">
	                  <QuestionMarkdownContent
	                    className="text-sm leading-7"
	                    content={draftProblemText(draft)}
	                    figures={draft.figures ?? []}
	                    prefix={draft.serialNo ? `#${draft.serialNo}` : draft.questionNo ? `#${draft.questionNo}` : undefined}
	                  />
                </div>

                {/* Answers and Analysis Sections (always visible in preview for easy editing) */}
                <div className="border-t border-zinc-100 dark:border-zinc-800/80 pt-4 space-y-4">
                  <div className="bg-zinc-50/50 dark:bg-zinc-800/30 rounded-xl p-3.5 border border-zinc-200/60 dark:border-zinc-700/30">
                    <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block mb-1">答案</span>
	                    {draftAnswerText(draft).trim() ? (
	                      <MarkdownContent className="text-sm text-zinc-805 dark:text-zinc-200 leading-relaxed font-medium" content={draftAnswerText(draft)} />
                    ) : (
                      <span className="text-xs text-zinc-400 dark:text-zinc-500 italic">未设置答案</span>
                    )}
                  </div>

                  <div className="bg-zinc-50/50 dark:bg-zinc-800/30 rounded-xl p-3.5 border border-zinc-200/60 dark:border-zinc-700/30">
                    <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block mb-1.5">解析</span>
	                    {draftAnalysisText(draft).trim() ? (
	                      <>
	                        <MarkdownContent className="text-sm text-zinc-850 dark:text-zinc-200 leading-relaxed" content={draftAnalysisText(draft)} />
                        <FigureGallery figures={figuresByUsage(draft.figures ?? [], 'analysis')} className="mt-3" />
                      </>
                    ) : (
                      <span className="text-xs text-zinc-400 dark:text-zinc-500 italic">未设置解析</span>
                    )}
                  </div>
                </div>

                {/* Tag Displays */}
                {(draft.knowledgePoints?.length || draft.chapter || draft.solutionMethods?.length) ? (
                  <div className="border-t border-zinc-100 dark:border-zinc-800/80 pt-3 space-y-2.5">
                    {((draft.knowledgePoints?.length ? draft.knowledgePoints : [draft.chapter]).filter(Boolean).length > 0) && (
                      <div className="space-y-1">
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-semibold block">知识点</span>
                        <div className="flex flex-wrap gap-1">
                          {(draft.knowledgePoints?.length ? draft.knowledgePoints : [draft.chapter]).filter(Boolean).map((kp, i) => (
                            <span key={i} className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50">
                              {kp}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {draft.solutionMethods && draft.solutionMethods.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-semibold block">解题方法</span>
                        <div className="flex flex-wrap gap-1">
                          {draft.solutionMethods.map((sm, i) => (
                            <span key={i} className="solution-method-tag text-[11px] font-medium px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/50">
                              {sm}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

          </div>
        </div>

        {/* Footer actions */}
        <div className="flex flex-none items-center justify-between gap-3 border-t pt-3">
          <div className="min-w-0 text-xs text-red-600 dark:text-red-400">{saveStatus}</div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button disabled={saving} icon={saving ? LoaderCircle : undefined} onClick={handleSave}>{saving ? '保存中...' : '保存'}</Button>
          </div>
        </div>
      </div>

      {aiOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 p-4"
          onClick={() => setAiOpen(false)}
        >
          <div
            className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-none items-start justify-between gap-3 border-b px-4 py-3">
              <div>
                <h3 className="font-semibold">AI 辅助</h3>
                <p className="mt-1 text-xs text-zinc-500">复制当前内容、题图/分块图，或复制提示词后到外部模型识别。</p>
              </div>
              <button className="rounded-md border p-2 hover:bg-zinc-50" onClick={() => setAiOpen(false)} type="button"><X className="size-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Button className="justify-start" variant="outline" icon={Copy} onClick={() => copyText(currentJson, '已复制当前题目 JSON。')}>复制</Button>
                <Button className="justify-start" variant="outline" icon={Crop} disabled={!imageUrl} onClick={() => imageUrl && copyImageToClipboard(imageUrl)}>复制题图</Button>
                <Button className="justify-start" variant="outline" icon={FileText} onClick={() => copyText(aiPrompt, '已复制提示词。')}>提示词</Button>
              </div>
              {groupedSegmentImages.length ? (
                <div className="mt-3 rounded-xl border bg-zinc-50 p-3">
                  <p className="text-xs font-semibold text-zinc-900">OCR 分块图</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">题干和答案会分别合成一张图；解析按顺序合并为 3-4 张，避免整张长图被压缩后看不清公式。</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {groupedSegmentImages.map((group, index) => (
                      <Button
                        key={`${group.label}-${index}`}
                        size="sm"
                        variant="outline"
                        icon={Copy}
                        onClick={() => copySegmentGroupToClipboard(group)}
                      >
                        {index + 1}. 复制{group.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
	              <LabeledTextarea className="mt-4" label="提示词预览" help="要求模型返回 problem_text / answer / analysis；模型返回后可直接粘贴到 JSON 修改。" minHeight="min-h-72" value={aiPrompt} onChange={() => undefined} readOnly />
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

function LabeledInput({ label: labelText, help, value, onChange }: { label: string; help: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="block rounded-xl border bg-white dark:bg-zinc-900 dark:border-zinc-800 p-3">
      <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50 block">{labelText}</span>
      <span className="mt-1 block text-[10px] text-zinc-400 dark:text-zinc-500 leading-normal">{help}</span>
      <input
        className="mt-2 h-9 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-850 px-3 text-xs dark:text-zinc-100 outline-none focus:ring-1 focus:ring-zinc-950 focus:border-zinc-950 dark:focus:ring-zinc-200 dark:focus:border-zinc-200 focus:bg-white dark:focus:bg-zinc-800 transition-all"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function LabeledSelect({ label: labelText, help, value, options, placeholder, onChange }: { label: string; help: string; value: string; options: string[]; placeholder: string; onChange: (value: string) => void }) {
  return (
    <label className="block rounded-xl border bg-white dark:bg-zinc-900 dark:border-zinc-800 p-3">
      <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50 block">{labelText}</span>
      <span className="mt-1 block text-[10px] text-zinc-400 dark:text-zinc-500 leading-normal">{help}</span>
      <select
        className="mt-2 h-9 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-850 px-3 text-xs dark:text-zinc-100 outline-none focus:ring-1 focus:ring-zinc-950 focus:border-zinc-950 dark:focus:ring-zinc-200 dark:focus:border-zinc-200 focus:bg-white dark:focus:bg-zinc-800 transition-all cursor-pointer"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function MultiTagSelector({ label: labelText, help, options, values, onChange }: { label: string; help: string; options: string[]; values: string[]; onChange: (values: string[]) => void }) {
  const cleanValues = values.map((value) => String(value).trim()).filter(Boolean)
  const mergedOptions = Array.from(new Set([...cleanValues, ...options.map((option) => String(option).trim()).filter(Boolean)]))
  const availableOptions = mergedOptions.filter((option) => !cleanValues.includes(option))
  function addTag(value: string) {
    if (!value || cleanValues.includes(value)) return
    onChange([...cleanValues, value])
  }
  function removeTag(value: string) {
    onChange(cleanValues.filter((item) => item !== value))
  }
  return (
    <div className="rounded-xl border bg-white dark:bg-zinc-900 dark:border-zinc-800 p-3">
      <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-550">{labelText}</p>
      <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500 leading-normal">{help}</p>
      <select
        className="mt-2 h-9 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-850 px-3 text-xs dark:text-zinc-100 outline-none focus:ring-1 focus:ring-zinc-950 focus:border-zinc-950 dark:focus:ring-zinc-200 dark:focus:border-zinc-200 focus:bg-white dark:focus:bg-zinc-800 transition-all cursor-pointer"
        value=""
        onChange={(event) => addTag(event.target.value)}
      >
        <option value="">{availableOptions.length ? `选择${labelText}` : '暂无可选项'}</option>
        {availableOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      {cleanValues.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {cleanValues.map((value) => (
            <button
              key={value}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-750 bg-zinc-50 dark:bg-zinc-805 px-2 py-0.5 text-left text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:border-red-200 dark:hover:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-600 dark:hover:text-red-300 transition-colors cursor-pointer"
              onClick={() => removeTag(value)}
              type="button"
            >
              <span>{value}</span>
              <X className="size-3" />
            </button>
          ))}
        </div>
      ) : <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500 italic">尚未选择</p>}
    </div>
  )
}

function LabeledTextarea({
  label: labelText,
  help,
  value,
  onChange,
  minHeight,
  className = '',
  readOnly = false,
  showPreview = false,
  headerAction
}: {
  label: string;
  help: string;
  value: string;
  onChange: (value: string) => void;
  minHeight: string;
  className?: string;
  readOnly?: boolean;
  showPreview?: boolean;
  headerAction?: ReactNode;
}) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  return (
    <div className={`block rounded-xl border bg-white p-3 dark:bg-zinc-900 dark:border-zinc-800 ${className}`}>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <div className="min-w-0 flex-1">
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-550 block">{labelText}</span>
          <span className="mt-0.5 block text-[10px] text-zinc-400 dark:text-zinc-500 leading-normal">{help}</span>
        </div>
        {headerAction && (
          <div className="shrink-0">
            {headerAction}
          </div>
        )}
        {showPreview && !readOnly && (
          <div className="flex gap-0.5 bg-zinc-150 dark:bg-zinc-800 p-0.5 rounded-md text-[9px] border border-zinc-200 dark:border-zinc-750 shrink-0 ml-2">
            <button
              type="button"
              onClick={() => setTab('edit')}
              className={`px-1.5 py-0.5 rounded transition-all cursor-pointer font-medium ${tab === 'edit' ? 'bg-white dark:bg-zinc-700 text-zinc-850 dark:text-zinc-100 font-bold shadow-sm' : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-350'}`}
            >
              编辑
            </button>
            <button
              type="button"
              onClick={() => setTab('preview')}
              className={`px-1.5 py-0.5 rounded transition-all cursor-pointer font-medium ${tab === 'preview' ? 'bg-white dark:bg-zinc-700 text-zinc-850 dark:text-zinc-100 font-bold shadow-sm' : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-350'}`}
            >
              预览
            </button>
          </div>
        )}
      </div>
      {tab === 'edit' ? (
        <textarea
          className={`mt-2 w-full resize-y rounded-lg border bg-zinc-50 dark:bg-zinc-850 px-3 py-2 font-mono text-xs leading-6 outline-none focus:ring-1 focus:ring-zinc-950 focus:border-zinc-950 dark:focus:ring-zinc-200 dark:focus:border-zinc-200 transition-all ${minHeight}`}
          readOnly={readOnly}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <div className={`mt-2 w-full rounded-lg border bg-zinc-50/50 dark:bg-zinc-850/30 px-3.5 py-2.5 text-sm overflow-auto ${minHeight}`}>
          {value.trim() ? (
            <QuestionContent blocks={paragraphBlocksFromText(value)} />
          ) : (
            <span className="text-zinc-400 dark:text-zinc-500 text-xs italic">无内容预览</span>
          )}
        </div>
      )}
    </div>
  )
}

export default EditDialog

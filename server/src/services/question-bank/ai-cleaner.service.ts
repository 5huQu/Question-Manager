import { RouteError } from '../../utils/http-error.js'
import { validateQuestionMarkdown, type FormatIssue } from '../../utils/validation.js'
import { readAssistantModelSettings, readAssistantPromptSettings } from '../settings/ocr-settings.js'
import { type PublicQuestion } from '../../db/questions.js'
import * as repo from '../../repositories/question-bank/items.repo.js'

export type AiCleanMode = 'full' | 'format_only'

export type AiCleanPatch = {
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
}

export type AiCleanPreview = {
  itemId: string
  mode: AiCleanMode
  patch: AiCleanPatch
  warnings: string[]
  confidence: number
  formatIssues: FormatIssue[]
}

type AssistantModelSettings = ReturnType<typeof readAssistantModelSettings>
type AssistantPromptSettings = ReturnType<typeof readAssistantPromptSettings>
type FetchLike = typeof fetch

function normalizeMode(value: unknown): AiCleanMode {
  if (value === 'format_only') return value
  return 'full'
}

export function assistantEndpointCandidates(baseUrl: string) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) return []
  return base.endsWith('/chat/completions') ? [base] : [base, `${base}/chat/completions`]
}

export function extractJsonObject(text: string) {
  let candidate = String(text || '').trim()
  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidate = fenced[1].trim()
  try {
    const parsed = JSON.parse(candidate)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // Try object slice below.
  }
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const parsed = JSON.parse(candidate.slice(start, end + 1))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  }
  throw new RouteError(502, 'AI 助手没有返回合法 JSON。')
}

function normalizeWarnings(value: unknown) {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return Array.from(new Set(raw.map((item) => String(item || '').trim()).filter(Boolean))).slice(0, 12)
}

function normalizeConfidence(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(1, parsed))
}

function textField(source: Record<string, unknown>, keys: string[], fallback: string) {
  for (const key of keys) {
    if (typeof source[key] === 'string') return String(source[key]).trim()
  }
  return fallback
}

function removeExplicitScoringMarkers(text: string) {
  return String(text || '')
    .replace(/^\s*[（(]\s*\d+(?:\.\d+)?\s*分\s*[）)]\s*/gm, '')
    .replace(/本小题\s*满分\s*\d+(?:\.\d+)?\s*分/g, '')
    .replace(/^\s*(?:【?\s*评分标准\s*】?|给分点)\s*[:：]?\s*$/gm, '')
    .replace(/(^|[\s。！？；;，,])(?:\$?\s*)\d+(?:\.\d+)?\s*分(?=\s*(?:$|\n|[（(]\d+[）)]))/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function cleanPatchForMode(patch: AiCleanPatch, mode: AiCleanMode): AiCleanPatch {
  if (mode !== 'full') return patch
  return {
    stemMarkdown: removeExplicitScoringMarkers(patch.stemMarkdown),
    answerText: removeExplicitScoringMarkers(patch.answerText),
    analysisMarkdown: removeExplicitScoringMarkers(patch.analysisMarkdown),
  }
}

function resultPatch(item: PublicQuestion, result: Record<string, unknown>, mode: AiCleanMode): AiCleanPatch {
  return cleanPatchForMode({
    stemMarkdown: textField(result, ['stemMarkdown', 'problem_text', 'problemText'], item.stemMarkdown),
    answerText: textField(result, ['answerText', 'answer'], item.answerText),
    analysisMarkdown: textField(result, ['analysisMarkdown', 'analysis'], item.analysisMarkdown),
  }, mode)
}

function modelPayload(item: PublicQuestion, mode: AiCleanMode) {
  return {
    mode,
    current: {
      id: item.id,
      questionNo: item.questionNo,
      stage: item.stage,
      questionType: item.questionType,
      stemMarkdown: item.stemMarkdown,
      answerText: item.answerText,
      analysisMarkdown: item.analysisMarkdown,
    },
    output_schema: {
      stemMarkdown: 'string',
      answerText: 'string',
      analysisMarkdown: 'string',
      warnings: ['string'],
      confidence: 'number 0..1',
    },
  }
}

async function callAssistantJson(
  settings: AssistantModelSettings,
  payload: Record<string, unknown>,
  options: { fetchImpl?: FetchLike; prompts?: AssistantPromptSettings } = {},
) {
  if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
    throw new RouteError(400, '缺少 AI 助手模型配置：请在系统设置中配置 AI 助手 API 服务端点、密钥和模型名称。')
  }
  const fetchImpl = options.fetchImpl || fetch
  const promptSettings = options.prompts || readAssistantPromptSettings()
  const payloadJson = JSON.stringify(payload, null, 2)
  const userPrompt = promptSettings.userPrompt.includes('{payload}')
    ? promptSettings.userPrompt.replace('{payload}', payloadJson)
    : `${promptSettings.userPrompt}\n\n题目 JSON：\n${payloadJson}`
  const requestBody = {
    model: settings.model,
    messages: [
      { role: 'system', content: promptSettings.systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.01,
    top_p: 0.1,
    stream: false,
  }
  let lastError = ''
  for (const endpoint of assistantEndpointCandidates(settings.apiBaseUrl)) {
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(settings.timeoutSeconds * 1000),
      })
      const text = await response.text()
      if (!response.ok) {
        lastError = `HTTP ${response.status} ${text.slice(0, 500)}`
        if (response.status === 404) continue
        break
      }
      const body = JSON.parse(text || '{}') as Record<string, any>
      const content = String((body.choices || [{}])[0]?.message?.content || '')
      return extractJsonObject(content)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      break
    }
  }
  throw new RouteError(502, `AI 助手调用失败：${lastError || '没有可用的接口地址'}`)
}

export async function previewQuestionAiClean(
  id: string,
  body: Record<string, unknown> = {},
  options: { fetchImpl?: FetchLike; settings?: AssistantModelSettings; prompts?: AssistantPromptSettings } = {},
): Promise<AiCleanPreview> {
  const item = repo.getQuestion(id)
  if (!item) throw new RouteError(404, '题目不存在。')
  const mode = normalizeMode(body.mode)
  const rawResult = await callAssistantJson(options.settings || readAssistantModelSettings(), modelPayload(item, mode), options)
  const patch = resultPatch(item, rawResult, mode)
  const formatIssues = validateQuestionMarkdown({
    problem_text: patch.stemMarkdown,
    answer: patch.answerText,
    analysis: patch.analysisMarkdown,
  })
  const warnings = normalizeWarnings(rawResult.warnings)
  if (formatIssues.length) warnings.push('AI 清洗后仍存在 Markdown/LaTeX 渲染风险，建议人工检查后再保存。')
  return {
    itemId: item.id,
    mode,
    patch,
    warnings: Array.from(new Set(warnings)),
    confidence: normalizeConfidence(rawResult.confidence),
    formatIssues,
  }
}

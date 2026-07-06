import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { storageRoot, pythonRoot } from '../../config.js'
import { parseJson } from '../../utils/json.js'
import { pythonCommand, pythonEnv } from './python.js'
import { readAppSettings, writeAppSettings } from './app-settings.js'
import { sofficePath } from './tools.js'

type OcrProvider = 'legacy' | 'doc2x' | 'glm'

const SIMPLIFIED_CLASSIFICATION_SYSTEM_PROMPT = '你是题库分类工具。'
const LEGACY_CLASSIFICATION_SYSTEM_PROMPT_PREFIX = '你是高中数学题目分类工具。'
const LEGACY_ASSISTANT_SCORING_PROMPT_MARKERS = ['total_score', 'scoring_rubric', 'scoring_only']
const LEGACY_ASSISTANT_MISSING_SCORE_REMOVAL_MARKER = '移除页眉、页脚、广告、水印、下一题内容等明确不属于本题的噪声'

export const DEFAULT_ASSISTANT_CLEAN_SYSTEM_PROMPT = `你是数学题库的单题 AI 清洗助手。

你只处理用户提供的这一道题，不处理下一题，不做批量清洗。
你不能解题、补写答案、补写解析、改变题意或改变数学推导含义。
你的任务仅限于：
1. 修复明显 Markdown/LaTeX 格式问题，使其更适合 KaTeX/Markdown 渲染。
2. 把题干、答案、解析中混入的字段内容放回正确字段。
3. 删除正文中明确混入的评分标记或评分标准，例如“(17分)”“本小题满分 12 分”“5分”“10分”“17分”“评分标准”“给分点”等。
4. 适当整理题干、答案、解析的排版：按小问、推导步骤、结论分段；长公式或连续等价变形可单独换行；不要把多步推导糊成一个长段。
5. 移除页眉、页脚、广告、水印、下一题内容等明确不属于本题的噪声。

返回要求：
- 只输出 JSON 对象，不要 Markdown 代码块，不要解释。
- JSON 字段只能包含 stemMarkdown、answerText、analysisMarkdown、warnings、confidence。
- 不要返回题目满分、总分、每问得分、评分细则或任何评分结构化字段。
- confidence 是 0 到 1 的数字。
- 不确定是否属于本题正文时，保留正文，并在 warnings 中说明。`

export const DEFAULT_ASSISTANT_CLEAN_USER_PROMPT = `请按指定 mode 清洗这一道题。

mode 说明：
- full：修复 Markdown/LaTeX、字段混入，删除明确评分标记和明确噪声，并适当整理段落排版。
- format_only：只修复 Markdown/LaTeX 和字段混入，尽量保留原文内容。

题目 JSON：
{payload}`

export function ocrEnvPath() {
  const configDir = path.join(storageRoot, 'config')
  fs.mkdirSync(configDir, { recursive: true })
  return path.join(configDir, 'ocr.env')
}

function readOcrEnvValues() {
  const envPath = ocrEnvPath()
  const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const values: Record<string, string> = {}
  for (const line of envText.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#') || !line.includes('=')) continue
    const [key, ...rest] = line.split('=')
    values[key.trim()] = rest.join('=').trim()
  }
  return values
}

// Python OCR runners load this file through QUESTION_OCR_ENV_PATH.  The app
// settings are deliberately stored outside the process environment, so simply
// inheriting process.env would otherwise make a saved API key invisible to the
// child process.
export function ocrRunnerEnv(): NodeJS.ProcessEnv {
  return pythonEnv({
    QUESTION_OCR_ENV_PATH: ocrEnvPath(),
  })
}

export function ocrPromptSettingsPath() {
  const configDir = path.join(storageRoot, 'config')
  fs.mkdirSync(configDir, { recursive: true })
  return path.join(configDir, 'ocr_prompt_settings.json')
}

export function normalizeOcrProvider(value: unknown): OcrProvider {
  const provider = String(value || '').toLowerCase()
  if (provider === 'doc2x') return 'doc2x'
  if (provider === 'glm') return 'glm'
  return 'legacy'
}

export function hasOcrConfig(provider: OcrProvider = normalizeOcrProvider(readOcrSettings().ocrProvider)) {
  const envPath = ocrEnvPath()
  const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const hasInText = (key: string) => new RegExp(`^${key}=.+`, 'm').test(envText)
  if (provider === 'doc2x') {
    return Boolean(process.env.DOC2X_API_KEY || hasInText('DOC2X_API_KEY'))
  }
  if (provider === 'glm') {
    return Boolean(process.env.GLM_OCR_API_KEY || hasInText('GLM_OCR_API_KEY'))
  }
  return Boolean(
    (process.env.OCR_API_BASE_URL || hasInText('OCR_API_BASE_URL')) &&
    (process.env.OCR_API_KEY || hasInText('OCR_API_KEY')) &&
    (process.env.OCR_MODEL || hasInText('OCR_MODEL'))
  )
}

export function clampWorkerCount(value: unknown, fallback = 20) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return String(fallback)
  return String(Math.max(1, Math.min(parsed, 20)))
}

export function readEffectivePromptDefaults() {
  const fallback = {
    wholeSystemPrompt: '',
    wholeUserPrompt: '',
    chunkSystemPrompt: '',
    chunkUserPrompt: '',
    cleanupSystemPrompt: '',
    cleanupUserPrompt: '',
    classificationSystemPrompt: '',
    classificationUserPrompt: '',
    assistantCleanSystemPrompt: DEFAULT_ASSISTANT_CLEAN_SYSTEM_PROMPT,
    assistantCleanUserPrompt: DEFAULT_ASSISTANT_CLEAN_USER_PROMPT,
  }
  try {
    const code = [
      'import json',
      'from src.ocr.prompt import OCR_SYSTEM_PROMPT, OCR_CHUNK_SYSTEM_PROMPT, build_user_prompt, build_chunk_user_prompt',
      'from scripts.format_cleanup_for_question import DEFAULT_CLEANUP_SYSTEM_PROMPT, DEFAULT_CLEANUP_USER_PROMPT, DEFAULT_CLASSIFICATION_SYSTEM_PROMPT, DEFAULT_CLASSIFICATION_USER_PROMPT',
      'print(json.dumps({',
      '  "wholeSystemPrompt": OCR_SYSTEM_PROMPT,',
      '  "wholeUserPrompt": build_user_prompt(),',
      '  "chunkSystemPrompt": OCR_CHUNK_SYSTEM_PROMPT,',
      '  "chunkUserPrompt": build_chunk_user_prompt("{kind}", "{image_count}"),',
      '  "cleanupSystemPrompt": DEFAULT_CLEANUP_SYSTEM_PROMPT,',
      '  "cleanupUserPrompt": DEFAULT_CLEANUP_USER_PROMPT,',
      '  "classificationSystemPrompt": DEFAULT_CLASSIFICATION_SYSTEM_PROMPT,',
      '  "classificationUserPrompt": DEFAULT_CLASSIFICATION_USER_PROMPT,',
      '}))',
    ].join('\n')
    const parsed = parseJson<typeof fallback>(
      execFileSync(pythonCommand(), ['-c', code], {
        cwd: pythonRoot,
        env: pythonEnv(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      fallback
    )
    return {
      ...fallback,
      ...parsed,
      assistantCleanSystemPrompt: parsed.assistantCleanSystemPrompt || DEFAULT_ASSISTANT_CLEAN_SYSTEM_PROMPT,
      assistantCleanUserPrompt: parsed.assistantCleanUserPrompt || DEFAULT_ASSISTANT_CLEAN_USER_PROMPT,
    }
  } catch {
    return fallback
  }
}

export function readOcrPromptSettings() {
  const promptPath = ocrPromptSettingsPath()
  const defaults = readEffectivePromptDefaults()
  if (!fs.existsSync(promptPath)) return defaults
  const payload = parseJson<Record<string, string>>(fs.readFileSync(promptPath, 'utf8'), {})
  const promptValue = (key: string, fallback: string) => {
    const value = String(payload[key] || '')
    if (key === 'classification_system_prompt' && value.trim().startsWith(LEGACY_CLASSIFICATION_SYSTEM_PROMPT_PREFIX)) {
      return SIMPLIFIED_CLASSIFICATION_SYSTEM_PROMPT
    }
    if (
      (key === 'assistant_clean_system_prompt' || key === 'assistant_clean_user_prompt') &&
      LEGACY_ASSISTANT_SCORING_PROMPT_MARKERS.some((marker) => value.includes(marker))
    ) {
      return fallback
    }
    if (
      key === 'assistant_clean_system_prompt' &&
      value.includes(LEGACY_ASSISTANT_MISSING_SCORE_REMOVAL_MARKER) &&
      (!value.includes('评分标记') || !value.includes('适当整理'))
    ) {
      return fallback
    }
    if (
      key === 'assistant_clean_user_prompt' &&
      value.includes('明确噪声') &&
      (!value.includes('评分标记') || !value.includes('排版'))
    ) {
      return fallback
    }
    return value && !value.includes('�') ? value : fallback
  }
  return {
    wholeSystemPrompt: promptValue('whole_system_prompt', defaults.wholeSystemPrompt),
    wholeUserPrompt: promptValue('whole_user_prompt', defaults.wholeUserPrompt),
    chunkSystemPrompt: promptValue('chunk_system_prompt', defaults.chunkSystemPrompt),
    chunkUserPrompt: promptValue('chunk_user_prompt', defaults.chunkUserPrompt),
    cleanupSystemPrompt: promptValue('cleanup_system_prompt', defaults.cleanupSystemPrompt),
    cleanupUserPrompt: promptValue('cleanup_user_prompt', defaults.cleanupUserPrompt),
    classificationSystemPrompt: promptValue('classification_system_prompt', defaults.classificationSystemPrompt),
    classificationUserPrompt: promptValue('classification_user_prompt', defaults.classificationUserPrompt),
    assistantCleanSystemPrompt: promptValue('assistant_clean_system_prompt', defaults.assistantCleanSystemPrompt),
    assistantCleanUserPrompt: promptValue('assistant_clean_user_prompt', defaults.assistantCleanUserPrompt),
  }
}

export function writeOcrPromptSettings(input: Record<string, unknown>) {
  const existing = readOcrPromptSettings()
  const payload = {
    whole_system_prompt: String(input.wholeSystemPrompt ?? existing.wholeSystemPrompt ?? ''),
    whole_user_prompt: String(input.wholeUserPrompt ?? existing.wholeUserPrompt ?? ''),
    chunk_system_prompt: String(input.chunkSystemPrompt ?? existing.chunkSystemPrompt ?? ''),
    chunk_user_prompt: String(input.chunkUserPrompt ?? existing.chunkUserPrompt ?? ''),
    cleanup_system_prompt: String(input.cleanupSystemPrompt ?? existing.cleanupSystemPrompt ?? ''),
    cleanup_user_prompt: String(input.cleanupUserPrompt ?? existing.cleanupUserPrompt ?? ''),
    classification_system_prompt: String(input.classificationSystemPrompt ?? existing.classificationSystemPrompt ?? ''),
    classification_user_prompt: String(input.classificationUserPrompt ?? existing.classificationUserPrompt ?? ''),
    assistant_clean_system_prompt: String(input.assistantCleanSystemPrompt ?? existing.assistantCleanSystemPrompt ?? DEFAULT_ASSISTANT_CLEAN_SYSTEM_PROMPT),
    assistant_clean_user_prompt: String(input.assistantCleanUserPrompt ?? existing.assistantCleanUserPrompt ?? DEFAULT_ASSISTANT_CLEAN_USER_PROMPT),
  }
  fs.writeFileSync(ocrPromptSettingsPath(), `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  return readOcrPromptSettings()
}

export function readAssistantPromptSettings() {
  const settings = readOcrPromptSettings()
  return {
    systemPrompt: settings.assistantCleanSystemPrompt || DEFAULT_ASSISTANT_CLEAN_SYSTEM_PROMPT,
    userPrompt: settings.assistantCleanUserPrompt || DEFAULT_ASSISTANT_CLEAN_USER_PROMPT,
  }
}

export function readOcrSettings() {
  const values = readOcrEnvValues()
  return {
    ...readAppSettings(),
    sofficeAvailable: Boolean(sofficePath()),
    sofficeDetectedPath: sofficePath(),
    ocrProvider: normalizeOcrProvider(values.OCR_PROVIDER) === 'glm' ? 'glm' : 'doc2x',
    apiBaseUrl: values.OCR_API_BASE_URL || '',
    apiKeyConfigured: Boolean(values.OCR_API_KEY || process.env.OCR_API_KEY),
    model: values.OCR_MODEL || '',
    dryRun: values.OCR_DRY_RUN || 'false',
    maxItems: values.OCR_MAX_ITEMS || '10',
    concurrency: clampWorkerCount(values.OCR_CONCURRENCY || '20'),
    maxRetries: values.OCR_MAX_RETRIES || '2',
    retryDelaySeconds: values.OCR_RETRY_DELAY_SECONDS || '3',
    imageMaxWidth: values.OCR_IMAGE_MAX_WIDTH || '900',
    topK: values.OCR_TOP_K || '1',
    doc2xApiBaseUrl: values.DOC2X_API_BASE_URL || 'https://v2.doc2x.noedgeai.com',
    doc2xApiKeyConfigured: Boolean(values.DOC2X_API_KEY || process.env.DOC2X_API_KEY),
    doc2xModel: values.DOC2X_MODEL || 'v3-2026',
    glmOcrApiBaseUrl: values.GLM_OCR_API_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/layout_parsing',
    glmOcrApiKeyConfigured: Boolean(values.GLM_OCR_API_KEY || process.env.GLM_OCR_API_KEY),
    glmOcrModel: values.GLM_OCR_MODEL || 'glm-ocr',
    cleanupApiBaseUrl: values.OCR_CLEANUP_API_BASE_URL || 'https://api.deepseek.com',
    cleanupApiKeyConfigured: Boolean(values.OCR_CLEANUP_API_KEY || process.env.OCR_CLEANUP_API_KEY),
    cleanupModel: values.OCR_CLEANUP_MODEL || 'deepseek-v4-flash',
    cleanupConcurrency: clampWorkerCount(values.OCR_CLEANUP_CONCURRENCY || values.OCR_CONCURRENCY || '20'),
    classificationEnabled: values.OCR_CLASSIFICATION_ENABLED || 'true',
    ...readOcrPromptSettings(),
  }
}

export function readAssistantModelSettings() {
  const values = readOcrEnvValues()
  const timeoutSeconds = Number.parseInt(String(process.env.OCR_CLEANUP_TIMEOUT_SECONDS || values.OCR_CLEANUP_TIMEOUT_SECONDS || '60'), 10)
  return {
    apiBaseUrl: process.env.OCR_CLEANUP_API_BASE_URL || values.OCR_CLEANUP_API_BASE_URL || process.env.OCR_API_BASE_URL || values.OCR_API_BASE_URL || 'https://api.deepseek.com',
    apiKey: process.env.OCR_CLEANUP_API_KEY || values.OCR_CLEANUP_API_KEY || process.env.OCR_API_KEY || values.OCR_API_KEY || '',
    model: process.env.OCR_CLEANUP_MODEL || values.OCR_CLEANUP_MODEL || process.env.OCR_MODEL || values.OCR_MODEL || 'deepseek-v4-flash',
    timeoutSeconds: Number.isFinite(timeoutSeconds) ? Math.max(10, timeoutSeconds) : 60,
  }
}

export function writeOcrSettings(input: Record<string, unknown>) {
  const envPath = ocrEnvPath()
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const values: Record<string, string> = {}
  for (const line of existing.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#') || !line.includes('=')) continue
    const [key, ...rest] = line.split('=')
    values[key.trim()] = rest.join('=').trim()
  }
  const map: Record<string, string> = {
    OCR_PROVIDER: normalizeOcrProvider(input.ocrProvider ?? values.OCR_PROVIDER) === 'glm' ? 'glm' : 'doc2x',
    OCR_API_BASE_URL: String(input.apiBaseUrl ?? values.OCR_API_BASE_URL ?? ''),
    OCR_API_KEY: String(input.apiKey || values.OCR_API_KEY || ''),
    OCR_MODEL: String(input.model ?? values.OCR_MODEL ?? ''),
    OCR_DRY_RUN: String(input.dryRun ?? values.OCR_DRY_RUN ?? 'false'),
    OCR_MAX_ITEMS: String(input.maxItems ?? values.OCR_MAX_ITEMS ?? '10'),
    OCR_CONCURRENCY: clampWorkerCount(input.concurrency ?? values.OCR_CONCURRENCY ?? '20'),
    OCR_MAX_RETRIES: String(input.maxRetries ?? values.OCR_MAX_RETRIES ?? '2'),
    OCR_RETRY_DELAY_SECONDS: String(input.retryDelaySeconds ?? values.OCR_RETRY_DELAY_SECONDS ?? '3'),
    OCR_IMAGE_MAX_WIDTH: String(input.imageMaxWidth ?? values.OCR_IMAGE_MAX_WIDTH ?? '900'),
    OCR_TOP_K: String(input.topK ?? values.OCR_TOP_K ?? '1'),
    DOC2X_API_BASE_URL: String(input.doc2xApiBaseUrl ?? values.DOC2X_API_BASE_URL ?? 'https://v2.doc2x.noedgeai.com'),
    DOC2X_API_KEY: String(input.doc2xApiKey || values.DOC2X_API_KEY || ''),
    DOC2X_MODEL: String(input.doc2xModel ?? values.DOC2X_MODEL ?? 'v3-2026'),
    GLM_OCR_API_BASE_URL: String(input.glmOcrApiBaseUrl ?? values.GLM_OCR_API_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4/layout_parsing'),
    GLM_OCR_API_KEY: String(input.glmOcrApiKey || values.GLM_OCR_API_KEY || ''),
    GLM_OCR_MODEL: String(input.glmOcrModel ?? values.GLM_OCR_MODEL ?? 'glm-ocr'),
    OCR_CLEANUP_API_BASE_URL: String(input.cleanupApiBaseUrl ?? values.OCR_CLEANUP_API_BASE_URL ?? 'https://api.deepseek.com'),
    OCR_CLEANUP_API_KEY: String(input.cleanupApiKey || values.OCR_CLEANUP_API_KEY || ''),
    OCR_CLEANUP_MODEL: String(input.cleanupModel ?? values.OCR_CLEANUP_MODEL ?? 'deepseek-v4-flash'),
    OCR_CLEANUP_CONCURRENCY: clampWorkerCount(input.cleanupConcurrency ?? values.OCR_CLEANUP_CONCURRENCY ?? values.OCR_CONCURRENCY ?? '20'),
    OCR_CLASSIFICATION_ENABLED: String(input.classificationEnabled ?? values.OCR_CLASSIFICATION_ENABLED ?? 'true'),
  }
  const passthroughKeys = Object.keys(values).filter((key) => !(key in map))
  const lines = [...Object.entries(map), ...passthroughKeys.map((key) => [key, values[key]] as [string, string])]
    .map(([key, value]) => `${key}=${value}`)
  fs.writeFileSync(envPath, `${lines.join('\n')}\n`, { mode: 0o600 })
  writeAppSettings(input)
  writeOcrPromptSettings(input)
  return readOcrSettings()
}

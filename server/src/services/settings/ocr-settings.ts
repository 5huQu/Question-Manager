import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { storageRoot, pythonRoot } from '../../config.js'
import { parseJson } from '../../utils/json.js'
import { pythonCommand } from './python.js'
import { readAppSettings, writeAppSettings } from './app-settings.js'
import { sofficePath } from './tools.js'

type OcrProvider = 'legacy' | 'doc2x' | 'glm'

export function ocrEnvPath() {
  const configDir = path.join(storageRoot, 'config')
  fs.mkdirSync(configDir, { recursive: true })
  return path.join(configDir, 'ocr.env')
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
    return parseJson<typeof fallback>(
      execFileSync(pythonCommand(), ['-c', code], {
        cwd: pythonRoot,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      fallback
    )
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
  }
  fs.writeFileSync(ocrPromptSettingsPath(), `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  return readOcrPromptSettings()
}

export function readOcrSettings() {
  const envPath = ocrEnvPath()
  const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const values: Record<string, string> = {}
  for (const line of envText.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#') || !line.includes('=')) continue
    const [key, ...rest] = line.split('=')
    values[key.trim()] = rest.join('=').trim()
  }
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
    cleanupApiBaseUrl: values.OCR_CLEANUP_API_BASE_URL || values.OCR_API_BASE_URL || '',
    cleanupApiKeyConfigured: Boolean(values.OCR_CLEANUP_API_KEY || process.env.OCR_CLEANUP_API_KEY || values.OCR_API_KEY || process.env.OCR_API_KEY),
    cleanupModel: values.OCR_CLEANUP_MODEL || values.OCR_MODEL || '',
    cleanupConcurrency: clampWorkerCount(values.OCR_CLEANUP_CONCURRENCY || values.OCR_CONCURRENCY || '20'),
    classificationEnabled: values.OCR_CLASSIFICATION_ENABLED || 'true',
    ...readOcrPromptSettings(),
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
    OCR_CLEANUP_API_BASE_URL: String(input.cleanupApiBaseUrl ?? values.OCR_CLEANUP_API_BASE_URL ?? values.OCR_API_BASE_URL ?? ''),
    OCR_CLEANUP_API_KEY: String(input.cleanupApiKey || values.OCR_CLEANUP_API_KEY || ''),
    OCR_CLEANUP_MODEL: String(input.cleanupModel ?? values.OCR_CLEANUP_MODEL ?? values.OCR_MODEL ?? ''),
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

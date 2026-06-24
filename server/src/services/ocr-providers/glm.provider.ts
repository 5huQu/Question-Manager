import fs from 'node:fs'
import path from 'node:path'
import { ocrEnvPath } from '../settings/ocr-settings.js'

const DEFAULT_GLM_OCR_API_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/layout_parsing'
const DEFAULT_GLM_OCR_MODEL = 'glm-ocr'

export class GlmOcrProviderError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message)
    this.name = 'GlmOcrProviderError'
  }
}

type GlmOcrConfig = {
  apiKey: string
  apiBaseUrl: string
  model: string
  maxRetries: number
}

function readOcrEnvValues() {
  const values: Record<string, string> = {}
  const envPath = ocrEnvPath()
  if (!fs.existsSync(envPath)) return values
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#') || !line.includes('=')) continue
    const [key, ...rest] = line.split('=')
    values[key.trim()] = rest.join('=').trim()
  }
  return values
}

function glmOcrConfig(): GlmOcrConfig {
  const envValues = readOcrEnvValues()
  const apiKey = String(process.env.GLM_OCR_API_KEY || envValues.GLM_OCR_API_KEY || '').trim()
  if (!apiKey) throw new GlmOcrProviderError('缺少 GLM-OCR 配置：请在 OCR 设置中配置 GLM-OCR API Key。')

  return {
    apiKey,
    apiBaseUrl: String(process.env.GLM_OCR_API_BASE_URL || envValues.GLM_OCR_API_BASE_URL || DEFAULT_GLM_OCR_API_BASE_URL).trim(),
    model: String(process.env.GLM_OCR_MODEL || envValues.GLM_OCR_MODEL || DEFAULT_GLM_OCR_MODEL).trim(),
    maxRetries: Math.max(0, Math.min(5, Number.parseInt(String(process.env.OCR_MAX_RETRIES || envValues.OCR_MAX_RETRIES || 2), 10) || 0)),
  }
}

function mimeTypeFor(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.pdf': return 'application/pdf'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    default: throw new GlmOcrProviderError('GLM-OCR 仅支持 PDF、JPG 和 PNG 文件。')
  }
}

function inputSizeLimitFor(filePath: string) {
  return path.extname(filePath).toLowerCase() === '.pdf' ? 50 * 1024 * 1024 : 10 * 1024 * 1024
}

function stringField(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  for (const key of keys) {
    const field = record[key]
    if (typeof field === 'string' && field.trim()) return field.trim()
    if (typeof field === 'number') return String(field)
  }
  return ''
}

function responseMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback
  const value = payload as Record<string, unknown>
  const error = value.error
  const code = stringField(error, ['code', 'type']) || stringField(value, ['code', 'type'])
  const message = stringField(error, ['message', 'msg', 'detail']) || stringField(value, ['message', 'msg', 'detail'])
  if (code && message) return `${code}: ${message}`
  if (message) return message
  try {
    return JSON.stringify(payload).slice(0, 1600)
  } catch {
    return fallback
  }
}

export function assertGlmOcrConfigured() {
  glmOcrConfig()
}

export async function callGlmLayoutParsing(input: { filePath: string; requestId: string }) {
  const config = glmOcrConfig()
  if (!input.filePath || !fs.existsSync(input.filePath)) {
    throw new GlmOcrProviderError('找不到 v2 OCR 的原始资料文件。')
  }

  const bytes = fs.readFileSync(input.filePath)
  if (bytes.length > inputSizeLimitFor(input.filePath)) {
    throw new GlmOcrProviderError('GLM-OCR 输入文件超过大小限制：PDF 最大 50MB，图片最大 10MB。')
  }

  const body = {
    model: config.model,
    file: `data:${mimeTypeFor(input.filePath)};base64,${bytes.toString('base64')}`,
    return_crop_images: true,
    need_layout_visualization: true,
    request_id: input.requestId,
    user_id: 'question-manager-import-flow-v2',
  }

  let lastError: unknown
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      const response = await fetch(config.apiBaseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15 * 60 * 1000),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.ok) {
        return {
          payload,
          metadata: {
            requestId: input.requestId,
            model: config.model,
            apiBaseUrl: config.apiBaseUrl,
          },
        }
      }
      const message = `GLM-OCR HTTP ${response.status}: ${responseMessage(payload, response.statusText)}`
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === config.maxRetries) {
        throw new GlmOcrProviderError(message, payload)
      }
      lastError = new GlmOcrProviderError(message, payload)
    } catch (error) {
      if (error instanceof GlmOcrProviderError) throw error
      lastError = error
      if (attempt === config.maxRetries) break
    }
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000))
  }

  throw new GlmOcrProviderError(`GLM-OCR 请求失败：${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

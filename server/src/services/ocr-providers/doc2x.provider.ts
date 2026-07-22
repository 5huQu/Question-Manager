import fs from 'node:fs'
import path from 'node:path'
import { ocrEnvPath } from '../settings/ocr-settings.js'

const DEFAULT_DOC2X_API_BASE_URL = 'https://v2.doc2x.noedgeai.com'
const DEFAULT_DOC2X_MODEL = 'v3-2026'

export class Doc2xProviderError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message)
    this.name = 'Doc2xProviderError'
  }
}

type Doc2xConfig = {
  apiKey: string
  apiBaseUrl: string
  model: string
  pollSeconds: number
  maxRetries: number
  timeoutSeconds: number
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

function numberFromEnv(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function doc2xConfig(): Doc2xConfig {
  const envValues = readOcrEnvValues()
  const apiKey = String(process.env.DOC2X_API_KEY || envValues.DOC2X_API_KEY || '').trim()
  if (!apiKey) throw new Doc2xProviderError('缺少 Doc2X 配置：请在 OCR 设置中配置 Doc2X API Key。')

  return {
    apiKey,
    apiBaseUrl: String(process.env.DOC2X_API_BASE_URL || envValues.DOC2X_API_BASE_URL || DEFAULT_DOC2X_API_BASE_URL).trim().replace(/\/+$/, ''),
    model: String(process.env.DOC2X_MODEL || envValues.DOC2X_MODEL || DEFAULT_DOC2X_MODEL).trim(),
    pollSeconds: numberFromEnv(process.env.DOC2X_POLL_SECONDS || envValues.DOC2X_POLL_SECONDS, 3, 1, 60),
    maxRetries: Math.floor(numberFromEnv(process.env.OCR_MAX_RETRIES || envValues.OCR_MAX_RETRIES, 3, 0, 5)),
    timeoutSeconds: Math.floor(numberFromEnv(process.env.DOC2X_TIMEOUT_SECONDS || envValues.DOC2X_TIMEOUT_SECONDS, 90, 10, 600)),
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function responseMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback
  const value = payload as Record<string, unknown>
  const message = String(value.msg || value.message || value.detail || '').trim()
  const code = String(value.code || value.type || '').trim()
  if (code && message) return `${code}: ${message}`
  if (message) return message
  try {
    return JSON.stringify(payload).slice(0, 1600)
  } catch {
    return fallback
  }
}

async function fetchJson(config: Doc2xConfig, endpoint: string, init: RequestInit = {}) {
  let lastError: unknown
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      const response = await fetch(config.apiBaseUrl + endpoint, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers || {}),
        },
        signal: AbortSignal.timeout(config.timeoutSeconds * 1000),
      })
      const payload = await response.json().catch(() => ({}))
      const payloadRecord = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
      const code = typeof payloadRecord.code === 'string' ? payloadRecord.code : ''
      if (response.ok && (!code || code === 'success')) return payload
      const message = `Doc2X HTTP ${response.status}: ${responseMessage(payload, response.statusText)}`
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === config.maxRetries) {
        throw new Doc2xProviderError(message, payload)
      }
      lastError = new Doc2xProviderError(message, payload)
    } catch (error) {
      if (error instanceof Doc2xProviderError) throw error
      lastError = error
      if (attempt === config.maxRetries) break
    }
    await sleep(config.pollSeconds * (attempt + 1) * 1000)
  }
  throw new Doc2xProviderError(`Doc2X 网络请求失败：${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function preuploadPayload(payload: unknown) {
  const data = payload && typeof payload === 'object' ? (payload as Record<string, any>).data : {}
  const uid = String(data?.uid || '').trim()
  const url = String(data?.url || '').replace(/\\u0026/g, '&').trim()
  if (!uid || !url) throw new Doc2xProviderError('Doc2X 预上传响应缺少 uid 或 url。', payload)
  return { uid, url }
}

async function uploadFile(uploadUrl: string, filePath: string, timeoutSeconds: number) {
  const parsed = new URL(uploadUrl)
  if (parsed.protocol !== 'https:') throw new Doc2xProviderError('Doc2X 返回了无效上传地址。')
  const bytes = fs.readFileSync(filePath)
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.length),
    },
    body: bytes,
    signal: AbortSignal.timeout(Math.max(timeoutSeconds, 240) * 1000),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Doc2xProviderError(`Doc2X 上传失败：HTTP ${response.status} ${text.slice(0, 500)}`)
  }
}

function statusPayload(payload: unknown) {
  const root = payload && typeof payload === 'object' ? payload as Record<string, any> : {}
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, any> : {}
  return {
    status: String(data.status || '').trim(),
    detail: data.detail || data.message || root.msg || root.message || '',
    progress: Number(data.progress || 0),
  }
}

export function assertDoc2xConfigured() {
  doc2xConfig()
}

export function assertDoc2xInputSupported(filePath: string) {
  if (path.extname(filePath).toLowerCase() !== '.pdf') {
    throw new Doc2xProviderError('Doc2X V2 首版仅支持 PDF 资料；图片资料请在 OCR 设置中切换到 GLM-OCR 后识别。')
  }
}

type Doc2xProgress = {
  uid: string
  phase: string
  progress: number
}

async function pollDoc2xParsing(input: {
  uid: string
  onProgress?: (progress: Doc2xProgress) => void
}) {
  const config = doc2xConfig()
  while (true) {
    const payload = await fetchJson(config, '/api/v2/parse/status?uid=' + encodeURIComponent(input.uid), { method: 'GET' })
    const status = statusPayload(payload)
    input.onProgress?.({ uid: input.uid, phase: status.status || 'processing', progress: status.progress })
    if (status.status === 'success') {
      return {
        payload,
        metadata: {
          uid: input.uid,
          model: config.model,
          apiBaseUrl: config.apiBaseUrl,
          remoteProgress: status.progress,
        },
      }
    }
    if (status.status === 'failed') {
      throw new Doc2xProviderError(`Doc2X 文档解析失败：${status.detail || '未知错误'}`, payload)
    }
    await sleep(config.pollSeconds * 1000)
  }
}

export async function resumeDoc2xParsing(input: {
  uid: string
  onProgress?: (progress: Doc2xProgress) => void
}) {
  if (!input.uid) throw new Doc2xProviderError('Doc2X 恢复任务缺少 uid。')
  return pollDoc2xParsing(input)
}

export async function callDoc2xParsing(input: {
  filePath: string
  onProgress?: (progress: Doc2xProgress) => void
}) {
  const config = doc2xConfig()
  if (!input.filePath || !fs.existsSync(input.filePath)) {
    throw new Doc2xProviderError('找不到 v2 OCR 的原始资料文件。')
  }
  assertDoc2xInputSupported(input.filePath)

  const preupload = preuploadPayload(await fetchJson(config, '/api/v2/parse/preupload', {
    method: 'POST',
    body: JSON.stringify({ model: config.model }),
  }))
  input.onProgress?.({ uid: preupload.uid, phase: 'uploading', progress: 0 })
  await uploadFile(preupload.url, input.filePath, config.timeoutSeconds)
  input.onProgress?.({ uid: preupload.uid, phase: 'processing', progress: 0 })
  return pollDoc2xParsing({ uid: preupload.uid, onProgress: input.onProgress })
}

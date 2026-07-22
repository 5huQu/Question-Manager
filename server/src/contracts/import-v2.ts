import { RouteError } from '../utils/http-error.js'
import type {
  ImportV2ImportJobDocumentRole,
  ImportV2ImportJobMode,
  ImportV2OcrProvider,
} from '../../../shared/contracts/import-v2.js'

const ocrProviders = ['doc2x', 'glm'] as const satisfies readonly ImportV2OcrProvider[]
const importJobModes = ['single_document', 'separated_documents'] as const satisfies readonly ImportV2ImportJobMode[]
const documentRoles = ['full', 'questions', 'solutions'] as const satisfies readonly ImportV2ImportJobDocumentRole[]

type FieldRule = {
  optional?: boolean
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object'
  enum?: readonly string[]
}

export type ObjectContract = Record<string, FieldRule>

function actualType(value: unknown) {
  if (Array.isArray(value)) return 'array'
  if (value !== null && typeof value === 'object') return 'object'
  return typeof value
}

export function parseObject(value: unknown, contract: ObjectContract, label = '请求体'): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError(`${label}必须是 JSON 对象。`)
  }
  const body = value as Record<string, unknown>
  for (const [field, rule] of Object.entries(contract)) {
    const fieldValue = body[field]
    if (fieldValue === undefined || fieldValue === null) {
      if (!rule.optional) throw validationError(`缺少字段 ${field}。`, field)
      continue
    }
    if (rule.type && actualType(fieldValue) !== rule.type) {
      throw validationError(`字段 ${field} 必须是 ${rule.type}。`, field)
    }
    if (rule.enum && (typeof fieldValue !== 'string' || !rule.enum.includes(fieldValue))) {
      throw validationError(`字段 ${field} 的值无效。`, field, { allowed: rule.enum })
    }
  }
  return body
}

export function parseOptionalObject(value: unknown, contract: ObjectContract, label = '请求体') {
  return parseObject(value ?? {}, contract, label)
}

export function validateJsonObjectField(body: Record<string, unknown>, field: string) {
  const value = body[field]
  if (value === undefined || value === '') return body
  if (typeof value !== 'string') throw validationError(`字段 ${field} 必须是 JSON 字符串。`, field)
  try {
    const parsed = JSON.parse(value)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
  } catch {
    throw validationError(`字段 ${field} 必须是合法的 JSON 对象。`, field)
  }
  return body
}

export function assertResponseObject(value: unknown, requiredKeys: readonly string[]) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RouteError(500, 'API 响应不符合契约。')
  }
  const record = value as Record<string, unknown>
  const missing = requiredKeys.filter((key) => !(key in record))
  if (missing.length) throw new RouteError(500, `API 响应缺少字段：${missing.join(', ')}。`)
  return value
}

export function validationError(message: string, field?: string, details?: Record<string, unknown>) {
  return new RouteError(400, message, undefined, {
    error: message,
    code: 'VALIDATION_ERROR',
    ...(field ? { field } : {}),
    ...(details ? { details } : {}),
  })
}

export const contracts = {
  createJob: {
    name: { type: 'string', optional: true },
    mode: { type: 'string', enum: importJobModes, optional: true },
  },
  updateJob: {
    name: { type: 'string', optional: true },
    mode: { type: 'string', enum: importJobModes, optional: true },
  },
  addJobDocument: {
    sourceDocumentId: { type: 'string' },
    role: { type: 'string', enum: documentRoles },
    sortOrder: { type: 'number', optional: true },
  },
  startOcr: {
    provider: { type: 'string', enum: ocrProviders, optional: true },
    force: { type: 'boolean', optional: true },
  },
  markdown: { markdown: { type: 'string' } },
  candidateIds: { candidateIds: { type: 'array' } },
  sourceUpload: { metadata: { type: 'string', optional: true } },
  candidateFigureUpload: {
    usage: { type: 'string', enum: ['stem', 'analysis', 'options'], optional: true },
    optionLabel: { type: 'string', optional: true },
  },
} satisfies Record<string, ObjectContract>

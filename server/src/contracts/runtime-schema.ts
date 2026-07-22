import { RouteError } from '../utils/http-error.js'

type BaseSchema = { optional?: boolean; nullable?: boolean }
export type RuntimeSchema = BaseSchema & (
  | { kind: 'unknown' }
  | { kind: 'string'; enum?: readonly string[]; minLength?: number }
  | { kind: 'number'; integer?: boolean; min?: number; max?: number }
  | { kind: 'boolean' }
  | { kind: 'array'; items: RuntimeSchema; minLength?: number; maxLength?: number }
  | { kind: 'tuple'; items: readonly RuntimeSchema[] }
  | { kind: 'union'; options: readonly RuntimeSchema[] }
  | { kind: 'record'; values: RuntimeSchema }
  | { kind: 'object'; properties: Record<string, RuntimeSchema>; allowUnknown?: boolean; partial?: boolean }
)

function withFlags<T extends RuntimeSchema>(schema: T, flags: BaseSchema) {
  return { ...schema, ...flags } as T
}

export const schema = {
  unknown: (): RuntimeSchema => ({ kind: 'unknown' }),
  string: (options: Omit<Extract<RuntimeSchema, { kind: 'string' }>, 'kind'> = {}): RuntimeSchema => ({ kind: 'string', ...options }),
  number: (options: Omit<Extract<RuntimeSchema, { kind: 'number' }>, 'kind'> = {}): RuntimeSchema => ({ kind: 'number', ...options }),
  boolean: (): RuntimeSchema => ({ kind: 'boolean' }),
  array: (items: RuntimeSchema, options: { minLength?: number; maxLength?: number } = {}): RuntimeSchema => ({ kind: 'array', items, ...options }),
  tuple: (...items: RuntimeSchema[]): RuntimeSchema => ({ kind: 'tuple', items }),
  union: (...options: RuntimeSchema[]): RuntimeSchema => ({ kind: 'union', options }),
  record: (values: RuntimeSchema = { kind: 'unknown' }): RuntimeSchema => ({ kind: 'record', values }),
  object: (properties: Record<string, RuntimeSchema>, options: { allowUnknown?: boolean; partial?: boolean } = {}): RuntimeSchema => ({ kind: 'object', properties, ...options }),
  optional: <T extends RuntimeSchema>(value: T): T => withFlags(value, { optional: true }),
  nullable: <T extends RuntimeSchema>(value: T): T => withFlags(value, { nullable: true }),
}

function failure(path: string, message: string, response: boolean): never {
  const text = `${path}${message}`
  if (response) throw new RouteError(500, `API 响应不符合契约：${text}`)
  throw new RouteError(400, text, undefined, { error: text, code: 'VALIDATION_ERROR', field: path })
}

function validate(value: unknown, target: RuntimeSchema, path: string, response: boolean): unknown {
  if (value === undefined) {
    if (target.optional) return value
    return failure(path, '不能为空。', response)
  }
  if (value === null) {
    if (target.nullable) return value
    return failure(path, '不能为 null。', response)
  }
  switch (target.kind) {
    case 'unknown': return value
    case 'string': {
      if (typeof value !== 'string') return failure(path, '必须是字符串。', response)
      if (target.enum && !target.enum.includes(value)) return failure(path, `必须是以下值之一：${target.enum.join('、')}。`, response)
      if (target.minLength !== undefined && value.length < target.minLength) return failure(path, `长度不能小于 ${target.minLength}。`, response)
      return value
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return failure(path, '必须是有限数字。', response)
      if (target.integer && !Number.isInteger(value)) return failure(path, '必须是整数。', response)
      if (target.min !== undefined && value < target.min) return failure(path, `不能小于 ${target.min}。`, response)
      if (target.max !== undefined && value > target.max) return failure(path, `不能大于 ${target.max}。`, response)
      return value
    }
    case 'boolean':
      if (typeof value !== 'boolean') return failure(path, '必须是布尔值。', response)
      return value
    case 'array':
      if (!Array.isArray(value)) return failure(path, '必须是数组。', response)
      if (target.minLength !== undefined && value.length < target.minLength) return failure(path, `至少包含 ${target.minLength} 项。`, response)
      if (target.maxLength !== undefined && value.length > target.maxLength) return failure(path, `最多包含 ${target.maxLength} 项。`, response)
      value.forEach((item, index) => validate(item, target.items, `${path}[${index}]`, response))
      return value
    case 'tuple':
      if (!Array.isArray(value) || value.length !== target.items.length) return failure(path, `必须是长度为 ${target.items.length} 的数组。`, response)
      target.items.forEach((item, index) => validate(value[index], item, `${path}[${index}]`, response))
      return value
    case 'union':
      for (const option of target.options) {
        try { return validate(value, option, path, response) } catch { /* try the next allowed shape */ }
      }
      return failure(path, '不符合任何允许的格式。', response)
    case 'record':
      if (!value || typeof value !== 'object' || Array.isArray(value)) return failure(path, '必须是对象。', response)
      Object.entries(value).forEach(([key, item]) => validate(item, target.values, `${path}.${key}`, response))
      return value
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return failure(path, '必须是对象。', response)
      const record = value as Record<string, unknown>
      for (const [key, child] of Object.entries(target.properties)) {
        const childSchema = target.partial ? schema.optional(child) : child
        validate(record[key], childSchema, `${path}.${key}`, response)
      }
      if (!target.allowUnknown) {
        const unknown = Object.keys(record).find((key) => !(key in target.properties))
        if (unknown) return failure(`${path}.${unknown}`, '不是允许的字段。', response)
      }
      return value
    }
  }
}

export function parseWithSchema<T>(value: unknown, target: RuntimeSchema, label = '请求体') {
  return validate(value, target, label, false) as T
}

export function assertWithSchema<T>(value: unknown, target: RuntimeSchema, label = '响应体') {
  return validate(value, target, label, true) as T
}

import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from '../../config.js'
import { RouteError } from '../../utils/http-error.js'
import { defaultParserConfig, type ImportFlowV2ParserConfig } from './default-parser-config.js'

const configPath = path.join(dataDir, 'config', 'import-flow-v2-parser.json')
const listKeys = ['sectionHeadings', 'documentNoteKeywords', 'solutionSectionKeywords', 'primaryQuestionPatterns', 'subQuestionPatterns', 'figureKeywords'] as const

function cloneDefault() {
  return structuredClone(defaultParserConfig)
}

function normalizeList(value: unknown, key: string, fallback: string[]) {
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new RouteError(400, `导入识别规则中的「${key}」必须是一组文本。`)
  return value.map((item) => item.trim()).filter(Boolean)
}

export function normalizeParserConfig(value: unknown): ImportFlowV2ParserConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RouteError(400, '导入识别规则文件格式不正确，请恢复默认规则后重试。')
  const raw = value as Record<string, unknown>
  const config = cloneDefault()
  if (raw.version !== undefined && (!Number.isInteger(raw.version) || Number(raw.version) < 1)) throw new RouteError(400, '导入识别规则的版本号不正确。')
  config.version = Number(raw.version ?? config.version)
  for (const key of listKeys) config[key] = normalizeList(raw[key], key, config[key])
  if (raw.allowParenthesizedNumberAsPrimary !== undefined && typeof raw.allowParenthesizedNumberAsPrimary !== 'boolean') {
    throw new RouteError(400, '“允许括号数字作为主题号”必须是是或否。')
  }
  config.allowParenthesizedNumberAsPrimary = raw.allowParenthesizedNumberAsPrimary ?? config.allowParenthesizedNumberAsPrimary
  for (const pattern of [...config.primaryQuestionPatterns, ...config.subQuestionPatterns]) {
    try { new RegExp(pattern) } catch { throw new RouteError(400, `题号规则包含无效表达式：${pattern}`) }
  }
  return config
}

function readUserConfig() {
  if (!fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {
    throw new RouteError(400, '导入识别规则文件不是有效 JSON，请在设置页恢复默认规则。')
  }
}

export function getParserConfig(): ImportFlowV2ParserConfig {
  try {
    const userConfig = readUserConfig()
    return userConfig ? normalizeParserConfig(userConfig) : cloneDefault()
  } catch {
    // 解析任务必须可继续运行；设置页 GET/PUT 会给出明确错误以便修复该文件。
    return cloneDefault()
  }
}

export function getParserConfigForApi(): ImportFlowV2ParserConfig {
  const userConfig = readUserConfig()
  return userConfig ? normalizeParserConfig(userConfig) : cloneDefault()
}

export function saveParserConfig(value: unknown): ImportFlowV2ParserConfig {
  const config = normalizeParserConfig(value)
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
  return config
}

export function resetParserConfig(): ImportFlowV2ParserConfig {
  fs.rmSync(configPath, { force: true })
  return cloneDefault()
}

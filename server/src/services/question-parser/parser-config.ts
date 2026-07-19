import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from '../../config.js'
import { RouteError } from '../../utils/http-error.js'
import { createId, nowIso } from '../../utils/ids.js'
import {
  defaultParserConfig,
  type AnswerTablePolicy,
  type ImportFlowV2ParserConfig,
  type MetadataBlockPolicy,
  type SolutionBindingStrategy,
} from './default-parser-config.js'

const configPath = path.join(dataDir, 'config', 'import-flow-v2-parser.json')
const presetsPath = path.join(dataDir, 'config', 'import-flow-v2-parser-presets.json')
const listKeys = ['sectionHeadings', 'documentNoteKeywords', 'lectureNonQuestionSectionKeywords', 'solutionSectionKeywords', 'primaryQuestionPatterns', 'subQuestionPatterns', 'figureKeywords', 'metadataBlockKeywords'] as const
const solutionBindingStrategies: SolutionBindingStrategy[] = ['heading_then_question', 'question_then_heading', 'auto']
const metadataBlockPolicies: MetadataBlockPolicy[] = ['ignore', 'append_to_analysis', 'store_as_note']
const answerTablePolicies: AnswerTablePolicy[] = ['disabled', 'fill_empty_only', 'override_metadata_like_answer', 'prefer_table_for_choice_questions']

export type ImportParserPreset = {
  id: string
  name: string
  description: string
  config: ImportFlowV2ParserConfig
  createdAt: string
  updatedAt: string
  builtIn?: boolean
}

function cloneDefault() {
  return structuredClone(defaultParserConfig)
}

function builtinParserPresets(): ImportParserPreset[] {
  const now = 'builtin'
  return [
    {
      id: 'generic_answer_table',
      name: '通用试卷答案表',
      description: '参考答案标题后继续出现题号，答案表只填补空缺。',
      config: normalizeParserConfig({ ...defaultParserConfig, solutionBindingStrategy: 'heading_then_question', answerTablePolicy: 'fill_empty_only' }),
      createdAt: now,
      updatedAt: now,
      builtIn: true,
    },
    {
      id: 'answer_table_plus_analysis',
      name: '小题答案表 + 大题逐题解析',
      description: '选择题优先使用答案表，大题保留逐题解析。',
      config: normalizeParserConfig({ ...defaultParserConfig, solutionBindingStrategy: 'auto', answerTablePolicy: 'prefer_table_for_choice_questions' }),
      createdAt: now,
      updatedAt: now,
      builtIn: true,
    },
    {
      id: 'question_then_heading',
      name: '题号在参考答案前',
      description: '题号先出现，后面接命题说明、参考答案标题和解析正文。',
      config: normalizeParserConfig({
        ...defaultParserConfig,
        solutionBindingStrategy: 'question_then_heading',
        metadataBlockPolicy: 'ignore',
        answerTablePolicy: 'override_metadata_like_answer',
      }),
      createdAt: now,
      updatedAt: now,
      builtIn: true,
    },
    {
      id: 'heading_then_question',
      name: '题号在参考答案后',
      description: '参考答案或解析标题后继续出现题号。',
      config: normalizeParserConfig({ ...defaultParserConfig, solutionBindingStrategy: 'heading_then_question' }),
      createdAt: now,
      updatedAt: now,
      builtIn: true,
    },
    {
      id: 'mixed_inline_solution',
      name: '题干答案混排 · 有答案表',
      description: '题干中直接带答案、解析标记，同时允许答案汇总表补充空缺。',
      config: normalizeParserConfig({ ...defaultParserConfig, solutionBindingStrategy: 'auto' }),
      createdAt: now,
      updatedAt: now,
      builtIn: true,
    },
    {
      id: 'mixed_inline_solution_no_answer_table',
      name: '题干答案混排 · 无答案表',
      description: '题干中直接带答案、解析标记，完全关闭答案表检测、遮罩和合并。',
      config: normalizeParserConfig({ ...defaultParserConfig, solutionBindingStrategy: 'auto', answerTablePolicy: 'disabled' }),
      createdAt: now,
      updatedAt: now,
      builtIn: true,
    },
  ]
}

function normalizeList(value: unknown, key: string, fallback: string[]) {
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new RouteError(400, `导入识别规则中的「${key}」必须是一组文本。`)
  return value.map((item) => item.trim()).filter(Boolean)
}

function normalizeEnum<T extends string>(value: unknown, key: string, fallback: T, options: readonly T[]) {
  if (value === undefined) return fallback
  const text = String(value || '').trim()
  if (!options.includes(text as T)) {
    throw new RouteError(400, `导入识别规则中的「${key}」不正确。`)
  }
  return text as T
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
  config.solutionBindingStrategy = normalizeEnum(raw.solutionBindingStrategy, 'solutionBindingStrategy', config.solutionBindingStrategy, solutionBindingStrategies)
  config.metadataBlockPolicy = normalizeEnum(raw.metadataBlockPolicy, 'metadataBlockPolicy', config.metadataBlockPolicy, metadataBlockPolicies)
  config.answerTablePolicy = normalizeEnum(raw.answerTablePolicy, 'answerTablePolicy', config.answerTablePolicy, answerTablePolicies)
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

function normalizePreset(value: unknown): ImportParserPreset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RouteError(400, '预设格式不正确。')
  const raw = value as Record<string, unknown>
  const id = String(raw.id || '').trim()
  const name = String(raw.name || '').trim()
  if (!name) throw new RouteError(400, '预设名称不能为空。')
  return {
    id: id || createId('parser_preset', name),
    name,
    description: String(raw.description || '').trim(),
    config: normalizeParserConfig(raw.config || defaultParserConfig),
    createdAt: String(raw.createdAt || nowIso()),
    updatedAt: String(raw.updatedAt || nowIso()),
    builtIn: Boolean(raw.builtIn),
  }
}

function readUserPresets() {
  if (!fs.existsSync(presetsPath)) return []
  try {
    const value = JSON.parse(fs.readFileSync(presetsPath, 'utf8'))
    if (!Array.isArray(value)) throw new Error('not array')
    return value.map(normalizePreset).map((preset) => ({ ...preset, builtIn: false }))
  } catch {
    throw new RouteError(400, '导入规则预设文件不是有效 JSON，请检查或删除该文件后重试。')
  }
}

function writeUserPresets(presets: ImportParserPreset[]) {
  fs.mkdirSync(path.dirname(presetsPath), { recursive: true })
  fs.writeFileSync(
    presetsPath,
    JSON.stringify(presets.map(({ builtIn: _builtIn, ...preset }) => preset), null, 2),
    'utf8',
  )
}

function uniqueList(values: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const text = String(value || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
  }
  return result
}

function configForPresetRequest(presetId: string) {
  const preset = getParserPreset(presetId)
  if (!preset.builtIn) return preset.config

  const userConfig = getParserConfig()
  const merged = { ...preset.config }
  for (const key of listKeys) {
    merged[key] = uniqueList([...preset.config[key], ...userConfig[key]]) as typeof merged[typeof key]
  }
  merged.allowParenthesizedNumberAsPrimary = userConfig.allowParenthesizedNumberAsPrimary
  return normalizeParserConfig(merged)
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

export function listParserPresets() {
  const userPresets = readUserPresets()
  return { items: [...builtinParserPresets(), ...userPresets] }
}

export function getParserPreset(id: string) {
  const preset = listParserPresets().items.find((item) => item.id === id)
  if (!preset) throw new RouteError(404, '导入规则预设不存在。')
  return preset
}

export function parserConfigForRequest(value: unknown): ImportFlowV2ParserConfig {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const presetId = String(raw.presetId || '').trim()
  const baseConfig = presetId ? configForPresetRequest(presetId) : getParserConfig()
  const override = raw.configOverride || raw.config
  return override ? normalizeParserConfig({ ...baseConfig, ...(override as Record<string, unknown>) }) : baseConfig
}

export function createParserPreset(value: unknown) {
  const preset = normalizePreset(value)
  const presets = readUserPresets()
  if (builtinParserPresets().some((item) => item.id === preset.id) || presets.some((item) => item.id === preset.id)) {
    throw new RouteError(409, '同名预设 ID 已存在。')
  }
  const now = nowIso()
  const saved = { ...preset, createdAt: now, updatedAt: now, builtIn: false }
  writeUserPresets([...presets, saved])
  return { preset: saved, items: listParserPresets().items }
}

export function updateParserPreset(id: string, value: unknown) {
  if (builtinParserPresets().some((item) => item.id === id)) throw new RouteError(400, '内置预设不能修改。')
  const presets = readUserPresets()
  const index = presets.findIndex((item) => item.id === id)
  if (index < 0) throw new RouteError(404, '导入规则预设不存在。')
  const normalized = normalizePreset({ ...presets[index], ...(value as Record<string, unknown>), id })
  const saved = { ...normalized, createdAt: presets[index].createdAt, updatedAt: nowIso(), builtIn: false }
  presets[index] = saved
  writeUserPresets(presets)
  return { preset: saved, items: listParserPresets().items }
}

export function deleteParserPreset(id: string) {
  if (builtinParserPresets().some((item) => item.id === id)) throw new RouteError(400, '内置预设不能删除。')
  const presets = readUserPresets()
  const next = presets.filter((item) => item.id !== id)
  if (next.length === presets.length) throw new RouteError(404, '导入规则预设不存在。')
  writeUserPresets(next)
  return { success: true, items: listParserPresets().items }
}

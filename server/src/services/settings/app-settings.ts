import fs from 'node:fs'
import path from 'node:path'
import { storageRoot } from '../../config.js'
import { parseJson } from '../../utils/json.js'

export function appSettingsPath() {
  const configDir = path.join(storageRoot, 'config')
  fs.mkdirSync(configDir, { recursive: true })
  return path.join(configDir, 'app_settings.json')
}

export const defaultAppSettings = {
  setupCompleted: false,
  systemName: 'Question Manager',
  siteTitle: 'Question Manager',
  siteDescription: '本地优先的 PDF 切分、OCR 识别与数学题库管理工具。',
  examExportTemplate: 'builtin' as 'builtin' | 'examch',
  worksheetWatermark: '教师姓名 · 工作室',
  examWatermark: 'Qrane',
  lectureWatermark: '教师姓名 · 工作室',
  teachingStages: ['高中'],
  sofficePath: '',
}

export const teachingStageValues = ['小学', '初中', '高中', '其他']
export const teachingStageGradeMap: Record<string, string[]> = {
  小学: ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'],
  初中: ['初一', '初二', '初三'],
  高中: ['高一', '高二', '高三'],
  其他: ['其他'],
}

export function normalizeTeachingStages(value: unknown) {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，、\s]+/) : []
  const selected = source.map((item) => String(item).trim()).filter((item) => teachingStageValues.includes(item))
  return selected.length ? Array.from(new Set(selected)) : [...defaultAppSettings.teachingStages]
}

export function configuredGradeStages() {
  return Array.from(new Set(readAppSettings().teachingStages.flatMap((stage) => teachingStageGradeMap[stage] || [])))
}

export function readAppSettings() {
  const settingsPath = appSettingsPath()
  const hasSettingsFile = fs.existsSync(settingsPath)
  if (!hasSettingsFile) return { ...defaultAppSettings }
  const payload = parseJson<Record<string, unknown>>(fs.readFileSync(settingsPath, 'utf8'), {})
  return {
    setupCompleted: payload.setupCompleted === true || payload.setupCompleted === 'true',
    systemName: String(payload.systemName ?? defaultAppSettings.systemName),
    siteTitle: String(payload.siteTitle ?? defaultAppSettings.siteTitle),
    siteDescription: String(payload.siteDescription ?? defaultAppSettings.siteDescription),
    examExportTemplate: payload.examExportTemplate === 'examch' ? 'examch' as const : 'builtin' as const,
    worksheetWatermark: String(payload.worksheetWatermark ?? defaultAppSettings.worksheetWatermark),
    examWatermark: String(payload.examWatermark ?? defaultAppSettings.examWatermark),
    lectureWatermark: String(payload.lectureWatermark ?? defaultAppSettings.lectureWatermark),
    teachingStages: normalizeTeachingStages(payload.teachingStages),
    sofficePath: String(payload.sofficePath ?? defaultAppSettings.sofficePath).trim(),
  }
}

export function writeAppSettings(input: Record<string, unknown>) {
  const existing = readAppSettings()
  const payload = {
    setupCompleted: input.setupCompleted === true || input.setupCompleted === 'true' || existing.setupCompleted,
    systemName: String(input.systemName ?? existing.systemName).trim() || defaultAppSettings.systemName,
    siteTitle: String(input.siteTitle ?? existing.siteTitle).trim() || defaultAppSettings.siteTitle,
    siteDescription: String(input.siteDescription ?? existing.siteDescription).trim(),
    examExportTemplate: input.examExportTemplate === 'examch' ? 'examch' as const : input.examExportTemplate === 'builtin' ? 'builtin' as const : existing.examExportTemplate,
    worksheetWatermark: String(input.worksheetWatermark ?? existing.worksheetWatermark).trim() || defaultAppSettings.worksheetWatermark,
    examWatermark: String(input.examWatermark ?? existing.examWatermark).trim() || defaultAppSettings.examWatermark,
    lectureWatermark: String(input.lectureWatermark ?? existing.lectureWatermark).trim() || defaultAppSettings.lectureWatermark,
    teachingStages: normalizeTeachingStages(input.teachingStages ?? existing.teachingStages),
    sofficePath: String(input.sofficePath ?? existing.sofficePath ?? '').trim(),
  }
  fs.writeFileSync(appSettingsPath(), `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  return readAppSettings()
}

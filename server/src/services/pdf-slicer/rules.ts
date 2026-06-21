import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { storageRoot } from '../../config.js'
import { parseJson } from '../../utils/json.js'
import { nowIso } from '../../utils/ids.js'
import type { SlicerRulesData, SlicerRuleEntry } from '../../types/index.js'

const SLICER_RULES_CATEGORIES = ['auxiliaryMarkers', 'noticeTerms', 'referenceFormulaMarkers', 'trainingMarkers', 'nonQuestionRemainders', 'sectionMarkers'] as const
const VALID_MATCH_MODES = ['contains', 'exact']

export function pdfSlicerRulesPath() {
  const configDir = path.join(storageRoot, 'config')
  fs.mkdirSync(configDir, { recursive: true })
  return path.join(configDir, 'pdf_slicer_rules.json')
}

export function pdfSlicerRulesHistoryDir() {
  const configDir = path.join(storageRoot, 'config', 'pdf_slicer_rules_history')
  fs.mkdirSync(configDir, { recursive: true })
  return configDir
}

export function defaultPdfSlicerRules(): SlicerRulesData {
  return {
    version: 1,
    auxiliaryMarkers: [
      { id: 'aux_mulu', term: '目录', matchMode: 'contains', enabled: true },
      { id: 'aux_jietiguilv', term: '解题规律', matchMode: 'contains', enabled: true },
      { id: 'aux_tifenkuaizhao', term: '提分快招', matchMode: 'contains', enabled: true },
      { id: 'aux_tixingguina', term: '题型归纳', matchMode: 'contains', enabled: true },
      { id: 'aux_tixingtanxi', term: '题型探析', matchMode: 'contains', enabled: true },
      { id: 'aux_siweidaotu', term: '思维导图', matchMode: 'contains', enabled: true },
      { id: 'aux_zhishidian', term: '知识点', matchMode: 'contains', enabled: true },
      { id: 'aux_guilvfangfa', term: '规律方法', matchMode: 'contains', enabled: true },
      { id: 'aux_fangfajiqiao', term: '方法技巧', matchMode: 'contains', enabled: true },
    ],
    noticeTerms: [
      { id: 'notice_dati', term: '答题', matchMode: 'contains', enabled: true },
      { id: 'notice_zhuyishixiang', term: '注意事项', matchMode: 'contains', enabled: true },
      { id: 'notice_zuoda', term: '作答', matchMode: 'contains', enabled: true },
      { id: 'notice_kaoshijieshu', term: '考试结束', matchMode: 'contains', enabled: true },
      { id: 'notice_dajuanqian', term: '答卷前', matchMode: 'contains', enabled: true },
      { id: 'notice_dabunengda', term: '答案不能答在试卷上', matchMode: 'contains', enabled: true },
    ],
    referenceFormulaMarkers: [
      { id: 'ref_cankaogongshi', term: '参考公式', matchMode: 'contains', enabled: true },
      { id: 'ref_cankaoguanxishi', term: '参考关系式', matchMode: 'contains', enabled: true },
      { id: 'ref_cankaoshuju', term: '参考数据', matchMode: 'contains', enabled: true },
    ],
    trainingMarkers: [
      { id: 'tr_dianlixunlian', term: '【典例训练】', matchMode: 'contains', enabled: true },
      { id: 'tr_liti', term: '【例题】', matchMode: 'contains', enabled: true },
      { id: 'tr_jiedati', term: '一、解答题', matchMode: 'contains', enabled: true },
      { id: 'tr_danxuanti', term: '一、单选题', matchMode: 'contains', enabled: true },
      { id: 'tr_xuanzeti', term: '一、选择题', matchMode: 'contains', enabled: true },
      { id: 'tr_tiankongti', term: '二、填空题', matchMode: 'contains', enabled: true },
      { id: 'tr_duoxuanti_1', term: '三、多选题', matchMode: 'contains', enabled: true },
      { id: 'tr_duoxuanti_2', term: '二、多选题', matchMode: 'contains', enabled: true },
    ],
    nonQuestionRemainders: [
      { id: 'nqr_qitalleixing', term: '其他类型', matchMode: 'contains', enabled: true },
      { id: 'nqr_changjianleixing', term: '常见类型', matchMode: 'contains', enabled: true },
      { id: 'nqr_fangfazongjie', term: '方法总结', matchMode: 'contains', enabled: true },
      { id: 'nqr_guilvzongjie', term: '规律总结', matchMode: 'contains', enabled: true },
    ],
    sectionMarkers: [
      { id: 'sec_tixing', term: '题型', matchMode: 'contains', enabled: true },
      { id: 'sec_jietiguilv', term: '【解题规律', matchMode: 'contains', enabled: true },
      { id: 'sec_dianlixunlian', term: '【典例训练】', matchMode: 'contains', enabled: true },
      { id: 'sec_mulu', term: '目录', matchMode: 'contains', enabled: true },
      { id: 'sec_tixingguina', term: '题型归纳', matchMode: 'contains', enabled: true },
      { id: 'sec_tixingtanxi', term: '题型探析', matchMode: 'contains', enabled: true },
    ],
  }
}

export function readPdfSlicerRules(): SlicerRulesData {
  const rulesPath = pdfSlicerRulesPath()
  if (!fs.existsSync(rulesPath)) {
    const defaults = defaultPdfSlicerRules()
    try {
      fs.writeFileSync(rulesPath, JSON.stringify(defaults, null, 2), 'utf8')
    } catch {
      console.warn('[pdf-slicer-rules] failed to write default rules file')
    }
    return defaults
  }
  try {
    const raw = fs.readFileSync(rulesPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      console.warn('[pdf-slicer-rules] rules file is not an object, using defaults')
      return defaultPdfSlicerRules()
    }
    return parsed as SlicerRulesData
  } catch (error) {
    console.warn('[pdf-slicer-rules] failed to parse rules file, using defaults:', error)
    return defaultPdfSlicerRules()
  }
}

export function validatePdfSlicerRules(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!data || typeof data !== 'object') {
    errors.push('规则数据必须是一个 JSON 对象')
    return { valid: false, errors }
  }
  const obj = data as Record<string, unknown>
  if (typeof obj.version !== 'number') errors.push('缺少 version 字段')
  for (const category of SLICER_RULES_CATEGORIES) {
    const entries = obj[category]
    if (!Array.isArray(entries)) {
      errors.push(`${category} 必须是数组`)
      continue
    }
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (!entry || typeof entry !== 'object') {
        errors.push(`${category}[${i}]: 必须是对象`)
        continue
      }
      const e = entry as Record<string, unknown>
      if (!e.id || typeof e.id !== 'string') errors.push(`${category}[${i}]: 缺少 id`)
      if (!e.term || typeof e.term !== 'string') errors.push(`${category}[${i}]: 缺少 term`)
      if (String(e.term || '').trim() === '') errors.push(`${category}[${i}]: term 不能为空`)
      if (e.matchMode && !VALID_MATCH_MODES.includes(String(e.matchMode))) {
        errors.push(`${category}[${i}]: matchMode 必须为 contains 或 exact，实际为 '${e.matchMode}'`)
      }
    }
  }
  return { valid: errors.length === 0, errors }
}

export function computeJsonHash(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16)
}

export function takePdfSlicerRulesSnapshot(data: SlicerRulesData, version: number) {
  const historyDir = pdfSlicerRulesHistoryDir()
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  fs.writeFileSync(
    path.join(historyDir, `rules_v${version}_${timestamp}.json`),
    JSON.stringify({ ...data, snapshotVersion: version, timestamp: new Date().toISOString() }, null, 2),
    'utf8',
  )
}

export function writePdfSlicerRules(data: SlicerRulesData, baseVersion: number): SlicerRulesData & { baseVersion: number; hash: string } {
  takePdfSlicerRulesSnapshot(data, baseVersion)
  const nextVersion = baseVersion + 1
  const payload: SlicerRulesData = { ...data, version: nextVersion }
  const hash = computeJsonHash(payload)
  // Atomic write: write to temp file then rename
  const rulesPath = pdfSlicerRulesPath()
  const tmpPath = rulesPath + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8')
  fs.renameSync(tmpPath, rulesPath)
  return { ...payload, baseVersion: nextVersion, hash }
}

export function listPdfSlicerRulesHistory(): Array<{ version: number; timestamp: string; hash: string }> {
  const historyDir = pdfSlicerRulesHistoryDir()
  if (!fs.existsSync(historyDir)) return []
  const entries: Array<{ version: number; timestamp: string; hash: string }> = []
  for (const f of fs.readdirSync(historyDir).filter((f) => f.endsWith('.json'))) {
    try {
      const payload = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf8')) as Record<string, unknown>
      entries.push({
        version: Number(payload.snapshotVersion || 0),
        timestamp: String(payload.timestamp || ''),
        hash: computeJsonHash(payload),
      })
    } catch {
      // skip unreadable snapshot
    }
  }
  return entries.sort((a, b) => b.version - a.version)
}

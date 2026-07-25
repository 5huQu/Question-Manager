import type { ImportFlowV2ParserConfig } from '@/api/importV2'
import type { OcrSettings } from '@/types'

export type SettingsDraft = Partial<OcrSettings & {
  apiKey: string
  doc2xApiKey: string
  glmOcrApiKey: string
  cleanupApiKey: string
}>

export type ParserListKey = keyof Pick<ImportFlowV2ParserConfig, 'sectionHeadings' | 'documentNoteKeywords' | 'lectureNonQuestionSectionKeywords' | 'solutionSectionKeywords' | 'primaryQuestionPatterns' | 'subQuestionPatterns' | 'figureKeywords' | 'metadataBlockKeywords'>
export type ParserTextDraft = Record<ParserListKey, string>

export const parserListKeys: ParserListKey[] = ['sectionHeadings', 'documentNoteKeywords', 'lectureNonQuestionSectionKeywords', 'solutionSectionKeywords', 'primaryQuestionPatterns', 'subQuestionPatterns', 'figureKeywords', 'metadataBlockKeywords']

export const PARSER_RULE_CATEGORIES: Array<{ key: ParserListKey; label: string; desc: string; placeholder: string; mono?: boolean }> = [
  { key: 'sectionHeadings', label: '大题标题', desc: '识别“一、选择题”“二、填空题”等卷面栏目，不会作为题目入库。', placeholder: '例如：一、选择题' },
  { key: 'documentNoteKeywords', label: '说明文字', desc: '识别“注意事项”“参考公式”等非题目内容。', placeholder: '例如：注意事项' },
  { key: 'lectureNonQuestionSectionKeywords', label: '讲义非题目栏目', desc: '讲义模式下识别“方法技巧”“知识总结”等编号列表栏目，避免把栏目内的序号当成题目。', placeholder: '例如：方法技巧' },
  { key: 'solutionSectionKeywords', label: '答案解析标记', desc: '判断后半部分是否进入答案或解析区。', placeholder: '例如：参考答案' },
  { key: 'metadataBlockKeywords', label: '说明块关键词', desc: '识别“命题说明”“教材题源”“课标要求”等说明块。', placeholder: '例如：命题说明' },
  { key: 'figureKeywords', label: '图形提示词', desc: '帮助系统在题目附近优先关注可能相关的图形。', placeholder: '例如：如图' },
  { key: 'primaryQuestionPatterns', label: '一级题号规则', desc: '用于识别“第 1 题”“1.”、“1、”等一级题号，可填写正则表达式。', placeholder: '例如：^\\s*(\\d+)[\\.、]', mono: true },
  { key: 'subQuestionPatterns', label: '小问编号', desc: '用于避免把“（1）（2）”误识别成新题。', placeholder: '例如：^\\s*[（(]\\d+[）)]', mono: true },
]

export function parserConfigToTextDraft(config: ImportFlowV2ParserConfig): ParserTextDraft {
  return Object.fromEntries(parserListKeys.map((key) => [key, config[key].join('\n')])) as ParserTextDraft
}

export function parserTextDraftToConfig(config: ImportFlowV2ParserConfig, draft: ParserTextDraft): ImportFlowV2ParserConfig {
  return {
    ...config,
    ...Object.fromEntries(parserListKeys.map((key) => [key, draft[key].split('\n').map((item) => item.trim()).filter(Boolean)])),
  }
}

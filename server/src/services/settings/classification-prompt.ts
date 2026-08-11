/**
 * Display-only mirror of the auto-appended classification prompt chain.
 *
 * The runtime assembly lives in server/python/scripts/classify_question_bank.py:
 * - the system prompt appends classification_context_block() to the stored base
 *   template (see classify());
 * - the user prompt template substitutes {payload} with the model_input JSON.
 *
 * Keep the strings below in sync with that script. The settings API only uses
 * them to preview the full chain; the Python runner remains the source of truth
 * for the actual requests.
 */

export type ClassificationBatchContext = {
  stage?: string
  subject?: string
  paperKind?: string
  examYear?: string
  province?: string
  city?: string
  sourceOrg?: string
  paperTitle?: string
  batchName?: string
  sourceTitle?: string
}

const PAPER_KIND_LABELS: Record<string, string> = {
  gaokao_real: '高考真题',
  local_real: '地方真题',
  mock: '模拟考试',
  school_exam: '校内考试',
  lecture: '讲义资料',
  daily_practice: '日常练习',
  unknown: '未知类型',
}

const SAMPLE_CONTEXT: ClassificationBatchContext = {
  stage: '高中',
  subject: '数学',
  paperKind: 'gaokao_real',
  examYear: '2026',
  province: '广东省',
  city: '深圳市',
  sourceOrg: '示例学校',
  paperTitle: '示例试卷',
}

/** Mirrors classification_context_block() in classify_question_bank.py. */
export function renderClassificationContextBlock(context: ClassificationBatchContext): string {
  const subject = String(context.subject || '数学')
  const stage = String(context.stage || '')
  const paperKind = String(context.paperKind || 'unknown')
  const paperKindLabel = PAPER_KIND_LABELS[paperKind] ?? paperKind
  const region = [context.province, context.city]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    .trim()
  const year = String(context.examYear || '').trim()
  const sourceOrg = String(context.sourceOrg || '').trim()
  const title = String(context.paperTitle || context.batchName || context.sourceTitle || '').trim()
  const lines = [
    '',
    '当前批次上下文（由系统设置与题目批次设置自动注入）：',
    `- 学段/年级：${stage || '未指定'}`,
    `- 科目：${subject}`,
    `- 资料类型：${paperKindLabel}`,
  ]
  if (year) lines.push(`- 年份：${year}`)
  if (region) lines.push(`- 地区：${region}`)
  if (sourceOrg) lines.push(`- 来源机构：${sourceOrg}`)
  if (title) lines.push(`- 批次/试卷：${title}`)
  lines.push(
    '',
    '分类策略：',
    `- 按“${stage}${subject}”语境理解题目与标签；如果题目自身元数据更具体，以题目元数据为准。`,
    '- 难度评估要贴合当前资料类型：高考/统考真题按真实考试区分度评估，校内考试与日常练习按对应年级教学难度评估，讲义资料按知识掌握要求评估。',
    '- knowledge_points：本题涉及的知识点，返回 1-6 个中文短标签。',
    '- solution_methods：本题使用的解题方法，返回 1-6 个中文短标签。',
    '- difficulty_score_10：按当前批次语境给 1-10 的整数难度分。',
    '- difficulty_label：按分值输出基础/中等/较难/压轴之一。1-3 基础，4-6 中等，7-8 较难，9-10 压轴。',
    '- 标签必须优先从 allowed_knowledge_points 与 allowed_solution_methods 中选择，避免创造同义标签。',
    '- 不改写题干、答案、解析。',
    '- 只输出 JSON 对象，字段仅包含 knowledge_points、solution_methods、difficulty_score_10、difficulty_label。',
  )
  return lines.join('\n')
}

/** Auto-appended system-prompt block rendered with the sample context. */
export const CLASSIFICATION_CONTEXT_BLOCK_SAMPLE = renderClassificationContextBlock(SAMPLE_CONTEXT)

/**
 * Sample of the model_input JSON that replaces {payload} in the user prompt.
 * Mirrors the model_input dict built in classify() in classify_question_bank.py.
 */
export const CLASSIFICATION_PAYLOAD_SAMPLE = JSON.stringify(
  {
    problem_text: '（示例）题目题干 Markdown，实际运行时替换为当前题目的题干。',
    answer: '（示例）参考答案，实际运行时替换为当前题目的答案。',
    analysis: '（示例）解析 Markdown，实际运行时替换为当前题目的解析。',
    classification_context: {
      stage: '高中',
      subject: '数学',
      paperKind: 'gaokao_real',
      examYear: '2026',
    },
    allowed_knowledge_points: ['函数', '导数', '数列', '…'],
    allowed_solution_methods: ['数形结合', '分类讨论', '…'],
  },
  null,
  2,
)

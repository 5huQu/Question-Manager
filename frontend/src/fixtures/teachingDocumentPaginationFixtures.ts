import type { TeachingBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import { TEACHING_DOCUMENT_ASSET_IDS } from './teachingDocumentFixtures'

function shortParagraphs(count: number): TeachingBlock[] {
  return Array.from({ length: count }, (_, index) => ({
    type: 'paragraph' as const,
    id: `pagination-short-${index + 1}`,
    content: [{
      type: 'text' as const,
      text: `第 ${index + 1} 个短段落用于验证大量连续内容的确定性分页。中文正文 mixed with English terms，并包含行内量 ${index + 1}。`,
    }],
  }))
}

export const TEACHING_DOCUMENT_PAGINATION_NORMAL_FIXTURE: TeachingDocumentV1 = {
  version: 1,
  documentType: 'worksheet',
  title: 'A4 分页原型 · 正常压力文档',
  metadata: { fixtureKind: 'pagination-normal' },
  content: [
    { type: 'heading', id: 'pagination-normal-heading', level: 1, content: [{ type: 'text', text: '一、连续短段落与题目' }] },
    ...shortParagraphs(32),
    { type: 'question', id: 'pagination-normal-choice-1', questionId: 'fixture-choice', display: { displayNumber: '1' } },
    { type: 'question', id: 'pagination-normal-choice-2', questionId: 'fixture-choice', display: { displayNumber: '2', showAnswer: true } },
    { type: 'question', id: 'pagination-normal-solution', questionId: 'fixture-solution', display: { displayNumber: '17' } },
    {
      type: 'box',
      id: 'pagination-normal-box-allow',
      templateId: 'practice',
      title: '允许按子块拆分的综合练习',
      breakBehavior: 'allow',
      children: [
        { type: 'paragraph', id: 'pagination-normal-box-p', content: [{ type: 'text', text: '盒子内同时包含题目和图片；盒子超页时按子块顺序生成运行时片段。' }] },
        { type: 'figure', id: 'pagination-normal-box-figure', asset: { type: 'documentAsset', assetId: TEACHING_DOCUMENT_ASSET_IDS.wide }, alignment: 'center', widthRatio: 0.65 },
        { type: 'question', id: 'pagination-normal-box-question', questionId: 'fixture-choice', display: { displayNumber: '练1' } },
      ],
    },
  ],
}

export const TEACHING_DOCUMENT_PAGINATION_BOUNDARY_FIXTURE: TeachingDocumentV1 = {
  version: 1,
  documentType: 'lecture',
  title: 'A4 分页原型 · 页尾与手动分页边界',
  metadata: { fixtureKind: 'pagination-boundary' },
  content: [
    ...shortParagraphs(18).map((block, index) => ({ ...block, id: `pagination-boundary-p-${index + 1}` })),
    { type: 'heading', id: 'pagination-boundary-heading', level: 2, content: [{ type: 'text', text: '临界页尾标题必须整体换页' }] },
    { type: 'blockMath', id: 'pagination-boundary-math', latex: '\\displaystyle \\sum_{k=1}^{n} k^3=\\left[\\frac{n(n+1)}2\\right]^2' },
    {
      type: 'figure',
      id: 'pagination-boundary-wide',
      asset: { type: 'documentAsset', assetId: TEACHING_DOCUMENT_ASSET_IDS.wide },
      alignment: 'center',
      widthRatio: 1,
      caption: '宽图 · 100%',
    },
    {
      type: 'figure',
      id: 'pagination-boundary-tall',
      asset: { type: 'documentAsset', assetId: TEACHING_DOCUMENT_ASSET_IDS.tall },
      alignment: 'center',
      widthRatio: 0.72,
      caption: '接近内容区高度的高图',
    },
    {
      type: 'box',
      id: 'pagination-boundary-box-avoid',
      templateId: 'warning',
      title: 'avoid 盒子',
      breakBehavior: 'avoid',
      children: [
        { type: 'paragraph', id: 'pagination-boundary-box-p', content: [{ type: 'text', text: '该盒子必须整体移动到下一页。'.repeat(12) }] },
      ],
    },
    { type: 'pageBreak', id: 'pagination-boundary-break-1' },
    { type: 'pageBreak', id: 'pagination-boundary-break-2' },
    { type: 'heading', id: 'pagination-boundary-after-break', level: 1, content: [{ type: 'text', text: '连续分页符之后' }] },
    { type: 'pageBreak', id: 'pagination-boundary-trailing-break' },
  ],
}

export const TEACHING_DOCUMENT_PAGINATION_ABNORMAL_FIXTURE: TeachingDocumentV1 = {
  version: 1,
  documentType: 'exam',
  title: 'A4 分页原型 · 异常与超页诊断',
  metadata: { fixtureKind: 'pagination-abnormal' },
  content: [
    {
      type: 'blockMath',
      id: 'pagination-abnormal-long-math',
      latex: `\\displaystyle ${Array.from({ length: 24 }, (_, index) => `\\frac{x^{${index + 1}}}{${index + 1}!}`).join('+')}`,
    },
    {
      type: 'rawMarkdown',
      id: 'pagination-abnormal-oversized-block',
      markdown: Array.from({ length: 90 }, (_, index) => `${index + 1}. 单一 rawMarkdown 块中的超长段落，用于稳定触发单块超页与 unsupported-split 诊断。`).join('\n\n'),
      reason: 'user-inserted',
    },
    { type: 'figure', id: 'pagination-abnormal-missing-image', asset: { type: 'documentAsset', assetId: TEACHING_DOCUMENT_ASSET_IDS.broken }, alignment: 'center', widthRatio: 0.8 },
    { type: 'question', id: 'pagination-abnormal-missing-question', questionId: 'fixture-question-does-not-exist' },
    {
      type: 'unknown',
      id: 'pagination-abnormal-unknown',
      originalType: 'futurePaginationWidget',
      rawData: { keepTogether: true, payload: { preserve: 'complete' } },
    },
    { type: 'divider', id: 'pagination-abnormal-duplicate' },
    { type: 'spacer', id: 'pagination-abnormal-duplicate', heightEm: 2 },
  ],
}

export const TEACHING_DOCUMENT_PAGINATION_EMPTY_FIXTURE: TeachingDocumentV1 = {
  version: 1,
  documentType: 'lecture',
  title: '',
  metadata: { fixtureKind: 'pagination-empty' },
  content: [],
}

const LONG_CHINESE_PARAGRAPH = [
  '设函数在给定区间内连续，我们先观察端点函数值的符号，再结合单调性判断零点个数。',
  '这一段用于验证中文正文跨越多个页面时，运行时片段仍连续引用同一个源段落，并且不会写回文档。',
  'Mixed English words, spaces, punctuation and 数学术语 should remain in their original inline order.',
].join('').repeat(18)

/** 段落拆分正常样本：内容有效，预期可安全生成 fragment。 */
export const TEACHING_DOCUMENT_PARAGRAPH_PAGINATION_NORMAL_FIXTURE: TeachingDocumentV1 = {
  version: 1,
  documentType: 'lecture',
  title: '段落分页 · 正常样本',
  metadata: { fixtureKind: 'paragraph-pagination-normal' },
  content: [
    {
      type: 'paragraph',
      id: 'paragraph-two-lines',
      content: [{ type: 'text', text: '两行短段落用于验证仍按完整块放置。第二句提供稳定的自然换行机会。' }],
    },
    {
      type: 'paragraph',
      id: 'paragraph-multi-page-chinese',
      content: [{ type: 'text', text: LONG_CHINESE_PARAGRAPH }],
    },
    {
      type: 'paragraph',
      id: 'paragraph-rich-inlines',
      content: [
        { type: 'text', text: '多节点：' },
        { type: 'text', text: '粗体', marks: ['bold'] },
        { type: 'text', text: '、斜体', marks: ['italic'] },
        { type: 'text', text: '、下划线', marks: ['underline'] },
        { type: 'text', text: '，行内公式 ' },
        { type: 'inlineMath', latex: 'a^2+b^2=c^2' },
        { type: 'text', text: ' 与第二个公式 ' },
        { type: 'inlineMath', latex: '\\sum_{k=1}^{n}k' },
        { type: 'text', text: ' 必须保持原子性。' },
      ],
    },
  ],
}

/** 段落拆分边界样本：字符、标点、换行和分页符边界。 */
export const TEACHING_DOCUMENT_PARAGRAPH_PAGINATION_BOUNDARY_FIXTURE: TeachingDocumentV1 = {
  version: 1,
  documentType: 'worksheet',
  title: '段落分页 · 边界样本',
  metadata: { fixtureKind: 'paragraph-pagination-boundary' },
  content: [
    {
      type: 'paragraph',
      id: 'paragraph-graphemes',
      content: [{
        type: 'text',
        text: '中文 English emoji 👍🏽 家庭 👨‍👩‍👧‍👦 combining e\u0301 variation ✈️ 与连续空白   都不能拆坏。',
      }],
    },
    {
      type: 'paragraph',
      id: 'paragraph-punctuation',
      content: [{
        type: 'text',
        text: '候选边界前有开标点（《【「『，候选边界后有闭标点，。！？；：）》】」』，用于观察低级别禁则诊断。'.repeat(20),
      }],
    },
    {
      type: 'paragraph',
      id: 'paragraph-explicit-break',
      content: [
        { type: 'text', text: '显式换行之前' },
        { type: 'hardBreak' },
        { type: 'text', text: '显式换行之后，并继续形成足够长的正文。'.repeat(30) },
      ],
    },
    { type: 'pageBreak', id: 'paragraph-manual-break' },
    {
      type: 'paragraph',
      id: 'paragraph-after-break',
      content: [{ type: 'text', text: LONG_CHINESE_PARAGRAPH }],
    },
  ],
}

/** 段落拆分异常样本：预期产生诊断或整体降级，但不得丢失源数据。 */
export const TEACHING_DOCUMENT_PARAGRAPH_PAGINATION_ABNORMAL_FIXTURE: TeachingDocumentV1 = {
  version: 1,
  documentType: 'exam',
  title: '段落分页 · 异常样本',
  metadata: { fixtureKind: 'paragraph-pagination-abnormal' },
  content: [
    { type: 'paragraph', id: 'paragraph-empty', content: [] },
    { type: 'paragraph', id: 'paragraph-spaces', content: [{ type: 'text', text: '      ' }] },
    {
      type: 'paragraph',
      id: 'paragraph-unknown-inline',
      content: [
        { type: 'text', text: '未知 inline 前' },
        { type: 'unknown', originalType: 'futureInlineWidget', rawData: { payload: '<svg onload=alert(1)>' } },
        { type: 'text', text: '未知 inline 后' },
      ],
    },
    {
      type: 'paragraph',
      id: 'paragraph-unknown-mark',
      content: [{
        type: 'text',
        text: '未知 mark 的原文本必须保留。',
        unknownMarks: [{ type: 'future-color', value: 'javascript:alert(1)' }],
      }],
    },
    {
      type: 'paragraph',
      id: 'paragraph-single-line-overflow-candidate',
      content: [
        { type: 'inlineMath', latex: `\\displaystyle ${'\\frac{1}{1}+'.repeat(120)}0` },
      ],
    },
  ],
}

/** 盒子拆分正常样本：覆盖 whole child、段落 child fragment 与 allow/auto。 */
export const TEACHING_DOCUMENT_BOX_PAGINATION_NORMAL_FIXTURE: TeachingDocumentV1 = {
  version: 1,
  documentType: 'lecture',
  title: '盒子分页 · 正常样本',
  metadata: { fixtureKind: 'box-pagination-normal' },
  content: [
    ...shortParagraphs(10).map((block, index) => ({
      ...block,
      id: `box-pagination-prefill-${index + 1}`,
    })),
    {
      type: 'box',
      id: 'box-pagination-allow',
      templateId: 'method',
      title: 'allow：从当前页开始',
      breakBehavior: 'allow',
      children: [
        {
          type: 'paragraph',
          id: 'box-pagination-allow-long-paragraph',
          content: [{
            type: 'text',
            text: '盒子中的长中文段落会复用已有行盒测量和 widow/orphan 规则生成段落子片段。'.repeat(55),
          }],
        },
        { type: 'blockMath', id: 'box-pagination-allow-math', latex: '\\sum_{k=1}^{n}k=\\frac{n(n+1)}2' },
        {
          type: 'figure',
          id: 'box-pagination-allow-figure',
          asset: { type: 'documentAsset', assetId: TEACHING_DOCUMENT_ASSET_IDS.wide },
          alignment: 'center',
          widthRatio: 0.75,
        },
        {
          type: 'question',
          id: 'box-pagination-allow-question',
          questionId: 'fixture-choice',
          display: { displayNumber: '盒内练习' },
        },
      ],
    },
    {
      type: 'box',
      id: 'box-pagination-auto',
      templateId: 'summary',
      title: 'auto：整体优先，超页才拆',
      breakBehavior: 'auto',
      children: Array.from({ length: 28 }, (_, index) => ({
        type: 'paragraph' as const,
        id: `box-pagination-auto-child-${index + 1}`,
        content: [{ type: 'text' as const, text: `第 ${index + 1} 个完整子块保持顺序和稳定 source path。` }],
      })),
    },
  ],
}

/** 盒子拆分异常样本：不得丢失 unknown 或重复 ID 子节点。 */
export const TEACHING_DOCUMENT_BOX_PAGINATION_ABNORMAL_FIXTURE: TeachingDocumentV1 = {
  version: 1,
  documentType: 'worksheet',
  title: '盒子分页 · 异常样本',
  metadata: { fixtureKind: 'box-pagination-abnormal' },
  content: [
    {
      type: 'box',
      id: 'box-pagination-avoid-oversized',
      templateId: 'warning',
      title: 'avoid 超页仍不拆分',
      breakBehavior: 'avoid',
      children: [{
        type: 'paragraph',
        id: 'box-pagination-avoid-long',
        content: [{ type: 'text', text: LONG_CHINESE_PARAGRAPH.repeat(3) }],
      }],
    },
    {
      type: 'box',
      id: 'box-pagination-abnormal-children',
      templateId: 'future-template-id',
      title: '异常子节点保留',
      breakBehavior: 'allow',
      children: [
        {
          type: 'unknown',
          id: 'box-pagination-unknown-child',
          originalType: 'futureBoxChild',
          rawData: { payload: { preserved: true }, html: '<img src=x onerror=alert(1)>' },
        },
        {
          type: 'question',
          id: 'box-pagination-oversized-question',
          questionId: 'fixture-question-does-not-exist',
        },
        { type: 'divider', id: 'box-pagination-duplicate-child' },
        { type: 'spacer', id: 'box-pagination-duplicate-child', heightEm: 4 },
      ],
    },
  ],
}

/** 题目拆分正常样本：短题、长题干、选项行、图片、答案和多页解析。 */
export const TEACHING_DOCUMENT_QUESTION_PAGINATION_NORMAL_FIXTURE: TeachingDocumentV1 = {
  version: 1,
  documentType: 'worksheet',
  title: '题目分页 · 正常样本',
  metadata: { fixtureKind: 'question-pagination-normal' },
  content: [
    {
      type: 'question',
      id: 'question-pagination-short',
      questionId: 'fixture-choice',
      display: { displayNumber: '1', showAnswer: false, showAnalysis: false },
    },
    {
      type: 'question',
      id: 'question-pagination-long-choice',
      questionId: 'fixture-question-long-choice',
      display: { displayNumber: '2', showAnswer: true, showAnalysis: true },
    },
    { type: 'pageBreak', id: 'question-pagination-before-analysis' },
    {
      type: 'question',
      id: 'question-pagination-long-analysis',
      questionId: 'fixture-question-long-analysis',
      display: { displayNumber: '3', showAnswer: true, showAnalysis: true },
    },
    {
      type: 'question',
      id: 'question-pagination-hidden-solution',
      questionId: 'fixture-question-long-analysis',
      display: { displayNumber: '4', showAnswer: false, showAnalysis: false },
    },
  ],
}

/** 题目拆分边界样本：页尾题号、连续题、选项页尾和手动分页。 */
export const TEACHING_DOCUMENT_QUESTION_PAGINATION_BOUNDARY_FIXTURE: TeachingDocumentV1 = {
  version: 1,
  documentType: 'exam',
  title: '题目分页 · 边界样本',
  metadata: { fixtureKind: 'question-pagination-boundary' },
  content: [
    ...shortParagraphs(15).map((block, index) => ({
      ...block,
      id: `question-pagination-boundary-prefill-${index + 1}`,
    })),
    {
      type: 'question',
      id: 'question-pagination-heading-boundary',
      questionId: 'fixture-question-long-choice',
      display: { displayNumber: '临界 1' },
    },
    {
      type: 'question',
      id: 'question-pagination-option-boundary',
      questionId: 'fixture-choice',
      display: { displayNumber: '临界 2', showAnswer: true, showAnalysis: true },
    },
    { type: 'pageBreak', id: 'question-pagination-boundary-break' },
    {
      type: 'question',
      id: 'question-pagination-after-break',
      questionId: 'fixture-question-long-analysis',
      display: { displayNumber: '临界 3', showAnalysis: true },
    },
  ],
}

/** 题目拆分异常样本：缺失题、缺失图片及不可拆超高区域。 */
export const TEACHING_DOCUMENT_QUESTION_PAGINATION_ABNORMAL_FIXTURE: TeachingDocumentV1 = {
  version: 1,
  documentType: 'exam',
  title: '题目分页 · 异常样本',
  metadata: { fixtureKind: 'question-pagination-abnormal' },
  content: [
    {
      type: 'question',
      id: 'question-pagination-missing',
      questionId: 'fixture-question-does-not-exist',
      display: { displayNumber: '缺失' },
    },
    {
      type: 'question',
      id: 'question-pagination-oversized',
      questionId: 'fixture-question-abnormal',
      display: {
        displayNumber: '异常',
        showAnswer: true,
        showAnalysis: true,
      },
    },
  ],
}

// ─── rawMarkdown 与表格分页 fixture ─────────────────────────────────────────────

const NORMAL_TABLE_MARKDOWN = [
  '| 知识点 | 难度 | 分值 |',
  '| --- | --- | --- |',
  '| 函数与导数 | 中等 | 5 |',
  '| 解析几何 | 较难 | 12 |',
  '| 概率统计 | 容易 | 5 |',
].join('\n')

const TALL_TABLE_MARKDOWN = [
  '| 序号 | 内容 |',
  '| --- | --- |',
  ...Array.from({ length: 80 }, (_, index) => `| ${index + 1} | 超高表格的第 ${index + 1} 行，用于稳定触发表格超页诊断。 |`),
].join('\n')

/** rawMarkdown 分页正常样本：短内容、普通表格、pageBreak 前后。 */
export const TEACHING_DOCUMENT_RAWMD_PAGINATION_NORMAL_FIXTURE: TeachingDocumentV1 = {
  version: 1,
  documentType: 'lecture',
  title: 'rawMarkdown 分页 · 正常样本',
  metadata: { fixtureKind: 'rawmd-pagination-normal' },
  content: [
    {
      type: 'rawMarkdown',
      id: 'rawmd-normal-short',
      markdown: '短 rawMarkdown 内容，包含 **加粗** 与 $a^2+b^2=c^2$。',
      reason: 'user-inserted',
    },
    {
      type: 'rawMarkdown',
      id: 'rawmd-normal-table',
      markdown: NORMAL_TABLE_MARKDOWN,
      reason: 'unsupported-structure',
    },
    { type: 'pageBreak', id: 'rawmd-normal-break' },
    {
      type: 'rawMarkdown',
      id: 'rawmd-normal-after-break',
      markdown: '分页符之后的短 rawMarkdown。',
      reason: 'user-inserted',
    },
  ],
}

/** rawMarkdown 分页边界样本：页尾临界换页与 pageBreak 组合。 */
export const TEACHING_DOCUMENT_RAWMD_PAGINATION_BOUNDARY_FIXTURE: TeachingDocumentV1 = {
  version: 1,
  documentType: 'worksheet',
  title: 'rawMarkdown 分页 · 边界样本',
  metadata: { fixtureKind: 'rawmd-pagination-boundary' },
  content: [
    ...shortParagraphs(16).map((block, index) => ({ ...block, id: `rawmd-boundary-prefill-${index + 1}` })),
    {
      type: 'rawMarkdown',
      id: 'rawmd-boundary-table',
      markdown: NORMAL_TABLE_MARKDOWN,
      reason: 'unsupported-structure',
    },
    { type: 'pageBreak', id: 'rawmd-boundary-break' },
    {
      type: 'rawMarkdown',
      id: 'rawmd-boundary-after-break',
      markdown: Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 段内容位于分页符之后，用于验证换页后的确定性放置。`).join('\n\n'),
      reason: 'user-inserted',
    },
  ],
}

/** rawMarkdown 分页异常样本：超长内容与超高表格必须产生阻塞诊断。 */
export const TEACHING_DOCUMENT_RAWMD_PAGINATION_ABNORMAL_FIXTURE: TeachingDocumentV1 = {
  version: 1,
  documentType: 'exam',
  title: 'rawMarkdown 分页 · 异常样本',
  metadata: { fixtureKind: 'rawmd-pagination-abnormal' },
  content: [
    {
      type: 'rawMarkdown',
      id: 'rawmd-abnormal-oversized',
      markdown: Array.from({ length: 90 }, (_, index) => `${index + 1}. 单一 rawMarkdown 块中的超长段落，用于稳定触发单块超页与 rawmarkdown-overflow 诊断。`).join('\n\n'),
      reason: 'user-inserted',
    },
    {
      type: 'rawMarkdown',
      id: 'rawmd-abnormal-tall-table',
      markdown: TALL_TABLE_MARKDOWN,
      reason: 'unsupported-structure',
    },
    {
      type: 'box',
      id: 'rawmd-abnormal-box',
      templateId: 'practice',
      title: 'box 内 rawMarkdown 降级',
      breakBehavior: 'allow',
      children: [
        {
          type: 'unknown',
          id: 'rawmd-abnormal-box-child',
          originalType: 'rawMarkdown',
          rawData: { type: 'rawMarkdown', markdown: '盒子内的 rawMarkdown 在解析时已降级为 unknown 子节点。' },
        },
        { type: 'divider', id: 'rawmd-abnormal-box-divider' },
      ],
    },
    {
      type: 'unknown',
      id: 'rawmd-abnormal-unknown',
      originalType: 'futureWidget',
      rawData: { preserved: true },
    },
  ],
}

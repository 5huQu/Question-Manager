/**
 * 共享 Mock 文档数据
 * 包含所有块类型的 TeachingDocumentV1 模拟 fixture
 * 所有编辑操作仅在本地 state，不调用任何 API
 */

import type { MockBlock, MockDocument, MockPage } from './shared/types'

let idCounter = 0
function nextId(prefix: string) {
  return `${prefix}_${++idCounter}`
}

export function createMockDocument(): MockDocument {
  idCounter = 0
  return {
    title: '第三章 · 导数及其应用',
    documentType: 'lecture',
    blocks: [
      {
        id: nextId('hdg'),
        type: 'heading',
        level: 2,
        text: '3.1 导数的概念',
      },
      {
        id: nextId('para'),
        type: 'paragraph',
        text: '导数是微积分的核心概念之一，描述了函数在某一点处的瞬时变化率。从几何上看，导数表示函数图像在该点处切线的斜率。',
      },
      {
        id: nextId('math'),
        type: 'blockMath',
        latex: "f'(x) = \\lim_{\\Delta x \\to 0} \\frac{f(x + \\Delta x) - f(x)}{\\Delta x}",
      },
      {
        id: nextId('box'),
        type: 'box',
        templateId: 'concept',
        boxTitle: '定义 · 导数',
        children: [
          {
            id: nextId('para'),
            type: 'paragraph',
            text: '设函数 y = f(x) 在点 x₀ 的某邻域内有定义，当自变量在 x₀ 处取得增量 Δx 时，若极限 lim[Δx→0] Δy/Δx 存在，则称此极限为函数 f(x) 在点 x₀ 处的导数。',
          },
          {
            id: nextId('math'),
            type: 'blockMath',
            latex: "f'(x_0) = \\lim_{\\Delta x \\to 0} \\frac{f(x_0 + \\Delta x) - f(x_0)}{\\Delta x} = \\lim_{h \\to 0} \\frac{f(x_0 + h) - f(x_0)}{h}",
          },
        ],
      },
      {
        id: nextId('para'),
        type: 'paragraph',
        text: '导数的物理意义：若 s = s(t) 表示物体的运动方程，则 s\'(t₀) 表示物体在时刻 t₀ 的瞬时速度。',
      },
      {
        id: nextId('fig'),
        type: 'figure',
        figureLabel: '切线斜率示意图 (tangent-line.svg)',
      },
      {
        id: nextId('hdg'),
        type: 'heading',
        level: 3,
        text: '基本求导法则',
      },
      {
        id: nextId('box'),
        type: 'box',
        templateId: 'method',
        boxTitle: '方法 · 求导四则运算',
        children: [
          {
            id: nextId('para'),
            type: 'paragraph',
            text: '四则运算法则：设 u = u(x)，v = v(x) 均可导，则：',
          },
          {
            id: nextId('math'),
            type: 'blockMath',
            latex: "(u \\pm v)' = u' \\pm v', \\quad (uv)' = u'v + uv', \\quad \\left(\\frac{u}{v}\\right)' = \\frac{u'v - uv'}{v^2}",
          },
        ],
      },
      {
        id: nextId('q'),
        type: 'question',
        questionNo: '1',
      },
      {
        id: nextId('q'),
        type: 'question',
        questionNo: '2',
      },
      {
        id: nextId('div'),
        type: 'divider',
      },
      {
        id: nextId('hdg'),
        type: 'heading',
        level: 2,
        text: '3.2 导数的应用',
      },
      {
        id: nextId('para'),
        type: 'paragraph',
        text: '导数在函数单调性判断、极值求解、最值问题以及曲线凹凸性分析中有广泛应用。',
      },
      {
        id: nextId('box'),
        type: 'box',
        templateId: 'warning',
        boxTitle: '易错提醒',
        children: [
          {
            id: nextId('para'),
            type: 'paragraph',
            text: '注意：f\'(x₀) = 0 是 x₀ 为极值点的必要条件而非充分条件。例如 f(x) = x³ 在 x = 0 处导数为零，但该点不是极值点。',
          },
        ],
      },
      {
        id: nextId('spacer'),
        type: 'spacer',
        heightEm: 2,
      },
      {
        id: nextId('md'),
        type: 'rawMarkdown',
        markdown: '| 函数 | 导数 | 备注 |\n|------|------|------|\n| $x^n$ | $nx^{n-1}$ | 幂函数 |\n| $e^x$ | $e^x$ | 自然指数 |\n| $\\ln x$ | $1/x$ | 自然对数 |',
      },
      {
        id: nextId('pb'),
        type: 'pageBreak',
      },
      {
        id: nextId('hdg'),
        type: 'heading',
        level: 2,
        text: '3.3 课堂练习',
      },
      {
        id: nextId('box'),
        type: 'box',
        templateId: 'practice',
        boxTitle: '课堂练习',
        children: [
          { id: nextId('q'), type: 'question', questionNo: '3' },
          { id: nextId('q'), type: 'question', questionNo: '4' },
          { id: nextId('q'), type: 'question', questionNo: '5' },
        ],
      },
    ],
  }
}

/** 将 blocks 简单分割为模拟页面（每 4-5 个块一页） */
export function paginateMockBlocks(blocks: MockBlock[]): MockPage[] {
  const pages: MockPage[] = []
  let current: MockBlock[] = []
  let count = 0

  for (const block of blocks) {
    if (block.type === 'pageBreak') {
      if (current.length) pages.push({ index: pages.length, blocks: current })
      current = []
      count = 0
      continue
    }
    current.push(block)
    count += block.type === 'box' ? 2 : 1
    if (count >= 5) {
      pages.push({ index: pages.length, blocks: current })
      current = []
      count = 0
    }
  }
  if (current.length) pages.push({ index: pages.length, blocks: current })
  if (!pages.length) pages.push({ index: 0, blocks: [] })
  return pages
}

/** 生成一个新的空块 */
export function newMockBlock(type: MockBlock['type']): MockBlock {
  const id = nextId(type.slice(0, 3))
  switch (type) {
    case 'heading': return { id, type, level: 2, text: '新标题' }
    case 'paragraph': return { id, type, text: '' }
    case 'blockMath': return { id, type, latex: '' }
    case 'figure': return { id, type, figureLabel: '未上传图片' }
    case 'question': return { id, type, questionNo: '' }
    case 'box': return { id, type, templateId: 'concept', boxTitle: '知识点', children: [] }
    case 'divider': return { id, type }
    case 'spacer': return { id, type, heightEm: 2 }
    case 'pageBreak': return { id, type }
    case 'rawMarkdown': return { id, type, markdown: '' }
  }
}

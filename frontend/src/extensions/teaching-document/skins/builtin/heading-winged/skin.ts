import './styles.css'
import { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'

export default defineHeadingSkin({
  id: 'builtin.heading.winged',
  label: '双翼居中线',
  description: '标题居中，两侧对称细线延伸，专用于大题分卷头与试卷分段。',
  version: 1,
  printSafe: true,
  className: 'td-skin-heading-winged',
  supportedLevels: [1, 2, 3],
  tags: ['builtin', 'heading'],
  design: {
    tokens: [
      { id: 'builtin.heading.winged.line-neutral', kind: 'color', label: '中性端线', printSafe: true, value: { hex: '#3F3F46' } },
      { id: 'builtin.heading.winged.line-blue', kind: 'color', label: '蓝色端线', printSafe: true, value: { hex: '#2563EB' } },
      { id: 'builtin.heading.winged.line-green', kind: 'color', label: '绿色端线', printSafe: true, value: { hex: '#047857' } },
      { id: 'builtin.heading.winged.line-amber', kind: 'color', label: '琥珀端线', printSafe: true, value: { hex: '#B45309' } },
      { id: 'builtin.heading.winged.line-red', kind: 'color', label: '红色端线', printSafe: true, value: { hex: '#B91C1C' } },
      { id: 'builtin.heading.winged.line-purple', kind: 'color', label: '紫色端线', printSafe: true, value: { hex: '#7C3AED' } },
      { id: 'builtin.heading.winged.line-teal', kind: 'color', label: '青色端线', printSafe: true, value: { hex: '#0F766E' } },
    ],
    slots: [
      {
        id: 'lineColor',
        kind: 'color',
        defaultTokenId: 'builtin.heading.winged.line-neutral',
        allowedTokenIds: [
          'builtin.heading.winged.line-neutral',
          'builtin.heading.winged.line-blue',
          'builtin.heading.winged.line-green',
          'builtin.heading.winged.line-amber',
          'builtin.heading.winged.line-red',
          'builtin.heading.winged.line-purple',
          'builtin.heading.winged.line-teal',
        ],
      },
    ],
    variants: [
      { id: 'neutral', label: '中性', description: '将端线切换为中性灰。', tokenBindings: { lineColor: 'builtin.heading.winged.line-neutral' } },
      { id: 'blue', label: '蓝色', description: '将端线切换为蓝色。', tokenBindings: { lineColor: 'builtin.heading.winged.line-blue' } },
      { id: 'green', label: '绿色', description: '将端线切换为绿色。', tokenBindings: { lineColor: 'builtin.heading.winged.line-green' } },
      { id: 'amber', label: '琥珀', description: '将端线切换为琥珀色。', tokenBindings: { lineColor: 'builtin.heading.winged.line-amber' } },
      { id: 'red', label: '红色', description: '将端线切换为红色。', tokenBindings: { lineColor: 'builtin.heading.winged.line-red' } },
      { id: 'purple', label: '紫色', description: '将端线切换为紫色。', tokenBindings: { lineColor: 'builtin.heading.winged.line-purple' } },
      { id: 'teal', label: '青色', description: '将端线切换为青色。', tokenBindings: { lineColor: 'builtin.heading.winged.line-teal' } },
    ],
  },
})

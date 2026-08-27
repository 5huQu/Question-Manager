import './styles.css'
import { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'

export default defineHeadingSkin({
  id: 'builtin.heading.double-line',
  label: '经典双下划线',
  description: '一粗一细双下划线规则轴，学术严肃且黑白印刷极佳。',
  version: 1,
  printSafe: true,
  className: 'td-skin-heading-double-line',
  supportedLevels: [1, 2, 3],
  tags: ['builtin', 'heading'],
  design: {
    tokens: [
      { id: 'builtin.heading.double-line.accent-neutral', kind: 'color', label: '中性双线', printSafe: true, value: { hex: '#18181B' } },
      { id: 'builtin.heading.double-line.accent-blue', kind: 'color', label: '蓝色双线', printSafe: true, value: { hex: '#2563EB' } },
      { id: 'builtin.heading.double-line.accent-green', kind: 'color', label: '绿色双线', printSafe: true, value: { hex: '#047857' } },
      { id: 'builtin.heading.double-line.accent-amber', kind: 'color', label: '琥珀双线', printSafe: true, value: { hex: '#B45309' } },
      { id: 'builtin.heading.double-line.accent-red', kind: 'color', label: '红色双线', printSafe: true, value: { hex: '#B91C1C' } },
      { id: 'builtin.heading.double-line.accent-purple', kind: 'color', label: '紫色双线', printSafe: true, value: { hex: '#7C3AED' } },
      { id: 'builtin.heading.double-line.accent-teal', kind: 'color', label: '青色双线', printSafe: true, value: { hex: '#0F766E' } },
    ],
    slots: [
      {
        id: 'accentColor',
        kind: 'color',
        defaultTokenId: 'builtin.heading.double-line.accent-neutral',
        allowedTokenIds: [
          'builtin.heading.double-line.accent-neutral',
          'builtin.heading.double-line.accent-blue',
          'builtin.heading.double-line.accent-green',
          'builtin.heading.double-line.accent-amber',
          'builtin.heading.double-line.accent-red',
          'builtin.heading.double-line.accent-purple',
          'builtin.heading.double-line.accent-teal',
        ],
      },
    ],
    variants: [
      { id: 'neutral', label: '中性', description: '将双线切换为中性灰。', tokenBindings: { accentColor: 'builtin.heading.double-line.accent-neutral' } },
      { id: 'blue', label: '蓝色', description: '将双线切换为蓝色。', tokenBindings: { accentColor: 'builtin.heading.double-line.accent-blue' } },
      { id: 'green', label: '绿色', description: '将双线切换为绿色。', tokenBindings: { accentColor: 'builtin.heading.double-line.accent-green' } },
      { id: 'amber', label: '琥珀', description: '将双线切换为琥珀色。', tokenBindings: { accentColor: 'builtin.heading.double-line.accent-amber' } },
      { id: 'red', label: '红色', description: '将双线切换为红色。', tokenBindings: { accentColor: 'builtin.heading.double-line.accent-red' } },
      { id: 'purple', label: '紫色', description: '将双线切换为紫色。', tokenBindings: { accentColor: 'builtin.heading.double-line.accent-purple' } },
      { id: 'teal', label: '青色', description: '将双线切换为青色。', tokenBindings: { accentColor: 'builtin.heading.double-line.accent-teal' } },
    ],
  },
})

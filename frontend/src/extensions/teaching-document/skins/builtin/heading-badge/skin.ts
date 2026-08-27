import './styles.css'
import { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'

export default defineHeadingSkin({
  id: 'builtin.heading.badge',
  label: '序号徽章',
  description: '前置方圆几何徽章标记，强化考点与解题步骤层次。',
  version: 1,
  printSafe: true,
  className: 'td-skin-heading-badge',
  supportedLevels: [1, 2, 3, 4],
  tags: ['builtin', 'heading'],
  design: {
    tokens: [
      { id: 'builtin.heading.badge.marker-blue', kind: 'color', label: '蓝色徽章', printSafe: true, value: { hex: '#2563EB' } },
      { id: 'builtin.heading.badge.marker-green', kind: 'color', label: '绿色徽章', printSafe: true, value: { hex: '#047857' } },
      { id: 'builtin.heading.badge.marker-amber', kind: 'color', label: '琥珀徽章', printSafe: true, value: { hex: '#B45309' } },
      { id: 'builtin.heading.badge.marker-red', kind: 'color', label: '红色徽章', printSafe: true, value: { hex: '#B91C1C' } },
      { id: 'builtin.heading.badge.marker-purple', kind: 'color', label: '紫色徽章', printSafe: true, value: { hex: '#7C3AED' } },
      { id: 'builtin.heading.badge.marker-teal', kind: 'color', label: '青色徽章', printSafe: true, value: { hex: '#0F766E' } },
      { id: 'builtin.heading.badge.marker-neutral', kind: 'color', label: '中性徽章', printSafe: true, value: { hex: '#18181B' } },
    ],
    slots: [
      {
        id: 'markerFill',
        kind: 'color',
        defaultTokenId: 'builtin.heading.badge.marker-neutral',
        allowedTokenIds: [
          'builtin.heading.badge.marker-blue',
          'builtin.heading.badge.marker-green',
          'builtin.heading.badge.marker-amber',
          'builtin.heading.badge.marker-red',
          'builtin.heading.badge.marker-purple',
          'builtin.heading.badge.marker-teal',
          'builtin.heading.badge.marker-neutral',
        ],
      },
    ],
    variants: [
      { id: 'blue', label: '蓝色', description: '将徽章标记切换为蓝色。', tokenBindings: { markerFill: 'builtin.heading.badge.marker-blue' } },
      { id: 'green', label: '绿色', description: '将徽章标记切换为绿色。', tokenBindings: { markerFill: 'builtin.heading.badge.marker-green' } },
      { id: 'amber', label: '琥珀', description: '将徽章标记切换为琥珀色。', tokenBindings: { markerFill: 'builtin.heading.badge.marker-amber' } },
      { id: 'red', label: '红色', description: '将徽章标记切换为红色。', tokenBindings: { markerFill: 'builtin.heading.badge.marker-red' } },
      { id: 'purple', label: '紫色', description: '将徽章标记切换为紫色。', tokenBindings: { markerFill: 'builtin.heading.badge.marker-purple' } },
      { id: 'teal', label: '青色', description: '将徽章标记切换为青色。', tokenBindings: { markerFill: 'builtin.heading.badge.marker-teal' } },
      { id: 'neutral', label: '中性', description: '将徽章标记切换为中性灰。', tokenBindings: { markerFill: 'builtin.heading.badge.marker-neutral' } },
    ],
  },
})

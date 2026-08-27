import './styles.css'
import { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'

export default defineHeadingSkin({
  id: 'builtin.heading.diamond-tag',
  label: '菱形极客标',
  description: '前置菱形几何锚点，适用于思维拔高与专题探究。',
  version: 1,
  printSafe: true,
  className: 'td-skin-heading-diamond-tag',
  supportedLevels: [1, 2, 3, 4],
  tags: ['builtin', 'heading'],
  design: {
    tokens: [
      { id: 'builtin.heading.diamond-tag.accent-purple', kind: 'color', label: '紫色菱形', printSafe: true, value: { hex: '#7C3AED' } },
      { id: 'builtin.heading.diamond-tag.accent-blue', kind: 'color', label: '蓝色菱形', printSafe: true, value: { hex: '#2563EB' } },
      { id: 'builtin.heading.diamond-tag.accent-green', kind: 'color', label: '绿色菱形', printSafe: true, value: { hex: '#047857' } },
      { id: 'builtin.heading.diamond-tag.accent-amber', kind: 'color', label: '琥珀菱形', printSafe: true, value: { hex: '#B45309' } },
      { id: 'builtin.heading.diamond-tag.accent-red', kind: 'color', label: '红色菱形', printSafe: true, value: { hex: '#B91C1C' } },
      { id: 'builtin.heading.diamond-tag.accent-teal', kind: 'color', label: '青色菱形', printSafe: true, value: { hex: '#0F766E' } },
      { id: 'builtin.heading.diamond-tag.accent-neutral', kind: 'color', label: '中性菱形', printSafe: true, value: { hex: '#3F3F46' } },
    ],
    slots: [
      {
        id: 'accentColor',
        kind: 'color',
        defaultTokenId: 'builtin.heading.diamond-tag.accent-purple',
        allowedTokenIds: [
          'builtin.heading.diamond-tag.accent-purple',
          'builtin.heading.diamond-tag.accent-blue',
          'builtin.heading.diamond-tag.accent-green',
          'builtin.heading.diamond-tag.accent-amber',
          'builtin.heading.diamond-tag.accent-red',
          'builtin.heading.diamond-tag.accent-teal',
          'builtin.heading.diamond-tag.accent-neutral',
        ],
      },
    ],
    variants: [
      { id: 'purple', label: '紫色', description: '将菱形标记切换为紫色。', tokenBindings: { accentColor: 'builtin.heading.diamond-tag.accent-purple' } },
      { id: 'blue', label: '蓝色', description: '将菱形标记切换为蓝色。', tokenBindings: { accentColor: 'builtin.heading.diamond-tag.accent-blue' } },
      { id: 'green', label: '绿色', description: '将菱形标记切换为绿色。', tokenBindings: { accentColor: 'builtin.heading.diamond-tag.accent-green' } },
      { id: 'amber', label: '琥珀', description: '将菱形标记切换为琥珀色。', tokenBindings: { accentColor: 'builtin.heading.diamond-tag.accent-amber' } },
      { id: 'red', label: '红色', description: '将菱形标记切换为红色。', tokenBindings: { accentColor: 'builtin.heading.diamond-tag.accent-red' } },
      { id: 'teal', label: '青色', description: '将菱形标记切换为青色。', tokenBindings: { accentColor: 'builtin.heading.diamond-tag.accent-teal' } },
      { id: 'neutral', label: '中性', description: '将菱形标记切换为中性灰。', tokenBindings: { accentColor: 'builtin.heading.diamond-tag.accent-neutral' } },
    ],
  },
})

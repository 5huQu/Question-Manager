import './styles.css'
import { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'

export default defineHeadingSkin({
  id: 'builtin.heading.left-accent',
  label: '左侧强调线',
  description: '以细左侧强调线标记章节层级。',
  version: 1,
  printSafe: true,
  className: 'td-skin-heading-left-accent',
  supportedLevels: [1, 2, 3, 4],
  tags: ['builtin', 'heading'],
  design: {
    tokens: [
      { id: 'builtin.heading.left-accent.accent-blue', kind: 'color', label: '蓝色强调线', printSafe: true, value: { hex: '#2563EB' } },
      { id: 'builtin.heading.left-accent.accent-green', kind: 'color', label: '绿色强调线', printSafe: true, value: { hex: '#047857' } },
      { id: 'builtin.heading.left-accent.accent-amber', kind: 'color', label: '琥珀强调线', printSafe: true, value: { hex: '#B45309' } },
      { id: 'builtin.heading.left-accent.accent-red', kind: 'color', label: '红色强调线', printSafe: true, value: { hex: '#B91C1C' } },
      { id: 'builtin.heading.left-accent.accent-purple', kind: 'color', label: '紫色强调线', printSafe: true, value: { hex: '#7C3AED' } },
      { id: 'builtin.heading.left-accent.accent-teal', kind: 'color', label: '青色强调线', printSafe: true, value: { hex: '#0F766E' } },
      { id: 'builtin.heading.left-accent.accent-neutral', kind: 'color', label: '中性强调线', printSafe: true, value: { hex: '#3F3F46' } },
      { id: 'builtin.heading.left-accent.border-blue', kind: 'border', label: '蓝色强调线边框', printSafe: true, value: { widthPx: 4, style: 'solid', colorTokenId: 'builtin.heading.left-accent.accent-blue' } },
      { id: 'builtin.heading.left-accent.border-green', kind: 'border', label: '绿色强调线边框', printSafe: true, value: { widthPx: 4, style: 'solid', colorTokenId: 'builtin.heading.left-accent.accent-green' } },
      { id: 'builtin.heading.left-accent.border-amber', kind: 'border', label: '琥珀强调线边框', printSafe: true, value: { widthPx: 4, style: 'solid', colorTokenId: 'builtin.heading.left-accent.accent-amber' } },
      { id: 'builtin.heading.left-accent.border-red', kind: 'border', label: '红色强调线边框', printSafe: true, value: { widthPx: 4, style: 'solid', colorTokenId: 'builtin.heading.left-accent.accent-red' } },
      { id: 'builtin.heading.left-accent.border-purple', kind: 'border', label: '紫色强调线边框', printSafe: true, value: { widthPx: 4, style: 'solid', colorTokenId: 'builtin.heading.left-accent.accent-purple' } },
      { id: 'builtin.heading.left-accent.border-teal', kind: 'border', label: '青色强调线边框', printSafe: true, value: { widthPx: 4, style: 'solid', colorTokenId: 'builtin.heading.left-accent.accent-teal' } },
      { id: 'builtin.heading.left-accent.border-neutral', kind: 'border', label: '中性强调线边框', printSafe: true, value: { widthPx: 4, style: 'solid', colorTokenId: 'builtin.heading.left-accent.accent-neutral' } },
    ],
    slots: [
      {
        id: 'accentBorder',
        kind: 'border',
        defaultTokenId: 'builtin.heading.left-accent.border-blue',
        allowedTokenIds: [
          'builtin.heading.left-accent.border-blue',
          'builtin.heading.left-accent.border-green',
          'builtin.heading.left-accent.border-amber',
          'builtin.heading.left-accent.border-red',
          'builtin.heading.left-accent.border-purple',
          'builtin.heading.left-accent.border-teal',
          'builtin.heading.left-accent.border-neutral',
        ],
      },
    ],
    variants: [
      { id: 'green', label: '绿色', description: '将章节强调线切换为绿色。', tokenBindings: { accentBorder: 'builtin.heading.left-accent.border-green' } },
      { id: 'amber', label: '琥珀', description: '将章节强调线切换为琥珀色。', tokenBindings: { accentBorder: 'builtin.heading.left-accent.border-amber' } },
      { id: 'red', label: '红色', description: '将章节强调线切换为红色。', tokenBindings: { accentBorder: 'builtin.heading.left-accent.border-red' } },
      { id: 'purple', label: '紫色', description: '将章节强调线切换为紫色。', tokenBindings: { accentBorder: 'builtin.heading.left-accent.border-purple' } },
      { id: 'teal', label: '青色', description: '将章节强调线切换为青色。', tokenBindings: { accentBorder: 'builtin.heading.left-accent.border-teal' } },
      { id: 'neutral', label: '中性', description: '将章节强调线切换为中性灰。', tokenBindings: { accentBorder: 'builtin.heading.left-accent.border-neutral' } },
    ],
  },
})

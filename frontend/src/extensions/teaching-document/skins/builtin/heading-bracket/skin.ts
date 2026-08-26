import './styles.css'
import { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'

export default defineHeadingSkin({
  id: 'builtin.heading.bracket',
  label: '角标括记',
  description: '文字左侧带角形几何括记的标题。',
  version: 1,
  printSafe: true,
  className: 'td-skin-heading-bracket',
  supportedLevels: [1, 2, 3, 4],
  tags: ['builtin', 'heading'],
  design: {
    tokens: [
      { id: 'builtin.heading.bracket.marker-blue', kind: 'color', label: '蓝色括记', printSafe: true, value: { hex: '#2563EB' } },
      { id: 'builtin.heading.bracket.marker-green', kind: 'color', label: '绿色括记', printSafe: true, value: { hex: '#047857' } },
      { id: 'builtin.heading.bracket.marker-amber', kind: 'color', label: '琥珀括记', printSafe: true, value: { hex: '#B45309' } },
      { id: 'builtin.heading.bracket.marker-red', kind: 'color', label: '红色括记', printSafe: true, value: { hex: '#B91C1C' } },
      { id: 'builtin.heading.bracket.marker-purple', kind: 'color', label: '紫色括记', printSafe: true, value: { hex: '#7C3AED' } },
      { id: 'builtin.heading.bracket.marker-teal', kind: 'color', label: '青色括记', printSafe: true, value: { hex: '#0F766E' } },
      { id: 'builtin.heading.bracket.marker-neutral', kind: 'color', label: '中性括记', printSafe: true, value: { hex: '#3F3F46' } },
      { id: 'builtin.heading.bracket.border-blue', kind: 'border', label: '蓝色括记边框', printSafe: true, value: { widthPx: 2, style: 'solid', colorTokenId: 'builtin.heading.bracket.marker-blue' } },
      { id: 'builtin.heading.bracket.border-green', kind: 'border', label: '绿色括记边框', printSafe: true, value: { widthPx: 2, style: 'solid', colorTokenId: 'builtin.heading.bracket.marker-green' } },
      { id: 'builtin.heading.bracket.border-amber', kind: 'border', label: '琥珀括记边框', printSafe: true, value: { widthPx: 2, style: 'solid', colorTokenId: 'builtin.heading.bracket.marker-amber' } },
      { id: 'builtin.heading.bracket.border-red', kind: 'border', label: '红色括记边框', printSafe: true, value: { widthPx: 2, style: 'solid', colorTokenId: 'builtin.heading.bracket.marker-red' } },
      { id: 'builtin.heading.bracket.border-purple', kind: 'border', label: '紫色括记边框', printSafe: true, value: { widthPx: 2, style: 'solid', colorTokenId: 'builtin.heading.bracket.marker-purple' } },
      { id: 'builtin.heading.bracket.border-teal', kind: 'border', label: '青色括记边框', printSafe: true, value: { widthPx: 2, style: 'solid', colorTokenId: 'builtin.heading.bracket.marker-teal' } },
      { id: 'builtin.heading.bracket.border-neutral', kind: 'border', label: '中性括记边框', printSafe: true, value: { widthPx: 2, style: 'solid', colorTokenId: 'builtin.heading.bracket.marker-neutral' } },
    ],
    slots: [
      {
        id: 'markerBorder',
        kind: 'border',
        defaultTokenId: 'builtin.heading.bracket.border-blue',
        allowedTokenIds: [
          'builtin.heading.bracket.border-blue',
          'builtin.heading.bracket.border-green',
          'builtin.heading.bracket.border-amber',
          'builtin.heading.bracket.border-red',
          'builtin.heading.bracket.border-purple',
          'builtin.heading.bracket.border-teal',
          'builtin.heading.bracket.border-neutral',
        ],
      },
    ],
    variants: [
      { id: 'green', label: '绿色', description: '将角标括记切换为绿色。', tokenBindings: { markerBorder: 'builtin.heading.bracket.border-green' } },
      { id: 'amber', label: '琥珀', description: '将角标括记切换为琥珀色。', tokenBindings: { markerBorder: 'builtin.heading.bracket.border-amber' } },
      { id: 'red', label: '红色', description: '将角标括记切换为红色。', tokenBindings: { markerBorder: 'builtin.heading.bracket.border-red' } },
      { id: 'purple', label: '紫色', description: '将角标括记切换为紫色。', tokenBindings: { markerBorder: 'builtin.heading.bracket.border-purple' } },
      { id: 'teal', label: '青色', description: '将角标括记切换为青色。', tokenBindings: { markerBorder: 'builtin.heading.bracket.border-teal' } },
      { id: 'neutral', label: '中性', description: '将角标括记切换为中性灰。', tokenBindings: { markerBorder: 'builtin.heading.bracket.border-neutral' } },
    ],
  },
})

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
      { id: 'builtin.heading.left-accent.blue', kind: 'color', label: '蓝色强调线', printSafe: true, value: { hex: '#2563EB' } },
      { id: 'builtin.heading.left-accent.amber', kind: 'color', label: '琥珀强调线', printSafe: true, value: { hex: '#B45309' } },
      { id: 'builtin.heading.left-accent.border-blue', kind: 'border', label: '蓝色强调线边框', printSafe: true, value: { widthPx: 4, style: 'solid', colorTokenId: 'builtin.heading.left-accent.blue' } },
      { id: 'builtin.heading.left-accent.border-amber', kind: 'border', label: '琥珀强调线边框', printSafe: true, value: { widthPx: 4, style: 'solid', colorTokenId: 'builtin.heading.left-accent.amber' } },
    ],
    slots: [{ id: 'accentBorder', kind: 'border', defaultTokenId: 'builtin.heading.left-accent.border-blue', allowedTokenIds: ['builtin.heading.left-accent.border-blue', 'builtin.heading.left-accent.border-amber'] }],
    variants: [{ id: 'amber', label: '琥珀', description: '将章节强调线切换为琥珀色。', tokenBindings: { accentBorder: 'builtin.heading.left-accent.border-amber' } }],
  },
})
